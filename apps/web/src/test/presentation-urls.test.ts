import { describe, expect, it } from "vitest";
import { renderRestrictedMarkdown } from "../lib/content/markdown";
import {
  getExternalHost,
  getMailtoAddress,
  getMarkdownSafeMailtoAddress,
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

describe("getMailtoAddress", () => {
  it("removes the validated mailto scheme", () => {
    expect(getMailtoAddress("mailto:club@example.com")).toBe(
      "club@example.com",
    );
  });

  it("escapes Markdown syntax in a displayed email address", () => {
    const safeAddress = getMarkdownSafeMailtoAddress(
      "MAILTO:club_name`test@example.com",
    );

    expect(renderRestrictedMarkdown(`Contact ${safeAddress}.`)).toBe(
      "<p>Contact club_name`test@example.com.</p>",
    );
  });
});
