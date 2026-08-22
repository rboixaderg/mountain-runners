import { knownLocales, type Locale } from "../content/primitives";
import {
  fixedPageRouteSegments,
  routeDomains,
  type FixedPageKind,
} from "../content/routes";
import { analyticsPageTypes, type AnalyticsPageType } from "./catalog";

const legalFixedPageKinds = new Set<FixedPageKind>([
  "legal-notice",
  "legal-privacy",
  "legal-cookies",
]);

const fixedPageAnalyticsTypes: Partial<
  Record<FixedPageKind, AnalyticsPageType>
> = {
  about: analyticsPageTypes.about,
  documents: analyticsPageTypes.documents,
  members: analyticsPageTypes.members,
};

function isKnownLocale(value: string): value is Locale {
  return knownLocales.includes(value as Locale);
}

export function getAnalyticsPageType(pathname: string): AnalyticsPageType {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return analyticsPageTypes.other;
  }

  const [localeCandidate, firstSegment, slug] = segments;
  if (!isKnownLocale(localeCandidate)) {
    return analyticsPageTypes.other;
  }

  if (firstSegment === undefined) {
    return analyticsPageTypes.home;
  }

  if (slug === undefined) {
    for (const [kind, localizedSegments] of Object.entries(
      fixedPageRouteSegments,
    )) {
      if (localizedSegments[localeCandidate] === firstSegment) {
        if (legalFixedPageKinds.has(kind as FixedPageKind)) {
          return analyticsPageTypes.legal;
        }

        return (
          fixedPageAnalyticsTypes[kind as FixedPageKind] ??
          analyticsPageTypes.other
        );
      }
    }

    for (const [kind, localizedDomains] of Object.entries(routeDomains)) {
      if (localizedDomains[localeCandidate] === firstSegment) {
        return kind === "event"
          ? analyticsPageTypes.eventsHub
          : analyticsPageTypes.schoolsHub;
      }
    }

    return analyticsPageTypes.other;
  }

  for (const [kind, localizedDomains] of Object.entries(routeDomains)) {
    if (localizedDomains[localeCandidate] === firstSegment) {
      return kind === "event"
        ? analyticsPageTypes.eventDetail
        : analyticsPageTypes.schoolDetail;
    }
  }

  return analyticsPageTypes.other;
}
