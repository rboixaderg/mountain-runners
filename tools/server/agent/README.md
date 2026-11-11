# Agent privat de desenvolupament, T8.3

Aplicació de Mountain Runners que porta una petició de Telegram fins a una PR.
El servei **no està desplegat ni activat**. El merge i la preview continuen fora
de T8.3; cap canvi d'aquesta branca autoritza instal·lacions ni operacions remotes.

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
│   └── run-instruction.mjs       coordina consulta o implementació fins a PR
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
    └── github.mjs                 client de GitHub i push segur
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

Un error local conegut, un timeout o una cancel·lació amb neteja confirmada
retornen una fallada sense bloquejar la cua. Un error després d'iniciar la
publicació, o una aturada de sandbox no confirmada, retornen un resultat incert.
L'arrencada es refusa mentre quedi qualsevol instrucció incerta, fins i tot
després de diversos reinicis. La reconciliació completa continua fora de T8.3.

La classificació semàntica no substitueix l'autorització, els muntatges de només
lectura ni les operacions deterministes de Git. El paquet no inclou aquesta
política ni pot autoritzar per si sol una publicació.

## Fronteres de confiança

- El pont és l'únic procés amb els tokens de Telegram i GitHub. L'adaptador
  prepara una llista blanca d'entorn per a Pi, amb només la credencial del model.
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
- La sortida conjunta de stdout i stderr es limita a 1 MiB per ordre i per torn
  RPC. Un excés atura el procés i espera la neteja dels contenidors. Els
  missatges de l'assistent es concatenen amb una separació de paràgraf.
- Matar Pi no atura els contenidors de Podman. El paquet crida `onInterrupted`; l'adaptador del
  projecte espera l'aturada dels contenidors i no oculta una neteja fallida.
  També verifica la neteja després dels torns completats, abans de comprovar
  o publicar, per detectar contenidors que hagin sobreviscut a un error d'eina.

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

Abans d'una implementació o continuació, el servei prepara les dependències
offline perquè el model pugui executar proves. Les consultes no instal·len res
i conserven el worktree en només lectura. Les ordres d'implementació usen un
`TMPDIR` ignorat per Git dins del worktree. Abans de publicar, el servei torna
a instal·lar les dependències del lockfile i executa `pnpm check` amb un
`TMPDIR` nou. Si la preparació falla, no inicia el model o no publica,
segons el moment de la fallada.

La versió de pnpm del `package.json` ha de coincidir amb la de la imatge. Una
diferència es refusa sense descarregar cap versió nova. La imatge és
experimental i no autoritza activar el pilot sense les comprovacions del VPS.

## Proves i fonts de veritat

Les proves es mantenen amb el propietari de cada comportament. El paquet prova
Telegram, cua, sessions i RPC. L'aplicació prova la política, el sandbox i Git.
`workflow/journey.test.mjs` cobreix el recorregut fins a PR amb fronteres externes
simulades. `workflow/bridge-package.test.mjs` executa el paquet en una còpia
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
