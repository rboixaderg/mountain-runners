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
    page.getByRole("link", {
      name: "Mountain Runners del Berguedà estrena nou local a Berga",
      exact: true,
    }),
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
    title: "Mountain Runners del Berguedà estrena nou local a Berga",
  },
  {
    hub: "/ca/blog/",
    path: "/ca/blog/com-fer-te-soci/",
    title:
      "Com fer-te soci o sòcia de Mountain Runners del Berguedà, pas a pas",
  },
  {
    hub: "/ca/blog/",
    path: "/ca/blog/com-registrar-te-a-playoff/",
    title:
      "Aplicació mòbil per als socis del club, com registrar-te i accedir-hi",
  },
];

for (const pilot of pilots) {
  test(`approved post is published: ${pilot.path}`, async ({
    page,
    request,
  }) => {
    const response = await request.get(pilot.path);
    expect(response.status()).toBe(200);
    await page.goto(pilot.hub);
    await expect(
      page.getByRole("heading", { name: "Esborranys", exact: true }),
    ).toHaveCount(0);
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
    ).toHaveCount(0);
    if (process.env.PUBLIC_PREVIEW === "true") {
      await expect(
        page.getByText("Marcat per publicar · Versió de preview", {
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
    } else {
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    }
    await expect(
      page.locator('script[type="application/ld+json"]'),
    ).toHaveCount(1);
    await expect(page.locator('link[hreflang="es"]')).toHaveCount(0);
    const articleHeader = page.getByRole("article").locator("header");
    await expect(
      articleHeader.getByText("Mountain Runners", { exact: true }),
    ).toBeVisible();
    await expect(
      articleHeader.getByText("Publicat el 8 d’octubre del 2026", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(articleHeader.locator("time")).toHaveAttribute(
      "datetime",
      "2026-10-08T20:46:54Z",
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
      const expectedImageCount = pilot.path.includes(
        "com-registrar-te-a-playoff",
      )
        ? 2
        : 0;
      await expect(page.getByRole("article").getByRole("img")).toHaveCount(
        expectedImageCount,
      );
    }
    const sitemap = await request.get("/sitemap.xml");
    expect(await sitemap.text()).toContain(pilot.path);
  });
}

test("homepage combines news and blog with manual scrolling and locale isolation", async ({
  page,
}) => {
  await page.goto("/ca/");
  const section = page.getByRole("region", { name: "Actualitat del club" });
  await expect(section).toBeVisible();
  await expect(page.getByRole("main").locator("h2").last()).toHaveText(
    "Actualitat del club",
  );
  const list = section.getByRole("list", { name: "Entrades d'actualitat" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("heading", { level: 3 })).toHaveText([
    "Com fer-te soci o sòcia de Mountain Runners del Berguedà, pas a pas",
    "Aplicació mòbil per als socis del club, com registrar-te i accedir-hi",
    "Mountain Runners del Berguedà estrena nou local a Berga",
  ]);
  await expect(
    section.getByRole("link", { name: "Totes les notícies", exact: true }),
  ).toHaveAttribute("href", "/ca/noticies/");
  await expect(
    section.getByRole("link", {
      name: "Tots els articles del blog",
      exact: true,
    }),
  ).toHaveAttribute("href", "/ca/blog/");
  await expect(
    list.getByText("Esborrany · No publicat a la web pública", { exact: true }),
  ).toHaveCount(0);
  const previous = section.getByRole("button", { name: "Entrades anteriors" });
  const next = section.getByRole("button", { name: "Entrades següents" });
  const overflows = await list.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  if (overflows) {
    if (page.viewportSize()!.width < 640) {
      const firstCard = await list.getByRole("listitem").first().boundingBox();
      const secondCard = await list.getByRole("listitem").nth(1).boundingBox();
      const viewport = await list.boundingBox();
      expect(firstCard!.width).toBeLessThan(viewport!.width);
      expect(secondCard!.x).toBeLessThan(viewport!.x + viewport!.width);
      const newsLink = await section
        .getByRole("link", { name: "Totes les notícies", exact: true })
        .boundingBox();
      const nextControl = await next.boundingBox();
      expect(
        Math.abs(
          newsLink!.y +
            newsLink!.height / 2 -
            nextControl!.y -
            nextControl!.height / 2,
        ),
      ).toBeLessThanOrEqual(2);
    }
    const controlBounds = await next.boundingBox();
    expect(controlBounds!.width).toBeGreaterThanOrEqual(44);
    expect(controlBounds!.height).toBeGreaterThanOrEqual(44);
    const listBounds = await list.boundingBox();
    expect(controlBounds!.y + controlBounds!.height).toBeLessThanOrEqual(
      listBounds!.y,
    );
    await expect(previous).toBeDisabled();
    await next.click();
    await expect
      .poll(() => list.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(previous).toBeDisabled();
    await list.focus();
    await list.press("ArrowRight");
    await expect
      .poll(() => list.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  } else {
    await expect(previous).toBeHidden();
    await expect(next).toBeHidden();
  }
  await list
    .getByRole("link", {
      name: "Aplicació mòbil per als socis del club, com registrar-te i accedir-hi",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/ca\/blog\/com-registrar-te-a-playoff\/$/u);
  for (const path of ["/es/", "/en/"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: /Actualidad del club|Club updates/u,
      }),
    ).toHaveCount(0);
  }
});

const registrationArticle = {
  path: "/ca/blog/com-registrar-te-a-playoff/",
  screenshotAlt:
    "Pantalla de benvinguda de l'app Playoff amb l'enllaç Registra't aquí a la part inferior, al costat de No tens compte?",
};

test("registration screenshot stays proportional within the section height limit", async ({
  page,
}) => {
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

test.describe("editorial navigation without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("homepage remains manually scrollable without scripted controls", async ({
    page,
  }) => {
    await page.goto("/ca/");
    const section = page.getByRole("region", { name: "Actualitat del club" });
    const list = section.getByRole("list", { name: "Entrades d'actualitat" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(section.getByRole("button")).toHaveCount(0);
    const overflows = await list.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    );
    if (overflows) {
      await list.focus();
      await list.press("ArrowRight");
      await expect
        .poll(() => list.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    }
    const articleLink = list.getByRole("link", {
      name: "Aplicació mòbil per als socis del club, com registrar-te i accedir-hi",
      exact: true,
    });
    await articleLink.focus();
    await articleLink.press("Enter");
    await expect(page).toHaveURL(/\/ca\/blog\/com-registrar-te-a-playoff\/$/u);
  });

  test("image link opens the larger derivative", async ({ page }) => {
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

test("editorial hubs and published articles have no detected accessibility violations @a11y", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "axe runs on Chromium desktop and mobile.",
  );
  const paths = [
    "/ca/",
    "/ca/noticies/",
    "/ca/blog/",
    ...pilots.map((pilot) => pilot.path),
  ];
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
