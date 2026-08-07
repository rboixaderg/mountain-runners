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

// Fixed pages follow the same localized route contract as content domains.
// Only the Catalan variant is published until every rendered datum of a
// variant is complete and reviewed, so the page files use the Catalan segment.
export const fixedPageRouteSegments = {
  about: {
    ca: "qui-som",
    es: "quienes-somos",
    en: "about",
  },
  members: {
    ca: "socis",
    es: "socios",
    en: "members",
  },
} as const;

export type FixedPageKind = keyof typeof fixedPageRouteSegments;

export function assertFixedPageRouteSegments(
  segments: Record<FixedPageKind, Record<Locale, string>>,
): void {
  for (const locale of knownLocales) {
    const seen = new Set<string>();

    for (const [kind, localizedSegments] of Object.entries(segments)) {
      const segment = localizedSegments[locale];
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment)) {
        throw new Error(
          `Invalid ${locale} ${kind} fixed page segment: ${segment}`,
        );
      }
      if (
        technicalRouteSegments.has(segment) ||
        fixedRouteSegments.has(segment)
      ) {
        throw new Error(
          `Reserved ${locale} ${kind} fixed page segment: ${segment}`,
        );
      }
      if (seen.has(segment)) {
        throw new Error(`Duplicate ${locale} fixed page segment: ${segment}`);
      }
      seen.add(segment);
    }

    const contentDomainSegments = new Set(
      Object.values(routeDomains).map((domain) => domain[locale]),
    );
    for (const segment of seen) {
      if (contentDomainSegments.has(segment)) {
        throw new Error(
          `Fixed page segment collides with a content domain: ${locale}/${segment}`,
        );
      }
    }
  }
}

assertFixedPageRouteSegments(fixedPageRouteSegments);

export function getFixedPagePath(kind: FixedPageKind, locale: Locale): string {
  return `/${locale}/${fixedPageRouteSegments[kind][locale]}/`;
}

// Detail templates are enabled here as their specification task ships.
const publicDetailRouteKinds = new Set<RouteKind>(["event"]);

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

export function getPublicDetailVariants(
  catalog: PublicationCatalog,
): PublishedVariant[] {
  return catalog.variants.filter(({ kind }) =>
    publicDetailRouteKinds.has(kind),
  );
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
  const hubLocales = new Set(
    catalog.variants
      .filter(({ kind }) => kind === "event")
      .map(({ locale }) => locale),
  );
  // Fixed pages are published only in Catalan while single-locale, matching
  // the homepage entry below. A fixed page is added here once its variant is
  // complete and published.
  const publishedFixedPagePaths = [
    getFixedPagePath("about", "ca"),
    getFixedPagePath("members", "ca"),
  ];
  return [
    new URL("/ca/", site).toString(),
    ...[...hubLocales]
      .sort()
      .map((locale) =>
        new URL(getDomainPath("event", locale), site).toString(),
      ),
    ...getPublicDetailVariants(catalog).map((variant) =>
      getCanonicalUrl(variant, site),
    ),
    ...publishedFixedPagePaths.map((path) => new URL(path, site).toString()),
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
