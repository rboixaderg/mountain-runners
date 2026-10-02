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
import { createRequire } from "node:module";
import { listRegularFiles } from "../release/packaging.mjs";

const appDirectory = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const sharp = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("sharp");

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
    // Distinct pixels ensure an unexpected hashed derivative cannot look shared.
    const colors = { published: "red", draft: "blue", shared: "green" };
    const draftDigests = new Set();
    for (const [name, background] of Object.entries(colors)) {
      const image = await sharp({
        create: { width: 1600, height: 900, channels: 3, background },
      })
        .png()
        .toBuffer();
      await writeFile(join(app, `src/content-assets/posts/${name}.png`), image);
      if (name === "draft") {
        draftDigests.add(createHash("sha256").update(image).digest("hex"));
        for (const width of [480, 1200]) {
          const derivative = await sharp(image)
            .autoOrient()
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
          draftDigests.add(
            createHash("sha256").update(derivative).digest("hex"),
          );
        }
      }
    }
    for (const [id, published, resource, type = "news"] of [
      ["published", true, "published"],
      ["published-blog", true, "published", "blog"],
      ["draft", false, "draft"],
      ["shared-public", true, "shared"],
      ["shared-draft", false, "shared"],
    ]) {
      const localized = (value) =>
        id === "published"
          ? { ca: value, es: `ES ${value}`, en: `EN ${value}` }
          : { ca: value };
      const post = {
        id,
        type,
        published,
        slug:
          id === "published"
            ? { ca: id, es: "publicado", en: id }
            : { ca: id, es: `parcial-${id}` },
        title: localized(id),
        summary: localized(id),
        lead: localized(published ? id : `UNPUBLISHED_POST_FIXTURE_${id}`),
        sections: [],
        author: { type: "organization", name: "Fixture" },
        createdAt: "2026-10-02",
        ...(published ? { publishedAt: "2026-10-02T10:00:00Z" } : {}),
        cover: {
          resource: {
            kind: "local",
            path: `src/content-assets/posts/${resource}.png`,
          },
          alt: localized(id),
          attribution: localized("Fixture"),
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
      const publishedDetail = await readFile(
        join(dist, "ca/noticies/published/index.html"),
        "utf8",
      );
      assert.ok(publishedDetail.includes('datetime="2026-10-02T10:00:00Z"'));
      assert.ok(
        publishedDetail.includes(
          "editorial-images/480/content-assets/posts/published.png.webp",
        ),
      );
      assert.ok(
        publishedDetail.includes('property="og:type" content="article"'),
      );
      assert.ok(publishedDetail.includes('hreflang="ca"'));
      assert.ok(publishedDetail.includes('hreflang="es"'));
      const spanishDetail = await readFile(
        join(dist, "es/noticias/publicado/index.html"),
        "utf8",
      );
      assert.ok(spanishDetail.includes('<html lang="es">'));
      assert.ok(spanishDetail.includes("ES published"));
      const blogDetail = await readFile(
        join(dist, "ca/blog/published-blog/index.html"),
        "utf8",
      );
      assert.ok(blogDetail.includes('"@type":"BlogPosting"'));
      assert.ok(!blogDetail.includes('hreflang="es"'));
      const sitemap = await readFile(join(dist, "sitemap.xml"), "utf8");
      assert.ok(sitemap.includes("/ca/noticies/published/"));
      assert.ok(!sitemap.includes("/ca/noticies/draft/"));
      const scripts = [
        ...publishedDetail.matchAll(
          /<script type="application\/ld\+json">(.*?)<\/script>/gu,
        ),
      ];
      assert.equal(JSON.parse(scripts[0][1])["@type"], "NewsArticle");
      if (preview) {
        const draftDetail = await readFile(
          join(dist, "ca/noticies/draft/index.html"),
          "utf8",
        );
        assert.ok(
          draftDetail.includes("Esborrany · No publicat a la web pública"),
        );
        assert.ok(draftDetail.includes("pendent de revisió"));
        assert.ok(!draftDetail.includes('type="application/ld+json"'));
        assert.ok(
          draftDetail.includes('name="robots" content="noindex, nofollow"'),
        );
      }
      const files = await listRegularFiles(dist, dist);
      assert.ok(
        !files.some(
          ({ relativePath }) =>
            relativePath === "es/blog/parcial-published-blog/index.html",
        ),
      );
      const snapshots = await Promise.all(
        files.map(async (file) => [
          file.relativePath,
          createHash("sha256")
            .update(await readFile(file.absolutePath))
            .digest("hex"),
        ]),
      );
      if (!preview) {
        assert.ok(
          !files.some(
            ({ relativePath }) =>
              relativePath === "ca/noticies/draft/index.html",
          ),
        );
        for (const file of files) {
          const bytes = await readFile(file.absolutePath);
          assert.ok(
            !bytes.toString("utf8").includes("UNPUBLISHED_POST_FIXTURE_"),
            file.relativePath,
          );
        }
        assert.ok(!snapshots.some(([, digest]) => draftDigests.has(digest)));
      }
      return snapshots.sort(([left], [right]) => left.localeCompare(right));
    }
    const publicOutput = await build(false);
    const resource = (name) =>
      `content-resources/content-assets/posts/${name}.png`;
    assert.ok(!publicOutput.some(([path]) => path === resource("published")));
    assert.ok(!publicOutput.some(([path]) => path === resource("shared")));
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
    assert.ok(!previewOutput.some(([path]) => path === resource("draft")));
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
