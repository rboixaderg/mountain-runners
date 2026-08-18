// SSH transport for the deploy identity (phase 5, task 5.4).
//
// Writes the private key and known_hosts to a temporary directory with mode
// 0600, runs ssh in BatchMode with StrictHostKeyChecking, and never prints
// the key, the known_hosts file or the remote command's stdin. The forced
// command on the server tokenizes SSH_ORIGINAL_COMMAND; this client only
// sends `mountain-release …` plus the file body for `receive`.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const hostPattern = /^[A-Za-z0-9][A-Za-z0-9.:-]*$/u;

export class RemoteCommandError extends Error {
  constructor(message, { status, stdout, stderr }) {
    super(message);
    this.status = status;
    this.stdout = stdout;
    this.stderr = stderr;
    this.noEligible = status === 3;
  }
}

export function createSshTransport({
  host,
  user = "mountain-deploy",
  privateKey,
  knownHosts,
  sshCommand = "ssh",
}) {
  if (!hostPattern.test(host) || host.includes("@")) {
    throw new Error("DEPLOY_HOST is not a hostname or address.");
  }
  if (user !== "mountain-deploy") {
    throw new Error("DEPLOY_USER must be the mountain-deploy identity.");
  }
  if (privateKey === undefined || privateKey.trim() === "") {
    throw new Error("DEPLOY_SSH_PRIVATE_KEY is required.");
  }
  if (knownHosts === undefined || knownHosts.trim() === "") {
    throw new Error("DEPLOY_KNOWN_HOSTS is required.");
  }

  return {
    async receive(fileName, contents) {
      const stdout = await withIdentityFiles(
        { privateKey, knownHosts },
        (identityFile, knownHostsFile) =>
          runSsh({
            sshCommand,
            identityFile,
            knownHostsFile,
            user,
            host,
            remoteCommand: `mountain-release receive ${fileName}`,
            stdin: contents,
          }),
      );
      return parseReceiveMessage(stdout, fileName);
    },
    async run(remoteCommand) {
      return withIdentityFiles(
        { privateKey, knownHosts },
        (identityFile, knownHostsFile) =>
          runSsh({
            sshCommand,
            identityFile,
            knownHostsFile,
            user,
            host,
            remoteCommand,
          }),
      );
    },
  };
}

export function parseReceiveMessage(stdout, expectedFileName) {
  const match = /^Received (\S+) sha256:([0-9a-f]{64}) bytes:(\d+)\s*$/mu.exec(
    stdout.trim(),
  );
  if (match === null) {
    throw new Error(
      `The receive command did not return a digest for ${expectedFileName}.`,
    );
  }
  const [, fileName, sha256, bytes] = match;
  if (fileName !== expectedFileName) {
    throw new Error(`Received ${fileName}, expected ${expectedFileName}.`);
  }
  return { fileName, sha256, bytes: Number.parseInt(bytes, 10) };
}

async function withIdentityFiles({ privateKey, knownHosts }, run) {
  const directory = await mkdtemp(join(tmpdir(), "mountain-deploy-ssh-"));
  const identityFile = join(directory, "id_ed25519");
  const knownHostsFile = join(directory, "known_hosts");
  try {
    await writeFile(identityFile, normalizeKeyFile(privateKey), {
      mode: 0o600,
    });
    await writeFile(knownHostsFile, normalizeKeyFile(knownHosts), {
      mode: 0o600,
    });
    return await run(identityFile, knownHostsFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function normalizeKeyFile(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function runSsh({
  sshCommand,
  identityFile,
  knownHostsFile,
  user,
  host,
  remoteCommand,
  stdin,
}) {
  return new Promise((resolveStdout, rejectRun) => {
    const child = spawn(
      sshCommand,
      [
        "-i",
        identityFile,
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        `UserKnownHostsFile=${knownHostsFile}`,
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "LogLevel=ERROR",
        `${user}@${host}`,
        "--",
        remoteCommand,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      if (status === 0) {
        resolveStdout(stdout.trim());
        return;
      }
      rejectRun(
        new RemoteCommandError(
          stderr.trim() || stdout.trim() || `ssh exited with status ${status}.`,
          { status: status ?? 1, stdout, stderr },
        ),
      );
    });

    if (stdin === undefined) {
      child.stdin.end();
      return;
    }
    Readable.from(stdin).pipe(child.stdin);
  });
}
