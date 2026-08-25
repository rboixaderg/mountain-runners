# Pla Operatiu De Migració A Tailwind V4

## Propòsit I Límits

Aquest document coordina la reducció incremental del CSS propi de la PR #98
mitjançant el tema CSS-first de Tailwind CSS v4. Cada sessió executa una sola
fase i s'atura després de validar-la i actualitzar el checkpoint.

Les fases són talls d'execució agrupats intencionadament dins de la mateixa PR
#98, la seva branca i el seu worktree dedicat. No són tasques d'especificació ni
requereixen una PR independent. La PR completa continua subjecta a revisió i
merge humà segons `AGENTS.md`.

L'objectiu és moure els estils ordinaris a utilitats amb nom i tokens `@theme`,
eliminar selectors i classes sense consumidor i justificar cada regla CSS que
continuï. No hi ha cap objectiu numèric de reducció.

La migració no canvia el disseny, el contingut, les rutes, el comportament,
l'accessibilitat, els atributs d'analytics, les metadades ni els selectors E2E
semàntics. Aquest pla no substitueix les fonts governants ni és una
especificació de producte.

## Fonts Governants

- [`AGENTS.md`](../AGENTS.md)
- [`README.md`](../README.md)
- [`DESIGN.md`](../DESIGN.md)
- [`docs/code-conventions.md`](code-conventions.md)
- [ADR 0006](decisions/0006-presentation-layer-structure.md)
- [Quality gate](../.agents/skills/quality-gate/SKILL.md)
- [Documentació oficial del tema de Tailwind](https://tailwindcss.com/docs/theme)
- [Documentació oficial d'estils propis de Tailwind](https://tailwindcss.com/docs/adding-custom-styles)

## Estat Actual

| Camp                    | Valor                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| Worktree                | `/Users/rogerboixaderguell/Develop/mountain_runners-tailwind-review` |
| Branca                  | `refactor/tailwind-semantic-tests`                                   |
| Baseline inicial        | `7f34fa446b220c4d05dce8ac30b819b6bbcb1f11`                           |
| Fase actual             | `TW4-P07`                                                            |
| Estat de la fase        | `Pendent`                                                            |
| Últim checkpoint        | TW4-DS02 validada; P07 aturat fins a autorització explícita          |
| Última actualització    | 2026-08-25                                                           |
| CSS propi de referència | 1.666 línies en 18 fulls i 112 línies en 6 blocs Astro               |
| Canvis locals esperats  | DS01 + DS02 sobre HEAD `a1ea89a`                                     |

Els estats operatius són `Pendent`, `En curs`, `Validada` i `Bloquejada`.
`Validada` indica que la fase ha superat les comprovacions locals i la revisió,
no que la PR s'hagi fusionat.

- `Pendent`: la fase encara no té autorització d'implementació.
- `En curs`: l'usuari ha demanat executar-la i ha començat l'anàlisi Luna.
- `Bloquejada`: no pot complir l'abast o les comprovacions sense una decisió.
- `Validada`: el diff de la fase ha estat revisat i ha superat les comprovacions
  locals. El merge de la PR #98 es registra a GitHub, no amb aquest estat.

## Contracte D'Una Sessió

Cada sessió compleix aquest ordre:

1. Confirma worktree, branca, HEAD i estat de Git. Si hi ha canvis no explicats,
   s'atura sense executar `reset`, `restore`, `checkout`, rebase ni merge.
2. Comprova que l'usuari ha demanat explícitament executar la fase actual. Aquest
   document no autoritza per si sol a editar l'aplicació.
3. Llegeix aquest document, el checkpoint viu, les fonts governants i només els
   fitxers de la fase actual. Aquest pla i `docs/README.md` són fitxers de control
   sempre permesos per actualitzar el seguiment.
4. Canvia l'estat de la fase a `En curs` i crea un `explore-lite-luna` de només
   lectura per analitzar-la.
5. L'agent principal revisa l'evidència i fixa l'allowlist. No implementa codi.
6. Crea un `implement-lite-luna` per modificar només l'allowlist aprovada.
7. L'agent principal revisa el diff i executa les comprovacions de la fase.
8. Actualitza el checkpoint, les troballes i el prompt següent.
9. S'atura. No inicia ni analitza la fase següent.

L'agent principal conserva l'orquestració, les decisions d'integració, la revisió
del diff, la verificació final i la comunicació amb l'usuari. No duplica
l'anàlisi ni la implementació delegades.

No s'utilitzen `explore`, `general`, `implement-lite-deepseek` ni cap altre agent
per analitzar o implementar les fases. No es fan commits, pushes, merges ni
canvis a la PR sense autorització explícita de l'usuari en la sessió actual.

## Controls De Context I Consum

- Una sola fase per sessió.
- Un `explore-lite-luna` i un `implement-lite-luna` per fase. `TW4-P00` no té
  implementació i `TW4-P15` usa els dos revisors de només lectura definits al
  mateix apartat.
- Els prompts inclouen paths permesos, exclusions, riscos i evidència esperada.
- Els subagents retornen decisions, paths i ordres executades. No copien fitxers
  sencers ni logs complets.
- L'anàlisi Luna no supera 1.200 paraules i la implementació no supera 600. Un
  bloqueig es descriu dins del mateix límit.
- Només es permet una represa de cada subagent. Si no resol la fase, queda
  `Bloquejada` i es demana una decisió abans de consumir més context.
- No es reaudita tot el CSS ni es rellegeixen fases tancades.
- Una troballa fora d'abast es registra i no s'investiga dins de la fase actual.
- S'executen les comprovacions mínimes de la fase. El quality gate complet queda
  reservat a `TW4-P15`.
- Tota menció de `build` o comparació visual utilitza
  `PUBLIC_SITE_ORIGIN=https://mountainrunners.cat` i `BUILD_TODAY=2026-08-04`.
- Context7 es consulta amb una pregunta concreta quan la fase depèn d'una
  sintaxi de Tailwind que no estigui verificada. No es repeteix una consulta
  genèrica del tema complet ni es fan més de dues consultes en una fase.
- Si l'abast no cap dins d'aquests límits, la fase es marca `Bloquejada`. Només
  es divideix amb aprovació de l'usuari i actualitzant abans aquest pla.

## Regles De Tokens I CSS Propi

Un token nou només s'accepta si té dos usos reals amb el mateix valor i la
mateixa funció visual, o si representa un concepte estable de `DESIGN.md`. El
token i els primers consumidors s'implementen a la mateixa fase. A la segona
aparició semànticament equivalent, el valor es promou a token. Es pot editar
`global.css` en qualsevol fase només per afegir tokens aprovats i consumits en
aquella mateixa fase.

Abans d'acceptar-lo cal confirmar el namespace de Tailwind 4.3.3, inspeccionar
el CSS compilat i comprovar l'equivalència visual. No s'agrupen valors només
perquè s'assemblen i no se substitueix un color `rgb(... / alpha)` per una
sortida basada en `color-mix` sense demostrar equivalència exacta.

No s'utilitza `@apply`, no s'afegeixen dependències i no es mou CSS a valors
arbitraris `[...]` només per canviar-lo de lloc. Les variables estructurals
`--page-width`, `--reading-width`, `--page-gutter` i `--section-space` continuen
a `:root` mentre les convencions vigents ho exigeixin.

Pot continuar sent CSS propi allò que implementi HTML generat amb `set:html`,
selectors `:global(...)`, estat JavaScript o `[open]`, pseudo-elements
complexos, `clip-path`, gradients o textures de marca, selectors de navegador,
cascades pare-fill, graelles específiques, focus, `@font-face`, skip link o
moviment reduït. Cada regla restant ha de tenir una justificació concreta.

## Seqüència De Fases

| ID         | Objectiu                                     | Dependències | Estat    |
| ---------- | -------------------------------------------- | ------------ | -------- |
| `TW4-P00`  | Baseline de només lectura                    | —            | Validada |
| `TW4-P01`  | Primitives compartits                        | P00          | Validada |
| `TW4-P02`  | Contacte, documents, legal i 404             | P01          | Validada |
| `TW4-P03`  | Header i selector d'idioma                   | P01          | Validada |
| `TW4-P04`  | Prefooter i footer                           | P01          | Validada |
| `TW4-P05`  | About                                        | P01          | Validada |
| `TW4-P06`  | Homepage i targeta d'esdeveniment compartida | P01          | Validada |
| `TW4-DS01` | Sistema de disseny operatiu                  | P06          | Validada |
| `TW4-DS02` | Unificació d'escales globals                 | DS01         | Validada |
| `TW4-P07`  | Hub d'esdeveniments sense calendari          | DS02         | Pendent  |
| `TW4-P08`  | Calendari d'esdeveniments                    | P07          | Pendent  |
| `TW4-P09`  | Detall d'esdeveniment                        | P01          | Pendent  |
| `TW4-P10`  | Socis                                        | P01          | Pendent  |
| `TW4-P11`  | Hub d'escoles                                | P01          | Pendent  |
| `TW4-P12`  | Preview del detall d'escola                  | P01, P11     | Pendent  |
| `TW4-P13`  | Registration del detall d'escola             | P12          | Pendent  |
| `TW4-P14`  | Neteja acotada de classes i ownership        | P02–P13      | Pendent  |
| `TW4-P15`  | Revisió independent i quality gate final     | P14          | Pendent  |

## Definició Fixa De Les Fases

### TW4-P00 — Baseline De Només Lectura

- **Resultat:** worktree net, baseline `7f34fa4`, inventari de 1.790 línies de
  CSS propi i consumidors principals verificats.
- **Exclusió:** cap implementació.

### TW4-P01 — Primitives Compartits

- **Paths:** `global.css`, `page-section.css`, `page-hero.css`, `PageSection`,
  `PageIntro`, `PageHero` i `PageHeroMedia`.
- **Objectiu:** introduir només tokens consumits en aquesta fase i migrar
  tipografia, tracking, colors i espaiat ordinaris.
- **Conservar:** `page-frame`, `py-section`, gradients, filtres, overlays i el
  markdown legal fins a la fase d'ownership.
- **Comprovacions:** `pnpm check`, build determinista, rutes representatives a
  320x720 i 1280x720, E2E, a11y i Lighthouse.

### TW4-P02 — Contacte, Documents, Legal I 404

- **Paths:** `contact-data.css`, `documents.css`, `ContactDataList`, components
  de documents i legals i `404.astro`.
- **Objectiu:** migrar tipografia, tracking i espaiat ordinaris.
- **Conservar:** graelles específiques, `documents-entry__meta dt::after` i
  selectors de markdown.
- **Comprovacions:** `pnpm check`, build i rutes afectades en tres idiomes i dos
  viewports.

### TW4-P03 — Header I Selector D'Idioma

- **Paths:** `site-header.css`, `SiteHeader.astro` i `LanguageSelector.astro`.
- **Objectiu:** migrar tracking, padding, gaps, mides de text i ombres provades.
- **Conservar:** `::-webkit-details-marker`, chevron, icona del menú, `[open]`,
  breakpoint específic i cascades dels dropdowns.
- **Comprovacions:** `pnpm check`, build, `shell.spec.ts`, teclat, focus, menú,
  idioma, overflow, E2E i a11y.

### TW4-P04 — Prefooter I Footer

- **Paths:** `prefooter.css`, `site-footer.css`, `PreFooter.astro` i
  `SiteFooter.astro`.
- **Objectiu:** migrar colors, tracking, espaiat, tipografia i ombres.
- **Conservar:** focus específic, newsletter disabled, transicions i layouts
  responsive exactes.
- **Comprovacions:** `pnpm check`, build, homepage, legal, newsletter, links,
  focus, E2E i a11y.

### TW4-P05 — About

- **Paths:** `about.css` i els components `About*`.
- **Objectiu:** migrar tracking, tipografia, espaiat i colors repetits.
- **Conservar:** filtres, graelles `minmax`, markdown i estructura fosca.
- **Comprovacions:** `pnpm check`, build, tres idiomes, dos viewports i E2E
  d'About.

### TW4-P06 — Homepage I Targeta Compartida

- **Paths:** `homepage.css`, homepage i `HomepageEventCard.astro`.
- **Objectiu:** migrar tracking, tipografia, ombres i espaiat.
- **Conservar:** hover wash sense equivalència exacta i graelles responsive.
- **Exclusió:** les fases del hub no tornen a modificar la targeta compartida.
- **Comprovacions:** `pnpm check`, build, homepage, consumidor del hub, dos
  viewports, E2E i Lighthouse.

### TW4-DS01 — Sistema De Disseny Operatiu

- **Paths:** `global.css`, `homepage.css`, homepage, `HomepageEventCard.astro`,
  `404.astro`, `DESIGN.md`, `AGENTS.md`, `docs/code-conventions.md` i aquest
  pla.
- **Objectiu:** definir els tokens semàntics i l'`@utility` estructural que ja
  tenen coincidència exacta de valor, propietat i rol, i documentar l'ordre de
  decisió. No és un redisseny ni una normalització de valors propers.
- **Conservar:** tracking responsive del CTA del header, mides de data del
  detall, leading `0.88`/`0.9`/`0.95`, ombres `0.25`/`0.35`/`0.5`, clamps
  únics, markdown, pseudo-elements, graelles i el CSS de les fases P07–P13.
- **Comprovacions:** `pnpm check`, build determinista, E2E, a11y, Lighthouse i
  comparació visual a 320x720 i 1280x720 de les rutes representants.

### TW4-DS02 — Unificació D'Escales Globals

- **Paths:** `DESIGN.md`, `AGENTS.md`, `docs/code-conventions.md`, aquest pla,
  `global.css` i els consumidors d'espaiat, tracking, leading, ombra i
  tipografia fora de l'escala tancada.
- **Objectiu:** aplicar les decisions d'unificació aprovades i normalitzar els
  valors històrics propers. P07 resta aturat fins a validar DS02.
- **Decisions:** un `spacing-section` i un `spacing-card`; tracking `0.06` /
  `0.08` / `-0.03`; leading display `0.92`; ombra dura `0.35rem` (+ accent i
  lg); un `text-section`; composició amb `PageSection` on encaixi.
- **Comprovacions:** `pnpm check`, build, E2E, a11y, Lighthouse i revisió visual
  a 320x720 i 1280x720.

### TW4-P07 — Hub D'Esdeveniments Sense Calendari

- **Paths:** `events-hub.css`, pàgina del hub, `EventsHubActiveCard` i
  `EventsHubHistoryTable`.
- **Exclusions:** calendari, `HomepageEventCard` i `homepage.css`.
- **Objectiu:** migrar títols, labels, espaiat i colors.
- **Conservar:** taula responsive i selectors estructurals.
- **Comprovacions:** `pnpm check`, build, tres idiomes, dos viewports i E2E del
  hub.

### TW4-P08 — Calendari D'Esdeveniments

- **Paths:** `events-calendar.css` i `EventMonthlyCalendar.astro`.
- **Objectiu:** migrar estils ordinaris i validar `last:border-r-0`.
- **Conservar:** rangs, popover, hover, `focus-within`, estat `--open`, focus i
  JavaScript necessari.
- **Comprovacions:** `pnpm check`, build, click, Escape, click exterior,
  `aria-expanded`, rangs, overflow i E2E.

### TW4-P09 — Detall D'Esdeveniment

- **Paths:** `detail-hero.css`, `event-detail.css`, `DetailHero`, `EventDetail` i
  components de secció d'esdeveniments.
- **Objectiu:** migrar mides, line-heights, tracking, espaiat i ombres.
- **Conservar:** overrides, brush, pseudo-elements, comes, gradients, textures i
  layout exacte.
- **Comprovacions:** `pnpm check`, build, variants actives, històriques, sense
  data i registration, dos viewports, E2E i Lighthouse.

### TW4-P10 — Socis

- **Paths:** `members.css` i components `Members*`.
- **Objectiu:** migrar tipografia, espaiat, colors, opacity i ombres.
- **Conservar:** gradient, layout responsive, markdown i variants d'acció.
- **Comprovacions:** `pnpm check`, build, tests de `MembersActionSection`, dos
  viewports i E2E.

### TW4-P11 — Hub D'Escoles

- **Paths:** `schools-hub.css` i `SchoolHub.astro`.
- **Objectiu:** migrar tipografia, tracking, espaiat i dimensions repetides.
- **Conservar:** graella, filtres, hover pare-fill i pseudo-element.
- **Comprovacions:** `pnpm check`, build, ordre, links, dos viewports i E2E.

### TW4-P12 — Preview Del Detall D'Escola

- **Paths:** `school-detail-preview.css`, `SchoolPreview*`, `SchoolGallery` i
  `SchoolVideo`.
- **Exclusions:** `SchoolRegistration.astro` i `school-detail.css`.
- **Objectiu:** migrar mides, line-heights, tracking, gaps, padding i ombres.
- **Conservar:** overlay, brush, accent, watermark, gradients, grids i markdown.
- **Comprovacions:** `pnpm check`, build, Trail, Skimo, BTT, preus, horaris,
  galeria, vídeo, dos viewports, E2E i Lighthouse.

### TW4-P13 — Registration Del Detall D'Escola

- **Paths:** `school-detail.css`, `SchoolRegistration.astro` i l'import de
  `SchoolDetail.astro` només si cal.
- **Exclusió:** `school-detail-preview.css`.
- **Objectiu:** migrar estils ordinaris i revisar la regla sobreescrita
  `.schools-detail__section h2`.
- **Conservar:** textura i estats de registration.
- **Comprovacions:** `pnpm check`, build, tres escoles, variants oberta i
  tancada, dos viewports i E2E.

### TW4-P14 — Neteja Acotada De Classes I Ownership

- **Abast tancat:** `page-detail`, `page-section`, `site-prefooter`,
  `youtube-embed`, `youtube-embed__frame`, `members-video__inner`, aliases
  `--space-*`, ownership del markdown legal, imports buits i selectors
  sobreescrits registrats.
- **Regla:** abans d'eliminar res, revisar CSS, `class:list`, JavaScript, tests,
  `:global(...)`, HTML generat i render condicional.
- **Exclusió:** no obre una nova migració ni elimina `data-analytics-*`.
- **Comprovacions:** `pnpm check`, build, selectors i imports sense consumidor i
  comparació visual.

### TW4-P15 — Revisió Independent I Quality Gate Final

- **Revisió A:** un `explore-lite-luna` audita tokens, namespaces, CSS ordinari,
  classes mortes, arbitraris i ownership.
- **Revisió B:** un `explore-lite-luna` audita visual, responsive, focus,
  interaccions, ARIA, analytics, markdown i cobertura.
- **Implementació:** cap. Una correcció crea una fase acotada amb anàlisi i
  implementació Luna abans de reprendre P15.
- **Comprovacions:** `git diff --check`, `CI=1 pnpm validate`,
  `pnpm test:a11y`, `pnpm lighthouse` i comparació determinista de totes les
  plantilles representatives a 320x720 i 1280x720. Compara el `dist/` acumulat
  amb `main` i les captures amb el baseline visual `7f34fa4`. Registra també la
  validació de sitemap, robots, canonical, `hreflang`, metadades socials i
  JSON-LD, més les notes d'impacte en accessibilitat, SEO, rendiment, seguretat i
  llicències.

## Criteris D'Aturada

La fase s'atura si necessita un valor arbitrari per moure CSS, un token d'un sol
ús, agrupar semàntiques diferents, alterar colors o disseny, tocar un propietari
fora d'abast, canviar JavaScript per facilitar un estil, afegir una dependència
o relaxar una prova.

Si falla, no s'utilitza Git per descartar treball acumulat. El mateix
`implement-lite-luna` corregeix o reverteix només els seus hunks. No es continua
fins que la fase estigui controlada.

## Checkpoint Viu

### TW4-P07: Hub D'Esdeveniments Sense Calendari

- **Estat:** Pendent
- **Sessió:** —
- **Worktree i branca:** worktree dedicat, `refactor/tailwind-semantic-tests`
- **Base de la fase:** canvis locals validats de TW4-DS01 sobre HEAD `a1ea89a`
- **Evidència d'anàlisi Luna:** —
- **Evidència d'implementació Luna:** —
- **Revisió principal:** —
- **Validació executada:** —
- **Troballes no resoltes:** —
- **Acció següent:** executar només `TW4-P07`.

En validar una fase, el checkpoint es copia de forma concisa al registre
històric, s'actualitza la taula, s'avança `Estat Actual` i es prepara el
checkpoint de la fase següent. No s'hi enganxen logs complets.

## Troballes No Resoltes

| ID  | Troballa | Fase origen | Bloqueja | Seguiment |
| --- | -------- | ----------- | -------- | --------- |
| —   | —        | —           | —        | —         |

## Registre Històric De Checkpoints

### TW4-P00 — Baseline, 2026-08-25

- Worktree net a `7f34fa4`.
- 1.672 línies en 18 fulls CSS i 118 línies en sis blocs Astro.
- 15 fases d'implementació i validació definides.
- Cap fitxer d'aplicació modificat. Després del baseline només s'han afegit
  aquest pla operatiu i el seu enllaç al mapa de documentació.

### TW4-P01 — Primitives Compartits, 2026-08-25

- L'anàlisi Luna va limitar la implementació a cinc paths i als valors exactes
  `0.06em` i `1.6`, sense aproximar clamps, filtres ni overlays.
- La implementació Luna va afegir `tracking-display` i `leading-copy` al tema i
  els va consumir a `PageIntro` i `PageSection`; `PageHero` i `PageHeroMedia` no
  van requerir canvis.
- El CSS compilat conté les dues utilitats amb els valors originals. Es
  conserven `page-frame`, `py-section`, els selectors de markdown i tot el CSS
  específic exclòs per la fase.
- `pnpm check`, el build determinista de 68 pàgines, 298 proves E2E, les dues
  proves axe aplicables i Lighthouse van passar. Lighthouse va obtenir 99 en
  rendiment i 100 en accessibilitat, bones pràctiques i SEO a les tres rutes.
- La revisió a 320x720 i 1280x720 de portada, hub, detall i 404 no va detectar
  problemes visuals ni overflow. L'avís legal va confirmar els valors
  computats de tracking i line-height del markdown.
- Cap troballa no resolta. CSS propi: 1.668 línies en 18 fulls i 118 línies en
  sis blocs Astro.

### TW4-P02 — Contacte, Documents, Legal I 404, 2026-08-25

- L'anàlisi Luna va conservar les graelles, amplades, selectors de markdown,
  `documents-entry__meta dt::after` i el tracking exacte `0.08em`, que no té cap
  token amb nom dins de l'abast de la fase.
- La revisió principal va identificar dos consumidors de selectors migrats a
  TW4-P01. `DocumentGroup` ara usa `tracking-display`, l'estat buit de
  `DocumentsDetail` usa `leading-copy` i 404 substitueix l'arbitrari equivalent
  per `tracking-display`.
- La primera comprovació de format va fallar als tres paths. El mateix agent
  Luna els va formatar dins de l'allowlist i la segona execució de `pnpm check`
  va passar amb 319 proves unitàries i 50 proves de servidor.
- El build determinista va generar 68 pàgines. Documents en català, castellà i
  anglès, 404 i una ruta legal de cada idioma van conservar el layout i no van
  tenir overflow a 320x720 ni 1280x720.
- Els valors computats van confirmar `0.06em` als títols de documents i al 404,
  i `0.08em` a les etiquetes de contacte. Cap troballa no resolta i cap línia de
  CSS propi modificada.

### TW4-P03 — Header I Selector D'Idioma, 2026-08-25

- L'anàlisi Luna va limitar la fase a tres declaracions exactes de
  `letter-spacing: 0.06em`. La resta de tracking, padding, gaps, mides de text,
  ombres, breakpoint, estats i cascades no tenen una utilitat amb nom equivalent
  o han de continuar al CSS.
- La implementació Luna va afegir `tracking-display` a les dues variants del
  selector d'idioma, al dropdown d'escoles d'escriptori i al submenu mòbil. Va
  eliminar només les tres declaracions equivalents de `site-header.css`.
- El CSS compilat i els valors computats van confirmar `0.06em` als quatre
  consumidors. El menú, els dos selectors d'idioma i els dropdowns van conservar
  els estats oberts, el focus, la cascada i l'amplada a 320x720 i 1280x720.
- `pnpm check`, el build determinista de 68 pàgines, 298 proves E2E i les dues
  proves axe aplicables van passar. La matriu en tres idiomes no va detectar
  overflow. La primera arrencada E2E va trobar un preview Astro orfe; després
  d'aturar-lo, la suite va passar sense canvis de codi.
- Cap troballa no resolta. CSS propi: 1.665 línies en 18 fulls i 118 línies en
  sis blocs Astro.

### TW4-P04: Prefooter I Footer, 2026-08-25

- Abans de la fase, la branca es va rebasar sobre `origin/main` `1592cbd` i es
  van restaurar sense conflictes tots els canvis locals validats.
- L'anàlisi Luna va limitar la migració a sis declaracions exactes. Es van
  reutilitzar `leading-copy`, `leading-normal`, `tracking-display` i
  `tracking-widest` als quatre paths de la fase.
- La revisió principal va conservar els clamps, colors alpha, hovers, focus,
  estats disabled, transicions i layouts responsive. També va mantenir el
  shorthand de la vora vermella perquè separar-lo hauria fet créixer el CSS
  específic sense eliminar la necessitat de la regla.
- `pnpm check` va passar amb 323 proves unitàries i 50 proves de servidor. El
  build determinista va generar 68 pàgines, les 298 proves E2E van passar i les
  dues proves axe aplicables no van detectar infraccions.
- Portada i avís legal van conservar el layout sense overflow a 320x720 i
  1280x720. Els valors computats van confirmar els quatre valors migrats, i els
  links, analytics, `aria-describedby` i estats disabled es van mantenir.
- Cap troballa no resolta. CSS propi: 1.659 línies en 18 fulls i 118 línies en
  sis blocs Astro.

### TW4-P05: About, 2026-08-25

- L'anàlisi Luna va limitar la fase a quatre declaracions exactes en tres
  paths: dos tracking `0.06em`, el line-height `1.6` de la descripció dels
  estatuts i la vora `1px solid var(--color-line)` de la targeta.
- La implementació Luna va reutilitzar `tracking-display`, `leading-copy`,
  `border` i `border-line`. Només va eliminar les declaracions migrades, el
  selector buit de la descripció i la seva classe sense ús.
- La revisió principal va conservar filtres, `minmax`, markdown, estructura
  fosca, clamps, colors alpha, variables estructurals i valors sense utilitat
  exacta. La documentació oficial i el CSS compilat van confirmar la semàntica
  de la vora de Tailwind v4.
- `pnpm check` va passar amb 323 proves unitàries i 50 proves de servidor. El
  build determinista va generar 68 pàgines i les 298 proves E2E van passar; les
  dues proves axe aplicables no van detectar infraccions.
- About en català, castellà i anglès va conservar l'ordre, les graelles i
  l'estructura fosca sense overflow a 320x720 ni 1280x720. Els valors computats
  van confirmar el tracking, el line-height, la vora i el filtre conservat.
- Cap troballa no resolta. CSS propi: 1.653 línies en 18 fulls i 118 línies en
  sis blocs Astro.

### TW4-P06: Homepage I Targeta Compartida, 2026-08-25

- L'anàlisi Luna va trobar un únic mapping exacte: el `leading-[1.6]` del resum
  opcional de `HomepageEventCard` es podia substituir per `leading-copy`.
- La resta de tracking, tipografia, ombres i espaiat no tenia una utilitat amb
  nom equivalent. Es van conservar el hover wash, les graelles responsive, els
  blocs de markdown i tots els arbitraris amb valor específic.
- La implementació Luna només va modificar la targeta compartida. La primera
  comprovació de Prettier va detectar l'ordre de classes; el mateix agent la va
  formatar dins de l'allowlist i les comprovacions posteriors van passar.
- `pnpm check` va passar amb 323 proves unitàries i 50 proves de servidor. El
  build determinista va generar 68 pàgines, les 298 proves E2E van passar i les
  dues proves axe aplicables no van detectar infraccions.
- La portada i el consumidor del hub van conservar el resum a
  `line-height: 1.6`, les graelles, les ombres, el hover wash, els analytics i
  l'absència d'overflow a 320x720 i 1280x720.
- Lighthouse va obtenir 99 en rendiment i 100 en accessibilitat, bones
  pràctiques i SEO a portada, hub i detall representatiu. Cap troballa no
  resolta. CSS propi: 1.653 línies en 18 fulls i 118 línies en sis blocs Astro.

### TW4-DS01: Sistema De Disseny Operatiu, 2026-08-25

- HEAD `a1ea89a` és la base commitada de P01–P06. L'auditoria va agrupar per
  valor, propietat i rol, sense unificar `0.92`/`0.95`/`0.9`, `-0.02em`/`-0.03em`
  ni ombres `0.2`/`0.25`/`0.35`/`0.5`.
- Tokens aprovats: `tracking-label`, `tracking-headline`,
  `leading-display-tight`, `leading-action`, `text-action`, `text-section`,
  `text-section-copy`, `text-event-meta`, `shadow-action`, `py-action`,
  `p-card-fluid` i `max-w-section-copy`. `@utility action-underline` per al
  subratllat de gruix `0.1rem` i offset `0.3rem`.
- Consumidors: homepage, `HomepageEventCard`, 404 i `homepage.css`. El CTA del
  header conserva el tracking responsive `0.12em`/`0.08em`. El dia de la targeta
  i les dates del detall queden en CSS propi.
- La revisió independent no va trobar tokens òrfens, coincidències numèriques
  accidentals ni canvis visuals. `pnpm check`, 68 pàgines, 298 E2E, les dues
  proves axe i Lighthouse van passar. Portada 98/100/100/100; hub i detall
  99/100/100/100. Sense overflow a 320x720 ni 1280x720. Valors computats: CTA
  `0.8rem`/`1.2`/`0.12em`/`0.85rem` i ombra `3.2px 3.2px 0 #111`.
- Cap troballa no resolta. CSS propi: 1.660 línies en 18 fulls i 118 línies en
  sis blocs Astro.

### TW4-DS02: Unificació D'Escales Globals, 2026-08-25

- Decisions aprovades: un `spacing-section` i un `spacing-card`; tracking
  `0.06` / `0.08` / `-0.03`; leading display `0.92`; ombra dura `0.35rem` (+
  accent i lg `0.5rem`); un `text-section`; `text-display` /
  `text-display-home`; `text-meta` substitueix `text-event-meta`;
  `leading-display` substitueix `leading-display-tight`; `p-card` substitueix
  `p-card-fluid`.
- `DESIGN.md` documenta escales tancades. Consumidors migrats a CSS i Astro;
  About, Documents i MembersDirectory composen amb `PageSection` (`bordered`,
  `constrainBody`). Canvis visuals esperats per normalització.
- `pnpm check`, 68 pàgines, 298 E2E, 2 axe i Lighthouse van passar. Portada
  98/100/100/100; hub i detall 99/100/100/100. Sense overflow a 320x720 ni
  1280x720 (E2E).
- Cap troballa no resolta. CSS propi: 1.666 línies en 18 fulls i 112 línies en
  6 blocs Astro. P07 resta pendent d'autorització.

## Prompt De La Sessió Següent

```text
Continua el pla de docs/tailwind-v4-migration-plan.md.

Executa exclusivament la fase TW4-P07. No iniciïs ni analitzis cap altra fase.
Aquest missatge és l'autorització explícita per implementar només TW4-P07.

Confirma primer el worktree, la branca, el HEAD i l'estat de Git. L'estat
esperat és el final validat de TW4-DS02: canvis locals sobre HEAD `a1ea89a`,
amb el pla de migració trackejat. Si hi ha canvis que no concorden amb aquest
checkpoint, atura't. No executis reset, restore, checkout, rebase ni merge.

Llegeix el checkpoint viu, les fonts governants i només els paths permesos de
TW4-P07. Reutilitza les escales tancades de DS02 (`tracking-*`, `leading-*`,
`text-*`, `shadow-action*`, `py-section`, `p-card`, etc.). Normalitza només
cap a aquestes escales quan valor, propietat i rol coincideixin; no inventis
tokens nous en aquesta fase.

Delega l'anàlisi de només lectura a explore-lite-luna. Després de revisar-ne
l'evidència i fixar l'allowlist, delega la implementació acotada a
implement-lite-luna. L'agent principal només orquestra, revisa el diff, pren
decisions d'integració i executa la verificació.

Migra només títols, labels, espaiat i colors de `events-hub.css`, la pàgina del
hub, `EventsHubActiveCard.astro` i `EventsHubHistoryTable.astro`. No modifiquis
el calendari, `HomepageEventCard.astro` ni `homepage.css`. Conserva la taula
responsive i els selectors estructurals. Preserva rutes, contingut,
comportament, accessibilitat, analytics i selectors E2E semàntics. No afegeixis
dependències, no utilitzis @apply i no ampliïs l'abast de la fase.

Executa les comprovacions definides per TW4-P07. Actualitza el checkpoint viu,
el registre de troballes i el prompt de la sessió següent. Atura't en acabar.
No facis commit, push, merge ni deploy sense autorització explícita.
```
