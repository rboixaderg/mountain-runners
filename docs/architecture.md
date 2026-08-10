# Arquitectura Tècnica

## Estat Actual

El repositori conté un workspace pnpm i una aplicació Astro estàtica mínima a
`apps/web`, amb validacions locals, integració contínua i un nucli segur de
validació editorial. Les Content Collections (`schools`, `events`, `entities`,
`documents`, `external-actions` i `contact`), les regles de publicació i les
rutes editorials mínimes ja estan implementades. La fase 3 ha publicat les
pàgines fixes de Qui som, Documents, Contacte i les tres pàgines legals (avís
legal, privacitat i cookies), i la fase 4 n'ha completat les variants en català,
castellà i anglès, juntament amb les traduccions del contingut de domini; el peu
enllaça aquestes rutes i mostra les dades institucionals de contacte. Encara no
s'han implementat les plantilles públiques finals de Socis i Escoles ni cap
servei o automatització de desplegament.

## Direcció Acceptada

La web serà un lloc estàtic amb Astro i TypeScript. Les Content Collections
validades amb Zod modelaran el contingut editorial, i Git en serà la font de
veritat. Caddy servirà la web des d'un VPS modest.

La versió inicial no té base de dades, CMS, comptes d'usuari ni backend
d'aplicació renderitzat al servidor.

## Límits De L'Arquitectura

| Àrea                | Responsabilitat                               | Límit                                                            |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Web estàtica        | Renderitzar contingut editorial publicat      | El build d'Astro no conté secrets                                |
| Contingut           | Pàgines estructurades i dades de l'associació | Versionat a Git i revisat per pull request                       |
| Xat públic          | Respondre preguntes sobre contingut publicat  | API Hono separada, de només lectura i sense accés editorial      |
| Assistent editorial | Preparar canvis de contingut                  | Flux privat de branca, validació i pull request                  |
| Allotjament         | Servir la web estàtica i serveis aïllats      | Caddy i CI/CD; sense desplegament des d'una sessió local d'agent |

## Estructura De Pàgines I Presentació

Les pàgines segueixen una separació de capes fixada a la T3.1 de la fase 3 i
registrada a l'[ADR 0006](decisions/0006-presentation-layer-structure.md). El
detall operatiu —tipus de components, guards, constants tipades i regles de
decisió— viu a [`docs/code-conventions.md`](code-conventions.md):

| Capa        | Ubicació                | Responsabilitat                                                                                              |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pàgines     | `src/pages/`            | Primes: `getStaticPaths`, càrrega de dades, metadades i composició de components i layouts                   |
| Domini      | `src/lib/content/`      | Selecció, ordenació, publicació i rutes del contingut editorial                                              |
| Presentació | `src/lib/presentation/` | Funcions pures per locale: format de dates, derivació d'estat a clau de missatge i18n i host d'URLs externes |
| Components  | `src/components/`       | Fragments de UI reutilitzables i plantilles de detall separades per tipus d'entrada                          |

Regles de manteniment (detallades a `AGENTS.md` i comprovades a la revisió de
cada PR):

1. A la segona aparició d'un helper de format, estat o URL, s'extreu a
   `src/lib/presentation/` i es reutilitza; no es duplica en pàgines ni
   components.
2. Les pàgines no contenen `Intl.DateTimeFormat`, derivacions d'estat ni
   extracció d'host; composen components i criden helpers purs.
3. Els helpers de presentació són purs, reben el locale i retornen dades o
   claus de missatge; no importen Astro ni Paraglide, i la resolució de text es
   fa a la capa de component amb el locale corresponent.
4. Cada tipus d'entrada té un component de detall propi; els fragments repetits
   són components reutilitzables, no codi copiat.
5. El refactor no altera sortida visual, rutes, contingut ni els selectors dels
   E2E existents.
6. La llegibilitat humana prima sobre la brevetat: les cadenes de ternaris
   niats i els condicionals enrevessats es reescriuen amb branques explícites,
   retorns primerencs o funcions petites amb nom propi.
7. Els valors de cadena compartits (claus de missatge, estats, zones horàries i
   similars) es defineixen com a constants tipades, i els tipus que els
   representen es deriven d'aquestes constants; no s'escampen strings literals
   per pàgines, components ni helpers.

## Xat Públic, Més Endavant

El xat públic indexarà tot el contingut publicat, incloent-hi pàgines editorials
i els seus blocs, i no només models concrets. Començarà amb un índex JSON o
NDJSON generat i recuperació lèxica. Una base de dades vectorial o embeddings no
formen part del disseny inicial.

## Fora D'Abast Ara

- Plantilles visuals i migració del contingut públic definitiu.
- Servei de xat Hono i generador d'índex.
- Integració amb Telegram, Discord o Hermes.
- Implementació de CI/CD i provisió del VPS.

Consulta els ADR de `docs/decisions/` per conèixer les decisions darrere
d'aquests límits.
