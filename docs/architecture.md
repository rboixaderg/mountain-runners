# Arquitectura Tècnica

## Estat Actual

El repositori conté un workspace pnpm i una aplicació Astro estàtica a
`apps/web`, implementada fins a la fase 4. Integra TypeScript estricte,
Tailwind, Paraglide, Content Collections amb Zod, SEO tècnic, proves Vitest i
Playwright i workflows de qualitat i seguretat.

Les col·leccions registrades (`schools`, `events`, `entities`, `documents`,
`externalActions`, `contact` i `posts`) passen per YAML restringit i una capa central de
publicació. Aquesta branca inclou 75 rutes canòniques, 27 en català i 24 en cada altre idioma, més la
redirecció arrel, la 404 global, `robots.txt`, el sitemap, `/llms.txt` i els
recursos públics validats. Les dades de contacte es mostren al prepeu compartit
i a les pàgines legals; la pàgina de Contacte creada a la fase 3 es va retirar a
la T4.4.

`posts` disposa d'esquema, hubs i detalls i seleccions explícites pública i de
preview. La notícia del local i els dos articles de blog estan marcats per
publicar amb aprovació editorial del 8 d'octubre de 2026, només en català.
Els esborranys de prova continuen aïllats del build públic. Els posts no modifiquen el catàleg públic de les altres col·leccions. Les cobertes
seleccionades es renderitzen amb derivades WebP. Els
constructors oficials fixen `PUBLIC_PREVIEW=false` per a producció i `true` per
a preview, rebutjant flags contradictoris. No s'utilitzen imports glob d'imatges
editorials: poden emetre originals de variants excloses.

Les cobertes editorials seleccionades es transformen amb `sharp` durant el
build, sense imports d'imatges a Vite. La ruta estàtica `editorial-images/`
genera WebP de 480 i 1200 píxels, sense ampliar originals més petits, amb
orientació corregida i sense conservar metadades EXIF. Només rep paths locals
validats i seleccionats pel mode de build. No és un servei dinàmic ni permet
transformar paths arbitraris a petició.

Sharp és una dependència de build amb llicència Apache-2.0; libvips utilitza
LGPL-2.1-or-later. Aquestes llicències no substitueixen els drets dels originals.

Les seccions editorials també admeten imatges locals opcionals. El mateix
endpoint transforma només els recursos de variants completes seleccionades;
el render alterna imatge/text en escriptori i apila text/imatge en mòbil. La
completesa inclou els textos de les imatges declarades, a diferència de la
coberta opcional que es pot ometre en una traducció incompleta.

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
[runbook](runbook.md#9-tall-dns-i-primera-activació-pública)); les previews de
pull request ja són operatives mitjançant el workflow `Preview`, amb petició
explícita `/preview` i publicador de confiança des de `main`.
No existeix cap servei Hono.

## Direcció Acceptada

La web és un lloc estàtic amb Astro i TypeScript. Les Content Collections
validades amb Zod modelen el contingut editorial, i Git n'és la font de veritat.
La direcció acceptada per a la fase 5 és servir-la amb Caddy des d'un VPS modest
de Hetzner, mantenint inicialment Hostinger com a DNS autoritatiu. Les previews
segueixen els ADR 0009 i 0010: artefacte i namespace separats, origen per PR,
caducitat i publicació autoritzada. L'excepció editorial de l'ADR 0011 no canvia
aquesta frontera de confiança ni declara completada tota la fase 6.

La versió inicial no té base de dades, CMS, comptes d'usuari ni backend
d'aplicació renderitzat al servidor.

L'[ADR 0008](decisions/0008-request-observability.md) accepta una entrega
posterior d'observabilitat de peticions a l'origen. Caddy classificarà
transitòriament el `User-Agent` i només conservarà la família derivada al registre
d'accés de set dies; un resum local sense IP ni identificadors es podrà conservar
sense termini màxim. Aquesta direcció encara no descriu el comportament desplegat
i no introdueix cap servei extern ni canvia Plausible.

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

### Composició editorial

La portada carrega la mateixa selecció editorial del mode de build i en passa
fins a sis variants de l'idioma actual a la secció d'actualitat. La secció
combina notícies i blog en un carrusel manual sense dependències noves i no es
renderitza quan la selecció és buida. No consulta col·leccions des del component.

El detall editorial composa `PostHeader`, `PostCover`, `PostBody`,
`PostMembersLink`, `PostSources` i `PostRelatedEvents`.
Cada secció és propietària dels missatges, les dades que presenta i la seva
condició de visibilitat. La pàgina carrega les variants i les referències
publicades; els components no consulten les col·leccions.

## Xat Públic, Més Endavant

El xat públic indexarà tot el contingut publicat, incloent-hi pàgines editorials
i els seus blocs, i no només models concrets. Començarà amb un índex JSON o
NDJSON generat i recuperació lèxica. Una base de dades vectorial o embeddings no
formen part del disseny inicial.

## Fora D'Abast Ara

- Servei de xat Hono i generador d'índex.
- Integració amb Telegram, Discord o Hermes.
- Noves integracions DNS/edge o proveïdors per a previews fora de la decisió
  acceptada de la fase 6.

Consulta els ADR de `docs/decisions/` per conèixer les decisions darrere
d'aquests límits.
