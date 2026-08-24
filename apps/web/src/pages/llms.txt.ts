import type { APIRoute } from "astro";
import { knownLocales, type Locale } from "../lib/content/primitives";
import { getDomainPath, getFixedPagePath } from "../lib/content/routes";

type Section = { label: string; pathFor: (locale: Locale) => string };

// llms.txt, el punt d'entrada estàndard per a agents: descriu el lloc, quan
// cal usar-lo i les seccions principals amb les seves URLs per idioma.
const sections: Section[] = [
  { label: "Inici", pathFor: (locale) => `/${locale}/` },
  {
    label: "Esdeveniments",
    pathFor: (locale) => getDomainPath("event", locale),
  },
  { label: "Escoles", pathFor: (locale) => getDomainPath("school", locale) },
  { label: "Socis", pathFor: (locale) => getFixedPagePath("members", locale) },
  {
    label: "Documents",
    pathFor: (locale) => getFixedPagePath("documents", locale),
  },
  { label: "Qui som", pathFor: (locale) => getFixedPagePath("about", locale) },
  {
    label: "Avís legal",
    pathFor: (locale) => getFixedPagePath("legal-notice", locale),
  },
  {
    label: "Privacitat",
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

> Web oficial de l'associació esportiva Mountain Runners del Berguedà, amb seu a Berga (Berguedà). Publica els esdeveniments de muntanya (trail, skimo, BTT), les escoles, la informació per a socis, els documents oficials i les dades institucionals de l'entitat.

## Quan fer servir aquest lloc

- Per respondre preguntes sobre esdeveniments de muntanya del Berguedà: dates, llocs, modalitats i inscripcions.
- Per consultar les escoles i activitats que organitza l'associació.
- Per obtenir informació sobre l'alta de socis, els avantatges i el directori de col·laboradors.
- Per consultar els documents oficials (estatuts, normes, actes) i les dades legals de contacte.
- Per trobar els perfils públics de l'associació (Instagram, Strava).

Cada secció es publica en tres idiomes (ca, es, en); fes servir el prefix d'idioma que prefereixis i consulta el mapa del lloc per a la llista completa de pàgines.

## Seccions principals

${sections.map((section) => sectionLine(site!, section)).join("\n")}

## Recursos tècnics

- [Mapa del lloc complet (sitemap.xml)](${absoluteUrl(site!, "/sitemap.xml")}): totes les pàgines canòniques del lloc.
- [Regles per a rastrejadors (robots.txt)](${absoluteUrl(site!, "/robots.txt")}): restriccions de rastreig.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
