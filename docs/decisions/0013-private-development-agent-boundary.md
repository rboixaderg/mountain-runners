# ADR 0013: Frontera de l'agent privat de desenvolupament

## Estat

Acceptada el 8 de novembre de 2026 amb el merge de la [PR #182](https://github.com/rboixaderg/mountain-runners/pull/182) a la T8.2 de la [fase 8](../specs/phase-8/phase-8-editorial-assistance.md). L'acceptació no autoritza per si sola nous permisos, desplegaments ni canvis de configuració remota: els controls descrits aquí s'han de verificar abans d'activar-los.

Esmenada el 9 de novembre de 2026 amb el merge de la [PR #183](https://github.com/rboixaderg/mountain-runners/pull/183), que aprova l'esmena acotada per executar el merge demanat explícitament per una persona verificada i alinea `AGENTS.md`, `CONTRIBUTING.md` i els [límits dels assistents](../ai-assistant.md). L'aprovació no activa cap permís: el merge demanat i la petició delegada de preview no s'habiliten fins que els controls d'aquest ADR estiguin verificats.

L'esmena substitueix la proposta anterior, que reservava el merge a una persona a GitHub. La persona mantenidora n'ha canviat la decisió: els membres del grup són usuaris controlats i, després de validar el resultat, poden demanar explícitament el merge. L'excepció acotada a l'ADR 0003 inclou el push, la PR i aquest merge demanat; l'auto-merge, el push a `main`, els canvis de protecció i el desplegament continuen prohibits en tots els casos.

La mateixa revisió esmena l'[ADR 0009](0009-pr-previews-same-domain-and-own-branches.md) per delegar-hi la petició de preview. El xat públic de l'[ADR 0002](0002-public-chat-and-private-editor.md) continua sense canvis i separat d'aquest servei.

Esmenada el 16 de novembre de 2026 per l'[ADR 0014](0014-operator-stop-and-repeatable-telegram-notices.md), només en dos punts: l'aturada de l'execució activa és de la persona operadora i un avís de Telegram es pot repetir després d'un lliurament desconegut. La resta d'aquest ADR no canvia.

Esmenada el 20 i el 21 de novembre de 2026 amb els merges de la [PR #262](https://github.com/rboixaderg/mountain-runners/pull/262) (T8.9), la [PR #267](https://github.com/rboixaderg/mountain-runners/pull/267) (etiqueta de preview) i la [PR #273](https://github.com/rboixaderg/mountain-runners/pull/273) (retirada de `/preview`). Les tres esmenes són a l'apartat corresponent.

Esmenada el 22 de novembre de 2026 amb el merge de la [PR #280](https://github.com/rboixaderg/mountain-runners/pull/280) (confirmació del merge en dos passos). L'acceptació no activa cap permís.

Esmenada el 24 de novembre de 2026 amb la PR de la T25 de l'[especificació de correccions de l'agent](../specs/agent-audit-remediation.md). L'acceptació no activa cap permís.

## Context

La fase 8 proposa ampliar el futur assistent editorial privat a consultes i canvis de codi, mantenint una persona com a responsable de la revisió i el merge. El grup privat de Telegram seria la frontera d'accés humana. Cada tema seria una sessió compartida i podria contenir més d'una feina. La petició explícita d'una persona membre autoritza una implementació fins a una PR. Qui ha validat el resultat pot demanar després el merge d'aquella PR; sense aquesta petició, l'agent no fusiona, i no desplega mai.

L'ampliació afecta les fronteres existents d'identitat, contingut autoritzat i eines. Els requisits i les amenaces són a [T8.1](../specs/phase-8/phase-8-t81-requisits-amenaces.md). La validació de T8.2 ha de distingir proves simulades de permisos reals i l'historial recuperat de l'execució recuperada.

L'ADR 0003 no concedeix permís implícit als agents per fer push. Aquest ADR acceptat planteja una excepció acotada al futur servei privat: una petició clara d'implementació d'un membre verificat autoritza commit, push a la branca de treball i PR dins de l'abast demanat. L'esmena aprovada a la PR #183 hi afegeix que una comanda explícita i verificada d'un membre del grup, amb el commit ja validat, autoritza el merge d'aquella PR. Ni l'auto-merge, ni el push a `main`, ni els canvis de protecció, ni el desplegament formen part de l'excepció. `AGENTS.md` hi està alineat; les instruccions vigents continuen aplicant-se a les sessions locals i a la resta d'agents.

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

## Merge autoritzat per una persona (esmena acceptada)

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

## Esmena (T8.4, 15 de novembre de 2026): `/merge` sense número

La persona mantenidora decideix que la comanda de merge continua sent
determinista, però que la persona no ha de teclejar el número de la PR: el
servei ja coneix la PR que ha informat en aquell tema. El servei no interpreta mai prosa ni usa el
model per triar la PR. Les formes acceptades, sempre al tema i amb les regles de
menció o resposta existents, són:

- `/merge <PR>`: sense canvis; `<PR>` ha de ser la PR de l'últim avís de CI verd
  lliurat en aquell tema.
- `/merge <PR> <SHA>`: sense canvis; el SHA ha de coincidir amb el commit fixat
  i amb el cap actual.
- `/merge`, sense número: el servei resol la PR de manera determinista amb el seu
  estat durador, és a dir, la PR de l'últim avís de CI verd lliurat en aquell
  tema, fixada a aquell commit. Només l'última PR informada d'un tema es pot
  fusionar; una PR informada abans necessita un avís nou.

Si el servei no pot resoldre-ho sense ambigüitat, pregunta i no fusiona res: no
hi ha cap avís verd al tema; l'últim avís no és verd; o el tema té feina més
nova que l'últim avís (una instrucció o una reparació en curs o en cua per a
aquell tema, o una publicació encara no informada). La resposta nomena la PR i
demana `/merge <PR>` després d'un informe nou, segons el cas.

El resultat nomena sempre el número de la PR fusionada i el commit fusionat. La
resta de controls no canvia: membre verificat comprovat en el moment
d'executar, PR oberta, no esborrany, base `main` i cap igual al commit fixat,
comprovacions obligatòries en verd i branca al dia, cap bypass
d'administrador. El mètode de merge és sempre squash. Després d'un resultat
desconegut no es repeteix mai el merge sense llegir abans l'estat real de la PR:
si GitHub la mostra fusionada, el servei la tanca com a fusionada i ho informa;
altrament decideix una persona.

Es manté que no hi ha cap permís actiu fins que els controls estiguin
verificats. Risc acceptat: fusionar una PR diferent de la que la persona tenia
al cap. Mitigacions: només es pot fusionar l'última PR informada del tema, el
servei pregunta davant de qualsevol dubte i el resultat és explícit.

## Separació proposada de permisos

| Component            | Accés previst                                                          | Límit abans del pilot                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pont de Telegram     | Token del bot i verificació de membres del grup configurat             | No envia la credencial a Pi, al contingut ni a les proves.                                                                                                                                                                |
| Pi i model           | Credencial del proveïdor i context necessari de la sessió              | No rep credencials de GitHub ni de producció. Les eines d'execució no hereten la credencial del model.                                                                                                                    |
| Entorn d'execució    | Worktree de la feina i dependències necessàries                        | No llegeix sessions ni credencials i no accedeix a serveis privats del VPS.                                                                                                                                               |
| Integració de GitHub | Compte `rboixaderg` amb una credencial per a branca, PR i merge acotat | El component només executa el merge demanat amb `/merge` (o `/merge <PR>`), resolt i fixat al commit de l'últim informe; no exposa auto-merge, canvis de protecció ni escriptura a `main`. Cal provar-ho abans del pilot. |

Aquesta taula descriu una frontera proposada, no permisos ja concedits. La persona mantenidora ha triat el compte `rboixaderg`, que té el rol administrador al repositori. GitHub veu el mateix compte quan actua una persona o el servei; no es pot distingir l'agent pel rol del compte. La protecció actual de `main` exigeix PR i CI, però no exigeix cap aprovació. Una regla que permeti actuar als administradors tampoc separaria el servei de la persona mantenidora.

El servei necessita una credencial acotada i un component de confiança amb operacions explícites de branca, PR i merge. Pi i les proves no poden llegir aquesta credencial ni utilitzar una API GitHub arbitrària. El component ofereix una única operació de merge, amb les comprovacions de la secció anterior; no ofereix auto-merge, escriptura a `main` ni canvi de proteccions. Segons la [documentació de GitHub](https://docs.github.com/en/rest/pulls/pulls#fine-grained-access-tokens-for-merge-a-pull-request), el permís `Contents: write` també permet utilitzar l'API de merge; la separació no prové, doncs, de l'abast del token, sinó del camí únic del component, que no accepta comandes lliures ni URL de GitHub arbitràries.

El component valida que cada operació afecti el repositori configurat i la branca de treball de la feina. Rebutja `main`, altres repositoris, arguments o rutes no autoritzats i operacions destructives no previstes. No rep ordres de shell ni URL de GitHub arbitràries per executar amb la credencial. La persona mantenidora conserva el seu accés habitual per revisar i fusionar des de GitHub; a més, pot demanar el merge pel camí anterior. Cap altra operació s'afegeix a les disponibles pel servei.

Abans del pilot cal provar les operacions permeses i els rebuigs a través del component, inclosos intents alternatius des de l'entorn aïllat. Els rebuigs inclouen el merge sense comanda, des d'un altre grup o un missatge privat, amb commits posteriors a l'últim informe, amb `/merge` sense número sense un avís verd resoluble, amb feina més nova que l'avís, amb comprovacions vermelles, pendents o absents, amb la PR en esborrany, amb la base canviada, amb bypass d'administrador i repetit després d'un resultat desconegut. Si no es pot demostrar aquesta frontera, el pilot no s'activa amb aquest compte. Les proves de permisos no fusionen cap PR ni fan push a `main`; el primer merge real del pilot requereix l'aprovació explícita de la persona mantenidora i queda registrat a la traça.

Les sortides dels processos, els commits i les PR poden contenir dades no fiables; l'aïllament de xarxa no garanteix per si sol que no s'hi filtri informació.

## Preview i ADR 0009

Una persona membre verificada demana la preview al tema. Sense cap segona confirmació ni correspondència individual entre Telegram i GitHub, l'agent comprova la CI, comenta `/preview` amb el compte compartit i retorna l'URL i el SHA confirmats pel publicador. Sense una petició explícita o amb CI vermella, no demana la preview.

L'[ADR 0009](0009-pr-previews-same-domain-and-own-branches.md) s'esmena en aquesta mateixa revisió per acceptar també una petició explícita d'un membre verificat al tema de Telegram, tramesa com a comentari `/preview` pel compte de l'agent. La persona no ha de fer un segon pas a GitHub. Es mantenen la CI verda, les branques pròpies, la vinculació al SHA, la revalidació del publicador i la resta de controls de preview.

El publicador actual comprova que l'autor del comentari de GitHub sigui col·laborador; no veu la petició de Telegram. La delegació requereix, a més de l'esmena aprovada, proves del flux i dels permisos; fins que es facin, continua vigent el flux de preview amb autorització humana a GitHub.

## Esmena (T8.9, 20 de novembre de 2026)

Acceptada amb el merge de la [PR #262](https://github.com/rboixaderg/mountain-runners/pull/262). Substitueix la
regla que exigeix una petició explícita de preview: el servei la demana quan
les comprovacions obligatòries del cap de la PR del tema són verdes. Conserva
branques pròpies, vinculació al SHA i revalidació del publicador segons
l'esmena proposada de l'ADR 0009. Un tema té una sola feina i PR; l'estat per
al model i per a les decisions es llegeix de GitHub, no només dels esdeveniments.

El token acotat del servei necessita `Actions: write` per reexecutar una sola
vegada una comprovació cancel·lada, esgotada o fallida abans dels passos del
projecte. Aquest permís també permet altres accions sobre execucions de
workflows: el compromís del servei o del token augmenta el risc d'abús i consum
de recursos. El token no entra al sandbox; les crides del servei es limiten al
reintent autoritzat i es registren. Cal verificar permisos i controls abans de
l'activació; aquesta esmena no modifica cap credencial.

No canvien la verificació i revocació de membres, el sandbox sense xarxa ni
credencials, el merge determinista només a petició humana verificada, ni la
protecció de producció.

## Esmena (etiqueta de preview, 21 de novembre de 2026)

Acceptada amb el merge de la [PR #267](https://github.com/rboixaderg/mountain-runners/pull/267),
que defineix l'[especificació de l'etiqueta de preview](../specs/preview-label.md). Substitueix, per al servei, el comentari
`/preview` de l'esmena T8.9: quan el servei crea la PR d'un tema, hi posa
l'etiqueta `preview`, i cada push posterior del servei publica la preview segons
l'esmena corresponent de l'[ADR 0009](0009-pr-previews-same-domain-and-own-branches.md).
El servei ja no espera les comprovacions verdes per demanar-la: el build de la
preview executa la validació completa i un cap vermell no es publica.

El component de GitHub rep una sola operació nova: afegir l'etiqueta `preview`
a la PR del tema. No pot treure etiquetes ni posar-ne cap altra, i no pot
treure `preview-revoked`. Segons la [documentació de
GitHub](https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue),
afegir etiquetes accepta `Pull requests: write`, que el token ja té: aquesta
esmena no amplia el token. Cal provar l'operació i els rebuigs amb el token real
abans d'activar-la.

Es mantenen la URL confirmada pel publicador per al cap actual, l'avís de fallada
planer, el merge determinista només a petició humana verificada i el sandbox sense
xarxa ni credencials.

## Esmena (retirada de `/preview`, 21 de novembre de 2026)

Acceptada amb el merge de la [PR #273](https://github.com/rboixaderg/mountain-runners/pull/273),
que defineix l'[especificació de la retirada de
`/preview`](../specs/retire-preview-command.md). Amb l'esmena corresponent de
l'[ADR 0009](0009-pr-previews-same-domain-and-own-branches.md), el comentari
`/preview` deixa de ser una petició de preview. El servei ja no el comenta des de
l'esmena de l'etiqueta, i retira el codi que reconciliava els comentaris
`/preview` anteriors, incloent-hi la lectura del compte autenticat del token.
Aquesta esmena no afegeix cap operació al component de GitHub ni amplia el token.

## Esmena (confirmació del merge en dos passos, 22 de novembre de 2026)

Acceptada amb el merge de la [PR #280](https://github.com/rboixaderg/mountain-runners/pull/280),
que defineix l'[especificació de la confirmació del merge amb una pregunta i
una resposta](../specs/preview-merge-confirmation.md). L'esmena afegeix una via
contextual en dos passos al literal `/merge`, sense activar cap permís.

- **Abast i tasques.** La T1 fixa la font del SHA del merge. La T2 afegeix la
  pregunta i la confirmació, actualitza la documentació operativa quan canviï i
  alinea `AGENTS.md`, `CONTRIBUTING.md`, `docs/ai-assistant.md`,
  `docs/architecture.md`, `docs/operations/` i les guies afectades abans d'activar.
  La primera fusió real necessita l'aprovació explícita de la persona mantenidora.
- **El text no autoritza.** Una validació com «La feina està validada» només
  provoca una pregunta fixa. Només la resposta «Sí, a producció» (ajustada des
  de «Sí» el 23 de novembre de 2026 abans d'activar, amb normalització tancada
  que ignora majúscules, espais, accents, comes, la preposició «a» i signes
  finals no interrogatius) de la mateixa persona verificada a aquella pregunta
  autoritza el merge d'exactament la PR i el SHA de la preview confirmada. Només
  compta la resposta directa a la pregunta, amb la identitat exacta de la
  resposta; cites, reenviaments, edicions i fitxers o llegendes no autoritzen.
  El transport de Telegram continua rebent només missatges nous: una edició mai
  no autoritza res, i un cop enviada i admesa una confirmació vàlida no es pot
  anul·lar editant-la a la cua. Cap altra prosa, text d'una PR, del model o
  d'una eina, ni un assentiment simple no autoritzen res.
- **Font del SHA (T1).** El SHA fixat és el de la preview confirmada i lliurada al
  tema, amb l'identificador del missatge desat després de l'enviament, i substitueix
  el de l'últim avís de CI verd a totes les formes de `/merge`. Aquesta esmena en
  fixa la font directament, sense dependre de l'aprovació de l'esmena T8.9, i
  substitueix la font del SHA de l'apartat «Merge autoritzat per una persona» i de
  l'esmena T8.4. La sintaxi i la resta de controls de `/merge` no canvien.
- **Controls.** Es mantenen la pertinença comprovada en el moment de confirmar, PR
  oberta, no esborrany, base `main`, repositori principal, cap igual al SHA fixat,
  comprovacions obligatòries en verd, branca al dia, etiqueta `preview`, cap
  `preview-revoked`, cap bypass d'administrador i mètode squash.
- **Producció.** La fusió és a `main`. El desplegament s'inicia amb aquest push
  segons `.github/workflows/artifact.yml` i els controls de producció; el servei no
  fa cap operació nova, no garanteix la publicació, no en consulta l'estat i no
  tanca cap PR sense fusionar.
- **Sense mitjans nous.** No hi ha model, interfície ni transport nou, i no hi ha
  cap credencial ni operació de GitHub nova. La pregunta és un missatge i la
  confirmació una resposta.
- **Idempotència i incertesa.** Una confirmació repetida o un reinici no
  fusionen dues vegades, i un avís substituït o d'enviament incert queda inert. Un resultat
  desconegut es reconcilia llegint la PR abans de res; si no la mostra fusionada,
  només una persona verificada el resol amb `/merge <PR> <SHA>`, que no autoritza
  repetir ni saltar controls.
- **Cap permís actiu.** Els controls s'han de provar abans d'activar-los i la
  primera fusió real requereix l'aprovació de la persona mantenidora.

## Esmena (correccions de l'auditoria, 24 de novembre de 2026)

Aprovada per la persona mantenidora amb la T25 de l'[especificació de correccions
de l'agent](../specs/agent-audit-remediation.md). L'acceptació no activa cap
permís ni canvia cap credencial; la implementació són les tasques T2 i T26.

- **Merge només de contingut.** `/merge` i la confirmació contextual «Sí, a
  producció» només fusionen una PR el commit fixat de la qual canvia
  exclusivament camins sota `apps/web/src/content/` i
  `apps/web/src/content-assets/`. En qualsevol altre cas el servei refusa amb un
  avís clar i la persona mantenidora revisa la PR i la fusiona a GitHub. Motiu:
  els membres no són tècnics i `main` no exigeix revisió, i el codi que arriba a
  `main` s'executa amb privilegis (publicació de previews, eines de release i
  l'agent mateix). Un CODEOWNERS obligatori no funciona, perquè el servei crea
  les PR amb el mateix compte que les hauria d'aprovar. La resta dels controls
  del merge no canvia.
- **Sense reexecució de jobs.** Es retira la reexecució única de comprovacions
  fallides de l'esmena T8.9. El token deixa de necessitar `Actions: write`, que
  la persona mantenidora retira un cop desplegada la implementació. Una
  cancel·lació, un temps esgotat o una fallada d'inici s'informen com qualsevol
  altra fallada de CI.
- **Sense reparació automàtica.** Es retira la reparació automàtica acotada de
  CI: el tema rep l'avís de la fallada i un membre demana el canvi.
  Evidència: la traça privada registra 2 reparacions iniciades
  (`ci_repair_requested`) des de l'activació.
- **Sense canvis.** El sandbox sense xarxa ni credencials, la verificació de
  membres, el merge fixat a la preview confirmada i la prohibició que l'agent
  desplegui es mantenen.

## Esmena proposada: cerca web i revisió abans del push

Pendent de revisió. Aquesta esmena concreta la frontera de la
[T8.10](../specs/phase-8/phase-8-editorial-assistance.md#t810-cerca-web-de-lagent-privat).
No activa cap permís.

- **Sortida de xarxa.** El component de confiança ofereix cerca amb Brave i
  lectura de pàgines públiques. El sandbox no rep xarxa, credencials ni accés
  al canal del component. El servei rebutja destinacions internes i producció, i
  revalida la destinació abans de cada connexió, també en les redireccions.
  Aplica el control de divulgació abans de resoldre el nom de domini, perquè
  la consulta DNS transmet aquest nom al resolutor. Si cal divulgar dades
  privades o hi ha dubte, mostra al tema la petició exacta i el destinatari
  sense previsualitzar els enllaços. El torn acaba abans
  d'esperar la resposta. Només una resposta directa i explícita de la mateixa
  persona pot autoritzar un enviament. El servei en revalida la pertinença i
  consumeix l'aprovació un sol cop. Això no autoritza edicions, publicació ni
  merge.
- **Revisió privada abans de publicar.** Aquesta és l'excepció al push
  automàtic de T8.9. Abans de lliurar resultats web al model, el servei registra
  que la feina ha rebut recerca. El bloqueig es manté si es reprèn la feina en
  un altre tema o torn, si es repara la CI o si es reinicia el servei. Cap push
  d'aquella feina no surt del servei fins que una persona autoritzada ha revisat
  l'historial nou i les metadades que es farien públiques, a partir d'una còpia
  de només lectura al servei de confiança. Una PR en esborrany no és una
  revisió privada. L'aprovació queda vinculada al repositori, la branca, el
  commit i les metadades exactes, així com a la base i l'estat esperat de la
  branca remota. El servei ho revalida abans de fer push del commit aprovat.
  Una discrepància invalida l'aprovació. Si el resultat del push és desconegut,
  el servei el reconcilia amb GitHub abans de repetir cap efecte. La resposta i
  les fonts de Telegram no formen part del cos de la PR.

Les comprovacions i la revisió es fan abans d'activar la cerca. No canvien el
merge ni el desplegament.

## Comprovacions i punts pendents

L'esmena de merge i l'esmena de l'ADR 0009 ja estan aprovades. Abans d'activar el pilot cal provar els controls essencials d'identitat, aïllament, credencials i protecció de `main`. El compte de GitHub triat és administrador; un compte de prova sense accés al repositori no substitueix les comprovacions de la credencial i del component de confiança que utilitzarà el servei. Les comprovacions de permisos no fusionen cap PR ni fan push a `main`; el merge del pilot s'exercita després, amb autorització explícita.

Una prova local en un contenidor no privilegiat, amb només la interfície de xarxa local i el sistema de fitxers arrel de només lectura, ha escrit en un directori de treball sintètic muntat i ha comprovat que un fitxer i una variable sintètics del host no hi eren visibles. El [test reutilitzable](../../tools/phase-8-evaluation/isolation.test.mjs) només s'executa si se li indica una imatge local. Per exemple, amb Docker disponible i la imatge indicada ja present localment:

```sh
MR_ISOLATION_TEST_IMAGE=node:24.21.0-slim node --test tools/phase-8-evaluation/isolation.test.mjs
```

La prova no descarrega la imatge i no modifica la configuració del VPS. La versió de la imatge és una condició de l'experiment, no una tria per al servei ni el Node 24.11.0 fixat pel projecte. A la CI ordinària el test se salta si no s'indica una imatge. La prova no demostra l'aïllament al VPS, l'accés a dependències, els límits adequats ni la separació real de credencials.

La persona mantenidora informa que el VPS té 2 vCPU, 4 GB de RAM i 40 GB de disc. Aquesta capacitat no indica l'espai ni la memòria disponibles mentre funcionen els altres serveis. Abans d'activar el pilot cal provar la connexió del pont amb l'entorn aïllat, concretar i verificar els límits de recursos, preparar l'aturada i revisar les dades que reben el model, els logs i les còpies. Hi ha una execució activa global i fins a deu instruccions pendents, segons T8.1. Els límits numèrics de CPU, memòria, disc i temps no es poden donar per provats amb el contenidor local.

Les proves de revocació, dos autors, continuació entre fils, recuperació d'efectes externs i preview es completen sobre la base operativa segons la planificació aprovada. La prova real de revocació continua pendent.

La [PR #181](https://github.com/rboixaderg/mountain-runners/pull/181) ha reordenat el primer pilot fins a PR. L'aprovació d'aquest ADR no autoritza per si sola cap desplegament o canvi remot. `AGENTS.md`, `CONTRIBUTING.md` i `docs/ai-assistant.md` ja estan alineats amb la frontera; [`docs/architecture.md`](../architecture.md) s'alinea en aquesta mateixa revisió, sense alterar el xat públic ni la revisió humana.

## Conseqüències

Un pont propi pot reduir funcionalitats alienes al projecte, però deixa al projecte la responsabilitat del transport, la cua, l'autorització i la recuperació. El prototip encara no justifica activar un servei. Les decisions tècniques i els valors pendents requereixen proves abans de la revisió final.

El merge autoritzat trasllada la garantia del clic a la comanda verificada. El compte triat és administrador i GitHub no distingeix el servei de la persona mantenidora, de manera que la separació és el camí determinista del component, les comprovacions obligatòries i la traça, no una impossibilitat tècnica del token. S'accepta aquest risc residual perquè els membres del grup són usuaris controlats i el merge sempre requereix la seva petició explícita. Si el grup incorpora persones menys controlades, caldrà una identitat de GitHub separada per al servei o una regla que restringeixi les actualitzacions de `main` a humans.
