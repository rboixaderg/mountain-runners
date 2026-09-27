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
      `https://pr-99.preview.mountainrunners.cat/${locale}/`,
    );
    await expect(page.locator('script[src*="plausible"]')).toHaveCount(0);
  }
});

test("preview robots file blocks crawlers", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
});
