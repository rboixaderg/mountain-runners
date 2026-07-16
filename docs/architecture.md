# Arquitectura Tècnica

## Estat Actual

El repositori conté un workspace pnpm i una aplicació Astro estàtica mínima a
`apps/web`, amb validacions locals, integració contínua i un nucli segur de
validació editorial. Les sis Content Collections, les regles de publicació i les
rutes editorials mínimes ja estan implementades. Encara no s'han implementat les
plantilles públiques finals ni cap servei o automatització de desplegament.

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
