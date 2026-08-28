# Convencions De Codi

## Propòsit

Aquest document operacionalitza l'[ADR 0006](decisions/0006-presentation-layer-structure.md)
i fixa com s'escriu el codi de `apps/web` perquè agents i persones el mantinguin
de manera coherent. `AGENTS.md` resumeix les obligacions; aquest document aporta
el detall, les regles de decisió i els exemples del propi codi. La revisió de
cada PR comprova aquestes regles manualment i amb les eines automatitzades que
les poden expressar; no totes disposen encara d'una regla de lint pròpia.

## Capes

| Capa        | Ubicació                | Responsabilitat                                                                     | No hi viu                                                    |
| ----------- | ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Pàgines     | `src/pages/`            | `getStaticPaths`, càrrega de dades, metadades i composició de components i layouts  | `Intl.DateTimeFormat`, derivacions d'estat, extracció d'host |
| Domini      | `src/lib/content/`      | Selecció, ordenació, publicació i rutes del contingut editorial                     | Presentació, text resolt                                     |
| Presentació | `src/lib/presentation/` | Funcions pures per locale: format de dates, estat, URL i dades de vista             | Imports d'Astro o Paraglide                                  |
| Components  | `src/components/`       | Fragments de UI reutilitzables i plantilles de detall separades per tipus d'entrada | Selecció i ordenació de dades (domini)                       |

Regla pràctica: si una pàgina necessita formatar, derivar un estat o treure el
host d'una URL, crida un helper de `src/lib/presentation/`; no ho escriu
inline. A la segona aparició d'un helper, s'extreu i es reutilitza.

## Components

### Tipus

1. **Fragments reutilitzables** (`src/components/`): apareixen en dos o més
   llocs (`EventStatus`, `ExternalLink`, `EditionDates`). S'extreuen a la segona
   aparició; mai codi copiat.
2. **Plantilles de detall** (`src/components/{events,schools}/`): una per tipus
   d'entrada (`EventDetail`, `SchoolDetail`). La plantilla és un esquema de la
   pàgina: composa components de secció, no conté les seccions.
3. **Components de secció** (`src/components/{events,schools}/`): una secció
   visual de la plantilla de detall (`EventPracticalInfo`, `EventResources`,
   `EventHistory`, `EventEntities`). Cada secció rep les seves dades i el
   `locale`, resol els seus propis missatges i decideix la seva pròpia
   visibilitat.

### Regles De Composició

- La plantilla de detall ha de llegir-se com un esquema: cada línia diu què es
  renderitza, sense blocs grans ni condicions amagades.
- La guarda de visibilitat d'una secció viu dins del component de secció, com a
  condició del template (`{edition && ...}`, `{items.length > 0 && ...}`), no al
  frontmatter amb retorns primerencs ni amagant l'HTML amb CSS.
- Els components reben dades ja resoltes des del domini i el `locale`; no
  tornen a seleccionar ni ordenar. Només decideixen presentació i visibilitat.
- Un refactor conserva la sortida visual, les rutes, el contingut i el
  comportament observable. Els noms de classe no formen part d'aquest contracte.

## Presentació

- Els helpers de `src/lib/presentation/` són purs i retornen dades o **claus de
  missatge**; mai importen Astro ni Paraglide.
- El contracte del `locale` es deriva de les estructures de dades (ADR 0004 i
  la regla 3 esmenada de l'ADR 0006): un helper rep el `locale` exactament quan
  llegeix camps indexats per idioma (`Record<Locale, …>`) o produeix sortida
  localitzada; si processa només dades sense camps localitzats (claus tipades,
  URLs, identificadors, ordenació per tipus, parseig), no el rep i no se li
  afegeix cap paràmetre inert.
- La resolució de text es fa al component amb `messages[clau]({}, { locale })`.
- Els helpers estan coberts per Vitest a `src/test/presentation-*.test.ts`.

## Validació I Fronteres

- El contingut editorial desa valors semàntics, sense protocols ni atributs del
  render (`mailto:`, `tel:`...). Els components o els helpers de
  `src/lib/presentation/` construeixen els `href` i els atributs HTML a partir
  dels valors emmagatzemats; el render no ha de treure ni tornar a derivar
  prefixes emmagatzemats.
- Cada validació cobreix només el contracte de la seva frontera: el model
  garanteix un valor segur i semàntic —format, caràcters perillosos o
  ofuscació— i no replica decisions de presentació (protocols, query strings o
  extensions) ni restriccions que només pertanyen al render.
- Si construir un atribut afegeix superfície d'injecció (per exemple un prefix
  de URL), la validació del model rebutja els caràcters que el render podria
  interpretar (`%`, `?`, `#`, espais i caràcters de control).

## Estils

L'ordre de decisió per a cada estil és aquest, i s'atura al primer que expressa
el valor amb claredat:

1. **Utilitat Tailwind estàndard** recolzada pel tema per defecte o per un token
   ja existent (`tracking-display`, `leading-copy`, `border-line`).
2. **Token semàntic `@theme`** quan el valor té dues aparicions reals amb la
   mateixa propietat i la mateixa funció visual, o quan `DESIGN.md` ja n'ha fixat
   el rol a l'escala tancada. El token i els consumidors s'afegeixen a la
   mateixa fase. Es pot editar `global.css` en qualsevol fase només per afegir
   o ajustar tokens d'escala aprovats i consumits en aquella fase. Els noms
   descriuen el rol (`tracking-label`, `shadow-action`), no el número. Els
   valors històrics gairebé iguals es normalitzen a l'escala de `DESIGN.md`; no
   es creen excepcions per pàgina.
3. **`@utility` estructural** només per a un patró reutilitzat que els
   namespaces de `@theme` no poden generar (per exemple un subratllat amb gruix
   i offset propis). No es converteix la classe d'un sol component en una
   utilitat global amb un altre nom.
4. **Arbitrari local justificat** (`[...]`) només quan el valor queda fora de
   l'escala tancada i té una raó documentada. No es trasllada CSS propi a un
   arbitrari només per mantenir-lo dins de `class`.
5. **CSS propi justificat** per selectors, cascades, pseudo-elements, markdown,
   estats complexos, gradients, filtres, textures i graelles que Tailwind no
   expressa amb claredat. Cada regla ha de tenir una justificació concreta en
   revisió i viu amb el component propietari o en un full petit importat per la
   plantilla que coordina diversos components fills. `@apply` no és
   l'arquitectura principal.

- Les utilitats amb nom de Tailwind, recolzades pels tokens de `@theme`, són
  l'opció per defecte per a composició, espaiat, tipografia, color i la resta
  d'estils ordinaris.
- Una utilitat arbitrària de Tailwind (`[...]`) no converteix CSS específic en
  una solució compartida.
- `src/styles/global.css` és l'únic fonament global: importa Tailwind, defineix
  els tokens de color, tipografia, ombra i espaiat semàntic amb `@theme`, manté
  les variables estructurals compartides a `:root`, declara les tipografies i
  conserva només els valors per defecte d'elements, focus, salt al contingut i
  moviment reduït. A la segona aparició semànticament equivalent, el valor es
  promou a token.
- Un component que només necessita declaracions ordinàries no crea un full CSS:
  aplica les utilitats amb nom al markup. Els fulls específics s'importen des del
  component o la plantilla propietaris, mai des del layout públic.
- Els selectors `:global(...)` per a markdown es declaren al component que
  posseeix el contenidor que rep l'HTML (`set:html`), mai des d'una plantilla o
  d'un component pare cap a classes de components fills. L'àncora local es manté
  fora de `:global(...)`.
- Si la mateixa regla de markdown afecta una classe compartida entre diverses
  seccions d'una pàgina, viu al full CSS sense scoping importat per la plantilla
  (`about.css`, `members.css`) com a selector normal, sense `:global(...)`.
- `:global(...)` mínim s'aplica a la quantitat de regles i a l'abast del
  selector: dins dels parèntesis només hi entra allò que no pot rebre l'atribut
  de scoping. El contingut editorial no genera classes, estils ni URLs
  decoratives.

## Selectors De Prova

- Les classes CSS són detalls d'implementació i mai fan de hooks E2E.
- Els tests localitzen els elements, per aquest ordre, pel rol i el nom
  accessible, l'etiqueta, el text visible o una relació semàntica amb el seu
  contenidor o control.
- `data-testid` només s'usa quan no hi ha cap alternativa semàntica. El test
  documenta al costat de l'ús per què el rol, el nom accessible, l'etiqueta, el
  text visible i les relacions semàntiques no identifiquen l'element.

## Noms Explícits

- Cap variable ni alias d'una sola lletra: tot identificador descriu el que
  representa (`messages`, no `m`; `edition`, no `e`). Els noms de paràmetres,
  destructuring i imports propis segueixen la mateixa regla.
- Els bindings d'importació de llibreries externes conserven el nom documentat
  per la llibreria (`z` de Zod); si cal un alias, ha de ser explícit.

## Constants Tipades (Sense Magic Strings)

- Els valors de cadena compartits es defineixen com a objectes `as const` i els
  tipus es deriven amb `(typeof constant)[keyof typeof constant]`.
- Les claus que un context pot produir es declaren com a subconjunts explícits
  (`eventHubStatusMessageKeys`, `homepageEventStatusMessageKeys`), no amb
  `Exclude` sobre el conjunt complet: cada context és greppable i autodocumentat.
- Quan una constant replica un enum de domini, es guarda amb
  `satisfies Record<Enum, string>` perquè el compilador avisi si falta un valor
  (`registrationStatusMessageKeys`).
- Els tests poden fixar els valors literals esperats: són el contracte amb el
  catàleg de missatges de Paraglide.

## Llegibilitat

- Branques explícites i retorns primerencs abans que ternaris niats; una funció
  pot ser més llarga només si així es llegeix més fàcilment.
- Funcions petites amb nom propi; un comentari breu explica convencions no
  òbvies (ex: el `--` de la data a la targeta del hub).
- La reutilització no ha de forçar composicions artificials: si dos llocs són
  visualment diferents, no s'unifiquen amb props de variants.

## Simplicitat

- El codi mínim correcte és l'objectiu: cada línia, variable, paràmetre,
  component, helper i test ha de justificar la seva existència. Si es pot
  eliminar sense canviar comportament, garanties de regressió, límits
  arquitectònics ni llegibilitat, s'elimina.
- No s'escriu codi «per si de cas»: cap guarda, valor per defecte, branca,
  prop ni cas de prova sense un comportament o risc de regressió real del moment
  (YAGNI).
- No es generalitza abans d'hora: un helper o fragment reutilitzable s'extreu a
  la segona aparició real, mai per anticipació. Les plantilles de detall i els
  components de secció exigits per l'arquitectura poden tenir un sol ús.
- En dades internes que ja han travessat la validació d'execució, no es repeteix
  una comprovació que el sistema de tipus ja garanteix. Els tipus no
  substitueixen la validació del contingut ni de cap altra frontera de confiança.
- Els comentaris expliquen el perquè, no el què; el codi que s'explica sol no
  porta comentari.
- Llegibilitat no vol dir verbositat: les branques explícites i els noms
  descriptius s'apliquen quan afegeixen claredat, no com a plantilla per a
  cada funció.

## Estabilitat Pública

El refactor no altera sortida visual, rutes, contingut ni comportament
observable. La sintaxi dels selectors i els noms de classe poden canviar perquè
no són contractes públics. Quan un refactor toca plantilles, la validació inclou
comparar el `dist/` generat amb el de `main`.

## Desviacions Conegudes

La PR `refactor(phase-4-t4.4): alinea components i helpers amb l'ADR 0006` va
corregir les desviacions registrades durant la fase 4: els components no tornen
a seleccionar dades de domini —les pàgines i les plantilles de detall els
passen la selecció resolta— i el contracte del `locale` als helpers queda
derivat de les estructures de dades mitjançant l'esmena de la regla 3 de l'ADR
0006 (16 d'agost de 2026). La portada i el hub de domini mantenen només la
composició pròpia de pàgines primes, sense `Intl`, derivacions d'estat ni
extracció d'host.
