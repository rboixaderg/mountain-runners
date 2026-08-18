import { experimental_AstroContainer as AstroContainer } from "astro/container";
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

    expect(html).toContain('aria-label="Idioma"');
    expect(html).toContain('class="language-selector__details"');
    expect(html).toContain('class="language-selector__icon"');
    expect(html).toContain(">CA</span>");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/es/"');
    expect(html).toContain('hreflang="es"');
    expect(html).not.toMatch(/<a[^>]*\slang=/u);
  });

  it("turns canonical language URLs into same-origin paths", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(LanguageSelector, {
      props: {
        localizedAlternatives: [
          { locale: "ca", href: "https://mountainrunners.cat/ca/" },
          { locale: "es", href: "https://mountainrunners.cat/es/" },
          {
            locale: "en",
            href: "https://new.mountainrunners.cat/en/",
          },
        ],
        locale: "ca",
      },
    });

    expect(html).toContain('href="/es/"');
    expect(html).toContain('href="/en/"');
    expect(html).not.toContain('href="https://mountainrunners.cat/');
    expect(html).not.toContain('href="https://new.mountainrunners.cat/');
  });
});
