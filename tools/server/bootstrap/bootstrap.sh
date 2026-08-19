#!/usr/bin/env bash
# Mountain Runners VPS bootstrap (phase 5, task 5.3).
#
# Provisions the approved server structure on a fresh Debian 12 (or compatible)
# Hetzner VPS: pinned Caddy, separate deploy and Caddy identities, the release
# layout, log directories, the validated Caddyfile, the release daemon
# (systemd, root) and the release tooling. The script is idempotent:
# re-running it converges to the same state.
#
# Privileged operations (release trees, registry, `current` symlink) are only
# performed by the root release daemon; the deploy identity holds no privileged
# filesystem access and no sudo.
#
# Remote changes (creating the VPS, the validation-host DNS record, SSH keys)
# require explicit maintainer approval before this script is run; see
# docs/runbook.md for the full procedure.
#
# Usage (as root or with sudo):
#   VALIDATION_HOST=validate.example.cat \
#   DEPLOY_PUBLIC_KEY="ssh-ed25519 AAAA... deploy@ci" \
#   ./bootstrap.sh
#
# Environment:
#   VALIDATION_HOST   required; subdomain that resolves to this VPS and that
#                     the validation Caddy block serves
#   PRODUCTION_DOMAIN optional; apex of the production site (default
#                     mountainrunners.cat)
#   DEPLOY_PUBLIC_KEY optional; public key installed for the deploy identity,
#                     forced to the release gate (no shell, no PTY)
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly TOOL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly RELEASE_LIB="/usr/local/lib/mountain-runners"
readonly RELEASE_ROOT="/var/lib/mountain-runners"
readonly LOG_ROOT="/var/log/mountain-runners"

readonly CADDY_VERSION="v2.11.4"
# Official SHA-512 pins from caddy_2.11.4_checksums.txt (Caddy does not
# publish SHA-256 in that file).
readonly CADDY_AMD64_SHA512="1c6f5404f3622e46d401d81f4af59677d46b886229c6694d60fd936b87c72d3bb5d1fcf42b55c8d555769fa75acf434ab618fc7e0df2c79cf8512ee580d38d06"
readonly CADDY_ARM64_SHA512="c43c62b7b583b31c682b3c3e1a31cf03759fbab01dcb0fc7d7fc3a5ce1bef43403583e26133920634a730a9fe31dae1386af4d3f9f3fc19fcc2c29ebf19de235"

log() { printf '[bootstrap] %s\n' "$*"; }
fail() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "run as root (or via sudo)."

: "${VALIDATION_HOST:?VALIDATION_HOST is required (the validation subdomain).}"
readonly PRODUCTION_DOMAIN="${PRODUCTION_DOMAIN:-mountainrunners.cat}"
readonly DEPLOY_PUBLIC_KEY="${DEPLOY_PUBLIC_KEY:-}"

[[ -d "${TOOL_ROOT}/release" ]] || fail "run from the repository checkout (tools/server not found at ${TOOL_ROOT})."

# --- architecture -----------------------------------------------------------

readonly MACHINE="$(uname -m)"
case "${MACHINE}" in
  x86_64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) fail "unsupported architecture: ${MACHINE}." ;;
esac

# --- system packages --------------------------------------------------------

log "Installing system prerequisites (curl, nodejs, Caddy dependencies)."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl nodejs ca-certificates libcap2-bin

# --- pinned Caddy -----------------------------------------------------------

install_caddy() {
  if command -v caddy >/dev/null 2>&1 && [[ "$(caddy version 2>/dev/null | awk '{print $1}')" == "${CADDY_VERSION}" ]]; then
    log "Caddy ${CADDY_VERSION} already installed."
    return
  fi

  local expected_sha
  if [[ "${ARCH}" == "amd64" ]]; then
    expected_sha="${CADDY_AMD64_SHA512}"
  else
    expected_sha="${CADDY_ARM64_SHA512}"
  fi

  local package="caddy_${CADDY_VERSION#v}_linux_${ARCH}.deb"
  local destination="/tmp/${package}"
  log "Downloading pinned ${package}."
  curl -fsSL -o "${destination}" "https://github.com/caddyserver/caddy/releases/download/${CADDY_VERSION}/${package}"
  local actual_sha
  actual_sha="$(sha512sum "${destination}" | awk '{print $1}')"
  [[ "${actual_sha}" == "${expected_sha}" ]] || fail "Caddy checksum mismatch (got ${actual_sha})."
  dpkg -i "${destination}"
  rm -f "${destination}"
}

install_caddy

# --- identities -------------------------------------------------------------

if ! getent group mountain-runners >/dev/null; then
  groupadd --system mountain-runners
  log "Created group mountain-runners."
fi

if ! id mountain-deploy >/dev/null 2>&1; then
  # The login shell is the deploy wrapper, which only forwards validated
  # requests to the root daemon: OpenSSH runs forced commands through the
  # user's login shell, so a real shell would defeat the gate.
  useradd --system --gid mountain-runners --home-dir "${RELEASE_ROOT}" \
    --shell "${RELEASE_LIB}/deploy-shell" mountain-deploy
  log "Created system user mountain-deploy (gate-only shell)."
fi
# useradd --system locks the password with '!'; Ubuntu sshd then rejects
# publickey. '*' disables password login without locking the account.
usermod -p '*' mountain-deploy

# --- release layout ---------------------------------------------------------
# The root daemon owns everything under the release root; the deploy identity
# only writes uploads to incoming/ and reaches the daemon through the socket.

mkdir -p "${RELEASE_ROOT}/releases" "${RELEASE_ROOT}/incoming"
chown root:root "${RELEASE_ROOT}" "${RELEASE_ROOT}/releases"
chmod 755 "${RELEASE_ROOT}" "${RELEASE_ROOT}/releases"
chown root:mountain-runners "${RELEASE_ROOT}/incoming"
chmod 2770 "${RELEASE_ROOT}/incoming"

# --- log directories (Caddy owns them; access via sudo) ----------------------

mkdir -p "${LOG_ROOT}"
chown caddy:caddy "${LOG_ROOT}"
chmod 700 "${LOG_ROOT}"

# --- release tooling ---------------------------------------------------------

log "Installing the release tooling to ${RELEASE_LIB}."
mkdir -p "${RELEASE_LIB}"
install -m 0644 -o root -g root \
  "${TOOL_ROOT}/release/config.mjs" \
  "${TOOL_ROOT}/release/fsutil.mjs" \
  "${TOOL_ROOT}/release/manifest.mjs" \
  "${TOOL_ROOT}/release/archive.mjs" \
  "${TOOL_ROOT}/release/registry.mjs" \
  "${TOOL_ROOT}/release/validate.mjs" \
  "${TOOL_ROOT}/release/operations.mjs" \
  "${TOOL_ROOT}/release/receive.mjs" \
  "${TOOL_ROOT}/release/daemon.mjs" \
  "${TOOL_ROOT}/release/cli.mjs" \
  "${TOOL_ROOT}/release/ssh-gate.mjs" \
  "${RELEASE_LIB}/"
chmod 0755 "${RELEASE_LIB}/cli.mjs" "${RELEASE_LIB}/ssh-gate.mjs" "${RELEASE_LIB}/daemon.mjs"
ln -sf "${RELEASE_LIB}/cli.mjs" /usr/local/bin/mountain-release
ln -sf "${RELEASE_LIB}/ssh-gate.mjs" /usr/local/bin/mountain-ssh-gate

# Login shell wrapper for mountain-deploy: sshd runs it as `shell -c <command>`;
# it discards the command and hands control to the gate, which reads
# SSH_ORIGINAL_COMMAND.
cat > "${RELEASE_LIB}/deploy-shell" <<'EOF'
#!/bin/sh
# Mountain Runners deploy shell: only the release gate may run.
exec /usr/local/bin/mountain-ssh-gate
EOF
chown root:root "${RELEASE_LIB}/deploy-shell"
chmod 0755 "${RELEASE_LIB}/deploy-shell"
if ! grep -Fx "${RELEASE_LIB}/deploy-shell" /etc/shells >/dev/null 2>&1; then
  echo "${RELEASE_LIB}/deploy-shell" >> /etc/shells
fi

# --- Caddyfile ---------------------------------------------------------------

install_caddyfile() {
  local template="$1"
  local destination="$2"
  local domain="$3"
  sed -e "s|__VALIDATION_HOST__|${VALIDATION_HOST}|g" \
    -e "s|__PRODUCTION_DOMAIN__|${domain}|g" \
    "${template}" > "${destination}"
  chown root:root "${destination}"
  chmod 0644 "${destination}"
}

log "Installing the validated Caddyfile (validation host: ${VALIDATION_HOST})."
install_caddyfile "${TOOL_ROOT}/caddy/Caddyfile" /etc/caddy/Caddyfile "${PRODUCTION_DOMAIN}"
install_caddyfile "${TOOL_ROOT}/caddy/Caddyfile.production" /etc/caddy/Caddyfile.production "${PRODUCTION_DOMAIN}"

if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  fail "the generated Caddyfile does not validate; refusing to proceed."
fi
# `caddy validate` runs as root and may create log files; Caddy itself runs
# as the caddy user.
chown -R caddy:caddy "${LOG_ROOT}"
chmod 700 "${LOG_ROOT}"

# --- release daemon (systemd, root) ------------------------------------------

log "Installing and starting the release daemon."
readonly MOUNTAIN_GROUP_GID="$(getent group mountain-runners | cut -d: -f3)"
sed -e "s|^Environment=MOUNTAIN_RELEASE_DAEMON_GID=.*|Environment=MOUNTAIN_RELEASE_DAEMON_GID=${MOUNTAIN_GROUP_GID}|" \
  "${TOOL_ROOT}/systemd/mountain-release.service" > /etc/systemd/system/mountain-release.service
chown root:root /etc/systemd/system/mountain-release.service
chmod 0644 /etc/systemd/system/mountain-release.service
systemctl daemon-reload
systemctl enable mountain-release >/dev/null 2>&1 || true
systemctl restart mountain-release

# --- deploy identity SSH key --------------------------------------------------

if [[ -n "${DEPLOY_PUBLIC_KEY}" ]]; then
  # Do not use `grep` on a here-string to detect newlines: `<<<` always
  # appends one, so a valid single-line key would be rejected.
  if [[ "${DEPLOY_PUBLIC_KEY}" == *$'\n'* ]]; then
    fail "DEPLOY_PUBLIC_KEY does not look like a single public key line."
  fi
  case "${DEPLOY_PUBLIC_KEY}" in
    ssh-ed25519\ * | ssh-rsa\ * | ecdsa-sha2-nistp256\ * | sk-ssh-ed25519\ *) ;;
    *) fail "DEPLOY_PUBLIC_KEY does not look like a single public key line." ;;
  esac
  log "Installing the deploy identity key (forced command, no shell)."
  mkdir -p "${RELEASE_ROOT}/.ssh"
  printf 'restrict,no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,command="/usr/local/bin/mountain-ssh-gate" %s\n' \
    "${DEPLOY_PUBLIC_KEY}" > "${RELEASE_ROOT}/.ssh/authorized_keys"
fi
# Root-owned so the deploy identity cannot replace the forced command.
# Traversable/readable by the user: Ubuntu 26 sshd-session reads
# authorized_keys as mountain-deploy, not as root.
if [[ -d "${RELEASE_ROOT}/.ssh" ]]; then
  chown -R root:root "${RELEASE_ROOT}/.ssh"
  chmod 755 "${RELEASE_ROOT}/.ssh"
  if [[ -f "${RELEASE_ROOT}/.ssh/authorized_keys" ]]; then
    chmod 644 "${RELEASE_ROOT}/.ssh/authorized_keys"
  fi
fi

# --- sshd hardening (key-only authentication) --------------------------------

log "Hardening sshd: key-only authentication."
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-mountain-runners.conf <<'EOF'
# Mountain Runners: the VPS only accepts key authentication.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
chown root:root /etc/ssh/sshd_config.d/99-mountain-runners.conf
chmod 0644 /etc/ssh/sshd_config.d/99-mountain-runners.conf
sshd -t || fail "sshd configuration is invalid."
if systemctl is-active --quiet ssh 2>/dev/null; then
  systemctl reload ssh || fail "could not reload ssh after hardening."
elif systemctl is-active --quiet sshd 2>/dev/null; then
  systemctl reload sshd || fail "could not reload sshd after hardening."
else
  log "sshd is not running; key-only config is installed and will apply on start."
fi

# --- Caddy service ------------------------------------------------------------

mkdir -p /etc/systemd/system/caddy.service.d
install -m 0644 -o root -g root \
  "${TOOL_ROOT}/systemd/caddy-mountain-runners.conf" \
  /etc/systemd/system/caddy.service.d/mountain-runners.conf

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy
  log "Caddy service restarted."
else
  log "systemd not found; start Caddy and the daemon manually."
fi

cat <<EOF

Bootstrap completed.

Next steps (all require maintainer approval; see docs/runbook.md):
1. Confirm the validation record ${VALIDATION_HOST} resolves to this VPS and
   that HTTP/HTTPS reach Caddy through the firewall.
2. Create the GitHub `production` environment (T5.4) and approve the Artifact
   deploy job, or install a release by hand:
     sudo mountain-release install <archive> <manifest>
     sudo mountain-release activate <commit>
3. Run the verification script against https://${VALIDATION_HOST}:
     node tools/server/verify/verify-site.mjs --base-url https://${VALIDATION_HOST} --expect-noindex
4. The production host activates at the DNS cut (T5.5): see docs/runbook.md.
   Uncomment `import Caddyfile.production` in /etc/caddy/Caddyfile, run
   `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`,
   and restart Caddy *before* moving apex/www DNS to this VPS.

Deploy identity: ${RELEASE_ROOT}/.ssh/authorized_keys (${DEPLOY_PUBLIC_KEY:+installed}${DEPLOY_PUBLIC_KEY:-not installed})
Release daemon:   systemctl status mountain-release (socket /run/mountain-release.sock)
Logs: ${LOG_ROOT} (root only via sudo)
Release registry: ${RELEASE_ROOT}/releases.json (permanent, root only)
EOF
