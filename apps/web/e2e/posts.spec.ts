import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("editorial menu clicks emit labeled actions without depending on Plausible", async ({
  page,
}) => {
  test.skip(
    process.env.PUBLIC_PREVIEW === "true",
    "Preview does not load analytics.",
  );
  await page.route("https://analytics.rogerbg.cat/**", (route) =>
    route.abort(),
  );
  const events: { name: string; props: Record<string, string> }[] = [];
  await page.exposeFunction(
    "captureAnalyticsAction",
    (name: string, options: { props: Record<string, string> }) =>
      events.push({ name, props: options.props }),
  );
  // Stub the loaded tracker, not the site's event script. This checks emitted
  // events across navigation without relying on browser-specific beacon capture.
  await page.addInitScript(
    "window.plausible = Object.assign((name, options) => window.captureAnalyticsAction(name, options), { l: true, init() {} });",
  );
  for (const [label, target] of [
    ["Notícies", "news"],
    ["Blog", "blog"],
  ]) {
    events.length = 0;
    await page.goto("/ca/");
    if (page.viewportSize()!.width < 1024)
      await page.locator("summary").filter({ hasText: "Menú" }).click();
    await page
      .getByRole("navigation", { name: "Navegació principal" })
      .filter({ visible: true })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect
      .poll(() => events.filter(({ name }) => name === "UI Action"))
      .toEqual([
        {
          name: "UI Action",
          props: {
            action: "navigate",
            area: "header_nav",
            locale: "ca",
            page_type: "home",
            route: "/ca/",
            target,
          },
        },
      ]);
    await expect(
      page.getByRole("heading", { name: label, level: 1, exact: true }),
    ).toBeVisible();
  }
});

test("editorial hubs are discoverable and have localized empty states", async ({
  page,
}) => {
  await page.goto("/ca/");
  if (page.viewportSize()!.width < 1024)
    await page.locator("summary").filter({ hasText: "Menú" }).click();
  const navigation = page
    .getByRole("navigation", { name: "Navegació principal" })
    .filter({ visible: true });
  await navigation.getByRole("link", { name: "Notícies", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Notícies" }),
  ).toBeVisible();
  await expect(
    page.getByText("Encara no hi ha publicacions en aquest idioma."),
  ).toBeVisible();
  await page.goto("/es/noticias/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Noticias" }),
  ).toBeVisible();
  await page.goto("/en/blog/");
  await expect(
    page.getByText("There are no publications in this language yet."),
  ).toBeVisible();
});

const pilots = [
  {
    hub: "/ca/noticies/",
    path: "/ca/noticies/inauguracio-nou-local/",
    title:
      "Mountain Runners inaugura el nou local a la plaça de Sant Joan de Berga",
  },
  {
    hub: "/ca/blog/",
    path: "/ca/blog/com-fer-te-soci/",
    title:
      "Com fer-te soci o sòcia de Mountain Runners del Berguedà, pas a pas",
  },
];

for (const pilot of pilots) {
  test(`pilot remains unpublished: ${pilot.path}`, async ({
    page,
    request,
  }) => {
    if (process.env.PUBLIC_PREVIEW !== "true") {
      const response = await request.get(pilot.path);
      expect(response.status()).toBe(404);
      await page.goto(pilot.hub);
      await expect(
        page.getByRole("link", { name: pilot.title, exact: true }),
      ).toHaveCount(0);
      return;
    }
    await page.goto(pilot.hub);
    await expect(
      page.getByRole("heading", { name: "Esborranys", exact: true }),
    ).toBeVisible();
    const titleLink = page.getByRole("link", {
      name: pilot.title,
      exact: true,
    });
    const listEntry = page.getByRole("listitem").filter({ has: titleLink });
    if (pilot.path.includes("com-fer-te-soci")) {
      const thumbnail = listEntry.getByRole("img", {
        name: "Logotip de l'Associació Esportiva Mountain Runners del Berguedà.",
      });
      await expect(thumbnail).toBeVisible();
      await expect(thumbnail).toHaveAttribute("loading", "lazy");
      const bounds = await thumbnail.boundingBox();
      expect(bounds!.width).toBe(192);
      expect(bounds!.height).toBe(108);
    } else {
      await expect(listEntry.getByRole("img")).toHaveCount(0);
    }
    await titleLink.focus();
    await expect(titleLink).toBeFocused();
    await titleLink.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: pilot.title }),
    ).toBeVisible();
    await expect(
      page.getByText("Esborrany · No publicat a la web pública", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("complementary"),
    ).toContainText("PREVIEW ·");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(
      page.locator('script[type="application/ld+json"]'),
    ).toHaveCount(0);
    await expect(page.locator('link[hreflang="es"]')).toHaveCount(0);
    const articleHeader = page.getByRole("article").locator("header");
    await expect(
      articleHeader.getByText("Mountain Runners", { exact: true }),
    ).toBeVisible();
    await expect(
      articleHeader.getByText("Preparat el 2 d’octubre del 2026", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(articleHeader.locator("time")).toHaveAttribute(
      "datetime",
      "2026-10-02",
    );
    if (pilot.path.includes("com-fer-te-soci")) {
      await expect(page.getByRole("article").getByRole("img")).toHaveCount(5);
      const cover = page.getByRole("article").getByRole("img", {
        name: "Logotip de l'Associació Esportiva Mountain Runners del Berguedà.",
      });
      await expect(cover).toHaveAttribute("loading", "eager");
      expect((await cover.boundingBox())!.height).toBeLessThanOrEqual(320);
      expect(
        await cover.evaluate((image) => getComputedStyle(image).objectFit),
      ).toBe("contain");
      const screenshot = page.getByRole("img", {
        name: "Pantalla de dades personals de Playoff amb els camps d'identificació, contacte i adreça buits i el botó Continuar.",
      });
      const screenshotBounds = await screenshot.boundingBox();
      const sourceRatio = await screenshot.evaluate(
        (image: HTMLImageElement) =>
          Number(image.getAttribute("width")) /
          Number(image.getAttribute("height")),
      );
      expect(screenshotBounds!.width / screenshotBounds!.height).toBeCloseTo(
        sourceRatio,
        2,
      );
      await expect(
        page.getByRole("link", { name: "Ves a la pàgina de Socis" }),
      ).toHaveAttribute("href", "/ca/socis/");
    } else {
      await expect(page.getByRole("article").getByRole("img")).toHaveCount(0);
    }
    const sitemap = await request.get("/sitemap.xml");
    expect(await sitemap.text()).not.toContain(pilot.path);
  });
}

const registrationArticle = {
  path: "/ca/blog/com-registrar-te-a-playoff/",
  screenshotAlt:
    "Pantalla de benvinguda de l'app Playoff amb l'enllaç Registra't aquí a la part inferior, al costat de No tens compte?",
};

test("registration draft is absent publicly and its screenshot stays proportional within the preview height limit", async ({
  page,
  request,
}) => {
  if (process.env.PUBLIC_PREVIEW !== "true") {
    expect((await request.get(registrationArticle.path)).status()).toBe(404);
    return;
  }
  await page.goto(registrationArticle.path);
  const screenshot = page.getByRole("img", {
    name: registrationArticle.screenshotAlt,
    exact: true,
  });
  await expect(screenshot).toBeVisible();
  const bounds = await screenshot.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(480);
  const sourceRatio = await screenshot.evaluate(
    (image: HTMLImageElement) =>
      Number(image.getAttribute("width")) /
      Number(image.getAttribute("height")),
  );
  expect(bounds!.width / bounds!.height).toBeCloseTo(sourceRatio, 2);
});

test("section image viewer supports keyboard, dismissal and focus restoration", async ({
  page,
}) => {
  test.skip(
    process.env.PUBLIC_PREVIEW !== "true",
    "The registration article is a draft.",
  );
  await page.goto(registrationArticle.path);
  const link = page.getByRole("link", {
    name: `Amplia la imatge: ${registrationArticle.screenshotAlt}`,
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Imatge ampliada" });
  const thumbnailHeight = (await link.getByRole("img").boundingBox())!.height;
  await link.focus();
  await link.press("Enter");
  await expect(dialog).toBeVisible();
  const closeButton = dialog.getByRole("button", {
    name: "Tanca",
    exact: true,
  });
  await expect(closeButton).toBeFocused();
  const image = dialog.getByRole("img");
  await expect(image).toBeVisible();
  expect((await image.boundingBox())!.height).toBeGreaterThan(thumbnailHeight);
  await closeButton.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
  await link.click();
  await closeButton.click();
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
  await link.click();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
});

test.describe("section image fallback without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("image link opens the larger derivative", async ({ page }) => {
    test.skip(
      process.env.PUBLIC_PREVIEW !== "true",
      "The registration article is a draft.",
    );
    await page.goto(registrationArticle.path);
    const link = page.getByRole("link", {
      name: `Amplia la imatge: ${registrationArticle.screenshotAlt}`,
      exact: true,
    });
    const href = await link.getAttribute("href");
    expect(href).toBe(
      "/editorial-images/1200/content-assets/posts/com-registrar-te-a-playoff/registre-inicial.jpg.webp",
    );
    const targetUrl = new URL(href!, page.url()).href;
    await link.click();
    await expect(page).toHaveURL(targetUrl);
  });
});

test("editorial hubs and preview articles have no detected accessibility violations @a11y", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "axe runs on Chromium desktop and mobile.",
  );
  const paths = ["/ca/noticies/", "/ca/blog/"];
  if (process.env.PUBLIC_PREVIEW === "true")
    paths.push(...pilots.map((pilot) => pilot.path), registrationArticle.path);
  for (const path of paths) {
    await page.goto(path);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (path === registrationArticle.path) {
      await page
        .getByRole("link", {
          name: `Amplia la imatge: ${registrationArticle.screenshotAlt}`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Imatge ampliada" }),
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  }
});
