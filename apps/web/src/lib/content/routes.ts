import type { PublishedVariant, PublicationCatalog } from "./publication";
import { knownLocales, type Locale } from "./primitives";

export type RouteKind = PublishedVariant["kind"];

type RouteDomains = Record<RouteKind, Record<Locale, string>>;

const technicalRouteSegments = new Set([
  "404.html",
  "_astro",
  "admin",
  "api",
  "content-resources",
]);

const fixedRouteSegments = new Set<string>(knownLocales);

export const routeDomains: RouteDomains = {
  school: {
    ca: "escoles",
    es: "escuelas",
    en: "schools",
  },
  event: {
    ca: "esdeveniments",
    es: "eventos",
    en: "events",
  },
};

export function assertRouteDomains(domains: RouteDomains): void {
  for (const locale of knownLocales) {
    const seen = new Set<string>();

    for (const [kind, localizedDomains] of Object.entries(domains)) {
      const domain = localizedDomains[locale];
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(domain)) {
        throw new Error(`Invalid ${locale} ${kind} route domain: ${domain}`);
      }
      if (
        technicalRouteSegments.has(domain) ||
        fixedRouteSegments.has(domain)
      ) {
        throw new Error(`Reserved ${locale} ${kind} route domain: ${domain}`);
      }
      if (seen.has(domain)) {
        throw new Error(`Duplicate ${locale} route domain: ${domain}`);
      }
      seen.add(domain);
    }
  }
}

assertRouteDomains(routeDomains);

export function getRouteDomain(kind: RouteKind, locale: Locale): string {
  return routeDomains[kind][locale];
}

export function getDomainPath(kind: RouteKind, locale: Locale): string {
  return `/${locale}/${getRouteDomain(kind, locale)}/`;
}

export function getVariantPath(variant: PublishedVariant): string {
  return `${getDomainPath(variant.kind, variant.locale)}${variant.slug}/`;
}

export function getCanonicalUrl(variant: PublishedVariant, site: URL): string {
  return new URL(getVariantPath(variant), site).toString();
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

export function getLocalizedAlternatives(
  catalog: PublicationCatalog,
  variant: PublishedVariant,
  site: URL,
): { locale: Locale; href: string }[] {
  return getAlternateVariants(catalog, variant).map((alternate) => ({
    locale: alternate.locale,
    href: getCanonicalUrl(alternate, site),
  }));
}

export function getSitemapUrls(
  catalog: PublicationCatalog,
  site: URL,
): string[] {
  return [
    new URL("/ca/", site).toString(),
    ...catalog.variants.map((variant) => getCanonicalUrl(variant, site)),
  ].sort();
}

export function assertUniquePublishedPaths(catalog: PublicationCatalog): void {
  const paths = new Set<string>();
  for (const variant of catalog.variants) {
    const path = getVariantPath(variant);
    if (paths.has(path)) {
      throw new Error(`Duplicate published route: ${path}`);
    }
    paths.add(path);
  }
}
