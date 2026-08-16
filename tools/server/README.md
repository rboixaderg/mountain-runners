# Eines De Servidor (T5.3)

Aquest directori conté la provisió i les eines operatives de la T5.3 de
[`docs/specs/phase-5-publication-operation.md`](../../docs/specs/phase-5-publication-operation.md).
Tota l'operació està documentada al
[`docs/runbook.md`](../../docs/runbook.md); aquí només es descriu la disposició.

## Estructura

| Path                               | Contingut                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `bootstrap/bootstrap.sh`           | Provisió reproduïble i idempotent del VPS (Caddy pinjat, identitats, layout, daemon) |
| `caddy/Caddyfile`                  | Configuració del host de validació (headers, caché, 404, logs mínims)                |
| `caddy/Caddyfile.production`       | Host de producció, importat al tall (T5.5)                                           |
| `release/`                         | CLI `mountain-release` i mòduls (instal·lació, activació, reversió)                  |
| `release/daemon.mjs`               | Daemon root (systemd) que executa les operacions per la identitat de desplegament    |
| `release/ssh-gate.mjs`             | Forced command de la identitat de desplegament (tokenitza sense shell)               |
| `release/validate.mjs`             | Validació d'arguments compartida entre el gate i el daemon                           |
| `release/cli.test.mjs`             | Tests `node --test` amb arxius tar adversos i el daemon en marxa                     |
| `systemd/mountain-release.service` | Unitat del daemon (root, socket `/run/mountain-release.sock`)                        |
| `verify/verify-site.mjs`           | Verificació del contracte del host: TLS, headers, 404, caché, noindex                |

## Layout Al Servidor

```text
/var/lib/mountain-runners/         755  root:root
├── releases/<commit>/             755  root:root (una per release)
├── incoming/                      2770 root:mountain-runners (uploads)
├── current                        symlink atòmic a la release activa (root)
├── releases.json                  600  root:root (registre permanent)
└── .ssh/authorized_keys           600  clau de desplegament (forced command)
/var/log/mountain-runners/         700  caddy:caddy (accés només via sudo)
/run/mountain-release.sock         660  root:mountain-runners (socket del daemon)
/usr/local/lib/mountain-runners/        eines instal·lades pel bootstrap
```

## Identitats

- **Persona mantenidora**: usuari administratiu no `root` amb `sudo` (T5.1).
- **`mountain-deploy`**: usuari de sistema amb shell restringit (només el
  gate); la seva clau SSH està restringida a
  `command="/usr/local/bin/mountain-ssh-gate"` amb `restrict`, sense PTY ni
  forwarding. No té cap accés privilegiat al filesystem ni `sudo`: el gate
  valida els arguments i el daemon executa les operacions com a `root`.
- **Daemon de releases**: servei systemd com a `root`; únic escriptor de les
  release trees, el registre i el symlink `current`.
- **`caddy`**: usuari del paquet; només llegeix la release activa i escriu els
  logs. No gestiona TLS ni la configuració.

## Verificació

```sh
node --test tools/server/release/
bash -n tools/server/bootstrap/bootstrap.sh
caddy validate --config <Caddyfile generat> --adapter caddyfile
```

Les accions remotes (crear el VPS, el registre DNS del host de validació i les
claus SSH) requereixen aprovació explícita de la persona mantenidora.
