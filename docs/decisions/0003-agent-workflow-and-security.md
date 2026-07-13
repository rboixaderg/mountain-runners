# ADR 0003: Flux D'Agents I Controls De Seguretat

## Estat

Acceptada.

## Decisió

Utilitzar normes portables per a agents a `AGENTS.md`, Conventional Commits,
pull requests revisades i controls de desplegament protegits. Els agents no
reben mai un permís implícit per fer push, desplegar, publicar versions ni
accedir a secrets.

## Raonament

El repositori és públic i es mantindrà amb l'ajuda d'agents. Aquests controls
fan els canvis atribuïbles, revisables i reversibles, i eviten que l'automatització
esdevingui una via d'accés a producció.
