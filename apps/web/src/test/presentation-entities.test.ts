import { describe, expect, it } from "vitest";
import type { EntityLink } from "../lib/content/models";
import {
  entityLinkLabelMessageKeys,
  getEntityLinkUrl,
  getOrderedEntityLinks,
} from "../lib/presentation/entities";

describe("entity link labels", () => {
  it("maps every link kind to a message key", () => {
    expect(entityLinkLabelMessageKeys).toEqual({
      website: "entity_link_website",
      instagram: "footer_social_instagram",
      strava: "footer_social_strava",
      other: "entity_link_other",
    });
  });
});

describe("entity link ordering", () => {
  it("orders website, instagram, strava and other links by kind", () => {
    const links: EntityLink[] = [
      { kind: "other", url: "https://example.org/alt" },
      { kind: "strava", url: "https://www.strava.com/clubs/156769" },
      { kind: "instagram", url: "https://www.instagram.com/handle/" },
      { kind: "website", url: "https://example.org" },
    ];

    expect(getOrderedEntityLinks(links).map(({ kind }) => kind)).toEqual([
      "website",
      "instagram",
      "strava",
      "other",
    ]);
  });

  it("keeps the relative order of links with the same kind", () => {
    const links: EntityLink[] = [
      { kind: "other", url: "https://first.example" },
      { kind: "other", url: "https://second.example" },
    ];

    expect(getOrderedEntityLinks(links).map(({ url }) => url)).toEqual([
      "https://first.example",
      "https://second.example",
    ]);
  });

  it("returns an empty list for an empty input", () => {
    expect(getOrderedEntityLinks([])).toEqual([]);
  });
});

describe("entity link lookup", () => {
  const links: EntityLink[] = [
    { kind: "website", url: "https://example.org" },
    { kind: "instagram", url: "https://www.instagram.com/handle/" },
  ];

  it("returns the URL of the requested kind", () => {
    expect(getEntityLinkUrl(links, "instagram")).toBe(
      "https://www.instagram.com/handle/",
    );
  });

  it("returns undefined when the kind is missing", () => {
    expect(getEntityLinkUrl(links, "strava")).toBeUndefined();
  });

  it("returns undefined for an empty link list", () => {
    expect(getEntityLinkUrl([], "website")).toBeUndefined();
  });
});
