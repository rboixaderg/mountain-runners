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
  const heroImage = page.getByRole("img", {
    name: "Logotip de Mountain Runners del Berguedà",
  });
  await expect(heroImage).toHaveAttribute("src", /^\/_astro\//u);
  await expect(heroImage).toHaveAttribute("width", "450");
  await expect(heroImage).toHaveAttribute("height", "444");
  await expect(page.locator(".homepage-hero__mountain")).toHaveAttribute(
    "src",
    /^\/_astro\//u,
  );
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
  await expect(page.locator(".homepage-event")).toHaveCount(2);
  await expect(
    page.locator(".homepage-event h3").allTextContents(),
  ).resolves.toEqual(["Ultra Pirineu", "Escalada Popular a Queralt"]);
  await expect(
    page.locator(".homepage-event__status").allTextContents(),
  ).resolves.toEqual(["Pròxima edició", "Sense pròxima data anunciada"]);
  await expect(
    page.getByRole("heading", { level: 3, name: "Ultra Pirineu" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Escalada Popular a Queralt",
    }),
  ).toBeVisible();
  await expect(page.locator(".homepage-events")).not.toContainText(
    "Berga Trail",
  );
  await expect(page.locator(".homepage-school-list small")).toHaveCount(3);
  await expect(page.locator(".homepage-school-list img")).toHaveCount(3);
  await expect(page.locator(".homepage-school-list")).toContainText(
    "Properament",
  );
  await expect(
    page.locator(".homepage-school-list a, .homepage-members-card a"),
  ).toHaveCount(0);
  await expect(
    page.locator(".homepage-members-card .homepage-coming-soon"),
  ).toHaveText("Properament");
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("links the portada to the events hub with published entries", async ({
  page,
}) => {
  await page.goto("/ca/");

  const eventsLink = page
    .locator(".homepage-section", { hasText: "Esdeveniments" })
    .getByRole("link", { name: "Esdeveniments" });
  await expect(eventsLink).toHaveAttribute("href", "/ca/esdeveniments/");

  await eventsLink.click();
  await expect(page).toHaveURL("/ca/esdeveniments/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("renders the events hub groups in order with links to details", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Esdeveniments" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Pròximes edicions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Vigents sense pròxima data",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Esdeveniments passats" }),
  ).toBeVisible();

  const headings = await page
    .locator(".events-hub-section h2")
    .allTextContents();
  expect(headings).toEqual([
    "Pròximes edicions",
    "Vigents sense pròxima data",
    "Esdeveniments passats",
  ]);

  await expect(
    page.locator(".events-hub-item strong").allTextContents(),
  ).resolves.toEqual([
    "Ultra Pirineu",
    "Escalada Popular a Queralt",
    "Berga Trail",
  ]);
  await expect(
    page.locator('.events-hub-item a[href="/ca/esdeveniments/ultra-pirineu/"]'),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.events-hub-item a[href="/ca/esdeveniments/escalada-queralt/"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator('.events-hub-item a[href="/ca/esdeveniments/berga-trail/"]'),
  ).toHaveCount(1);
  await expect(
    page.locator(
      ".events-hub-section--active-without-date .events-hub-item__date",
    ),
  ).toHaveAttribute("aria-hidden", "true");
  await expect(
    page.locator(
      ".events-hub-section--active-without-date .events-hub-item__status",
    ),
  ).toHaveText("Sense pròxima data anunciada");
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("navigates from the hub to an event detail with its states", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");

  await page.getByRole("link", { name: /Ultra Pirineu/u }).click();

  await expect(page).toHaveURL("/ca/esdeveniments/ultra-pirineu/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ultra Pirineu" }),
  ).toBeVisible();
  const coverImage = page.getByRole("img", {
    name: "Logotip de Mountain Runners del Berguedà",
  });
  await expect(coverImage).toHaveAttribute(
    "src",
    "/content-resources/assets/logo_mountain_runners.png",
  );
  await expect(coverImage).toHaveAttribute("width", "450");
  await expect(coverImage).toHaveAttribute("height", "444");
  await expect(page.locator("time[datetime='2026-10-02']")).toBeVisible();
  await expect(page.locator("time[datetime='2026-10-04']")).toBeVisible();
  await expect(page.getByText("Bagà", { exact: true })).toBeVisible();
  await expect(page.getByText("Inscripció tancada")).toBeVisible();
  await expect(page.locator(".events-detail__resources")).toContainText(
    "Recurs no disponible",
  );
  await expect(page.getByRole("link", { name: /Inscriu-t'hi/u })).toHaveCount(
    0,
  );
  await expect(
    page.locator('a[aria-disabled="true"], button[disabled]'),
  ).toHaveCount(0);
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("renders the historical event detail without an action", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/berga-trail/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Berga Trail" }),
  ).toBeVisible();
  await expect(page.getByText("Esdeveniment oficial del club")).toBeVisible();
  await expect(page.getByText("Històric", { exact: true })).toBeVisible();
  await expect(page.getByText("Inscripció tancada")).toBeVisible();
  await expect(page.locator(".events-detail__resources")).toContainText(
    "Recurs no disponible",
  );
  await expect(page.getByRole("link", { name: /Inscriu-t'hi/u })).toHaveCount(
    0,
  );
  await expect(
    page.locator('a[aria-disabled="true"], button[disabled]'),
  ).toHaveCount(0);
});

test("renders the active event detail without an announced date", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/escalada-queralt/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Escalada Popular a Queralt",
    }),
  ).toBeVisible();
  await expect(page.getByText("Esdeveniment oficial del club")).toBeVisible();
  await expect(page.getByText("Actiu", { exact: true })).toBeVisible();
  await expect(page.getByText("Sense pròxima data anunciada")).toBeVisible();
  await expect(page.getByText("Inscripció tancada")).toBeVisible();
  await expect(page.locator(".events-detail__resources")).toContainText(
    "Recurs no disponible",
  );
  await expect(
    page.locator('a[aria-disabled="true"], button[disabled]'),
  ).toHaveCount(0);
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

  for (const path of [
    "/ca/",
    "/404.html",
    "/ca/esdeveniments/",
    "/ca/esdeveniments/ultra-pirineu/",
    "/ca/esdeveniments/berga-trail/",
    "/ca/esdeveniments/escalada-queralt/",
  ]) {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, path).toEqual([]);
  }
});

test("publishes structured data only on pages with reviewed data", async ({
  page,
}) => {
  const jsonLd = async () =>
    page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) =>
        scripts.map((script) => JSON.parse(script.textContent ?? "null")),
      );

  await page.goto("/ca/");
  const homeData = await jsonLd();
  expect(homeData).toHaveLength(2);
  expect(homeData[0]).toMatchObject({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Mountain Runners del Berguedà",
    url: "https://mountainrunners.cat/",
  });
  expect(homeData[1]).toMatchObject({
    "@type": "WebSite",
    url: "https://mountainrunners.cat/",
  });

  await page.goto("/ca/esdeveniments/");
  expect(await jsonLd()).toEqual([]);

  await page.goto("/ca/esdeveniments/ultra-pirineu/");
  const eventData = await jsonLd();
  expect(eventData).toHaveLength(1);
  expect(eventData[0]).toEqual({
    "@context": "https://schema.org",
    "@type": "Event",
    name: "Ultra Pirineu",
    url: "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
    startDate: "2026-10-02",
    endDate: "2026-10-04",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: "Bagà" },
  });

  for (const path of [
    "/ca/esdeveniments/berga-trail/",
    "/ca/esdeveniments/escalada-queralt/",
    "/404.html",
  ]) {
    await page.goto(path);
    expect(await jsonLd(), path).toEqual([]);
  }
});

test("emits canonical and social metadata for published pages", async ({
  page,
}) => {
  await page.goto("/ca/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://mountainrunners.cat/ca/",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Mountain Runners del Berguedà",
  );
  await expect(
    page.locator('meta[property="og:description"]'),
  ).not.toHaveAttribute("content", "");
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "website",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://mountainrunners.cat/ca/",
  );
  // Only Catalan is published: no hreflang alternatives may be advertised.
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);

  await page.goto("/ca/esdeveniments/ultra-pirineu/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Ultra Pirineu | Mountain Runners",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
  );
});

test("serves sitemap and robots aligned with the canonical origin", async ({
  page,
}) => {
  const sitemapResponse = await page.request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBeTruthy();
  const sitemapText = await sitemapResponse.text();
  for (const url of [
    "https://mountainrunners.cat/ca/",
    "https://mountainrunners.cat/ca/esdeveniments/",
    "https://mountainrunners.cat/ca/esdeveniments/berga-trail/",
    "https://mountainrunners.cat/ca/esdeveniments/escalada-queralt/",
    "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
  ]) {
    expect(sitemapText).toContain(`<loc>${url}</loc>`);
  }
  expect(sitemapText).not.toContain("404");

  const robotsResponse = await page.request.get("/robots.txt");
  expect(robotsResponse.ok()).toBeTruthy();
  expect(await robotsResponse.text()).toContain(
    "Sitemap: https://mountainrunners.cat/sitemap.xml",
  );
});

test("has no broken or falsely disabled links within the slice", async ({
  page,
}) => {
  const slicePaths = [
    "/ca/",
    "/ca/esdeveniments/",
    "/ca/esdeveniments/ultra-pirineu/",
    "/ca/esdeveniments/berga-trail/",
    "/ca/esdeveniments/escalada-queralt/",
    "/404.html",
  ];
  const internalHrefs = new Set<string>();
  for (const path of slicePaths) {
    await page.goto(path);
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute("href")),
      );
    for (const href of hrefs) {
      if (href !== null && href.startsWith("/") && !href.startsWith("//")) {
        internalHrefs.add(href);
      }
    }
  }

  expect(internalHrefs.size).toBeGreaterThan(0);
  for (const href of internalHrefs) {
    const response = await page.request.get(
      new URL(href, page.url()).toString(),
    );
    expect(response.ok(), `${href} should be reachable`).toBeTruthy();
  }
});
