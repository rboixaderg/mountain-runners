import { describe, expect, it } from "vitest";
import { getSponsorEntities } from "../lib/content/sponsors";
import { loadContentSource } from "./support/publication-catalog";
import { createPublicationCatalog } from "../lib/content/publication";

describe("homepage sponsors", () => {
  it("derives sponsors from published entities marked as sponsors", async () => {
    const catalog = createPublicationCatalog(await loadContentSource());
    const sponsors = getSponsorEntities(catalog, "ca");

    expect(sponsors.map((entity) => entity.id)).toEqual(["vera"]);
    for (const entity of sponsors) {
      expect(entity.sponsor).toBe(true);
    }
  });

  it("excludes collaborators and the club itself", async () => {
    const catalog = createPublicationCatalog(await loadContentSource());
    const sponsorIds = getSponsorEntities(catalog, "ca").map(
      (entity) => entity.id,
    );

    expect(sponsorIds).not.toContain("mountain-runners");
    expect(sponsorIds).not.toContain("aina-vila");
  });
});
