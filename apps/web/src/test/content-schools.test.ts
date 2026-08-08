import { describe, expect, it } from "vitest";
import {
  getOrderedSchools,
  getOrderedSchoolVariants,
} from "../lib/content/schools";
import type { School } from "../lib/content/models";

function createSchool(id: string, hubOrder: number): School {
  return {
    id,
    published: true,
    hubOrder,
    slug: { ca: id },
    name: { ca: id },
    summary: { ca: id },
    description: { ca: id },
    cover: {
      resource: { kind: "external", url: "https://example.org/image.webp" },
      alt: { ca: id },
    },
    gallery: [],
    registrationStatus: "coming-soon",
    sections: {
      since: { ca: id },
      purpose: { ca: id },
      audience: { ca: id },
      schedule: { ca: id },
      location: { ca: id },
      prices: { ca: id },
    },
  };
}

describe("school hub ordering", () => {
  it("orders schools by the explicit editorial hubOrder", () => {
    const trail = createSchool("trail-school", 1);
    const skimo = createSchool("skimo-school", 2);
    const btt = createSchool("btt-school", 3);

    expect(getOrderedSchools([btt, skimo, trail]).map(({ id }) => id)).toEqual([
      "trail-school",
      "skimo-school",
      "btt-school",
    ]);
  });

  it("resolves equal hubOrder values with the stable identifier", () => {
    const zulu = createSchool("zulu-school", 1);
    const alpha = createSchool("alpha-school", 1);

    expect(getOrderedSchools([zulu, alpha]).map(({ id }) => id)).toEqual([
      "alpha-school",
      "zulu-school",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      createSchool("btt-school", 3),
      createSchool("trail-school", 1),
    ];
    getOrderedSchools(input);

    expect(input.map(({ id }) => id)).toEqual(["btt-school", "trail-school"]);
  });

  it("orders published variants with their entries in the same pass", () => {
    const variants = [
      {
        kind: "school" as const,
        locale: "ca" as const,
        slug: "escola-btt",
        entry: createSchool("btt-school", 3),
      },
      {
        kind: "school" as const,
        locale: "ca" as const,
        slug: "escola-trail",
        entry: createSchool("trail-school", 1),
      },
      {
        kind: "school" as const,
        locale: "ca" as const,
        slug: "escola-skimo",
        entry: createSchool("skimo-school", 2),
      },
    ];

    expect(
      getOrderedSchoolVariants(variants).map(({ entry }) => entry.id),
    ).toEqual(["trail-school", "skimo-school", "btt-school"]);
    expect(getOrderedSchoolVariants(variants).map(({ slug }) => slug)).toEqual([
      "escola-trail",
      "escola-skimo",
      "escola-btt",
    ]);
  });

  it("keeps one deterministic entry per school when variants duplicate an identifier", () => {
    const variants = [
      {
        kind: "school" as const,
        locale: "ca" as const,
        slug: "escola-trail",
        entry: createSchool("trail-school", 1),
      },
      {
        kind: "school" as const,
        locale: "ca" as const,
        slug: "escola-trail-copy",
        entry: createSchool("trail-school", 1),
      },
    ];

    expect(
      getOrderedSchoolVariants(variants).map(({ entry }) => entry.id),
    ).toEqual(["trail-school"]);
  });
});
