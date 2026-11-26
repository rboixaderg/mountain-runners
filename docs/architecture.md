# Arquitectura Tècnica

## Estat Actual

El repositori conté un workspace pnpm i una aplicació Astro estàtica a
`apps/web`. Integra TypeScript estricte, Tailwind, Paraglide, Content Collections
amb Zod, SEO tècnic, proves Vitest i Playwright i workflows de qualitat i
seguretat.

Les col·leccions passen per YAML restringit i una capa central de publicació.
Consulta el [model de contingut](content-model.md) per veure les col·leccions i
els criteris de publicació. Les dades de contacte es mostren al prepeu compartit
i a les pàgines legals.

`posts` disposa de llistats i detalls de notícies i blog, amb seleccions
explícites per al build públic i el de preview. Els constructors oficials fixen
`PUBLIC_PREVIEW=false` per a producció i `true` per a preview. Refusen valors
contradictoris. No s'utilitzen imports glob d'imatges editorials: poden emetre
originals de variants excloses.

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
pla. La 404 global conserva els enllaços a `/llms.txt` i al sitemap al DOM, dins
del desplegable natiu «Recursos tècnics». Un agent que llegeixi l'HTML els
pot descobrir directament; si navega per la interfície, ha d'obrir el
desplegable per recuperar-se d'una ruta inexistent.

La CI valida qualitat, E2E, commits, secrets, dependències i anàlisi estàtica.
El [runbook de producció](operations/web-and-releases.md) descriu el
desplegament des de `main`. El [runbook de previews](operations/previews.md#publicar-una-preview)
descriu el flux autoritzat per l'etiqueta `preview`. El diagrama del VPS és a
[`docs/operations/README.md`](operations/README.md#arquitectura-del-servidor).
No existeix cap servei Hono.

## Direcció Acceptada

La web és un lloc estàtic amb Astro i TypeScript. Les Content Collections
validades amb Zod modelen el contingut editorial, i Git n'és la font de veritat.
La direcció acceptada per a la fase 5 és servir-la amb Caddy des d'un VPS modest
de Hetzner, mantenint inicialment Hostinger com a DNS autoritatiu. Les previews
segueixen els ADR 0009 i 0010: artefacte i namespace separats, origen per PR,
caducitat i publicació autoritzada. L'excepció editorial de l'ADR 0011 no canvia
aquesta frontera de confiança.

La versió inicial no té base de dades, CMS, comptes d'usuari ni backend
d'aplicació renderitzat al servidor.

L'[ADR 0008](decisions/0008-request-observability.md) accepta una entrega
posterior d'observabilitat de peticions a l'origen. Caddy classificarà
transitòriament el `User-Agent` i només conservarà la família derivada al registre
d'accés de set dies; un resum local sense IP ni identificadors es podrà conservar
sense termini màxim. Aquesta direcció encara no descriu el comportament desplegat
i no introdueix cap servei extern ni canvia Plausible.

## Límits De L'Arquitectura

| Àrea                            | Responsabilitat                                 | Límit                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web estàtica                    | Renderitzar contingut editorial publicat        | El build d'Astro no conté secrets                                                                                                                                                                           |
| Contingut                       | Pàgines estructurades i dades de l'associació   | Versionat a Git i revisat per pull request                                                                                                                                                                  |
| Xat públic                      | Respondre preguntes sobre contingut publicat    | API Hono separada, de només lectura i sense accés editorial                                                                                                                                                 |
| Agent privat de desenvolupament | Consultar i preparar canvis de codi o contingut | [Frontera i permisos vigents](decisions/0013-private-development-agent-boundary.md#decisió-vigent)                                                                                                          |
| Allotjament                     | Servir la web estàtica i serveis aïllats        | [Arquitectura del servidor](operations/README.md#arquitectura-del-servidor)                                                                                                                                 |
| Analítica                       | Mesurar visites agregades de la web pública     | Plausible CE autoallotjat a `analytics.rogerbg.cat`; script asíncron; CSP sense comodins ni `unsafe-eval`; sense cookies ni tokens al build ([ADR 0007](decisions/0007-self-hosted-plausible-analytics.md)) |

## Estructura De Pàgines I Presentació

L'[ADR 0006](decisions/0006-presentation-layer-structure.md) fixa la separació
de capes. Les [convencions de codi](code-conventions.md) indiquen on viu cada
responsabilitat.

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

## Agent Privat De Desenvolupament

L'agent de la fase 8 és un servei privat al VPS, separat de la web de producció
i accessible des d'un grup privat de Telegram.

- [Mapa de l'agent privat](phase-8-system-map.html): components i connexions.
- [README de l'agent](../tools/server/agent/README.md): comportament implementat,
  recorregut d'una petició i estat de l'aplicació.
- [ADR 0013](decisions/0013-private-development-agent-boundary.md#decisió-vigent):
  frontera de confiança, permisos i controls del merge.
- [Operació de l'agent](operations/agent.md): instal·lació, actualització,
  verificació i recuperació.

## Xat Públic, Més Endavant

El xat públic indexarà tot el contingut publicat, incloent-hi pàgines editorials
i els seus blocs, i no només models concrets. Començarà amb un índex JSON o
NDJSON generat i recuperació lèxica. Una base de dades vectorial o embeddings no
formen part del disseny inicial.

## Fora D'Abast Ara

- Servei de xat Hono i generador d'índex.
- Noves integracions DNS/edge o proveïdors per a previews fora de la decisió
  acceptada de la fase 6.

Consulta els ADR de `docs/decisions/` per conèixer les decisions darrere
d'aquests límits.
