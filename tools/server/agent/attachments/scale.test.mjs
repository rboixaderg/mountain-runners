import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
  buildScaleCommand,
  maximumGitObjectBytes,
  maximumScaleOutputBytes,
  needsDownscale,
  scaleImageAttachments,
} from "./scale.mjs";
import { jpegImage, pngImage } from "./test-support/synthetic-images.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-attachment-scale-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return directory;
}

function scaledImage({ width = 2400, height = 1600 } = {}) {
  return {
    type: "jpeg",
    mimeType: "image/jpeg",
    extension: ".jpg",
    width: 3000,
    height: 2000,
    bytes: jpegImage({ width: 3000, height: 2000 }),
    origin: "message",
    output: jpegImage({ width, height }),
  };
}

function stagingDirectoryFrom(command, worktreePath) {
  const match = /node \/work\/(.+scale\.mjs)$/u.exec(command[2]);
  assert.notEqual(match, null);
  return join(worktreePath, match[1].slice(0, -"scale.mjs".length));
}

test("says when an image needs the sandbox", () => {
  assert.equal(needsDownscale({ width: 2400, height: 1600 }), false);
  assert.equal(needsDownscale({ width: 2401, height: 10 }), true);
  assert.equal(needsDownscale({ width: 10, height: 2401 }), true);
  assert.equal(
    needsDownscale({ width: 1200, height: 800, orientation: 1 }),
    false,
  );
  assert.equal(
    needsDownscale({ width: 1200, height: 800, orientation: 6 }),
    true,
    "a rotated photo must reach the sandbox even when it is small",
  );
  assert.equal(
    needsDownscale({
      width: 1200,
      height: 800,
      bytes: Buffer.alloc(maximumGitObjectBytes + 1),
    }),
    true,
    "an image above the Git object budget must be re-encoded",
  );
  assert.equal(
    needsDownscale({
      width: 1200,
      height: 800,
      bytes: Buffer.alloc(maximumGitObjectBytes),
    }),
    false,
  );
});

test("runs the sandbox and keeps the re-validated output", async (context) => {
  const worktreePath = fixture(context);
  const image = scaledImage();
  const commands = [];

  const result = await scaleImageAttachments({
    worktreePath,
    images: [image],
    prepareCommand: "pnpm install --offline",
    execute: async (command) => {
      commands.push(command);
      const staging = stagingDirectoryFrom(command, worktreePath);
      const inputs = readdirSync(join(staging, "in"));
      mkdirSync(join(staging, "out"));
      for (const name of inputs) {
        writeFileSync(join(staging, "out", name), image.output);
      }
      return { exitCode: 0 };
    },
  });

  assert.equal(result.refusal, undefined);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].width, 2400);
  assert.equal(result.images[0].height, 1600);
  assert.deepEqual(result.images[0].bytes, image.output);
  assert.match(commands[0][2], /pnpm install --offline/u);
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
});

test("refuses an output that is still above the long side limit", async (context) => {
  const worktreePath = fixture(context);
  const image = scaledImage({ width: 3000, height: 2000 });

  const result = await scaleImageAttachments({
    worktreePath,
    images: [image],
    execute: async (command) => {
      const staging = stagingDirectoryFrom(command, worktreePath);
      const inputs = readdirSync(join(staging, "in"));
      mkdirSync(join(staging, "out"));
      for (const name of inputs) {
        writeFileSync(join(staging, "out", name), image.output);
      }
      return { exitCode: 0 };
    },
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("refuses a symbolic link as the sandbox output", async (context) => {
  const worktreePath = fixture(context);
  const image = scaledImage();
  const outside = fixture(context);
  writeFileSync(join(outside, "stolen.jpg"), image.output);

  const result = await scaleImageAttachments({
    worktreePath,
    images: [image],
    execute: async (command) => {
      const staging = stagingDirectoryFrom(command, worktreePath);
      readdirSync(join(staging, "in"));
      symlinkSync(outside, join(staging, "out"), "dir");
      return { exitCode: 0 };
    },
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("refuses an attachment directory that the sandbox replaced with a symbolic link", async (context) => {
  const worktreePath = fixture(context);
  const image = scaledImage();
  const outside = fixture(context);

  const result = await scaleImageAttachments({
    worktreePath,
    images: [image],
    execute: async (command) => {
      const staging = stagingDirectoryFrom(command, worktreePath);
      const inputs = readdirSync(join(staging, "in"));
      // A convincing forged tree outside the worktree: the lexical paths of the
      // staging directory still resolve, but only through the new symlink.
      const forgedStaging = join(outside, basename(staging));
      mkdirSync(join(forgedStaging, "out"), { recursive: true });
      for (const name of inputs) {
        writeFileSync(join(forgedStaging, "out", name), image.output);
      }
      rmSync(join(worktreePath, ".agent-attachments"), {
        recursive: true,
        force: true,
      });
      symlinkSync(outside, join(worktreePath, ".agent-attachments"), "dir");
      return { exitCode: 0 };
    },
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("refuses an output above the size bound", async (context) => {
  const worktreePath = fixture(context);
  const image = scaledImage();

  const result = await scaleImageAttachments({
    worktreePath,
    images: [image],
    execute: async (command) => {
      const staging = stagingDirectoryFrom(command, worktreePath);
      const inputs = readdirSync(join(staging, "in"));
      mkdirSync(join(staging, "out"));
      for (const name of inputs) {
        writeFileSync(
          join(staging, "out", name),
          Buffer.alloc(maximumScaleOutputBytes + 1, 1),
        );
      }
      return { exitCode: 0 };
    },
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("refuses the image when the sandbox runs out of time", async (context) => {
  const worktreePath = fixture(context);

  const result = await scaleImageAttachments({
    worktreePath,
    images: [scaledImage()],
    execute: async () => ({ exitCode: 0, timedOut: true }),
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("refuses the image when the sandbox writes no output", async (context) => {
  const worktreePath = fixture(context);

  const result = await scaleImageAttachments({
    worktreePath,
    images: [scaledImage()],
    execute: async () => ({ exitCode: 0 }),
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("refuses the image when the sandbox fails", async (context) => {
  const worktreePath = fixture(context);

  const result = await scaleImageAttachments({
    worktreePath,
    images: [scaledImage()],
    execute: async () => ({ exitCode: 1, stderr: "sharp failed" }),
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("builds a command with the staging script inside the worktree", () => {
  const command = buildScaleCommand({
    worktreePath: "/state/worktrees/topic-0123456789abcdef",
    stagingDirectory:
      "/state/worktrees/topic-0123456789abcdef/.agent-attachments/.scaling-1",
    prepareCommand: "pnpm install --offline",
  });

  assert.deepEqual(command.slice(0, 2), ["bash", "-lc"]);
  assert.match(command[2], /\.agent-attachments\/\.scaling-1\/scale\.mjs$/u);
});

test("never lets a trailing slash on the worktree corrupt the script path", () => {
  const command = buildScaleCommand({
    worktreePath: "/state/worktrees/topic-0123456789abcdef/",
    stagingDirectory:
      "/state/worktrees/topic-0123456789abcdef/.agent-attachments/.scaling-1",
  });

  assert.match(
    command[2],
    /node \/work\/\.agent-attachments\/\.scaling-1\/scale\.mjs$/u,
  );
});

test("stages the orientation of every image for the sandbox", async (context) => {
  const worktreePath = fixture(context);
  const images = [
    { ...scaledImage(), orientation: 6 },
    { ...scaledImage(), orientation: 1 },
    { ...scaledImage(), orientation: 99 },
  ];
  let manifest = null;

  const result = await scaleImageAttachments({
    worktreePath,
    images,
    execute: async (command) => {
      const staging = stagingDirectoryFrom(command, worktreePath);
      manifest = JSON.parse(
        readFileSync(join(staging, "manifest.json"), "utf8"),
      );
      const inputs = readdirSync(join(staging, "in"));
      mkdirSync(join(staging, "out"));
      for (const name of inputs) {
        writeFileSync(join(staging, "out", name), images[0].output);
      }
      return { exitCode: 0 };
    },
  });

  assert.equal(result.refusal, undefined);
  assert.deepEqual(manifest, [
    { name: "scale-0.jpg", orientation: 6 },
    { name: "scale-1.jpg", orientation: 1 },
    { name: "scale-2.jpg", orientation: 1 },
  ]);
});

test("refuses an output above the Git object budget", async (context) => {
  const worktreePath = fixture(context);
  const image = scaledImage();
  const oversized = jpegImage({
    width: 2400,
    height: 1600,
    metadata: Array.from({ length: 33 }, () => ({
      marker: 0xee,
      data: Buffer.alloc(65000),
    })),
  });
  assert.ok(oversized.length > maximumGitObjectBytes);

  const result = await scaleImageAttachments({
    worktreePath,
    images: [image],
    execute: async (command) => {
      const staging = stagingDirectoryFrom(command, worktreePath);
      const inputs = readdirSync(join(staging, "in"));
      mkdirSync(join(staging, "out"));
      for (const name of inputs) {
        writeFileSync(join(staging, "out", name), oversized);
      }
      return { exitCode: 0 };
    },
  });

  assert.equal(result.refusal.reason, "scale_failed");
});

test("keeps a PNG image type when downscaling", async (context) => {
  const worktreePath = fixture(context);
  const image = {
    type: "png",
    mimeType: "image/png",
    extension: ".png",
    width: 3000,
    height: 2000,
    bytes: pngImage({ width: 3000, height: 2000 }),
    origin: "message",
  };
  const output = pngImage({ width: 2400, height: 1600 });

  const result = await scaleImageAttachments({
    worktreePath,
    images: [image],
    execute: async (command) => {
      const staging = stagingDirectoryFrom(command, worktreePath);
      const inputs = readdirSync(join(staging, "in"));
      mkdirSync(join(staging, "out"));
      for (const name of inputs) {
        writeFileSync(join(staging, "out", name), output);
      }
      return { exitCode: 0 };
    },
  });

  assert.equal(result.images[0].type, "png");
  assert.equal(result.images[0].width, 2400);
});
