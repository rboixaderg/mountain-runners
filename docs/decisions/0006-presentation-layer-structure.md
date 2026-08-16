# ADR 0006: Estructura De Capes De Presentació I Pàgines Primes

## Estat

Acceptada.

## Relació Amb ADR 0004

L'ADR 0004 no es modifica: conserva el seu valor històric i continua governant
on viu l'estructura estable de l'aplicació i on viuen les dades editorials o
operatives canviants. Aquest ADR regula l'organització interna del codi de
presentació, sense alterar el límit entre codi i contingut.

Quan una regla de l'ADR 0004 i aquesta decisió difereixin sobre una pàgina
fixa, preval l'ADR 0005. Per a la resta de casos, preval l'ADR 0004.

## Context

Amb les fases 1 i 2 fusionades, les pàgines d'Astro acumulen lògica de
presentació duplicada: `Intl.DateTimeFormat` per a dates, derivacions d'estat
d'esdeveniments a text traduït i extracció d'host d'URLs externes apareixen a
la portada, al hub i al detall d'esdeveniments. Aquesta lògica no pertany al
domini editorial (`src/lib/content/`), que ha de seleccionar, ordenar i
publicar, però tampoc ha de viure a dins de cada pàgina, on es duplica i no es
pot testejar de manera aïllada.

La fase 3 afegirà plantilles noves (Qui som, Socis, Escoles, Documents,
Contacte). Abans d'ampliar-les cal fixar una estructura comuna i documentar les
regles que agents i persones han de mantenir, perquè les noves pàgines no
reprodueixin la duplicació existent.

## Decisió

Les pàgines segueixen una separació de capes amb responsabilitats fixes:

| Capa        | Ubicació                | Responsabilitat                                                                                              |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pàgines     | `src/pages/`            | Primes: `getStaticPaths`, càrrega de dades, metadades i composició de components i layouts                   |
| Domini      | `src/lib/content/`      | Selecció, ordenació, publicació i rutes del contingut editorial                                              |
| Presentació | `src/lib/presentation/` | Funcions pures per locale: format de dates, derivació d'estat a clau de missatge i18n i host d'URLs externes |
| Components  | `src/components/`       | Fragments de UI reutilitzables i plantilles de detall separades per tipus d'entrada                          |

Regles de manteniment:

1. A la segona aparició d'un helper de format, estat o URL, s'extreu a
   `src/lib/presentation/` i es reutilitza; no es duplica en pàgines ni
   components.
2. Les pàgines no contenen `Intl.DateTimeFormat`, derivacions d'estat ni
   extracció d'host; composen components i criden helpers purs.
3. Els helpers de presentació són purs i retornen dades o claus de missatge;
   no importen Astro ni Paraglide, i la resolució de text es fa a la capa de
   component amb el locale corresponent. Un helper rep el `locale` exactament
   quan llegeix dades indexades per idioma o produeix sortida localitzada
   (dates, rangs); si processa exclusivament dades sense camps localitzats
   (claus de missatge tipades, URLs, identificadors, ordenació per tipus,
   parseig), no el rep: la presència de camps `Record<Locale, …>` a
   l'estructura de dades és el senyal que l'obliga.
4. Cada tipus d'entrada té un component de detall propi; els fragments repetits
   són components reutilitzables, no codi copiat.
5. El refactor no altera sortida visual, rutes, contingut ni els selectors dels
   E2E existents.
6. La llegibilitat humana prima sobre la brevetat: una funció pot ser més llarga
   si així es llegeix més fàcilment. Les cadenes de ternaris niats i els
   condicionals enrevessats es reescriuen amb branques explícites, retorns
   primerencs o funcions petites amb nom propi, i la revisió de cada PR ho
   comprova.
7. Els valors de cadena compartits (claus de missatge, estats, zones horàries i
   similars) es defineixen com a constants tipades, i els tipus que els
   representen es deriven d'aquestes constants; no s'escampen strings literals
   per pàgines, components ni helpers.

El detall operatiu d'aquestes regles —tipus de components, guards de visibilitat,
exemples i criteris de decisió— es manté a
[`docs/code-conventions.md`](../code-conventions.md).

## Esmenes

- 16 d'agost de 2026: la regla 3 queda reformulada perquè el contracte del
  `locale` es derivi de les estructures de dades. L'ADR 0004 estableix que tot
  text o dada traduïble és un objecte indexat per idioma; per tant, un helper
  rep el `locale` exactament quan llegeix camps indexats per idioma o produeix
  sortida localitzada, i mai no se li afegeix un paràmetre de `locale` inert.
  Aquesta esmena substitueix la redacció original de la regla 3 i no afecta la
  resta de regles.

## Conseqüències

- Les pàgines noves de la fase 3 es construeixen primes i reutilitzen els
  helpers i components existents.
- La lògica de presentació es pot testejar amb Vitest sense executar Astro ni
  Paraglide.
- El domini editorial no es barreja amb la presentació: els canvis d'una capa
  no obliguen a tocar l'altra.
- La revisió de cada PR comprova l'absència de `Intl.DateTimeFormat`,
  derivacions d'estat i extracció d'host dins de `src/pages/` i la reutilització
  dels helpers a la segona aparició.
- Les claus de missatge i altres valors de cadena compartits queden tipats com a
  constants, de manera que un canvi de valor es propaga pels tipus derivats i no
  deixa strings literals sense controlar.
