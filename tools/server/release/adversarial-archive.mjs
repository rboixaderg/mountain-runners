// Adversarial archive and manifest fixtures shared by the release tooling
// tests (T5.3) and the preview tooling tests (T6.3). They build raw ustar
// archives with arbitrary type flags and names so the validators are tested
// against entries that system tar would never create. No production
// credentials or fixtures.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

export const testCommit = "1f8611b283f924aab99aa98a6cff524306138a46";

export function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function makeManifest({
  commit = testCommit,
  files,
  origin = "https://mountainrunners.cat",
  pullRequestNumber,
}) {
  const manifestFiles = files.map(({ path, content }) => ({
    path,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256Of(Buffer.from(content, "utf8")),
  }));
  const manifest = {
    schemaVersion: 1,
    commit,
    origin,
    buildToday: "2026-08-16",
    workflow: "Artifact",
    limits: { maxExpandedBytes: 134_217_728, maxFileCount: 5_000 },
    totals: {
      fileCount: manifestFiles.length,
      expandedBytes: manifestFiles.reduce((sum, entry) => sum + entry.size, 0),
    },
    files: manifestFiles,
  };
  if (pullRequestNumber !== undefined) {
    manifest.pullRequestNumber = pullRequestNumber;
  }
  return manifest;
}

export const simpleFiles = [
  { path: "index.html", content: "<html>home</html>" },
  { path: "ca/index.html", content: "<html>hola</html>" },
];

export async function makeNormalArchive(destination, files) {
  const sourceDirectory = await mkdtemp(
    join(tmpdir(), "mountain-archive-src-"),
  );
  try {
    const names = [];
    for (const { path, content } of files) {
      const absolutePath = join(sourceDirectory, path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
      names.push(path);
    }
    const result = spawnSync(
      "tar",
      ["-czf", destination, "-C", sourceDirectory, ...names],
      {
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
  }
}

export async function writeCraftedArchive(destination, entries) {
  await writeFile(destination, craftTarGz(entries));
}

// Builds a raw ustar archive with arbitrary type flags and names so the
// validator is tested against entries that system tar would never create.
function craftTarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "", "utf8");
    blocks.push(tarHeader(entry, content.length));
    if (content.length > 0) {
      const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
      content.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(512), Buffer.alloc(512));
  return gzipSync(Buffer.concat(blocks));
}

function tarHeader(
  { name, type = "0", linkname = "", size: sizeOverride },
  contentLength,
) {
  const recordedSize = sizeOverride ?? contentLength;
  const header = Buffer.alloc(512);
  Buffer.from(name, "utf8").copy(header, 0);
  writeOctal(header, 100, 0o644);
  writeOctal(header, 108, 0);
  writeOctal(header, 116, 0);
  writeTarSize(header, recordedSize);
  writeOctal(header, 136, 0);
  header[156] = type.charCodeAt(0);
  Buffer.from(linkname, "utf8").copy(header, 157);
  Buffer.from("ustar\u0000", "utf8").copy(header, 257);
  header[263] = 0x30;
  header[264] = 0x30;
  // The checksum is computed with the checksum field treated as spaces.
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const encoded = checksum.toString(8).padStart(6, "0");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeTarSize(header, size) {
  const encoded = size.toString(8).padStart(11, "0");
  header.write(encoded, 124, 11, "ascii");
  header[135] = 0;
}

function writeOctal(header, offset, value) {
  header.write(value.toString(8).padStart(6, "0"), offset, 6, "ascii");
  header[offset + 6] = 0;
  header[offset + 7] = 0x20;
}
