import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  collectionSchemas,
  type Contact,
  type Document,
  type Entity,
  type Event,
  type ExternalAction,
  type School,
} from "../lib/content/models";
import { getMembersDirectoryEntities } from "../lib/content/members";
import {
  createPublicationCatalog,
  type ContentSource,
} from "../lib/content/publication";
import {
  externalActionStatusMessageKeys,
  getExternalActionStatusMessageKey,
} from "../lib/presentation/status";
import { parseRestrictedYaml } from "../lib/content/yaml";

async function loadCollection<T>(directory: string, schema: z.ZodType<T>) {
  const directoryUrl = new URL(`../content/${directory}/`, import.meta.url);
  const files = (await readdir(directoryUrl))
    .filter((file) => file.endsWith(".yaml"))
    .sort();
  return Promise.all(
    files.map(async (file) =>
      parseRestrictedYaml(
        await readFile(new URL(file, directoryUrl), "utf8"),
        schema,
      ),
    ),
  );
}

async function loadSource(): Promise<ContentSource> {
  const [schools, events, entities, documents, externalActions, contact] =
    await Promise.all([
      loadCollection<School>("schools", collectionSchemas.schools),
      loadCollection<Event>("events", collectionSchemas.events),
      loadCollection<Entity>("entities", collectionSchemas.entities),
      loadCollection<Document>("documents", collectionSchemas.documents),
      loadCollection<ExternalAction>(
        "external-actions",
        collectionSchemas.externalActions,
      ),
      loadCollection<Contact>("contact", collectionSchemas.contact),
    ]);
  return { schools, events, entities, documents, externalActions, contact };
}

describe("members directory", () => {
  it("derives collaborators from published entities with a membership benefit", async () => {
    const catalog = createPublicationCatalog(await loadSource());
    const collaborators = getMembersDirectoryEntities(catalog, "ca");

    expect(collaborators).toHaveLength(22);
    expect(collaborators.map((entity) => entity.id)).toEqual([
      "four-riders-bike-park",
      "aina-vila",
      "alexandra-bruy",
      "bicixtrem",
      "centre-optic",
      "cimetir",
      "clinica-jessica-genesca",
      "elit",
      "estetica-adela",
      "farmacia-cosp",
      "intersport-serramarti",
      "joieria-climent",
      "ortopedia-alvarez-saz-cabra",
      "pedratour",
      "peu-de-via",
      "podologia-ingrid-soca",
      "ramirs-sabaters",
      "rios-running-berga",
      "serrasports",
      "snowlockers",
      "veloberga",
      "visites-al-bergueda",
    ]);
    expect(collaborators[0]!.name.ca).toBe("4 Riders Bike Park");
    expect(collaborators.at(-1)!.name.ca).toBe("Visites al Berguedà");
  });

  it("excludes entities without a benefit and the club itself", async () => {
    const catalog = createPublicationCatalog(await loadSource());
    const collaboratorIds = getMembersDirectoryEntities(catalog, "ca").map(
      (entity) => entity.id,
    );

    expect(collaboratorIds).not.toContain("mountain-runners");
    const benefitCount = catalog.entities.size;
    expect(benefitCount).toBeGreaterThan(collaboratorIds.length);
  });

  it("excludes unpublished entities from the directory", async () => {
    const source = await loadSource();
    source.entities.find(({ id }) => id === "elit")!.published = false;

    const catalog = createPublicationCatalog(source);
    const collaboratorIds = getMembersDirectoryEntities(catalog, "ca").map(
      (entity) => entity.id,
    );
    expect(collaboratorIds).not.toContain("elit");
    expect(collaboratorIds).toHaveLength(21);
  });
});

describe("external action status message keys", () => {
  it("maps every unavailable status to a shared message key", () => {
    expect(getExternalActionStatusMessageKey("coming-soon")).toBe(
      "external_action_coming_soon",
    );
    expect(getExternalActionStatusMessageKey("temporarily-unavailable")).toBe(
      "external_action_temporarily_unavailable",
    );
    expect(getExternalActionStatusMessageKey("unavailable")).toBe(
      "external_action_unavailable",
    );
  });

  it("has no message key for an available action", () => {
    expect(getExternalActionStatusMessageKey("available")).toBeUndefined();
  });

  it("keeps the key set aligned with the translation contract", () => {
    expect(externalActionStatusMessageKeys).toEqual({
      "coming-soon": "external_action_coming_soon",
      "temporarily-unavailable": "external_action_temporarily_unavailable",
      unavailable: "external_action_unavailable",
    });
  });
});
