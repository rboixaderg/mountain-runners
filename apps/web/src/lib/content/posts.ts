import { getMadridDate } from "./events";
import { postTypes, type Post, type PostType } from "./models";
import {
  findDuplicateLocalizedSlugs,
  hasCompleteTranslation,
  knownLocales,
  type Locale,
} from "./primitives";

export type PostVariant = {
  kind: PostType;
  locale: Locale;
  slug: string;
  entry: Post;
};

export type PostSource = {
  posts: readonly Post[];
  eventIds: ReadonlySet<string>;
};

function assertPostSource(source: PostSource, today: string): void {
  const ids = new Set<string>();
  for (const post of source.posts) {
    if (ids.has(post.id)) throw new Error(`Duplicate post id: ${post.id}`);
    ids.add(post.id);
    if (post.published && getMadridDate(new Date(post.publishedAt!)) > today) {
      throw new Error(`Post ${post.id} has a future publication date`);
    }
    for (const eventId of post.relatedEventIds ?? []) {
      if (!source.eventIds.has(eventId)) {
        throw new Error(`Post ${post.id} references missing event: ${eventId}`);
      }
    }
  }
  for (const type of Object.values(postTypes)) {
    const duplicates = findDuplicateLocalizedSlugs(
      source.posts
        .filter((post) => post.type === type)
        .map((post) => post.slug),
    );
    for (const [locale, slugs] of Object.entries(duplicates)) {
      throw new Error(
        `Duplicate ${type} slugs in ${locale}: ${slugs.join(", ")}`,
      );
    }
  }
}

function isPostComplete(post: Post, locale: Locale): boolean {
  return (
    [post.slug, post.title, post.summary, post.lead].every((value) =>
      hasCompleteTranslation(value, locale),
    ) &&
    post.sections.every(
      (section) =>
        hasCompleteTranslation(section.body, locale) &&
        (section.heading === undefined ||
          hasCompleteTranslation(section.heading, locale)) &&
        (section.images ?? []).every(
          (image) =>
            hasCompleteTranslation(image.alt, locale) &&
            hasCompleteTranslation(image.attribution, locale) &&
            (image.caption === undefined ||
              hasCompleteTranslation(image.caption, locale)),
        ),
    )
  );
}

function comparePostVariants(left: PostVariant, right: PostVariant): number {
  if (left.entry.published !== right.entry.published) {
    return left.entry.published ? -1 : 1;
  }
  if (left.entry.published) {
    return (
      Date.parse(right.entry.publishedAt!) -
        Date.parse(left.entry.publishedAt!) ||
      left.entry.id.localeCompare(right.entry.id)
    );
  }
  return (
    right.entry.createdAt.localeCompare(left.entry.createdAt) ||
    left.entry.id.localeCompare(right.entry.id)
  );
}

function createPostVariants(
  source: PostSource,
  today: string,
  includeDrafts: boolean,
): PostVariant[] {
  assertPostSource(source, today);
  return knownLocales.flatMap((locale) =>
    source.posts
      .filter(
        (post) =>
          (post.published || includeDrafts) && isPostComplete(post, locale),
      )
      .map((post) => ({
        kind: post.type,
        locale,
        slug: post.slug[locale]!,
        entry: post,
      }))
      .sort(comparePostVariants),
  );
}

export function createPublishedPostVariants(
  source: PostSource,
  today: string,
): PostVariant[] {
  return createPostVariants(source, today, false);
}

export function createPreviewPostVariants(
  source: PostSource,
  today: string,
): PostVariant[] {
  return createPostVariants(source, today, true);
}

export function getHomepagePostVariants(
  variants: readonly PostVariant[],
): PostVariant[] {
  return [...variants].sort(comparePostVariants).slice(0, 6);
}

export function getPostCover(post: Post, locale: Locale): Post["cover"] {
  const cover = post.cover;
  if (
    cover === undefined ||
    !hasCompleteTranslation(cover.alt, locale) ||
    !hasCompleteTranslation(cover.attribution, locale) ||
    (cover.caption !== undefined &&
      !hasCompleteTranslation(cover.caption, locale))
  ) {
    return undefined;
  }
  return cover;
}

export function getPostLocalResources(
  variants: readonly PostVariant[],
): string[] {
  const paths = new Set<string>();
  for (const variant of variants) {
    const cover = getPostCover(variant.entry, variant.locale);
    if (cover !== undefined) paths.add(cover.resource.path);
    for (const section of variant.entry.sections) {
      for (const image of section.images ?? []) paths.add(image.resource.path);
    }
  }
  return [...paths].sort();
}
