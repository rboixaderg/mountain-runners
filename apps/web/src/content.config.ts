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

const documents = defineCollection({
  loader: restrictedYamlLoader(
    "src/content/documents/",
    collectionSchemas.documents,
  ),
  schema: collectionSchemas.documents,
});

const externalActions = defineCollection({
  loader: restrictedYamlLoader(
    "src/content/external-actions/",
    collectionSchemas.externalActions,
  ),
  schema: collectionSchemas.externalActions,
});

const contact = defineCollection({
  loader: restrictedYamlLoader(
    "src/content/contact/",
    collectionSchemas.contact,
  ),
  schema: collectionSchemas.contact,
});

export const collections = {
  schools,
  events,
  entities,
  documents,
  externalActions,
  contact,
};
