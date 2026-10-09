import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { plausibleScriptSrc } from "../src/lib/analytics/plausible";
import { getRegistrationPresentation } from "../src/lib/presentation/status";
import {
  loadPublishedSite,
  publicSiteOrigin,
} from "../src/test/support/published-site";
import * as messages from "../src/paraglide/messages.js";
import { locales } from "../i18n.config.mjs";
import type { Locale } from "../src/lib/content/primitives";
import { openGraphLocales } from "../src/lib/content/seo";

// The expectations below are derived from the content the build publishes, so
// adding an event or a school keeps these tests meaningful instead of failing
// them. What they pin is the editorial contract: which entries a page shows,
// in which region, in which order, and which controls it must never render.
let site: Awaited<ReturnType<typeof loadPublishedSite>>;

test.beforeAll(async () => {
  site = await loadPublishedSite("ca");
});

test.beforeEach(async ({ page }) => {
  // Keep the shell suite independent from the remote analytics host.
  await page.route("https://analytics.rogerbg.cat/**", async (route) => {
    await route.abort();
  });
});

function getMobileMenu(page: Page) {
  return page
    .locator("header details")
    .filter({ has: page.getByText("Menú", { exact: true }) });
}

test("renders the localized shell without horizontal overflow", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.endsWith("-mobile");

  await page.goto("/ca/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Mountain Runners" })
      .locator('img[alt=""]'),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { includeHidden: true, name: "Idioma" }),
  ).toHaveCount(2);

  const skipLink = page.getByRole("link", {
    name: "Vés al contingut principal",
  });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  if (isMobile) {
    const menu = getMobileMenu(page);
    const summary = menu.locator(":scope > summary");
    await summary.click();
    await expect(menu).toHaveAttribute("open", "");
    const mobileNavigation = menu.getByRole("navigation", {
      name: "Navegació principal",
    });
    await expect(mobileNavigation).toBeVisible();
    const panelIsHittable = await mobileNavigation.evaluate((navigation) => {
      const rect = navigation.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + 24,
      );
      return hit !== null && navigation.contains(hit);
    });
    expect(panelIsHittable).toBe(true);
    await summary.click();
    await expect(menu).not.toHaveAttribute("open", "");
  } else {
    await expect(
      page
        .getByRole("navigation", { name: "Navegació principal" })
        .filter({ visible: true }),
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
  await expect(
    page.locator('script[src="/js/plausible-events.js"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('meta[name="mr-analytics-locale"]'),
  ).toHaveAttribute("content", "ca");
});

test("keeps rendering and navigating when Plausible is blocked", async ({
  page,
}) => {
  await page.goto("/ca/");
  await expect(page.getByRole("main")).toBeVisible();

  await page
    .getByRole("link", { name: "Veure més informació" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/ca\/socis\/$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Socis" }),
  ).toBeVisible();
});

test("renders the published homepage sections in order", async ({ page }) => {
  await page.goto("/ca/");

  const main = page.getByRole("main");
  const hero = page.locator("main section:has(h1)");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(hero.locator('img[alt=""]')).toHaveAttribute(
    "src",
    /^\/_astro\//u,
  );
  await expect(main.locator("h2").allTextContents()).resolves.toEqual([
    "Les nostres escoles",
    "Forma part del club",
    "Agenda d'activitats",
    "Actualitat del club",
  ]);
  await expect(main.locator('a[href=""], a[href="#"]')).toHaveCount(0);
});

test("offers the homepage actions with their reviewed destinations", async ({
  page,
}) => {
  await page.goto("/ca/");

  const hero = page.locator("main section:has(h1)");
  await expect(hero.getByRole("link")).toHaveCount(3);

  const signupLink = page
    .getByRole("banner")
    .getByRole("link", { name: "Fes-te soci" });
  await expect(signupLink).toHaveCount(1);
  await expect(signupLink).toHaveAttribute("href", site.memberSignupUrl!);
  await expect(signupLink).toHaveAttribute("target", "_blank");

  const heroSignupLink = hero.getByRole("link", { name: "Fes-te soci" });
  await expect(heroSignupLink).toHaveCount(1);
  await expect(heroSignupLink).toHaveAttribute("href", site.memberSignupUrl!);

  const federationLink = hero.getByRole("link", {
    name: "Federa't amb nosaltres",
  });
  await expect(federationLink).toHaveAttribute("href", site.federationUrl!);
  await expect(federationLink).toHaveAttribute("target", "_blank");

  await expect(
    hero.getByRole("link", { name: "Les nostres escoles" }),
  ).toHaveAttribute("href", "/ca/escoles/");
  await expect(
    page.getByRole("main").getByRole("link", {
      name: "Veure més informació",
      exact: true,
    }),
  ).toHaveAttribute("href", site.membersPath);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Veure tot l'any" }),
  ).toHaveAttribute("href", "/ca/esdeveniments/");
});

test("lists every published homepage event in editorial order", async ({
  page,
}) => {
  await page.goto("/ca/");

  const eventsRegion = page.getByRole("region", {
    name: "Agenda d'activitats",
  });
  const eventCards = eventsRegion.getByRole("article");

  await expect(eventCards).toHaveCount(site.homepageEvents.length);
  await expect(
    eventsRegion.getByRole("heading", { level: 3 }).allTextContents(),
  ).resolves.toEqual(site.homepageEvents.map(({ event }) => event.title.ca));

  for (const [index, { event, href }] of site.homepageEvents.entries()) {
    await expect(eventCards.nth(index).getByRole("link")).toHaveAttribute(
      "href",
      href,
    );
    await expect(
      eventCards.nth(index).getByRole("heading", { name: event.title.ca }),
    ).toBeVisible();
  }

  // The homepage agenda contains only upcoming editions, not active events
  // without an announced date or past events.
  for (const { event } of site.eventHubGroups["active-without-date"]) {
    await expect(eventsRegion).not.toContainText(event.title.ca);
  }
  for (const { event } of site.eventHubGroups.past) {
    await expect(eventsRegion).not.toContainText(event.title.ca);
  }
});

test("shows one school card per published school", async ({ page }) => {
  await page.goto("/ca/");

  const schoolsSection = page.locator("main section").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: "Les nostres escoles",
    }),
  });
  const schoolLinks = schoolsSection.getByRole("link");

  await expect(schoolsSection.locator('img[alt=""]')).toHaveCount(
    site.orderedSchools.length,
  );
  await expect(schoolLinks).toHaveCount(site.orderedSchools.length);
  for (const [index, { school, href }] of site.orderedSchools.entries()) {
    await expect(schoolLinks.nth(index)).toContainText(school.name.ca);
    await expect(schoolLinks.nth(index)).toContainText("Informació");
    await expect(schoolLinks.nth(index)).toHaveAttribute("href", href);
  }
});

test("links the portada to the events hub with published entries", async ({
  page,
}) => {
  await page.goto("/ca/");

  const eventsLink = page.getByRole("link", { name: "Veure tot l'any" });
  await expect(eventsLink).toHaveAttribute("href", "/ca/esdeveniments/");
  await expect(eventsLink).toHaveText("Veure tot l'any");

  await eventsLink.click();
  await expect(page).toHaveURL("/ca/esdeveniments/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("renders the events hub groups in editorial order", async ({ page }) => {
  await page.goto("/ca/esdeveniments/");

  const hero = page.locator("main section:has(h1)");
  await expect(hero.locator('img[alt=""]')).toHaveAttribute(
    "src",
    /^\/_astro\//u,
  );

  // The hub keeps one labelled region per publication state, always in this
  // order, so the reading order is part of the contract.
  await expect(
    page.getByRole("main").getByRole("heading", { level: 2 }).allTextContents(),
  ).resolves.toEqual([
    "Calendari mensual",
    "Pròximes edicions",
    "Vigents sense pròxima data",
    "Esdeveniments passats",
  ]);
});

test("lists each published event in the region its state belongs to", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");

  // Each hub section renders its own entry markup: the upcoming section uses
  // event cards, the without-date section a compact list, and the history a
  // table of past editions.
  const upcoming = page.getByRole("region", { name: "Pròximes edicions" });
  await expect(upcoming.getByRole("article")).toHaveCount(
    site.eventHubGroups.upcoming.length,
  );
  await expect(
    upcoming.getByRole("heading", { level: 3 }).allTextContents(),
  ).resolves.toEqual(
    site.eventHubGroups.upcoming.map(({ event }) => event.title.ca),
  );
  for (const [
    index,
    { href, nextEdition },
  ] of site.eventHubGroups.upcoming.entries()) {
    const card = upcoming.getByRole("article").nth(index);
    await expect(card.getByRole("link")).toHaveAttribute("href", href);
    // An upcoming event always has a next edition, so the card shows that
    // edition's date and place instead of the missing-date placeholder.
    await expect(card.getByRole("time")).toHaveAttribute(
      "datetime",
      nextEdition!.startDate,
    );
    await expect(card).toContainText(nextEdition!.location.ca);
  }

  const withoutDate = page.getByRole("region", {
    name: "Vigents sense pròxima data",
  });
  await expect(withoutDate.getByRole("listitem")).toHaveCount(
    site.eventHubGroups["active-without-date"].length,
  );
  for (const [index, { event, href }] of site.eventHubGroups[
    "active-without-date"
  ].entries()) {
    const item = withoutDate.getByRole("listitem").nth(index);
    await expect(item.getByRole("link")).toHaveAttribute("href", href);
    await expect(item.getByRole("link")).toContainText(event.title.ca);
    // No date is announced, so the entry must not offer a calendar date.
    await expect(item.locator("time")).toHaveCount(0);
  }

  const past = page.getByRole("region", { name: "Esdeveniments passats" });
  await expect(past.getByRole("row")).toHaveCount(
    site.eventHubGroups.past.length + 1,
  );
  for (const [index, { event }] of site.eventHubGroups.past.entries()) {
    await expect(past.getByRole("row").nth(index + 1)).toContainText(
      event.title.ca,
    );
  }
});

test("keeps an event out of the hub region its state does not match", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");

  const upcoming = page.getByRole("region", { name: "Pròximes edicions" });
  const withoutDate = page.getByRole("region", {
    name: "Vigents sense pròxima data",
  });

  for (const { event } of site.eventHubGroups["active-without-date"]) {
    await expect(
      upcoming.getByRole("link", { name: new RegExp(event.title.ca, "u") }),
    ).toHaveCount(0);
  }
  for (const { event } of site.eventHubGroups.upcoming) {
    await expect(
      withoutDate.getByRole("link", { name: new RegExp(event.title.ca, "u") }),
    ).toHaveCount(0);
  }
});

test("publishes the monthly calendar with a control per day holding events", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");

  const calendar = page.getByRole("region", { name: "Calendari mensual" });
  const dayButtons = calendar.getByRole("button", { expanded: false });

  await expect(dayButtons.first()).toBeVisible();
  // Every day that holds an event gets exactly one labelled control, and no
  // other day gets one.
  await expect(dayButtons).toHaveCount(site.calendarDays.length);

  // Each control announces the day and the events it holds, so a screen reader
  // reaches the same information the popover shows.
  for (const [index, day] of site.calendarDays.entries()) {
    await expect(dayButtons.nth(index)).toHaveAccessibleName(
      messages.events_calendar_day_with_events(
        { day: day.dayNumber!, events: day.eventTitles.join(", ") },
        { locale: site.locale },
      ),
    );
  }
});

test("never renders an empty or placeholder link on the events hub", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");
  await expect(
    page.getByRole("main").locator('a[href=""], a[href="#"]'),
  ).toHaveCount(0);
});

test("keeps the calendar popover state and mobile bounds synchronized", async ({
  page,
}, testInfo) => {
  await page.goto("/ca/esdeveniments/");

  const calendar = page.getByRole("region", { name: "Calendari mensual" });
  const dayButton = calendar.getByRole("button", {
    name: "16: Llobregat x la Diabetis",
  });
  const popoverId = await dayButton.getAttribute("aria-controls");
  expect(popoverId).not.toBeNull();
  const popover = page.locator(`#${popoverId}`);
  const outsideHeading = page.getByRole("heading", {
    level: 2,
    name: "Pròximes edicions",
  });
  const outsideLink = page
    .getByRole("region", { name: "Pròximes edicions" })
    .getByRole("link", { name: /Cros de Queralt/u })
    .first();

  if (!testInfo.project.name.endsWith("-mobile")) {
    await dayButton.focus();
    await dayButton.hover();
    await expect(dayButton).toHaveAttribute("aria-expanded", "true");
    await expect(popover).toBeVisible();
    await outsideHeading.hover();
    await expect(dayButton).toHaveAttribute("aria-expanded", "true");
    await expect(popover).toBeVisible();
    await dayButton.hover();
    await outsideLink.evaluate((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.focus({ preventScroll: true });
    });
    await expect(dayButton).toHaveAttribute("aria-expanded", "true");
    await expect(popover).toBeVisible();
    await outsideHeading.hover();
    await expect(dayButton).toHaveAttribute("aria-expanded", "false");
    await expect(popover).toBeHidden();
  }

  await dayButton.click();
  await expect(dayButton).toHaveAttribute("aria-expanded", "true");
  await expect(popover).toHaveRole("region");
  await expect(popover).toHaveAccessibleName("Esdeveniments del dia");
  await expect(popover).toBeVisible();
  if (testInfo.project.name.endsWith("-mobile")) {
    const popoverBounds = await popover.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(popoverBounds.left).toBeGreaterThanOrEqual(0);
    expect(popoverBounds.right).toBeLessThanOrEqual(
      popoverBounds.viewportWidth,
    );
  }

  await dayButton.click();
  await expect(dayButton).toHaveAttribute("aria-expanded", "false");
  await expect(popover).toBeHidden();

  await outsideLink.focus();
  if (!testInfo.project.name.endsWith("-mobile")) {
    await outsideHeading.hover();
  }
  await dayButton.focus();
  await expect(dayButton).toHaveAttribute("aria-expanded", "true");
  const eventLink = popover.getByRole("link").first();
  await eventLink.focus();
  await expect(eventLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dayButton).toHaveAttribute("aria-expanded", "false");
  await expect(popover).toBeHidden();
  await expect(dayButton).toBeFocused();

  await dayButton.press("Enter");
  await expect(dayButton).toHaveAttribute("aria-expanded", "true");
  await outsideHeading.click();
  await expect(dayButton).toHaveAttribute("aria-expanded", "false");
  await expect(popover).toBeHidden();
});

test("moves the events calendar between available months", async ({
  page,
  browserName,
}) => {
  await page.goto("/ca/esdeveniments/");

  const calendar = page.getByRole("region", { name: "Calendari mensual" });
  const monthTable = calendar.getByRole("table");
  const previousMonth = calendar.getByRole("button", { name: "Mes anterior" });
  const nextMonth = calendar.getByRole("button", { name: "Mes següent" });

  const augustEvent = calendar.getByRole("button", {
    name: "16: Escalada de Vilada a Castell de l'Areny",
  });
  const octoberEvent = calendar.getByRole("button", {
    name: "2: Ultra Pirineu",
    exact: true,
  });

  await expect(monthTable).toHaveAccessibleName("octubre del 2026");
  await previousMonth.click();
  await previousMonth.click();
  await expect(monthTable).toHaveAccessibleName("agost del 2026");
  await expect(augustEvent).toBeVisible();
  await expect(octoberEvent).toHaveCount(0);
  await previousMonth.click();
  await expect(monthTable).toHaveAccessibleName("juliol del 2026");
  await expect(augustEvent).toHaveCount(0);
  await nextMonth.click();
  await expect(monthTable).toHaveAccessibleName("agost del 2026");
  await expect(augustEvent).toBeVisible();
  await nextMonth.click();
  await expect(monthTable).toHaveAccessibleName("setembre del 2026");
  await expect(calendar.getByRole("button", { expanded: false })).toHaveCount(
    0,
  );

  await nextMonth.click();
  await expect(monthTable).toHaveAccessibleName("octubre del 2026");
  await expect(octoberEvent).toBeVisible();
  await expect(augustEvent).toHaveCount(0);

  // Tab reaches the visible month, not event controls in earlier hidden months.
  await nextMonth.focus();
  // WebKit on macOS uses Option+Tab to include buttons in keyboard navigation.
  if (browserName === "webkit") {
    await page.keyboard.press("Alt+Tab");
  } else {
    await page.keyboard.press("Tab");
  }
  await expect(octoberEvent).toBeFocused();
});

test("stops the events calendar at the bounds of its navigable range", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");

  const calendar = page.getByRole("region", { name: "Calendari mensual" });
  const monthTable = calendar.getByRole("table");
  const previousMonth = calendar.getByRole("button", { name: "Mes anterior" });
  const nextMonth = calendar.getByRole("button", { name: "Mes següent" });

  for (let month = 0; month < 30; month += 1) {
    if (await nextMonth.isDisabled()) break;
    await nextMonth.click();
  }

  await expect(monthTable).toHaveAccessibleName("novembre del 2026");
  await expect(nextMonth).toBeDisabled();
  await expect(previousMonth).toBeEnabled();

  for (let month = 0; month < 30; month += 1) {
    if (await previousMonth.isDisabled()) break;
    await previousMonth.click();
  }

  await expect(monthTable).toHaveAccessibleName("octubre del 2025");
  await expect(previousMonth).toBeDisabled();
  await expect(nextMonth).toBeEnabled();
});

test("loads calendar navigation with the preview script policy", async ({
  page,
}) => {
  await page.route("**/ca/esdeveniments/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy":
          "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src https://www.youtube-nocookie.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
      },
    });
  });

  await page.goto("/ca/esdeveniments/");

  const calendar = page.getByRole("region", { name: "Calendari mensual" });
  const monthTable = calendar.getByRole("table");
  await expect(monthTable).toHaveAccessibleName("octubre del 2026");

  await calendar.getByRole("button", { name: "Mes següent" }).click();

  await expect(monthTable).toHaveAccessibleName("novembre del 2026");
});

test("closes an open calendar popover when the month changes", async ({
  page,
}) => {
  await page.goto("/ca/esdeveniments/");

  const calendar = page.getByRole("region", { name: "Calendari mensual" });
  const monthTable = calendar.getByRole("table");
  await calendar.getByRole("button", { name: "Mes anterior" }).click();
  await calendar.getByRole("button", { name: "Mes anterior" }).click();
  const dayButton = calendar.getByRole("button", {
    name: "16: Escalada de Vilada a Castell de l'Areny",
  });
  const popoverId = await dayButton.getAttribute("aria-controls");
  const popover = page.locator(`#${popoverId}`);

  await dayButton.click();
  await expect(dayButton).toHaveAttribute("aria-expanded", "true");
  await expect(popover).toBeVisible();

  await calendar.getByRole("button", { name: "Mes següent" }).click();
  await expect(monthTable).toHaveAccessibleName("setembre del 2026");
  await expect(dayButton).toHaveCount(0);
  await expect(
    calendar.getByRole("button", {
      name: "16: Escalada de Vilada a Castell de l'Areny",
      includeHidden: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");

  await calendar.getByRole("button", { name: "Mes següent" }).click();
  await expect(monthTable).toHaveAccessibleName("octubre del 2026");
  const octoberDayButton = calendar.getByRole("button", {
    name: "2: Ultra Pirineu",
    exact: true,
  });
  const octoberPopoverId = await octoberDayButton.getAttribute("aria-controls");
  const octoberPopover = page.locator(`#${octoberPopoverId}`);

  await octoberDayButton.click();
  await expect(octoberDayButton).toHaveAttribute("aria-expanded", "true");
  await expect(octoberPopover).toBeVisible();
  await expect(
    octoberPopover.getByRole("heading", { name: "Ultra Pirineu" }),
  ).toBeVisible();
  await expect(
    octoberPopover.getByRole("link", { name: "Més informació" }),
  ).toHaveAttribute("href", "/ca/esdeveniments/ultra-pirineu/");

  await calendar.getByRole("button", { name: "Mes anterior" }).click();
  await calendar.getByRole("button", { name: "Mes anterior" }).click();
  await expect(monthTable).toHaveAccessibleName("agost del 2026");
  await expect(dayButton).toHaveAttribute("aria-expanded", "false");
  await expect(popover).toBeHidden();
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
    const gallery = page.getByRole("region", {
      name: /Galeria|Galería|Gallery/u,
    });
    const attributions = gallery.locator("figcaption");
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
  const coverImage = page.locator("main section:has(h1)").getByRole("img", {
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
  await expect(
    page.getByRole("heading", { level: 2, name: "Recursos" }),
  ).toHaveCount(0);
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
  await expect(
    page.getByRole("heading", { level: 2, name: "Recursos" }),
  ).toHaveCount(0);
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
  await expect(
    page.getByRole("heading", { level: 2, name: "Recursos" }),
  ).toHaveCount(0);
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
    const menu = getMobileMenu(page);
    await menu.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
  }

  const aboutLink = page
    .getByRole("navigation", { name: "Navegació principal" })
    .filter({ visible: true })
    .getByRole("link", { name: "Qui som", exact: true });
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
    const menu = getMobileMenu(page);
    await menu.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
  }

  const schoolsLink = page
    .getByRole("navigation", { name: "Navegació principal" })
    .filter({ visible: true })
    .getByRole("link", { name: "Escoles", exact: true });
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
    page.getByRole("region", { name: "Missatge de presidència" }),
  ).toContainText("escola de trail");
  await expect(
    page.getByText("Ernest Garrido Ferrer", { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Història" })).toContainText(
    "número 12637",
  );
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
    const menu = getMobileMenu(page);
    await menu.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
  }

  const membersLink = page
    .getByRole("navigation", { name: "Navegació principal" })
    .filter({ visible: true })
    .getByRole("link", { name: "Socis", exact: true });
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
  const hero = page.locator("main section:has(h1)");
  const heroImage = hero.locator('img[alt=""]');
  await expect(heroImage).toHaveAttribute("src", /^\/_astro\//u);
  await expect(heroImage).toHaveAttribute("alt", "");
  await expect(hero.locator("figcaption")).toContainText("@about_paulagnf");
  await expect(
    page.getByRole("region", { name: "Vídeo de la secció de socis" }),
  ).not.toContainText("@about_paulagnf");
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
  await expect(signupLink).toHaveAttribute("href", site.memberSignupUrl!);
  const federationLink = page.getByRole("link", { name: /Federa't/u });
  await expect(federationLink).toHaveCount(1);
  await expect(federationLink).toHaveAttribute("href", site.federationUrl!);

  const collaboratorsRegion = page.getByRole("region", {
    name: "Col·laboradors",
  });
  const collaboratorItems = collaboratorsRegion.getByRole("listitem");

  // The directory is derived from the published entities carrying a
  // membership benefit, so the rendered wall must match it entry for entry.
  await expect(collaboratorItems).toHaveCount(site.collaborators.length);
  await expect(
    collaboratorsRegion.getByRole("heading", { level: 3 }).allTextContents(),
  ).resolves.toEqual(site.collaborators.map(({ name }) => name.ca));

  for (const [index, collaborator] of site.collaborators.entries()) {
    const item = collaboratorItems.nth(index);
    // Each entry shows the reviewed logo alt text, the benefit title and its
    // description, so the directory never renders a bare logo.
    await expect(item.getByRole("img")).toHaveAttribute(
      "alt",
      collaborator.logo.alt.ca,
    );
    await expect(
      item.getByRole("heading", { name: collaborator.name.ca }),
    ).toBeVisible();
    await expect(item).toContainText(collaborator.membershipBenefit!.title.ca);
    await expect(item).toContainText(
      collaborator.membershipBenefit!.description.ca,
    );
  }
  await expect(
    page.getByRole("link", { name: /snowlockers\.com/u }),
  ).toHaveAttribute("href", "https://www.snowlockers.com/");
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
  // The hub lists the schools in editorial order, each with the registration
  // state its entry declares.
  const schoolList = page.getByRole("main").getByRole("list").last();
  const schoolCards = schoolList.getByRole("listitem");
  await expect(schoolCards).toHaveCount(site.orderedSchools.length);
  for (const [index, { school, href }] of site.orderedSchools.entries()) {
    const card = schoolCards.nth(index);
    await expect(card).toContainText(school.name.ca);
    await expect(card).toContainText(
      messages[
        getRegistrationPresentation(school.registrationStatus, undefined).key
      ]({}, { locale: "ca" }),
    );
    await expect(card.getByRole("link")).toHaveAttribute("href", href);
  }
  await expect(page.locator('main a[href=""], main a[href="#"]')).toHaveCount(
    0,
  );
});

test("navigates from the schools hub to a published school detail", async ({
  page,
}) => {
  const trailSchool = site.schools.find(
    ({ school }) => school.id === "trail-school",
  )!;

  await page.goto("/ca/escoles/");

  await page
    .getByRole("link", { name: new RegExp(trailSchool.school.name.ca, "u") })
    .click();

  await expect(page).toHaveURL(trailSchool.href);
  await expect(page.locator("html")).toHaveAttribute("lang", "ca");
  const schoolDetail = page.getByRole("main");
  await expect(
    schoolDetail.getByRole("heading", {
      level: 1,
      name: trailSchool.school.name.ca,
    }),
  ).toBeVisible();
  const aboutImage = schoolDetail
    .getByRole("region", { name: "Què oferim" })
    .getByRole("img", {
      name: "Participants de l'escola de trail en una sessió a l'entorn de Berga",
    });
  await expect(aboutImage).toBeVisible();
  await expect(aboutImage).toHaveAttribute("width", "1600");
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
  const practicalRegion = schoolDetail.getByRole("region", {
    name: "Informació pràctica",
  });
  await expect(
    practicalRegion.getByRole("heading", { level: 3 }).allTextContents(),
  ).resolves.toEqual([
    "Horari",
    "Lloc",
    "Per a qui",
    "Preus",
    "Des de",
    "Objectiu",
  ]);
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
  const galleryRegion = schoolDetail.getByRole("region", { name: "Galeria" });
  await expect(galleryRegion.getByRole("img")).toHaveCount(6);
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
    trailSchool.registrationUrl!,
  );
  await expect(registrationLink).toHaveAttribute("target", "_blank");
  // The link label is editorial copy: it must never leak the registration
  // host to the reader.
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
  const board = page.getByRole("region", { name: "Junta directiva" });
  await expect(
    board.getByRole("heading", { name: "Junta directiva" }),
  ).toBeVisible();
  await expect(board).toContainText("Ernest Garrido Ferrer");
  await expect(board.getByRole("link")).toHaveCount(0);

  // The unavailable school registration state is textual: it explains the
  // state without adding anything to the focus order, so the keyboard can
  // never land on a fake control.
  await page.goto("/ca/escoles/escola-skimo/");
  const registration = page.getByRole("region", { name: "Inscripció" });
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
  await expect(page.getByText("354 €")).toBeVisible();
  await expect(page.getByText("450 €")).toBeVisible();
  await expect(page.getByText("582 €")).toBeVisible();
  await expect(page.getByText("94 €")).toBeVisible();
  await expect(page.getByText("440 €")).toBeVisible();
  await expect(page.getByText("683 €")).toBeVisible();
  await expect(
    page.getByText("BTT: inscripció trimestral. Enduro: inscripció anual"),
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
  const statutesLink = page
    .getByRole("region", { name: "Estatuts" })
    .getByRole("link");
  await expect(statutesLink).toHaveAttribute("href", /estatuts-mrb\.pdf$/u);
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
  await expect(signupLink).toHaveAttribute("href", site.memberSignupUrl!);
  const federationLink = page.getByRole("link", { name: /Federa't/u });
  await tabUntilFocused(page, federationLink);
  await expect(federationLink).toHaveAttribute("href", site.federationUrl!);
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

  // Every published route is swept, in all three locales, so a new event,
  // school or fixed page is accessible the day it is published.
  test.slow();

  const routes = ["/404.html", ...site.sitemapPaths];
  const violationsByRoute: string[] = [];
  for (const path of routes) {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
    for (const violation of results.violations) {
      violationsByRoute.push(`${path}: ${violation.id}`);
    }
  }

  expect(violationsByRoute).toEqual([]);
});

test("emits canonical and social metadata for published pages", async ({
  page,
}) => {
  // One representative route per template, plus every locale: canonical,
  // hreflang and the Open Graph locale must follow the route, not the copy.
  const representativeRoutes = [
    { path: "/ca/", hasSocialImage: true },
    { path: site.orderedSchools.at(-1)!.href, hasSocialImage: true },
    { path: site.homepageEvents.at(0)!.href, hasSocialImage: true },
    { path: "/ca/qui-som/", hasSocialImage: false },
    { path: "/ca/socis/", hasSocialImage: false },
    { path: "/ca/esdeveniments/", hasSocialImage: true },
    { path: "/ca/escoles/", hasSocialImage: true },
    { path: "/ca/documents/", hasSocialImage: false },
  ];

  for (const { path: route, hasSocialImage } of representativeRoutes) {
    await page.goto(route);

    await expect(
      page.locator('link[rel="canonical"]'),
      `${route} canonical`,
    ).toHaveAttribute("href", `${publicSiteOrigin()}${route}`);
    await expect(
      page.locator('meta[property="og:url"]'),
      `${route} og:url`,
    ).toHaveAttribute("content", `${publicSiteOrigin()}${route}`);
    await expect(
      page.locator('meta[property="og:type"]'),
      `${route} og:type`,
    ).toHaveAttribute("content", "website");
    await expect(
      page.locator('meta[name="description"]'),
      `${route} description`,
    ).toHaveAttribute("content", /\S/u);
    // Templates that declare a social image must publish it as an absolute
    // URL on the canonical origin, with the alt text the screen reader needs.
    const socialImage = page.locator('meta[property="og:image"]');
    await expect(socialImage).toHaveCount(hasSocialImage ? 1 : 0);
    if (hasSocialImage) {
      await expect(socialImage).toHaveAttribute(
        "content",
        /^https:\/\/mountainrunners\.cat\//u,
      );
      await expect(
        page.locator('meta[property="og:image:alt"]'),
      ).toHaveAttribute("content", /\S/u);
    }

    // The alternate set must contain this route's own locale, pointing at
    // the canonical URL, so search engines can pair the translations.
    const ownLocale = route.split("/")[1]!;
    await expect(
      page.locator(`link[rel="alternate"][hreflang="${ownLocale}"]`),
      `${route} hreflang`,
    ).toHaveAttribute("href", `${publicSiteOrigin()}${route}`);
    await expect(
      page.locator('link[rel="alternate"]'),
      `${route} alternates`,
    ).toHaveCount(locales.length + 1);
  }

  // Every locale declares its own Open Graph locale, which is what social
  // platforms read to localize a shared link.
  for (const locale of locales as Locale[]) {
    await page.goto(`/${locale}/`);
    await expect(
      page.locator('meta[property="og:locale"]'),
      `/${locale}/ og:locale`,
    ).toHaveAttribute("content", openGraphLocales[locale]);
  }

  // The root document names the default locale as the x-default alternate.
  await page.goto("/ca/");
  await expect(
    page.locator('link[rel="alternate"][hreflang="x-default"]'),
  ).toHaveAttribute("href", `${publicSiteOrigin()}/ca/`);
});

test("serves sitemap and robots aligned with the canonical origin", async ({
  page,
}) => {
  const sitemapResponse = await page.request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBeTruthy();
  const sitemapText = await sitemapResponse.text();

  // Every published route must be discoverable, on the canonical origin, and
  // the error document must never be advertised.
  const origin = publicSiteOrigin();
  for (const path of site.sitemapPaths) {
    expect(sitemapText, path).toContain(`<loc>${origin}${path}</loc>`);
  }
  expect(sitemapText).not.toContain("404");

  const robotsResponse = await page.request.get("/robots.txt");
  expect(robotsResponse.ok()).toBeTruthy();
  expect(await robotsResponse.text()).toContain(
    `Sitemap: ${origin}/sitemap.xml`,
  );
});

test("has no broken or falsely disabled links within the slice", async ({
  page,
}) => {
  // Every published page, so a link published in any locale or template is
  // checked instead of only the ones a hand-written slice happened to name.
  const slicePaths = [...site.sitemapPaths, "/404.html"];
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
  const prefooter = page.getByRole("region", { name: "Tens dubtes?" });
  const sponsorLogoLink = prefooter.getByRole("link", {
    name: "Logotip de Vera",
  });
  await expect(sponsorLogoLink).toHaveCount(1);
  await expect(sponsorLogoLink).toHaveAttribute("href", "https://somvera.cat/");
  await expect(sponsorLogoLink).toHaveAttribute("target", "_blank");
  await expect(
    prefooter.getByRole("link", { name: "info@mountainrunners.cat" }),
  ).toHaveAttribute("href", "mailto:info@mountainrunners.cat");
  await expect(
    prefooter.getByRole("link", { name: "+34938213747" }),
  ).toHaveAttribute("href", "tel:+34938213747");
  await expect(
    prefooter.getByRole("link", { name: "+34691910774" }),
  ).toHaveAttribute("href", "tel:+34691910774");
  await expect(prefooter).toContainText(
    "De dilluns a divendres, de 18 h a 20 h",
  );
  await expect(prefooter).toContainText(
    "Plaça Sant Joan, 15 baixos, 08600 Berga",
  );
  await expect(prefooter).toContainText(
    "El servei de butlletí encara no està disponible.",
  );
  const footer = page.getByRole("contentinfo");
  await expect(footer.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(
    footer.locator('a[href="mailto:info@mountainrunners.cat"]'),
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
