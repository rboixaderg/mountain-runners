# Contribuir

## Abans De Començar

Llegeix `AGENTS.md`, `docs/architecture.md` i els ADR pertinents. Mantén cada
canvi prou acotat per poder-lo revisar de manera independent.

## Eines Locals

Cal tenir Node 24.11.0, pnpm 10.33.0 mitjançant Corepack i Gitleaks 8.30.1.
Gitleaks és obligatori: el hook de pre-commit l'executa abans de crear cada
commit per detectar secrets en els fitxers staged.

Instal·la Gitleaks segons el sistema operatiu:

- macOS amb Homebrew: `brew install gitleaks`
- Linux amb Homebrew: `brew install gitleaks`; en altres distribucions, baixa
  el binari corresponent des de la [release v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
  oficial i afegeix-lo al `PATH`.
- Windows amb WinGet: `winget install --id Gitleaks.Gitleaks --exact --version 8.30.1`

Després de la instal·lació, comprova la versió:

```sh
gitleaks version
```

L'ordre ha de retornar `8.30.1`. Si l'instal·lador ofereix una versió diferent,
instal·la la release fixada anterior abans de continuar.

## Flux De Treball

El worktree principal es manté a `main` i es reserva per planificar fases,
actualitzar-ne el seguiment i afegir o concretar tasques. Qualsevol tasca
d'implementació assignada a una fase es desenvolupa en un worktree dedicat, mai
al worktree principal.

1. Actualitza `main` i crea una branca de vida curta per a la tasca.
2. Crea un worktree dedicat associat a aquesta branca.
3. Fes el canvi complet més petit possible dins del worktree dedicat.
4. Executa les comprovacions aplicables i actualitza la documentació quan canviï
   el comportament o un límit arquitectònic.
5. Obre una pull request amb una descripció clara, evidència de validació i
   qualsevol impacte operatiu.
6. Fusiona-la només després de la revisió i de superar les comprovacions
   obligatòries.
7. Elimina el worktree i la branca de vida curta quan la tasca estigui fusionada.

Els canvis directes al servidor de producció i els push directes a la branca
principal protegida no formen part del flux de treball normal. Reservar el
worktree principal per a documentació de planificació no elimina aquestes
proteccions.

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
