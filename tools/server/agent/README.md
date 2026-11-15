# Agent privat de desenvolupament, T8.3

Aplicació de Mountain Runners que porta una petició de Telegram fins a una PR.
El servei **no està desplegat ni activat**. Aquesta branca afegeix l'avís de CI
de T8.4 vinculat al SHA publicat, la reparació automàtica acotada d'una CI
vermella, la preview demanada al tema i el merge demanat amb `/merge`; la
continuació entre temes continua pendent. Cap canvi d'aquesta branca autoritza instal·lacions ni operacions
remotes.

## Nucli reutilitzable i aplicació

El transport, l'autorització, les sessions, la cua i el protocol RPC viuen a
[`packages/telegram-pi-bridge`](../../../packages/telegram-pi-bridge/README.md).
Aquest paquet té API, llicència MIT, exemple i proves propis, sense dependències
npm ni referències a Docker, GitHub o als prompts del projecte.

Aquest directori és el consumidor. Conté les decisions que no pertoquen al pont:
què és una implementació, quines regles s'han de llegir, on es pot executar
codi, quins secrets pot rebre Pi i quan es pot fer commit, push i PR.

```text
packages/telegram-pi-bridge/       nucli independent
├── src/telegram/                 API, autoria, pertinença i bucle del pont
├── src/sessions/                 identitat per tema i cua SQLite
├── src/pi/rpc.mjs                transport RPC sense política d'execució
├── src/index.mjs                 API agregada; el servei usa entrades separades
├── examples/conversation.mjs     conversa sense eines, repositori ni Docker
└── test/                         proves executables sense el workspace

tools/server/agent/               aplicació de Mountain Runners
├── config.mjs                    configuració i credencials del servei
├── processes/telegram-bridge/
│   └── main.mjs                  connecta paquet i flux de desenvolupament
├── policy/
│   └── development.mjs           prompts, comprovació, noms i informes
├── workflow/
│   ├── project-runner.mjs        connecta política, model, sandbox i publicador
│   ├── run-instruction.mjs       coordina consulta, implementació o reparació
│   ├── ci-watch.mjs              avís de CI i reserva de la reparació acotada
│   ├── preview-request.mjs       petició `/preview` determinista i confirmació
│   ├── merge-request.mjs         comanda `/merge` determinista i recuperació
│   └── ci-repair.mjs             executa una reparació quan la cua està inactiva
├── runtime/
│   ├── request-kind.mjs          interpreta la petició actual sense eines
│   ├── agent.mjs                 prepara el perfil i inicia el torn
│   ├── pi-adapter.mjs            entorn, eina aïllada i neteja de Podman
│   ├── profile.mjs               prepara recursos de confiança
│   └── extensions/sandbox-bash.ts única eina del model
├── sandbox/
│   ├── arguments.mjs             muntatge, identitat i límits de Podman
│   ├── commands.mjs              execució i aturada dels contenidors
│   └── errors.mjs                aturada no confirmada que bloqueja el servei
└── repository/
    ├── trusted-git.mjs            metadades explícites i entorn restringit
    ├── worktrees.mjs              worktree, branca, commit i estat publicat
    ├── secret-scan.mjs            historial, rutes i credencials conegudes
    ├── publisher.mjs              push, PR i confirmació de l'estat publicat
    ├── github.mjs                 client de GitHub, push segur i lectura de CI
    ├── ci-status.mjs              check runs i estats de commit d'un SHA exacte
    ├── request-signal.mjs         termini de lectura amb el senyal d'aturada
    ├── preview-comment.mjs        comentari de confirmació del publicador de confiança
    ├── preview-request-store.mjs  peticions de preview durables
    ├── merge-request-store.mjs    peticions de merge durables
    └── ci-watch-store.mjs         avís de CI i intents de reparació duradors
```

Per seguir el codi, comença per `processes/telegram-bridge/main.mjs`, continua
amb `AgentBridge` del paquet i després amb `workflow/project-runner.mjs` i
`workflow/run-instruction.mjs`.
El punt d'unió és `runInstruction(request, { signal })`, no un sistema de
plugins ni una còpia de les convencions del projecte.

El servei importa `/telegram`, `/sessions` i `/pi` per separat. Un consumidor
que només usa RPC no carrega Telegram ni SQLite.

`policy/development.mjs` no accedeix a fitxers, processos ni xarxa. Defineix
els prompts, `pnpm check`, els noms de branca i els textos públics. La
composició de `workflow/project-runner.mjs` connecta aquestes regles amb les
integracions. El coordinador rep operacions i rutes, no la configuració secreta
ni els clients de Docker o GitHub. El publicador retorna un refús local o una
publicació confirmada; propaga els errors remots de resultat desconegut.

Aquesta separació no fa configurables els controls de seguretat. L'autorització,
l'aïllament, la llista blanca d'entorn, les validacions de Git i l'escaneig de
secrets continuen a les seves fronteres. El coordinador només arriba al
publicador després d'una implementació amb canvis i comprovacions correctes.

El paquet està enllaçat amb `workspace:*` durant el desenvolupament. A la
instal·lació prevista es copia a
`/usr/local/lib/mountain-runners/node_modules/telegram-pi-bridge/`, al costat
d'`agent/`. No depèn d'un symlink al clon del projecte ni d'una instal·lació npm
al servidor. El nom local encara no representa una publicació a npm.

## Recorregut d'una petició

1. El paquet verifica el grup, tema, autor i pertinença actual, desa la
   instrucció abans d'avançar l'offset i la deduplica. Només hi ha una execució
   global; un resultat incert bloqueja les següents. Les peticions noves durant
   el bloqueig es refusen amb avís. Un error de consulta de pertinença també
   informa l'autor; no admet la instrucció per defecte.
2. `workflow` interpreta la petició amb una crida efímera sense eines, historial
   ni context del repositori. Si no és clara, demana aclariment.
3. El servei prepara el worktree actual del tema. Una feina nova preserva
   l'anterior a `<tema>-before-<update>` i crea un worktree des de `origin/main`,
   sense arrossegar fitxers ignorats d'una feina anterior.
   Només una continuació explícita reutilitza la feina pendent actual.
   A l'arrencada, `repository/retention.mjs` esborra només els worktrees
   arxivats que no tenen res a perdre: cap commit per davant d'`origin/main` i
   cap canvi sense cometre. Conserva sempre l'arxiu més recent de cada tema i no
   toca mai el worktree actiu. Si la retenció falla, ho registra i el servei
   continua.
   `runtime/pi-adapter` tria
   explícitament el perfil, l'entorn, `sandbox_bash` i la neteja dels processos.
   El paquet només executa el protocol RPC amb aquestes opcions.
4. Una consulta munta `/work` en mode de només lectura i retorna la resposta,
   sense publicar canvis anteriors pendents. Una implementació pot editar i
   provar dins del mateix sandbox.
5. Si hi ha canvis o commits pendents, `workflow` crea o continua la branca i
   executa `pnpm check` dins del contenidor. Una fallada conserva la feina.
6. `repository` fa commit, escaneja les credencials conegudes, publica la branca
   i obre o reutilitza la PR. Només després de confirmar push i PR registra el
   commit publicat fora del muntatge. El paquet retorna el resultat al tema.
7. Abans de respondre, `workflow` desa un seguiment de CI vinculat al SHA
   publicat. Un bucle en segon pla llegeix els check runs i els estats de commit
   d'aquell SHA i, quan les comprovacions obligatòries acaben, envia el resultat
   al mateix tema. El bucle no bloqueja la cua; un enviament no confirmat queda
   com a incert i no es repeteix sol.
8. Si les comprovacions obligatòries fallen, `workflow/ci-watch.mjs` reserva una
   reparació automàtica abans d'avisar i tanca el seguiment. `ci-repair.mjs`
   executa l'intent quan la cua d'instruccions és buida i no està bloquejada per
   un resultat incert, pel mateix camí de model, comprovació, commit i publicació
   que una implementació. Abans de tocar la branca torna a llegir la PR i les
   comprovacions obligatòries: si la PR és tancada o moguda, si el commit ja és
   verd o si l'estat no és concloent, no publica res i ho comunica. El commit nou reobre el mateix seguiment
   al tema i la reparació no compta com a treball nou. Dues reparacions
   consecutives del mateix conjunt de comprovacions fallides és el límit; després
   n'informa i espera una instrucció nova. La identitat de la fallada és el
   conjunt de noms de les comprovacions fallides: el missatge i el SHA són
   evidència, no identitat. Només compta l'intent que s'ha arribat a agafar. Una
   reparació que no canvia res, o que no pot confirmar el resultat, es tanca i es
   comunica sense reintentar-se.

9. Una persona verificada pot demanar la preview en llenguatge natural. El
   classificador només etiqueta la petició com a `preview`: el model no s'inicia
   ni toca cap worktree. `workflow/preview-request.mjs` fixa la petició al commit
   que el servei va informar en verd en aquell tema (mai una PR o un SHA escrits
   per la persona) i torna a llegir la PR i les comprovacions obligatòries:
   PR oberta, cap igual al commit fixat, branca del repositori principal i
   comprovacions obligatòries totes en verd. Si hi ha qualsevol dubte o un error
   de lectura, refusa i ho diu. Només llavors desa la petició (`commenting`),
   comenta exactament `/preview` amb la credencial del servei i passa a
   `awaiting`. Un bucle en segon pla llegeix els comentaris de la PR i només
   accepta el del publicador de la fase 6 (`github-actions[bot]`, marcador,
   origen exacte `https://pr-<n>.preview.mountainrunners.cat`, el SHA fixat i
   escrit o actualitzat després de la petició). Retorna URL, SHA curt i PR al
   tema; si el termini s'esgota, ho comunica com a no confirmat sense
   construir cap URL. Un rebuig definitiu de GitHub (4xx, llevat de 408 i 429) acaba la petició
   com a `failed` (traça `preview_failed`) sense bloquejar el servei; qualsevol
   altre error deixa la petició `uncertain`. La identitat de GitHub de l'agent ha
   de ser col·laboradora del repositori. Es pot repetir `/preview` pel mateix commit només quan la
   petició anterior ha acabat. Una CI verda, una PR nova o una reparació no
   demanen mai cap preview.

10. Una persona verificada pot demanar el merge amb la comanda literal `/merge`,
    `/merge <PR>` o `/merge <PR> <SHA>` completa. `run-instruction.mjs` la reconeix
    abans del classificador: ni aquest ni el model la veuen, i la prosa («fusiona-la»)
    no fusiona res. `workflow/merge-request.mjs` torna a verificar la pertinença,
    fixa la petició a la PR i al commit de l'últim avís de CI en verd lliurat al
    tema i refusa si el tema té feina més nova que aquell avís (instrucció,
    reparació o seguiment encara sense informar). Rellegeix la PR en fallada tancada
    (oberta, no esborrany, base `main`, repositori principal, cap igual al commit
    fixat, comprovacions obligatòries en verd i `mergeable_state` `clean`) i desa
    la petició (`merging`) abans de la crida. Només llavors demana a GitHub un
    squash amb el cos exacte `{ sha, merge_method: "squash" }`. Un 4xx definitiu
    (llevat de 408 i 429) acaba com a `failed`; la resta d'errors deixa la petició
    `uncertain` i no es repeteix mai: la petició següent d'aquella PR i
    l'arrencada llegeixen la PR i, si GitHub la mostra fusionada, la tanquen com a
    `merged` (`merge_reconciled`) i ho informen. Si no la mostra fusionada,
    l'arrencada avisa el tema una sola vegada i només una persona verificada ho
    resol amb `/merge <PR> <SHA>` del commit de la petició desconeguda: la tanca
    com a `not_merged` (`merge_uncertain_cleared`) i repeteix tot el flux des de
    zero (si el cap de la PR s'ha mogut, amb el SHA del cap actual, que ha de ser l'últim informat en verd); `/merge` i `/merge <PR>` mai no la desbloquegen i no cal editar SQLite.
    La pertinença superada queda a la traça (`merge_membership_verified`). La
    resposta nomena la PR i el commit de merge. El detall és a [`docs/deployment.md`](../../../docs/deployment.md).

Un error local conegut, un timeout o una cancel·lació amb neteja confirmada
retornen una fallada sense bloquejar la cua. L'avís de CI tampoc no bloqueja la
cua: només es declaren verdes les comprovacions obligatòries presents i
correctes del SHA exacte, i un resultat no confirmat es comunica sense
reintentar-lo. Un error després d'iniciar la
publicació, o una aturada de sandbox no confirmada, retornen un resultat incert.
L'arrencada es refusa mentre quedi qualsevol instrucció incerta, una reparació
interrompuda o un comentari `/preview` interromput abans de saber si s'ha
publicat, fins i tot després de diversos reinicis. Amb el servei en marxa,
una reparació amb resultat desconegut atura les reparacions automàtiques mentre
les instruccions del tema continuen. La reconciliació completa
continua fora de T8.3 i T8.4.

La classificació semàntica no substitueix l'autorització, els muntatges de només
lectura ni les operacions deterministes de Git. El paquet no inclou aquesta
política ni pot autoritzar per si sol una publicació.

## Fronteres de confiança

- El pont és l'únic procés amb els tokens de Telegram i GitHub. L'adaptador
  prepara una llista blanca d'entorn per a Pi, amb només la credencial del model.
- La reparació automàtica continua sent treball del servei, no del model: el
  model només proposa codi dins del sandbox. El servei fixa el commit que cal
  reparar, hi comprova el cap del worktree, executa `pnpm check` i publica pel
  mateix camí de sempre. El prompt inclou el diff publicat i la sortida de les
  comprovacions com a dades no fiables, sense credencials conegudes, i el model
  no rep cap operació de GitHub. Decidir si una fallada és dins de l'abast és
  criteri del model: cap camí determinista no ho pot saber abans de veure el
  diff. Els controls són el límit d'intents, la comprovació del cap de la PR,
  `pnpm check` i la revisió humana de la PR.
- El paquet desactiva les eines i la càrrega automàtica de recursos per defecte.
  L'aplicació selecciona explícitament l'extensió instal·lada de confiança i
  `sandbox_bash`. Ni un perfil antic ni el repositori hi poden afegir eines.
- El model llegeix `AGENTS.md`, skills i documentació dins del contenidor. Pi
  no els carrega al host ni manté còpies que puguin seguir symlinks cap a secrets.
- Podman s'executa localment sense root ni dimoni, amb `--remote=false` i
  `--userns=keep-id`. Conserva l'UID/GID del worktree i `UMask=0077`. Ni el pont
  ni Pi tenen grup Docker o socket de contenidors del host. El contenidor no
  té xarxa, credencials ni metadades Git.
- Git selecciona metadades del registre de confiança, comprova l'indicador
  `.git`, desactiva hooks i fsmonitor i no hereta l'entorn secret del pont.
- La publicació inspecciona tots els objectes nous de `origin/main..HEAD`,
  inclosos fitxers esborrats i missatges de commit, contra els tokens de
  Telegram, GitHub i les variables del proveïdor. Refusa objectes il·legibles,
  objectes de més de 2 MiB o un total superior a 32 MiB. També rebutja canvis
  a `.github/**` i `CODEOWNERS` en qualsevol commit del rang. El push usa el
  SHA inspeccionat. Cal una credencial sense `Workflows: write`.
- Sense `SUMMARY` vàlid, la branca usa `feat/agent-change-<update>` i el títol
  usa `feat(agent): update project`. No es deriva cap fallback del text privat.
  El prompt indica els tipus acceptats (`feat`, `fix`, `docs`, `refactor`,
  `test`, `build`, `ci`, `chore`, `security`) perquè el model no n'inventi cap
  que el parser hagi de descartar.
- La sortida conjunta de stdout i stderr es limita a 1 MiB per ordre i per torn
  RPC. Un excés atura el procés i espera la neteja dels contenidors. Els
  missatges de l'assistent es concatenen amb una separació de paràgraf.
- Matar Pi no atura els contenidors de Podman. El paquet crida `onInterrupted`; l'adaptador del
  projecte espera l'aturada dels contenidors i no oculta una neteja fallida.
  També verifica la neteja després de cada ordre del sandbox i dels torns
  completats, abans de comprovar o publicar. Atura els contenidors actius de la sessió, elimina els seus
  registres aturats i comprova que no en quedi cap. Si Podman no pot completar
  la neteja, el resultat és incert; no esborra worktrees ni sessions.

## Imatge experimental per a comprovacions offline

`sandbox/Containerfile` prepara una imatge de Node amb pnpm, el magatzem de
paquets del lockfile i Chromium de Playwright. Construeix-la només
a partir d'una còpia d'un commit revisat, no d'un worktree amb fitxers locals.
La construcció necessita xarxa; l'execució del sandbox no en té. Una imatge
preparada per a un lockfile pot no contenir les dependències d'un altre.

El magatzem és a `/opt/mountain-agent/store`. Una instal·lació al worktree usa
`pnpm install --offline --frozen-lockfile --store-dir /opt/mountain-agent/store`.
Les proves que executen fitxers temporals necessiten `TMPDIR` en un directori
escriptible de `/work`: `/tmp` manté `noexec`. El perfil del sandbox executa
la prova de navegador amb Chromium. La CI executa la mateixa prova i els E2E
amb Chromium, Firefox i WebKit; una fallada de CI bloqueja el merge.

Abans d'una implementació, una continuació o una reparació, el servei prepara
les dependències offline perquè el model pugui executar proves. Les consultes no
instal·len res i conserven el worktree en només lectura. Les ordres
d'implementació usen un `TMPDIR` ignorat per Git dins del worktree. Abans de
publicar, el servei torna a instal·lar les dependències del lockfile i executa
`pnpm check` amb un `TMPDIR` nou. Si la preparació falla, no inicia el model o
no publica, segons el moment de la fallada.

La versió de pnpm del `package.json` ha de coincidir amb la de la imatge. Una
diferència es refusa sense descarregar cap versió nova. La imatge és
experimental i no autoritza activar el pilot sense les comprovacions del VPS.

## Proves i fonts de veritat

Les proves es mantenen amb el propietari de cada comportament. El paquet prova
Telegram, cua, sessions i RPC. L'aplicació prova la política, el sandbox i Git.
`workflow/journey.test.mjs` cobreix el recorregut fins a PR amb fronteres externes
simulades. `repository/ci-status.test.mjs` cobreix la classificació de la CI i la
identitat de la fallada; `workflow/ci-watch.test.mjs`, la reserva de reparacions;
i `workflow/ci-repair.test.mjs`, l'execució, el límit, el resultat desconegut i
l'aturada. `workflow/bridge-package.test.mjs` executa el paquet en una còpia
independent, prova el tarball des d'un consumidor extern i verifica la disposició
instal·lada del servei. No s'hi fan peticions reals ni es necessiten credencials.

Des de l'arrel, amb Node 24.11.0 i pnpm 10.33.0:

```sh
pnpm --filter telegram-pi-bridge test
pnpm test:server
pnpm check

# Opcional: Linux, Podman sense root i imatge local; no es descarrega res.
MR_ISOLATION_TEST_IMAGE=<imatge-local> node --test tools/server/agent/sandbox/commands.test.mjs

# Opcional: perfil real a Pi, sense credencials ni petició al model.
MR_AGENT_PI_COMMAND=<executable-pi> node --test tools/server/agent/runtime/profile-smoke.test.mjs
```

- [Abast de T8.3](../../../docs/specs/phase-8-editorial-assistance.md#t83-base-operativa-de-telegram-fins-a-pr).
- [Frontera acceptada, ADR 0013](../../../docs/decisions/0013-private-development-agent-boundary.md).
- [Instal·lació i pendents del pilot](../../../docs/deployment.md#agent-privat-de-desenvolupament-t83).

Aquestes proves no demostren els permisos reals de GitHub ni l'aïllament al VPS.
L'activació del pilot, la revisió independent i la distribució pública del paquet
continuen requerint aprovació explícita.
