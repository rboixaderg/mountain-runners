import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { PostVariant } from "../src/lib/content/posts";
import {
  getDomainPath,
  getFixedPagePath,
  getVariantPath,
} from "../src/lib/content/routes";
import { loadPublishedPostVariants } from "../src/test/support/publication-catalog";
import {
  loadPublishedSite,
  type PublishedSite,
} from "../src/test/support/published-site";

// Automated accessibility audits over a representative sample: one route per
// template and per published state variant, plus the error document. The
// routes are derived from the catalog, so a renamed hub or a new fixed page
// that keeps the same template never needs this file edited; a new template or
// a new data state does.
//
// The functional and overflow matrix (shell.spec.ts and route-matrix.spec.ts)
// keeps sweeping every published route in every locale and in the other
// browsers. Repeating axe over dozens of entries that render the same template
// re-analyses identical markup without covering a new state, which is why this
// suite is the only place that runs axe.

let site: PublishedSite;
let postVariants: PostVariant[];

test.beforeAll(async () => {
  [site, postVariants] = await Promise.all([
    loadPublishedSite("ca"),
    loadPublishedPostVariants(),
  ]);
});

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "axe audits run on Chromium desktop and mobile only",
);

function representativeRoutes(): string[] {
  const locale = site.locale;

  // One school detail per registration state: open, coming-soon, closed and
  // unavailable render different controls and explanatory text.
  const schoolByState = new Map<string, string>();
  for (const { href, school } of site.orderedSchools) {
    if (!schoolByState.has(school.registrationStatus)) {
      schoolByState.set(school.registrationStatus, href);
    }
  }

  // One event detail per publication state: an upcoming edition, an active
  // event without an announced date and a closed history.
  const eventByState = [
    site.eventHubGroups.upcoming[0],
    site.eventHubGroups["active-without-date"][0],
    site.eventHubGroups.past[0],
  ].flatMap((entry) => (entry === undefined ? [] : [entry.href]));

  // One post detail from a template that ships both editorial types; the
  // open-state dialogue is audited separately below.
  const postDetail = postVariants.find(
    (variant) => variant.locale === locale && variant.entry.published,
  );

  return [
    "/404.html",
    `/${locale}/`,
    getDomainPath("event", locale),
    getDomainPath("school", locale),
    getDomainPath("news", locale),
    ...eventByState,
    ...schoolByState.values(),
    ...(postDetail === undefined ? [] : [getVariantPath(postDetail)]),
    getFixedPagePath("members", locale),
    getFixedPagePath("about", locale),
    getFixedPagePath("documents", locale),
    getFixedPagePath("legal-notice", locale),
    getFixedPagePath("legal-privacy", locale),
    getFixedPagePath("legal-cookies", locale),
  ];
}

test("@a11y has no detectable axe violations on the representative templates", async ({
  page,
}) => {
  test.slow();

  const violationsByRoute: string[] = [];
  for (const path of representativeRoutes()) {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
    for (const violation of results.violations) {
      violationsByRoute.push(`${path}: ${violation.id}`);
    }
  }

  expect(violationsByRoute).toEqual([]);
});

test("@a11y keeps the enlarged image dialog usable while it is open", async ({
  page,
}) => {
  const zoomablePost = postVariants.find(
    (variant) =>
      variant.locale === site.locale &&
      variant.entry.published &&
      variant.entry.sections.some(
        (section) => (section.images?.length ?? 0) > 0,
      ),
  );
  if (zoomablePost === undefined) {
    test.skip(
      true,
      "no published post renders a zoomable section image in this build",
    );
    return;
  }

  await page.goto(getVariantPath(zoomablePost));

  // The dialog is a modal state of the post template, so it is audited with the
  // control it opens from instead of only in its closed state.
  await page
    .getByRole("link", { name: /Amplia la imatge: /u })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Imatge ampliada" });
  await expect(dialog).toBeVisible();

  const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
  expect(results.violations).toEqual([]);
});
