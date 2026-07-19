import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("renders the localized shell without horizontal overflow", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.endsWith("-mobile");

  await page.goto("/ca/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(page.locator("main#main-content")).toBeVisible();
  await expect(
    page.locator('header a[aria-label="Mountain Runners"] img'),
  ).toBeVisible();
  await expect(page.locator('nav[aria-label="Idioma"]')).toHaveCount(0);

  const skipLink = page.getByRole("link", {
    name: "Vés al contingut principal",
  });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  if (isMobile) {
    const menu = page.locator("header details");
    const summary = menu.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("open", "");
    await expect(
      menu.getByRole("navigation", { name: "Navegació principal" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(menu).not.toHaveAttribute("open", "");
  } else {
    await expect(
      page.locator('header > div > nav[aria-label="Navegació principal"]'),
    ).toBeVisible();
  }

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
    JSON.stringify(layout.overflow),
  ).toBeLessThanOrEqual(layout.clientWidth);
});

test("renders the published homepage sections in order", async ({ page }) => {
  await page.goto("/ca/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Mountain Runners del Berguedà",
    }),
  ).toBeVisible();
  await expect(
    page.locator("main h1, main h2").allTextContents(),
  ).resolves.toEqual([
    "Mountain Runners del Berguedà",
    "Esdeveniments",
    "Escoles",
    "Fes-te MRB",
    "Muntanya, territori, comunitat",
  ]);
  await expect(page.locator('main a[href="/ca/esdeveniments/"]')).toHaveCount(
    1,
  );
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("renders the useful Catalan 404 document", async ({ page }) => {
  await page.goto("/404.html");

  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Pàgina no trobada" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Torna a l'inici" }),
  ).toHaveAttribute("href", "/ca/");
});

test("@a11y has no detectable axe violations", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "axe runs once per viewport");

  for (const path of ["/ca/", "/404.html"]) {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, path).toEqual([]);
  }
});
