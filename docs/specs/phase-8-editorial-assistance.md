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
  intermèdies. El merge és exclusivament humà.
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
T8.2 ha de proposar i obtenir l'aprovació de l'ADR que les esmeni abans de
l'activació dels permisos nous. La separació del xat públic de l'ADR 0002 i la
revisió humana i protecció de producció de l'ADR 0003 es mantenen. T8.2 també
ha de revisar la delegació de la petició de preview respecte de l'[ADR 0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md)
i obtenir l'aprovació de l'esmena necessària abans d'activar-la.

Cap unitat passa a `En curs` fins que la PR de l'especificació es revisi i
fusioni. Aquesta planificació no autoritza crear comptes, credencials ni
modificar configuració remota.

## Objectiu

Disposar d'un agent privat de desenvolupament i consulta al VPS, accessible des
de sessions compartides de Telegram, que entengui el projecte i prepari canvis
de codi o contingut fins a una PR revisable i la seva preview. La conversa no
és un gestor de tasques: el treball es conserva a Git i a les seves
especificacions i decisions, amb atribució humana privada i sense merge ni
desplegament directe per part de l'agent.

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
- Els commits, el push i les PR utilitzen un compte de GitHub dedicat de
  `mountain-runners`. El compte identifica l'agent; no substitueix l'atribució
  privada de qui demana cada acció. Cap autor aprova la seva pròpia PR.
- L'agent no fusiona, no activa auto-merge, no fa push directe a `main` i no
  desplega directament. Només una PR revisada i fusionada per una persona pot
  arribar a producció pel pipeline protegit ([ADR 0003](../decisions/0003-agent-workflow-and-security.md)).
- Les comprovacions locals segueixen `AGENTS.md` i
  [l'estratègia de proves](../testing-strategy.md); la CI continua sent un gate
  independent. Una persona del grup demana la preview al fil; l'agent utilitza
  el compte de GitHub dedicat i el flux aprovat de la fase 6. No es demana amb
  CI vermella ni sense la petició explícita de la persona.
- El contingut continua subjecte als esquemes i la
  [guia editorial](../editorial/guide.md): nou contingut en esborrany,
  correccions que preserven l'estat publicat i traduccions completes en els
  idiomes afectats. Ampliar l'accés al codi no autoritza saltar-se la revisió
  editorial ni publicar des del xat.
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
- Els intents de merge, accés a producció o sortida del sandbox es rebutgen amb
  controls tècnics independents del model.

## Dependències i ordre d'inici

La fase s'avança a la fase 7. Depèn del VPS i flux de producció de la fase 5,
de les previews de la fase 6 i dels contractes de contingut i guia editorial
existents, inclòs el flux de notícies i blog de la
[PR #140](https://github.com/rboixaderg/mountain-runners/pull/140).

T8.1 concreta els requisits operatius i les amenaces sense reobrir les decisions
funcionals confirmades. T8.2 compara runtimes i integracions, verifica la
viabilitat i proposa l'ADR d'ampliació de permisos i les esmenes documentals.
T8.3 connecta Telegram amb sessions i entorns de desenvolupament. T8.4 integra
Git, PR, CI i preview. T8.5 completa l'auditoria, revocació i recuperació
operativa. T8.6 valida el conjunt i el runbook.

Cada unitat d'implementació utilitza un worktree i una branca propis des de
l'últim `main` i té PR dedicada. L'alta del bot, del grup, del compte de GitHub i
de les credencials requereix aprovació explícita. L'ADR i els controls de T8.2
són prerequisits per habilitar la nova capacitat d'escriptura del servei.

## Tasques, entregues i seguiment

| Unitat                                               | Estat   | Dependències | Resultat verificable                              | PR  |
| ---------------------------------------------------- | ------- | ------------ | ------------------------------------------------- | --- |
| T8.1 Requisits, sessions, identitats i amenaces      | Pendent | Fases 5 i 6  | Contracte operatiu i riscos revisats              | -   |
| T8.2 Avaluació, runtime, permisos i ADR              | Pendent | T8.1         | Solució mínima verificada i frontera aprovada     | -   |
| T8.3 Telegram, sessions i entorns de desenvolupament | Pendent | T8.2         | Consultes i canvis locals en sessions compartides | -   |
| T8.4 Git, pull requests, CI i preview                | Pendent | T8.3         | PR autònoma i preview demanada per una persona    | -   |
| T8.5 Auditoria, revocació i recuperació              | Pendent | T8.3         | Atribució, continuïtat i aturada verificades      | -   |
| T8.6 Validació integral i runbook                    | Pendent | T8.4, T8.5   | Servei operable sense accés a producció           | -   |

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

### T8.2: Avaluació, runtime, permisos i ADR

**Abast:** comparar reutilització i codi propi segons l'esforç total de
manteniment; verificar sessions, terminal i proves aïllades, represa entre
fils, progrés, interrupció i integració amb GitHub. Fixar versions, llicències,
model, aïllament, persistència, credencials, permisos, rotació, xarxa i límits.
Proposar l'ADR per ampliar l'agent de contingut a desenvolupament, autoritzar per
pertinença al grup i delegar el flux fins a PR. Revisar l'ADR 0009 i proposar
l'esmena necessària per delegar a l'agent la petició de preview feta al fil.
El flux actual de GitHub verifica el compte que comenta, no la persona de
Telegram. Alinear `AGENTS.md`,
`docs/ai-assistant.md` i `docs/architecture.md` quan s'aprovi la frontera, sense
alterar el xat públic ni la revisió humana. **Exclusió:** no desplega el servei
ni crea credencials de producció; la prova acotada només usa entorns i comptes
de prova autoritzats explícitament. **Depèn de:** T8.1. **Resultat:** elecció
justificada, prova reproduïble i ADR aprovat abans d'habilitar permisos nous.
**Comprovació:** demostrar consulta compartida, canvi de codi amb prova, PR,
represa des d'un altre fil i rebuig de merge i accés a producció. **PR:** pròpia.

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

La prova ha d'incloure dos usuaris en un fil, una consulta sense branca nova,
una implementació de codi, una feina de contingut, una continuació de PR des
d'un altre fil, solapaments no bloquejants i una interrupció després d'una
acció externa. Cal distingir recuperar l'historial de recuperar una execució.
Es tria la solució més senzilla que superi aquests casos, sense construir una
interfície web ni un gestor de tasques per defecte.

La retenció es decideix segons les capacitats verificades: què es desa, on,
qui ho consulta i com s'esborra, inclosos backups. No es fixa ara un termini ni
una conservació indefinida. Engram o una altra memòria són opcionals; no
substitueixen el codi, PR, especificacions i ADR ni s'exigeix una base de tasques.

### T8.3: Telegram, sessions i entorns de desenvolupament

**Abast:** implementar o configurar el pont reutilitzat; comprovar grup i
membres, atribuir i deduplicar missatges, associar temes i sessions i processar
instruccions en ordre. Carregar les regles i skills del projecte i preparar
entorns per consultar, modificar i provar codi o contingut. Separar sessions
de feines i worktrees; mostrar avisos de solapament sense bloquejar i preservar
els canvis aliens. Incorporar adjunts amb les validacions previstes.
**Exclusió:** no fa push ni PR abans de T8.4; no administra el host ni exposa
secrets de producció. **Depèn de:** T8.2. **Resultat:** consultes compartides i
canvis locals comprovables, sense una relació obligatòria tema/tasca/PR.
**Comprovació:** proves de routing, autorització, consulta sense canvis,
terminal aïllada, adjunts i solapaments. **PR:** pròpia.

### T8.4: Git, pull requests, CI i preview

**Abast:** habilitar commit, push a branques i creació o actualització de PR
amb la identitat de l'agent, comprovacions locals pertinents, seguiment i
reparació acotada de CI i, quan una persona ho demana al fil, petició de
preview i retorn d'URL i SHA confirmats.
Recuperar una branca/PR existent des d'una altra sessió i actualitzar el seu
context revisable. Reutilitzar les integracions viables, sense exigir un
publicador propi. **Exclusió:** no fusiona, activa auto-merge, fa push a `main`
ni desplega; aturar una execució no tanca automàticament la PR. **Depèn de:**
T8.3. **Resultat:** una petició natural d'implementació arriba a PR sense
confirmacions intermèdies; la preview requereix una petició explícita al fil.
**Comprovació:** dues sessions sobre una PR, absència de petició automàtica,
CI vermella sense preview, idempotència i rebuig de merge. **PR:** pròpia.

### T8.5: Auditoria, revocació i recuperació

**Abast:** completar el registre privat d'autors i accions, consulta de la
traça, comprovació de revocació per sortida o expulsió del grup i recuperació
segura després d'un reinici. Aplicar la retenció decidida a T8.2 i la neteja que
preserva treball no fusionat. Provar l'aturada i la rotació de credencials.
**Exclusió:** no publica identitats a GitHub ni esborra worktrees només perquè
s'acabi una conversa. **Depèn de:** T8.3. **Resultat:** atribució i continuïtat
verificables sense duplicar efectes externs. **Comprovació:** reinici, revocació,
minimització, recuperació i aturada sense afectar la web. **PR:** pròpia.

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
  quan se supera. T8.1 en concreta el valor. Això no és un bloqueig funcional
  per compartir fitxers i no limita el nombre de sessions obertes al nombre
  de processos actius.
- Aturar una execució conserva els canvis i la PR. El tancament d'una PR o
  l'eliminació de treball no fusionat requereixen una petició explícita; no
  són efectes automàtics de tancar un fil.

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
  mida i destinació. Les imatges mantenen el límit inicial de 10 MB d'entrada i
  4.000 píxels de costat llarg, eliminació d'EXIF i geolocalització i pressupost
  de 300 KiB per variant generada pel build.
- Els originals de portada s'envien com a fitxer, no com a foto comprimida.
  L'origen i els drets queden revisables a la PR sense publicar consentiments
  personals. No s'incorporen captures amb dades personals o financeres sense
  sanititzar. La ingesta automàtica d'imatges per URL queda fora d'abast.

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
- T8.2 verifica que l'agent pot fer push a branques de treball, obrir i
  actualitzar PR, comentar i llegir CI, però no pot fusionar, activar
  auto-merge, modificar proteccions ni fer push a `main`. No es considera
  suficient una prohibició al prompt ni es dona per segura una combinació de
  credencials sense prova negativa efectiva.
- Les fallades locals o de CI relacionades amb la feina es poden reparar dins
  de l'abast, inclòs el codi. T8.1 fixa els límits de reintents i d'execució;
  no s'hereta com a requisit confirmat el màxim editorial de dos intents. Un
  error fora de l'abast o un límit assolit es comunica, sense bucles infinits
  ni canvis especulatius per posar la CI en verd.
- Una CI vermella no activa preview. Amb CI verda i una petició explícita al
  fil d'un membre verificat del grup, l'agent comenta `/preview` amb el seu
  compte de GitHub pel flux de la fase 6. No cal una llista separada de permisos
  de preview ni vincular cada persona a un compte de GitHub. L'agent retorna
  l'URL i el SHA del publicador de confiança, mai una URL construïda o un estat
  suposat. Sense petició explícita no comenta `/preview`.
- Reinicis, updates duplicats i reintents no dupliquen commits, PR ni
  comentaris. Abans de repetir una acció externa amb resultat desconegut,
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
- Consulta sense canvis, dues feines successives en una sessió i represa de PR
  des d'una altra amb codi i context correctes.
- Solapaments: avís sense bloqueig, worktrees separats, continuació de la
  mateixa branca sense sobreescriptura i conflicte funcional amb aclariment.
- Entorn: edició i terminal dins del projecte, scripts i hooks no fiables,
  intents d'escapada per paths o symlinks, secrets i fitxers del host
  inaccessibles. Els controls no depenen del criteri d'un model real.
- Adjunts: tipus fals, límits, metadades, path traversal i rebuig d'imatges no
  admeses; validació editorial existent sense reimplementar esquemes.
- Integració amb repositori temporal, Telegram i GitHub simulats: ordre natural
  → canvi de codi → prova → commit → push → PR → CI → petició humana al fil
  → preview. Comprovar també que no es demana preview sense petició. Fallades de
  xarxa, credencials revocades i resposta externa amb resultat desconegut.
- Rebuig tècnic de merge, auto-merge, push a `main`, canvi de permisos i accés a
  producció, tant per eines com per ordres alternatives dins del sandbox.
- Interrupció durant una prova i després de push/PR: preservar treball,
  reconciliar l'estat i no duplicar accions. Neteja que no elimina treball
  recuperable ni afecta altres sessions.
- Smoke real autoritzat amb diversos autors, canvi de codi i contingut,
  continuació entre fils i preview; revisió de seguretat abans de donar
  permisos d'escriptura reals al servei.

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
- Les proteccions i permisos han d'impedir merge i push directe encara que el
  model intenti saltar-se les instruccions. L'agent no té credencials de
  producció ni permisos administratius de GitHub.
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

- Merge, auto-merge, push directe a `main` i desplegament directe a producció.
- Administració del VPS, canvis remots de Caddy, releases, DNS o infraestructura
  i accés a secrets o logs de producció des de l'agent.
- El futur xat públic, el seu índex o credencials compartides amb aquest servei.
- WhatsApp, Discord, altres canals, una web pròpia o una plataforma multicanal
  inicial. Tampoc es construeix un CMS ni un gestor de tickets.
- Una estructura obligatòria de petició o una correspondència tema/tasca/PR
  única. No es força un procés editorial per poder preguntar sobre el codi.
- Execució arbitrària fora del sandbox, connectors sense justificar i ampliació
  de permisos del servei des del xat.
- Publicar contingut des de la conversa o eliminar les validacions i revisions
  editorials; ingesta automàtica d'imatges per URL.
- Pressupostos de tokens o facturació addicional, terminis de retenció inventats
  abans d'avaluar l'eina i memòria autònoma obligatòria.

## Criteris d'acceptació

1. Les sis unitats tenen PR revisada, validada i fusionada en ordre de
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
7. El servei supera proves negatives de merge, auto-merge, push a `main`,
   escapada del sandbox i accés a producció. No n'hi ha prou amb regles del
   prompt. Només una persona fusiona i el pipeline protegit desplega.
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
