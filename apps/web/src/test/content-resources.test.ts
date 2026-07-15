import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  localResourcePathSchema,
  resolveLocalResourcePath,
  safeResourceSchema,
} from "../lib/content/resources";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("content resource primitives", () => {
  it.each([
    "src/assets/events/race.webp",
    "src/content-assets/documents/rules.pdf",
  ])("accepts approved local resource %s", (resourcePath) => {
    expect(localResourcePathSchema.parse(resourcePath)).toBe(resourcePath);
  });

  it.each([
    "/src/assets/image.webp",
    "src/assets/../private/image.webp",
    "src/assets/%2e%2e/private.pdf",
    "src\\assets\\image.webp",
    "public/image.webp",
    "src/assets/image.svg",
    "src/assets/page.html",
    "src/assets/image.WEBP",
    "src/assets/image.webp?download=1",
  ])("rejects unsafe local resource %s", (resourcePath) => {
    expect(localResourcePathSchema.safeParse(resourcePath).success).toBe(false);
  });

  it("keeps local and external resources explicit", () => {
    expect(
      safeResourceSchema.parse({
        kind: "local",
        path: "src/assets/events/race.jpg",
      }),
    ).toEqual({ kind: "local", path: "src/assets/events/race.jpg" });

    expect(
      safeResourceSchema.parse({
        kind: "external",
        url: "https://example.com/registration",
      }),
    ).toEqual({
      kind: "external",
      url: "https://example.com/registration",
    });

    expect(
      safeResourceSchema.safeParse({
        kind: "external",
        path: "src/assets/events/race.jpg",
      }).success,
    ).toBe(false);
  });

  it("resolves regular files inside approved roots", async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), "mountain-runners-assets-"),
    );
    temporaryDirectories.push(appDirectory);
    const assetsDirectory = path.join(appDirectory, "src/assets");
    await mkdir(assetsDirectory, { recursive: true });
    await writeFile(path.join(assetsDirectory, "race.pdf"), "fixture");

    await expect(
      resolveLocalResourcePath(appDirectory, "src/assets/race.pdf"),
    ).resolves.toBe(await realpath(path.join(assetsDirectory, "race.pdf")));
  });

  it("rejects files and directories reached through symbolic links", async () => {
    const appDirectory = await mkdtemp(
      path.join(tmpdir(), "mountain-runners-assets-"),
    );
    temporaryDirectories.push(appDirectory);
    const assetsDirectory = path.join(appDirectory, "src/assets");
    const outsideDirectory = path.join(appDirectory, "outside");
    await Promise.all([
      mkdir(assetsDirectory, { recursive: true }),
      mkdir(outsideDirectory, { recursive: true }),
    ]);
    const outsideFile = path.join(outsideDirectory, "private.pdf");
    await writeFile(outsideFile, "private fixture");
    await symlink(outsideFile, path.join(assetsDirectory, "file-link.pdf"));
    await symlink(
      outsideDirectory,
      path.join(assetsDirectory, "directory-link"),
    );

    await expect(
      resolveLocalResourcePath(appDirectory, "src/assets/file-link.pdf"),
    ).rejects.toThrow(/symbolic links/u);
    await expect(
      resolveLocalResourcePath(
        appDirectory,
        "src/assets/directory-link/private.pdf",
      ),
    ).rejects.toThrow(/symbolic links/u);
  });
});
