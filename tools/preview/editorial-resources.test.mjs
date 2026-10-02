import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import { listRegularFiles } from "../release/packaging.mjs";

const appDirectory = fileURLToPath(new URL("../../apps/web/", import.meta.url));

test("editorial resources stay isolated across clean builds and preview-to-public rebuilds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "news-blog-resources-"));
  const app = join(directory, "web");
  try {
    await cp(appDirectory, app, {
      recursive: true,
      filter: (source) =>
        !/(?:^|\/)(?:node_modules|dist|\.astro|\.env[^/]*)(?:\/|$)/u.test(
          source,
        ),
    });
    await symlink(
      join(appDirectory, "node_modules"),
      join(app, "node_modules"),
      "dir",
    );
    await mkdir(join(app, "src/content-assets/posts"), { recursive: true });
    // Real, distinct image bytes; these fixtures never enter the real content tree.
    const image = await readFile(
      join(appDirectory, "src/assets/logo_mountain_runners.png"),
    );
    for (const name of ["published", "draft", "shared"]) {
      await writeFile(
        join(app, `src/content-assets/posts/${name}.png`),
        Buffer.concat([image, Buffer.from(name)]),
      );
    }
    for (const [id, published, resource] of [
      ["published", true, "published"],
      ["draft", false, "draft"],
      ["shared-public", true, "shared"],
      ["shared-draft", false, "shared"],
    ]) {
      const post = {
        id,
        type: "news",
        published,
        slug: { ca: id },
        title: { ca: id },
        summary: { ca: id },
        lead: { ca: id },
        sections: [],
        author: { type: "organization", name: "Fixture" },
        createdAt: "2026-10-02",
        ...(published ? { publishedAt: "2026-10-02T10:00:00Z" } : {}),
        cover: {
          resource: {
            kind: "local",
            path: `src/content-assets/posts/${resource}.png`,
          },
          alt: { ca: id },
          attribution: { ca: "Fixture" },
        },
      };
      // JSON is an accepted subset of the restricted YAML parser.
      await writeFile(
        join(app, `src/content/posts/${id}.yaml`),
        JSON.stringify(post),
      );
    }
    async function build(preview) {
      for (const command of [
        ["scripts/generate-paraglide.mjs"],
        [join(appDirectory, "node_modules/astro/bin/astro.mjs"), "build"],
        ["scripts/verify-i18n-output.mjs"],
      ]) {
        const result = spawnSync(process.execPath, command, {
          cwd: app,
          encoding: "utf8",
          env: {
            ...process.env,
            PUBLIC_PREVIEW: String(preview),
            PUBLIC_SITE_ORIGIN: preview
              ? "https://pr-999.preview.mountainrunners.cat"
              : "https://mountainrunners.cat",
            BUILD_TODAY: "2026-10-02",
          },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
      }
      const dist = join(app, "dist");
      const files = await listRegularFiles(dist, dist);
      const snapshots = await Promise.all(
        files.map(async (file) => [
          file.relativePath,
          createHash("sha256")
            .update(await readFile(file.absolutePath))
            .digest("hex"),
        ]),
      );
      return snapshots.sort(([left], [right]) => left.localeCompare(right));
    }
    const publicOutput = await build(false);
    const resource = (name) =>
      `content-resources/content-assets/posts/${name}.png`;
    assert.ok(publicOutput.some(([path]) => path === resource("published")));
    assert.ok(publicOutput.some(([path]) => path === resource("shared")));
    assert.ok(!publicOutput.some(([path]) => path === resource("draft")));
    assert.ok(!publicOutput.some(([path]) => path.startsWith("_astro/draft.")));
    for (const width of [480, 1200]) {
      const derivative = (name) =>
        `editorial-images/${width}/content-assets/posts/${name}.png.webp`;
      assert.ok(
        publicOutput.some(([path]) => path === derivative("published")),
      );
      assert.ok(publicOutput.some(([path]) => path === derivative("shared")));
      assert.ok(!publicOutput.some(([path]) => path === derivative("draft")));
      const bytes = await readFile(join(app, "dist", derivative("published")));
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    }
    await rm(join(app, "dist"), { recursive: true });
    assert.deepEqual(await build(false), publicOutput);
    const previewOutput = await build(true);
    assert.ok(previewOutput.some(([path]) => path === resource("draft")));
    assert.ok(
      previewOutput.some(
        ([path]) =>
          path === "editorial-images/480/content-assets/posts/draft.png.webp",
      ),
    );
    assert.deepEqual(await build(false), publicOutput);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
