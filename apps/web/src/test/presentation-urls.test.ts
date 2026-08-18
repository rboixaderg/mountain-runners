import { describe, expect, it } from "vitest";
import { renderRestrictedMarkdown } from "../lib/content/markdown";
import {
  getExternalHost,
  getMailtoHref,
  getMarkdownSafeEmailAddress,
  getSameOriginHref,
  getTelHref,
} from "../lib/presentation/urls";

describe("getExternalHost", () => {
  it("strips the www prefix from the hostname", () => {
    expect(getExternalHost("https://www.example.com/inscripcio")).toBe(
      "example.com",
    );
  });

  it("keeps subdomains and the port-free hostname", () => {
    expect(getExternalHost("https://inscripcions.mountainrunners.cat/x")).toBe(
      "inscripcions.mountainrunners.cat",
    );
  });
});

describe("getSameOriginHref", () => {
  it("keeps a root-relative path unchanged", () => {
    expect(getSameOriginHref("/es/escoles/")).toBe("/es/escoles/");
  });

  it("strips a canonical origin so navigation stays on the current host", () => {
    expect(getSameOriginHref("https://mountainrunners.cat/es/escuelas/")).toBe(
      "/es/escuelas/",
    );
    expect(
      getSameOriginHref("https://new.mountainrunners.cat/en/schools/"),
    ).toBe("/en/schools/");
  });
});

describe("getMailtoHref", () => {
  it("builds the mailto href from the semantic address", () => {
    expect(getMailtoHref("club@example.com")).toBe("mailto:club@example.com");
  });
});

describe("getTelHref", () => {
  it("builds the tel href from the semantic phone number", () => {
    expect(getTelHref("+34 600 000 000")).toBe("tel:+34 600 000 000");
  });
});

describe("getMarkdownSafeEmailAddress", () => {
  it("escapes Markdown syntax in a displayed email address", () => {
    const safeAddress = getMarkdownSafeEmailAddress(
      "club_name`test@example.com",
    );

    expect(renderRestrictedMarkdown(`Contact ${safeAddress}.`)).toBe(
      "<p>Contact club_name`test@example.com.</p>",
    );
  });
});
