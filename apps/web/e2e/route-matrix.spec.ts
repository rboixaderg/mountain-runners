// Phase 4 closing matrix (T4.1): sweeps every canonical route published in
// the built sitemap across the three locales, in Chromium desktop and mobile,
// and verifies the representative content states the automated suite can
// determine. It complements the manual reviews recorded in
// docs/validation/phase-4-route-matrix.md and never replaces them.
//
// The sweep reads the sitemap of the deterministic build; `pnpm test:e2e`
// builds first, so the file always describes the artifact under test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const sitemapPath = resolve(process.cwd(), "apps/web/dist/sitemap.xml");
let sitemap: string;
try {
  sitemap = readFileSync(sitemapPath, "utf8");
} catch {
  throw new Error(
    `Missing ${sitemapPath}: the deterministic build must run before the E2E suite.`,
  );
}

const publishedPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)]
  .map((match) => new URL(match[1]).pathname)
  .filter((path) => path !== "/404.html");

if (publishedPaths.length === 0) {
  throw new Error(`The sitemap at ${sitemapPath} contains no routes.`);
}

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "the route sweep covers Chromium desktop and mobile; cross-browser journeys stay in shell.spec.ts",
);

for (const path of publishedPaths) {
  test(`matrix sweep ${path}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(path);
    expect(response?.status(), `${path} responds with 200`).toBe(200);

    const locale = path.slice(1, 3);
    await expect(
      page.locator("html"),
      `${path} declares its locale`,
    ).toHaveAttribute("lang", locale);
    await expect(
      page.locator("main#main-content"),
      `${path} renders the main landmark`,
    ).toBeVisible();
    await expect(
      page.locator("h1"),
      `${path} renders exactly one h1`,
    ).toHaveCount(1);
    await expect(
      page.locator("h1"),
      `${path} renders a non-empty h1`,
    ).not.toHaveText(/^\s*$/u);

    const canonicalHref = `https://mountainrunners.cat${path}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      canonicalHref,
    );
    await expect(
      page.locator(`link[rel="alternate"][hreflang="${locale}"]`),
    ).toHaveAttribute("href", canonicalHref);

    await expect(
      page.locator("nav.language-selector"),
      `${path} offers the language selector in the header and the mobile menu`,
    ).toHaveCount(2);

    const skipLink = page.locator("a.skip-link");
    await skipLink.focus();
    await expect(
      skipLink,
      `${path} keeps the skip link focusable`,
    ).toBeFocused();

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      overflow: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter(({ scrollWidth, clientWidth }) => scrollWidth > clientWidth)
        .map((element) => ({
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          tagName: element.tagName,
        })),
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      layout.scrollWidth,
      `${path} has no horizontal overflow: ${JSON.stringify(layout.overflow)}`,
    ).toBeLessThanOrEqual(layout.clientWidth);

    expect(pageErrors, `${path} raises no page errors`).toEqual([]);
  });
}

test("matrix root document redirects to the Catalan homepage", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://mountainrunners.cat/ca/",
  );
  await expect(page.locator('a[href="/ca/"]')).toHaveCount(1);
});

test("matrix unknown routes serve the 404 document", async ({ page }) => {
  const response = await page.goto("/ca/ruta-inexistent/");
  expect(response?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveCount(1);
});

test("matrix state: active event with a next edition and closed registration", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/ultra-pirineu/");
  await expect(page.locator(".detail-hero__meta")).toContainText("Actiu");
  await expect(page.locator(".events-detail__dates time")).toHaveCount(2);
  await expect(page.locator("main")).toContainText("Inscripció tancada");
  await expect(
    page.getByRole("link", { name: "Més informació a la seva web" }),
  ).toHaveCount(1);
});

test("matrix state: event registration coming soon", async ({ page }) => {
  await page.goto("/ca/esdeveniments/llobregat-x-la-diabetis/");
  await expect(page.locator("main")).toContainText("Inscripció properament");
  await expect(page.getByRole("link", { name: "Inscriu-t'hi" })).toHaveCount(0);
});

test("matrix state: historical event keeps its badge without a registration action", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/anella-verda/");
  await expect(page.locator(".detail-hero__meta")).toContainText("Històric");
  await expect(page.getByRole("link", { name: "Inscriu-t'hi" })).toHaveCount(0);
});

test("matrix state: school with a deferred privacy-enhanced video", async ({
  page,
}) => {
  await page.goto("/ca/escoles/escola-skimo/");
  await expect(
    page.locator(".schools-detail-preview__video-embed"),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.schools-detail-preview__video-embed iframe[src*="youtube-nocookie.com"]',
    ),
  ).toHaveCount(1);
});

test("matrix state: school without video renders no embed", async ({
  page,
}) => {
  await page.goto("/ca/escoles/escola-btt/");
  await expect(page.locator("main iframe")).toHaveCount(0);
});

test("matrix state: unavailable newsletter publishes the disabled preview", async ({
  page,
}) => {
  await page.goto("/ca/");
  const newsletter = page.locator(".site-prefooter__newsletter");
  await expect(newsletter).toContainText(
    "El servei de butlletí encara no està disponible.",
  );
  await expect(newsletter.locator("input")).toBeDisabled();
  await expect(newsletter.locator("button")).toBeDisabled();
  await expect(newsletter.locator("form")).toHaveCount(0);
});
