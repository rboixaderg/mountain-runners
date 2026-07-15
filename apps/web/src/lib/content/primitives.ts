import { z } from "zod";

export const localeSchema = z.enum(["ca", "es", "en"]);
export type Locale = z.infer<typeof localeSchema>;

export const knownLocales = localeSchema.options;
export const defaultLocale: Locale = "ca";

export function translatableSchema<T extends z.ZodType>(valueSchema: T) {
  return z.strictObject({
    ca: valueSchema,
    es: valueSchema.optional(),
    en: valueSchema.optional(),
  });
}

export type Translatable<T> = {
  ca: T;
  es?: T;
  en?: T;
};

export function hasCompleteTranslation<T>(
  value: Translatable<T>,
  locale: Locale,
  isComplete: (translatedValue: T) => boolean = () => true,
): boolean {
  const translatedValue = value[locale];
  return translatedValue !== undefined && isComplete(translatedValue);
}

export const nonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    error: "Expected a non-empty string",
  });

export const reservedSlugSegments = new Set([
  "_astro",
  "admin",
  "api",
  "ca",
  "en",
  "es",
]);

export function createSlugSchema(
  additionalReservedSegments: ReadonlySet<string> = new Set(),
) {
  return z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
      error: "Expected one lowercase ASCII kebab-case path segment",
    })
    .refine(
      (value) =>
        !reservedSlugSegments.has(value) &&
        !additionalReservedSegments.has(value),
      { error: "Slug is reserved" },
    );
}

export const slugSchema = createSlugSchema();

export function findDuplicateLocalizedSlugs(
  values: readonly Translatable<string>[],
): Partial<Record<Locale, string[]>> {
  const duplicates: Partial<Record<Locale, string[]>> = {};

  for (const locale of knownLocales) {
    const seen = new Set<string>();
    const repeated = new Set<string>();

    for (const value of values) {
      const slug = value[locale];
      if (slug === undefined) continue;

      if (seen.has(slug)) repeated.add(slug);
      seen.add(slug);
    }

    if (repeated.size > 0) duplicates[locale] = [...repeated].sort();
  }

  return duplicates;
}
