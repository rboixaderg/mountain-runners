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
│   ├── attribution.mjs    grup, autor, tema i pertinença
│   └── bridge.mjs         polling, cua, execució i resposta
├── sessions/
│   ├── index.mjs          entrada /sessions
│   ├── identity.mjs       tema de Telegram → identificador de sessió
│   └── queue.mjs          SQLite, deduplicació, ordre, offset i traça
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
són responsabilitat de l'aplicació, no garanties d'aquesta cua.

## Requisits

- Node 24.11.0 o posterior. `node:sqlite` encara és experimental en Node 24.11.0.
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

| Exportació                             | Responsabilitat                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `TelegramApi`, `TelegramApiError`      | `getMe`, `getUpdates`, `getChatMember` i `sendMessage`; errors de transport sense URL amb token |
| `AdmissionQueue`                       | Cua duradora SQLite amb límit de pendents i una execució global                                 |
| `AgentBridge`                          | Connecta transport, comprovació de membres, cua i callback d'execució                           |
| `parseSessionKey`, `sessionIdentifier` | Identitat estable a partir de grup i tema                                                       |
| `runPiPrompt`, `buildPiArguments`      | Torn RPC i construcció explícita dels arguments de Pi                                           |
| `defaultBridgeMessages`                | Missatges operatius en anglès; l'aplicació pot substituir-los                                   |

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
});
await bridge.run({ signal });
```

Només s'admeten missatges de persones verificades del grup configurat, dins d'un
tema, que mencionen el bot o responen a un missatge seu. La pertinença es
consulta per instrucció, sense memòria cau; un error denega l'admissió. Els
autors anònims, reenviaments i missatges fora del tema no s'admeten.

Un tema comparteix sessió entre els membres. El bot respon amb el resultat,
limitat a 4.000 caràcters; no publica passos intermedis ni fa streaming. Les
instruccions es dedupliquen per update i s'executen en ordre. El polling i
l'execució són seqüencials; no hi ha un canal de cancel·lació per missatges
mentre el callback treballa. El `signal` del procés sí que arriba al callback.

Els missatges es poden substituir amb
`messages: { queueFull, unknownResult }`. El transport admet `fetchImpl` i
`baseUrl` per proves; el seu origen per defecte és l'API HTTPS de Telegram.

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
  signal,
});
```

`profileDirectory` ha de ser un path absolut dedicat i de confiança. Una sessió
persistent exigeix `sessionDirectory`; sense identificador, el torn és efímer.
Pi relaciona també la sessió amb `cwd`: mantén el directori estable per tema si
vols reprendre l'historial.

El valor retornat inclou `text`, `timedOut` i `stderr`; pot incloure `aborted`
o `handled`. El client espera `agent_settled`, no només `agent_end`. Un prompt
refusat es rebutja i un prompt gestionat per una comanda retorna sense esperar
un torn inexistent. El timeout per defecte és de 30 minuts.

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
