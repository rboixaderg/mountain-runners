import type { School } from "./models";

// The hub lists published schools in the explicit editorial order declared by
// the `hubOrder` field of each entry, never in the order of the source files.
// Ties are resolved with the stable identifier so the order stays
// deterministic even when two entries share a position by mistake.
export function getOrderedSchools(schools: readonly School[]): School[] {
  return [...schools].sort(
    (left, right) =>
      left.hubOrder - right.hubOrder || left.id.localeCompare(right.id),
  );
}

// Same editorial order applied to published variants so the hub can render
// the variant (path, slug) alongside its entry in one pass.
export function getOrderedSchoolVariants<T extends { entry: School }>(
  variants: readonly T[],
): T[] {
  return getOrderedSchools(variants.map(({ entry }) => entry)).map((school) =>
    variants.find(({ entry }) => entry.id === school.id)!,
  );
}
