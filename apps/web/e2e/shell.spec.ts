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
      name: "A.E. Mountain Runners del Berguedà",
    }),
  ).toBeVisible();
  await expect(page.locator(".homepage-hero__mountain")).toHaveAttribute(
    "src",
    /^\/_astro\//u,
  );
  await expect(
    page.locator("main h1, main h2").allTextContents(),
  ).resolves.toEqual([
    "A.E. Mountain Runners del Berguedà",
    "Agenda d'activitats",
    "Les nostres escoles",
    "Forma part del club",
  ]);
  await expect(page.locator('main a[href="/ca/esdeveniments/"]')).toHaveCount(
    2,
  );
  await expect(page.locator(".homepage-hero__cta")).toHaveAttribute(
    "href",
    "/ca/esdeveniments/",
  );
  await expect(page.locator(".homepage-hero__cta")).toContainText(
    "Descobreix l'agenda",
  );
  await expect(page.locator(".homepage-section__view-all")).toHaveText(
    "Veure tot l'any",
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
  await expect(page.locator(".homepage-school-list img")).toHaveCount(3);
  await expect(
    page.locator(".homepage-school-list strong").allTextContents(),
  ).resolves.toEqual(["Escola de Trail", "Escola Skimo", "Escola BTT"]);
  await expect(
    page.locator(".homepage-school-list__action").allTextContents(),
  ).resolves.toEqual(["Informació", "Informació", "Informació"]);
  await expect(
    page.locator('.homepage-members-banner__cta[href="/ca/socis/"]'),
  ).toHaveCount(1);
  await expect(page.locator(".homepage-members-banner__cta")).toContainText(
    "Fes-te soci",
  );
  await expect(page.locator(".site-header__cta")).toHaveText("Fes-te soci");
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("links the portada to the events hub with published entries", async ({
  page,
}) => {
  await page.goto("/ca/");

  const eventsLink = page.locator(".homepage-section__view-all");
  await expect(eventsLink).toHaveAttribute("href", "/ca/esdeveniments/");
  await expect(eventsLink).toHaveText("Veure tot l'any");

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
  await expect(page.locator(".events-detail__resources")).toHaveCount(0);
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
  await expect(page.locator(".events-detail__resources")).toHaveCount(0);
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
  await expect(page.locator(".events-detail__resources")).toHaveCount(0);
  await expect(
    page.locator('a[aria-disabled="true"], button[disabled]'),
  ).toHaveCount(0);
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("navigates from the header to the About page", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.endsWith("-mobile");
  await page.goto("/ca/");

  if (isMobile) {
    const menu = page.locator("header details");
    await menu.locator("summary").focus();
    await page.keyboard.press("Enter");
  }

  const aboutLink = page
    .locator('header nav a[href="/ca/qui-som/"]')
    .filter({ visible: true });
  await expect(aboutLink).toHaveCount(1);
  await expect(aboutLink).toHaveText("Qui som");

  await aboutLink.click();
  await expect(page).toHaveURL("/ca/qui-som/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
});

test("navigates from the header to the schools hub", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.endsWith("-mobile");
  await page.goto("/ca/");

  if (isMobile) {
    const menu = page.locator("header details");
    await menu.locator("summary").focus();
    await page.keyboard.press("Enter");
  }

  const schoolsLink = page
    .locator('header nav a[href="/ca/escoles/"]')
    .filter({ visible: true });
  await expect(schoolsLink).toHaveCount(1);
  await expect(schoolsLink).toHaveText("Escoles");

  await schoolsLink.click();
  await expect(page).toHaveURL("/ca/escoles/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
});

test("renders the About page sections in editorial order", async ({ page }) => {
  await page.goto("/ca/qui-som/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(
    page.getByRole("heading", { level: 1, name: "Qui som" }),
  ).toBeVisible();
  await expect(
    page.locator("main h1, main h2").allTextContents(),
  ).resolves.toEqual([
    "Qui som",
    "Missatge de presidència",
    "Junta directiva",
    "Història",
    "Estatuts",
  ]);

  const boardPhoto = page.getByRole("img", {
    name: "Junta directiva de Mountain Runners del Berguedà",
  });
  await expect(boardPhoto).toHaveAttribute("src", /^\/_astro\//u);
  await expect(boardPhoto).toHaveAttribute("width", "1024");
  await expect(boardPhoto).toHaveAttribute("height", "768");

  await expect(
    page.locator(
      'section[aria-labelledby="about-president-title"] .about-section__body',
    ),
  ).toContainText("escola de trail");
  await expect(page.getByText("Ernest Garrido", { exact: true })).toHaveCount(
    2,
  );
  await expect(
    page.locator(
      'section[aria-labelledby="about-history-title"] .about-section__body',
    ),
  ).toContainText("número 12637");
  await expect(
    page.locator(
      'main a[href="/content-resources/content-assets/documents/estatuts-mrb.pdf"]',
    ),
  ).toHaveCount(1);
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('a[aria-disabled="true"], button[disabled]'),
  ).toHaveCount(0);
});

test("navigates from the header to the Members page", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.endsWith("-mobile");
  await page.goto("/ca/");

  if (isMobile) {
    const menu = page.locator("header details");
    await menu.locator("summary").focus();
    await page.keyboard.press("Enter");
  }

  const membersLink = page
    .locator('header nav a[href="/ca/socis/"]')
    .filter({ visible: true });
  await expect(membersLink).toHaveCount(1);
  await expect(membersLink).toHaveText("Socis");

  await membersLink.click();
  await expect(page).toHaveURL("/ca/socis/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
});

test("renders the Members page sections in editorial order", async ({
  page,
}) => {
  await page.goto("/ca/socis/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(
    page.getByRole("heading", { level: 1, name: "Socis" }),
  ).toBeVisible();
  const heroImage = page.locator(".page-hero__image");
  await expect(heroImage).toHaveAttribute("src", /^\/_astro\//u);
  await expect(heroImage).toHaveAttribute("alt", "");
  const benefitsPhoto = page.getByRole("img", {
    name: "Fotografia de la secció de socis de Mountain Runners del Berguedà",
  });
  await expect(benefitsPhoto).toHaveAttribute("src", /^\/_astro\//u);
  await expect(benefitsPhoto).toHaveAttribute("width", "1024");
  await expect(benefitsPhoto).toHaveAttribute("height", "768");
  await expect(
    page.locator("main h1, main h2").allTextContents(),
  ).resolves.toEqual([
    "Socis",
    "Alta de socis",
    "Federació",
    "Avantatges per a socis i sòcies",
    "Col·laboradors",
  ]);
  await expect(page.locator("main")).not.toContainText("Properament");

  const signupLink = page.getByRole("link", { name: /Fes-te soci o sòcia/u });
  await expect(signupLink).toHaveCount(1);
  await expect(signupLink).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/Preinscripcio.php",
  );
  const federationLink = page.getByRole("link", { name: /Federa't/u });
  await expect(federationLink).toHaveCount(1);
  await expect(federationLink).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/activitat/30/Llicencies-Federatives-2025/",
  );

  await expect(page.locator(".members-directory__entry")).toHaveCount(22);
  await expect(
    page.locator(".members-directory__name").allTextContents(),
  ).resolves.toEqual([
    "4 Riders Bike Park",
    "Aina Vila",
    "Alexandra Bruy",
    "Bicixtrem",
    "Centre Òptic",
    "CIMETIR",
    "Clínica Jessica Genescà",
    "ELIT",
    "Estètica Adela",
    "Farmàcia Cosp",
    "Intersport Serra Martí",
    "Joieria Climent",
    "Ortopèdia Álvarez Saz Cabra",
    "Pedratour",
    "Peu de Via",
    "Podologia Ingrid Soca",
    "Ramir's Sabaters",
    "Ríos Running Berga",
    "Serrasports",
    "SNOWLOCKERS",
    "Veloberga",
    "Visites al Berguedà",
  ]);
  await expect(
    page.getByRole("img", { name: "Logotip de 4 Riders Bike Park" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /snowlockers\.com/u }),
  ).toHaveAttribute("href", "https://www.snowlockers.com/");
  await expect(page.locator(".members-directory")).toContainText(
    "20% de descompte",
  );
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('a[aria-disabled="true"], button[disabled]'),
  ).toHaveCount(0);
});

test("renders the schools hub in editorial order with links to details", async ({
  page,
}) => {
  await page.goto("/ca/escoles/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(
    page.getByRole("heading", { level: 1, name: "Escoles" }),
  ).toBeVisible();
  await expect(
    page.locator(".schools-hub-item strong").allTextContents(),
  ).resolves.toEqual(["Escola de Trail", "Escola Skimo", "Escola BTT"]);
  await expect(
    page.locator(".schools-hub-item__status").allTextContents(),
  ).resolves.toEqual([
    "Inscripció properament",
    "Inscripció properament",
    "Inscripció properament",
  ]);
  await expect(
    page.locator('.schools-hub-item a[href="/ca/escoles/escola-trail/"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.schools-hub-item a[href="/ca/escoles/escola-skimo/"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.schools-hub-item a[href="/ca/escoles/escola-btt/"]'),
  ).toHaveCount(1);
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("navigates from the schools hub to a published school detail", async ({
  page,
}) => {
  await page.goto("/ca/escoles/");

  await page.getByRole("link", { name: /Escola de Trail/u }).click();

  await expect(page).toHaveURL("/ca/escoles/escola-trail/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(
    page.getByRole("heading", { level: 1, name: "Escola de Trail" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Dos joves corrent per un camí de bosc en una sessió de l'escola de trail",
    }),
  ).toHaveAttribute("width", "389");
  await expect(page.getByText("L'escola va néixer l'any 2012.")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Informació pràctica" }),
  ).toBeVisible();
  await expect(
    page.locator(".schools-detail__practical dt").allTextContents(),
  ).resolves.toEqual([
    "Des de",
    "Objectiu",
    "Per a qui",
    "Horari",
    "Lloc",
    "Preus",
  ]);
  await expect(
    page.getByRole("heading", { level: 2, name: "Galeria" }),
  ).toHaveCount(0);
  await expect(page.getByText("Vídeo properament")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: "Inscripció" }),
  ).toBeVisible();
  await expect(page.getByText("Inscripció properament")).toBeVisible();
  await expect(page.locator("video, iframe")).toHaveCount(0);
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('a[aria-disabled="true"], button[disabled]'),
  ).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
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
    "/ca/qui-som/",
    "/ca/socis/",
    "/ca/escoles/",
    "/ca/escoles/escola-trail/",
    "/ca/contacte/",
    "/ca/documents/",
    "/ca/avis-legal/",
    "/ca/privacitat/",
    "/ca/cookies/",
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

  await page.goto("/ca/escoles/");
  expect(await jsonLd()).toEqual([]);

  await page.goto("/ca/escoles/escola-trail/");
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
    "/ca/qui-som/",
    "/ca/socis/",
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
    "A.E. Mountain Runners del Berguedà",
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

  await page.goto("/ca/socis/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://mountainrunners.cat/ca/socis/",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Socis | Mountain Runners",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://mountainrunners.cat/ca/socis/",
  );
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);

  await page.goto("/ca/escoles/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://mountainrunners.cat/ca/escoles/",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Escoles | Mountain Runners",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://mountainrunners.cat/ca/escoles/",
  );

  await page.goto("/ca/escoles/escola-trail/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://mountainrunners.cat/ca/escoles/escola-trail/",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Escola de Trail | Mountain Runners",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://mountainrunners.cat/ca/escoles/escola-trail/",
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
    "https://mountainrunners.cat/ca/qui-som/",
    "https://mountainrunners.cat/ca/socis/",
    "https://mountainrunners.cat/ca/escoles/",
    "https://mountainrunners.cat/ca/escoles/escola-trail/",
    "https://mountainrunners.cat/ca/escoles/escola-skimo/",
    "https://mountainrunners.cat/ca/escoles/escola-btt/",
    "https://mountainrunners.cat/ca/contacte/",
    "https://mountainrunners.cat/ca/documents/",
    "https://mountainrunners.cat/ca/avis-legal/",
    "https://mountainrunners.cat/ca/privacitat/",
    "https://mountainrunners.cat/ca/cookies/",
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
    "/ca/qui-som/",
    "/ca/socis/",
    "/ca/escoles/",
    "/ca/escoles/escola-trail/",
    "/ca/contacte/",
    "/ca/documents/",
    "/ca/avis-legal/",
    "/ca/privacitat/",
    "/ca/cookies/",
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

test("publishes documents, contact and legal routes from the footer", async ({
  page,
}) => {
  const footerLinks = [
    "/ca/contacte/",
    "/ca/documents/",
    "/ca/avis-legal/",
    "/ca/privacitat/",
    "/ca/cookies/",
  ];

  await page.goto("/ca/");
  for (const path of footerLinks) {
    await expect(page.locator(`footer a[href="${path}"]`)).toHaveCount(1);
  }

  await page.goto("/ca/contacte/");
  await expect(page.locator("main h1")).toHaveText("Contacte");
  await expect(page.locator("main")).toContainText(
    "Plaça Sant Joan, 15 baixos, 08600 Berga",
  );
  await expect(page.locator("main")).toContainText(
    "De dilluns a divendres, de 18 h a 20 h",
  );
  await expect(page.locator("main")).toContainText("G63999817");
  await expect(
    page.locator('main a[href="mailto:info@mountainrunners.cat"]'),
  ).toHaveCount(1);
  await expect(page.locator('main a[href="tel:+34938213747"]')).toHaveCount(1);
  await expect(page.locator('main a[href="tel:+34691910774"]')).toHaveCount(1);
  await expect(page.locator("main")).toContainText(
    "El servei de butlletí encara no està disponible.",
  );
  await expect(page.locator("main input")).toHaveCount(0);

  await page.goto("/ca/documents/");
  await expect(page.locator("main h1")).toHaveText("Documents");
  await expect(page.locator("main")).toContainText("Normativa");
  await expect(page.locator('main a[href*="estatuts-mrb.pdf"]')).toHaveCount(1);
  await expect(page.locator("main")).toContainText("Guia del club");
  await expect(page.locator("main")).toContainText(
    "Temporalment no disponible",
  );
  await expect(page.locator('main a[href*="club-guide.pdf"]')).toHaveCount(0);
  await expect(page.locator("main")).toContainText("Data");
  await expect(page.locator("main")).toContainText("15 de juliol del 2026");
  await expect(page.locator("main")).toContainText("Idioma");
  await expect(page.locator("main")).toContainText("Català");

  await page.goto("/ca/avis-legal/");
  await expect(page.locator("main h1")).toHaveText("Avís legal");
  await expect(page.locator("main")).toContainText(
    "Associació Esportiva Mountain Runners del Berguedà",
  );
  await expect(page.locator("main")).toContainText("Cens d'organitzadors");

  await page.goto("/ca/privacitat/");
  await expect(page.locator("main h1")).toHaveText("Política de privacitat");
  await expect(page.locator("main")).toContainText(
    "Responsable del tractament",
  );

  await page.goto("/ca/cookies/");
  await expect(page.locator("main h1")).toHaveText("Política de cookies");
  await expect(page.locator("main")).toContainText(
    "Quines cookies utilitza aquest web",
  );
  await expect(page.locator("main")).toContainText("Consentiment i banner");

  // None of the new fixed routes may emit empty anchors, placeholder hashes
  // or disabled controls, mirroring the criteria of the other fixed pages.
  for (const path of footerLinks) {
    await page.goto(path);
    await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('a[aria-disabled="true"], button[disabled]'),
    ).toHaveCount(0);
  }
});
