import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { collectionSchemas, eventSchema } from "../lib/content/models";
import { parseRestrictedYaml } from "../lib/content/yaml";

const fixturePaths = {
  site: "../content/site/site.yaml",
  pages: "../content/pages/club.yaml",
  schools: "../content/schools/trail-school.yaml",
  events: "../content/events/mountain-day.yaml",
  entities: "../content/entities/mountain-runners.yaml",
  documents: "../content/documents/club-guide.yaml",
} as const;

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

    it(`rejects missing and unknown fields in ${collectionName}`, async () => {
      const schema = collectionSchemas[collectionName] as z.ZodType;
      const data = (await parseFixture(
        fixturePaths[collectionName],
        schema,
      )) as Record<string, unknown>;
      const missingId = { ...data };
      delete missingId.id;

      expect(schema.safeParse(missingId).success).toBe(false);
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

    expect(eventSchema.safeParse(duplicateEdition).success).toBe(false);

    const invalidDate = structuredClone(event);
    invalidDate.editions[0]!.startDate = "2027-02-30";
    expect(eventSchema.safeParse(invalidDate).success).toBe(false);
  });
});
