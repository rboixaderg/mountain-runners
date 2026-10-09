import { postTypes } from "./models";
import { knownLocales } from "./primitives";
import { getDomainPath, getVariantPath } from "./routes";
import { getPostCover, type PostVariant } from "./posts";
import { getPostImageHref } from "./post-images";
import type { StructuredData } from "./seo";

export function getPostAlternatives(
  variants: readonly PostVariant[],
  variant: PostVariant,
  site: URL,
) {
  return variants
    .filter(
      (candidate) =>
        candidate.kind === variant.kind &&
        candidate.entry.id === variant.entry.id,
    )
    .map((candidate) => ({
      locale: candidate.locale,
      href: new URL(getVariantPath(candidate), site).toString(),
    }));
}

export function getPostSitemapUrls(
  variants: readonly PostVariant[],
  site: URL,
): string[] {
  return [
    ...knownLocales.flatMap((locale) =>
      Object.values(postTypes).map((kind) =>
        new URL(getDomainPath(kind, locale), site).toString(),
      ),
    ),
    ...variants
      .filter(({ entry }) => entry.published)
      .map((variant) => new URL(getVariantPath(variant), site).toString()),
  ];
}

export function getPostSocialImage(variant: PostVariant, site: URL) {
  const cover = getPostCover(variant.entry, variant.locale);
  if (cover === undefined) return undefined;
  return {
    alt: cover.alt[variant.locale]!,
    url: new URL(getPostImageHref(cover.resource.path, 1200), site).toString(),
  };
}

export function getPostJsonLd(
  variant: PostVariant,
  site: URL,
): StructuredData | undefined {
  const { entry, locale, kind } = variant;
  if (!entry.published) return undefined;
  const image = getPostSocialImage(variant, site);
  return {
    "@context": "https://schema.org",
    "@type": kind === postTypes.news ? "NewsArticle" : "BlogPosting",
    headline: entry.title[locale],
    description: entry.summary[locale],
    inLanguage: locale,
    mainEntityOfPage: new URL(getVariantPath(variant), site).toString(),
    author: {
      "@type": entry.author.type === "organization" ? "Organization" : "Person",
      name: entry.author.name,
    },
    datePublished: entry.publishedAt,
    ...(entry.updatedAt ? { dateModified: entry.updatedAt } : {}),
    ...(image ? { image: image.url } : {}),
  };
}
