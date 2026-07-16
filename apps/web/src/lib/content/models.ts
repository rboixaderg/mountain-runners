import { z } from "zod";
import { parseRestrictedMarkdown } from "./markdown";
import {
  localeSchema,
  nonEmptyStringSchema,
  createSlugSchema,
  slugSchema,
  translatableSchema,
} from "./primitives";
import { safeResourceSchema } from "./resources";
import { httpsUrlSchema, mailtoUrlSchema, telUrlSchema } from "./urls";

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
const localizedPageSlugSchema = translatableSchema(
  createSlugSchema(new Set(["documents", "events", "schools"])),
);
const localizedHttpsUrlSchema = translatableSchema(httpsUrlSchema);

const imageSchema = z.strictObject({
  resource: safeResourceSchema,
  alt: localizedTextSchema,
  attribution: localizedTextSchema.optional(),
  sourceUrl: httpsUrlSchema.optional(),
});

const linkSchema = z.strictObject({
  label: localizedTextSchema,
  url: localizedHttpsUrlSchema,
});

const richTextBlockSchema = z.strictObject({
  type: z.literal("rich-text"),
  body: localizedMarkdownSchema,
});

const imageBlockSchema = z.strictObject({
  type: z.literal("image"),
  image: imageSchema,
});

const galleryBlockSchema = z.strictObject({
  type: z.literal("gallery"),
  images: z.array(imageSchema).min(1).max(20),
});

const linksBlockSchema = z.strictObject({
  type: z.literal("links"),
  links: z.array(linkSchema).min(1).max(20),
});

const documentsBlockSchema = z.strictObject({
  type: z.literal("documents"),
  documentIds: z.array(contentIdSchema).min(1).max(20),
});

export const pageBlockSchema = z.discriminatedUnion("type", [
  richTextBlockSchema,
  imageBlockSchema,
  galleryBlockSchema,
  linksBlockSchema,
  documentsBlockSchema,
]);

const navigationItemSchema = z.strictObject({
  id: contentIdSchema,
  label: localizedTextSchema,
  path: localizedSlugSchema,
});

const footerLinkSchema = z.strictObject({
  label: localizedTextSchema,
  url: localizedHttpsUrlSchema,
});

export const siteSchema = z.strictObject({
  id: z.literal("site"),
  name: localizedTextSchema,
  defaultLocale: z.literal("ca"),
  locales: z.tuple([z.literal("ca"), z.literal("es"), z.literal("en")]),
  navigation: z.array(navigationItemSchema).min(1).max(12),
  contact: z.strictObject({
    email: mailtoUrlSchema,
    phone: telUrlSchema.optional(),
    address: localizedTextSchema,
    openingHours: localizedTextSchema.optional(),
  }),
  socialLinks: z.array(httpsUrlSchema).max(12),
  legalLinks: z.array(footerLinkSchema).max(12),
  footerText: localizedTextSchema,
});

const publishableFields = {
  id: contentIdSchema,
  published: z.boolean(),
  slug: localizedSlugSchema,
};

export const pageSchema = z.strictObject({
  ...publishableFields,
  slug: localizedPageSlugSchema,
  title: localizedTextSchema,
  summary: localizedTextSchema,
  seoTitle: localizedTextSchema,
  seoDescription: localizedTextSchema,
  blocks: z.array(pageBlockSchema).min(1).max(50),
});

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

export type Site = z.infer<typeof siteSchema>;
export type Page = z.infer<typeof pageSchema>;
export type School = z.infer<typeof schoolSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Document = z.infer<typeof documentSchema>;
export type PageBlock = z.infer<typeof pageBlockSchema>;

export const collectionSchemas = {
  site: siteSchema,
  pages: pageSchema,
  schools: schoolSchema,
  events: eventSchema,
  entities: entitySchema,
  documents: documentSchema,
} as const;
