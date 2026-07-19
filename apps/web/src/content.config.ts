import { defineCollection } from "astro:content";
import { restrictedYamlLoader } from "./lib/content/loader";
import { collectionSchemas } from "./lib/content/models";

const schools = defineCollection({
  loader: restrictedYamlLoader(
    "src/content/schools/",
    collectionSchemas.schools,
  ),
  schema: collectionSchemas.schools,
});

const events = defineCollection({
  loader: restrictedYamlLoader("src/content/events/", collectionSchemas.events),
  schema: collectionSchemas.events,
});

const entities = defineCollection({
  loader: restrictedYamlLoader(
    "src/content/entities/",
    collectionSchemas.entities,
  ),
  schema: collectionSchemas.entities,
});

const pages = defineCollection({
  loader: restrictedYamlLoader("src/content/pages/", collectionSchemas.pages),
  schema: collectionSchemas.pages,
});

const documents = defineCollection({
  loader: restrictedYamlLoader(
    "src/content/documents/",
    collectionSchemas.documents,
  ),
  schema: collectionSchemas.documents,
});

export const collections = {
  schools,
  events,
  entities,
  pages,
  documents,
};
