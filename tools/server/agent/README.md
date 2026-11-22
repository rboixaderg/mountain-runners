# Agent privat de desenvolupament

Aplicació de Mountain Runners que porta una petició de Telegram fins a una PR. El
servei està en marxa al VPS. Inclou l'avís de CI vinculat al SHA publicat, la
reparació automàtica acotada d'una CI vermella, la preview demanada al tema, el
merge demanat amb `/merge`, els adjunts d'imatge i la continuïtat de la
conversa. Cada tema està vinculat a una sola feina i publica els canvis sense una
petició separada, segons les esmenes acceptades dels ADR 0009 i 0013.

Les eines viuen a `tools/server/agent/` i s'instal·len a
`/usr/local/lib/mountain-runners/agent/`. La unitat és
`tools/server/systemd/mountain-agent.service`. El nucli reutilitzable és
[`packages/telegram-pi-bridge`](../../../packages/telegram-pi-bridge/README.md), amb
llicència MIT i sense dependències npm. El servei el consumeix per l'API pública;
GitHub, Docker i la política del projecte no formen part del paquet.

S'actualitza amb una ordre versionada des d'un commit revisat de `main` segons
[`docs/operations/agent.md`](../../../docs/operations/agent.md#actualitzar); no
forma part del desplegament continu de producció. La instal·lació, la
configuració, la traça privada, la retenció i la reconciliació de resultats
desconeguts són al mateix
[document d'operacions](../../../docs/operations/agent.md).

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
│   └── uncertain-cases.mjs       fets i resolució d'una instrucció, reparació o avís
├── commands/migrate-identifiers/
│   ├── cli.mjs                   migració dels noms antics, sense arrencar el servei
│   └── command.mjs               la mateixa migració que fa l'arrencada, idempotent
├── commands/update/
│   ├── cli.mjs                   embolcall de procés: umask privat i codi de sortida
│   └── command.mjs               actualització versionada: comprovacions, còpia i verificació
├── processes/telegram-bridge/
│   └── main.mjs                  connecta paquet i flux de desenvolupament
├── policy/
│   └── development.mjs           prompts, comprovació, noms i informes
├── workflow/
│   ├── project-runner.mjs          connecta política, model, sandbox i publicador
│   ├── run-instruction.mjs         coordina el torn ordinari o la reparació
│   ├── ci-watch.mjs                avís de CI i reserva de la reparació acotada
│   ├── preview-request.mjs         informe d'adreça de preview determinista i confirmació
│   ├── merge-request.mjs           comanda `/merge` determinista i recuperació
│   ├── topic-job-migration.mjs      vincula una PR existent quan no hi ha ambigüitat
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
    ├── github.mjs                 client de GitHub, push segur i reexecució de CI
    ├── ci-status.mjs              check runs i estats de commit d'un SHA exacte
    ├── ci-failure.mjs             classificació dels passos fallits de CI
    ├── ci-job-output.mjs          sortida dins el pas fallit del job
    ├── request-signal.mjs         termini de lectura amb el senyal d'aturada
    ├── preview-comment.mjs        comentari de confirmació del publicador de confiança
    ├── preview-request-store.mjs  peticions de preview durables i URL confirmada
    ├── merge-request-store.mjs    peticions de merge durables
    ├── session-note-store.mjs     efectes del servei pendents i última resposta del tema
    ├── topic-job-store.mjs        vinculació duradora del tema amb branca i PR
    └── ci-watch-store.mjs         avisos, reexecucions i reparacions duradors
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
publicador després d'un torn amb canvis o feina pendent i comprovacions correctes.

El paquet està enllaçat amb `workspace:*` durant el desenvolupament. A la
instal·lació prevista es copia a
`/usr/local/lib/mountain-runners/node_modules/telegram-pi-bridge/`, al costat
d'`agent/`. No depèn d'un symlink al clon del projecte ni d'una instal·lació npm
al servidor. El nom local encara no representa una publicació a npm.

## Recorregut d'una petició

1. El paquet verifica el grup, tema, autor i pertinença actual, desa la
   instrucció abans d'avançar l'offset i la deduplica. Només hi ha una execució
   global; un resultat incert bloqueja les següents. Les peticions noves durant
   el bloqueig es refusen amb avís. Les condicions d'admissió, la revocació, els
   avisos de recepció i els terminis del client de Telegram són a
   [Sessions, admissió i recuperació](#sessions-admissió-i-recuperació).
2. `workflow` interpreta la petició amb una crida efímera sense eines i sense
   historial. A més del text, rep com a dada l'última resposta del tema
   (retallada a 800 caràcters), si el worktree del tema té feina sense publicar i
   el número de la PR que el tema va publicar i encara té. Un límit de peticions
   del proveïdor (HTTP 429) es reintenta com a màxim dues vegades, amb una espera
   curta, dins del mateix termini de la classificació; si persisteix, la petició
   falla. Cap altre error es reintenta i una aturada no ho fa mai. La
   classificació queda a la traça (`instruction_classified`). El servei només usa
   la categoria per reconèixer una petició explícita de preview; les altres
   categories segueixen el mateix torn amb escriptura.
3. El servei prepara el worktree actual del tema. Cada tema manté el seu worktree
   i una sola feina, i `state/topic-jobs.sqlite` vincula el tema amb la branca i
   la PR de la primera publicació (vegeu
   [Feina vinculada al tema](#feina-vinculada-al-tema)). Els noms del worktree,
   del fitxer i de la branca són opacs (vegeu
   [Noms opacs i migració](#noms-opacs-i-migració)), i la retenció dels worktrees
   arxivats és a [Sessions, admissió i recuperació](#sessions-admissió-i-recuperació).
   `runtime/pi-adapter` tria
   explícitament el perfil, l'entorn, `sandbox_bash` i `view_attachment`, la
   llista d'adjunts del tema i la neteja dels processos.
   El paquet només executa el protocol RPC amb aquestes opcions.
4. Cada missatge ordinari admès executa un torn amb escriptura al worktree del
   tema. El model pot respondre preguntes o editar fitxers. Si no hi ha canvis
   ni feina pendent, no es publica res. Si la resposta és buida, s'utilitza el
   text fix d'aclariment.
5. Si hi ha canvis o commits pendents, `workflow` crea o continua la branca i
   executa les comprovacions locals dins del contenidor: `pnpm check:local` si
   tots els camins són dins del contingut (ADR 0012) i `pnpm check` altrament.
   Una fallada conserva la feina. El següent torn ordinari torna a comprovar i
   publicar la feina pendent, encara que aquell torn no canviï cap fitxer.
6. `repository` fa commit i consulta `origin/main`. Si la branca va per darrere,
   integra `main` amb un commit de merge i repeteix les comprovacions. Davant
   d'un conflicte, un segon torn del model al sandbox intenta conservar els dos
   canvis. Si les versions es contradiuen, el prompt li demana que pregunti a
   la persona quina vol. Si queden marcadors, el conflicte és binari o la resolució falla,
   s'avorta el merge i no es fa push. Si l'avortament no es pot confirmar, el
   resultat queda incert i la persona mantenidora l'ha de revisar. Després,
   escaneja les credencials conegudes, publica la branca
   i obre o reutilitza la PR. Només després de confirmar push i PR registra el
   commit publicat fora del muntatge. El paquet retorna el resultat al tema.
   Totes les ordres Git i totes les crides a l'API de GitHub tenen termini i
   reben el senyal de la instrucció: 120 s per a una ordre Git local, 300 s per
   a `fetch` i `push`, i 30 s per a una crida a l'API que no porti termini propi.
   Una ordre que s'esgota o s'atura es mata amb `SIGKILL` i no compta com a
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
   informar: `/merge` no resol res, encara que un avís posterior s'hagi lliurat
   abans.
8. Si una comprovació obligatòria acaba com a `cancelled` o `timed_out`, o falla
   en un pas de preparació abans dels passos de projecte, `workflow/ci-watch.mjs`
   reserva una reexecució dels jobs fallits de l'execució de GitHub. La reserva
   es desa a `state/ci-watch.sqlite` abans de la crida i només permet un intent
   per execució. El seguiment continua al mateix commit i el seu termini torna
   a comptar des de la reserva. Si l'intent torna a fallar o no es pot confirmar,
   el servei avisa i no el repeteix. Després d'un
   reinici llegeix l'intent de GitHub abans de decidir; una reserva que no es pot
   confirmar no autoritza una altra crida.

   `repository/ci-failure.mjs` defineix els passos de preparació reconeguts:
   `Set up job`, `Check out repository`, `Check out repository history`,
   `Install pnpm`, `Set up Node.js`, `Install dependencies` i
   `Install browser dependencies`. Un nom nou no s'hi afegeix automàticament.
   Una fallada només pot passar a reparació si el job confirma un pas de projecte
   reconegut i el log del job conté sortida atribuïble a aquell pas. El servei
   limita la lectura a 1 MiB i exclou els segons de les fronteres i les ordres
   agrupades del log. Si falta aquesta evidència, avisa sense executar el model.

   Per a una fallada que compleix aquestes condicions, `workflow/ci-watch.mjs`
   reserva una reparació automàtica abans d'avisar i tanca el seguiment. Si l'avís «en curs»
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
   evidència, no identitat. Només compta l'intent que s'ha arribat a agafar, i un
   intent declinat o cancel·lat també consumeix el pressupost. Una
   reparació que no canvia res, o que no pot confirmar el resultat, es tanca i es
   comunica sense reintentar-se. Si una fallada reutilitza un intent que ja ha
   acabat, el tema rep l'avís que no s'executarà cap reparació i que cal una
   instrucció nova (traça `ci_repair_not_run`); `ci_repair_requested` només es
   traça quan l'intent ha arribat a la cua. A l'arrencada, qualsevol reserva que no va
   arribar a la cua es tanca com a `aborted` amb el motiu
   `interrupted_before_queue` (traça `ci_repair_not_queued`) i no s'executa. Una
   CI verda o una publicació humana nova també donen per obsoletes les reserves
   que mai no han corregut; conserven les reparacions en cua, en curs o amb
   resultat desconegut. Una reparació no crea mai una PR ni reprèn un worktree amb
   canvis sense publicar d'una instrucció posterior. Si el termini del seguiment
   s'esgota amb comprovacions fallides però el conjunt no és concloent, la nota
   del servei en dona els noms, el tema rep un avís planer i no s'inicia cap
   reparació. La traça privada registra `ci_repair_requested` (només quan l'intent
   ha arribat a la cua), `ci_repair_not_announced`, `ci_repair_not_queued`,
   `ci_repair_not_run`, `ci_repair_blocked`, `ci_repair_limit_reached`,
   `ci_repair_published`, `ci_repair_not_published`, `ci_repair_aborted`,
   `ci_repair_uncertain` i `ci_repair_close_failed` amb la PR i el commit, sense
   text de conversa ni credencials. Una traça que no es pot escriure es registra
   al log i no perd l'avís al tema.

El destí d'una publicació és la preview i el merge que es demanen al mateix tema,
un sol treball per tema, la continuïtat de la conversa i l'estat que rep cada
torn: [Preview demanada al tema](#preview-demanada-al-tema),
[Merge demanat al tema](#merge-demanat-al-tema),
[Feina vinculada al tema](#feina-vinculada-al-tema),
[Continuïtat de la conversa d'un tema](#continuïtat-de-la-conversa-dun-tema) i
[Estat del tema](#estat-del-tema).

## Sessions, admissió i recuperació

- El tema del fòrum (`chat_id` + `message_thread_id`) és la sessió. El
  identificador de sessió de Pi deriva del tema; dos temes no comparteixen
  historial.
- Només s'accepta un missatge d'una persona del grup configurat, dins d'un tema,
  que menciona el bot o respon a un missatge seu; els reenviaments, els àmbits
  anònims, els altres grups i els missatges privats s'ignoren. La pertinença es
  consulta a Telegram per a cada instrucció, sense memòria cau. Una fallada
  de la consulta denega la instrucció i informa l'autor perquè ho torni a provar.
  La consulta té un termini de 30 s i respecta l'aturada del servei. Un termini
  esgotat denega la instrucció pel camí `membership_check_failed`; una aturada
  no avança l'offset de Telegram, així que l'update es torna a llegir a la
  propera arrencada.
- L'admissió és duradora abans d'avançar l'offset de Telegram. Els updates es
  dedupliquen, la cua admet deu instruccions pendents i només hi ha una
  execució global. Una cua plena es registra i es comunica al tema.
- Quan una instrucció s'admet, el tema rep de seguida un avís «Hi estic treballant.»
  (`workingNotice`). S'envia després de desar-la i abans d'executar-la, i no
  inclou cap text de la petició ni cap credencial. Si Telegram no accepta l'avís, la
  feina continua i només es registra `reply_failed`; la resposta final arriba
  igualment en aquell tema.
- Tota petició del client de Telegram té un termini propi, combinat amb el
  senyal d'aturada del servei: 30 s per defecte i, al long polling, els 25 s
  demanats al servidor més 15 s de marge. Un termini esgotat és un error del
  client que no conté cap URL ni el token; una aturada continua sent una
  aturada. Un enviament que s'esgota és un lliurament desconegut: l'avís de
  recepció només deixa `reply_failed` i la feina continua, i l'avís de CI deixa
  el seguiment incert i avorta la reserva de reparació.
- La revocació talla només el que encara no s'ha admès. Una persona que deixa
  el grup o és expulsada no pot donar instruccions noves, però la feina
  ordinària ja acceptada (implementacions, continuacions, consultes i
  reparacions) continua i no torna a comprovar la pertinença. Les dues accions
  que exposen o fusionen una PR, la preview i el merge, la tornen a comprovar en
  executar-se.
- Un error local es registra amb el nom i el missatge de l'excepció perquè es
  pugui diagnosticar al journal. El tema només rep l'avís genèric: ni rutes, ni
  noms d'eines ni cap detall intern.
- Un reinici marca com a incert qualsevol treball en curs i refusa l'arrencada.
  El servei continua refusant totes les arrencades mentre hi hagi una instrucció
  incerta. Mentre el procés encara funciona amb la cua bloquejada, les peticions
  noves es registren com a refusades i reben un avís; no s'acumulen com a pendents. Cal revisar l'estat real; no es repeteix cap acció
  externa automàticament. La reconciliació d'aquests casos es fa amb l'ordre
  d'operador de
  [reconciliació de resultats desconeguts](../../../docs/operations/agent.md#reconciliació-de-resultats-desconeguts).
- Una crida efímera sense eines detecta la petició explícita de preview. La
  resta de categories segueixen el mateix camí ordinari, sense decidir si el
  torn pot editar. `/merge` conserva el camí determinista.
- Cada torn ordinari pot editar el worktree del tema. La primera publicació
  vincula el tema a una branca i una PR a `state/topic-jobs.sqlite`; els torns
  següents reutilitzen la vinculació. El servei no reprèn PR d'altres temes ni
  genera avisos de solapament. Abans de publicar executa `pnpm check` al
  contenidor, o `pnpm check:local` si tots els camins de la publicació són dins
  de `apps/web/src/content` o `apps/web/src/content-assets` (ADR 0012). Una
  fallada conserva la feina i el torn ordinari següent torna a intentar-la.
- Un error local, un timeout o una cancel·lació confirmada no bloquegen la cua.
  Un error després d'iniciar la publicació queda incert, excepte un refús local
  identificat pel publicador. Una aturada de contenidors no confirmada també
  bloqueja, perquè encara podria executar-se codi no fiable.
- La sortida conjunta de stdout i stderr té un límit d'1 MiB per ordre del
  sandbox i per torn RPC de Pi. Superar-lo atura el procés i espera la neteja
  dels contenidors. Si afecta el torn RPC o les comprovacions, la instrucció
  falla abans de publicar. El timeout es manté independent. L'adaptador també
  verifica la neteja després de cada ordre del sandbox i de cada torn completat
  de Pi, abans de comprovar o publicar. Atura els contenidors actius de la sessió, elimina els seus
  registres aturats i comprova que no en quedi cap. Si Podman no pot completar
  la neteja, el resultat és incert; els worktrees i sessions es conserven.
- Un worktree net no implica que s'hagi publicat. El servei conserva els commits
  pendents fins que push i PR estiguin confirmats; només llavors registra el
  commit publicat fora del muntatge. La branca vinculada continua al tema.
- Cada worktree arxivat conserva la seva còpia de dependències, així que el
  volum acotat s'omple amb les iteracions. A l'arrencada el servei elimina només
  els worktrees arxivats sense commits per davant d'`origin/main` i sense canvis
  pendents, i sempre conserva l'arxiu més recent de cada tema. Com que el sufix
  de l'arxiu és opac, l'antiguitat surt de la data de naixement del directori,
  que el reanomenament conserva i una escriptura a dins no canvia. Un worktree
  amb treball no publicat o sense cometre no s'esborra mai, i el worktree actiu
  del tema tampoc. L'ordre d'operador que mostra o aplica la mateixa decisió és
  a [`docs/operations/agent.md`](../../../docs/operations/agent.md#retenció).

## Noms opacs i migració

Els identificadors de Telegram no arriben a cap nom públic ni a cap nom que el
sandbox pugui llegir.

- **Salt.** `state/identifier-salt` és un valor aleatori de 32 bytes amb mode
  `0600` que el servei crea una sola vegada a l'arrencada si no existeix. No
  viatja al repositori, a la traça, als logs ni a l'entorn de Pi. Una altra
  instal·lació produeix altres noms. Sense aquest fitxer no es poden
  reconstruir els noms dels worktrees existents: entra a la còpia de seguretat
  de `state/`.
- **Worktree.** El directori és `topic-<16hex>`, un HMAC-SHA256 del salt i de la
  clau de sessió (`<chat>:<tema>`). El fitxer `/work/.git`, l'etiqueta
  `mountain-agent.session` dels contenidors i `MR_AGENT_SESSION_IDENTIFIER`, que
  rep Pi, porten només aquest valor.
- **Arxiu.** Un arxiu és `topic-<16hex>-before-<8hex>`, amb el mateix HMAC sobre
  l'identificador d'actualització. No porta ni l'identificador ni cap ordre.
- **Branca i PR.** El sufix públic de la branca és aquest HMAC de vuit
  caràcters: `feat/agent-change-<8hex>` o `<tipus>/<slug>-<8hex>`. És estable
  per a la mateixa actualització i canvia amb el salt.
- **Sessió de Pi.** El fitxer de sessió conserva `topic_<chat>_<tema>` per no
  perdre l'historial, però no arriba mai al sandbox. El perfil de Pi es
  reconstrueix a `state/profiles/topic-<16hex>` a cada execució i arriba a Pi com
  a `PI_CODING_AGENT_DIR`; els perfils antics amb el nom privat no es fan
  servir.
- **Migració.** Canvia tres noms, perquè `git worktree move` només reanomena el
  directori muntat: el directori del worktree, el directori administratiu
  `.git/worktrees/<nom>` i el fitxer `.git` que el sandbox llegeix. Conserva la
  branca, l'índex, els canvis sense cometre i el marcador de publicació. És
  idempotent i reprensible: si s'interromp, la propera execució acaba el que
  falta. Un directori amb el nom antic que Git no registra no és un worktree: es
  registra com a `worktree_migration_unregistered` i es deixa igual. Si un
  reanomenament falla, per exemple perquè el nom opac ja existeix, el servei
  registra `worktree_migration_failed` i no arrenca: no es perd res i no queda
  mig volum amb un nom privat.
- **Marcador no fiable.** El fitxer `.git` del worktree es reescriu només amb la
  ruta del registre de confiança, en un temporal exclusiu dins del mateix
  directori i amb un `rename` atòmic. La migració no llegeix ni repara cap `.git`
  ni cap `gitdir` del registre que no sigui un fitxer regular amb un sol enllaç.
  Un enllaç físic tampoc no és de confiança: `git worktree move` reescriu els dos
  fitxers in situ i el destinatari de l'enllaç rebria l'escriptura. El temporal
  fix `.git.agent-marker-tmp` només s'esborra si és un fitxer regular amb un sol
  enllaç i el contingut exacte del marcador que es vol escriure; qualsevol altre
  fitxer es conserva i la migració es refusa. Quan refusa, registra
  `worktree_marker_untrusted` amb el nom opac, no toca res i el servei no
  arrenca. L'ordre d'operador fa el mateix i surt amb codi 1. Ho revisa una
  persona.

L'ordre d'actualització i la comanda de migració són a
[`docs/operations/agent.md`](../../../docs/operations/agent.md#migració-de-noms).

## Preview demanada al tema

El servei no demana mai la preview: quan crea la PR d'un tema hi posa
l'etiqueta `preview` (`POST /repos/{owner}/{repo}/issues/{number}/labels`), i el
publicador de la fase 6 construeix el cap actual i cada push posterior. Cada
publicació del servei informa l'adreça confirmada del commit que ha pujat, i una
persona verificada també la pot demanar en llenguatge natural. El
servei no inicia el model: el classificador només etiqueta la petició i un
tractament determinista fa la resta. L'etiqueta segueix l'[ADR 0009](../../../docs/decisions/0009-pr-previews-same-domain-and-own-branches.md)
i l'[ADR 0013](../../../docs/decisions/0013-private-development-agent-boundary.md): només es treballa amb branques del
repositori principal i el publicador comprova que qui ha fet el push té permís
`write` o `admin`. La pertinença i l'atribució de la persona només viuen a la
traça privada. El publicador i la construcció de la preview són a
[`docs/operations/previews.md`](../../../docs/operations/previews.md#publicar-una-preview).

- **Etiqueta.** El component de GitHub té una sola operació d'etiquetes: posar
  `preview` a la PR que el servei acaba de crear (`created: true`), amb
  `repository/github.mjs#addPreviewLabel`. No en pot
  treure cap ni en pot posar d'altres. Posar-la és idempotent: després d'un
  resultat desconegut, el servei llegeix les etiquetes de la PR abans de
  repetir-ho una sola vegada. Si no la pot posar, la publicació es manté i el
  servei ho diu amb un avís planer; mai no comenta `/preview`. No torna a
  posar l'etiqueta a una PR existent: si una persona l'ha treta, el servei no
  anuncia cap preview (`no_preview_label`), i les PR obertes abans d'aquest canvi
  no la tenen fins que una persona la posi. No cal cap permís nou al token
  (`Pull requests: write`). Cada push posterior publica la preview amb
  `synchronize` al flux de la fase 6.
- **Seguiment de cada publicació.** Després de cada push del servei, també d'una
  reparació automàtica, el servei desa una petició `awaiting` per al commit
  pujat a la fila de la instrucció que l'ha publicat (`followPublication`); una
  reparació reobre aquella fila per al commit nou. No espera les comprovacions
  en verd: el `build` de la preview executa `pnpm validate` i un cap vermell no
  es publica. Una PR sense l'etiqueta acaba el seguiment sense cap avís.
- **PR i fixació d'una petició.** El destí és la PR que el tema ha publicat (el
  seguiment de CI més recent del tema a `ci_watches`, en qualsevol estat). Mai
  s'accepta un número de PR ni un SHA escrits per la persona. Sense cap PR
  publicada, el servei refusa (`no_pull_request`).
- **Condicions, rellegides en directe.** PR oberta, repositori de la branca igual
  al principal, sense `preview-revoked` i amb l'etiqueta `preview` encara posada.
  `preview-revoked` té precedència sobre l'etiqueta (`preview_revoked`). El cap
  pot ser més nou que l'últim commit del servei, perquè una persona pot haver
  actualitzat la PR fora de l'agent: la petició es fixa llavors al cap i queda
  lligada a aquest SHA exacte. Un error de lectura refusa la petició.
- **Pertinença.** Es torna a consultar a Telegram en el moment d'executar la
  petició, com al merge i després de resoldre el commit fixat: una preview
  publica la PR en un subdomini públic, així que no és feina ordinària de la
  cua. Un autor que ja no és membre rep el rebuig `membership_revoked`; una
  fallada de la consulta, el rebuig `membership_unavailable`, que demana
  tornar-ho a provar. La lectura queda dins del termini de petició del
  servei; si s'esgota, compta com una fallada i es respon demanant tornar-ho a
  provar. En tots dos casos no es desa cap fila. La comprovació superada queda
  a la traça (`preview_membership_verified`).
- **Estats** (`state/preview-request.sqlite`): la petició es desa directament
  com a `awaiting`, en una sola escriptura i sense cap escriptura a GitHub, i
  acaba com a `confirmed`, `timed_out` o `failed` (cap adreça: la preview s'ha
  retirat o el cap ha canviat). Les files antigues que van quedar en
  `commenting` o `uncertain` conserven el seu estat: el servei no les llegeix
  ni les bloqueja. Una actualització de Telegram només es tramita una
  vegada. Es refusa una petició nova pel mateix PR i commit mentre n'hi hagi una
  en `awaiting`, també el seguiment d'una publicació; es permet quan l'anterior
  ha acabat.
- **Retirada abans d'informar.** A cada cicle, el servei llegeix els comentaris
  i després la PR. Si la PR ja no és oberta, té un cap més nou, ha perdut
  l'etiqueta `preview` o té `preview-revoked`, la petició acaba com a `failed`
  sense cap avís (traça `preview_withdrawn` amb el motiu): només s'informa
  l'adreça del cap final i mai una preview retirada.
- **Sense resultat de l'execució.** El servei ja no llegeix les execucions de
  `preview.yml`. Amb l'etiqueta, el run és de `pull_request_target`: el seu
  `head_sha` és l'últim commit de `main`, no el cap de la PR, i no hi ha cap camp
  fiable per correlacionar-lo amb la PR i el cap. Si una construcció falla, la
  petició espera fins al termini i envia l'avís de fallada (l'acció `maintainer_attention` amb el motiu
  `previewUnconfirmed` queda a la traça).
- **Confirmació.** Un bucle en segon pla llegeix els comentaris de la PR i
  només accepta el del publicador de la fase 6: autor `github-actions[bot]`,
  marcador, origen exacte `https://pr-<n>.preview.mountainrunners.cat` i SHA
  igual al fixat. Ja no es exigeix que el comentari sigui posterior a la
  petició: l'etiqueta fa que el publicador construeixi el cap quan es puja, i pot
  confirmar-lo abans que ningú ho demani; el SHA fixat és el que lliga l'adreça.
  Retorna l'URL confirmada al tema. Si en 25 minuts no hi ha confirmació, ho
  envia l'avís de fallada i ho deixa anotat per a la persona mantenidora; mai
  construeix ni suposa l'URL. El tancament d'una fila exigeix el commit que s'ha
  llegit: el resultat d'un cap anterior no tanca una fila reoberta per a un de
  nou.
- **Reinicis.** Una petició en `awaiting` reprèn la lectura de comentaris amb el
  termini original. Abans d'instal·lar aquesta versió, la persona operadora
  comprova amb l'ordre de reconciliació de la versió anterior que no queda cap
  petició de preview incerta; si n'hi ha, la reconcilia primer.
- **Traça privada.** `preview_requested`, `preview_membership_verified`,
  `preview_refused` (amb el motiu), `preview_awaiting` (petició desada),
  `preview_confirmed`, `preview_unconfirmed` i `preview_withdrawn`, amb la PR,
  el commit i l'autor,
  sense text de conversa ni credencials.
- **Llenguatge.** L'avís al tema és curt i planer, per a una persona que no
  treballa amb Git: diu què ha passat i què pot fer. El número de la PR només
  apareix a l'última línia, com a `Enllaç per a revisió: <URL>`; la preview
  confirmada sempre porta la seva adreça. El detall tècnic (estat, commit, PR i
  adreça) queda a la traça privada i a la nota del tema que rep el model.
- **Quan s'informa l'adreça.** Cada push del servei a la PR del tema, també una
  reparació, inicia l'informe de l'adreça del commit pujat, sense esperar la CI.
  Una persona també el pot iniciar per al cap actual. Una CI verda no
  envia cap avís ni convida a demanar la preview. La preview en si la demana l'etiqueta.
- **Avís de confirmació.** L'avís s'envia abans de tancar la petició i només
  es tanca si l'enviament ha anat bé; si falla, es reintenta al cicle següent.
  Una caiguda entre l'enviament i el tancament pot duplicar l'avís. La duplicació
  d'aquest avís de Telegram és una excepció acceptada ([ADR 0014](../../../docs/decisions/0014-operator-stop-and-repeatable-telegram-notices.md)).
  Una lectura fallida de comentaris no tanca la petició i el termini només
  s'aplica després d'una lectura correcta de comentaris.
- **Cursa acceptada.** Si arriba un commit nou abans de la confirmació, el flux
  construeix el cap nou i la petició del cap anterior acaba sense avís. Si el
  commit nou és del servei, el seu seguiment n'informa l'adreça; si l'ha pujat
  una persona fora de l'agent, cal demanar-la. Un comentari del publicador
  anterior a una retirada ja no pot confirmar res: la retirada n'ha editat el
  cos.

L'activació continua depenent de la verificació del pilot: la credencial ha de
tenir escriptura a Pull requests (per posar l'etiqueta `preview`, sense cap
altre permís nou), lectura de Checks i Statuses i cap escriptura a Workflows. La
credencial no necessita `Actions: write` per a la preview. El flux de la fase 6
ha de tenir configurats els secrets `PREVIEW_*`, l'entorn `previews` i el DNS
de `*.preview.mountainrunners.cat`. Aquesta implementació no activa res: els
punts de [Verificacions a GitHub](../../../docs/specs/preview-label.md#verificacions-a-github)
es comproven amb GitHub real abans d'activar-ho a l'agent.

## Merge demanat al tema

Una persona verificada demana el merge amb la comanda literal `/merge`. No es
tria mai amb llenguatge natural: el servei reconeix el text complet abans del
classificador, el model no veu la comanda i una frase com «fusiona-la» no fusiona
res. La decisió segueix l'[ADR 0013](../../../docs/decisions/0013-private-development-agent-boundary.md)
(esmena `/merge` sense número). No hi ha auto-merge, ni push a `main`, ni canvi de
proteccions, ni tancament de la PR.

- **Formes.** `/merge`, `/merge <PR>` (amb `#` opcional) i `/merge <PR> <SHA>`
  (SHA complet de 40 caràcters), amb les regles de menció o resposta del pont.
  Qualsevol altra cosa que comenci per `/merge` respon amb l'ajuda i no fusiona.
- **Fixació.** La PR i el commit són els de l'últim avís de CI lliurat al tema,
  que ha de ser en verd (`ci_watches`). El número i el SHA escrits han de coincidir
  amb aquest avís; només es pot fusionar l'última PR informada del tema.
- **Si no es pot resoldre, pregunta i no fusiona.** No hi ha cap avís; l'últim
  avís no és verd; el número no és el de l'últim avís; o el tema té feina més
  nova (una altra instrucció pendent o en curs, una reparació reservada, en cua o
  en curs, un seguiment de CI encara sense informar o un avís de CI amb resultat
  desconegut més nou que l'últim lliurat). La resposta nomena la proposta
  i demana esperar l'informe nou i tornar a escriure `/merge`.
- **Pertinença.** Es torna a consultar a Telegram en el moment d'executar la
  comanda, a més de l'admissió; una fallada de la consulta o un autor que ja no
  és membre refusa el merge. La lectura queda dins del termini de petició del
  servei; si s'esgota, compta com una fallada i refusa demanant tornar-ho a
  provar. La consulta es fa després de resoldre el
  vincle i la feina més nova, i la comprovació superada queda a la traça
  (`merge_membership_verified`).
- **Condicions, rellegides en directe i en fallada tancada.** PR oberta, no
  esborrany, base `main`, repositori del cap igual al configurat (sense forks),
  cap igual al commit fixat, comprovacions obligatòries totes en verd amb el
  classificador de la CI i `mergeable_state` igual a `clean` (branca al dia i sense
  bloquejos). `behind` refusa i ho ha de revisar la persona que manté el servei;
  `unknown` es torna a llegir un
  màxim de tres vegades i després es refusa com a no llegible, sense llegir
  abans les comprovacions; `blocked`,
  `dirty`, `unstable`, `has_hooks` i qualsevol altre valor refusen. Un error de
  lectura refusa.
- **Crida.** `PUT /repos/{repo}/pulls/{n}/merge` amb el cos exacte
  `{"sha": <commit fixat>, "merge_method": "squash"}`: GitHub rebutja el merge si
  el cap ja no és aquest SHA. El servei no envia títol, missatge ni altre mètode.
  La resposta ha de dir `merged: true` i portar el SHA del merge.
- **Estats** (`state/merge-request.sqlite`): `merging` (desat abans de la crida),
  `merged`, `failed` (4xx definitiu que no és 408 ni 429, com 405, 409 o 422: no
  s'ha fusionat res, es respon i una petició nova és possible), `uncertain`
  (xarxa, aturada, 408, 429, 5xx o resposta mal formada) i `not_merged` (una
  persona ha confirmat que un resultat desconegut no va fusionar res). Una
  actualització de Telegram només es tramita una vegada i una PR té com a màxim
  una petició no acabada. Si la crida confirma el merge però no es pot desar
  l'estat, el servei informa igualment de la fusió amb un avís; la petició queda
  `merging` i en reiniciar-se passa a `uncertain` i es tanca com a `merged`
  llegint la PR. Si no es pot desar el final d'un rebuig o d'un resultat
  desconegut, la resposta és la del resultat desconegut.
- **Resultat desconegut i camí de l'operador.** No es repeteix mai el merge sense
  llegir la PR. Amb una petició `uncertain`, el `/merge` següent d'aquella PR i
  l'arrencada del servei llegeixen la PR:
  - Si GitHub la mostra fusionada, la petició es tanca com a `merged` i el tema
    rep «GitHub mostra la proposta #N fusionada. Un merge anterior havia quedat
    sense confirmar.», sense afirmar qui l'ha fusionada (pot haver estat per una
    altra via). L'última línia és l'enllaç de revisió amb el canvi fusionat:
    «Enllaç per a revisió: <URL> (canvi fusionat <SHA curt>)». Si no es pot
    llegir l'URL, només s'omet l'enllaç.
  - Si no la mostra fusionada, el tema rep una vegada per petició (a
    l'arrencada, o a la resposta si el resultat desconegut ha sorgit en
    executar-se) l'avís que GitHub no la mostra fusionada, oberta o tancada
    sense fusionar. Un lliurament desconegut pot enviar aquest avís dues
    vegades; és l'excepció acceptada de l'[ADR 0014](../../../docs/decisions/0014-operator-stop-and-repeatable-telegram-notices.md) i no
    repeteix cap efecte de GitHub. Una `/merge` o `/merge <PR>` mai no
    desbloqueja res: dona la forma estricta `/merge <PR> <SHA>` amb el commit
    fixat, per copiar i enganxar.
  - Quan una persona verificada escriu `/merge <PR> <SHA>` amb el SHA del commit
    fixat de la petició `uncertain`, i una lectura nova continua mostrant la PR
    oberta i no fusionada, aquesta és la seva decisió: la petició es tanca com a
    `not_merged` (traça `merge_uncertain_cleared` amb autor, PR i SHA) i la
    petició continua des de zero amb tot el flux normal (vincle a l'últim avís
    en verd, feina més nova, pertinença, condicions en directe, desat previ i
    crida). Si el cap de la PR s'ha mogut des del commit fixat, l'avís demana
    el SHA del cap actual i només aquest SHA ho desbloqueja (el flux normal
    exigeix igualment que sigui l'últim commit informat en verd). No cal editar
    SQLite. Una PR tancada sense fusionar no es pot
    fusionar: l'avís ho diu i no s'envia cap crida.
    Aquest resultat no bloqueja la cua ni l'arrencada del servei, perquè només
    afecta un nou merge de la
    mateixa PR. Si la lectura no és possible, la petició continua `uncertain` i es
    torna a intentar. Una petició `merging` interrompuda per un reinici passa a
    `uncertain`.
- **Resposta.** Nomena sempre la proposta fusionada i el canvi fusionat (SHA
  curt) a l'última línia, després de l'enllaç de revisió:
  «Enllaç per a revisió: <URL> (canvi fusionat <SHA curt>)». Si l'URL no és
  llegible, l'última línia és «Canvi fusionat <SHA curt>.».
- **Traça privada.** `merge_membership_verified` (autor, PR i SHA),
  `merge_requested`, `merge_refused` (amb el motiu), `merge_completed` (autor,
  PR, SHA fixat, mètode i commit de merge), `merge_failed`, `merge_uncertain`,
  `merge_uncertain_cleared` (autor, PR i SHA) i `merge_reconciled`, sense text
  de conversa ni credencials.
- **Després del merge.** La PR queda tancada: el seguiment de CI i la reparació
  ja es detenen amb una PR no oberta, i la preview la refusa. L'avís «la PR ja no
  està oberta» passa a ser l'últim del tema; un `/merge` posterior (amb o sense
  número) llegeix la PR i, si és fusionada, respon «La proposta #N ja està
  fusionada. No he fet res més.» i la línia de revisió amb el canvi fusionat, en
  lloc de refusar-se com a no verda.

Bloquejos d'activació, per a una persona. El permís `Contents: write` del token
permet usar l'API de merge i el compte és administrador: l'API REST podria
saltar-se la protecció de la branca llevat que s'activi «enforce admins». La
guarda efectiva són les comprovacions del servei (`clean`, SHA fixat, avís verd)
i el risc residual està acceptat a l'ADR 0013. `MOUNTAIN_AGENT_REQUIRED_CHECKS` ha
de coincidir amb la protecció de `main` amb «Require branches to be up to date»,
perquè `clean` signifiqui el mateix per als dos. El primer merge real requereix
l'aprovació explícita de la persona mantenidora. Aquesta implementació no activa
res.

## Feina vinculada al tema

El servei no reprèn PR d'un altre tema ni genera avisos de solapament: el codi
que ho feia s'ha eliminat.

La primera publicació confirmada desa la branca i la PR a
`state/topic-jobs.sqlite`. Per a un tema existent sense vinculació, el servei
consulta les publicacions registrades i l'estat de GitHub. Si hi ha una sola PR
oberta del servei, la vincula. Si n'hi ha diverses o no es poden llegir, atura
el torn i demana la revisió de la persona mantenidora, sense triar cap feina.

Abans de cada torn ordinari d'un tema vinculat, el servei llegeix la PR a
GitHub. Si és fusionada o tancada, respon «Aquesta feina ja està acabada. Obre un
tema nou per a una altra feina.» sense cap torn de model, branca ni PR. Si no la
pot llegir, no la dona per oberta i informa del fracàs de lectura. `/merge`
conserva el seu camí i els seus controls.

Un tema vinculat continua al seu worktree. El servei comprova la branca, el
repositori i el cap de la PR abans del torn i revalida la PR abans del push. No
crea una segona PR. Si el cap remot avança i el worktree no té feina pendent,
comprova el SHA baixat i actualitza la branca només amb fast-forward. Si hi ha
feina pendent, la conserva en un commit local i integra el cap de la PR quan
tots dos descendeixen de l'últim commit publicat. Si hi ha conflictes, utilitza
el mateix procediment de resolució al sandbox que per a `main`. Si no pot
verificar l'ascendència o la branca no correspon, refusa el torn i conserva la
feina.

Abans de cada push, el servei consulta `origin/main`. Si la branca va per
darrere, integra `main` amb un commit de merge, sense rebase ni push forçat, i
repeteix les comprovacions locals. Si hi ha conflictes, avorta el primer intent
i torna a preparar el conflicte per a un torn del model dins del sandbox. El
prompt enumera els camins com a dades no fiables i demana conservar els dos
canvis. Si les versions es contradiuen, demana al model que pregunti a la persona
quina vol. Si resten marcadors o la resolució falla, el servei avorta el merge i no
publica. Els conflictes binaris es refusen de manera conservadora. Si no es pot
confirmar l'avortament, la instrucció queda incerta i cal revisió de la persona
mantenidora.

## Continuïtat de la conversa d'un tema

Cada tema té una sola sessió de Pi i Pi conserva l'historial entre torns. El
servei hi manté, però, estat propi perquè cap missatge acceptat ni cap efecte
seu no quedi fora de la sessió.

- **Un torn per missatge acceptat.** Tota instrucció admesa que no és `/merge`
  ni una preview executa un torn de Pi amb escriptura a la sessió del tema. El
  text fix d'aclariment només es fa servir si el model no respon. Una resposta
  sense canvis no crea cap PR, llevat que hi hagi feina pendent de publicar.
- **Efectes del servei.** `repository/session-note-store.mjs` desa a
  `state/session-notes.sqlite`, per tema, el text de cada efecte que decideix el
  servei i que no és la resposta del model: l'informe de publicació i qualsevol
  altre informe d'instrucció, els avisos de CI i de reparació, la preview, el
  merge, el traspàs de tema, l'adjunt refusat (també el que es refusa en
  admetre'l) i la resolució d'un resultat desconegut. Una nota només conté text
  escrit pel servei: si un avís seu incorpora text del model, la nota en guarda
  només la part del servei, i les paraules del model només queden com a última
  resposta del tema. La nota es desa quan el servei decideix el text, abans de
  l'enviament: l'efecte existeix encara que l'avís falli. Cada efecte té una
  identitat duradora (`preview:<id>:<estat>`, `merge:<id>:<estat>`,
  `ci:<id>:<commit>:<estat de l'avís>`,
  `repair:<id>:<commit>:<instant de l'intent>:<estat>`,
  `instruction:<id>`, `reconcile:<tipus>:<id>`): dos avisos diferents del mateix
  commit són dos efectes, i la identitat d'una reparació no depèn d'una fila que
  es pot reutilitzar. Així, un reenviament de Telegram no duplica la nota i una
  identitat ja lliurada no es reviu. Les identitats lliurades es conserven sense
  poda: qualsevol reintent pot arribar molt més tard, i la taula només té una
  clau curta per efecte. Un informe que barreja text del servei i text del model
  (per exemple la línia de represa seguida de la resposta del model) només desa
  la part del servei com a nota, i el text complet queda com a última resposta
  del tema. Cada nota es retalla a 1.500 caràcters i el tema conserva les 20 més
  noves sense lliurar.
- **Lliurament únic.** Les notes es reclamen al darrer moment, després de la
  preparació del sandbox i del perfil de Pi i just abans que Pi rebi el prompt,
  i es posen davant de la petició en un bloc de servei separat («Service events
  since your previous turn...»). Qualsevol fallada anterior a aquest punt
  (preparació, perfil o aturada) deixa les notes pendents. Un cop reclamades,
  s'esborren quan el torn acaba o falla, perquè el prompt pot haver arribat a
  Pi. L'única excepció és que el prompt no s'hagi escrit mai (el servei ho sap
  pel fet d'enviament, `onPromptSent`, encara que després falli també la neteja
  del sandbox o l'error de llançament quedi substituït): llavors les notes tornen
  a quedar pendents, perquè cap prompt no hi ha arribat. Un reinici conserva les
  pendents i no repeteix cap nota d'un torn interromput: una reclamació que el
  reinici troba oberta compta com a lliurada i la seva identitat es desa abans
  d'esborrar la fila. El classificador no rep mai aquest bloc. La reparació
  automàtica també és un torn del tema i rep les notes.

## Adjunts

Un torn ordinari pot rebre imatges del tema. El servei les descarrega quan
executa la instrucció, mai en admetre-la.

- **Què s'accepta.** Fotos comprimides de Telegram i documents JPEG, PNG i
  WebP. D'una foto es pren la mida més gran, que Telegram envia com a JPEG. El
  límit d'entrada és de 20 MB, el màxim de descàrrega de la Bot API. Cada
  missatge o àlbum admet fins a cinc imatges. Una foto o un document d'un altre
  tipus es refusa amb un avís i no ocupa la cua.
- **Àlbum.** Telegram envia cada imatge d'un àlbum com una actualització pròpia
  amb el mateix `media_group_id`, i sovint només una porta la llegenda. El pont
  les recull durant una espera acotada d'un segon i les classifica com una sola
  instrucció; la menció o la llegenda poden ser en qualsevol imatge. Més de cinc
  imatges es refusen. L'àlbum és una unitat: si una imatge no s'accepta, es
  refusa el conjunt i no se'n desa cap. Mentre l'àlbum espera, l'offset de Telegram no avança més
  enllà de la primera imatge, així que un reinici torna a llegir el grup i la
  reentrega no reinicia l'espera. Els missatges d'altres sessions s'admeten
  sense esperar; els de la mateixa sessió esperen darrere l'àlbum per conservar
  l'ordre.
- **Com s'envia.** La imatge ha de ser al missatge que menciona el bot (menció a
  la llegenda) o que respon a un missatge seu, o al missatge que la mateixa
  instrucció respon, dins del tema. Els reenviaments s'ignoren i la instrucció
  necessita text: la llegenda o el missatge.
- **Validació.** El tipus real surt dels bytes i ha de coincidir amb l'extensió
  i el tipus que ha declarat Telegram. Les dimensions es llegeixen només de les
  capçaleres (PNG `IHDR`, JPEG SOF0–SOF15, WebP `VP8`, `VP8L` i `VP8X`), sense
  descodificar cap píxel. L'estructura també es comprova: al PNG, l'`IHDR` fa 13
  bytes i va primer, cada tros té el CRC correcte, hi ha d'haver `IDAT` i
  l'`IEND` ha de tancar el fitxer; al WebP, la mida RIFF ha de consumir el
  fitxer exacte, hi ha d'haver un sol fotograma i, en un fitxer estès, la tela ha
  de coincidir amb el fotograma (l'animació no s'accepta); al JPEG, el
  recorregut arriba a l'`EOI` i cap dada no el pot seguir. Un fitxer que no
  compleix aquestes condicions es refusa.
- **Metadades.** S'eliminen EXIF, XMP, IPTC, comentaris i dates del contenidor
  (JPEG: APP1, APP13 i COM; PNG: `eXIf`, `tEXt`, `iTXt`, `zTXt` i `tIME`;
  WebP: `EXIF`, `XMP ` i els bits corresponents de `VP8X`). APP0 i APP2 (ICC) es
  conserven. Al JPEG el recorregut és complet, també entre les exploracions d'un
  fitxer progressiu, i els segments de metadades s'eliminen a qualsevol posició.
  Després de reescriure es torna a llegir el resultat i es comprova que el tipus,
  les dimensions i la resta de dades d'imatge no canvien i que no hi queda cap
  metadada.
- **Reducció.** Si el costat llarg supera 2.400 px, `attachments/scale.mjs` posa
  la imatge neta en un directori temporal ignorat del worktree i executa un
  script dins del sandbox amb el `sharp` que la imatge ja té al store fora de
  línia. El procés de confiança no descodifica cap píxel. Després torna a llegir
  la sortida sense seguir enllaços simbòlics i amb un màxim de 20 MB, i la valida
  amb el lector de capçaleres: tipus, dimensions de 2.400 px com a màxim i cap
  metadada. Si no quadra, refusa. Una imatge més petita que la
  portada recomanada (1200 × 675 px) s'accepta i el model ho diu en una frase.
- **Destinació i retenció.** El magatzem és
  `state/attachments/topic-<hex>/`, fora del worktree i de Git, amb noms curts i
  estables (`imatge-1.jpg`, `imatge-2.png`). Un adjunt hi és fins que es
  publica o durant set dies; a l'arrencada s'esborren els vençuts. Cada torn
  copia el magatzem a `.agent-attachments/` del worktree perquè el sandbox el
  pugui llegir. Abans de les comprovacions i del commit, el servei esborra la
  còpia. Una imatge s'ha utilitzat quan el worktree conté, fora de
  `.agent-attachments/`, un fitxer regular amb els mateixos bytes (mateix
  SHA-256); si la publicació acaba bé, llavors la treu del magatzem. La publicació també refusa qualsevol història que
  contingui una ruta sota `.agent-attachments/`. El fitxer original només viu
  al directori temporal del servei i s'esborra sempre.
- **Què rep el model.** La llista d'imatges del tema amb el nom, les dimensions
  i si són noves en aquest missatge; les noves arriben com a entrada d'imatge
  del prompt i la resta es poden tornar a mirar amb l'eina `view_attachment`.
  Les imatges noves d'un prompt sumen com a màxim 8 MB; les que no hi caben no
  s'envien com a entrada i el text diu al model que les miri amb l'eina.
  El text de servei fixa els drets: una imatge que envia un membre verificat
  sense cap altra indicació és del club, amb el crèdit «Mountain Runners», i
  només es pregunta quan sembla de tercers. Amb diverses imatges noves, la
  persona diu on va cada una o el model fa una sola pregunta. Un cartell
  vertical es mostra sencer. El text alternatiu surt del que mostra la imatge i
  el model compara el text del cartell amb els fets de l'entrada. No s'hi posen
  consentiments ni dades personals.
- **Eina de consulta.** `view_attachment` només accepta un nom de la llista del
  servei, obre el fitxer amb `O_NOFOLLOW`, comprova que és un fitxer regular
  dins la mida i revalida la capçalera abans de retornar-lo. Un enllaç
  simbòlic, una ruta o un nom desconegut es refusen.
- **Abast i traça.** Els torns ordinaris apliquen les imatges; `/merge` i les
  peticions de preview les ignoren i ho diuen en una frase. La traça
  privada registra `attachment_accepted` (tipus, dimensions i bytes),
  `attachment_refused` (motiu i, quan es coneix, el tipus declarat i la mida) i
  `attachment_used` (noms utilitzats), mai el nom original ni el contingut.

## Llengua, avisos i publicació

Cada torn de prompt inclou un bloc fix en anglès que fixa el públic i el to de
la resposta: les persones del tema són membres del club, la majoria no són
tècniques, i la resposta va en la seva llengua, català per defecte, amb frases
curtes. No s'esmenten rutes, fitxers, camps YAML, ordres, noms ni recomptes de
proves, commits, branques, ADR ni skills, tret que la persona demani detall
tècnic. El model redacta amb els fets que té i fa com a màxim una pregunta; les
regles del projecte governen la feina, no la redacció de la resposta.

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

La persona només llegeix tres avisos fixos, definits a `policy/development.mjs`:
«Hi estic treballant.» (`workingNotice`), «Canvi desat.
Preparo com es veurà; trigarà uns 10 minuts.» (`savedNotice`) i «Alguna cosa ha fallat per part
nostra. …» amb una de dues accions finals: «Ho torno a intentar.»
(`failedRetryingNotice`, només quan una reparació automàtica ja és a la cua) o
«Ho he deixat anotat perquè ho revisi la persona que manté el servei.» (`failedMaintainerNotice`, tota la resta; cada enviament desa l'acció de traça `maintainer_attention` amb el motiu i l'escriu al diari).
Cap avís demana a la persona que repeteixi, pugi, reintenti o demani la preview, i
cap no usa «proposta», «comprovacions», «commit» ni «branca».

Després d'una publicació, el tema rep la resposta del model, l'avís «Canvi desat»
i l'enllaç de revisió com a darrera línia. Si el seguiment de CI no s'ha pogut
desar, l'avís és el de fallada que deixa el cas anotat per a la persona mantenidora. La resposta del
model es retalla perquè l'enllaç no es perdi mai pel límit de 4000 caràcters del
transport. Una CI verda no envia res a la persona, perquè ja ha llegit «Canvi desat»: el resultat només va a la nota del servei i a la traça privada. L'adreça de la
preview arriba en un avís propi quan el publicador la confirma, sense esperar la CI; l'avís de preview és «Ja ho pots veure: <adreça>» i, si no es confirma al termini, el de fallada. Una reparació
en curs envia l'avís de fallada amb «Ho torno a intentar»; el límit de
reparacions, un resultat desconegut, un cap canviat, una PR tancada i qualsevol
fallada de la reparació envien l'avís de fallada que deixa el cas anotat per a la persona
mantenidora. Els textos de reparació publicada reutilitzen el de la publicació.

Els noms de les comprovacions i el commit queden al registre privat del servei
(`ci_notification_sent`) i a la nota del servei de
`state/session-notes.sqlite`, que és l'única que veu el model; l'evidència d'un
intent de reparació es desa a `state/ci-watch.sqlite`. La nota de la publicació és
tècnica i separada del text planer: `publicationNoteText` hi desa el número de la
proposta, la branca, el commit publicat i el resultat de les comprovacions
locals. També la publicació d'una reparació automàtica desa aquesta nota
(`ciRepairReports.publishedNote`): les paraules del model arriben al tema, però
no són mai text de servei. `publicationReport` envia la resposta del model,
retallada perquè l'enllaç no es perdi, l'avís «Canvi desat» (o el de fallada si el
seguiment de CI no s'ha pogut desar) i, com a darrera línia, l'enllaç de revisió.
`ciReports` i `ciRepairReports` hi assignen cada resultat i `ciNoteReports` i
`ciRepairNoteReports` el mateix resultat tècnic, amb el commit i els noms de les
comprovacions, a la nota del servei. La fixació al commit, el lliurament com a
màxim una vegada i el tractament d'un resultat desconegut no canvien.

Quan el seguiment veu que el cap de la proposta ha canviat, la persona rep l'avís
de fallada que deixa el cas anotat per a la persona mantenidora: el servei no segueix la versió nova
tot sol i no demana res a la persona. La nota tècnica del servei conserva el detall.

El prompt de cada torn no porta el tipus de petició, ni les frases de consulta de
només lectura, ni la línia de petició poc clara. Hi afegeix una línia que diu que
el servei desa i mostra cada canvi sol i que el model no ha de dir mai que cal
demanar-ho.

## Estat del tema

Abans de cada torn, el servei identifica la PR del tema amb els seguiments
persistits. Llegeix de GitHub la PR, el cap i les comprovacions obligatòries, i
revalida el cap. Revalida també el cap i llegeix la confirmació del publicador
per a la preview del cap actual; les etiquetes de la PR decideixen la preview:
sense `preview`, amb `preview-revoked` o amb la PR tancada, el bloc no en dona cap
adreça. Si la lectura falla o el cap canvia durant la consulta, el bloc indica
que no es pot comprovar l'estat i es registra `topic_state_failed` al journal. El
bloc no conté identificadors de Telegram ni dades personals, i el classificador
no el rep. El model el rep dins del sandbox sense xarxa ni credencials. El merge
i la reparació també tornen a comprovar el cap i la CI abans d'actuar.

Els estats interiors es descriuen en paraules planes i el model els explica a la
persona sense identificadors de commit ni noms de comprovació. Cada fet del bloc
és d'aquella PR: una fila d'una altra PR del mateix tema no s'hi fa servir. La
columna `confirmed_origin` de `preview-request.sqlite` desa l'URL confirmada
juntament amb el final de la petició i s'afegeix sola en arrencar sobre una base
de dades anterior.

La petició explícita de preview torna a comprovar la PR, no les comprovacions
del cap: la preview s'activa amb l'etiqueta i el `build` executa `pnpm validate`.
Els treballs pendents i els resultats desconeguts continuen bloquejant la
petició. Abans d'un merge o una
reparació, el servei torna a comprovar el cap i la CI; el merge continua fixat
al commit informat al tema.

## Resultats desconeguts

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
L'arrencada es refusa mentre quedi qualsevol instrucció incerta o una reparació
interrompuda, fins i tot després de diversos reinicis. Abans de refusar, completa
totes les recuperacions locals (instruccions, avisos, reparacions i
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
[`docs/operations/agent.md`](../../../docs/operations/agent.md#reconciliació-de-resultats-desconeguts).

La classificació semàntica no substitueix l'autorització, els muntatges de només
lectura ni les operacions deterministes de Git. El paquet no inclou aquesta
política ni pot autoritzar per si sol una publicació.

## Fronteres de confiança

- El pont és l'únic procés amb els tokens de Telegram i GitHub. L'adaptador
  prepara una llista blanca d'entorn per a Pi amb només la credencial del model:
  `PATH`, `HOME`, el perfil de l'agent, la configuració de l'entorn aïllat i les
  variables que declara `MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES`. Aquesta
  política viu a `runtime/pi-adapter.mjs`.
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
- Pi no exposa la `bash` del host. El model només pot executar ordres amb
  `sandbox_bash`, una extensió del perfil de confiança que aplica el mateix
  constructor d'arguments que el component de confiança: contenidor no
  privilegiat, `--network=none`, `--read-only`, `--cap-drop=ALL`,
  `--security-opt=no-new-privileges`, límits de CPU, memòria i processos i
  l'UID/GID no root del propietari del worktree. Només munta el worktree a
  `/work`, amb escriptura per als torns ordinaris i les reparacions. No exposa
  eines natives de fitxers del host.
- El model llegeix `AGENTS.md`, skills i documentació dins del contenidor. Pi
  no els carrega al host ni manté còpies que puguin seguir symlinks cap a secrets.
  El perfil de cada instrucció es reconstrueix a l'estat del servei amb només
  recursos de confiança instal·lats.
- L'etiqueta `mountain-agent.session` dels contenidors i
  `MR_AGENT_SESSION_IDENTIFIER`, que rep Pi, porten el nom opac del worktree. El
  fitxer de sessió de Pi conserva l'identificador privat perquè viu fora del
  sandbox.
- Podman s'executa localment sense root ni dimoni, amb `--remote=false` i
  `--userns=keep-id`. Conserva l'UID/GID del worktree i `UMask=0077`. Ni el pont
  ni Pi tenen grup Docker o socket de contenidors del host. El contenidor no
  té xarxa, credencials ni metadades Git. Podman usa `cgroupfs` i la unitat
  delega el seu cgroup amb `Delegate=yes`; `RuntimeDirectory` crea
  `/run/mountain-runners-agent` amb mode `0700`, i `XDG_RUNTIME_DIR` arriba a Pi
  i al runtime, però no al contenidor com a variable d'entorn del host. El
  runtime només rep `PATH`, `HOME` i `XDG_RUNTIME_DIR`. Els helpers de sistema
  `newuidmap` i `newgidmap` necessiten els permisos restringits per mapar els
  rangs subordinats de l'usuari; per això la unitat del pont no fixa
  `NoNewPrivileges=true`, mentre que el contenidor conserva
  `--security-opt=no-new-privileges` i `--cap-drop=ALL`.
- Git selecciona metadades del registre de confiança, comprova l'indicador
  `.git`, desactiva hooks i fsmonitor i no hereta l'entorn secret del pont. La
  unitat arrenca amb `UMask=0077`, així que les ordres Git de confiança executen
  amb `umask 022`: si no, els fitxers que genera el checkout perden els bits
  d'execució que consten a l'índex i les comprovacions del projecte fallen dins
  dels worktrees de l'agent.
- La publicació inspecciona tots els objectes nous de `origin/main..HEAD`,
  inclosos fitxers esborrats i missatges de commit, contra els tokens de
  Telegram, GitHub i les variables del proveïdor. Refusa objectes il·legibles,
  objectes de més de 2 MiB o un total superior a 32 MiB. També rebutja canvis
  a `.github/**` i `CODEOWNERS` en qualsevol commit del rang. El push usa el
  SHA inspeccionat. Cal una credencial sense `Workflows: write`.
- El token de GitHub està acotat al repositori amb `Contents: write`,
  `Pull requests: write` i `Actions: write`, sense `Workflows: write` ni permisos
  d'administració. `Actions: write` permet reexecutar una sola vegada els jobs
  fallits d'una execució cancel·lada, esgotada o fallida en la preparació;
  també permet altres accions sobre execucions de workflows i augmenta el risc
  d'abús i de consum de recursos si es compromet el servei o el token. La
  credencial continua fora del sandbox i el servei limita i registra les
  reexecucions. El rol administrador del compte no prova els permisos del token.
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

## Imatge del sandbox per a comprovacions offline

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

Abans d'un torn ordinari o d'una reparació, el servei prepara les dependències
offline perquè el model pugui executar proves. Les peticions de preview no
inicien el model ni preparen el worktree. Les ordres amb escriptura reben
`TMPDIR=/work/.agent-runtime-tmp`, un directori durador del worktree que Git i
el lint del repositori ignoren: `/tmp` del contenidor és `noexec`, i els fitxers
temporals que genera Playwright, com la memòria cau de transformació, no s'han
de cometre ni validar. Abans de publicar, el servei torna a instal·lar les
dependències del lockfile i executa `pnpm check`, o `pnpm check:local` si tots
els camins de la publicació són dins del contingut (ADR 0012), amb un `TMPDIR`
nou. Si la preparació falla, no inicia el model o no publica, segons el moment
de la fallada.

La versió de pnpm del `package.json` ha de coincidir amb la de la imatge. Una
diferència es refusa sense descarregar cap versió nova.

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
`commands/update/command.test.mjs` cobreix la revisió instal·lada, l'estat
ocupat, la imatge del sandbox, la còpia, la substitució de directoris i la
verificació, i `commands/update/cli.test.mjs` la ajuda i els codis de sortida,
amb repositoris de Git i directoris temporals.
`workflow/bridge-package.test.mjs` executa el paquet en una còpia
independent, prova el tarball des d'un consumidor extern i verifica la disposició
instal·lada del servei. No s'hi fan peticions reals ni es necessiten credencials,
i el gate no publica el paquet ni crea cap repositori remot.

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

- [Abast de T8.3](../../../docs/specs/phase-8/phase-8-editorial-assistance.md#t83-base-operativa-de-telegram-fins-a-pr).
- [Frontera acceptada, ADR 0013](../../../docs/decisions/0013-private-development-agent-boundary.md).
- [Instal·lació i pilot](../../../docs/operations/agent.md).

Aquestes proves no demostren els permisos reals de GitHub ni l'aïllament al VPS.
L'activació del pilot, la revisió independent i la distribució pública del paquet
continuen requerint aprovació explícita.
