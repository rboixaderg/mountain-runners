# Arquitectura Tècnica

## Estat Actual

El repositori conté un workspace pnpm i una aplicació Astro estàtica a
`apps/web`, implementada fins a la fase 4. Integra TypeScript estricte,
Tailwind, Paraglide, Content Collections amb Zod, SEO tècnic, proves Vitest i
Playwright i workflows de qualitat i seguretat.

Les col·leccions registrades (`schools`, `events`, `entities`, `documents`,
`externalActions` i `contact`) passen per YAML restringit i una capa central de
publicació. La sortida actual inclou 48 rutes canòniques —16 per idioma—, més la
redirecció arrel, la 404 global, `robots.txt`, el sitemap i els recursos públics
validats. Les dades de contacte es mostren al prepeu compartit i a les pàgines
legals; la pàgina de Contacte creada a la fase 3 es va retirar a la T4.4.

La CI valida qualitat, E2E, commits, secrets, dependències i anàlisi estàtica.
El lint i el format de JS, TS, JSON, CSS i Astro els fa Biome; Prettier es
conserva per a Markdown i YAML, d'acord amb
l'[ADR 0007](decisions/0007-biome-and-typescript-7.md). Lighthouse continua
sent una auditoria manual. Encara no existeixen previews de pull request,
configuració Caddy, provisió del VPS ni automatització de desplegament, i
tampoc cap servei Hono.

## Direcció Acceptada

La web és un lloc estàtic amb Astro i TypeScript. Les Content Collections
validades amb Zod modelen el contingut editorial, i Git n'és la font de veritat.
La direcció acceptada per a la fase 5 és servir-la amb Caddy des d'un VPS modest.

La versió inicial no té base de dades, CMS, comptes d'usuari ni backend
d'aplicació renderitzat al servidor.

## Límits De L'Arquitectura

| Àrea                | Responsabilitat                               | Límit                                                               |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| Web estàtica        | Renderitzar contingut editorial publicat      | El build d'Astro no conté secrets                                   |
| Contingut           | Pàgines estructurades i dades de l'associació | Versionat a Git i revisat per pull request                          |
| Xat públic          | Respondre preguntes sobre contingut publicat  | API Hono separada, de només lectura i sense accés editorial         |
| Assistent editorial | Preparar canvis de contingut                  | Flux privat de branca, validació i pull request                     |
| Allotjament         | Servir la web estàtica i serveis aïllats      | Futur Caddy i CD; sense desplegament des d'una sessió local d'agent |

## Estructura De Pàgines I Presentació

Les pàgines segueixen una separació de capes fixada a la T3.1 de la fase 3 i
registrada a l'[ADR 0006](decisions/0006-presentation-layer-structure.md). El
detall operatiu —tipus de components, guards, constants tipades i regles de
decisió— viu a [`docs/code-conventions.md`](code-conventions.md):

| Capa        | Ubicació                | Responsabilitat                                                                            |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| Pàgines     | `src/pages/`            | Primes: `getStaticPaths`, càrrega de dades, metadades i composició de components i layouts |
| Domini      | `src/lib/content/`      | Selecció, ordenació, publicació i rutes del contingut editorial                            |
| Presentació | `src/lib/presentation/` | Funcions pures per locale: format de dates, estat, URL i dades de vista                    |
| Components  | `src/components/`       | Fragments de UI reutilitzables i plantilles de detall separades per tipus d'entrada        |

`docs/code-conventions.md` és la font normativa del detall. La implementació de
la fase 4 conserva algunes desviacions conegudes: la portada i el hub de domini
encara assumeixen més presentació de la prevista, alguns components fan selecció
de domini i diversos helpers independents de l'idioma ometen el `locale` exigit
per l'ADR. Aquest deute no modifica l'ADR 0006; s'ha de corregir en tasques
separades o justificar mitjançant un ADR que el substitueixi.

## Xat Públic, Més Endavant

El xat públic indexarà tot el contingut publicat, incloent-hi pàgines editorials
i els seus blocs, i no només models concrets. Començarà amb un índex JSON o
NDJSON generat i recuperació lèxica. Una base de dades vectorial o embeddings no
formen part del disseny inicial.

## Fora D'Abast Ara

- Servei de xat Hono i generador d'índex.
- Integració amb Telegram, Discord o Hermes.
- Previews, Caddy, desplegament continu i provisió del VPS.

Consulta els ADR de `docs/decisions/` per conèixer les decisions darrere
d'aquests límits.
