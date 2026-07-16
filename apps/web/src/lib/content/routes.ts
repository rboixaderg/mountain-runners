import type { PublishedVariant, PublicationCatalog } from "./publication";

export function getVariantPath(variant: PublishedVariant): string {
  const prefix = `/${variant.locale}`;
  switch (variant.kind) {
    case "page":
      return `${prefix}/${variant.slug}/`;
    case "school":
      return `${prefix}/schools/${variant.slug}/`;
    case "event":
      return `${prefix}/events/${variant.slug}/`;
  }
}

export function getAlternateVariants(
  catalog: PublicationCatalog,
  variant: PublishedVariant,
): PublishedVariant[] {
  return catalog.variants.filter(
    (candidate) =>
      candidate.kind === variant.kind &&
      candidate.entry.id === variant.entry.id,
  );
}
