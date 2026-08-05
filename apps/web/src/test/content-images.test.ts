import { describe, expect, it } from "vitest";
import {
  getDocumentHref,
  getLocalImageSize,
  getResourceHref,
} from "../lib/content/images";

const appDirectory = new URL("../../", import.meta.url).pathname;

describe("content images", () => {
  it("maps a local resource to its public content-resources URL", () => {
    expect(
      getResourceHref({
        kind: "local",
        path: "src/assets/logo_mountain_runners.png",
      }),
    ).toBe("/content-resources/assets/logo_mountain_runners.png");
  });

  it("uses the validated URL for external resources", () => {
    expect(
      getResourceHref({
        kind: "external",
        url: "https://images.example.org/cover.webp",
      }),
    ).toBe("https://images.example.org/cover.webp");
  });

  it("does not create a link for an unavailable document", () => {
    expect(
      getDocumentHref({
        id: "club-guide",
        published: true,
        title: { ca: "Guia del club" },
        description: { ca: "Informació pràctica" },
        resource: {
          kind: "external",
          url: "https://example.org/club-guide.pdf",
        },
        documentType: "guide",
        availability: "temporarily-unavailable",
      }),
    ).toBeUndefined();
  });

  it("creates a link for an available document", () => {
    expect(
      getDocumentHref({
        id: "club-guide",
        published: true,
        title: { ca: "Guia del club" },
        description: { ca: "Informació pràctica" },
        resource: {
          kind: "external",
          url: "https://example.org/club-guide.pdf",
        },
        documentType: "guide",
        availability: "available",
      }),
    ).toBe("https://example.org/club-guide.pdf");
  });

  it("reads the dimensions of an approved local image", async () => {
    await expect(
      getLocalImageSize("src/assets/logo_mountain_runners.png"),
    ).resolves.toEqual({ width: 450, height: 444 });
  });

  it("returns undefined for unsupported local resources", async () => {
    await expect(
      getLocalImageSize(
        "src/content-assets/documents/club-guide.pdf",
        appDirectory,
      ),
    ).resolves.toBeUndefined();
  });
});
