# Especificació de la fase 8: Agent de desenvolupament i consulta

## Estat

En preparació. La planificació inicial del 18 d'octubre de 2026 descrivia
assistència editorial delegada. La revisió del 6 de novembre de 2026 amplia la
direcció funcional a un agent de desenvolupament i consulta sobre el projecte,
amb codi i contingut. Es conserva el camí d'aquest document per no trencar-ne
les referències.

La persona mantenidora confirma:

- Execució al VPS, en un servei separat de producció.
- Telegram com a canal inicial, amb un supergrup privat amb temes de fòrum.
  WhatsApp queda descartat i no cal construir una web inicial.
- Cada tema és una sessió de conversa compartida, com una sessió local de pi:
  pot contenir preguntes, una feina o diverses feines encadenades.
- Qualsevol membre del grup autoritzat pot consultar i encarregar canvis, amb
  els mateixos permisos i atribució individual de cada instrucció.
- Les peticions són llenguatge natural: preguntes, descripcions funcionals o
  ordres d'implementació, sense formulari ni estructura obligatòria.
- Una petició d'implementació autoritza editar, executar proves, fer commits,
  push a la branca de treball i obrir o actualitzar la PR, sense confirmacions
  intermèdies.
- El merge continua sent una decisió humana. Un cop validat el resultat, un
  membre del grup el demana explícitament al fil i el servei l'executa amb el
  commit validat. L'agent no fusiona mai per iniciativa pròpia ni per una
  instrucció implícita.
- La primera base operativa inclou Telegram, sessions i el flux complet fins a
  una PR amb un canvi petit. Les millores i els casos menys freqüents es proven
  sobre aquesta base, sense retirar els controls de seguretat previs al pilot.
- Una persona del grup pot demanar una preview al fil. L'agent comenta
  `/preview` a la PR amb el seu compte de GitHub; no la demana automàticament.
- Una feina es pot reprendre des d'un altre tema amb la branca o PR, la seva
  descripció, l'especificació i els ADR relacionats.
- Els solapaments entre feines de diferents fils es comuniquen, però no
  bloquegen per si sols. No autoritzen sobreescriure treball aliè.

Aquesta revisió substitueix el model d'un tema per tasca, l'autorització per
llista separada d'usuaris i el perfil exclusivament editorial sense terminal.
Tampoc exigeix construir un gestor de tasques ni un publicador propi si una
integració existent compleix els requisits. El runtime continua pendent de
comparació; pi és el punt de partida, no una elecció de runtime tancada.

L'ampliació canvia fronteres descrites a `AGENTS.md`,
[`docs/ai-assistant.md`](../ai-assistant.md) i l'arquitectura vigent. Aquesta
especificació és una proposta, no una excepció operativa a aquestes normes.
T8.2 ha obtingut l'aprovació de l'ADR que les esmena abans de
l'activació dels permisos nous. La separació del xat públic de l'ADR 0002 i la
revisió humana i protecció de producció de l'ADR 0003 es mantenen; l'ADR 0003
s'esmena de manera acotada per permetre el push, la PR i el merge demanat
explícitament, sense eliminar la revisió humana ni la protecció de `main`.
T8.2 també ha obtingut l'aprovació de l'esmena de l'[ADR 0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md)
que delega la petició de preview, sense activar-la fins que els controls
estiguin verificats.

Cap unitat passa a `En curs` fins que la PR de l'especificació es revisi i
fusioni. Aquesta planificació no autoritza crear comptes, credencials ni
modificar configuració remota.

## Objectiu

Disposar d'un agent privat de desenvolupament i consulta al VPS, accessible des
de sessions compartides de Telegram, que entengui el projecte i prepari canvis
de codi o contingut fins a una PR revisable i la seva preview. La conversa no
és un gestor de tasques: el treball es conserva a Git i a les seves
especificacions i decisions, amb atribució humana privada, sense desplegament
per part de l'agent i amb el merge només a petició verificada d'una persona.

## Límits i decisions confirmades

- El servei privat i el futur xat públic són sistemes separats, sense compartir
  servei, índex ni credencials ([ADR 0002](../decisions/0002-public-chat-and-private-editor.md)).
  La fase 7 no és dependència tècnica de la fase 8.
- L'accés s'acota a un grup privat configurat explícitament. Ser membre d'aquell
  grup autoritza a consultar i encarregar canvis; un altre grup o un missatge
  privat al bot no ho autoritzen. El bot verifica la identitat real de l'autor,
  no noms visibles ni identitats citades en el text.
- Cada tema correspon a una sessió, no a una branca, worktree, PR o tasca única.
  Una consulta no obliga a crear cap d'aquests artefactes.
- Totes les persones del grup poden continuar el treball compartit, també des
  d'un altre tema, mantenint l'autor de cada instrucció. L'agent no pren
  l'última ordre com a resolució automàtica d'una contradicció funcional.
- El treball nou parteix de l'últim `main`, en branca i worktree dedicats;
  reprendre una PR recupera el treball existent sense descartar-ne els canvis.
  El worktree principal no s'utilitza per implementar.
- L'abast funcional inclou el codi, les proves, la documentació i el contingut
  del projecte quan ho requereix la petició. No inclou administrar el host,
  alterar configuració remota ni ampliar els permisos del mateix servei.
- L'agent pot utilitzar eines de desenvolupament, terminal, dependències,
  proves i navegador dins de l'entorn aïllat segons el canvi. No és una shell
  remota amb accés indiscriminat al VPS.
- Una consulta no autoritza modificacions. Una petició d'implementació sí que
  autoritza el recorregut fins a la PR dins del seu abast; si aquest és ambigu,
  l'agent demana aclariment. No s'exigeixen ordres estructurades.
- Els commits, el push i les PR de l'agent utilitzen el compte de GitHub
  `rboixaderg`, compartit amb la persona mantenidora. El compte no distingeix
  per si sol les accions de l'agent ni substitueix l'atribució privada de qui
  demana cada acció. L'agent no aprova les seves PR ni les fusiona pel seu
  compte: la petició de merge és sempre d'una persona verificada.
- L'agent no activa auto-merge, no fa push directe a `main`, no modifica
  proteccions i no desplega. Només fusiona amb una petició explícita d'una
  persona verificada, un SHA concret i totes les comprovacions obligatòries en
  verd, pel camí determinista de l'[ADR 0013](../decisions/0013-private-development-agent-boundary.md).
  El pipeline protegit continua desplegant només el que s'ha fusionat a `main`
  ([ADR 0003](../decisions/0003-agent-workflow-and-security.md)).
- Les comprovacions locals segueixen `AGENTS.md` i
  [l'estratègia de proves](../testing-strategy.md); la CI continua sent un gate
  independent. Una persona del grup demana la preview al fil; l'agent utilitza
  el compte de GitHub configurat i el flux aprovat de la fase 6. No es demana amb
  CI vermella ni sense la petició explícita de la persona.
- El contingut continua subjecte als esquemes i la
  [guia editorial](../editorial/guide.md): nou contingut en esborrany,
  correccions que preserven l'estat publicat i traduccions completes en els
  idiomes afectats. Ampliar l'accés al codi no autoritza saltar-se la revisió
  editorial. La publicació d'una entrada es regeix pel requisit de T8.8: la
  petició d'un membre verificat n'és l'aprovació editorial i el merge continua
  sent humà.
- Es conserva OpenCode Go com a font de model prevista, pendent de validar amb
  el runtime i amb tasques de codi i contingut. La subscripció és el límit
  econòmic previst, sense pressupost addicional per tokens. Això no substitueix
  límits de recursos i d'execució.
- Les sessions i les accions externes han de poder recuperar-se sense
  duplicacions. El mecanisme, la retenció i el runtime es decideixen a T8.2;
  cap capacitat d'una eina es dona per provada abans de verificar-la.

## Resultats esperats

- Diverses persones conversen amb l'agent al mateix tema i les instruccions es
  processen en ordre amb atribució individual.
- Un tema pot servir només per consultar i després encadenar implementacions
  diferents sense quedar vinculat a una única PR.
- Una altra sessió pot recuperar una PR i continuar-la amb el seu codi,
  descripció i decisions, preguntant pel context que hi falti.
- L'agent implementa, comprova, fa commits i push i obre o actualitza la PR
  sense confirmacions intermèdies davant d'una petició clara.
- Dues feines que toquen fitxers relacionats poden avançar amb un avís de
  conflicte potencial i entorns separats, preservant el treball aliè.
- La conversa retorna resultats locals, CI i preview verificables. Una
  interrupció no duplica PR, commits ni comentaris.
- Retirar una persona del grup impedeix noves instruccions seves. El servei es
  pot aturar sense afectar producció ni previews.
- Una persona que ha validat la PR demana el merge al fil i el servei el fa
  amb el commit validat, sense repetir cap acció prèvia ni duplicar el resultat.
- Un merge sense petició verificada, l'accés a producció i la sortida del
  sandbox es rebutgen amb controls independents del model.

## Dependències i ordre d'inici

La fase s'avança a la fase 7. Depèn del VPS i flux de producció de la fase 5,
de les previews de la fase 6 i dels contractes de contingut i guia editorial
existents, inclòs el flux de notícies i blog de la
[PR #140](https://github.com/rboixaderg/mountain-runners/pull/140).

T8.1 concreta els requisits operatius i les amenaces. T8.2 compara runtimes i
integracions, defineix la frontera de seguretat i proposa l'ADR. T8.3 entrega
una base amb Telegram, sessions i una primera tasca petita fins a PR. T8.4
amplia el flux de GitHub amb continuació de feines, CI i preview. T8.5 completa
l'auditoria, la revocació i la recuperació. T8.6 valida el conjunt i el runbook.
T8.7 corregeix la continuïtat de la conversa que el pilot de T8.6 va trobar
trencada. T8.8 corregeix l'experiència d'edició que el mateix pilot va trobar
feixuga per a una persona no tècnica.

Les proves que depenen del servei complet es fan sobre la base operativa i no
bloquegen l'avaluació inicial. Abans d'activar el pilot es comproven els
controls essencials d'identitat, aïllament, credencials i protecció de `main`.
La persona mantenidora disposa d'un procediment d'aturada del servei. Si una
acció externa té un resultat desconegut, el pilot s'atura i ho comunica sense
repetir-la automàticament. Les proves addicionals i els casos menys freqüents
s'agrupen a T8.4, T8.5 i T8.6. Els criteris de seguretat finals es mantenen.

Cada unitat d'implementació utilitza un worktree i una branca propis des de
l'últim `main` i té PR dedicada. L'alta del bot, del grup, del compte de GitHub i
de les credencials requereix aprovació explícita. L'ADR i els controls de T8.2
són prerequisits per habilitar la nova capacitat d'escriptura del servei.

## Tasques, entregues i seguiment

| Unitat                                          | Estat      | Dependències | Resultat verificable                                   | PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ---------- | ------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T8.1 Requisits, sessions, identitats i amenaces | Completada | Fases 5 i 6  | Contracte operatiu i riscos revisats                   | [#180](https://github.com/rboixaderg/mountain-runners/pull/180)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| T8.2 Avaluació, runtime, permisos i ADR         | Completada | T8.1         | Solució mínima verificada i frontera aprovada          | [#182](https://github.com/rboixaderg/mountain-runners/pull/182), [#183](https://github.com/rboixaderg/mountain-runners/pull/183)                                                                                                                                                                                                                                                                                                                                                                                                       |
| T8.3 Base operativa de Telegram fins a PR       | Completada | T8.2         | Una tasca petita arriba a PR des de Telegram           | [#197](https://github.com/rboixaderg/mountain-runners/pull/197), [#206](https://github.com/rboixaderg/mountain-runners/pull/206), [#207](https://github.com/rboixaderg/mountain-runners/pull/207)                                                                                                                                                                                                                                                                                                                                      |
| T8.4 Continuació, CI i preview                  | Completada | T8.3         | Feina represa, preview i merge a petició               | [#212](https://github.com/rboixaderg/mountain-runners/pull/212), [#213](https://github.com/rboixaderg/mountain-runners/pull/213), [#215](https://github.com/rboixaderg/mountain-runners/pull/215), [#216](https://github.com/rboixaderg/mountain-runners/pull/216), [#217](https://github.com/rboixaderg/mountain-runners/pull/217), [#219](https://github.com/rboixaderg/mountain-runners/pull/219), [#220](https://github.com/rboixaderg/mountain-runners/pull/220), [#222](https://github.com/rboixaderg/mountain-runners/pull/222) |
| T8.5 Auditoria, revocació i recuperació         | Completada | T8.3         | Atribució, continuïtat i aturada verificades           | [#211](https://github.com/rboixaderg/mountain-runners/pull/211), [#218](https://github.com/rboixaderg/mountain-runners/pull/218), [#224](https://github.com/rboixaderg/mountain-runners/pull/224), [#225](https://github.com/rboixaderg/mountain-runners/pull/225)                                                                                                                                                                                                                                                                     |
| T8.6 Validació integral i runbook               | En curs    | T8.4, T8.5   | Servei operable sense accés a producció                | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T8.7 Continuïtat de la conversa d'un tema       | Pendent    | T8.4, T8.5   | Cada missatge acceptat manté el fil del tema           | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T8.8 Experiència de les persones editores       | En curs    | T8.7         | Seqüència del pilot completa sense respostes tècniques | [#244](https://github.com/rboixaderg/mountain-runners/pull/244), [#245](https://github.com/rboixaderg/mountain-runners/pull/245), [#246](https://github.com/rboixaderg/mountain-runners/pull/246), [#247](https://github.com/rboixaderg/mountain-runners/pull/247), [#248](https://github.com/rboixaderg/mountain-runners/pull/248), [#249](https://github.com/rboixaderg/mountain-runners/pull/249)                                                                                                                                   |

### T8.1: Requisits, sessions, identitats i amenaces

**Abast:** concretar activació del bot i creació de temes, comprovació de
pertinença al grup, revocació, consulta de l'auditoria, límits de concurrència i
recursos i semàntica d'aturada d'una execució. Definir els avisos de solapament
i la continuació de la mateixa branca entre sessions. Revisar compromís del
compte de Telegram, bot, runtime, credencials i dependències, prompt injection
i execució de codi del repositori. **Exclusió:** no crea infraestructura ni
comptes ni converteix les peticions en formularis. **Depèn de:** fases 5 i 6.
**Resultat:** contracte observable i amenaces revisades. **Comprovació:** revisió
de seguretat, privacitat, col·laboració i operació. **PR:** pròpia.
El contracte i la matriu d'amenaces són a
[requisits i amenaces de T8.1](../phase-8-t81-requisits-amenaces.md).

### T8.2: Avaluació, runtime, permisos i ADR

**Abast:** comparar reutilització i codi propi segons l'esforç total de
manteniment; verificar la viabilitat de sessions, terminal aïllada i integració
amb GitHub. Fixar versions, llicències,
model, aïllament, persistència, credencials, permisos, rotació, xarxa i límits.
Proposar l'ADR per ampliar l'agent de contingut a desenvolupament, autoritzar per
pertinença al grup i delegar el flux fins a PR i fins al merge demanat
explícitament. Revisar l'ADR 0009 i proposar
l'esmena necessària per delegar a l'agent la petició de preview feta al fil.
El flux actual de GitHub verifica el compte que comenta, no la persona de
Telegram. Alinear `AGENTS.md`,
`docs/ai-assistant.md` i `docs/architecture.md` quan s'aprovi la frontera, sense
alterar el xat públic ni la revisió humana. **Exclusió:** no desplega el servei
ni crea credencials de producció; la prova acotada només usa entorns i comptes
de prova autoritzats explícitament. **Depèn de:** T8.1. **Resultat:** elecció
justificada, prova reproduïble i ADR aprovat abans d'habilitar permisos nous.
**Comprovació:** provar els controls essencials del pilot i justificar les
verificacions que requereixen la base operativa. El flux real fins a PR es
comprova a T8.3; la represa entre fils i els casos addicionals, a T8.4–T8.6.
**PR:** pròpia. L'[ADR 0013](../decisions/0013-private-development-agent-boundary.md)
recull la frontera acceptada i esmena de manera acotada els ADR 0003 i 0009.

pi és el punt de partida del harness. `@earendil-works/pi-durable` és un
candidat, no una obligació ni una garantia de recuperació d'efectes externs.
L'avaluació pot comparar un pont petit sobre pi amb un runtime durador i amb
integracions existents. Els candidats identificats inclouen
`pi-durable-telegram`, `pi-gateway`, `pi-agent-telegram`, OpenClaw amb Pi ACP i
Hermes Agent; no es pressuposen compatibilitat, suport de temes ni maduresa.
Gentle Dot és una referència de daemon i sessions, no una eina escollida per la
seva interfície. Si canviar el harness és necessari, l'ADR ho ha de justificar;
les alternatives OpenCode identificades es poden valorar en aquest cas. No cal
avaluar tots els candidats: la comparació és acotada als viables per T8.1.

La comparació reutilitza les proves disponibles i identifica els casos que
requereixen el servei operatiu. El pilot comprova una consulta i una tasca de
codi fins a PR. La fase valida després dos usuaris, contingut, continuació
des d'un altre fil, solapaments i interrupció després d'una acció externa. Cal
distingir recuperar l'historial de recuperar una execució. Es tria una solució
sense exigir una interfície web ni un gestor de tasques per defecte.

La retenció es decideix segons les capacitats verificades: què es desa, on,
qui ho consulta i com s'esborra, inclosos backups. No es fixa ara un termini ni
una conservació indefinida. Engram o una altra memòria són opcionals; no
substitueixen el codi, PR, especificacions i ADR ni s'exigeix una base de tasques.

### T8.3: Base operativa de Telegram fins a PR

**Abast:** implementar el pont de Telegram, les sessions i un entorn aïllat de
desenvolupament. Verificar el grup i l'autor, atribuir i deduplicar missatges i
processar-los en ordre. Carregar les regles i skills del projecte. Processar
una consulta i preparar una tasca petita de codi en una branca pròpia. Executar
les comprovacions pertinents, fer commit i push i obrir una PR amb la identitat
aprovada. Preparar el servei per operar al VPS mitjançant el flux de
desplegament aprovat.
**Exclusió:** encara no fusiona ni activa auto-merge, no fa push a `main`, no demana
preview i no accedeix a secrets o serveis de producció; el merge demanat
s'incorpora a T8.4. **Depèn de:** T8.2,
ADR aprovat i controls essencials verificats abans d'activar permisos.
**Resultat:** una petició natural arriba a una PR revisable sense confirmacions
intermèdies; una consulta no crea branca. **Comprovació:** sessió, autorització,
aïllament, permisos reals mínims i una tasca petita fins a PR. **PR:** pròpia.
El desplegament i l'activació del pilot requereixen aprovació explícita; una
PR de preparació no els activa per si sola.

**Ampliació acordada durant la implementació:** separar el nucli reutilitzable
Telegram i Pi en un paquet local amb llicència MIT, API, proves i exemple propis.
Les entrades `/telegram`, `/sessions` i `/pi` es carreguen independentment;
`/pi` no carrega Telegram ni SQLite. El consumidor separa les regles pures del
projecte, la composició d'integracions i la coordinació del flux. El coordinador
no rep tokens ni clients de Docker o GitHub.
El nucli no depèn de GitHub, Docker, les comprovacions ni els prompts de Mountain
Runners. El servei del projecte el consumeix i conserva l'autorització,
l'aïllament i el flux fins a PR. La comprovació inclou executar les proves del
paquet en una còpia independent i consumir-ne el tarball fora del repositori,
sense credencials de GitHub ni Docker. Aquesta separació s'agrupa amb T8.3
perquè extreu la seva implementació encara no fusionada, sense canviar els
permisos aprovats. Crear un repositori remot, publicar a npm o desplegar el
paquet queda fora d'aquesta entrega i requereix aprovació explícita.

**Completada.** El pilot supervisat al VPS va respondre una consulta sense crear
branca i va portar una tasca petita fins a una PR revisable, amb una sola
instrucció i sense confirmacions intermèdies. La comprovació real va cobrir la
sessió per tema, l'autorització per pertinença a cada instrucció (la denegació
la cobreixen les proves del servei), l'aïllament del contenidor (17 de 17
proves, sense xarxa ni credencials), els permisos mínims de la credencial de
GitHub (escriptura a `.github/workflows` refusada amb 403 i cap lectura
d'administració) i els límits reals del cgroup. La PR del pilot és sintètica i
no s'ha de fusionar. Resten per a les entregues següents la continuació, la CI i
la preview (T8.4) i l'auditoria, la revocació i la recuperació (T8.5).

### T8.4: Continuació, CI i preview

**Abast:** ampliar la base que ja crea branques i PR amb el seguiment i la
reparació acotada de CI i, quan una persona ho demana al fil, petició de
preview i retorn d'URL i SHA confirmats. Incorporar el merge demanat
explícitament per un membre verificat, amb el commit validat i les
comprovacions obligatòries en verd.
Recuperar una branca/PR existent des d'una altra sessió i actualitzar el seu
context revisable. Avisar dels solapaments sense bloquejar i incorporar adjunts
amb les validacions previstes. Reutilitzar les integracions viables, sense
exigir un publicador propi. **Exclusió:** no activa auto-merge, no fa push a `main`,
no modifica proteccions ni desplega; aturar una execució no tanca
automàticament la PR. **Depèn de:**
T8.3. **Resultat:** una petició natural d'implementació arriba a PR sense
confirmacions intermèdies; la preview i el merge requereixen una petició
explícita al fil.
**Comprovació:** dues sessions sobre una PR, solapaments, validació d'adjunts,
absència de petició automàtica, CI vermella sense preview, idempotència i
rebuig de merge sense comanda o amb commits posteriors a l'informe. **PR:** pròpia.

**Completada.** Les entregues cobreixen l'avís de CI al tema
([#212](https://github.com/rboixaderg/mountain-runners/pull/212)), la reparació acotada ([#213](https://github.com/rboixaderg/mountain-runners/pull/213)), la preview
demanada ([#215](https://github.com/rboixaderg/mountain-runners/pull/215)), el merge amb `/merge` ([#216](https://github.com/rboixaderg/mountain-runners/pull/216),
[#217](https://github.com/rboixaderg/mountain-runners/pull/217)), la continuació d'una PR des d'un altre tema
([#219](https://github.com/rboixaderg/mountain-runners/pull/219)), l'avís de solapaments ([#220](https://github.com/rboixaderg/mountain-runners/pull/220)) i els
adjunts d'imatge ([#222](https://github.com/rboixaderg/mountain-runners/pull/222)). Aquella entrega va fixar un límit d'entrada de 2 MB i 2.400 píxels, sense
redimensionar al servei; T8.8 el substitueix. Les comprovacions
de la unitat són proves del servei amb Git local i GitHub i Telegram simulats.
Cap d'aquestes capacitats no s'ha activat al pilot: cada PR recull la
verificació manual pendent abans d'activar-la, que es fa a T8.6.

### T8.5: Auditoria, revocació i recuperació

**Abast:** completar el registre privat d'autors i accions, consulta de la
traça, comprovació de revocació per sortida o expulsió del grup i recuperació
segura després d'un reinici. Aplicar la retenció decidida a T8.2 i la neteja que
preserva treball no fusionat. Provar l'aturada i la rotació de credencials.
**Exclusió:** no publica identitats a GitHub ni esborra worktrees només perquè
s'acabi una conversa. **Depèn de:** T8.3. **Resultat:** atribució i continuïtat
verificables sense duplicar efectes externs. **Comprovació:** reinici, revocació,
minimització, recuperació i aturada sense afectar la web. **PR:** pròpia.

**Completada.** Les entregues cobreixen la neteja de worktrees arxivats que
preserva treball no publicat ([#211](https://github.com/rboixaderg/mountain-runners/pull/211)), la consulta de la traça privada
([#218](https://github.com/rboixaderg/mountain-runners/pull/218)), la reconciliació de resultats desconeguts amb una ordre
d'operador ([#224](https://github.com/rboixaderg/mountain-runners/pull/224)) i la revocació, que torna a comprovar la pertinença
abans d'una preview, com ja feia el merge ([#225](https://github.com/rboixaderg/mountain-runners/pull/225)). La persona mantenidora
ha decidit no esborrar automàticament la traça, l'estat ni l'historial de Pi
fins a una revisió explícita, amb els criteris de `docs/deployment.md`. La prova
real de revocació no cal: qui ja no és al grup no hi pot escriure, i el cas
d'una petició a la cua el cobreixen les proves del servei. L'aturada es va
verificar al VPS a T8.3. La rotació de credencials passa al runbook de T8.6.

### T8.6: Validació integral i runbook

**Abast:** validar consultes, implementació de codi i contingut, col·laboració i
represa entre fils fins a CI i preview, i els casos negatius de les unitats
anteriors. Documentar operació, límits, interrupció, actualització, còpies,
restauració i rotació a les guies de desplegament i runbook. **Exclusió:** no
converteix el servei en shell del host ni via de desplegament. **Depèn de:**
T8.4 i T8.5. **Resultat:** servei operable amb responsables i fronteres
provades. **Comprovació:** suite del servei, smoke real autoritzat, validació
pertinent del canvi segons l'estratègia de proves i revisió de seguretat
independent. **PR:** pròpia, darrera de la fase.

### T8.7: Continuïtat de la conversa d'un tema

**Origen:** al pilot de T8.6 (17 i 18 de novembre de 2026), l'agent va perdre
el fil d'un tema. Cada tema ja té una sola sessió de Pi, i Pi conserva
l'historial entre torns. La sessió tenia forats per tres causes:

- El classificador rep només el missatge actual, sense historial. El text que
  respon una pregunta de l'agent, com els fets d'una notícia o una imatge per a
  la PR oberta, es classifica com a aclariment.
- Un aclariment respon amb un text fix i no executa Pi. El missatge no entra a
  l'historial, i al torn següent el model diu que no ha rebut aquella
  informació.
- Una continuació amb el worktree net es converteix en aclariment, encara que
  el tema tingui una PR oberta publicada pel servei. Els efectes que decideix el
  servei (PR creada, avís de CI, preview, merge i adjunt refusat) tampoc no
  arriben a la sessió.

**Abast:** aplicar els requisits de
[Continuïtat de la conversa (T8.7)](#continuïtat-de-la-conversa-t87): cada
missatge acceptat que no és `/merge` ni una preview arriba a la sessió de Pi
del tema. El torn següent rep els efectes del servei. El classificador rep el
context mínim del tema. Una continuació sense canvis locals reprèn la PR oberta
del mateix tema. **Exclusió:** no canvia la regla d'activació per menció o
resposta al bot, no desactiva el mode de privacitat del bot i no envia al model
la conversa del grup que no adreça el bot. Tampoc no canvia el camí determinista
de `/merge` ni de la preview. **Depèn de:** T8.4 i T8.5. **Resultat:** la
seqüència del pilot (petició, pregunta de l'agent, resposta amb els fets, PR i
imatge per a la PR) es completa sense repetir informació ni perdre el fil.
**Comprovació:** proves del servei amb Telegram, GitHub i model simulats i
repetició supervisada de la seqüència al VPS. **PR:** pròpia.

### T8.8: Experiència de les persones editores

**Origen:** al mateix pilot (17 i 18 de novembre de 2026), una persona no
tècnica del club no va poder completar la feina sense ajuda:

- Tota PR que afegeix una entrada en esborrany fa fallar la seva preview.
  `apps/web/e2e/posts.spec.ts` espera tres entrades exactes a la portada i cap
  secció d'esborranys, i el flux de preview l'executa en mode preview. La CI
  ordinària no executa aquell recorregut en mode preview, així que la CI queda
  verda i la preview falla després.
- El servei no llegeix el resultat del flux de preview. Espera fins al termini i
  informa que no ha pogut confirmar la preview. El rebuig per feina més nova
  nomena el commit informat com si fos el més nou.
- L'agent no llegeix l'estat de la PR, la CI ni la preview, i respon que no hi
  té accés o endevina l'URL.
- Les fotos comprimides de Telegram es refusen, el límit d'entrada és de 2 MB i
  l'adjunt només existeix durant un torn, així que la persona va enviar la
  mateixa imatge dues vegades. El model no veu la imatge, només en rep la ruta,
  i no pot escriure l'alt ni llegir el cartell.
- Les respostes i els avisos del servei són tècnics: rutes, camps YAML,
  recomptes de proves, ADR, commits, noms de branca i de comprovació.

**Abast:** aplicar els requisits d'[Experiència de les persones editores
(T8.8)](#experiència-de-les-persones-editores-t88) a la preview, l'estat del
tema, el llenguatge i els avisos, la publicació i les traduccions, i les
imatges. **Exclusió:** no canvia l'activació per menció o resposta, el camí
determinista de `/merge`, els permisos de GitHub, el desplegament a producció
ni l'aïllament de xarxa i credencials del sandbox. No afegeix ingesta d'imatges
per URL ni canvia el model configurat. **Depèn de:** T8.7. **Resultat:** una
persona no tècnica completa la seqüència del pilot (text d'una notícia, foto
corrent, preview i «publica-la») en un tema nou, sense respostes tècniques,
informació repetida ni una preview fallida. **Comprovació:** proves del servei
amb Telegram, GitHub i model simulats, E2E en mode preview i repetició
supervisada al VPS. **PR:** diverses, una per bloc (proves de preview, informe
de preview, to i avisos, imatges, estat del tema).

## Requisits específics

### Telegram, persones i sessions

- El grup és privat i d'invitació, amb temes de fòrum. Es preveuen tres persones
  inicials, sense codificar aquest nombre com a límit funcional.
- T8.1 concreta com s'inicia un tema i quins missatges activen el bot. No es dona
  per confirmat ni crear un tema automàtic per feina ni enviar tota la conversa
  del grup al model. Si el bot crea temes necessita `can_manage_topics`.
- Es prefereix long polling per evitar ports, domini i webhooks entrants nous.
  T8.2 en verifica la viabilitat amb el transport reutilitzat.
- Es conserva la relació `chat_id` i `message_thread_id` amb la sessió. No
  s'utilitzen cadenes de respostes com a substitut dels temes.
- Els membres comparteixen la sessió, no un compte humà anònim. Autoritzar per
  pertinença al grup exigeix verificar-la i retirar l'accés en perdre-la;
  errors de verificació no concedeixen permisos per defecte. L'ADR ha de
  definir les garanties de revocació i invalidació de dades en memòria cau.
- La invitació al grup concedeix capacitat d'encarregar canvis; només les
  persones administradores designades en gestionen l'accés. El text d'un
  missatge no pot canviar el grup autoritzat ni els límits del servei.
- Una sessió pot encadenar preguntes i feines. El servei no exigeix títols,
  formularis, estats de ticket ni una tasca formal abans d'atendre una consulta.
- Les instruccions d'una sessió es processen en ordre. Si es contradiuen sobre
  una mateixa acció, es demana aclariment sense descartar silenciosament una
  de les intencions.

### Context, branques i treball concurrent

- Per reprendre una feina, l'agent consulta la branca i PR referenciades, el
  diff, comentaris, CI i la descripció o especificació i ADR relacionats. Si hi
  falta informació rellevant, pregunta; no pressuposa disposar de tot
  l'historial d'un altre fil.
- No cal traspassar totes les converses entre sessions ni duplicar les
  especificacions en un registre de tasques propi. La PR conserva el context
  necessari de la feina i la validació. No es creen informes de verificació
  addicionals al repositori per defecte.
- Les implementacions noves utilitzen branques i worktrees independents. Una
  consulta pot llegir el projecte sense crear-los i una sessió pot canviar de
  feina sense perdre l'anterior.
- El servei identifica solapaments amb el treball actiu conegut i informa al
  fil actual dels fitxers afectats i, si existeix, la PR relacionada. L'avís
  de possible conflicte no bloqueja per si sol la feina.
- T8.2 defineix com dues sessions reprenen la mateixa branca sense compartir
  escriptures simultànies descontrolades. Es poden aïllar entorns o coordinar
  l'aplicació dels canvis; l'avís no equival a permís per sobreescriure'ls.
- Un conflicte real d'integració es resol preservant els canvis compatibles i
  demanant aclariment quan hi ha contradicció funcional. No s'oculta un
  conflicte ni es declara integrat un canvi que no ho està.
- Hi ha un límit configurable d'execucions simultànies i recursos, amb espera
  quan se supera. T8.1 concreta concurrència, cua i comportament en superar un
  límit; T8.2 fixa els valors de temps i recursos després d'avaluar el runtime i
  el VPS. Això no és un bloqueig funcional
  per compartir fitxers i no limita el nombre de sessions obertes al nombre
  de processos actius.
- Aturar una execució conserva els canvis i la PR. El tancament d'una PR o
  l'eliminació de treball no fusionat requereixen una petició explícita; no
  són efectes automàtics de tancar un fil.

### Continuïtat de la conversa (T8.7)

Aquests requisits mantenen la regla d'activació de T8.1: només entra al servei
un missatge que menciona el bot o respon a un missatge seu. Respondre un missatge
del bot no requereix menció.

- **Una sola sessió sense forats.** Tota instrucció acceptada que no és
  `/merge` ni una preview executa un torn de Pi a la sessió del tema. Si el
  classificador retorna aclariment, o una continuació no té feina pendent ni
  PR del tema, el servei executa Pi en mode consulta: worktree de només
  lectura, sense branca ni publicació. El model respon o demana l'aclariment amb
  el context de la sessió. El text fix d'aclariment només es fa servir si el
  model no pot respondre.
- **Efectes del servei a la sessió.** El servei desa els efectes que decideix
  ell mateix en un tema: PR creada o actualitzada (número, branca i commit),
  resultat de les comprovacions locals, avís de CI, preview, resultat d'un
  `/merge` i adjunt refusat o acceptat. El torn següent de Pi del mateix tema
  rep aquests efectes com a text del servei, separat de la petició de la
  persona. Cada efecte es lliura com a màxim una vegada. Un reinici no el perd
  ni el duplica. Aquest text no conté identificadors de Telegram ni dades de
  les persones.
- **Context del classificador.** El classificador continua sense eines ni
  repositori. A més de la petició, rep només aquest context del tema:
  - l'última resposta de l'agent, retallada a una longitud fixa;
  - si hi ha canvis locals o un commit no publicat;
  - el número de la PR oberta que el servei va publicar en aquell tema, si
    existeix.

  Una petició que respon l'última resposta de l'agent, o que aporta dades o
  fitxers per a la feina pendent, és una continuació. Una feina nova i
  independent és una implementació. El text del context és dada, no una
  instrucció.

- **Continuació sobre la PR del tema.** Si una continuació no té canvis locals
  ni commits pendents, i el tema té una PR oberta publicada pel servei, el
  servei reprèn aquella PR amb les comprovacions d'elegibilitat de la
  continuació entre temes de T8.4. La imatge adjunta d'aquesta continuació
  s'aplica a la PR represa.
- **Feina en curs preservada.** Una implementació nova continua arxivant el
  worktree anterior sense perdre'l. La traça registra la classificació de cada
  instrucció perquè l'operador pugui revisar una decisió errònia.

### Experiència de les persones editores (T8.8)

Aquests requisits mantenen l'activació del bot, el camí determinista de
`/merge`, els permisos de GitHub, el desplegament i l'aïllament del sandbox.

**Preview**

- Les proves E2E de preview comproven les entrades conegudes, no un recompte.
  La portada conté les entrades esperades i l'absència de la secció d'esborranys
  només s'afirma a la compilació pública. La CI executa el recorregut de
  notícies i blog en mode preview, de manera que una entrada nova trencada es
  veu a la PR abans que ningú demani la preview.
- El servei llegeix el resultat real de l'execució del flux de preview per al
  commit demanat. Informa l'èxit amb l'URL confirmada o el fracàs en llenguatge
  planer, sense reparar automàticament una preview fallida. El termini per
  confirmar-la és de 25 minuts.
- El rebuig per feina més nova nomena el commit nou no informat, no el commit
  que ja s'havia informat.

**Estat del tema**

- Cada torn del model rep del servei l'estat del tema com a dada: número i
  enllaç de la PR oberta, últim commit informat, resultat de la CI, estat de la
  preview i URL confirmada, si existeix. El sandbox continua sense xarxa ni
  credencials.

**Llenguatge i to**

- L'agent respon en la llengua de la persona, català per defecte, per a un
  públic no tècnic: frases curtes i paraules planeres, sense rutes, noms de
  fitxer, camps YAML, ordres, recomptes de proves, commits ni referències a ADR,
  tret que la persona demani detall tècnic.
- Redacta amb els fets que té i fa com a màxim una pregunta quan en falta un
  d'essencial. No fa una llista de preguntes.
- Sempre dona l'enllaç de la preview quan n'hi ha. L'enllaç de la PR apareix
  només com a darrera línia, amb la forma «Enllaç per a revisió: …».
- Avisos automàtics: un quan el canvi està a punt, amb la publicació i les
  comprovacions en verd, que convida a demanar la preview, i un de clar quan una
  cosa falla. No hi ha avisos separats per a la PR actualitzada, l'inici del
  seguiment de la CI i les comprovacions en verd. Els noms de branca, commit i
  comprovació queden a la traça privada i a la PR, no al tema.
- El model emet la línia de resum pública només quan el torn ha canviat fitxers.

**Publicació i traduccions**

- Una entrada és sempre un esborrany per defecte. Qualsevol membre verificat del
  grup pot demanar-ne la publicació amb «publica-la»: l'agent la marca com a
  publicada i hi posa la data i l'hora de la petició com a instant de
  publicació. Aquesta petició és l'aprovació editorial d'aquella entrada, i el
  merge continua sent humà, amb les regles de `/merge`.
- La [guia editorial](../editorial/guide.md) reserva avui l'aprovació de la
  publicació a la persona mantenidora, i l'[ADR 0011](../decisions/0011-news-blog-editorial-previews.md)
  li encarrega la revisió dels continguts. La implementació de T8.8 actualitza
  la guia i proposa l'esmena de l'ADR; aquesta revisió no toca cap dels dos
  documents.
- Les variants en castellà i anglès s'escriuen només quan algú les demana.

**Imatges**

- Els límits d'entrada, la reducció, la neteja de metadades, els drets, la
  retenció, l'àlbum, el cartell vertical i l'entrada d'imatge al model són a
  [Codi, contingut i adjunts](#codi-contingut-i-adjunts), actualitzat per
  aquesta unitat.

### Entorn i permisos de desenvolupament

- El servei té usuari i unitat propis al VPS; el runtime s'executa en un
  contenidor o unitat endurida segons T8.2. No comparteix permisos amb releases,
  Caddy, ACME, logs ni secrets de producció.
- Les escriptures s'acoten als worktrees i a l'estat, caches i dependències de
  desenvolupament necessaris. No es munta el socket Docker del host ni cap
  recurs que permeti escapar de l'aïllament.
- Es permeten terminal i eines per llegir, modificar i provar el projecte.
  Scripts, hooks, instal·lacions i proves del repositori són codi executable
  no fiable i han de quedar dins de la mateixa frontera d'aïllament.
- El perfil carrega `AGENTS.md`, instruccions, documentació i skills aplicables,
  sense mantenir còpies divergents de les convencions. La confiança i càrrega
  no interactiva no han de permetre que el repositori s'atorgui permisos nous.
- T8.2 defineix l'accés de xarxa necessari per al model, dependències, GitHub i
  proves, sense accés lateral a serveis privats del VPS. MCP no és obligatori;
  qualsevol connector afegit necessita justificació i permisos acotats.
- Els canvis de configuració del mateix servei, credencials o permisos no
  s'apliquen des d'una conversa. Preparar una proposta de codi no dona permís
  per instal·lar-la, activar-la o modificar infraestructura remota.

### Codi, contingut i adjunts

- El codi estable i el contingut segueixen les convencions del projecte i els
  ADR. L'ampliació no converteix YAML en un constructor de pàgines ni permet
  canvis fora de la petició.
- Els canvis de contingut segueixen la guia editorial, les validacions Zod i
  els requisits de traducció. No s'inventen fets ni s'utilitza fallback per
  donar per completa una variant incompleta.
- Els adjunts s'accepten des de Telegram amb validació de tipus real, extensió,
  mida i destinació. S'accepten les fotos comprimides de Telegram i els fitxers
  d'imatge. El límit d'entrada és de 20 MB, el màxim de descàrrega de Telegram,
  i l'agent avisa quan la imatge és més petita que la portada recomanada.
- El servei redueix la imatge desada a 2.400 píxels del costat llarg i n'elimina
  les metadades EXIF i la geolocalització. Es manté el pressupost de 300 KiB per
  variant generada pel build. Els cartells verticals es mostren sencers, sense
  retallar ni deformar.
- Un adjunt continua disponible per al seu tema fins que s'utilitza o durant 7
  dies. Cada missatge pot portar fins a 5 imatges, com un àlbum. Amb diverses
  imatges, la persona diu on va cada una, a la portada o a una secció; si no ho
  diu, l'agent fa una pregunta. El model de contingut admet una portada i fins a
  deu imatges per secció.
- El model rep la imatge com a entrada d'imatge, perquè el model configurat
  accepta imatges. Escriu l'alt a partir del que veu i comprova el text del
  cartell amb l'entrada. Una eina li permet tornar a mirar un adjunt desat del
  seu tema.
- Drets: una imatge que envia un membre verificat sense cap indicació més és del
  club, amb el crèdit «Mountain Runners», i queda registrada a la PR. L'agent
  pregunta només quan la imatge sembla de tercers, com un logotip, una foto de
  premsa o el crèdit d'una altra autoria. L'origen i els drets queden revisables
  a la PR sense publicar consentiments personals, i els consentiments no
  s'emmagatzemen mai al repositori. No s'incorporen captures amb dades personals
  o financeres sense sanititzar. La ingesta automàtica d'imatges per URL queda
  fora d'abast.
- La implementació de T8.8 actualitza els límits d'adjunts de
  `docs/deployment.md` i `docs/runbook.md`, que encara descriuen el límit
  anterior.

### Git, comprovacions, PR i preview

- L'agent executa les comprovacions locals mínimes que detecten la regressió i
  les exigides pel projecte, inclosos els recorreguts E2E modificats. No es
  torna al perfil editorial que delegava tota validació a la CI.
- La petició clara d'implementació autoritza commit, push i PR dins de l'abast.
  Commits i títols segueixen Conventional Commits; les descripcions de PR són
  en català i recullen objectiu, canvis, referències i validació real.
- Les operacions de GitHub utilitzen una integració reutilitzada o pròpia amb
  permisos mínims; no s'imposa un procés publicador separat si no cal. Secrets
  i tokens no entren al prompt, a les sortides d'eines ni a Git.
- Abans d'activar l'escriptura del pilot, es verifica que el servei pot fer push
  a una branca, obrir una PR i executar el merge demanat, però que no pot
  activar auto-merge, modificar proteccions, fer push a `main` ni fusionar fora
  del camí determinista. Com que `rboixaderg` és un compte
  administrador compartit amb la persona mantenidora, cal provar la separació
  tècnica de la credencial i de les operacions disponibles al servei; el rol
  del compte per si sol no distingeix l'agent. T8.4 completa les comprovacions
  d'actualització, comentaris i CI. Una prohibició al prompt no substitueix les
  proteccions ni la prova negativa. Les comprovacions de permisos es dissenyen
  sense fusionar cap PR ni fer push a `main`; el primer merge real del pilot
  requereix autorització explícita i queda registrat a la traça.
- Les fallades locals o de CI relacionades amb la feina es poden reparar dins
  de l'abast, inclòs el codi. T8.1 fixa els límits de reintents i el comportament
  en superar els límits d'execució; T8.2 fixa els valors de temps i recursos. Un
  error fora de l'abast o un límit assolit es comunica, sense bucles infinits
  ni canvis especulatius per posar la CI en verd.
- Una CI vermella no activa preview. Amb CI verda i una petició explícita al
  fil d'un membre verificat del grup, l'agent comenta `/preview` amb el seu
  compte de GitHub pel flux de la fase 6. No cal una llista separada de permisos
  de preview ni vincular cada persona a un compte de GitHub. L'agent retorna
  l'URL i el SHA del publicador de confiança, mai una URL construïda o un estat
  suposat. Sense petició explícita no comenta `/preview`.
- El merge és una acció humana executada pel servei. Un membre verificat el
  demana al fil amb `/merge` (opcionalment `/merge <PR>`) després de validar el
  resultat; el servei resol la PR de l'últim avís verd del fil, i si no pot
  resoldre-ho sense ambigüitat pregunta i no fusiona. Comprova la pertinença, que el cap actual de la PR sigui el commit que ha
  informat a aquell fil, i que totes les comprovacions obligatòries estiguin en
  verd i al dia, i només llavors fusiona sense bypass d'administrador. La
  persona no ha de conèixer el SHA: el fixa el servei amb la resposta de GitHub,
  i qualsevol commit posterior obliga a una validació nova. No existeix
  auto-merge ni merge per prosa, i l'entorn aïllat no pot invocar l'API de
  GitHub.
- Reinicis, updates duplicats i reintents no dupliquen commits, PR, comentaris
  ni merges. Abans de repetir una acció externa amb resultat desconegut,
  s'inspecciona l'estat real de Git i GitHub.

## Estratègia de tests i qualitat

Se segueix [l'estratègia de proves](../testing-strategy.md), amb proves
unitàries per regles i proves operatives per fronteres del servei. Es
reutilitzen les proves de la solució adoptada quan demostren el contracte i
s'afegeixen les mancances del pont sense duplicar suites senceres.

- Autorització: membre, persona expulsada, altre grup, missatge privat,
  identitat no verificable i missatge amb autoria no atribuïble. Revocació
  efectiva sense cancel·lar implícitament el treball compartit existent.
- Sessions: dos autors en un tema, temes separats, ordre de missatges,
  deduplicació, reinici i pregunta/resposta al mateix fil.
- Continuïtat (T8.7): un aclariment executa Pi en mode consulta a la sessió del
  tema; una resposta amb dades després d'una pregunta de l'agent arriba al
  model; els efectes del servei arriben una sola vegada al torn següent, també
  després d'un reinici; una continuació sense canvis locals reprèn la PR oberta
  del tema; el classificador rep el context acotat i el tracta com a dada.
- Experiència d'edició (T8.8): el recorregut de notícies i blog en mode preview
  amb una entrada nova comprova entrades conegudes i deixa l'absència
  d'esborranys a la compilació pública; l'informe de preview confirma l'URL
  real, fracassa en llenguatge planer i respecta el termini; el rebuig per feina
  més nova nomena el commit nou. També: estat del tema a cada torn, llengua i
  to, com a màxim una pregunta, enllaços de preview i de revisió, avisos únics,
  publicació per petició amb la data de la petició i traduccions només
  demanades.
- Consulta sense canvis, dues feines successives en una sessió i represa de PR
  des d'una altra amb codi i context correctes.
- Solapaments: avís sense bloqueig, worktrees separats, continuació de la
  mateixa branca sense sobreescriptura i conflicte funcional amb aclariment.
- Entorn: edició i terminal dins del projecte, scripts i hooks no fiables,
  intents d'escapada per paths o symlinks, secrets i fitxers del host
  inaccessibles. Els controls no depenen del criteri d'un model real.
- Adjunts: tipus fals, límits, metadades, path traversal i rebuig d'imatges no
  admeses; foto comprimida acceptada, avís per sota de la portada recomanada,
  drets per defecte del club, retenció de l'adjunt, àlbum amb destinació per
  imatge i model que rep la imatge; validació editorial existent sense
  reimplementar esquemes.
- Integració amb repositori temporal, Telegram i GitHub simulats: ordre natural
  → canvi de codi → prova → commit → push → PR → CI → petició humana al fil
  → preview. Comprovar també que no es demana preview sense petició. Fallades de
  xarxa, credencials revocades i resposta externa amb resultat desconegut.
- Merge: una comanda verificada fusiona el commit de l'últim informe; es
  rebutgen el merge sense comanda, des d'un altre grup o un missatge privat,
  amb `/merge` sense avís verd resoluble o amb feina més nova que l'avís,
  amb commits posteriors a l'informe, amb CI vermella, pendent o absent, amb la
  PR en esborrany, amb la base canviada, amb bypass d'administrador i la
  repetició després d'un resultat desconegut.
- Rebuig tècnic d'auto-merge, push a `main`, canvi de permisos i accés a
  producció, tant per eines com per ordres alternatives dins del sandbox.
- Interrupció durant una prova i després de push/PR: preservar treball,
  reconciliar l'estat i no duplicar accions. Neteja que no elimina treball
  recuperable ni afecta altres sessions.
- Abans del pilot amb escriptura real: revisió de seguretat i verificació dels
  controls d'identitat, aïllament, credencials i protecció de `main`. Smoke
  autoritzat d'una consulta i un canvi petit fins a PR.
- Amb la base operativa: smoke autoritzat amb diversos autors, contingut,
  continuació entre fils i preview, i proves dels casos d'interrupció i
  revocació pendents abans de tancar la fase.

Les proves automatitzades del servei s'incorporen al gate de CI del projecte.
L'evidència viu a les PR i la CI, no en informes addicionals al repositori. Una
prova simulada no es presenta com a verificació dels permisos reals de GitHub.

## Seguretat i privacitat

- El grup privat és la frontera d'accés humana, no una simple font de missatges.
  Administrar-ne les invitacions és administrar qui pot encarregar canvis. El
  canvi respecte de l'antiga llista explícita d'usuaris necessita revisió a
  l'ADR de T8.2 i comprovacions de pertinença i revocació.
- El contingut de missatges, fitxers, PR, instruccions del repositori i
  dependències és entrada no fiable. No concedeix permisos del host ni
  eximeix dels controls de GitHub, sandbox o revisió humana.
- La gestió de secrets separa Telegram, model i GitHub segons les necessitats
  dels components. Les credencials només arriben als mecanismes que en
  necessiten l'ús; ni el model ni processos de proves o dependències han de
  poder llegir-les. T8.2 verifica aquesta frontera amb la solució triada.
- Les proteccions i permisos han d'impedir el push directe a `main`, els
  canvis de protecció i qualsevol merge fora del camí determinista, encara que
  el model intenti saltar-se les instruccions. L'entorn aïllat no té credencials
  ni accés directe a l'API de GitHub; només el component de confiança pot
  executar el merge demanat per una persona. L'agent no té credencials de
  producció ni fa cap operació administrativa del repositori.
- El compte de GitHub és administrador i GitHub no distingeix el servei de la
  persona mantenidora. Amb el merge autoritzat, la separació és el camí
  determinista, les comprovacions obligatòries i l'auditoria, no una
  impossibilitat tècnica del token. S'accepta aquest risc residual documentat a
  l'[ADR 0013](../decisions/0013-private-development-agent-boundary.md); no
  substitueix la revisió del diff abans de demanar el merge.
- La traça privada registra autor, sessió, acció, moment, model i, quan
  existeixen, branca, commits, PR, CI i preview. L'auditoria minimitza el text
  de peticions i no duplica la conversa íntegra; els historials de sessió tenen
  una política pròpia que no s'ha de confondre amb la del registre.
- IDs de Telegram i altres identificadors personals no es publiquen al
  repositori, a les PR ni als logs de CI. El compte compartit de GitHub no
  identifica la persona que ha demanat el canvi.
- T8.1 revisa les dades enviades al proveïdor del model i T8.2 en fixa retenció,
  accés, backups i esborrat, sense assumir retenció indefinida ni telemetria
  acceptable per defecte.
- Rotació i revocació de credencials, aturada d'emergència i restauració queden
  provades i documentades. L'aturada del servei no altera web ni previews.

## Fora d'abast

- Auto-merge, push directe a `main`, canvi de proteccions i desplegament
  directe a producció. El merge només entra a l'abast amb una petició
  verificada, mai automàtic.
- Administració del VPS, canvis remots de Caddy, releases, DNS o infraestructura
  i accés a secrets o logs de producció des de l'agent.
- El futur xat públic, el seu índex o credencials compartides amb aquest servei.
- WhatsApp, Discord, altres canals, una web pròpia o una plataforma multicanal
  inicial. Tampoc es construeix un CMS ni un gestor de tickets.
- Una estructura obligatòria de petició o una correspondència tema/tasca/PR
  única. No es força un procés editorial per poder preguntar sobre el codi.
- Execució arbitrària fora del sandbox, connectors sense justificar i ampliació
  de permisos del servei des del xat.
- Publicar contingut sense la petició d'un membre verificat, eliminar les
  validacions i revisions editorials o saltar-se el merge humà; ingesta
  automàtica d'imatges per URL.
- Pressupostos de tokens o facturació addicional, terminis de retenció inventats
  abans d'avaluar l'eina i memòria autònoma obligatòria.

## Criteris d'acceptació

1. Les vuit unitats tenen PR revisada, validada i fusionada en ordre de
   dependències. L'ADR i les esmenes de fronteres s'han aprovat abans
   d'habilitar els permisos ampliats.
2. Qualsevol membre del grup autoritzat pot consultar i encarregar canvis; una
   persona expulsada, un altre grup o un missatge privat no poden fer-ho.
   Cada instrucció queda atribuïda al seu autor sense publicar-ne dades.
3. Un tema és una sessió compartida: dos autors hi conversen, una consulta no
   crea una branca ni una tasca formal i després pot encadenar feines diferents.
4. Una feina iniciada en un fil es reprèn en un altre amb branca/PR,
   descripció, especificació i ADR; l'agent pregunta pel context que hi falti i
   preserva els canvis existents.
5. Els solapaments coneguts generen un avís amb els fitxers i la feina
   relacionada sense bloquejar només per coincidència. Les execucions no
   sobreescriuen treball aliè ni comparteixen escriptures descontrolades.
6. Una ordre natural d'implementació produeix canvis de codi o contingut,
   comprovacions pertinents, commit, push i PR sense confirmacions intermèdies,
   dins de l'abast i amb descripció i evidència revisables.
7. El servei fusiona només amb la petició explícita d'un membre verificat, el
   commit informat al fil i les comprovacions obligatòries en verd, i supera les
   proves negatives de merge sense comanda, sense avís verd resoluble, amb
   feina més nova que l'avís, amb commits posteriors a l'informe, CI vermella o pendent,
   auto-merge, push a `main`, escapada del sandbox i accés a producció. No
   n'hi ha prou amb regles del prompt. Només el pipeline protegit desplega.
8. Sense petició explícita al fil o amb CI vermella, l'agent no demana preview.
   Amb CI verda i la petició d'un membre verificat, comenta `/preview` amb el
   seu compte i retorna l'URL i el SHA confirmats pel publicador de la fase 6.
   Es poden reparar errors de codi
   relacionats dins dels límits aprovats, sense bucles indefinits.
9. Un reinici recupera sessions i estat del treball sense duplicar commits, PR
   o comentaris. Aturar una execució preserva la PR i el treball recuperable.
10. El contingut i els adjunts compleixen les regles editorials, de recursos,
    idiomes, metadades i publicació vigents.
11. El runbook identifica el runtime pinjat, model, permisos, límits, retenció,
    revocació, aturada, backups i restauració provats, sense afectar producció.
12. Dins d'un tema, cada missatge acceptat que no és `/merge` ni una preview
    arriba a la sessió de Pi. El model coneix els efectes del servei del torn
    anterior, i una resposta a la seva pregunta continua la feina pendent o la
    PR oberta del tema sense que la persona repeteixi la informació.
13. Una persona no tècnica completa en un tema nou la seqüència del pilot (text
    d'una notícia, foto corrent, preview i «publica-la») sense respostes
    tècniques, informació repetida ni una preview fallida. L'informe de preview
    confirma l'URL real o fracassa en llenguatge planer, el model rep l'estat
    del tema i la imatge, i la publicació per petició manté el merge humà.
