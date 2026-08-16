import type { Locale } from "./primitives";
import type { PublicationCatalog, PublishedVariant } from "./publication";
import type { School } from "./models";

export type PublishedSchoolVariant = Extract<
  PublishedVariant,
  { kind: "school" }
>;

// Selects the published school variants of one locale in hub order. This
// belongs to the domain layer: components and presentation helpers receive
// the selected variants and never filter the catalog themselves.
export function getOrderedPublishedSchoolVariants(
  catalog: PublicationCatalog,
  locale: Locale,
): PublishedSchoolVariant[] {
  const schoolVariants = catalog.variants.filter(
    (variant): variant is PublishedSchoolVariant =>
      variant.kind === "school" && variant.locale === locale,
  );
  return getOrderedSchoolVariants(schoolVariants);
}

// The hub lists published schools in the explicit editorial order declared by
// the `hubOrder` field of each entry, never in the order of the source files.
// Ties are resolved with the stable identifier so the order stays
// deterministic even when two entries share a position by mistake.
export function getOrderedSchools(schools: readonly School[]): School[] {
  return [...schools].sort((left, right) => {
    if (left.hubOrder !== right.hubOrder) {
      return left.hubOrder < right.hubOrder ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });
}

// Same editorial order applied to published variants so the hub can render
// the variant (path, slug) alongside its entry in one pass. The variants are
// expected to belong to a single locale, with at most one variant per school;
// the lookup is keyed by identifier so a duplicated variant can never cause
// entries to be silently dropped.
export function getOrderedSchoolVariants<T extends { entry: School }>(
  variants: readonly T[],
): T[] {
  const variantsById = new Map(
    variants.map((variant) => [variant.entry.id, variant] as const),
  );
  return getOrderedSchools(
    [...variantsById.values()].map(({ entry }) => entry),
  ).map((school) => variantsById.get(school.id)!);
}
