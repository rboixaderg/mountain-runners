# Agent privat de desenvolupament, T8.3

Aplicació de Mountain Runners que porta una petició de Telegram fins a una PR.
El servei **no està desplegat ni activat**. Aquesta branca afegeix l'avís de CI
de T8.4 vinculat al SHA publicat, la reparació automàtica acotada d'una CI
vermella, la preview demanada al tema, el merge demanat amb `/merge`, la
continuació d'una PR des d'un altre tema, l'avís de solapaments, els adjunts
d'imatge, la continuïtat de la conversa d'un tema de T8.7, el llenguatge planer,
els avisos únics i la publicació per petició de T8.8, i l'estat del tema que rep
cada torn de T8.8. Cap canvi d'aquesta branca autoritza
instal·lacions ni operacions remotes.

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
├── attachments/
│   ├── image-format.mjs          capçaleres, dimensions i metadades d'imatge
│   ├── image-file.mjs            tipus real, límit de 20 MB i neteja de capçaleres
│   ├── destination.mjs           directori ignorat del worktree i neteja segura
│   ├── prepare.mjs               descàrrega temporal i validació de l'adjunt
│   ├── scale.mjs                 reducció a 2.400 px dins del sandbox
│   ├── store.mjs                 magatzem durador per tema i retenció de 7 dies
│   ├── read.mjs                  lectura segura d'un adjunt per a `view_attachment`
│   ├── safe-read.mjs             lectura acotada sense seguir enllaços simbòlics
│   ├── refusals.mjs              motius de refús compartits
│   └── test-support/             imatges sintètiques de les proves
├── commands/trace/
│   └── cli.mjs                   consulta de només lectura de la traça privada
├── commands/reconcile/
│   ├── cli.mjs                   embolcall de procés: umask privat i codi de sortida
│   ├── command.mjs               ordre d'operador, amb clients de GitHub i Telegram injectables
│   └── uncertain-cases.mjs       fets i resolució d'una instrucció, reparació, preview o avís
├── commands/migrate-identifiers/
│   ├── cli.mjs                   migració dels noms antics, sense arrencar el servei
│   └── command.mjs               la mateixa migració que fa l'arrencada, idempotent
├── processes/telegram-bridge/
│   └── main.mjs                  connecta paquet i flux de desenvolupament
├── policy/
│   └── development.mjs           prompts, comprovació, noms i informes
├── workflow/
│   ├── project-runner.mjs          connecta política, model, sandbox i publicador
│   ├── run-instruction.mjs         coordina consulta, implementació o reparació
│   ├── ci-watch.mjs                avís de CI i reserva de la reparació acotada
│   ├── preview-request.mjs         petició `/preview` determinista i confirmació
│   ├── merge-request.mjs           comanda `/merge` determinista i recuperació
│   ├── cross-topic-continuation.mjs represa d'una PR publicada des d'un altre tema
│   ├── overlap-warning.mjs         avís dels fitxers que se solapen amb feines actives
│   ├── topic-state.mjs             estat del tema que rep cada torn, amb lectures de GitHub
│   └── ci-repair.mjs               executa una reparació quan la cua està inactiva
├── runtime/
│   ├── request-kind.mjs          interpreta la petició actual sense eines
│   ├── agent.mjs                 prepara el perfil i inicia el torn
│   ├── pi-adapter.mjs            entorn, eina aïllada i neteja de Podman
│   ├── profile.mjs               prepara recursos de confiança
│   └── extensions/sandbox-bash.ts eines del model: sandbox i adjunts
├── sandbox/
│   ├── arguments.mjs             muntatge, identitat i límits de Podman
│   ├── commands.mjs              execució i aturada dels contenidors
│   └── errors.mjs                aturada no confirmada que bloqueja el servei
└── repository/
    ├── trusted-git.mjs            metadades explícites i entorn restringit
    ├── identifiers.mjs            noms opacs de worktree, arxiu i branca
    ├── worktrees.mjs              worktree, branca, commit i estat publicat
    ├── secret-scan.mjs            historial, rutes i credencials conegudes
    ├── publisher.mjs              push, PR i confirmació de l'estat publicat
    ├── github.mjs                 client de GitHub, push segur i lectura de CI
    ├── ci-status.mjs              check runs i estats de commit d'un SHA exacte
    ├── request-signal.mjs         termini de lectura amb el senyal d'aturada
    ├── preview-comment.mjs        comentari de confirmació del publicador de confiança
    ├── preview-request-store.mjs  peticions de preview durables i URL confirmada
    ├── merge-request-store.mjs    peticions de merge durables
    ├── session-note-store.mjs     efectes del servei pendents i última resposta del tema
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
   informa l'autor; no admet la instrucció per defecte. Tota petició del client
   de Telegram té termini propi, combinat amb el senyal d'aturada: 30 s per
   defecte i, al long polling, el temps demanat al servidor més 15 s de marge.
   Un termini esgotat és un error del client, sense URL ni token; una aturada
   continua sent una aturada.
2. `workflow` interpreta la petició amb una crida efímera sense eines i sense
   historial. A més del text, rep com a dada l'última resposta del tema
   (retallada), si el worktree del tema té feina sense publicar i el número de la
   PR que el tema va publicar i encara té. Un límit de peticions del proveïdor
   (HTTP 429) es reintenta com a màxim dues vegades, amb una espera curta, dins
   del mateix termini de la classificació; si persisteix, la petició falla.
   Cap altre error es reintenta i una aturada no ho fa mai. La classificació queda a la traça
   (`instruction_classified`). Si no és clara, el torn és una consulta (punt 4) i
   no una resposta fixa.
3. El servei prepara el worktree actual del tema. El directori es diu
   `topic-<16hex>` i no conté ni el grup ni el tema: surt d'un HMAC-SHA256 amb
   un salt privat de la instal·lació (`state/identifier-salt`). Una feina nova
   preserva l'anterior a `topic-<16hex>-before-<8hex>` i crea un worktree des de
   `origin/main`, sense arrossegar fitxers ignorats d'una feina anterior.
   Només una continuació explícita reutilitza la feina pendent actual o, si
   nomena una sola PR que el servei va publicar, la reprèn a
   `workflow/cross-topic-continuation.mjs` (vegeu el punt 11).
   A l'arrencada, abans de qualsevol altra feina, `repository/worktrees.mjs`
   renombra els worktrees i arxius amb el nom antic `topic_<chat>_<tema>`: el
   directori muntat, el directori administratiu `.git/worktrees/<nom>` i el
   fitxer `.git` del worktree, perquè dins de `/work` no hi quedi cap nom
   privat. El fitxer `.git` es reescriu amb un fitxer temporal exclusiu i un
   `rename` atòmic, mai a través del path existent. Un `.git` o un `gitdir` del
   registre que no sigui un fitxer regular amb un sol enllaç no es llegeix ni es
   repara: es registra `worktree_marker_untrusted` amb el nom opac i el servei no
   arrenca.
   És idempotent i reprèn el que una interrupció hagi deixat a mitges;
   si no pot, ho registra i el servei no arrenca. L'ordre d'actualització és
   actualitzar, executar `commands/migrate-identifiers/cli.mjs`, reconciliar i
   arrencar. També a
   l'arrencada, `repository/retention.mjs` esborra només els worktrees arxivats
   que no tenen res a perdre: cap commit per davant d'`origin/main` i cap canvi
   sense cometre. Conserva sempre l'arxiu més recent de cada tema i no toca mai
   el worktree actiu. Com que el sufix de l'arxiu és opac, l'ordre surt de la
   data de naixement del directori. Si la retenció falla, ho registra i el
   servei continua.
   `runtime/pi-adapter` tria
   explícitament el perfil, l'entorn, `sandbox_bash` i `view_attachment`, la
   llista d'adjunts del tema i la neteja dels processos.
   El paquet només executa el protocol RPC amb aquestes opcions.
4. Una consulta munta `/work` en mode de només lectura i retorna la resposta,
   sense publicar canvis anteriors pendents. Una implementació pot editar i
   provar dins del mateix sandbox. També és una consulta la petició que el
   classificador no sap situar i la continuació que no té feina pendent ni PR del
   tema: el prompt hi afegeix una línia que diu que el servei no ha pogut
   distingir si la persona vol un canvi, i el text fix d'aclariment només es fa
   servir si el model no respon.
5. Si hi ha canvis o commits pendents, `workflow` crea o continua la branca i
   executa les comprovacions locals dins del contenidor: `pnpm check:local` si
   tots els camins són dins del contingut (ADR 0012) i `pnpm check` altrament.
   Una fallada conserva la feina.
6. `repository` fa commit, escaneja les credencials conegudes, publica la branca
   i obre o reutilitza la PR. Només després de confirmar push i PR registra el
   commit publicat fora del muntatge. El paquet retorna el resultat al tema.
   Totes les ordres Git i totes les crides a l'API de GitHub tenen termini i
   reben el senyal de la instrucció: 120 s per a una ordre Git local, 300 s per
   a `fetch` i `push`, i 30 s per a una crida a l'API que no porti termini propi.
   Una ordre que s'esgota o s'atura es mata amb `SIGKILL` i no compta com un
   refús local.
7. Abans de respondre, `workflow` desa un seguiment de CI vinculat al SHA
   publicat. Un bucle en segon pla llegeix els check runs i els estats de commit
   d'aquell SHA i, quan les comprovacions obligatòries acaben, envia el resultat
   al mateix tema. El bucle no bloqueja la cua; un enviament no confirmat, també
   el que s'esgota dins del termini del client, queda com a incert i no es
   repeteix sol. Si el seguiment no es pot desar després
   d'una publicació confirmada, la instrucció acaba com a incerta: la publicació
   s'ha fet, però cap avís durador la pot autoritzar, i una persona ho
   reconcilia. Mentre el tema tingui cap avís incert, el tema té feina sense
   informar: `/merge` i `/preview` no resolen res, encara que un avís posterior
   s'hagi lliurat abans.
8. Si les comprovacions obligatòries fallen, `workflow/ci-watch.mjs` reserva una
   reparació automàtica abans d'avisar i tanca el seguiment. Si l'avís «en curs»
   no es lliura, la reserva es tanca de seguida com a `aborted` amb el motiu
   `announcement_failed` (traça `ci_repair_not_announced`): no s'executa mai i no
   bloqueja el tema. `ci-repair.mjs`
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
   comunica sense reintentar-se. Si una fallada reutilitza un intent que ja ha
   acabat, el tema rep l'avís que no s'executarà cap reparació i que cal una
   instrucció nova (traça `ci_repair_not_run`); `ci_repair_requested` només es
   traça quan l'intent ha arribat a la cua. A l'arrencada, qualsevol reserva que no va
   arribar a la cua es tanca com a `aborted` amb el motiu
   `interrupted_before_queue` (traça `ci_repair_not_queued`) i no s'executa. Una
   CI verda o una publicació humana nova també donen per obsoletes les reserves
   que mai no han corregut.

9. Una persona verificada pot demanar la preview en llenguatge natural. El
   classificador només etiqueta la petició com a `preview`: el model no s'inicia
   ni toca cap worktree. `workflow/preview-request.mjs` torna a verificar la
   pertinença de l'autor en executar la petició, com el merge, i fixa la
   petició al commit que el servei va informar en verd en aquell tema (mai una
   PR o un SHA escrits per la persona) i torna a llegir la PR i les
   comprovacions obligatòries:
   PR oberta, cap igual al commit fixat, branca del repositori principal i
   comprovacions obligatòries totes en verd. Si el tema té una publicació més
   nova sense informe confirmat, refusa i nomena la feina nova, no l'avís ja
   informat. Si l'autor ja no és membre, si la
   consulta de pertinença falla, si hi ha qualsevol dubte o un error de lectura,
   refusa i ho diu. Només llavors desa la petició (`commenting`),
   comenta exactament `/preview` amb la credencial del servei i passa a
   `awaiting`. Un bucle en segon pla llegeix els comentaris de la PR i només
   accepta el del publicador de la fase 6 (`github-actions[bot]`, marcador,
   origen exacte `https://pr-<n>.preview.mountainrunners.cat`, el SHA fixat i
   escrit o actualitzat després de la petició). Retorna l'URL confirmada al
   tema; si el termini de 25 minuts s'esgota, ho comunica com a no confirmat
   sense construir cap URL. Un rebuig definitiu de GitHub (4xx, llevat de 408 i 429) acaba la petició
   com a `failed` (traça `preview_failed`) sense bloquejar el servei; qualsevol
   altre error deixa la petició `uncertain`. La identitat de GitHub de l'agent ha
   de ser col·laboradora del repositori. Es pot repetir `/preview` pel mateix commit només quan la
   petició anterior ha acabat. Una CI verda, una PR nova o una reparació no
   demanen mai cap preview.

   Mentre espera, el mateix bucle llegeix les execucions del flux `preview.yml`
   que ha provocat el comentari (`repository/github.mjs#listPreviewWorkflowRuns`,
   permís `Actions: read`). El flux s'executa per a cada comentari de cada PR,
   així que només compta una execució iniciada per la identitat de GitHub del
   servei (`actor` o `triggering_actor`, llegida una vegada amb
   `getAuthenticatedLogin`) i dins de la finestra de la petició: creada després
   del comentari del servei i abans del comentari de la petició següent. La
   finestra va del comentari de la petició al de la petició següent, també quan
   aquella ja ha acabat, i dues peticions del mateix segon es resolen per l'ordre
   dels identificadors. El bucle llegeix primer el comentari del
   publicador, que sempre guanya i és l'únic que lliga l'URL al commit. Dins de la
   finestra només decideix la primera execució acabada: si no ha acabat bé, la
   petició acaba com a `failed` (traça `preview_failed_run`, amb l'execució) amb
   un avís planer, i una execució posterior no canvia res. Una execució correcta,
   o acabada sense conclusió calculada, continua exigint el comentari del
   publicador. Una lectura fallida d'execucions deixa el cicle amb el comentari
   del publicador i el termini, i no tanca res per si sola. Si la credencial no
   pot llegir execucions (403 o 404) o la seva pròpia identitat, el servei es
   queda amb el comentari del publicador, ho registra
   (`preview_runs_permission_denied` o `preview_identity_read_failed`) i ho torna
   a provar com a màxim un cop l'hora, sense reiniciar. Una execució que no
   encaixa en cap finestra s'ignora, i un encert equivocat només pot acabar la
   petició com a fallada, perquè una execució correcta no confirma cap URL.

10. Una persona verificada pot demanar el merge amb la comanda literal `/merge`,
    `/merge <PR>` o `/merge <PR> <SHA>` completa. `run-instruction.mjs` la reconeix
    abans del classificador: ni aquest ni el model la veuen, i la prosa («fusiona-la»)
    no fusiona res. `workflow/merge-request.mjs` torna a verificar la pertinença,
    fixa la petició a la PR i al commit de l'últim avís de CI en verd lliurat al
    tema i refusa si el tema té feina més nova que aquell avís (instrucció,
    reparació o avís encara sense informar, incert inclòs). Rellegeix la PR en fallada tancada
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
    resposta nomena la proposta fusionada i el canvi fusionat (SHA curt), a
    l'última línia, després de l'enllaç de revisió. El detall és a [`docs/deployment.md`](../../../docs/deployment.md).

11. Una continuació que nomena exactament una PR amb `#<número>` es reconeix pel
    servei, no pel model. `workflow/cross-topic-continuation.mjs` la reprèn si la
    PR és oberta, no és un esborrany, apunta a `main`, ve del repositori
    configurat, la branca és una branca de treball i el servei l'ha publicada
    abans (`ci_watches`). El tema de la publicació més recent n'és el propietari i
    la represa espera que no tingui cap altra instrucció ni cap avís sense
    informar. La branca s'allibera dels worktrees que la tenen (només si no hi ha
    res per publicar), el worktree del tema es preserva com una feina nova i la
    branca es munta al cap actual de la PR. El model rep la PR, el diff, els
    últims vint comentaris i l'estat de les comprovacions com a dades no fiables.
    La publicació només actualitza aquella PR, el tema nou registra el seu propi
    avís i passa a ser-ne el propietari, i el tema anterior rep un avís curt. Si
    la fila no es pot desar, la publicació es manté, el tema anterior conserva
    els avisos i la instrucció acaba com a incerta. Un avís que falla o que
    esgota el termini es registra a la traça
    i no fa fallar la instrucció. Si la continuació no nomena cap número, el
    servei reprèn la PR oberta que el tema va publicar i encara té: continua
    aquí mateix si el worktree ja té aquella branca al cap de la PR, i la
    publicació fixa aquella PR i aquell cap (els revalida abans del push i no
    n'obre mai una altra), o pel camí de represa si en té una altra. Una PR
    fusionada o tancada deixa la petició com a consulta. El detall
    és a [`docs/deployment.md`](../../../docs/deployment.md).

12. Cada instrucció admesa que no és `/merge` ni una preview executa un torn de
    Pi a la sessió del tema, i el torn següent rep els efectes que el servei ha
    decidit mentrestant. `repository/session-note-store.mjs` desa a
    `state/session-notes.sqlite`, per tema, el text de cada informe del servei
    (publicació, comprovacions, CI, reparació, preview, merge, traspàs, adjunt
    refusat i resolució d'un resultat desconegut) abans d'enviar-lo, retallat a
    1500 caràcters i amb un màxim de 20 notes sense lliurar. La nota d'una
    preview pot portar més fets que el missatge del tema: l'estat, la PR, el
    commit, l'adreça confirmada i el final de l'execució en paraules planeres,
    perquè el torn següent no hagi d'interpretar cap token de GitHub. Una nota només
    conté text escrit pel servei: quan un avís seu incorpora text del model, la
    nota en guarda només la part del servei i les paraules del model només
    queden com a última resposta del tema. Cada efecte té una identitat
    duradora, així que un reenviament de Telegram no duplica la nota i una
    identitat ja lliurada no es reviu, i les identitats lliurades no es poden.
    Les notes es reclamen al darrer moment, quan el perfil de Pi ja està
    preparat i Pi és a punt de rebre el prompt: qualsevol fallada anterior les
    deixa pendents. Un cop reclamades, s'esborren quan el torn acaba o falla,
    perquè el prompt pot haver arribat a Pi; només les torna a pendents que el
    prompt no s'hagi escrit mai (el fet d'enviament `onPromptSent`, encara que
    després falli també la neteja del sandbox). Un reinici
    conserva les pendents i no repeteix cap nota
    d'un torn interromput (una reclamació oberta compta com a lliurada). Un
    informe que barreja text del servei i del model només desa la part del
    servei com a nota. El classificador no rep mai aquest bloc. El mateix store
    desa l'última resposta del tema, que el classificador llegeix com a dada.

13. Cada torn rep com a dada l'estat de la PR del tema. El servei la identifica
    amb els seguiments desats i llegeix de GitHub el cap i les comprovacions
    obligatòries. Revalida el cap i llegeix la confirmació del publicador per a
    la preview del cap actual. Si no pot confirmar l'estat, el bloc diu que no
    es pot comprovar i registra `topic_state_failed` al journal. El bloc no
    conté identificadors de Telegram ni dades personals, i el classificador no
    el rep. El sandbox continua sense xarxa ni credencials. La petició explícita
    de preview també comprova el cap i la CI a GitHub, encara que el resultat
    desat sigui anterior. El merge i la reparació tornen a comprovar el cap i la
    CI abans d'actuar.

Les imatges d'una implementació o una continuació segueixen aquest camí.
`attachments/prepare.mjs` descarrega cada fitxer al directori temporal del
servei, en valida el tipus real contra l'extensió i el MIME declarats, en
comprova l'estructura i les dimensions de les capçaleres i n'elimina les
metadades, sense descodificar cap píxel. Les imatges noves d'un prompt sumen
com a màxim 8 MB de bytes nets; les que no hi caben no s'envien com a entrada i
el text indica al model que les miri amb `view_attachment`. Si el costat llarg
supera 2.400 px,
`attachments/scale.mjs` posa els bytes en un directori temporal ignorat dins
del worktree i executa un script a l'entorn aïllat, amb el `sharp` que el
repositori ja instal·la fora de línia; el procés de confiança torna a validar
la sortida amb el lector de capçaleres abans de fer-la servir.

`attachments/store.mjs` desa cada imatge a `state/attachments/topic-<hex>/`,
fora del worktree i de Git, amb un nom estable (`imatge-1.jpg`,
`imatge-2.png`). Un adjunt hi és fins que es publica o durant set dies;
l'arrencada n'esborra els vençuts. Cada torn copia el magatzem a
`.agent-attachments/` del worktree perquè el sandbox el pugui llegir. El model
rep la llista d'imatges amb nom i dimensions, les noves com a entrada d'imatge
del prompt i la resta disponibles amb l'eina `view_attachment`; l'eina només
accepta un nom de la llista, obre el fitxer sense seguir enllaços simbòlics i
en revalida la capçalera. Les regles de drets (una imatge d'un membre verificat
és del club, crèdit «Mountain Runners»), destinació, cartell vertical i text
alternatiu van al text de servei.

Abans de les comprovacions i del commit, el servei esborra la còpia del
worktree. Una imatge s'ha utilitzat quan hi ha un fitxer regular fora de
`.agent-attachments/` amb els mateixos bytes (mateix SHA-256); si la publicació
acaba bé, aleshores deixa el magatzem. `repository/secret-scan.mjs` refusa qualsevol
història que contingui una ruta sota `.agent-attachments/`: l'adjunt no es
publica ni en una branca amb un `.gitignore` anterior. La resta d'instruccions
l'ignoren i ho diuen en una frase.
Un error local conegut, un timeout o una cancel·lació amb neteja confirmada
retornen una fallada sense bloquejar la cua. Un termini o una aturada abans de
la primera escriptura remota és una fallada local, i la lectura de la PR que el
publicador fa abans del push també hi entra: un termini esgotat allà té el seu
avís propi. Després d'un push o d'una petició de PR, la instrucció queda
incerta. L'avís de CI tampoc no bloqueja la
cua: només es declaren verdes les comprovacions obligatòries presents i
correctes del SHA exacte, i un resultat no confirmat es comunica sense
reintentar-lo. Un error després d'iniciar la
publicació, o una aturada de sandbox no confirmada, retornen un resultat incert.
L'arrencada es refusa mentre quedi qualsevol instrucció incerta, una reparació
interrompuda o un comentari `/preview` interromput abans de saber si s'ha
publicat, fins i tot després de diversos reinicis. Abans de refusar, completa
totes les recuperacions locals (instruccions, avisos, reparacions, previews i
merges), de manera que un sol reinici deixa tots els casos atribuïts a la traça.
Amb el servei en marxa,
una reparació amb resultat desconegut atura les reparacions automàtiques mentre
les instruccions del tema continuen. La reconciliació d'un resultat desconegut
no és automàtica: una persona llegeix l'estat real i el tanca amb
`commands/reconcile/cli.mjs`, amb el servei aturat i la identitat del servei. Un
avís de CI incert també es reconcilia així (`--kind notice`), sense cap avís nou
al tema. Una instrucció publicada exigeix `--pull-request`: la comanda torna a
desar el seguiment de CI pendent d'aquell commit abans de desbloquejar-la, i si
no el pot desar la instrucció continua incerta.
Cada resolució es desa amb la seva traça o no es desa, i la comanda no crea cap
base de dades. L'avís al tema també es desa al magatzem de notes del tema abans
d'enviar-lo (identitat `reconcile:<tipus>:<id>`), encara que l'enviament falli. El procediment és a
[`docs/deployment.md`](../../../docs/deployment.md#reconciliació-de-resultats-desconeguts-t85).

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
  L'aplicació selecciona explícitament l'extensió instal·lada de confiança,
  `sandbox_bash` i `view_attachment`. Ni un perfil antic ni el repositori hi
  poden afegir eines. `view_attachment` només obre un nom que el servei ha
  llistat, sense seguir enllaços simbòlics, i revalida la capçalera de la imatge
  abans de retornar-la al model.
- El model llegeix `AGENTS.md`, skills i documentació dins del contenidor. Pi
  no els carrega al host ni manté còpies que puguin seguir symlinks cap a secrets.
- L'etiqueta `mountain-agent.session` dels contenidors i
  `MR_AGENT_SESSION_IDENTIFIER`, que rep Pi, porten el nom opac del worktree. El
  fitxer de sessió de Pi conserva l'identificador privat perquè viu fora del
  sandbox.
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
- El nom públic de la branca acaba en un sufix opac de vuit caràcters
  hexadecimals, derivat de l'identificador d'actualització amb el mateix salt.
  Sense `SUMMARY` vàlid, la branca usa `feat/agent-change-<sufix>` i el títol
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

## Llengua, avisos i publicació (T8.8)

Cada torn de prompt inclou un bloc fix en anglès que fixa el públic i el to de
la resposta: les persones del tema són membres del club, la majoria no són
tècniques, i la resposta va en la seva llengua, català per defecte, amb frases
curtes. No s'esmenten rutes, fitxers, camps YAML, ordres, noms ni recomptes de
proves, commits, branques, ADR ni skills, tret que la persona demani detall
tècnic. El model redacta amb els fets que té i fa com a màxim una pregunta;
les regles del projecte governen la feina, no la redacció de la resposta.

El servei dona al prompt l'instant actual en Europe/Madrid amb el seu desplaçament
(`formatMadridInstant`), perquè no depengui del rellotge del sandbox. Una entrada
es crea sempre com a esborrany; `published: true` i `publishedAt` amb aquell
instant només s'apliquen quan una persona verificada demana explícitament de
publicar-la al tema. Aquesta petició és l'aprovació editorial d'aquella entrada;
el merge continua sent humà i el desplegament no canvia. Les variants en castellà
i anglès només s'escriuen quan algú les demana.

El model continua emetent `SUMMARY` només quan el torn ha canviat fitxers.
`stripChangeSummary` en treu qualsevol línia de resum, també amb espais al
davant, del text que arriba a Telegram, i `parseChangeSummary` continua llegint-ne
el valor per al títol i la branca.

Els avisos públics són planers i cada avís diu què significa per a la persona i
què pot fer. `publicationReport` envia la resposta del model, retallada perquè
l'enllaç no es perdi, una línia curta sobre el que passa amb el canvi i, com a
darrera línia, l'enllaç de revisió. La línia curta només promet un avís quan el
seguiment de CI s'ha pogut desar, diu que no n'hi haurà si no s'ha pogut desar i,
sense cap seguiment, només diu que el canvi està publicat. `ciReports` dona el resultat de les
comprovacions a la persona i `ciNoteReports` el mateix resultat amb el commit i
els noms de les comprovacions a la nota del servei, que és l'única que veu el
model. El número de PR, el commit i els noms de les comprovacions queden al
registre privat del servei (`ci_notification_sent`) i a la nota, no al tema;
l'evidència d'una fallada que arriba a una reparació es desa a més a
`state/ci-watch.sqlite`.

`publicationNoteText` és la nota tècnica de la publicació, separada del text
planer: el número de la proposta, la branca, el commit publicat i el resultat de
les comprovacions locals. `run-instruction` la retorna també en un torn de
reparació, i `workflow/ci-repair.mjs` la desa amb
`ciRepairReports.publishedNote`: la resposta del model no és mai una nota.
L'avís que el cap ha canviat diu que les comprovacions de la versió nova no es
fan totes soles i què pot fer la persona; no promet cap avís que el servei no
enviarà.

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
`pnpm check`, o `pnpm check:local` si tots els camins de la publicació són dins
del contingut (ADR 0012), amb un `TMPDIR` nou. Si la preparació falla, no inicia
el model o no publica, segons el moment de la fallada.

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
l'aturada. `repository/session-note-store.test.mjs` cobreix la durabilitat, el
lliurament únic, la retenció i els límits de les notes del tema, i
`workflow/run-instruction.test.mjs` el torn de consulta, el context del
classificador, el bloc de servei del prompt, l'absència del resum a la resposta
i la composició de l'informe de publicació. `workflow/ci-watch.test.mjs` comprova
que l'avís planer no porta noms de comprovacions ni commits i que la nota del
servei els conserva. `policy/development.test.mjs` cobreix el bloc de to, la
regla de publicació amb l'instant injectat, la de traduccions i el bloc d'estat
del tema. `workflow/topic-state.test.mjs` cobreix l'estat del tema amb magatzems
temporals i el prompt de consulta i d'implementació. `commands/reconcile/uncertain-cases.test.mjs` cobreix els fets i la
resolució de cada tipus de resultat desconegut, `commands/reconcile/command.test.mjs`
una resolució completa amb clients simulats i `commands/reconcile/cli.test.mjs`
el cablejat, els codis de sortida i l'absència de fitxers nous, amb stores SQLite
temporals, repositoris locals i fronteres externes simulades.
`workflow/bridge-package.test.mjs` executa el paquet en una còpia
independent, prova el tarball des d'un consumidor extern i verifica la disposició
instal·lada del servei. No s'hi fan peticions reals ni es necessiten credencials.

Des de l'arrel, amb Node 24.22.3 i pnpm 10.33.0:

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
