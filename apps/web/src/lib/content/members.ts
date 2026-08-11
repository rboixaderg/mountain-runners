import type { Entity } from "./models";
import type { Locale } from "./primitives";
import type { PublicationCatalog } from "./publication";

export const institutionalEntityId = "mountain-runners";

// The Members directory derives exclusively from published entities that carry
// a membership benefit, in stable alphabetical order by localized name. The
// editorial list is not duplicated in translation resources or page YAML.
export function getMembersDirectoryEntities(
  catalog: PublicationCatalog,
  locale: Locale,
): Entity[] {
  return [...catalog.entities.values()]
    .filter((entity) => entity.membershipBenefit !== undefined)
    .sort((left, right) =>
      left.name[locale]!.localeCompare(right.name[locale]!, locale),
    );
}
