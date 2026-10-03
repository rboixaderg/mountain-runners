import { expect, test } from "@playwright/test";

test.skip(
  process.env.PUBLIC_PREVIEW !== "true",
  "Only runs against a preview build.",
);

test("preview marks every locale and does not load analytics", async ({
  page,
}) => {
  for (const locale of ["ca", "es", "en"]) {
    await page.goto(`/${locale}/`);
    await expect(page.getByText(/PREVIEW ·/u)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${process.env.PUBLIC_SITE_ORIGIN}/${locale}/`,
    );
    await expect(page.locator('script[src*="plausible"]')).toHaveCount(0);
  }
});

test("preview robots file blocks crawlers", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
});

test("preview notice stays integrated with the sticky header", async ({
  page,
}) => {
  for (const path of [
    "/ca/",
    "/ca/esdeveniments/",
    "/ca/esdeveniments/ultra-pirineu/",
    "/404.html",
  ]) {
    await page.goto(path);
    const header = page.getByRole("banner");
    const notice = header.getByRole("complementary");
    await expect(notice).toContainText("PREVIEW ·");
    await expect(notice).toHaveCSS("background-color", "rgb(253, 224, 71)");
    await expect(notice).toHaveCSS("color", "rgb(17, 17, 17)");

    await page.evaluate(() => window.scrollTo(0, 600));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        notice.evaluate((element) => element.getBoundingClientRect().top),
      )
      .toBe(0);
    await expect
      .poll(() =>
        header.evaluate((element) => element.getBoundingClientRect().top),
      )
      .toBe(0);
  }
});
