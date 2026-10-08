/* global document, innerWidth, window -- Used only inside Playwright's browser evaluation. */
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
import { chromium, firefox, webkit } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const appDirectory = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const requireFromApp = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const sharp = requireFromApp("sharp");
const { JSDOM } = requireFromApp("jsdom");

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
    // Synthetic publication states must not depend on real editorial approvals.
    await rm(join(app, "src/content/posts"), { recursive: true });
    await mkdir(join(app, "src/content/posts"), { recursive: true });
    await mkdir(join(app, "src/content-assets/posts"), { recursive: true });
    // Distinct pixels ensure an unexpected hashed derivative cannot look shared.
    const colors = {
      published: "red",
      draft: "blue",
      shared: "green",
      "section-draft": "purple",
      "section-public": "orange",
    };
    const draftDigests = new Set();
    for (const [name, background] of Object.entries(colors)) {
      const image = await sharp({
        create: { width: 1600, height: 900, channels: 3, background },
      })
        .png()
        .toBuffer();
      await writeFile(join(app, `src/content-assets/posts/${name}.png`), image);
      if (name === "draft" || name === "section-draft") {
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
      ["optional-translations", true, "published", "blog"],
      ["draft", false, "draft"],
      ["shared-public", true, "shared"],
      ["shared-draft", false, "shared"],
    ]) {
      const localized = (value) =>
        ["published", "published-blog", "optional-translations"].includes(id)
          ? { ca: value, es: `ES ${value}`, en: `EN ${value}` }
          : { ca: value };
      const post = {
        id,
        type,
        published,
        slug:
          id === "published"
            ? { ca: id, es: "publicado", en: "published-news" }
            : { ca: id, es: `parcial-${id}` },
        title: localized(id),
        summary: localized(id),
        lead: localized(published ? id : `UNPUBLISHED_POST_FIXTURE_${id}`),
        sections: [],
        author: { type: "organization", name: "Fixture" },
        ...(id === "published-blog" || id === "optional-translations"
          ? {
              relatedPage: "members",
              updatedAt: "2026-10-02T12:00:00Z",
              sources: [
                {
                  name: { ca: "Font documental de prova" },
                  url: "https://example.org/source",
                },
              ],
              relatedEventIds: ["anella-verda"],
            }
          : {}),
        createdAt: "2026-10-02",
        ...(published ? { publishedAt: "2026-10-02T10:00:00Z" } : {}),
        cover: {
          resource: {
            kind: "local",
            path: `src/content-assets/posts/${resource}.png`,
          },
          alt: id === "optional-translations" ? { ca: id } : localized(id),
          attribution:
            id === "optional-translations"
              ? { ca: "Fixture" }
              : localized("Fixture"),
        },
      };
      const sectionImage = (name, label) => ({
        resource: {
          kind: "local",
          path: `src/content-assets/posts/${name}.png`,
        },
        alt: id === "published-blog" ? { ca: label } : localized(label),
        attribution: localized("Fixture"),
        caption: localized(label),
      });
      post.sections =
        id === "optional-translations"
          ? []
          : [
              {
                heading: localized("Primer pas"),
                body: localized(
                  "Explicació del primer pas\n\n1. Comprovació numerada\n2. Segona comprovació\n\n- Punt de prova\n- Segon punt\n\n[Font de prova](https://example.org/)",
                ),
                images: [
                  sectionImage(
                    published ? "section-public" : "section-draft",
                    "Primera pantalla",
                  ),
                ],
              },
              {
                heading: localized("Text sol"),
                body: localized("Una secció sense imatges"),
              },
              {
                heading: localized("Segon pas"),
                body: localized("Explicació del segon pas"),
                images: [
                  sectionImage("shared", "Segona pantalla"),
                  sectionImage("shared", "Detall de pantalla"),
                ],
              },
            ];
      // JSON is an accepted subset of the restricted YAML parser.
      await writeFile(
        join(app, `src/content/posts/${id}.yaml`),
        JSON.stringify(post),
      );
    }
    async function build(preview) {
      const origin = preview
        ? "https://pr-999.preview.mountainrunners.cat"
        : "https://mountainrunners.cat";
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
            PUBLIC_SITE_ORIGIN: origin,
            BUILD_TODAY: "2026-10-02",
          },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
      }
      const dist = join(app, "dist");
      for (const locale of ["ca", "es", "en"]) {
        const homepage = new JSDOM(
          await readFile(join(dist, locale, "index.html"), "utf8"),
        ).window.document;
        const titles = [...homepage.querySelectorAll("main section")]
          .find((section) =>
            [
              "Actualitat del club",
              "Actualidad del club",
              "Club updates",
            ].includes(section.querySelector("h2")?.textContent.trim()),
          )
          .querySelectorAll("h3");
        const publishedTitles = {
          ca: [
            "optional-translations",
            "published",
            "published-blog",
            "shared-public",
          ],
          es: ["ES optional-translations", "ES published"],
          en: ["EN published"],
        }[locale];
        assert.deepEqual(
          [...titles]
            .slice(0, publishedTitles.length)
            .map((heading) => heading.textContent.trim()),
          publishedTitles,
        );
        assert.equal(
          titles.length,
          preview && locale === "ca" ? 6 : publishedTitles.length,
        );
      }
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
      const newsPaths = {
        ca: "/ca/noticies/published/",
        es: "/es/noticias/publicado/",
        en: "/en/news/published-news/",
      };
      const socialImageUrl = `${origin}/editorial-images/1200/content-assets/posts/published.png.webp`;
      for (const [locale, path] of Object.entries(newsPaths)) {
        const html = await readFile(join(dist, path, "index.html"), "utf8");
        const { document } = new JSDOM(html).window;
        assert.equal(document.documentElement.lang, locale);
        assert.equal(
          document.querySelector("article h1").textContent.trim(),
          { ca: "published", es: "ES published", en: "EN published" }[locale],
        );
        assert.equal(
          document.querySelector('link[rel="canonical"]').getAttribute("href"),
          `${origin}${path}`,
        );
        assert.equal(
          document
            .querySelector('meta[property="og:url"]')
            .getAttribute("content"),
          `${origin}${path}`,
        );
        assert.deepEqual(
          [...document.querySelectorAll('link[rel="alternate"]')]
            .map((link) => ({
              locale: link.getAttribute("hreflang"),
              href: link.getAttribute("href"),
            }))
            .sort((left, right) => left.locale.localeCompare(right.locale)),
          [
            { locale: "ca", href: `${origin}/ca/noticies/published/` },
            { locale: "en", href: `${origin}/en/news/published-news/` },
            { locale: "es", href: `${origin}/es/noticias/publicado/` },
            { locale: "x-default", href: `${origin}/ca/noticies/published/` },
          ],
        );
        assert.equal(
          document
            .querySelector('meta[property="og:image"]')
            .getAttribute("content"),
          socialImageUrl,
        );
        const structuredData = JSON.parse(
          document.querySelector('script[type="application/ld+json"]')
            .textContent,
        );
        assert.equal(structuredData.mainEntityOfPage, `${origin}${path}`);
        assert.equal(structuredData.image, socialImageUrl);
      }
      for (const [locale, slug] of [
        ["ca", "optional-translations"],
        ["es", "parcial-optional-translations"],
      ]) {
        const html = await readFile(
          join(dist, locale, "blog", slug, "index.html"),
          "utf8",
        );
        const { document } = new JSDOM(html).window;
        const article = document.querySelector("article");
        const hasOptionals = locale === "ca";
        assert.equal(document.documentElement.lang, locale);
        assert.equal(
          article.querySelectorAll("figure").length,
          hasOptionals ? 1 : 0,
        );
        assert.equal(
          article.querySelector('section[aria-labelledby="post-sources"]') !==
            null,
          hasOptionals,
        );
        assert.equal(
          article.textContent.includes("Font documental de prova"),
          hasOptionals,
        );
        assert.equal(
          article.querySelector('a[href="https://example.org/source"]') !==
            null,
          hasOptionals,
        );
        assert.equal(
          document
            .querySelector('meta[property="og:image"]')
            ?.getAttribute("content") ?? null,
          hasOptionals ? socialImageUrl : null,
        );
        assert.equal(
          document
            .querySelector('meta[property="og:image:alt"]')
            ?.getAttribute("content") ?? null,
          hasOptionals ? "optional-translations" : null,
        );
        const structuredData = JSON.parse(
          document.querySelector('script[type="application/ld+json"]')
            .textContent,
        );
        assert.equal(
          structuredData.image,
          hasOptionals ? socialImageUrl : undefined,
        );
      }
      const blogDetail = await readFile(
        join(dist, "ca/blog/published-blog/index.html"),
        "utf8",
      );
      assert.ok(blogDetail.includes('"@type":"BlogPosting"'));
      assert.ok(!blogDetail.includes('hreflang="es"'));
      assert.ok(blogDetail.includes('alt="Primera pantalla" loading="lazy"'));
      assert.ok(blogDetail.includes("section-public.png.webp"));
      if (preview) {
        assert.ok(!publishedDetail.includes('name="mr-analytics-page-type"'));
        assert.ok(!blogDetail.includes('name="mr-analytics-page-type"'));
        assert.ok(!blogDetail.includes('src="/js/plausible-events.js"'));
      } else {
        assert.ok(publishedDetail.includes('content="news_detail"'));
        assert.ok(blogDetail.includes('content="blog_detail"'));
      }
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
    for (const [path, content, message] of [
      [
        "ca/noticies/draft/index.html",
        "<!doctype html><title>Unexpected draft route</title>",
        "Unselected HTML routes reached the build output",
      ],
      [
        "unexpected-marker.txt",
        "UNPUBLISHED_POST_FIXTURE_draft",
        "Unpublished content reached the build output",
      ],
    ]) {
      const file = join(app, "dist", path);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, content);
      try {
        const result = spawnSync(
          process.execPath,
          ["scripts/verify-i18n-output.mjs"],
          {
            cwd: app,
            encoding: "utf8",
            env: {
              ...process.env,
              PUBLIC_PREVIEW: "false",
              PUBLIC_SITE_ORIGIN: "https://mountainrunners.cat",
            },
          },
        );
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(result.stderr.includes(message), result.stderr);
      } finally {
        await rm(file);
      }
    }
    // Exercise the actual built CSS and HTML, without adding synthetic content
    // to the editorial collection in the real worktree.
    for (const browserType of [chromium, firefox, webkit]) {
      const browser = await browserType.launch();
      try {
        for (const width of [1280, 320]) {
          const context = await browser.newContext({
            viewport: { width, height: 720 },
          });
          const page = await context.newPage();
          await context.addInitScript(() => {
            window.__analyticsEvents = [];
            window.plausible = Object.assign(
              (name, options) => {
                window.__analyticsEvents.push({ name, ...options });
              },
              { l: true, init() {} },
            );
          });
          await page.route("**/*", async (route) => {
            const url = new URL(route.request().url());
            if (url.hostname !== "editorial.test") return route.abort();
            const pathname = url.pathname.endsWith("/")
              ? `${url.pathname}index.html`
              : url.pathname;
            const contentTypes = {
              ".html": "text/html",
              ".css": "text/css",
              ".js": "application/javascript",
              ".webp": "image/webp",
              ".woff2": "font/woff2",
            };
            const extension = pathname.slice(pathname.lastIndexOf("."));
            await route.fulfill({
              body: await readFile(join(app, "dist", pathname)),
              contentType:
                contentTypes[extension] ?? "application/octet-stream",
            });
          });
          await page.goto("https://editorial.test/ca/blog/published-blog/");
          const sourceLink = page
            .getByRole("region", { name: "Fonts", exact: true })
            .getByRole("link", {
              name: "Font documental de prova",
              exact: true,
            });
          assert.equal(
            await sourceLink.getAttribute("href"),
            "https://example.org/source",
          );
          const relatedEventLink = page
            .getByRole("region", {
              name: "Esdeveniments relacionats",
              exact: true,
            })
            .getByRole("link", { name: "Anella Verda", exact: true });
          assert.equal(
            await relatedEventLink.getAttribute("href"),
            "/ca/esdeveniments/anella-verda/",
          );
          assert.equal(
            await relatedEventLink.getAttribute("data-analytics-target"),
            "anella-verda",
          );
          assert.equal(
            await page
              .getByText("Publicat el 2 d’octubre del 2026", { exact: true })
              .count(),
            1,
          );
          assert.equal(
            await page
              .getByText("Actualitzat el 2 d’octubre del 2026", { exact: true })
              .count(),
            1,
          );
          assert.deepEqual(
            await page.evaluate(() =>
              window.__analyticsEvents.filter(
                ({ name }) => name === "UI Action",
              ),
            ),
            [],
          );
          const firstHeading = await page
            .getByRole("heading", { name: "Primer pas", exact: true })
            .boundingBox();
          const firstImage = await page
            .getByRole("img", { name: "Primera pantalla", exact: true })
            .boundingBox();
          const secondHeading = await page
            .getByRole("heading", { name: "Segon pas", exact: true })
            .boundingBox();
          const secondImage = await page
            .getByRole("img", { name: "Segona pantalla", exact: true })
            .boundingBox();
          if (width === 1280) {
            assert.ok(firstImage.x + firstImage.width <= firstHeading.x);
            assert.ok(secondHeading.x + secondHeading.width <= secondImage.x);
          } else {
            assert.ok(firstHeading.y + firstHeading.height <= firstImage.y);
            assert.ok(secondHeading.y + secondHeading.height <= secondImage.y);
          }
          assert.equal(
            await page
              .getByRole("heading", { name: "Text sol", exact: true })
              .locator("xpath=ancestor::section[1]")
              .getByRole("img")
              .count(),
            0,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          const article = page.getByRole("article");
          const orderedList = article
            .getByRole("list")
            .filter({ hasText: "Comprovació numerada" });
          const unorderedList = article
            .getByRole("list")
            .filter({ hasText: "Punt de prova" });
          assert.equal(
            await orderedList.evaluate(
              (element) =>
                element.ownerDocument.defaultView.getComputedStyle(element)
                  .listStyleType,
            ),
            "decimal",
          );
          assert.equal(
            await unorderedList.evaluate(
              (element) =>
                element.ownerDocument.defaultView.getComputedStyle(element)
                  .listStyleType,
            ),
            "disc",
          );
          assert.ok(
            (
              await article
                .getByRole("link", { name: "Font de prova" })
                .evaluate(
                  (element) =>
                    element.ownerDocument.defaultView.getComputedStyle(element)
                      .textDecorationLine,
                )
            ).includes("underline"),
          );
          if (browserType === chromium) {
            const results = await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze();
            assert.deepEqual(results.violations, []);
            for (const [hub, title, area, pageType, target] of [
              [
                "/ca/blog/",
                "published-blog",
                "blog_hub",
                "blog_hub",
                "published-blog",
              ],
              [
                "/es/noticias/",
                "ES published",
                "news_hub",
                "news_hub",
                "published",
              ],
            ]) {
              await page.goto(`https://editorial.test${hub}`);
              await page.evaluate(() =>
                document.addEventListener(
                  "click",
                  (event) => event.preventDefault(),
                  { once: true },
                ),
              );
              await page
                .getByRole("link", { name: title, exact: true })
                .click();
              const events = await page.evaluate(
                () => window.__analyticsEvents,
              );
              assert.deepEqual(
                events.filter(({ name }) => name === "UI Action"),
                [
                  {
                    name: "UI Action",
                    props: {
                      action: "navigate",
                      area,
                      locale: hub.startsWith("/es/") ? "es" : "ca",
                      page_type: pageType,
                      route: hub,
                      target,
                    },
                  },
                ],
              );
            }
            await page.goto("https://editorial.test/ca/blog/published-blog/");
            await page.evaluate(() =>
              document.addEventListener(
                "click",
                (event) => event.preventDefault(),
                { once: true },
              ),
            );
            const membersLink = page.getByRole("link", {
              name: "Ves a la pàgina de Socis",
              exact: true,
            });
            await membersLink.focus();
            await membersLink.press("Enter");
            assert.deepEqual(
              await page.evaluate(() =>
                window.__analyticsEvents.filter(
                  ({ name }) => name === "UI Action",
                ),
              ),
              [
                {
                  name: "UI Action",
                  props: {
                    action: "navigate",
                    area: "post_resources",
                    locale: "ca",
                    page_type: "blog_detail",
                    route: "/ca/blog/published-blog/",
                    target: "members",
                  },
                },
              ],
            );
          }
          await page.goto("https://editorial.test/ca/noticies/published/");
          for (const name of ["Fonts", "Esdeveniments relacionats"]) {
            assert.equal(
              await page.getByRole("region", { name, exact: true }).count(),
              0,
            );
          }
          assert.equal(
            await page
              .getByRole("link", {
                name: "Ves a la pàgina de Socis",
                exact: true,
              })
              .count(),
            0,
          );
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }
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
      assert.ok(
        publicOutput.some(([path]) => path === derivative("section-public")),
      );
      assert.ok(
        !publicOutput.some(([path]) => path === derivative("section-draft")),
      );
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
    assert.ok(
      previewOutput.some(
        ([path]) =>
          path ===
          "editorial-images/480/content-assets/posts/section-draft.png.webp",
      ),
    );
    assert.deepEqual(await build(false), publicOutput);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
