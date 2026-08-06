# Convencions De Codi

## Propòsit

Aquest document operacionalitza l'[ADR 0006](decisions/0006-presentation-layer-structure.md)
i fixa com s'escriu el codi de `apps/web` perquè agents i persones el mantinguin
de manera coherent. `AGENTS.md` resumeix les obligacions; aquest document aporta
el detall, les regles de decisió i els exemples del propi codi. La revisió de
cada PR comprova aquestes regles.

## Capes

| Capa        | Ubicació                | Responsabilitat                                                                                              | No hi viu                                                    |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Pàgines     | `src/pages/`            | `getStaticPaths`, càrrega de dades, metadades i composició de components i layouts                           | `Intl.DateTimeFormat`, derivacions d'estat, extracció d'host |
| Domini      | `src/lib/content/`      | Selecció, ordenació, publicació i rutes del contingut editorial                                              | Presentació, text resolt                                     |
| Presentació | `src/lib/presentation/` | Funcions pures per locale: format de dates, derivació d'estat a clau de missatge i18n i host d'URLs externes | Imports d'Astro o Paraglide                                  |
| Components  | `src/components/`       | Fragments de UI reutilitzables i plantilles de detall separades per tipus d'entrada                          | Selecció i ordenació de dades (domini)                       |

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
- Els noms de classe i els selectors E2E es conserven: un refactor no canvia la
  sortida visual ni els selectors existents.

## Presentació

- Els helpers de `src/lib/presentation/` són purs: reben el `locale` i retornen
  dades o **claus de missatge**; mai importen Astro ni Paraglide.
- La resolució de text es fa al component amb `messages[clau]({}, { locale })`.
- Els helpers estan coberts per Vitest a `src/test/presentation-*.test.ts`.

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
  pot ser més llarga si així es llegeix més fàcilment.
- Funcions petites amb nom propi; un comentari breu explica convencions no
  òbvies (ex: el `--` de la data a la targeta del hub).
- La reutilització no ha de forçar composicions artificials: si dos llocs són
  visualment diferents, no s'unifiquen amb props de variants.

## Estabilitat Pública

El refactor no altera sortida visual, rutes, contingut ni selectors E2E. Quan
un refactor toca plantilles, la validació inclou comparar el `dist/` generat amb
el de `main`.
