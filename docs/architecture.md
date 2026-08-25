# Arquitectura Tècnica

## Estat Actual

El repositori conté un workspace pnpm i una aplicació Astro estàtica a
`apps/web`, implementada fins a la fase 4. Integra TypeScript estricte,
Tailwind, Paraglide, Content Collections amb Zod, SEO tècnic, proves Vitest i
Playwright i workflows de qualitat i seguretat.

Les col·leccions registrades (`schools`, `events`, `entities`, `documents`,
`externalActions` i `contact`) passen per YAML restringit i una capa central de
publicació. La sortida actual inclou 66 rutes canòniques —22 per idioma—, més la
redirecció arrel, la 404 global, `robots.txt`, el sitemap, `/llms.txt` i els
recursos públics validats. Les dades de contacte es mostren al prepeu compartit
i a les pàgines legals; la pàgina de Contacte creada a la fase 3 es va retirar a
la T4.4.

La superfície «agèntica» del lloc es compon de `/llms.txt`, que orienta els
agents sobre el contingut i les seccions trilingües del lloc, i de les dades
estructurades JSON-LD de la portada: l'entitat institucional s'emet amb
descripció i dades de contacte (correu, telèfon i seu) normalitzades a text
pla. La 404 global enllaça `/llms.txt` i el sitemap perquè un agent pugui
recuperar-se d'una ruta inexistent.

La CI valida qualitat, E2E, commits, secrets, dependències i anàlisi estàtica.
El workflow `Artifact` (T5.2/T5.4) construeix i verifica l'artefacte de
producció a cada push a `main` i el job de desplegament, en el mateix run,
transfereix aquest artefacte a l'entorn GitHub `production` (restringit a
`main`, sense secrets al job de build). La T5.3 ha preparat la configuració i
les eines del servidor — `tools/server/` — (Caddyfile, bootstrap, CLI de
releases i gate SSH). L'analítica pública és Plausible CE autoallotjat a
`analytics.rogerbg.cat` ([ADR 0007](decisions/0007-self-hosted-plausible-analytics.md)).
El diagrama viu de la configuració del VPS és a
[`docs/runbook.md`](runbook.md#arquitectura-del-servidor). Lighthouse continua
sent una auditoria manual. L'apex ja serveix des del VPS (T5.5,
[runbook](runbook.md#9-tall-dns-i-primera-activació-pública)); encara no
existeixen previews de pull request ni cap servei Hono.

## Direcció Acceptada

La web és un lloc estàtic amb Astro i TypeScript. Les Content Collections
validades amb Zod modelen el contingut editorial, i Git n'és la font de veritat.
La direcció acceptada per a la fase 5 és servir-la amb Caddy des d'un VPS modest
de Hetzner, mantenint inicialment Hostinger com a DNS autoritatiu. La fase 6
avaluarà separadament l'arquitectura de previews i la necessitat real de
Cloudflare o de dominis wildcard.

La versió inicial no té base de dades, CMS, comptes d'usuari ni backend
d'aplicació renderitzat al servidor.

## Límits De L'Arquitectura

| Àrea                | Responsabilitat                               | Límit                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web estàtica        | Renderitzar contingut editorial publicat      | El build d'Astro no conté secrets                                                                                                                                                                           |
| Contingut           | Pàgines estructurades i dades de l'associació | Versionat a Git i revisat per pull request                                                                                                                                                                  |
| Xat públic          | Respondre preguntes sobre contingut publicat  | API Hono separada, de només lectura i sense accés editorial                                                                                                                                                 |
| Assistent editorial | Preparar canvis de contingut                  | Flux privat de branca, validació i pull request                                                                                                                                                             |
| Allotjament         | Servir la web estàtica i serveis aïllats      | Caddy i releases (T5.3); desplegament continu des de `main` (T5.4); apex al VPS (T5.5); rollback a `production-rollback`; sense desplegament des d'una sessió local d'agent                                 |
| Analítica           | Mesurar visites agregades de la web pública   | Plausible CE autoallotjat a `analytics.rogerbg.cat`; script asíncron; CSP sense comodins ni `unsafe-eval`; sense cookies ni tokens al build ([ADR 0007](decisions/0007-self-hosted-plausible-analytics.md)) |

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

`docs/code-conventions.md` és la font normativa del detall. Les desviacions que
la fase 4 va registrar respecte de l'ADR 0006 van quedar corregides amb la PR
#73: els components reben la selecció de domini resolta i el contracte del
`locale` dels helpers es deriva de les estructures de dades (regla 3 esmenada
de l'ADR 0006). Qualsevol desviació futura continua requerint una correcció
separada o un ADR que substitueixi aquesta frontera.

## Xat Públic, Més Endavant

El xat públic indexarà tot el contingut publicat, incloent-hi pàgines editorials
i els seus blocs, i no només models concrets. Començarà amb un índex JSON o
NDJSON generat i recuperació lèxica. Una base de dades vectorial o embeddings no
formen part del disseny inicial.

## Fora D'Abast Ara

- Servei de xat Hono i generador d'índex.
- Integració amb Telegram, Discord o Hermes.
- HSTS, període d'observació i retirada del gate de `production`, que resten
  accions supervisades de la T5.5.
- Previews, dominis efímers i possible integració amb Cloudflare fins a definir
  i implementar la fase 6.

Consulta els ADR de `docs/decisions/` per conèixer les decisions darrere
d'aquests límits.
