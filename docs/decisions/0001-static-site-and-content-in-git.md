# ADR 0001: Web Estàtica I Contingut A Git

## Estat

Acceptada.

## Decisió

Utilitzar Astro, TypeScript, Content Collections i Zod per a la web. Desar el
contingut estructurat a Git i desplegar una compilació estàtica darrere de Caddy.

## Raonament

L'associació necessita una web editorial ràpida, mantenible i adequada per a un
VPS modest. Git ofereix un historial revisable i una font de veritat clara sense
introduir un CMS o una base de dades a la versió inicial.
