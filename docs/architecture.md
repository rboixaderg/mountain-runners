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
pla. La 404 global conserva els enllaços a `/llms.txt` i al sitemap al DOM, dins
del desplegable natiu «Recursos tècnics». Un agent que llegeixi l'HTML els
pot descobrir directament; si navega per la interfície, ha d'obrir el
desplegable per recuperar-se d'una ruta inexistent.

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

| Àrea                            | Responsabilitat                                               | Límit                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web estàtica                    | Renderitzar contingut editorial publicat                      | El build d'Astro no conté secrets                                                                                                                                                                                |
| Contingut                       | Pàgines estructurades i dades de l'associació                 | Versionat a Git i revisat per pull request                                                                                                                                                                       |
| Xat públic                      | Respondre preguntes sobre contingut publicat                  | API Hono separada, de només lectura i sense accés editorial                                                                                                                                                      |
| Assistent editorial             | Preparar canvis de contingut                                  | Flux privat de branca, validació i pull request                                                                                                                                                                  |
| Agent privat de desenvolupament | Consultar i preparar canvis de codi o contingut fins a una PR | Component de confiança amb la credencial de GitHub; entorn aïllat sense xarxa ni credencials; sense desplegament, auto-merge ni push a `main` ([ADR 0013](decisions/0013-private-development-agent-boundary.md)) |
| Allotjament                     | Servir la web estàtica i serveis aïllats                      | Caddy i releases (T5.3); desplegament continu des de `main` (T5.4); apex al VPS (T5.5); rollback a `production-rollback`; sense desplegament des d'una sessió local d'agent                                      |
| Analítica                       | Mesurar visites agregades de la web pública                   | Plausible CE autoallotjat a `analytics.rogerbg.cat`; script asíncron; CSP sense comodins ni `unsafe-eval`; sense cookies ni tokens al build ([ADR 0007](decisions/0007-self-hosted-plausible-analytics.md))      |

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

## Agent Privat De Desenvolupament

La fase 8 prepara un servei privat al VPS, separat de producció, accessible des
d'un grup de Telegram amb temes de fòrum
([ADR 0013](decisions/0013-private-development-agent-boundary.md)). Cada tema és
una sessió de conversa; el treball viu a Git, a les especificacions i als ADR,
no en un gestor de tasques.

La frontera separa un component de confiança, que gestiona Telegram, el model i
les operacions de GitHub, de l'entorn aïllat que executa scripts, hooks,
dependències i proves del repositori. Només el component de confiança rep la
credencial de GitHub i només exposa la branca de treball, la PR i el merge
demanat amb `/merge <PR>`. L'entorn aïllat no llegeix credencials ni sessions i
no té xarxa per defecte.

L'agent no desplega, no fa push a `main`, no activa auto-merge i no modifica
proteccions. El merge continua sent una decisió humana: l'executa només amb la
petició explícita d'un membre verificat, fixada al commit de l'últim informe del
fil i amb les comprovacions obligatòries en verd. La petició de preview es
delega de la mateixa manera segons
l'[ADR 0009](decisions/0009-pr-previews-same-domain-and-own-branches.md).

La T8.3 separa el nucli Telegram i Pi a
[`packages/telegram-pi-bridge`](../packages/telegram-pi-bridge/README.md):
transport, autorització, cua duradora, identitat per tema i protocol RPC. És un
paquet ESM amb llicència MIT, API i proves propis, sense dependències npm ni
coneixement de GitHub, Docker o les regles del projecte. Es pot provar i
empaquetar fora d'aquest repositori; encara no està publicat a npm.
Les entrades `/telegram`, `/sessions` i `/pi` es carreguen per separat. Importar
només `/pi` no carrega Telegram ni SQLite.

L'aplicació de `tools/server/agent/` consumeix el paquet i li proporciona
`runInstruction`. `policy/development.mjs` conté les regles pures de prompts,
classificació, comprovació i metadades públiques. `workflow/project-runner.mjs`
les connecta amb les integracions. El coordinador `workflow/run-instruction.mjs`
rep operacions i rutes, sense tokens ni clients de Docker o GitHub. El perfil
de confiança, l'entorn aïllat i Git/GitHub continuen fora del paquet. El transport RPC no hereta l'entorn
secret del servei ni activa eines per defecte; l'adaptador del projecte tria
explícitament `sandbox_bash` i la neteja dels contenidors. Pi manté la credencial del proveïdor al host i no té
la `bash` del host: l'execució passa per l'extensió `sandbox_bash` i pel mateix
constructor d'arguments que el component de confiança. Tampoc exposa eines
natives de fitxers del host ni carrega automàticament context o skills del
repositori: el model els llegeix dins del contenidor. Les consultes usen un
muntatge de només lectura i no publiquen feina pendent.

El servei executa Podman local sense root, amb un espai d'usuari que conserva
l'UID/GID del worktree. Ni el pont ni Pi pertanyen al grup Docker ni reben un
socket de contenidors del host. La unitat delega el seu cgroup al runtime;
les proves reals de Podman a Linux i dels límits al VPS continuen pendents.

El component de Git selecciona explícitament metadades fora del muntatge,
rebutja alteracions del fitxer indicador `.git` i executa les ordres amb hooks
i fsmonitor desactivats i sense heretar els secrets del pont. Un worktree net
només es reinicia quan no conté commits pendents de publicació confirmada.
Abans del push s'inspeccionen els objectes nous de tot l'historial de
`origin/main..HEAD`, incloses versions esborrades i missatges de commit. Un
objecte il·legible o que supera el pressupost refusa la publicació. Els canvis
a `.github/**` i `CODEOWNERS` es rebutgen en qualsevol commit del rang. La
credencial prevista no té el permís `Workflows: write`. El push publica
exactament el SHA inspeccionat, sense forçar-lo. El
[mapa de mòduls](../tools/server/agent/README.md) diferencia el nucli
reutilitzable de l'aplicació i les seves fronteres. El merge demanat i la petició
delegada de preview continuen fora d'aquesta base (T8.4).

La base no s'ha desplegat ni activat: no existeix cap servei, bot, grup ni
credencial de la fase 8. L'aprovació de la frontera no activa permisos; els
controls essencials s'han de verificar abans del pilot i la resta de casos, a les
entregues posteriors. La instal·lació, la configuració, els límits pendents i
les comprovacions són a [`docs/deployment.md`](deployment.md#agent-privat-de-desenvolupament-t83).

## Xat Públic, Més Endavant

El xat públic indexarà tot el contingut publicat, incloent-hi pàgines editorials
i els seus blocs, i no només models concrets. Començarà amb un índex JSON o
NDJSON generat i recuperació lèxica. Una base de dades vectorial o embeddings no
formen part del disseny inicial.

## Fora D'Abast Ara

- Servei de xat Hono i generador d'índex.
- El servei operatiu de Telegram de la fase 8: l'ADR 0013 n'accepta la frontera i
  la base T8.3 existeix al repositori, però no s'ha desplegat ni activat cap
  servei, compte ni credencial.
- Noves integracions DNS/edge o proveïdors per a previews fora de la decisió
  acceptada de la fase 6.

Consulta els ADR de `docs/decisions/` per conèixer les decisions darrere
d'aquests límits.
