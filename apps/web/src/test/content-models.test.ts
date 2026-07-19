import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { collectionSchemas, eventSchema } from "../lib/content/models";
import { parseRestrictedYaml } from "../lib/content/yaml";

const fixturePaths = {
  schools: "../content/schools/trail-school.yaml",
  events: "../content/events/mountain-day.yaml",
  entities: "../content/entities/mountain-runners.yaml",
  pages: "../content/pages/homepage.yaml",
  documents: "../content/documents/club-guide.yaml",
} as const;

const requiredFields = {
  schools: ["id", "sections"],
  events: ["id", "editions"],
  entities: ["id", "logo"],
  pages: ["id", "hero"],
  documents: ["id", "resource"],
} as const;

const invalidStateFixtures = [
  [
    "school registration status",
    "./fixtures/invalid-school-registration-status.yaml",
    collectionSchemas.schools,
    "registrationStatus",
  ],
  [
    "event registration status",
    "./fixtures/invalid-event-registration-status.yaml",
    collectionSchemas.events,
    "registrationStatus",
  ],
  [
    "document availability",
    "./fixtures/invalid-document-availability.yaml",
    collectionSchemas.documents,
    "availability",
  ],
] as const;

async function parseFixture<T>(relativePath: string, schema: z.ZodType<T>) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  return parseRestrictedYaml(source, schema);
}

describe("editorial collection schemas", () => {
  for (const collectionName of Object.keys(
    collectionSchemas,
  ) as (keyof typeof collectionSchemas)[]) {
    it(`accepts the representative ${collectionName} entry`, async () => {
      const schema = collectionSchemas[collectionName] as z.ZodType;
      const result = await parseFixture(fixturePaths[collectionName], schema);
      expect(result).toBeDefined();
    });

    it(`rejects missing required and unknown fields in ${collectionName}`, async () => {
      const schema = collectionSchemas[collectionName] as z.ZodType;
      const data = (await parseFixture(
        fixturePaths[collectionName],
        schema,
      )) as Record<string, unknown>;

      for (const field of requiredFields[collectionName]) {
        const incomplete = { ...data };
        delete incomplete[field];
        expect(schema.safeParse(incomplete).success).toBe(false);
      }
      expect(schema.safeParse({ ...data, unexpected: true }).success).toBe(
        false,
      );
    });
  }

  it("validates embedded event editions and rejects duplicate ids", async () => {
    const event = await parseFixture(
      fixturePaths.events,
      collectionSchemas.events,
    );
    const duplicateEdition = structuredClone(event);
    duplicateEdition.editions.push(structuredClone(event.editions[0]!));

    expect(event.registrationUrl?.ca).toBe(
      "https://example.org/inscripcions/jornada-muntanya",
    );
    expect(eventSchema.safeParse(duplicateEdition).success).toBe(false);

    const invalidDate = structuredClone(event);
    invalidDate.editions[0]!.startDate = "2027-02-30";
    expect(eventSchema.safeParse(invalidDate).success).toBe(false);
  });

  for (const [
    stateName,
    fixturePath,
    schema,
    expectedField,
  ] of invalidStateFixtures) {
    it(`rejects an invalid ${stateName}`, async () => {
      await expect(
        parseFixture(fixturePath, schema as z.ZodType),
      ).rejects.toThrow(expectedField);
    });
  }
});
