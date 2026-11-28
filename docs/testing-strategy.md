# Estratègia de proves

## Objectiu i abast

Conservar el conjunt més petit de proves que detecti les regressions rellevants.
El criteri és la garantia que aporta cada prova, no el recompte ni un percentatge
de cobertura. Aquesta guia governa les proves noves i les revisions de proves;
no afirma que totes les suites existents ja la compleixin.

La web és Astro estàtic. Vitest cobreix lògica i render; Playwright prova el build
i el comportament al navegador. Les proves operatives de Node cobreixen les
eines de servidor, el paquet `telegram-pi-bridge` i el desplegament. Una prova
operativa verifica la resolució d'imports del servei instal·lat, sense
credencials ni serveis externs. Les proves del paquet carreguen
cada entrada pública en un procés nou i bloquegen les dependències alienes.
Les regles pures del consumidor es proven a `tools/server/agent/policy/`; les
proves operatives conserven els recorreguts fins a PR i els errors remots de
resultat desconegut. La publicació prova secrets en commits anteriors,
pressupostos d'inspecció, objectes il·legibles i rutes protegides, sense xarxa.
El contracte del runtime prova els arguments complets, l'entorn mínim i la
neteja amb un executable simulat. Les proves reals del sandbox de T8.3
requereixen Linux, Podman local sense root i una imatge ja disponible mitjançant
`MR_ISOLATION_TEST_IMAGE`; sense aquesta variable se salten, també a la CI
ordinària. El perfil real de Pi requereix `MR_AGENT_PI_COMMAND` i també se
salta per defecte. Cap d'aquestes omissions demostra l'aïllament al VPS.
El perfil de l'agent executa la prova de recursos editorials de
`pnpm test:build-contracts` només amb Chromium abans d'obrir la PR. La CI
conserva els tres navegadors en aquesta prova i als E2E; una fallada de la CI
impedeix el merge.

Aquest document és la font de veritat per triar el nivell de prova, dissenyar
expectatives i revisar cobertura. Prevalen els ADR i les
[convencions de codi](code-conventions.md).

## Triar el nivell

Abans d'escriure una prova, identifica la regressió que ha de detectar. Tria el
nivell menys costós que la pugui demostrar. Afegeix una prova d'integració quan
calgui comprovar que les peces estan connectades.

| Nivell             | Què comprova                                                                      | Exemples                                                                                  | Eina existent                                                   |
| ------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Unitari            | Regles pures, combinacions i límits amb entrades i resultats concrets             | Publicació, traduccions incompletes, límits temporals, agrupació per dia                  | Vitest a `apps/web/src/test/`                                   |
| Render Astro       | Contracte d'un component o layout en l'HTML generat                               | Escaping JSON-LD, atributs, seccions condicionals, estats de detall amb dades sintètiques | Vitest i Astro Container                                        |
| Contracte de build | Connexió entre contingut, pàgines i artefacte publicat                            | JSON-LD per plantilla, canonical, sitemap, robots, exclusió de recursos privats           | Verificadors de `apps/web/scripts/` o Playwright sobre el build |
| E2E amb navegador  | Comportament observable que depèn del navegador i de la col·laboració entre peces | Navegació, canvi d'idioma, teclat, menú, popover, límits mòbils                           | Playwright a `apps/web/e2e/`                                    |
| Operatiu           | Fronteres de servidor, processos i publicació                                     | Autorització, arxius, CSP, contractes HTTP, restauració                                   | `node --test` a `tools/`                                        |
| Auditoria          | Propietats transversals i aspectes que requereixen inspecció                      | axe, Lighthouse, focus visible, lectura i contrast                                        | Comprovacions automàtiques i revisió manual                     |

Una prova executada amb Playwright no és necessàriament un recorregut E2E. Un
contracte estàtic de JSON-LD no guanya confiança repetint-se en sis combinacions
de navegador i viewport. Els nous contractes estàtics s'executen una vegada,
amb els idiomes i plantilles que afecten el resultat. No es redueix una matriu
existent sense justificar la garantia que es conserva.

Els recorreguts funcionals i responsius mantenen la cobertura de navegadors i
viewports aplicable del [quality gate](../.agents/skills/quality-gate/SKILL.md).
La matriu de rutes protegeix també l'overflow del contingut traduït: no és una
duplicació del contracte estàtic de metadades.

### Exemple del calendari

- Unitari: dos esdeveniments el mateix dia queden agrupats; un esdeveniment de
  tres dies apareix als tres dies; els rangs travessen mesos i anys.
- Render o build: cada dia amb esdeveniments té un control amb el nom accessible
  correcte. El recompte és de dies, no de títols diferents.
- E2E: l'usuari obre el dia, veu els esdeveniments i hi navega; el popover respon
  al teclat i no surt dels límits mòbils.

Aquests nivells protegeixen regressions diferents. L'E2E no substitueix les
combinacions i casos límit de la unitària.

## Dissenyar expectatives i aïllament

- El nom de la prova descriu en anglès el resultat i el context que el provoca,
  no una crida interna.
- A les unitàries de regles, usa exemples concrets amb resultats independents.
  No calculis el resultat esperat amb el mateix helper que proves.
- Al build, deriva les entrades del catàleg publicat quan el contracte sigui
  editorial: no fixis la llista o el recompte actual d'esdeveniments. Les
  expectatives estructurals de plantilla sí que es fixen explícitament.
- Reutilitzar selecció o ordenació de producció en una prova de connexió és
  acceptable si aquestes regles tenen casos independents al nivell inferior.
  El mateix error en esperat i resultat no ha de deixar tota la cobertura verda.
- Comprova la presència o absència de metadades segons el contracte, no amb una
  condició que només les valida si ja existeixen al DOM.
- Mantén reals els col·laboradors interns que formen part del comportament.
  Substitueix només la frontera externa necessària. Un mock del repositori pot
  resoldre la manca de col·leccions dins d'Astro Container, però aquella prova
  no demostra la publicació ni la connexió de la pàgina al catàleg.
- Aïlla analítica, embeds i altres peticions externes al navegador. Declara les
  peticions permeses i fes fallar les inesperades quan sigui viable. No provis
  disponibilitat remota com a garantia del nostre codi.
- Mantén cada prova independent. Neteja timers, mocks i estat client quan els
  modifiquis. No depenguis de l'ordre d'execució.
- Build i expectatives comparteixen origen, data de referència i mode preview.
  No barregis la data fixada al build amb el rellotge real dels tests.

## Navegador i contractes no visibles

En recorreguts d'usuari, prioritza rol i nom accessible, etiqueta, text visible
i relacions semàntiques. Les classes CSS no són hooks de prova; `data-testid`
requereix una justificació quan no hi ha alternativa semàntica.

Interacciona abans de comprovar el resultat: fer `focus()` a un skip link no
demostra que Tab i Enter el facin funcionar. Una crida interna o un spy no
substitueixen un resultat observable. Un spy pot comprovar una petició quan
aquesta sigui el contracte extern que cal protegir, com l'emissió d'un
esdeveniment d'analítica. Espera navegacions, accions i assertions asíncrones;
no afegeixis sleeps arbitraris.

En SEO, seguretat i protocols, el contracte pot no ser visible: inspeccionar
`script[type="application/ld+json"]`, metadades, respostes HTTP o l'absència d'un
fitxer privat és legítim. No s'han de substituir aquestes garanties per una
assertion visual. axe s'executa en els estats rellevants, també amb controls
oberts quan formen part del canvi; no certifica per si sol conformitat WCAG.

### Matriu de navegadors i garanties

La matriu de Playwright no repeteix cada garantia a totes les combinacions, però
cada fitxer de `apps/web/e2e/` conserva exactament aquestes:

| Prova                                                                                                                                                      | Combinacions                                          | Garantia que conserva                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell.spec.ts`, recorreguts funcionals i responsius                                                                                                       | Chromium, Firefox i WebKit a 1280x720 i 320x720       | Navegació, menú mòbil, popover i mesos del calendari, teclat, enllaços i destinacions revisats, estats de detall i accions disponibles, i l'absència de controls falsos (`aria-disabled`/`disabled`, `href` buit) a cada plantilla |
| `shell.spec.ts`, contractes d'HTML estàtic (`emits canonical and social metadata`, `serves sitemap and robots`, `has no broken or falsely disabled links`) | Només `chromium-desktop`                              | Canonical, hreflang, Open Graph, sitemap, robots i enllaços interns vius sobre el document construït; el navegador i el viewport no canvien l'HTML                                                                                 |
| `route-matrix.spec.ts`                                                                                                                                     | Chromium desktop i mòbil, totes les rutes del sitemap | Paritat entre el sitemap i el catàleg, `lang`, `main`, un `h1` no buit, canonical, selector d'idioma, skip link i overflow horitzontal del contingut traduït                                                                       |
| `accessibility.spec.ts` (`@a11y`)                                                                                                                          | Chromium desktop i mòbil                              | axe sobre una ruta per plantilla i variant d'estat més `/404.html`, inclòs el diàleg d'imatge ampliada obert                                                                                                                       |
| `structured-data.spec.ts`                                                                                                                                  | Només `chromium-desktop`                              | JSON-LD de cada plantilla sobre el document construït                                                                                                                                                                              |
| `preview.spec.ts` i `posts.spec.ts` en mode preview                                                                                                        | Les sis combinacions a la CI                          | Avisos de preview, `noindex`, absència d'analítica i pàgines només de preview                                                                                                                                                      |
| `posts.spec.ts` en mode públic                                                                                                                             | Les sis combinacions                                  | Navegació per notícies i blog, accions d'analítica, carrusel de portada, visor d'imatge i navegació sense JavaScript                                                                                                               |

Els contractes estàtics s'executen una vegada perquè el navegador i el viewport
no en canvien el resultat. A `has no broken or falsely disabled links` la part
que s'executa una vegada és la dels enllaços vius; la comprovació d'elements
falsament desactivats (`aria-disabled`/`disabled`) es manté als recorreguts
funcionals de cada plantilla, en tots els navegadors i viewports. axe s'executa
sobre un conjunt representatiu derivat del catàleg, no sobre cada entrada
publicada: repetir la mateixa plantilla amb desenes d'entrades torna a analitzar
el mateix marcatge i no cobreix cap estat nou. Una plantilla nova o una variant
d'estat nova s'afegeix a `accessibility.spec.ts`; el contingut traduït continua
cobert per la matriu de rutes, que en comprova estructura, idioma i overflow a
totes les rutes. Cap d'aquestes comprovacions substitueix l'auditoria manual que
el [quality gate](../.agents/skills/quality-gate/SKILL.md) manté com a necessitat
separada.

Els fitxers de prova de Playwright no comparteixen estat mutable: cada test rep
el seu propi context i llegeix el catàleg publicat sense modificar-lo, així que
`fullyParallel` distribueix els tests entre workers. Un test nou que escrigui
fitxers o muti l'entorn ha de declarar-ho i aïllar-se amb el seu propi artefacte
abans que la suite el reparteixi entre workers.

### Estats editorials que poden quedar sense ruta

Un esdeveniment actiu sense data anunciada és un estat editorial que pot
desaparèixer en qualsevol moment: quan el club anuncia la propera edició, el
detall passa a l'estat de propera edició i no queda cap ruta publicada amb aquest
estat. Els E2E el deriven del catàleg (`loadPublishedSite()`) i se salten netament
si no queda cap entrada; la branca queda garantida per una prova de render Astro
de `EventDetail` amb dades sintètiques
([`event-detail-render.test.ts`](../apps/web/src/test/event-detail-render.test.ts)).
Anunciar una data no ha de fer fallar el build ni la suite, i el mateix criteri
s'aplica a qualsevol altre estat editorial que pugui quedar buit.

## Revisar cobertura i redundància

Per afegir una prova, declara comportament, context, regressió i nivell triat.
Inclou èxit, error o límit només quan representin branques rellevants. No cal
provar línies trivials ni repetir recorreguts equivalents.

Per eliminar o moure una prova, identifica la prova que conserva la mateixa
garantia i els casos que cobreix. Un E2E relacionat no fa redundant una unitària;
un helper de JSON-LD i el seu escaping no demostren que la pàgina els utilitzi.
Conserva les proves adversàries de publicació i seguretat mentre no hi hagi una
cobertura equivalent demostrada.

Comprova sensibilitat amb un cas que falli abans de la correcció o amb una
alteració local controlada i reversible del comportament. No alteris feina
aliena, dades remotes ni producció. Si només has inspeccionat el codi, declara
que no has verificat experimentalment aquesta sensibilitat ni els costos.

## Validació i evidència

Executa primer la prova afectada i després les suites i comprovacions aplicables.
Les ordres vigents són a [`package.json`](../package.json):

| Ordre                       | Abast                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                 | Vitest, inclòs render, i verificació de generació Paraglide                                                                     |
| `pnpm test:analytics`       | Client Stats v2 de Plausible amb xarxa simulada                                                                                 |
| `pnpm test:build-contracts` | Contractes de build que construeixen el seu propi artefacte (recursos editorials i rebuild de preview a públic) amb Playwright  |
| `pnpm test:server`          | Proves operatives de Node, sense build ni navegadors                                                                            |
| `pnpm check`                | Format, lint, typecheck, Vitest, client Stats v2, comprovació de la documentació i proves operatives, sense contractes de build |
| `pnpm check:local`          | Format, lint, typecheck, Vitest, client Stats v2 i comprovació de la documentació, sense build ni servidor                      |
| `pnpm build`                | Build Astro i verificació de la sortida i18n                                                                                    |
| `pnpm test:e2e`             | Build amb origen i data fixats, seguit de Playwright                                                                            |
| `pnpm test:a11y`            | Build fixat i selecció de proves `@a11y`                                                                                        |
| `pnpm test:preview`         | Build de preview i proves `preview.spec.ts` i `posts.spec.ts`                                                                   |
| `pnpm validate`             | `pnpm check`, `pnpm test:build-contracts`, `pnpm test:e2e` i `pnpm test:preview`                                                |
| `pnpm lighthouse`           | Auditoria separada de rendiment, llindars i pressupostos                                                                        |

Per a una execució directa de Playwright, construeix abans l'artefacte i passa
als tests el mateix `PUBLIC_SITE_ORIGIN`, `BUILD_TODAY` i `PUBLIC_PREVIEW` que
al build. Les comprovacions locals focalitzades no substitueixen els gates
obligatoris de CI i hooks.

El hook `pre-push` executa `pnpm check:local` perquè el feedback local sigui
ràpid ([ADR 0012](decisions/0012-local-fast-checks.md)). `pnpm test:build-contracts`
construeix els seus propis artefactes i usa Playwright, o sigui que requereix els
[navegadors locals](../CONTRIBUTING.md#eines-locals); `pnpm test:server` i
`pnpm check`, que ja no l'inclouen, no els necessiten.

A macOS, si el directori temporal del sistema té un camí llarg, els sockets
Unix de les proves operatives poden superar el límit del sistema. Crea un
directori temporal curt i assigna-li el teu grup principal perquè les proves
del sandbox conservin el grup esperat:

```sh
short_tmp=$(mktemp -d /tmp/mr.XXXXXX)
chgrp "$(id -gn)" "$short_tmp"
chmod g+s "$short_tmp"
TMPDIR="$short_tmp" pnpm validate
rmdir "$short_tmp"
```

El [workflow de qualitat](../.github/workflows/quality.yml) executa les mateixes
quatre ordres que `pnpm validate`.
Si afegeixes o modifiques un recorregut E2E, executa'l localment; el hook ràpid
no el substitueix.

Registra les ordres i resultats reals, els casos protegits i el risc residual.
Distingeix passades, omissions intencionades i parts no executades. Els canvis
només de documentació requereixen format, enllaços, rutes i coherència amb els
ADR; no cal construir el web ni afirmar que han passat tests no executats.
