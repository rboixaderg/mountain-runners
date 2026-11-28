# Contribuir

## Abans De Començar

Llegeix `AGENTS.md`, `docs/architecture.md` i els ADR pertinents. Mantén cada
canvi prou acotat per poder-lo revisar de manera independent.

## Eines Locals

Cal tenir Node 24.22.3, pnpm 10.33.0 mitjançant Corepack, Gitleaks 8.30.1 i els
navegadors fixats per Playwright. Gitleaks és obligatori: el hook de pre-commit
l'executa abans de crear cada commit per detectar secrets en els fitxers staged.

Després de `pnpm install`, instal·la els navegadors locals:

```sh
pnpm exec playwright install chromium firefox webkit
```

La CI utilitza `--with-deps` per instal·lar també les dependències de sistema a
Linux.

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

Els hooks locals vigents són:

| Hook         | Comprovació                                                         |
| ------------ | ------------------------------------------------------------------- |
| `pre-commit` | Gitleaks sobre staged i `lint-staged`                               |
| `commit-msg` | Conventional Commits amb Commitlint                                 |
| `pre-push`   | `pnpm check:local` (format, lint, typecheck, Vitest i documentació) |

El hook `pre-push` és ràpid i no substitueix les proves que afecten el canvi. Si
afegeixes o modifiques un recorregut E2E, executa'l localment abans de declarar
la feina feta; la CI continua executant la suite completa.

## Flux De Treball

El worktree principal es manté net a `main` com a còpia de referència. Qualsevol
canvi versionat, sigui de codi, contingut, especificacions o documentació, es fa
en un worktree dedicat amb una branca de vida curta creada des de l'últim
`main`.

1. Actualitza `main` i crea una branca de vida curta per al canvi.
2. Crea un worktree dedicat associat a aquesta branca.
3. Fes el canvi complet més petit possible dins del worktree dedicat.
4. Executa les comprovacions aplicables i actualitza la documentació quan canviï
   el comportament o un límit arquitectònic.
5. Obre una pull request amb un títol alineat amb l'abast, una descripció clara,
   evidència de validació i qualsevol impacte operatiu.
6. La PR només es fusiona després de la revisió i de superar les comprovacions
   obligatòries. Segueix les [regles de merge d'AGENTS.md](AGENTS.md#git-and-review).
7. Elimina el worktree i la branca de vida curta quan el canvi estigui fusionat.

Els canvis directes al servidor de producció i els push directes a la branca
principal protegida no formen part del flux de treball.

## Estratègia de proves

L'[estratègia de proves](docs/testing-strategy.md) governa quan cal una unitària,
un render Astro, un contracte de build o un recorregut E2E. Consulta-la abans
d'afegir, moure o eliminar proves; els agents carreguen la skill local
`frontend-testing`. La skill `vitest` continua sent una referència tècnica.

## Contractes de prova del web

Les proves E2E deriven les entrades del catàleg publicat, sense fixar el recompte
ni els noms del contingut editorial. Les unitàries han de comprovar les regles
amb casos independents, inclosos slugs compartits entre idiomes i esdeveniments
que coincideixen el mateix dia o duren diversos dies.

[`structured-data.spec.ts`](apps/web/e2e/structured-data.spec.ts) comprova que
les pàgines connecten les dades JSON-LD al layout en l'HTML del build. Aquest
contracte només s'executa en Chromium d'escriptori; les proves dels helpers i
del layout cobreixen per separat la generació i l'escaping. La presència de
metadades opcionals es comprova segons el contracte de la plantilla, no segons
si l'etiqueta ja existeix al DOM.

## Revisió Independent Amb Agents

Per contrastar una implementació amb la seva tasca de l'especificació, obre una
sessió nova i demana explícitament la skill `spec-implementation-review`. Indica
la pull request, branca o worktree que cal revisar i la ruta i secció de
l'especificació aplicable. Aquest flux és només per a implementacions pròpies
creades dins del procés de confiança del projecte, no per executar o revisar
codi extern no fiable.

```text
Utilitza la skill spec-implementation-review per validar la PR #12 contra
docs/specs/phase-1/phase-1-foundation.md, tasca "Nucli editorial segur".
```

La skill coordina revisions independents de compliment, correcció i tests, i
retorna un informe de només lectura. No modifica la implementació ni substitueix
les comprovacions obligatòries de CI o la revisió humana final.

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

El títol segueix Conventional Commits, identifica una única unitat de treball i
utilitza els formats definits a la
[convenció d'especificacions](docs/specs/README.md#seguiment-i-actualització)
per a tasques de fase, tasques d'especificacions autònomes, edició
d'especificacions i canvis que no requereixen especificació. No agrupis feines
diferents sota un títol genèric: si l'abast d'una especificació canvia,
actualitza-la abans d'obrir la PR.

La CI valida que el títol compleixi Conventional Commits. La correspondència
amb l'identificador exacte de l'especificació es comprova en la revisió humana.
