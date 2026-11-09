# ADR 0003: Flux D'Agents I Controls De Seguretat

## Estat

Acceptada. Esmenada el 9 de novembre de 2026 (T8.2): l'[ADR 0013](0013-private-development-agent-boundary.md)
acota una excepció per al servei privat de desenvolupament de la fase 8. Vegeu
l'apartat Esmena.

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

## Esmena (T8.2, 9 de novembre de 2026): excepció acotada del servei privat

L'[ADR 0013](0013-private-development-agent-boundary.md) acota una excepció per
al servei privat de desenvolupament de la fase 8. Una petició d'implementació
d'un membre verificat del grup autoritza editar, executar proves, fer commit,
fer push a la branca de treball i obrir o actualitzar la PR. Una comanda
explícita `/merge <PR>` autoritza el merge d'aquella PR, fixat al commit que el
servei ha informat al fil i amb les comprovacions obligatòries en verd.

L'excepció no cobreix l'auto-merge, el push directe a `main`, els canvis de
protecció ni el desplegament, que continuen prohibits en tots els casos. Les
sessions locals i la resta d'agents mantenen la prohibició implícita de push,
merge, publicació i accés a secrets. La revisió humana i les proteccions de
`main` es mantenen: el merge continua sent una decisió humana que el servei
només executa amb la petició verificada.

## Raonament

El repositori és públic i es mantindrà amb l'ajuda d'agents. Aquests controls
fan els canvis atribuïbles, revisables i reversibles, i eviten que l'automatització
esdevingui una via d'accés a producció.

Els worktrees redueixen els conflictes entre el seguiment viu del projecte i les
branques d'implementació, i fan explícit quin directori pot modificar cada tipus
de feina.
