import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { plausibleScriptSrc } from "../src/lib/analytics/plausible";

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
  await expect(page.locator('nav[aria-label="Idioma"]')).toHaveCount(2);

  const skipLink = page.getByRole("link", {
    name: "Vés al contingut principal",
  });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  if (isMobile) {
    const menu = page.locator("header details.site-header__mobile-menu");
    const summary = menu.locator(":scope > summary");
    await summary.click();
    await expect(menu).toHaveAttribute("open", "");
    await expect(
      menu.getByRole("navigation", { name: "Navegació principal" }),
    ).toBeVisible();
    const panelIsHittable = await page.evaluate(() => {
      const panel = document.querySelector(".site-header__mobile-panel");
      if (!(panel instanceof HTMLElement)) {
        return false;
      }
      const rect = panel.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + 24,
      );
      return Boolean(hit?.closest(".site-header__mobile-panel"));
    });
    expect(panelIsHittable).toBe(true);
    await summary.click();
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

test("loads the Plausible analytics script asynchronously", async ({
  page,
}) => {
  await page.goto("/ca/");
  const plausibleScript = page.locator(`script[src="${plausibleScriptSrc}"]`);
  await expect(plausibleScript).toHaveCount(1);
  await expect(plausibleScript).toHaveAttribute("async", "");
  await expect(page.locator('script[src="/js/plausible-init.js"]')).toHaveCount(
    1,
  );
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
    "Les nostres escoles",
    "Forma part del club",
    "Agenda d'activitats",
  ]);
  await expect(page.locator('main a[href="/ca/esdeveniments/"]')).toHaveCount(
    1,
  );
  await expect(page.locator(".homepage-hero__cta")).toHaveCount(2);
  await expect(page.locator(".homepage-join-cta")).toHaveCount(1);
  await expect(
    page.locator(".homepage-hero__actions .homepage-join-cta"),
  ).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/Preinscripcio.php",
  );
  await expect(
    page.locator(".homepage-hero__actions .homepage-join-cta"),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.locator(".homepage-members-banner__action"),
  ).toHaveAttribute("href", "/ca/socis/");
  await expect(page.locator(".homepage-members-banner__action")).toContainText(
    "Veure més informació",
  );
  await expect(
    page.locator('.homepage-hero__cta[href="/ca/escoles/"]'),
  ).toContainText("Les nostres escoles");
  await expect(
    page.locator(".homepage-hero__actions .homepage-hero__cta").last(),
  ).toContainText("Federa't amb nosaltres");
  await expect(
    page.locator(".homepage-hero__actions .homepage-hero__cta").last(),
  ).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/PanellActivitatsWebNou.php?SELECCIO_NIVELL=4",
  );
  await expect(
    page.locator(".homepage-hero__actions .homepage-hero__cta").last(),
  ).toHaveAttribute("target", "_blank");
  await expect(page.locator(".homepage-section__view-all")).toHaveText(
    "Veure tot l'any",
  );
  await expect(page.locator(".homepage-event")).toHaveCount(8);
  await expect(
    page.locator(".homepage-event h3").allTextContents(),
  ).resolves.toEqual([
    "Escalada de Vilada a Castell de l'Areny",
    "Ultra Pirineu",
    "Llobregat x la Diabetis",
    "Cros de Queralt",
    "Minivolta a la Maria",
    "Escalada Popular a Queralt",
    "Les Clàssiques de Berga",
    "Quina Berguedana",
  ]);
  await expect(
    page.locator(".homepage-event__status").allTextContents(),
  ).resolves.toEqual([
    "Pròxima edició",
    "Pròxima edició",
    "Pròxima edició",
    "Pròxima edició",
    "Pròxima edició",
    "Sense pròxima data anunciada",
    "Sense pròxima data anunciada",
    "Sense pròxima data anunciada",
  ]);
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Escalada de Vilada a Castell de l'Areny",
    }),
  ).toBeVisible();
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
  await expect(page.locator(".site-header__cta")).toHaveText("Fes-te soci");
  await expect(page.locator(".site-header__cta")).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/Preinscripcio.php",
  );
  await expect(page.locator(".site-header__cta")).toHaveAttribute(
    "target",
    "_blank",
  );
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
  const heroImage = page.locator(".page-hero__image");
  await expect(heroImage).toHaveAttribute("src", /^\/_astro\//u);
  await expect(heroImage).toHaveAttribute("width", "960");
  await expect(heroImage).toHaveAttribute("height", "641");
  await expect(heroImage).toHaveAttribute("alt", "");
  await expect(page.locator(".page-hero__attribution")).toHaveText(
    "Arxiu: Mountain Runners del Berguedà",
  );
  await expect(
    page.getByRole("heading", { level: 2, name: "Calendari mensual" }),
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
    .locator(".events-hub-section h2, .events-calendar h2")
    .allTextContents();
  expect(headings).toEqual([
    "Calendari mensual",
    "Pròximes edicions",
    "Vigents sense pròxima data",
    "Esdeveniments passats",
  ]);

  await expect(
    page.locator(".homepage-event h3").allTextContents(),
  ).resolves.toEqual([
    "Escalada de Vilada a Castell de l'Areny",
    "Ultra Pirineu",
    "Llobregat x la Diabetis",
    "Cros de Queralt",
    "Minivolta a la Maria",
  ]);
  await expect(
    page.locator(
      '.homepage-event a[href="/ca/esdeveniments/escalada-castell-areny/"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator('.homepage-event a[href="/ca/esdeveniments/ultra-pirineu/"]'),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.homepage-event a[href="/ca/esdeveniments/llobregat-x-la-diabetis/"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.homepage-event a[href="/ca/esdeveniments/cros-de-queralt/"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.homepage-event a[href="/ca/esdeveniments/minivolta-a-la-maria/"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.events-hub-active-item a[href="/ca/esdeveniments/escalada-queralt/"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.events-hub-history__title[href="/ca/esdeveniments/berga-trail/"]',
    ),
  ).toHaveCount(1);
  await expect(page.locator(".events-hub-active-item")).toHaveCount(3);
  await expect(
    page.locator(".events-hub-active-item__status-value").first(),
  ).toHaveText("Sense pròxima data anunciada");
  await expect(
    page.locator(".events-calendar__day--has-events"),
  ).not.toHaveCount(0);
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("renders the club attribution for every Skimo gallery photo", async ({
  page,
}) => {
  const localizedRoutes = [
    "/ca/escoles/escola-skimo/",
    "/es/escuelas/escuela-esqui-montana/",
    "/en/schools/ski-mountaineering-school/",
  ];

  for (const localizedRoute of localizedRoutes) {
    await page.goto(localizedRoute);
    const attributions = page.locator(
      ".schools-detail-preview__gallery-list figcaption",
    );
    await expect(attributions).toHaveCount(4);
    for (const attribution of await attributions.all()) {
      await expect(attribution).toContainText("Mountain Runners del Berguedà");
    }
  }
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
  const coverImage = page.locator(".detail-hero__cover img");
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
    page.locator('main a[aria-disabled="true"], main button[disabled]'),
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
    page.locator('main a[aria-disabled="true"], main button[disabled]'),
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
  await expect(page.getByText("Sense data anunciada")).toBeVisible();
  await expect(page.getByText("Inscripció tancada")).toBeVisible();
  await expect(page.locator(".events-detail__resources")).toHaveCount(0);
  await expect(
    page.locator('main a[aria-disabled="true"], main button[disabled]'),
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
    const menu = page.locator("header details.site-header__mobile-menu");
    await menu.locator(":scope > summary").focus();
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
    const menu = page.locator("header details.site-header__mobile-menu");
    await menu.locator(":scope > summary").focus();
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
    "Història",
    "Missatge de presidència",
    "Junta directiva",
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
  await expect(
    page.getByText("Ernest Garrido Ferrer", { exact: true }),
  ).toHaveCount(2);
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
    page.locator('main a[aria-disabled="true"], main button[disabled]'),
  ).toHaveCount(0);
});

test("navigates from the header to the Members page", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.endsWith("-mobile");
  await page.goto("/ca/");

  if (isMobile) {
    const menu = page.locator("header details.site-header__mobile-menu");
    await menu.locator(":scope > summary").focus();
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
  await expect(page.locator(".page-hero__attribution")).toContainText(
    "@about_paulagnf",
  );
  await expect(page.locator(".members-video")).not.toContainText(
    "@about_paulagnf",
  );
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
    "https://mountainrunners.playoffinformatica.com/PanellActivitatsWebNou.php?SELECCIO_NIVELL=4",
  );

  await expect(page.locator(".members-directory__entry")).toHaveCount(21);
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
    page.locator('main a[aria-disabled="true"], main button[disabled]'),
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
    page.getByRole("heading", {
      level: 2,
      name: "Tria l'escola que més s'encaixa a tu!",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Compartim un eix comú, la muntanya."),
  ).toBeVisible();
  await expect(
    page.locator(".schools-hub-item strong").allTextContents(),
  ).resolves.toEqual(["Escola de Trail", "Escola Skimo", "Escola BTT"]);
  await expect(
    page.locator(".schools-hub-item__status").allTextContents(),
  ).resolves.toEqual([
    "Inscripció oberta",
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
  const schoolDetail = page.locator(".schools-detail");
  await expect(
    schoolDetail.getByRole("heading", { level: 1, name: "Escola de Trail" }),
  ).toBeVisible();
  await expect(
    schoolDetail.locator(".schools-detail-preview__about-media-frame img"),
  ).toBeVisible();
  await expect(
    schoolDetail.locator(".schools-detail-preview__about-media-frame img"),
  ).toHaveAttribute("width", "1600");
  await expect(
    schoolDetail.getByRole("heading", { level: 2, name: "Què oferim" }),
  ).toBeVisible();
  await expect(
    schoolDetail.getByText("L'escola pren vida l'any 2012"),
  ).toBeVisible();
  await expect(
    schoolDetail.getByRole("heading", {
      level: 2,
      name: "Informació pràctica",
    }),
  ).toBeVisible();
  await expect(
    schoolDetail.getByText(
      "Horaris, ubicació, preus i requisits per planificar la temporada amb tranquil·litat.",
    ),
  ).toBeVisible();
  await expect(
    schoolDetail.locator(".schools-detail-preview__practical-card"),
  ).toHaveCount(5);
  await expect(
    schoolDetail.locator(".schools-detail-preview__prices"),
  ).toHaveCount(1);
  await expect(
    schoolDetail
      .locator(
        ".schools-detail-preview__practical-grid--essentials .schools-detail-preview__practical-card-title",
      )
      .allTextContents(),
  ).resolves.toEqual(["Horari", "Lloc", "Per a qui"]);
  await expect(
    schoolDetail
      .locator(
        ".schools-detail-preview__practical-grid--context .schools-detail-preview__practical-card-title",
      )
      .allTextContents(),
  ).resolves.toEqual(["Des de", "Objectiu"]);
  await expect(
    schoolDetail.getByRole("heading", { level: 3, name: "Preus" }),
  ).toBeVisible();
  await expect(
    schoolDetail.getByText("dilluns, dimecres i divendres"),
  ).toBeVisible();
  await expect(schoolDetail.getByText("17.30 h a 19.00 h")).toBeVisible();
  await expect(
    schoolDetail.getByRole("heading", { level: 4, name: "Matrícula" }),
  ).toBeVisible();
  await expect(schoolDetail.getByText("35 €")).toBeVisible();
  await expect(schoolDetail.getByText("al mes").first()).toBeVisible();
  await expect(
    schoolDetail.getByRole("heading", { level: 2, name: "Galeria" }),
  ).toBeVisible();
  await expect(
    schoolDetail.locator(".schools-detail-preview__gallery-item img"),
  ).toHaveCount(6);
  await expect(
    schoolDetail.getByRole("heading", { level: 2, name: "Vídeo" }),
  ).toBeVisible();
  await expect(schoolDetail.locator("iframe")).toHaveCount(1);
  await expect(
    schoolDetail.getByRole("heading", { level: 2, name: "Inscripció" }),
  ).toBeVisible();
  await expect(schoolDetail.getByText("Inscripció oberta")).toBeVisible();
  const registrationLink = schoolDetail.getByRole("link", {
    name: "Inscriu-t'hi",
  });
  await expect(registrationLink).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/preinscripcio/5/Alta-Escola-Trail/",
  );
  await expect(registrationLink).toHaveAttribute("target", "_blank");
  await expect(registrationLink).not.toContainText("playoffinformatica");
  const registrationLinkOverflow = await registrationLink.evaluate(
    (element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      right: element.getBoundingClientRect().right,
      viewportWidth: document.documentElement.clientWidth,
    }),
  );
  expect(registrationLinkOverflow.scrollWidth).toBeLessThanOrEqual(
    registrationLinkOverflow.clientWidth,
  );
  expect(registrationLinkOverflow.right).toBeLessThanOrEqual(
    registrationLinkOverflow.viewportWidth,
  );
  await expect(
    schoolDetail.getByText("Uneix-te a la família Mountain Runners."),
  ).toBeVisible();
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('main a[aria-disabled="true"], main button[disabled]'),
  ).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

// Presses Tab until the target element receives keyboard focus, proving the
// element sits on the sequential focus order and is reachable with the
// keyboard alone. Bounded so a regression that removes the target from the
// tab order fails fast instead of looping forever.
async function tabUntilFocused(page: Page, target: Locator) {
  await expect(target).toHaveCount(1);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await page.keyboard.press("Tab");
    const reached = await target.evaluate(
      (element) => element === document.activeElement,
    );
    if (reached) return;
  }
  throw new Error("Keyboard focus never reached the target element");
}

test("renders the board and the unavailable states without fake controls", async ({
  page,
}) => {
  // The board is a labelled region read in document order: its heading and
  // its members are reachable without any interaction, and it adds no link.
  await page.goto("/ca/qui-som/");
  const board = page.locator('section[aria-labelledby="about-board-title"]');
  await expect(
    board.getByRole("heading", { name: "Junta directiva" }),
  ).toBeVisible();
  await expect(board).toContainText("Ernest Garrido Ferrer");
  await expect(board.getByRole("link")).toHaveCount(0);

  // The unavailable school registration state is textual: it explains the
  // state without adding anything to the focus order, so the keyboard can
  // never land on a fake control.
  await page.goto("/ca/escoles/escola-skimo/");
  const registration = page.locator(
    'section[aria-labelledby="school-registration-title"]',
  );
  await expect(registration).toContainText("Inscripció properament");
  await expect(
    registration.locator("a, button, input, [tabindex]"),
  ).toHaveCount(0);

  await expect(
    page.getByRole("heading", { level: 3, name: "Preus" }),
  ).toBeVisible();
  await expect(page.getByText("550 €")).toBeVisible();
  await expect(page.getByText("60 €")).toBeVisible();
  await expect(page.getByText("30 €")).toBeVisible();
  await expect(
    page.getByText("80 € (inclou tràmits d'inscripció"),
  ).toBeVisible();

  await page.goto("/ca/escoles/escola-btt/");
  await expect(
    page.getByRole("heading", { level: 3, name: "Preus" }),
  ).toBeVisible();
  await expect(page.getByText("640 €")).toBeVisible();
  await expect(page.getByText("336 €")).toBeVisible();
  await expect(page.getByText("392 €")).toBeVisible();
  await expect(
    page.getByText("També hi ha la possibilitat d'inscriure't per trimestres"),
  ).toBeVisible();
});

test("reaches and activates the available actions with the keyboard", async ({
  browserName,
  page,
}) => {
  // WebKit only tabs between text fields unless Full Keyboard Access is
  // enabled in the operating system, so the sequential focus order cannot be
  // exercised there. The DOM structure it checks is covered in every browser
  // by the sibling "without fake controls" test.
  test.skip(
    browserName === "webkit",
    "Safari Full Keyboard Access is an OS setting",
  );

  // The statutes document link is reached with Tab alone.
  await page.goto("/ca/qui-som/");
  const statutesLink = page.locator(
    'section[aria-labelledby="about-statutes-title"] a[href*="estatuts-mrb.pdf"]',
  );
  await tabUntilFocused(page, statutesLink);
  await expect(statutesLink).toBeFocused();

  // A published entry link is activated with Enter from the keyboard.
  await page.goto("/ca/esdeveniments/");
  const eventLink = page.getByRole("link", { name: /Ultra Pirineu/u });
  await tabUntilFocused(page, eventLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/ca/esdeveniments/ultra-pirineu/");

  // The available members actions stay on the focus order with their
  // reviewed hrefs, so the keyboard can reach both of them.
  await page.goto("/ca/socis/");
  const signupLink = page.getByRole("link", { name: /Fes-te soci o sòcia/u });
  await tabUntilFocused(page, signupLink);
  await expect(signupLink).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/Preinscripcio.php",
  );
  const federationLink = page.getByRole("link", { name: /Federa't/u });
  await tabUntilFocused(page, federationLink);
  await expect(federationLink).toHaveAttribute(
    "href",
    "https://mountainrunners.playoffinformatica.com/PanellActivitatsWebNou.php?SELECCIO_NIVELL=4",
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
    "/ca/esdeveniments/anella-verda/",
    "/ca/esdeveniments/berga-trail/",
    "/ca/esdeveniments/cros-de-queralt/",
    "/ca/esdeveniments/escalada-castell-areny/",
    "/ca/esdeveniments/escalada-queralt/",
    "/ca/esdeveniments/les-classiques-de-berga/",
    "/ca/esdeveniments/llobregat-x-la-diabetis/",
    "/ca/esdeveniments/minivolta-a-la-maria/",
    "/ca/esdeveniments/quina-berguedana/",
    "/ca/qui-som/",
    "/ca/socis/",
    "/ca/escoles/",
    "/ca/escoles/escola-trail/",
    "/ca/documents/",
    "/ca/avis-legal/",
    "/ca/privacitat/",
    "/ca/cookies/",
  ]) {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
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
  expect(homeData[0]).toEqual({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Mountain Runners del Berguedà",
    url: "https://mountainrunners.cat/",
    logo: "https://mountainrunners.cat/content-resources/assets/logo_mountain_runners.png",
    sameAs: [
      "https://www.instagram.com/infomountain/",
      "https://www.strava.com/clubs/156769",
    ],
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
    description:
      "És una cursa de muntanya que recorre part de la serralada del Cadí-Moixeró.",
    image:
      "https://mountainrunners.cat/content-resources/assets/logo_mountain_runners.png",
  });

  await page.goto("/ca/esdeveniments/escalada-castell-areny/");
  const castellArenyData = await jsonLd();
  expect(castellArenyData).toHaveLength(1);
  expect(castellArenyData[0]).toEqual({
    "@context": "https://schema.org",
    "@type": "Event",
    name: "Escalada de Vilada a Castell de l'Areny",
    url: "https://mountainrunners.cat/ca/esdeveniments/escalada-castell-areny/",
    startDate: "2026-08-16",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: "Zona Esportiva de Vilada" },
    description:
      "Cronoescalada de la Lliga d'escalades del Berguedà, de Vilada a Castell de l'Areny.",
    image:
      "https://mountainrunners.cat/content-resources/assets/events/escalada-castell-areny-cover.jpg",
  });

  await page.goto("/ca/esdeveniments/llobregat-x-la-diabetis/");
  const llobregatData = await jsonLd();
  expect(llobregatData).toHaveLength(1);
  expect(llobregatData[0]).toEqual({
    "@context": "https://schema.org",
    "@type": "Event",
    name: "Llobregat x la Diabetis",
    url: "https://mountainrunners.cat/ca/esdeveniments/llobregat-x-la-diabetis/",
    startDate: "2026-10-16",
    endDate: "2026-10-18",
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "Place",
      name: "Castellar de n'Hug — El Prat de Llobregat",
    },
    description:
      "Repte solidari de 180 km pel riu Llobregat, de Castellar de n'Hug al Prat, a favor de la recerca en diabetis tipus 1.",
    image:
      "https://mountainrunners.cat/content-resources/assets/events/llobregat-x-la-diabetis-cover.png",
  });

  await page.goto("/ca/esdeveniments/cros-de-queralt/");
  const crosData = await jsonLd();
  expect(crosData).toHaveLength(1);
  expect(crosData[0]).toEqual({
    "@context": "https://schema.org",
    "@type": "Event",
    name: "Cros de Queralt",
    url: "https://mountainrunners.cat/ca/esdeveniments/cros-de-queralt/",
    startDate: "2026-10-18",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: "Santuari de Queralt, Berga" },
    description:
      "La prova de Berga del Cros Escolar del Berguedà, a l'entorn del Santuari de Queralt, amb la col·laboració de Mountain Runners.",
    image:
      "https://mountainrunners.cat/content-resources/assets/logo_mountain_runners.png",
  });

  await page.goto("/ca/esdeveniments/minivolta-a-la-maria/");
  const minivoltaData = await jsonLd();
  expect(minivoltaData).toHaveLength(1);
  expect(minivoltaData[0]).toEqual({
    "@context": "https://schema.org",
    "@type": "Event",
    name: "Minivolta a la Maria",
    url: "https://mountainrunners.cat/ca/esdeveniments/minivolta-a-la-maria/",
    startDate: "2026-11-15",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: "Avià" },
    description:
      "La cursa infantil de la Volta a la Maria, la cursa de muntanya d'Avià, organitzada per Mountain Runners del Berguedà.",
    image:
      "https://mountainrunners.cat/content-resources/assets/logo_mountain_runners.png",
  });

  for (const path of [
    "/ca/esdeveniments/anella-verda/",
    "/ca/esdeveniments/berga-trail/",
    "/ca/esdeveniments/escalada-queralt/",
    "/ca/esdeveniments/les-classiques-de-berga/",
    "/ca/esdeveniments/quina-berguedana/",
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
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Associació esportiva del Berguedà dedicada a la muntanya: escoles de trail, skimo i BTT, esdeveniments i valors d'esforç, constància i respecte per la natura.",
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    "Associació esportiva del Berguedà dedicada a la muntanya: escoles de trail, skimo i BTT, esdeveniments i valors d'esforç, constància i respecte per la natura.",
  );
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "website",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://mountainrunners.cat/ca/",
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "ca_ES",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /^https:\/\/mountainrunners\.cat\/_astro\/homepage-hero.*\.jpeg$/u,
  );
  await expect(
    page.locator('link[rel="alternate"][hreflang="x-default"]'),
  ).toHaveAttribute("href", "https://mountainrunners.cat/ca/");
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(4);

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
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(4);

  await page.goto("/ca/escoles/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://mountainrunners.cat/ca/escoles/",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Escoles | Mountain Runners",
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Escoles de trail, skimo i BTT per a infants i joves al Berguedà, en horari no lectiu i amb els valors de l'esport i la muntanya.",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /^https:\/\/mountainrunners\.cat\/_astro\/schools-hub-hero/u,
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
    "https://mountainrunners.cat/ca/esdeveniments/anella-verda/",
    "https://mountainrunners.cat/ca/esdeveniments/berga-trail/",
    "https://mountainrunners.cat/ca/esdeveniments/escalada-castell-areny/",
    "https://mountainrunners.cat/ca/esdeveniments/escalada-queralt/",
    "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
    "https://mountainrunners.cat/ca/qui-som/",
    "https://mountainrunners.cat/ca/socis/",
    "https://mountainrunners.cat/ca/escoles/",
    "https://mountainrunners.cat/ca/escoles/escola-trail/",
    "https://mountainrunners.cat/ca/escoles/escola-skimo/",
    "https://mountainrunners.cat/ca/escoles/escola-btt/",
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
    "/ca/esdeveniments/anella-verda/",
    "/ca/esdeveniments/berga-trail/",
    "/ca/esdeveniments/cros-de-queralt/",
    "/ca/esdeveniments/escalada-castell-areny/",
    "/ca/esdeveniments/escalada-queralt/",
    "/ca/esdeveniments/les-classiques-de-berga/",
    "/ca/esdeveniments/llobregat-x-la-diabetis/",
    "/ca/esdeveniments/minivolta-a-la-maria/",
    "/ca/esdeveniments/quina-berguedana/",
    "/ca/qui-som/",
    "/ca/socis/",
    "/ca/escoles/",
    "/ca/escoles/escola-trail/",
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

test("publishes documents and legal routes from the footer", async ({
  page,
}) => {
  const footerLinks = [
    "/ca/documents/",
    "/ca/avis-legal/",
    "/ca/privacitat/",
    "/ca/cookies/",
  ];

  await page.goto("/ca/");
  for (const path of footerLinks) {
    await expect(page.locator(`footer a[href="${path}"]`)).toHaveCount(1);
  }
  await expect(page.locator('footer a[href="/ca/contacte/"]')).toHaveCount(0);
  await expect(
    page.locator('footer a[href="https://www.instagram.com/infomountain/"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('footer a[href="https://www.strava.com/clubs/156769"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Xarxes socials" }),
  ).toBeVisible();
  await expect(
    page.locator('.site-prefooter a[href="mailto:info@mountainrunners.cat"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.site-prefooter a[href="tel:+34938213747"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.site-prefooter a[href="tel:+34691910774"]'),
  ).toHaveCount(1);
  await expect(page.locator(".site-prefooter")).toContainText(
    "De dilluns a divendres, de 18 h a 20 h",
  );
  await expect(page.locator(".site-prefooter")).toContainText(
    "Plaça Sant Joan, 15 baixos, 08600 Berga",
  );
  await expect(page.locator(".site-prefooter")).toContainText(
    "El servei de butlletí encara no està disponible.",
  );
  await expect(page.locator('footer a[href^="tel:"]')).toHaveCount(0);
  await expect(
    page.locator('footer a[href="mailto:info@mountainrunners.cat"]'),
  ).toHaveCount(0);

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
  await expect(page.locator("main")).toContainText("Plausible");

  await page.goto("/ca/cookies/");
  await expect(page.locator("main h1")).toHaveText("Política de cookies");
  await expect(page.locator("main")).toContainText(
    "Quines cookies utilitza aquest web",
  );
  await expect(page.locator("main")).toContainText("Consentiment i banner");
  await expect(page.locator("main")).toContainText("Plausible");

  // None of the new fixed routes may emit empty anchors, placeholder hashes
  // or disabled controls, mirroring the criteria of the other fixed pages.
  for (const path of footerLinks) {
    await page.goto(path);
    await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('main a[aria-disabled="true"], main button[disabled]'),
    ).toHaveCount(0);
  }
});
