# telegram-pi-bridge

Biblioteca ESM per connectar temes d'un grup privat de Telegram amb sessions de
Pi. No necessita GitHub, Git, Docker, Astro ni dependències npm. Usa `fetch`,
processos de Node i `node:sqlite`.

El paquet és MIT i es pot copiar a un repositori independent. Encara no s'ha
publicat a npm ni s'ha creat un repositori remot propi. `private: true` impedeix
una publicació accidental; el nom i la distribució pública requereixen una
revisió i aprovació explícites. No és un servei validat per a producció.

## Peces i límits

```text
src/
├── index.mjs              API agregada, amb tots els mòduls
├── telegram/
│   ├── index.mjs          entrada /telegram
│   ├── api.mjs            client mínim de la Bot API
│   ├── attachments.mjs    contracte de les imatges i límits d'entrada
│   ├── attribution.mjs    grup, autor, tema, pertinença, fotos i àlbums
│   ├── albums.mjs         espera acotada que agrupa les imatges d'un àlbum
│   └── bridge.mjs         polling, cua, execució i resposta
├── sessions/
│   ├── index.mjs          entrada /sessions
│   ├── identity.mjs       tema de Telegram → identificador de sessió
│   ├── queue.mjs          SQLite, deduplicació, ordre, offset i traça
│   └── trace-reader.mjs   consulta de només lectura de la traça
└── pi/
    └── rpc.mjs            procés Pi i protocol JSONL
```

La biblioteca no decideix quins fitxers es poden modificar, quines comprovacions
cal executar o quan es pot publicar una PR. L'aplicació proporciona
`runInstruction(request, { signal })`. Aquest callback retorna:

```js
{ outcome: "answered", report: "Text que s'enviarà al tema" }
```

`outcome: "uncertain"` o una excepció bloquegen la cua. Un resultat desconegut
no es repeteix automàticament. La reconciliació d'efectes externs i la retenció
són responsabilitat de l'aplicació, no garanties d'aquesta cua. Els errors
locals coneguts han de retornar `{ outcome: "failed", report }`; així la cua
pot continuar. Una excepció no classificada es tracta amb cautela i bloqueja.

## Requisits

- Node 24.22.3 o posterior. `node:sqlite` ja no imprimeix cap avís
  experimental en aquesta versió.
- Un executable Pi amb RPC JSONL i l'esdeveniment `agent_settled` per usar
  `runPiPrompt`. Pi no s'inclou al paquet ni s'instal·la automàticament.
- Per operar amb Telegram: bot i grup privat amb temes. Cal assegurar que el
  bot rep mencions i respostes, i que pot verificar els membres amb
  `getChatMember`. Aquesta consulta és fiable per als altres usuaris quan el
  bot és administrador del grup.

No cal cap credencial ni servei extern per executar les proves automatitzades.
La compatibilitat amb la versió de Pi escollida i els permisos reals de Telegram
s'han de verificar abans d'activar un servei.

## API pública

Importa només l'entrada que necessites. No cal importar fitxers interns.

```js
import { AgentBridge, TelegramApi } from "telegram-pi-bridge/telegram";
import { AdmissionQueue, sessionIdentifier } from "telegram-pi-bridge/sessions";
import { runPiPrompt } from "telegram-pi-bridge/pi";
```

`/pi` no carrega Telegram ni SQLite. `/telegram` no carrega Pi ni SQLite;
rep la cua i el callback d'execució de l'aplicació. `/sessions` carrega SQLite,
però no Telegram ni Pi. L'entrada arrel `telegram-pi-bridge` conserva totes
les exportacions i carrega tots els mòduls, inclòs SQLite.

| Exportació                                                                | Responsabilitat                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TelegramApi`, `TelegramApiError`                                         | `getMe`, `getUpdates`, `getChatMember`, `sendMessage`, `getFile` i `downloadFile`; errors de transport sense URL amb token      |
| `TelegramFileTooLargeError`                                               | Descàrrega aturada pel límit de bytes, amb la mida coneguda perquè el refús la pugui dir                                        |
| `AdmissionQueue`                                                          | Cua duradora SQLite amb límit de pendents i una execució global                                                                 |
| `readTraceEntries`                                                        | Consulta de només lectura de la traça privada; `parseTraceFilters` valida els filtres i llança `TraceQueryInputError`           |
| `AgentBridge`                                                             | Connecta transport, comprovació de membres, cua, callback d'execució i treball propi de l'aplicació quan la cua és buida        |
| `parseSessionKey`, `sessionIdentifier`                                    | Identitat estable a partir de grup i tema                                                                                       |
| `runPiPrompt`, `buildPiArguments`, `PiRunError`                           | Torn RPC, arguments explícits de Pi, `onPromptSent` per saber si el prompt s'ha escrit i errors tipats amb metadades de sortida |
| `defaultBridgeMessages`                                                   | Missatges operatius en anglès; l'aplicació pot substituir-los                                                                   |
| `instructionExcerpt`                                                      | Retall d'una línia de la instrucció per al missatge de recepció                                                                 |
| `acceptedImageDocuments`, `attachmentOrigins`, `attachmentRefusalReasons` | Contracte de les imatges: tipus, extensions, MIME i origen (`message` o `reply`)                                                |
| `maximumAttachmentBytes`, `maximumImagesPerInstruction`                   | Límit d'entrada de 20 MB i cinc imatges per missatge o àlbum                                                                    |
| `imageDocumentRefusal`, `imageDocumentAttachment`                         | Refús d'un document declarat i descripció duradora de l'adjunt admès                                                            |
| `largestPhotoSize`, `photoRefusal`, `photoAttachment`                     | Mida més gran d'una foto comprimida, refús per mida i descripció duradora com a JPEG                                            |
| `classifyInstruction`, `classifyAlbum`, `isAlbumMember`, `AlbumCollector` | Classificació d'un missatge o d'un àlbum, detecció de membres d'àlbum i espera acotada abans d'admetre'l                        |
| `declaredImageDocument`, `fileNameExtension`, `attachmentMegabytes`       | Confronament del nom i el MIME declarats, extensió del nom i format llegible de la mida                                         |

### Pont de Telegram

```js
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { AgentBridge, TelegramApi } from "telegram-pi-bridge/telegram";

const queue = new AdmissionQueue(databasePath, { maxPending: 10 });
const telegram = new TelegramApi({ botToken });
const identity = await telegram.getMe({ signal });
const bridge = new AgentBridge({
  groupIdentifier,
  botUsername,
  botIdentifier: identity.id,
  telegram,
  queue,
  runInstruction,
  runWhenIdle,
  onServiceReport,
});
await bridge.run({ signal });
```

Només s'admeten missatges de persones verificades del grup configurat, dins d'un
tema, que mencionen el bot o responen a un missatge seu. La pertinença es
consulta per instrucció, sense memòria cau; un error denega l'admissió i avisa
l'autor perquè torni a enviar la petició. La consulta té un termini (30 s per
defecte, `membershipTimeoutMilliseconds`) i respecta el senyal del procés: un
termini esgotat denega la instrucció, i una aturada la deixa sense consumir, de
manera que l'offset de Telegram no avança. Els
autors anònims, reenviaments i missatges fora del tema no s'admeten.

S'admeten les fotos comprimides de Telegram i els documents JPEG, PNG i WebP.
D'una foto es pren la mida més gran, que Telegram envia com a JPEG. El límit
d'entrada és de 20 MB, el màxim de descàrrega de la Bot API: la mida declarada
es comprova en admetre la instrucció i l'aplicació torna a comprovar els bytes
reals quan l'executa. Un document d'un altre tipus es refusa sense ocupar la
cua. Cada imatge admesa viatja amb la fila de la cua (fitxer de Telegram, nom,
tipus, mida i origen) dins de `request.attachments`; el paquet no descarrega cap
fitxer.

Un àlbum arriba com una actualització per imatge amb el mateix
`media_group_id`, i sovint només una porta la llegenda. El pont les recull
durant una espera acotada (`albumWaitMilliseconds`, 1 s per defecte) i les
classifica com una sola instrucció de fins a cinc imatges; la menció o la
llegenda poden ser a qualsevol d'elles. Més de cinc imatges es refusen amb un
avís. Mentre un àlbum espera, l'offset de Telegram no avança més enllà de la primera
imatge, així que un reinici torna a llegir el grup; la cua deduplica el que ja
s'havia admès. La reentrega d'un membre ja recollit no reinicia l'espera: el
termini comença amb el grup i un membre nou només el pot allargar fins a un
màxim absolut. Un àlbum vençut només s'admet després de llegir un lot, de manera
que inclou les imatges arribades durant una feina lenta entre dos lots. Una
actualització o un àlbum només es donen per processats quan l'admissió ha
acabat: si llança una excepció (per exemple, amb la base de dades ocupada), una
consulta posterior ho torna a intentar. Si l'excepció arriba quan la instrucció
ja és a la cua, el nou intent la tracta com a duplicada i no n'envia l'avís de
recepció. Els missatges d'altres sessions s'admeten sense esperar; els
posteriors a un àlbum de la mateixa sessió l'esperen per conservar l'ordre.

Un tema comparteix sessió entre els membres. El bot respon amb el resultat,
limitat a 4.000 caràcters sense partir cap parell de substitució; no publica
passos intermedis ni fa streaming. Les instruccions es dedupliquen per update i
s'executen en ordre. El polling i
l'execució són seqüencials; no hi ha un canal de cancel·lació per missatges
mentre el callback treballa. El `signal` del procés sí que arriba al callback.
`isBlocked()` indica si hi ha una instrucció en execució o amb un resultat extern
desconegut. Un consumidor que faci feina externa pròpia ha de consultar-lo abans
de començar-ne.

Una cua bloquejada per incertesa refusa les instruccions noves amb un avís.
`admit()` retorna `rejected_blocked` i les desa com a refusades. Les instruccions
que ja eren pendents es conserven. `recover()` transforma les execucions
interrompudes en incertes i retorna el total d'instruccions incertes, incloses
les de reinicis anteriors.

La reconciliació d'una incertesa és responsabilitat del consumidor. `uncertain()`
retorna les instruccions incertes sense el text, i
`resolveUncertain({ updateIdentifier, outcome, trace })` en tanca una, desa
l'entrada de traça i retorna la fila, tot en una transacció. La instrucció només
s'actualitza si encara és incerta, així que una resolució repetida no la
sobreescriu ni afegeix cap traça.

`runWhenIdle({ signal })` és opcional i serveix perquè l'aplicació executi la
seva pròpia feina duradora de segon pla. El pont el crida només quan no queda
cap instrucció per executar, i espera que retorni si ha fet alguna cosa: si en
retorna `true`, torna a buidar la cua i el crida de nou. Així l'aplicació no
necessita un segon executor ni un pany propi, i es conserva una sola execució
global. Una excepció es registra com a `idle_work_failed` i no atura el pont.
El pont no desa ni recupera aquesta feina: la durabilitat és responsabilitat de
l'aplicació.

`onServiceReport({ sessionKey, text, effectKey })` és opcional i s'executa per
als textos que el pont decideix i envia al tema sense passar per
`runInstruction` (avui, el refús d'un adjunt en admetre la instrucció).
`effectKey` identifica l'efecte (un refús per actualització), perquè
l'aplicació el desi una sola vegada encara que Telegram repeteixi
l'actualització. El consumeix l'aplicació perquè el torn següent del model
conegui l'efecte. Un error es registra com a `service_report_failed` i no
impedeix la resposta.

Els missatges es poden substituir parcialment amb
`messages: { acknowledgement, queueFull, queueBlocked, membershipUnavailable, unknownResult, attachmentUnsupported, attachmentInvalidPhoto, attachmentTooLarge, attachmentTooManyImages }`.
`acknowledgement` és una funció que rep el retall d'una línia de la instrucció,
`attachmentTooLarge` rep la mida en MB, `attachmentTooManyImages` el nombre
d'imatges i la resta són cadenes. La recepció s'envia només quan la instrucció ja és duradora
a la cua, abans d'executar-la, i un error d'enviament no atura la feina: es
registra com a `reply_failed`. El transport admet `fetchImpl` i
`baseUrl` per proves; el seu origen per defecte és l'API HTTPS de Telegram. Tota
petició té un termini propi que cobreix la connexió i la lectura del cos,
combinat amb el senyal del procés: 30 s per defecte
(`requestTimeoutMilliseconds`) i, al long polling, el temps demanat al servidor
més 15 s de marge (`longPollMarginMilliseconds`). Un termini esgotat és un
`TelegramApiError` sense URL ni token; una aturada del procés continua com a
`AbortError`.

Davant un 429 amb `retry_after`, `sendMessage` espera i ho torna a provar una
sola vegada, si l'espera cap dins del termini compartit pels dos intents; una
aturada del procés també talla l'espera. Si no, l'error es propaga.

`TelegramApi.sendMessage` admet `disableLinkPreview: true` per enviar un enllaç
sense que Telegram en generi una previsualització.

### Torn de Pi

```js
import { runPiPrompt } from "telegram-pi-bridge/pi";

const result = await runPiPrompt({
  command: "pi",
  model,
  cwd: workspaceDirectory,
  profileDirectory,
  sessionIdentifier,
  sessionDirectory,
  environment: modelEnvironment,
  message,
  // Opcional: [{ type: "image", data: "<base64>", mimeType: "image/jpeg" }]
  images,
  signal,
});
```

`profileDirectory` ha de ser un path absolut dedicat i de confiança. Una sessió
persistent exigeix `sessionDirectory`; sense identificador, el torn és efímer.
Pi relaciona també la sessió amb `cwd`: mantén el directori estable per tema si
vols reprendre l'historial.

`images` és opcional i s'escriu al registre `prompt` del protocol RPC. El
transport no neteja ni valida la imatge: el consumidor hi envia només imatges ja
reduïdes, sense metadades i amb un total màxim de 8 MB per prompt. La resta es
queda al magatzem del tema i el model la pot mirar amb una eina.

El valor retornat inclou `text`, `timedOut` i `stderr`; pot incloure `aborted`
o `handled`. El client espera `agent_settled`, no només `agent_end`. Una
resposta RPC amb `success: false` (el prompt refusat o un altre error, com
`parse`) rebutja la crida, i un prompt gestionat per una comanda retorna sense
esperar un torn inexistent. Els missatges de l'assistent es separen amb dos salts de
línia. El timeout per defecte és de 30 minuts. La sortida conjunta de stdout i
stderr en streaming té un límit de 16 MiB per torn, amb límits de memòria
acotats a 2 MiB per línia de stdout, 1 MiB per a stderr i 1 MiB per al text
acumulat de l'assistent, inclòs JSONL incomplet o no vàlid. Els registres que
repeteixen missatges sencers, amb les imatges en base64 (`message_start`,
`message_end` de l'usuari o d'una eina, `tool_execution_end`, `turn_end` i
`agent_end`), es descarten a mesura que arriben: no es desen ni compten per a
cap límit. Un excés
mata el procés, espera que es tanqui i executa `onInterrupted` abans de rebutjar
la crida amb `PiRunError` (`diagnostics: { reason: "output_limit" }`); no retorna
una resposta parcial com si fos completa. Si Pi surt abans d'emetre
`agent_settled`, la crida es rebutja amb `PiRunError` i
`diagnostics: { reason: "premature_exit", exitCode, signal }`.

`onPromptSent` és opcional i s'executa una sola vegada, immediatament abans
d'escriure el prompt a l'entrada de Pi. És el fet que permet al consumidor
distingir un prompt que s'ha intentat enviar d'un torn que s'ha aturat abans
—llançament fallit, executable inexistent o sense permís, aturada o termini
abans de l'escriptura—, encara que una neteja que també falla substitueixi
l'error original. Si no s'executa, cap prompt no ha arribat a Pi.

Per defecte no hi ha eines, extensions, MCP, skills, templates ni càrrega
automàtica d'instruccions del directori. `tools` només admet noms explícits,
no patrons ni modificadors com `+bash`. `extensions` només admet paths absoluts
que l'aplicació ha revisat i proporciona explícitament.

El procés no hereta `process.env`: rep `PATH`, l'entorn explícit i el directori
de perfil. `environment` és una llista preparada pel consumidor, no un lloc per
passar tot l'entorn del servei. Mai hi incloguis el token de Telegram o altres
credencials alienes al model. No registris `stderr` sense revisar-ne el contingut.

Si habilites execució aïllada, proporciona `onInterrupted` per esperar-ne la
neteja després d'error, timeout o cancel·lació. Matar Pi no atura per si sol
contenidors o treball remot. La biblioteca no implementa un sandbox: activar
eines de fitxers o shell natives de Pi dona els permisos del procés a aquestes
eines. Les extensions també executen codi al host.

## Exemple executable sense eines

`examples/conversation.mjs` connecta el pont amb Pi sense repositori, GitHub ni
Docker. Desa cada tema en una sessió estable i no habilita eines del model.
Abans d'executar-lo, configura aquestes variables fora del repositori:

| Variable                      | Valor requerit                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`          | Credencial del bot                                                              |
| `TELEGRAM_GROUP_ID`           | Identificador del grup privat                                                   |
| `TELEGRAM_BOT_USERNAME`       | Nom del bot, sense `@`                                                          |
| `BRIDGE_STATE_DIRECTORY`      | Directori privat d'estat, perfils i sessions                                    |
| `PI_MODEL`                    | Model i proveïdor configurats a Pi                                              |
| `PI_COMMAND`                  | Opcional, executable de Pi; per defecte `pi`                                    |
| `MODEL_ENVIRONMENT_VARIABLES` | Noms separats per comes de les variables del proveïdor que es poden passar a Pi |

```sh
node examples/conversation.mjs
```

El token de Telegram no es passa a Pi. El contingut de les instruccions i
l'historial sí que poden arribar al proveïdor del model. Defineix els permisos,
la retenció, les còpies i la revocació abans d'usar converses reals.

## Proves i empaquetat local

Des d'aquest directori, també si s'ha copiat fora del repositori original:

```sh
node --test "test/**/*.test.mjs"
pnpm pack --pack-destination /tmp
```

Les proves carreguen cada entrada en un procés nou amb les dependències dels
altres mòduls bloquejades. No cal instal·lar dependències ni construir el paquet.
El tarball conté l'API,
els mòduls, l'exemple, aquest README i la llicència. No conté proves, sessions,
credencials ni codi de l'aplicació consumidora. Empaquetar-lo localment no el
publica a cap registre.
