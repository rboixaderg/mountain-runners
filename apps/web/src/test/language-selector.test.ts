import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import LanguageSelector from "../components/LanguageSelector.astro";

describe("LanguageSelector", () => {
  it("stays hidden without a published alternative", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(LanguageSelector, {
      props: {
        localizedAlternatives: [{ locale: "ca", href: "/ca/" }],
        locale: "ca",
      },
    });

    expect(html.trim()).toBe("");
  });

  it("renders complete translated alternatives", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(LanguageSelector, {
      props: {
        localizedAlternatives: [
          { locale: "ca", href: "/ca/" },
          { locale: "es", href: "/es/" },
        ],
        locale: "ca",
      },
    });

    const document = new JSDOM(html).window.document;
    const navigation = document.querySelector('nav[aria-label="Idioma"]');
    const summary = navigation?.querySelector(
      'summary[aria-label="Idioma: Català"]',
    );
    const currentLanguage = navigation?.querySelector('[aria-current="page"]');
    const spanishAlternative = navigation?.querySelector(
      'a[href="/es/"][hreflang="es"]',
    );

    expect(navigation).not.toBeNull();
    expect(summary?.textContent).toContain("CA");
    expect(
      summary?.querySelector('svg[aria-hidden="true"][focusable="false"]'),
    ).not.toBeNull();
    expect(currentLanguage?.textContent).toContain("Català");
    expect(spanishAlternative?.textContent).toContain("Castellà");
    expect(navigation?.querySelector("a[lang]")).toBeNull();
  });
});
