import { expect, test } from "@playwright/test";
import { getMostRelevantEdition } from "../src/lib/content/events";
import { knownLocales } from "../src/lib/content/primitives";
import { getVariantPath } from "../src/lib/content/routes";
import {
  loadPublishedSite,
  publicSiteOrigin,
} from "../src/test/support/published-site";

let site: Awaited<ReturnType<typeof loadPublishedSite>>;

test.beforeAll(async () => {
  site = await loadPublishedSite();
});

test.beforeEach(async ({ page }, testInfo) => {
  // Page wiring is a build contract, not a browser or viewport behavior.
  // Helper and layout tests cover generation and safe serialization separately.
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "structured data only needs one project against the built HTML",
  );
  // Only local HTML matters here; analytics and embeds must not affect it.
  await page.route("https://**/*", (route) => route.abort());
});

test("wires Organization and WebSite data into localized homepages", async ({
  page,
}) => {
  const entity = site.catalog.entities.get("mountain-runners");
  for (const locale of knownLocales) {
    await page.goto(`/${locale}/`);
    const scripts = page.locator('script[type="application/ld+json"]');
    const name = entity?.name[locale];
    await expect(scripts).toHaveCount(name === undefined ? 0 : 2);
    if (name !== undefined) {
      const data = (await scripts.allTextContents()).map((text) =>
        JSON.parse(text),
      );
      expect(data).toEqual([
        expect.objectContaining({
          "@type": "Organization",
          name,
          url: `${publicSiteOrigin()}/`,
        }),
        expect.objectContaining({
          "@type": "WebSite",
          name,
          url: `${publicSiteOrigin()}/`,
        }),
      ]);
    }
  }
});

test("wires Event data only into details with an edition that has not ended", async ({
  page,
}) => {
  for (const variant of site.catalog.variants) {
    const path = getVariantPath(variant);
    await page.goto(path);
    const scripts = page.locator('script[type="application/ld+json"]');
    if (variant.kind === "school") {
      await expect(scripts, path).toHaveCount(0);
      continue;
    }

    const edition = getMostRelevantEdition(variant.entry, site.today);
    if (
      edition === undefined ||
      (edition.endDate ?? edition.startDate) < site.today
    ) {
      await expect(scripts, path).toHaveCount(0);
      continue;
    }

    await expect(scripts, path).toHaveCount(1);
    expect(JSON.parse((await scripts.textContent())!)).toMatchObject({
      "@type": "Event",
      name: variant.entry.title[variant.locale],
      url: `${publicSiteOrigin()}${path}`,
      startDate: edition.startDate,
    });
  }
});

test("omits structured data from hubs, fixed pages and the 404", async ({
  page,
}) => {
  for (const path of [
    "/ca/esdeveniments/",
    "/ca/escoles/",
    "/ca/qui-som/",
    "/404.html",
  ]) {
    await page.goto(path);
    await expect(
      page.locator('script[type="application/ld+json"]'),
      path,
    ).toHaveCount(0);
  }
});
