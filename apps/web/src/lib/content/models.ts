import { z } from "zod";
import { parseRestrictedMarkdown } from "./markdown";
import {
  localeSchema,
  nonEmptyStringSchema,
  slugSchema,
  translatableSchema,
} from "./primitives";
import { safeResourceSchema } from "./resources";
import { httpsUrlSchema } from "./urls";

const contentIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
  error: "Expected a stable lowercase kebab-case identifier",
});

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, { error: "Expected an ISO calendar date" })
  .refine(
    (value) => {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year!, month! - 1, day!));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month! - 1 &&
        date.getUTCDate() === day
      );
    },
    { error: "Expected a valid calendar date" },
  );

const markdownSchema = nonEmptyStringSchema.superRefine((value, context) => {
  try {
    parseRestrictedMarkdown(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message:
        error instanceof Error ? error.message : "Invalid restricted Markdown",
    });
  }
});

export const localizedTextSchema = translatableSchema(nonEmptyStringSchema);
export const localizedMarkdownSchema = translatableSchema(markdownSchema);
export const localizedSlugSchema = translatableSchema(slugSchema);
const localizedHttpsUrlSchema = translatableSchema(httpsUrlSchema);

const imageSchema = z.strictObject({
  resource: safeResourceSchema,
  alt: localizedTextSchema,
  attribution: localizedTextSchema.optional(),
  sourceUrl: httpsUrlSchema.optional(),
});

const homepageImageSchema = imageSchema.extend({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const publishableFields = {
  id: contentIdSchema,
  published: z.boolean(),
  slug: localizedSlugSchema,
};

const registrationStatusSchema = z.enum([
  "open",
  "closed",
  "coming-soon",
  "unavailable",
]);

export const schoolSchema = z.strictObject({
  ...publishableFields,
  name: localizedTextSchema,
  summary: localizedTextSchema,
  description: localizedMarkdownSchema,
  cover: imageSchema,
  gallery: z.array(imageSchema).max(20),
  promotionalVideoUrl: httpsUrlSchema.optional(),
  registrationStatus: registrationStatusSchema,
  registrationUrl: localizedHttpsUrlSchema.optional(),
  sections: z.strictObject({
    since: localizedMarkdownSchema,
    purpose: localizedMarkdownSchema,
    audience: localizedMarkdownSchema,
    schedule: localizedMarkdownSchema,
    location: localizedMarkdownSchema,
    prices: localizedMarkdownSchema,
  }),
});

const eventEditionSchema = z
  .strictObject({
    id: contentIdSchema,
    startDate: dateSchema,
    endDate: dateSchema.optional(),
    location: localizedTextSchema,
    modalities: z.array(localizedTextSchema).min(1).max(20),
    registrationStatus: registrationStatusSchema,
    registrationUrl: localizedHttpsUrlSchema.optional(),
    documentIds: z.array(contentIdSchema).max(20),
  })
  .refine(
    ({ startDate, endDate }) => endDate === undefined || endDate >= startDate,
    { error: "Edition endDate cannot precede startDate", path: ["endDate"] },
  );

export const eventSchema = z
  .strictObject({
    ...publishableFields,
    active: z.boolean(),
    title: localizedTextSchema,
    description: localizedMarkdownSchema,
    clubRelationship: z.enum(["organizes", "collaborates"]),
    cover: imageSchema,
    gallery: z.array(imageSchema).max(20),
    videoUrls: z.array(httpsUrlSchema).max(10),
    registrationUrl: localizedHttpsUrlSchema.optional(),
    informationUrl: localizedHttpsUrlSchema.optional(),
    organizerIds: z.array(contentIdSchema).min(1).max(20),
    collaboratorIds: z.array(contentIdSchema).max(20),
    editions: z.array(eventEditionSchema).min(1).max(100),
  })
  .superRefine(({ editions }, context) => {
    const ids = new Set<string>();
    for (const [index, edition] of editions.entries()) {
      if (ids.has(edition.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate edition id: ${edition.id}`,
          path: ["editions", index, "id"],
        });
      }
      ids.add(edition.id);
    }
  });

export const entitySchema = z.strictObject({
  id: contentIdSchema,
  published: z.boolean(),
  name: localizedTextSchema,
  logo: imageSchema,
  description: localizedMarkdownSchema,
  websiteUrl: httpsUrlSchema.optional(),
  attribution: localizedTextSchema.optional(),
  membershipBenefit: z
    .strictObject({
      title: localizedTextSchema,
      description: localizedMarkdownSchema,
      url: localizedHttpsUrlSchema.optional(),
    })
    .optional(),
});

export const homepageSchema = z.strictObject({
  id: contentIdSchema,
  published: z.boolean(),
  hero: z.strictObject({
    title: localizedTextSchema,
    description: localizedMarkdownSchema,
    image: homepageImageSchema,
  }),
  events: z.strictObject({
    title: localizedTextSchema,
    description: localizedMarkdownSchema,
  }),
  schools: z.strictObject({
    title: localizedTextSchema,
    description: localizedMarkdownSchema,
  }),
  members: z.strictObject({
    title: localizedTextSchema,
    description: localizedMarkdownSchema,
  }),
  community: z.strictObject({
    title: localizedTextSchema,
    description: localizedMarkdownSchema,
  }),
});

export const documentSchema = z.strictObject({
  id: contentIdSchema,
  published: z.boolean(),
  title: localizedTextSchema,
  description: localizedTextSchema,
  resource: safeResourceSchema,
  documentType: z.enum(["regulation", "form", "minutes", "guide", "other"]),
  date: dateSchema.optional(),
  resourceLocale: localeSchema.optional(),
  availability: z.enum(["available", "temporarily-unavailable", "archived"]),
  attribution: localizedTextSchema.optional(),
});

export type School = z.infer<typeof schoolSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Homepage = z.infer<typeof homepageSchema>;
export type Document = z.infer<typeof documentSchema>;

export const collectionSchemas = {
  schools: schoolSchema,
  events: eventSchema,
  entities: entitySchema,
  pages: homepageSchema,
  documents: documentSchema,
} as const;
