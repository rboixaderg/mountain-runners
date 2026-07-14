# ADR 0003: Flux D'Agents I Controls De Seguretat

## Estat

Acceptada.

## Decisió

Utilitzar normes portables per a agents a `AGENTS.md`, Conventional Commits,
pull requests revisades i controls de desplegament protegits. Els agents no
reben mai un permís implícit per fer push, desplegar, publicar versions ni
accedir a secrets.

El worktree principal es manté a `main` i es reserva per a la planificació i el
seguiment de fases. Cada tasca d'implementació d'una fase es fa en un worktree
dedicat, amb una branca de vida curta creada des de l'últim `main`. Aquesta
separació permet actualitzar la planificació o afegir tasques a `main` sense
barrejar-les amb una implementació en curs i no modifica els controls de revisió
ni de protecció de branca.

## Raonament

El repositori és públic i es mantindrà amb l'ajuda d'agents. Aquests controls
fan els canvis atribuïbles, revisables i reversibles, i eviten que l'automatització
esdevingui una via d'accés a producció.

Els worktrees redueixen els conflictes entre el seguiment viu del projecte i les
branques d'implementació, i fan explícit quin directori pot modificar cada tipus
de feina.
