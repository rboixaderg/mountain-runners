# Agent privat de desenvolupament

L'agent de Mountain Runners porta una petició d'un grup privat de Telegram
fins a una pull request (PR), la preview i el merge que una persona demana.

Les decisions i els límits són a l'[ADR 0013](../../../docs/decisions/0013-private-development-agent-boundary.md)
(apartat «Decisió vigent») i a l'[ADR 0014](../../../docs/decisions/0014-operator-stop-and-repeatable-telegram-notices.md).
La instal·lació, l'actualització, les còpies, la reconciliació i els incidents són
a [`docs/operations/agent.md`](../../../docs/operations/agent.md). El nucli de
Telegram, les sessions, la cua i el protocol RPC són a
[`packages/telegram-pi-bridge`](../../../packages/telegram-pi-bridge/README.md).

## Diagrama

```text
Telegram (grup privat, un tema = una sessió)
   │  admissió duradora: membre verificat, deduplicació, cua d'una execució
   ▼
packages/telegram-pi-bridge          processes/telegram-bridge/main.mjs
   │  runInstruction(request, { signal })
   ▼
workflow/run-instruction.mjs ── policy/development.mjs (prompts, textos, noms)
   │
   ├─ torn de Pi ─ runtime/pi-adapter.mjs ─ Pi (sense credencials de GitHub)
   │                     └─ sandbox_bash ─ Podman (worktree a /work)
   ├─ comprovacions ─ pnpm check / check:local dins del sandbox
   ├─ publicació ─ repository/publisher.mjs ─ escaneig, push, PR, petició de preview
   │
   ▼
GitHub ◀── workflow/ci-watch.mjs (seguiment de la CI del SHA publicat)
   ▲   ◀── workflow/preview-request.mjs (adreça de la preview confirmada)
   └────── workflow/merge-request.mjs (/merge o «Sí, a producció»)
                     │
                     ▼
              state/agent.sqlite (estat durador) · avisos al mateix tema
```

El punt d'entrada és [`processes/telegram-bridge/main.mjs`](processes/telegram-bridge/main.mjs).
[`workflow/project-runner.mjs`](workflow/project-runner.mjs) connecta el flux
amb Pi, Podman i GitHub.

## Recorregut d'una petició

1. El pont comprova el grup, el tema, l'autor i la pertinença abans d'admetre
   la instrucció. La desa abans d'avançar l'offset de Telegram. Només hi ha una
   execució global.
2. El servei no classifica les peticions ordinàries: obre un torn de Pi amb
   escriptura al worktree del tema. El servei comprova amb regles deterministes
   l'autorització del [merge](#merge) i de l'enviament d'una [cerca](#cerca-web).
3. Si hi ha canvis o commits pendents, el servei en fa un commit, sincronitza la
   branca amb `main` i executa `pnpm check` al sandbox (`pnpm check:local` si
   s'aplica l'[ADR 0012](../../../docs/decisions/0012-local-fast-checks.md)).
   Una fallada conserva la feina per al torn següent.
4. El publicador escaneja credencials, fa push i obre o reutilitza la PR. El tema
   queda vinculat a la branca i la PR (`topic_jobs`).
5. El servei desa el registre de la publicació (`publications`) abans de
   respondre. Dos bucles en segon pla segueixen la [CI](#ci) i la [preview](#preview)
   del SHA publicat.
6. Una persona verificada demana el merge. El servei el fa només si es compleixen
   les condicions de [Merge](#merge).

Una instrucció amb resultat desconegut (un error després del push, una aturada
de sandbox no confirmada) queda `uncertain` i bloqueja l'arrencada fins que una
persona en [reconcilia el resultat](../../../docs/operations/agent.md#reconciliació-de-resultats-desconeguts).
El servei no torna a executar la instrucció. En canvi, pot repetir els
[avisos de Telegram previstos a l'ADR 0014](../../../docs/decisions/0014-operator-stop-and-repeatable-telegram-notices.md)
si se'n desconeix el lliurament, sense repetir cap efecte a GitHub.

## Estat de l'aplicació

La cua, la traça i els registres del flux viuen a `state/agent.sqlite`.
[`repository/state-database.mjs`](repository/state-database.mjs) en defineix
l'esquema amb migracions numerades per `PRAGMA user_version`; el servei refusa una
base d'una versió més nova que el seu codi. La cua del pont hi crea les taules
`instructions`, `trace` i `telegram_offset`. Les sessions de Pi, el salt, els
adjunts i la revisió de recerca es desen fora de la base.

| Taula                       | Una fila per                | Estats                                                                                                       | Codi                                 |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `instructions`              | actualització admesa        | `pending`, `running`, `uncertain`, `done`, `rejected`                                                        | `packages/telegram-pi-bridge`        |
| `publications`              | actualització amb push      | `ci_state`: `pending`, `sent`, `superseded`; `preview_state`: `awaiting`, `confirmed`, `timed_out`, `failed` | `repository/publication-store.mjs`   |
| `merge_requests`            | petició de merge            | `merging`, `merged`, `failed`, `uncertain`, `not_merged`                                                     | `repository/merge-request-store.mjs` |
| `merge_questions`           | pregunta de confirmació     | sense consumir o consumida (`consumed_at`)                                                                   | `repository/merge-request-store.mjs` |
| `session_notes`             | efecte pendent d'un tema    | `undelivered`, `claimed`                                                                                     | `repository/session-note-store.mjs`  |
| `session_delivered_effects` | identitat d'efecte lliurada | —                                                                                                            | `repository/session-note-store.mjs`  |
| `topic_jobs`                | tema vinculat               | —                                                                                                            | `repository/topic-job-store.mjs`     |
| `imported_databases`        | base antiga importada       | —                                                                                                            | `repository/legacy-state.mjs`        |

La clau de `publications` és l'identificador de l'actualització de Telegram
(`update_identifier`). La fila desa el SHA publicat a `commit_sha`, el resultat
de la CI, l'adreça confirmada de la preview i l'identificador de l'avís lliurat.
`ci_state` i `preview_state` avancen per separat. Les files importades poden
tenir un dels dos estats a `NULL`; les que no tenen `ci_state` no poden fixar un
merge.

Si a `state/` hi ha les bases separades d'una versió anterior,
l'arrencada i la reconciliació les importen una vegada
(`repository/legacy-state.mjs`) i les deixen com a `*.migrated`. L'ordre
`commands/migrate-state/cli.mjs` [assaja la importació sobre una còpia](../../../docs/operations/agent.md#assajar-la-migració-de-lestat).

## Fronteres de confiança

- **Credencials.** El pont llegeix les credencials una vegada en arrencar, les
  guarda a la configuració en memòria i les elimina de `process.env`. Pi només rep
  una llista blanca d'entorn amb la credencial del proveïdor
  (`runtime/pi-adapter.mjs`). Risc residual: el codi que s'executa com a usuari
  del servei encara les pot llegir de l'entorn inicial o del fitxer d'entorn.
- **Sandbox.** Pi no té `bash` al host. `sandbox_bash` executa cada ordre en un
  contenidor Podman sense root, `--network=none`, `--read-only`,
  `--cap-drop=ALL`, `--security-opt=no-new-privileges`, amb límits de CPU, memòria
  i processos. Les ordres del model munten el worktree a `/work`; les
  comprovacions també reben un inventari de camins de només lectura. Cap
  contenidor rep credencials ni metadades Git (`sandbox/arguments.mjs`). Amb
  `--pull=never`, la imatge fixada ha de ser al magatzem local.
- **Eines del model.** L'adaptador habilita `sandbox_bash` i `view_attachment`,
  i `web_research` quan hi ha un canal de recerca configurat. Pi no carrega
  eines ni extensions del repositori.
- **Git.** `repository/trusted-git.mjs` fixa les metadades, desactiva hooks i
  fsmonitor i no hereta l'entorn del pont. El servei refusa repositoris niats i
  submòduls (`repository/worktrees.mjs`).
- **Publicació.** `repository/secret-scan.mjs` inspecciona tots els objectes de
  `origin/main..HEAD` contra els tokens coneguts, refusa canvis a `.github/**` i
  `CODEOWNERS` i adjunts sota `.agent-attachments/`. El push usa el SHA inspeccionat.
- **Noms opacs.** Els identificadors de Telegram no arriben a cap nom públic ni
  al sandbox: el worktree, la branca i l'etiqueta del contenidor deriven d'un
  HMAC amb el salt `state/identifier-salt` (`repository/identifiers.mjs`). Sense
  el salt els noms existents no es poden reconstruir: entra a les còpies.
- **Sortida.** Si `stdout` i `stderr` d'una ordre del sandbox superen junts 1 MiB,
  el servei atura el procés i espera la neteja del contenidor
  (`sandbox/commands.mjs`). `sandbox_bash` mostra al model fins a 32 KiB de
  sortida i indica si l'ha retallada. El retall no atura l'ordre
  (`runtime/sandbox-bash-output.mjs`).
- **Aturada.** Matar Pi no atura els contenidors. L'adaptador espera l'aturada
  de cada contenidor abans de comprovar o publicar; una aturada no confirmada
  bloqueja el servei (`sandbox/errors.mjs`).

## Preview

El servei demana la preview amb l'etiqueta `preview`. Només intenta posar-la
quan crea la PR, mai quan la reutilitza. Si no pot posar-hi l'etiqueta, la
publicació es manté i el servei ho comunica (`repository/publisher.mjs`). El
[publicador de previews](../../../docs/operations/previews.md#publicar-una-preview)
confirma l'adreça amb un comentari de `github-actions[bot]` per al SHA exacte.

`workflow/preview-request.mjs` segueix cada publicació (`preview_state`): `awaiting`
acaba com a `confirmed`, `timed_out` (25 minuts,
`previewConfirmationTimeoutMilliseconds`) o `failed`. Una PR sense l'etiqueta,
amb `preview-revoked`, tancada o amb un cap més nou acaba sense cap avís
d'adreça. L'avís s'envia abans de tancar el seguiment.

## CI

`workflow/ci-watch.mjs` llegeix els check runs i els estats de commit del SHA
publicat (`repository/ci-status.mjs`). Si totes les comprovacions obligatòries
(`MOUNTAIN_AGENT_REQUIRED_CHECKS`) són presents i correctes, el resultat queda
a la nota de servei i al journal. El seguiment es tanca amb
`ci_state = sent` sense enviar cap avís a Telegram. Si les comprovacions fallen
o no es poden confirmar dins del termini, el servei avisa el tema. El servei no
reexecuta jobs ni repara la CI. Una publicació nova de la mateixa PR substitueix
el seguiment anterior pendent (`ci_state = superseded`). Una CI verda no
autoritza el merge.

## Merge

[`workflow/merge-request.mjs`](workflow/merge-request.mjs) interpreta `/merge` i
la confirmació «Sí, a producció» i comprova l'autorització sense el model.
Revalida el membre, la preview lliurada i l'estat de la PR a GitHub. Si el tema
té feina més nova que l'avís, no fusiona. Les autoritzacions i les exclusions són a
l'[ADR 0013](../../../docs/decisions/0013-private-development-agent-boundary.md#decisió-vigent).
En la via de dues respostes, la primera ha d'anar a l'avís lliurat de la preview
de l'última publicació i la segona a la pregunta exacta del servei, des del
mateix tema i per la mateixa persona. La pregunta fixa la PR i el SHA, caduca
a les 24 hores i es consumeix un sol cop.

Si la branca va endarrerida, el servei integra `main` i valida i publica el canvi
a la mateixa PR. Pot obrir un torn de Pi per resoldre un conflicte. El servei no
fusiona amb aquella petició i demana revisar la preview nova.

No es repeteix mai un merge sense llegir abans la PR. Amb una petició `uncertain`,
el `/merge` següent i l'arrencada consulten GitHub. A diferència d'una instrucció
`uncertain`, un merge incert no bloqueja l'arrencada. Si la PR continua oberta,
una persona pot tancar el cas amb `/merge <PR> <SHA>` amb el SHA del cap actual o
amb la reconciliació d'operador. Tancar el cas no fusiona la PR.

## Retenció de worktrees

El servei programa una revisió dels temes de `topic_jobs` a l'arrencada i cada
sis hores. L'executa quan la cua és buida i no està bloquejada. Per a les PR
tancades amb la branca coincident, elimina el worktree si és net, està publicat
i la PR s'ha fusionat. Si no, el conserva i només retira les dependències
generades (`repository/retention.mjs`). L'ordre d'operador és a
[`docs/operations/agent.md`](../../../docs/operations/agent.md#retenció).

## Revocació

Una persona que deixa el grup no pot donar instruccions noves, però la feina
ordinària ja acceptada continua. El merge torna a comprovar la pertinença en
executar-se.

## Un tema, una feina

La primera publicació confirmada desa la branca i la PR a `topic_jobs`. Abans de
cada torn d'un tema vinculat, el servei llegeix la PR: si és fusionada o tancada,
respon que la feina és acabada i que cal un tema nou, sense cap torn de model. El
servei comprova la branca, el repositori i el cap de la PR abans del torn i abans
del push, i no crea una segona PR. Si el cap remot avança, l'integra amb
fast-forward o amb un commit de merge. Un conflicte amb `main` es resol dins del
sandbox, i si no es pot resoldre amb seguretat el model pregunta a la persona. El
servei integra `main` amb un commit de merge, mai amb rebase, i el push només
avança la branca. El codi és a `workflow/topic-state.mjs`,
`workflow/run-instruction.mjs` i `repository/worktrees.mjs`.

Abans de cada torn, el servei dona al model un bloc d'estat de la PR (cap,
comprovacions, adreça de la preview confirmada) llegit de GitHub
(`workflow/topic-state.mjs`). Si la lectura falla, el bloc ho diu i el servei
registra `topic_state_failed`.

## Continuïtat de la conversa

Cada tema té una sola sessió de Pi. `repository/session-note-store.mjs` desa a
`session_notes` el text de cada efecte que decideix el servei (publicacions, avisos,
merge, reconciliacions) i el posa en un bloc de servei davant del prompt següent.
Cada efecte té una identitat duradora, una nota té com a màxim 1.500 caràcters i un
reinici no repeteix les notes d'un torn interromput.

## Adjunts

El [pont de Telegram](../../../packages/telegram-pi-bridge/README.md#pont-de-telegram)
defineix els formats i límits d'entrada. El servei descarrega les imatges quan
executa la instrucció. Valida les capçaleres sense descodificar cap píxel i treu
les metadades; en aquesta neteja pot conservar un perfil de color de fins a 64 KiB.
Només les imatges netes arriben al worktree i al model. El sandbox aplica
l'orientació EXIF si cal i redueix les imatges fins a un màxim de 2.400 px al
costat llarg i 2 MiB per fitxer (`attachments/scale.mjs`).

El magatzem `state/attachments/topic-<hex>/` admet 20 imatges i 50 MiB per tema,
i 256 MiB en total. Si cal fer lloc, elimina les imatges més antigues segons la
quota que s'hagi omplert. També elimina les imatges que s'han publicat o que fa
més de set dies que es van desar (`attachments/store.mjs`). El servei adjunta al
prompt fins a 8 MiB d'imatges noves abans de codificar-les en base64. Les altres
imatges del tema es poden obrir amb `view_attachment`, que només accepta noms
de la llista del servei i no segueix enllaços simbòlics.

## Cerca web

Amb un token de Brave, el model pot cercar i llegir pàgines públiques. El sandbox
no té xarxa ni el token: el servei fa les consultes pel descriptor 3 de Pi
(`runtime/web-wire-server.mjs`, `web-research/broker.mjs`). Refusa destinacions
internes i revalida cada redirecció. Les consultes i URL fora de les llistes
revisades requereixen confirmació; els secrets i identificadors privats detectats
no s'envien ni amb confirmació. Si la consulta confirmada dona resultat, Pi pot
reprendre la feina original amb aquestes dades no fiables.

Abans del push d'una feina que ha rebut recerca, una persona autoritzada n'ha
d'aprovar el candidat exacte en privat (`repository/research-review.mjs`). Un
cop aprovat, `/publica-revisio` permet reprendre la publicació. Aquesta aprovació
no autoritza cap merge. El document d'operació descriu els
[requisits d'activació](../../../docs/operations/agent.md#comprovar-el-dns-abans-dactivar-la-cerca-web)
i la [revisió privada](../../../docs/operations/agent.md#revisar-en-privat-una-edició-amb-recerca).

## Llengua i avisos

El prompt fixa que els interlocutors són membres del club, majoritàriament no
tècnics: la resposta va en la seva llengua (català per defecte), amb frases curtes.
Els avisos fixos són a [`policy/development.mjs`](policy/development.mjs): la
persona rep el resultat i les notes de servei conserven el context tècnic.

## Proves

El paquet prova Telegram, la cua, les sessions i el RPC. L'aplicació prova la
política, el sandbox, Git, l'estat i les ordres d'operador, amb Git real i
fronteres externes simulades. `workflow/journey.test.mjs` cobreix el recorregut
fins a PR i `workflow/bridge-package.test.mjs`, la disposició instal·lada. Les
ordres de verificació són a
[`docs/operations/agent.md`](../../../docs/operations/agent.md#verificació).

Aquestes proves no demostren els permisos reals de GitHub ni l'aïllament al VPS.
