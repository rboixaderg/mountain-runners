import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import PublicLayout from "../layouts/PublicLayout.astro";
import { setLocale } from "../paraglide/runtime.js";

describe("PublicLayout structured data", () => {
  it("renders escaped JSON-LD in the final HTML", async () => {
    setLocale("ca", { reload: false });
    const container = await AstroContainer.create();
    const html = await container.renderToString(PublicLayout, {
      props: {
        title: "Inici",
        description: "Descripció",
        locale: "ca",
        structuredData: [
          { name: "</script><script>alert(1)</script> & <tag> \u2028\u2029" },
        ],
      },
    });

    // The script must be emitted as a real element, not as escaped text.
    const scriptTag = '<script type="application/ld+json">';
    const scriptStart = html.indexOf(scriptTag);
    expect(scriptStart).toBeGreaterThan(-1);

    const scriptContent = html.slice(
      scriptStart + scriptTag.length,
      html.indexOf("</script>", scriptStart),
    );
    expect(scriptContent).not.toContain("<script>");
    expect(scriptContent).not.toContain("</script>");
    expect(scriptContent).toContain("\\u003c/script\\u003e");
  });
});
