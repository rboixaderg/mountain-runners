# Contribuir

## Abans De Començar

Llegeix `AGENTS.md`, `docs/architecture.md` i els ADR pertinents. Mantén cada
canvi prou acotat per poder-lo revisar de manera independent.

## Flux De Treball

1. Crea una branca de vida curta a partir de la branca principal protegida.
2. Fes el canvi complet més petit possible.
3. Executa les comprovacions aplicables i actualitza la documentació quan canviï
   el comportament o un límit arquitectònic.
4. Obre una pull request amb una descripció clara, evidència de validació i
   qualsevol impacte operatiu.
5. Fusiona-la només després de la revisió i de superar les comprovacions
   obligatòries.

Els canvis directes al servidor de producció i els push directes a la branca
principal protegida no formen part del flux de treball normal.

## Missatges De Commit

Utilitza Conventional Commits:

```text
type(optional-scope): concise imperative summary
```

Exemples:

```text
docs(architecture): define public chat boundary
security(deps): update vulnerable dependency
feat(events): add registration status
```

Utilitza un únic propòsit lògic per commit. Els canvis incompatibles requereixen
`!` després del tipus o abast i un peu de missatge explicatiu.

## Pull Requests

Les pull requests no poden contenir secrets, credencials generades ni formatació
no relacionada. Indica clarament si un canvi afecta contingut públic, models de
dades, seguretat, desplegament o el futur servei de xat.
