import type { APIRoute } from "astro";
import { knownLocales, type Locale } from "../lib/content/primitives";
import { getDomainPath, getFixedPagePath } from "../lib/content/routes";

type Section = { label: string; pathFor: (locale: Locale) => string };

// llms.txt, the standard entry point for AI agents: describes the site, when
// to use it and the main sections with their per-language URLs.
const sections: Section[] = [
  { label: "Home", pathFor: (locale) => `/${locale}/` },
  {
    label: "Events",
    pathFor: (locale) => getDomainPath("event", locale),
  },
  { label: "Schools", pathFor: (locale) => getDomainPath("school", locale) },
  {
    label: "Members",
    pathFor: (locale) => getFixedPagePath("members", locale),
  },
  {
    label: "Documents",
    pathFor: (locale) => getFixedPagePath("documents", locale),
  },
  { label: "About", pathFor: (locale) => getFixedPagePath("about", locale) },
  {
    label: "Legal notice",
    pathFor: (locale) => getFixedPagePath("legal-notice", locale),
  },
  {
    label: "Privacy",
    pathFor: (locale) => getFixedPagePath("legal-privacy", locale),
  },
  {
    label: "Cookies",
    pathFor: (locale) => getFixedPagePath("legal-cookies", locale),
  },
];

function absoluteUrl(site: URL, path: string): string {
  return new URL(path, site).toString();
}

function sectionLine(site: URL, section: Section): string {
  const links = knownLocales
    .map(
      (locale) => `[${locale}](${absoluteUrl(site, section.pathFor(locale))})`,
    )
    .join(" · ");
  return `- ${section.label}: ${links}`;
}

export const GET: APIRoute = ({ site }) => {
  const body = `# Mountain Runners del Berguedà

> Official website of the Mountain Runners del Berguedà sports association, based in Berga (Berguedà). Publishes mountain events (trail, skimo, BTT), the schools, membership information, official documents and the institutional data of the entity.

## When to use this site

- To answer questions about mountain events in Berguedà: dates, locations, modalities and registrations.
- To consult the schools and activities organized by the association.
- To get information about membership, benefits and the directory of collaborators.
- To consult official documents (statutes, regulations, minutes) and legal contact data.
- To find the public profiles of the association (Instagram, Strava).

Each section is published in three languages (ca, es, en); use the language prefix you prefer and consult the site map for the complete list of pages.

## Main sections

${sections.map((section) => sectionLine(site!, section)).join("\n")}

## Technical resources

- [Full site map (sitemap.xml)](${absoluteUrl(site!, "/sitemap.xml")}): all canonical pages of the site.
- [Crawler rules (robots.txt)](${absoluteUrl(site!, "/robots.txt")}): crawling restrictions.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
