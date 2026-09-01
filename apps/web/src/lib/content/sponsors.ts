import type { Entity } from "./models";
import type { Locale } from "./primitives";
import type { PublicationCatalog } from "./publication";

// The pre-footer sponsors wall derives exclusively from published entities
// marked as sponsors, in stable alphabetical order by localized name. The
// editorial list is not duplicated in translation resources or page YAML.
export function getSponsorEntities(
  catalog: PublicationCatalog,
  locale: Locale,
): Entity[] {
  return [...catalog.entities.values()]
    .filter((entity) => entity.sponsor === true)
    .sort((left, right) =>
      left.name[locale]!.localeCompare(right.name[locale]!, locale),
    );
}
