import type { EntityLink, EntityLinkKind } from "../content/models";

const entityLinkKindOrder: Record<EntityLinkKind, number> = {
  website: 0,
  instagram: 1,
  strava: 2,
  other: 3,
};

/**
 * Orders entity links for rendering: website first, then Instagram, then any
 * other link. Links with the same kind keep their content order, so the model
 * never duplicates ordering rules that belong to the presentation layer.
 */
export function getOrderedEntityLinks(
  links: readonly EntityLink[],
): EntityLink[] {
  return [...links].sort(
    (left, right) =>
      entityLinkKindOrder[left.kind] - entityLinkKindOrder[right.kind],
  );
}

/**
 * Returns the first URL of the given kind, or undefined when the entity has no
 * such link. Used by fixed layouts that reference a concrete profile, such as
 * the site footer social links.
 */
export function getEntityLinkUrl(
  links: readonly EntityLink[],
  kind: EntityLinkKind,
): string | undefined {
  return links.find((link) => link.kind === kind)?.url;
}
