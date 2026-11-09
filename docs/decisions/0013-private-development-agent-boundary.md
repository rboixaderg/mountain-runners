# ADR 0013: Frontera de l'agent privat de desenvolupament

## Estat

Acceptada el 8 de novembre de 2026 amb el merge de la [PR #182](https://github.com/rboixaderg/mountain-runners/pull/182) a la T8.2 de la [fase 8](../specs/phase-8-editorial-assistance.md). L'acceptació no autoritza per si sola nous permisos, desplegaments ni canvis de configuració remota: els controls descrits aquí s'han de verificar abans d'activar-los.

Aquesta revisió proposa una esmena acotada a la decisió acceptada: que el servei pugui executar el merge demanat explícitament per una persona verificada. Mentre l'esmena no s'aprovi amb el merge de la PR que la conté, el merge continua reservat a una persona a GitHub i els ADR [0002](0002-public-chat-and-private-editor.md), [0003](0003-agent-workflow-and-security.md) i [0009](0009-pr-previews-same-domain-and-own-branches.md), `AGENTS.md` i els [límits dels assistents](../ai-assistant.md) continuen vigents en la seva forma actual.

L'esmena substitueix la proposta anterior, que reservava el merge a una persona a GitHub. La persona mantenidora n'ha canviat la decisió: els membres del grup són usuaris controlats i, després de validar el resultat, poden demanar explícitament el merge. L'excepció acotada a l'ADR 0003 inclou el push, la PR i aquest merge demanat; l'auto-merge, el push a `main`, els canvis de protecció i el desplegament continuen prohibits en tots els casos.

## Context

La fase 8 proposa ampliar el futur assistent editorial privat a consultes i canvis de codi, mantenint una persona com a responsable de la revisió i el merge. El grup privat de Telegram seria la frontera d'accés humana. Cada tema seria una sessió compartida i podria contenir més d'una feina. La petició explícita d'una persona membre autoritza una implementació fins a una PR. Qui ha validat el resultat pot demanar després el merge d'aquella PR; sense aquesta petició, l'agent no fusiona, i no desplega mai.

L'ampliació afecta les fronteres existents d'identitat, contingut autoritzat i eines. Els requisits i les amenaces són a [T8.1](../phase-8-t81-requisits-amenaces.md). La validació de T8.2 ha de distingir proves simulades de permisos reals i l'historial recuperat de l'execució recuperada.

L'ADR 0003 no concedeix permís implícit als agents per fer push. Aquest ADR acceptat planteja una excepció acotada al futur servei privat: una petició clara d'implementació d'un membre verificat autoritza commit, push a la branca de treball i PR dins de l'abast demanat. L'esmena proposada hi afegeix que una comanda explícita i verificada d'un membre del grup, amb el commit ja validat, autoritza el merge d'aquella PR. Ni l'auto-merge, ni el push a `main`, ni els canvis de protecció, ni el desplegament formen part de l'excepció. Cal aprovar l'esmena i alinear `AGENTS.md` abans d'activar-la; les instruccions vigents continuen aplicant-se a les sessions locals i a la resta d'agents.

## Comparació i proposta de pilot

La persona mantenidora tria un pont de Telegram propi. El prototip utilitza Pi RPC i `@earendil-works/pi-coding-agent` 1.5.0, de llicència MIT. Una consulta mínima amb `opencode-go` i el model `glm-5.3-flash` ha retornat la resposta esperada. Això prova la connexió, no la qualitat en tasques de codi ni la configuració definitiva del pilot. El protocol definitiu i l'activació continuen pendents de revisió i de les comprovacions del pilot.

| Alternativa                                                                                    | Reutilització                                                                             | Cost i límits observats                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pont propi sobre Pi RPC                                                                        | Sessions, model, esdeveniments i interrupció de Pi; transport de Telegram per implementar | El projecte manté la verificació de membres, la cua, l'aïllament i la recuperació. El prototip encara no els integra en un servei.                                                      |
| [pi-gateway](https://github.com/Dwsy/pi-gateway/tree/953b1b0c857fdab22a39247320b891d8bde9e79c) | Transport, temes, cues i sessions. El commit examinat declara MIT i Bun com a runtime.    | Cal adaptar autorització i deduplicació, corregir l'agrupació opcional de missatges entre temes i separar credencials. La compatibilitat amb la versió de Pi del pilot no està provada. |
| [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable/v/1.5.0)                 | Persistència i recuperació de tasques. La versió 1.5.0 declara llicència MIT.             | L'API es declara experimental. També cal transport, controls de seguretat i reconciliació de GitHub; un checkpoint no garanteix que una acció externa no es dupliqui.                   |

El pont propi redueix la superfície que cal adaptar respecte del gateway, però no s'ha mesurat l'esforç total. No es fixen Bun, Pi Durable ni un servei de persistència com a dependències del pilot.

El prototip local ha comprovat amb Telegram i el model configurat la separació de dos temes i la continuació de l'historial després d'un tancament ordenat. Amb un model simulat també s'han provat la interrupció d'un torn i la conservació del missatge després d'una caiguda. Això no demostra la recuperació automàtica d'efectes externs ni la seguretat de producció.

## Fronteres proposades

- **Identitat i sessions.** El pont accepta només instruccions atribuïbles a membres verificats del grup configurat. Consulta la pertinença a Telegram per a cada instrucció nova, sense memòria cau; una fallada denega la instrucció. El tema determina la sessió, però no la branca ni la PR. La sortida del grup no cancel·la feina compartida ja acceptada.
- **Aïllament.** Es proposa un component de confiança que gestiona Telegram, model i operacions de GitHub, separat de l'entorn que executa scripts, hooks, dependències i proves del repositori. El procés no fiable no pot llegir credencials, converses ni recursos de producció. Pi no ha d'exposar una shell que hereti les credencials del model: les eines que executen codi passen per la frontera aïllada. El directori de treball i les instruccions del model no són un aïllament. Cal demostrar els controls amb proves negatives abans de donar accés a codi no fiable.
- **Credencials i xarxa.** Cada component rep només les credencials necessàries. Cap token de Telegram, model o GitHub no arriba als processos de proves ni al model. L'entorn d'execució no té xarxa per defecte; si una comprovació necessita dependències o accés extern, cal definir i provar una excepció acotada abans d'utilitzar-la. No accedeix a serveis privats del VPS. Els límits de recursos i la rotació queden pendents de verificació al VPS. Cap procés no rep el socket de contenidors del host ni credencials de producció.
- **Git i revisió.** Les implementacions utilitzen branques i worktrees propis o coordinació equivalent provada per continuar una branca existent. L'agent pot proposar codi i contingut fins a PR només després de l'aprovació d'aquest ADR i de les proves de permisos. Una persona revisa el resultat i decideix el merge; amb la seva petició explícita, i només pel camí determinista descrit més avall, el servei l'executa. El component de confiança exposa només les operacions de Git i GitHub necessàries; no entrega el token ni una API arbitrària a l'entorn de proves. Fora d'aquest camí, les proteccions han d'impedir tècnicament el merge, l'auto-merge, el push directe a `main` i els canvis de protecció.
- **Recuperació.** La recepció i l'admissió han de ser duradores abans de confirmar una actualització de Telegram. Una acció externa amb resultat desconegut no es repeteix fins a consultar l'estat real. Si no es pot determinar el resultat, el servei ho comunica i no el declara completat. Les peticions pendents i el treball no fusionat no s'eliminen automàticament. La cua experimental de `tools/phase-8-evaluation/` usa SQLite de Node 24.11.0, declarat experimental, i dades sintètiques; no implementa la reconciliació amb GitHub ni és una implementació de producció.
- **Privacitat.** La traça privada, les sessions, els logs i les còpies tenen controls d'accés i retenció explícits. Les PR i les branques són públiques: no hi entren identificadors personals, converses privades ni secrets. L'agent no pressuposa que una comprovació automàtica detecti totes les dades privades.

## Merge autoritzat per una persona (esmena proposada)

Els membres del grup són usuaris controlats i la seva instrucció és
l'autorització. El merge continua sent una decisió humana: la persona que ha
validat el resultat el demana explícitament al fil. El servei no decideix mai
que cal fusionar.

Perquè la petició sigui explícita, atribuïble i vinculada al que s'ha validat,
té una forma determinista: `/merge <PR>`. El SHA no el tecleja la persona, que
no ha de conèixer-lo: el fixa el servei amb el que ha informat prèviament al
fil. El llenguatge natural continua valent per a la resta d'instruccions; per al
merge, el servei no interpreta prosa. Ni un "ho pots fusionar" ni una instrucció
incrustada en un missatge, una PR, un fitxer o una sortida d'eina són una
petició.

Quan l'agent informa que una PR està llesta (resum, comprovacions obligatòries
en verd, preview i SHA), el servei desa aquell SHA com l'informe vigent d'aquell
tema. Aquest SHA prové de la resposta de GitHub, no del text del model.

Abans de fusionar, el component de confiança comprova, en una sola operació:

- que la comanda provingui d'una persona verificada del grup configurat, amb la
  pertinença comprovada en aquell moment i registrada a la traça privada;
- que el repositori sigui el configurat, la PR estigui oberta i no sigui
  esborrany, i la branca base sigui `main`;
- que el cap actual de la PR sigui exactament el SHA de l'últim informe vigent
  d'aquell tema; si hi ha commits posteriors, el merge es rebutja i el servei
  demana una validació nova abans de tornar-ho a intentar;
- que totes les comprovacions obligatòries estiguin en verd, no pendents, no
  saltades i no neutres, i que la branca estigui al dia respecte de `main`;
- que el merge no requereixi cap bypass d'administrador ni cap canvi de
  protecció.

Qui conegui el commit pot escriure `/merge <PR> <SHA>`; en aquest cas el
component exigeix a més que coincideixi amb el cap actual. La comanda curta és
la forma normal.

El resultat es retorna al fil amb el SHA fusionat i la traça privada registra
autor, moment, PR, SHA i mètode. Si el resultat és desconegut, es consulta
l'estat real de la PR abans de repetir res.

Segueixen prohibits l'auto-merge, el merge sense comanda verificada, el merge
d'un commit posterior a l'informe o amb comprovacions vermelles, pendents o
absents, el push directe a `main`, els canvis de protecció i el desplegament.

L'execució la fa el component de confiança, que és l'únic que pot usar la
credencial de GitHub. L'entorn aïllat, el model i les proves no hi tenen accés
ni poden invocar l'API de GitHub directament.

## Separació proposada de permisos

| Component            | Accés previst                                                          | Límit abans del pilot                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pont de Telegram     | Token del bot i verificació de membres del grup configurat             | No envia la credencial a Pi, al contingut ni a les proves.                                                                                                                                          |
| Pi i model           | Credencial del proveïdor i context necessari de la sessió              | No rep credencials de GitHub ni de producció. Les eines d'execució no hereten la credencial del model.                                                                                              |
| Entorn d'execució    | Worktree de la feina i dependències necessàries                        | No llegeix sessions ni credencials i no accedeix a serveis privats del VPS.                                                                                                                         |
| Integració de GitHub | Compte `rboixaderg` amb una credencial per a branca, PR i merge acotat | El component només executa el merge demanat amb `/merge <PR>`, fixat al commit de l'últim informe; no exposa auto-merge, canvis de protecció ni escriptura a `main`. Cal provar-ho abans del pilot. |

Aquesta taula descriu una frontera proposada, no permisos ja concedits. La persona mantenidora ha triat el compte `rboixaderg`, que té el rol administrador al repositori. GitHub veu el mateix compte quan actua una persona o el servei; no es pot distingir l'agent pel rol del compte. La protecció actual de `main` exigeix PR i CI, però no exigeix cap aprovació. Una regla que permeti actuar als administradors tampoc separaria el servei de la persona mantenidora.

El servei necessita una credencial acotada i un component de confiança amb operacions explícites de branca, PR i merge. Pi i les proves no poden llegir aquesta credencial ni utilitzar una API GitHub arbitrària. El component ofereix una única operació de merge, amb les comprovacions de la secció anterior; no ofereix auto-merge, escriptura a `main` ni canvi de proteccions. Segons la [documentació de GitHub](https://docs.github.com/en/rest/pulls/pulls#fine-grained-access-tokens-for-merge-a-pull-request), el permís `Contents: write` també permet utilitzar l'API de merge; la separació no prové, doncs, de l'abast del token, sinó del camí únic del component, que no accepta comandes lliures ni URL de GitHub arbitràries.

El component valida que cada operació afecti el repositori configurat i la branca de treball de la feina. Rebutja `main`, altres repositoris, arguments o rutes no autoritzats i operacions destructives no previstes. No rep ordres de shell ni URL de GitHub arbitràries per executar amb la credencial. La persona mantenidora conserva el seu accés habitual per revisar i fusionar des de GitHub; a més, pot demanar el merge pel camí anterior. Cap altra operació s'afegeix a les disponibles pel servei.

Abans del pilot cal provar les operacions permeses i els rebuigs a través del component, inclosos intents alternatius des de l'entorn aïllat. Els rebuigs inclouen el merge sense comanda, des d'un altre grup o un missatge privat, amb commits posteriors a l'últim informe, amb comprovacions vermelles, pendents o absents, amb la PR en esborrany, amb la base canviada, amb bypass d'administrador i repetit després d'un resultat desconegut. Si no es pot demostrar aquesta frontera, el pilot no s'activa amb aquest compte. Les proves de permisos no fusionen cap PR ni fan push a `main`; el primer merge real del pilot requereix l'aprovació explícita de la persona mantenidora i queda registrat a la traça.

Les sortides dels processos, els commits i les PR poden contenir dades no fiables; l'aïllament de xarxa no garanteix per si sol que no s'hi filtri informació.

## Preview i ADR 0009

Una persona membre verificada demana la preview al tema. Sense cap segona confirmació ni correspondència individual entre Telegram i GitHub, l'agent comprova la CI, comenta `/preview` amb el compte compartit i retorna l'URL i el SHA confirmats pel publicador. Sense una petició explícita o amb CI vermella, no demana la preview.

Es proposa esmenar l'ADR 0009 per acceptar també una petició explícita d'un membre verificat al tema de Telegram, tramesa com a comentari `/preview` pel compte de l'agent. La persona no ha de fer un segon pas a GitHub. Es mantenen la CI verda, les branques pròpies, la vinculació al SHA, la revalidació del publicador i la resta de controls de preview.

El publicador actual comprova que l'autor del comentari de GitHub sigui col·laborador; no veu la petició de Telegram. La delegació requereix l'aprovació d'aquesta esmena i proves del flux i dels permisos. Fins llavors continua vigent el flux actual de preview amb autorització humana a GitHub.

## Comprovacions i punts pendents

Abans d'activar el pilot cal aprovar l'esmena de merge i provar els controls essencials d'identitat, aïllament, credencials i protecció de `main`. El compte de GitHub triat és administrador; un compte de prova sense accés al repositori no substitueix les comprovacions de la credencial i del component de confiança que utilitzarà el servei. Les comprovacions de permisos no fusionen cap PR ni fan push a `main`; el merge del pilot s'exercita després, amb autorització explícita.

Una prova local en un contenidor no privilegiat, amb només la interfície de xarxa local i el sistema de fitxers arrel de només lectura, ha escrit en un directori de treball sintètic muntat i ha comprovat que un fitxer i una variable sintètics del host no hi eren visibles. El [test reutilitzable](../../tools/phase-8-evaluation/isolation.test.mjs) només s'executa si se li indica una imatge local. Per exemple, amb Docker disponible i la imatge indicada ja present localment:

```sh
MR_ISOLATION_TEST_IMAGE=node:24.21.0-slim node --test tools/phase-8-evaluation/isolation.test.mjs
```

La prova no descarrega la imatge i no modifica la configuració del VPS. La versió de la imatge és una condició de l'experiment, no una tria per al servei ni el Node 24.11.0 fixat pel projecte. A la CI ordinària el test se salta si no s'indica una imatge. La prova no demostra l'aïllament al VPS, l'accés a dependències, els límits adequats ni la separació real de credencials.

La persona mantenidora informa que el VPS té 2 vCPU, 4 GB de RAM i 40 GB de disc. Aquesta capacitat no indica l'espai ni la memòria disponibles mentre funcionen els altres serveis. Abans d'activar el pilot cal provar la connexió del pont amb l'entorn aïllat, concretar i verificar els límits de recursos, preparar l'aturada i revisar les dades que reben el model, els logs i les còpies. Hi ha una execució activa global i fins a deu instruccions pendents, segons T8.1. Els límits numèrics de CPU, memòria, disc i temps no es poden donar per provats amb el contenidor local.

Les proves de revocació, dos autors, continuació entre fils, recuperació d'efectes externs i preview es completen sobre la base operativa segons la planificació aprovada. La prova real de revocació continua pendent.

La [PR #181](https://github.com/rboixaderg/mountain-runners/pull/181) ha reordenat el primer pilot fins a PR. L'aprovació d'aquest ADR no autoritza per si sola cap desplegament o canvi remot. Quan la frontera s'aprovi, cal alinear `AGENTS.md`, `docs/ai-assistant.md` i `docs/architecture.md` sense alterar el xat públic ni la revisió humana.

## Conseqüències

Un pont propi pot reduir funcionalitats alienes al projecte, però deixa al projecte la responsabilitat del transport, la cua, l'autorització i la recuperació. El prototip encara no justifica activar un servei. Les decisions tècniques i els valors pendents requereixen proves abans de la revisió final.

El merge autoritzat trasllada la garantia del clic a la comanda verificada. El compte triat és administrador i GitHub no distingeix el servei de la persona mantenidora, de manera que la separació és el camí determinista del component, les comprovacions obligatòries i la traça, no una impossibilitat tècnica del token. S'accepta aquest risc residual perquè els membres del grup són usuaris controlats i el merge sempre requereix la seva petició explícita. Si el grup incorpora persones menys controlades, caldrà una identitat de GitHub separada per al servei o una regla que restringeixi les actualitzacions de `main` a humans.
