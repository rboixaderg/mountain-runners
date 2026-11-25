# Especificació: Correccions I Simplificació De L'Agent Privat

## Estat

En curs. Creada el 24 de novembre de 2026 a partir d'una auditoria de l'agent
privat (`tools/server/agent/` i `packages/telegram-pi-bridge/`) a
`origin/main` 3c4f462. Aquest document és l'única font de seguiment: cada
fila de tasca passa de `Pendent` a `En curs` i a `Completada` (només quan la
seva PR està validada, revisada i fusionada), o a `Bloquejada` mentre hi ha una
decisió pendent de la persona mantenidora. No activa cap permís, no modifica cap
configuració remota i no desplega res.

## Objectiu

Tancar els problemes de seguretat i els errors funcionals trobats i reduir la
complexitat innecessària per al propòsit de l'agent (uns pocs membres de
confiança, sovint no tècnics, demanen canvis per Telegram; una sola persona mantenidora), de manera que sigui més fàcil d'entendre i de mantenir, sense
perdre cap capacitat que els membres utilitzin.

## Límits I Decisions Confirmades

- Mètode de treball: cada tasca s'implementa en el seu propi worktree des de
  l'últim `main`, en una branca curta pròpia. Un agent d'implementació fa el
  canvi i un agent diferent el revisa de manera independent (l'agent de
  seguretat sempre que toqui una frontera de confiança). El commit, el push i la
  PR només es fan amb l'aprovació explícita de la persona mantenidora; una persona fa el
  merge. El servei en execució al VPS l'actualitza la persona mantenidora amb
  [l'ordre d'actualització versionada](../operations/agent.md#actualitzar); els
  agents mai no desplegen.
- Els títols de PR són `type(agent-audit-tN): resum`, o `tN-tM` quan s'agrupen
  tasques. Una PR que només canvia aquesta especificació utilitza
  `docs(specs-agent-audit): resum`.
- Les fronteres acceptades dels ADR
  [0013](../decisions/0013-private-development-agent-boundary.md),
  [0014](../decisions/0014-operator-stop-and-repeatable-telegram-notices.md),
  [0012](../decisions/0012-local-fast-checks.md) i
  [0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md) no es
  canvien en silenci: les tasques marcades com a «esmena» necessiten primer una
  PR que esmeni l'ADR.
- Una tasca que canvia el comportament actualitza el document propietari
  (README de l'agent o document d'operació) a la mateixa PR, segons la taula de
  propietaris d'`AGENTS.md`.
- Les necessitats noves descobertes durant una tasca són files noves, no
  ampliacions silencioses de l'abast.
- Decisions de la persona mantenidora (24 de novembre de 2026):
  - `/merge` fusiona les PR que canvien tot excepte infraestructura (revisió
    del 25 de novembre de 2026, que amplia l'abast inicial de només contingut;
    la llista és a l'ADR 0013); les PR que toquen infraestructura les fusiona
    la persona mantenidora a GitHub. Requereix una esmena de l'ADR 0013.
    CODEOWNERS no serveix perquè el servei crea les PR amb el mateix compte que
    les hauria d'aprovar.
  - S'accepta l'esmena proposada de l'ADR 0013 per a la recerca web (T8.10).
  - Es treu el classificador de peticions, d'acord amb T8.9; desapareix la
    petició de preview en llenguatge natural.
  - L'automatització de CI es redueix: es treu la reexecució de jobs fallits i
    el permís `Actions: write`, els avisos de CI passen a ser repetibles com els
    de preview (ADR 0014) i es treu la reparació automàtica; la PR de l'esmena
    registra abans, com a evidència, quantes reparacions consten a la traça
    privada (només el recompte, sense dades privades).

## Resultats Esperats

- Cap troballa crítica o alta queda oberta i cada decisió bloquejada queda
  registrada en aquest document.
- El codi de producció de l'agent és mesurablement més petit. Línia base a
  3c4f462: `tools/server/agent` 20.494 línies de producció i 36.983 de test;
  `packages/telegram-pi-bridge` 3.359 i 5.567; 6 bases de dades SQLite i 13
  taules.
- Mesura: suma de línies (`wc -l`) dels fitxers `*.mjs` i `*.ts` de cada
  directori, excloent `node_modules`, els fitxers `*.test.*` i els directoris
  `test-support`; per als tests, els fitxers `*.test.*` i els de
  `test-support`. Es repeteix la mateixa ordre en tancar:

  ```sh
  find tools/server/agent -path '*/node_modules' -prune -o \
    -type f \( -name '*.mjs' -o -name '*.ts' \) \
    ! -name '*.test.*' ! -path '*/test-support/*' -print | xargs cat | wc -l
  ```

- L'objectiu és orientatiu: al voltant d'una quarta part menys de codi de
  producció. No és un criteri dur d'acceptació.

## Dependències I Ordre D'Inici

Els blocs s'inicien en aquest ordre: A seguretat, B errors funcionals, C
simplificació sense esmena d'ADR, D simplificació amb esmena d'ADR i E
documentació. T1 va primer i és urgent; T25 (l'esmena dels ADR) va just després de T1, perquè T2 i T26 en depenen, i conserva el seu identificador. Les tasques de simplificació que toquen
`workflow/run-instruction.mjs` van després de les correccions del bloc B que
toquen el mateix fitxer, per evitar conflictes. T28 va l'última.

## Tasques, Entregues I Seguiment

Cada tasca té la seva PR, tret que la columna `Entrega` indiqui el contrari.

| Tasca | Estat      | Dependències  | Resultat verificable                                                     | Entrega | PR                                                              |
| ----- | ---------- | ------------- | ------------------------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| T1    | Completada | -             | El Git del servei no processa repositoris niats ni submòduls             | PR 1    | [#314](https://github.com/rboixaderg/mountain-runners/pull/314) |
| T2    | Completada | T25           | `/merge` fusiona les PR que canvien tot excepte infraestructura          | PR 2    | [#321](https://github.com/rboixaderg/mountain-runners/pull/321) |
| T3    | Completada | -             | Les credencials no són a l'entorn del procés                             | PR 3    | [#317](https://github.com/rboixaderg/mountain-runners/pull/317) |
| T4    | Completada | -             | La versió de Pi queda registrada i és fàcil d'actualitzar                | PR 4    | [#324](https://github.com/rboixaderg/mountain-runners/pull/324) |
| T5    | Completada | T4            | El límit per línia del RPC no falla amb imatges permeses                 | PR 5    | [#327](https://github.com/rboixaderg/mountain-runners/pull/327) |
| T6    | Completada | -             | El títol i el cos de la PR estan acotats                                 | PR 6    | [#323](https://github.com/rboixaderg/mountain-runners/pull/323) |
| T7    | Completada | -             | L'acceptació de l'esmena de recerca web queda registrada                 | PR 7    | [#320](https://github.com/rboixaderg/mountain-runners/pull/320) |
| T8    | Completada | -             | Torns nous, de només lectura i identificadors privats correctes          | PR 8    | [#330](https://github.com/rboixaderg/mountain-runners/pull/330) |
| T9    | Completada | -             | Un error del proveïdor acaba el torn com a fallada                       | PR 9    | [#319](https://github.com/rboixaderg/mountain-runners/pull/319) |
| T10   | Completada | -             | Feina local i conflictes de la branca sense bucles                       | PR 10   | [#326](https://github.com/rboixaderg/mountain-runners/pull/326) |
| T11   | Completada | -             | Cap estat bloqueja sense sortida                                         | PR 11   | [#318](https://github.com/rboixaderg/mountain-runners/pull/318) |
| T12   | Completada | -             | La reconciliació restaura tot el que deixa una publicació                | PR 12   | [#334](https://github.com/rboixaderg/mountain-runners/pull/334) |
| T13   | Completada | -             | Les fallades informen del motiu i de la resposta del model               | PR 13   | [#333](https://github.com/rboixaderg/mountain-runners/pull/333) |
| T14   | Completada | T26           | Cap avís fals ni repetit per publicacions substituïdes                   | PR 14   | [#329](https://github.com/rboixaderg/mountain-runners/pull/329) |
| T15   | Completada | -             | El pont de Telegram admet, reintenta i talla correctament                | PR 15   | [#325](https://github.com/rboixaderg/mountain-runners/pull/325) |
| T16   | Completada | -             | La confirmació del merge és determinista                                 | PR 16   | [#328](https://github.com/rboixaderg/mountain-runners/pull/328) |
| T17   | Pendent    | -             | Codi mort i branques només de proves eliminats                           | PR 17   | -                                                               |
| T18   | Completada | Comprovacions | Migracions i estat antic eliminats                                       | PR 18   | [#335](https://github.com/rboixaderg/mountain-runners/pull/335) |
| T19   | Completada | T8            | Classificador de peticions retirat                                       | PR 19   | [#](https://github.com/rboixaderg/mountain-runners/pull/)       |
| T20   | Pendent    | T9–T14        | El torn està dividit en fases amb resultats tipats                       | PR 20   | -                                                               |
| T21   | Completada | -             | Quatre defectes d'imatge corregits sense moure els originals             | PR 21   | [#332](https://github.com/rboixaderg/mountain-runners/pull/332) |
| T22   | Completada | -             | Eines d'operador més curtes i amb garanties conservades                  | PR 22   | [#331](https://github.com/rboixaderg/mountain-runners/pull/331) |
| T23   | Pendent    | T17           | `telegram-pi-bridge` com a mòdul intern amb API estreta                  | PR 23   | -                                                               |
| T24   | Pendent    | T20           | Proves amb fixtures compartits i dividides per fases                     | PR 24   | -                                                               |
| T25   | En curs    | -             | Els ADR 0013 i 0014 esmenats amb les decisions preses                    | PR 25   | [#315](https://github.com/rboixaderg/mountain-runners/pull/315) |
| T26   | Completada | T25           | Decisions de l'esmena implementades                                      | PR 26   | [#322](https://github.com/rboixaderg/mountain-runners/pull/322) |
| T27   | Pendent    | T18, T26      | Una sola base de dades amb una fila per commit publicat                  | PR 27   | -                                                               |
| T28   | Pendent    | La majoria    | Documentació de l'agent curta, amb la regla detallada al costat del codi | PR 28   | -                                                               |

L’orquestrador actualitza `Estat` i `PR` quan s’obre una PR (`En curs` amb l’enllaç) i quan es fusiona (`Completada`).

### T1: Repositoris Niats I Submòduls Al Worktree

**Abast:** el Git de confiança del servei no prepara (`stage`) mai un
repositori niat (`gitlink`) creat al worktree, no n'entra mai en llegir l'estat
del worktree, i la publicació refusa qualsevol commit del rang que n'afegeixi un.
Fitxers: `repository/worktrees.mjs`, `repository/trusted-git.mjs`,
`repository/secret-scan.mjs`, `repository/retention.mjs` i
`workflow/run-instruction.mjs`.

**Exclusió immediata:** no canvia la resta de controls de publicació ni la
frontera del sandbox.

**Dependències:** cap. És la tasca urgent: la persona mantenidora actualitza el VPS tan
aviat com es fusioni.

**Resultat observable:** el servei mai no prepara ni entra en un repositori
niat o submòdul creat al worktree, i la publicació el refusa amb un avís
comprensible.

**Comprovacions mínimes:** proves de regressió amb Git real que demostrin la
protecció; `node --test` de les proves de repositori i de flux de treball;
`pnpm docs:check`.

**PR:** `security(agent-audit-t1): …`.

### T2: Què Pot Fusionar `/merge`

**Abast:** el servei refusa `/merge` (i la confirmació contextual del merge)
quan la PR del commit fixat canvia infraestructura, segons la revisió del 25 de
novembre de 2026 de
l'[ADR 0013](../decisions/0013-private-development-agent-boundary.md) (abans,
qualsevol camí fora del contingut), o conté un enllaç simbòlic, un submòdul o
un fitxer executable entre els canvis, amb un avís clar que diu que la persona
mantenidora la revisarà. Fitxers: `workflow/merge-request.mjs`,
`policy/development.mjs` i el README de l'agent.

**Exclusió immediata:** no canvia la protecció de la branca ni cap configuració
remota, i no afegeix CODEOWNERS.

**Dependències:** T25 (l'esmena de l'ADR 0013).

**Resultat observable:** el `/merge` d'un membre pot posar a `main` canvis de
l'aplicació (components, estils, pàgines i contingut), però no de les eines ni
de la configuració del projecte; aquestes PR les fusiona la persona
mantenidora.

**Comprovacions mínimes:** proves de refús de cada categoria d'infraestructura,
de camins mixtos i de PR sense infraestructura; `pnpm test:server`.

**PR:** una PR dedicada.

### T3: Secrets Fora De L'Entorn Del Procés

**Abast:** les credencials de GitHub, Telegram, el proveïdor de models i Brave
Search es carreguen amb credencials de systemd (`LoadCredential=`) o es llegeixen
una sola vegada en arrencar i s'eliminen de `process.env`;
`MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES` refusa noms que comencen per
`MOUNTAIN_AGENT_` o `MR_AGENT_`. Fitxers: `tools/server/systemd/mountain-agent.service`,
`config.mjs`, `runtime/pi-adapter.mjs` i el document d'operació.

**Exclusió immediata:** no canvia quines credencials existeixen ni els seus
permisos remots.

**Dependències:** cap.

**Resultat observable:** cap procés fill ni el sandbox hereta credencials de
l'entorn, i la llista de variables del proveïdor no pot exposar variables del
servei.

**Comprovacions mínimes:** proves de configuració; comprovació del fitxer d'unitat.

**PR:** una PR dedicada.

### T4: Versió De Pi Registrada I Actualitzable

**Abast:** revisió del 25 de novembre de 2026, per decisió de la persona
mantenidora: el servei fa servir sempre l'última versió publicada del Pi coding
agent, en lloc d'una versió fixada. Pi s'instal·la en un sol directori sense
versió, el document d'operació descriu com actualitzar-lo a l'última versió i com
tornar enrere, i el servei registra al journal i a la traça privada la versió
que fa servir en cada arrencada. Fitxers: `runtime/pi-adapter.mjs`,
`processes/telegram-bridge/main.mjs` i `docs/operations/agent.md`.

**Exclusió immediata:** no impedeix arrencar amb cap versió concreta. El risc
acceptat és que una versió nova pot canviar com s'executen les eines o la
sortida RPC; la comprovació és la línia `pi_version` del journal i una pregunta
en un tema després d'actualitzar.

**Dependències:** cap.

**Resultat observable:** cada arrencada deixa al journal la versió de Pi, i
actualitzar-lo a l'última versió o tornar a l'anterior és un procediment curt i
documentat.

**Comprovacions mínimes:** proves de l'arrencada (versió registrada i versió
il·legible) i del límit de temps de l'ordre de versió; `pnpm docs:check`.

**PR:** una PR dedicada.

### T5: Límit Per Línia Del RPC I Imatges Del Prompt

**Abast:** amb la versió de Pi que registra el journal, verificar si Pi repeteix el prompt (amb
imatges en base64) per la sortida estàndard. Si és així, el límit per línia (2
MiB, `packages/telegram-pi-bridge/src/pi/rpc.mjs`) no pot fer fallar un torn amb
una imatge permesa (pressupost d'imatges del prompt de 8 MiB,
`policy/development.mjs`): o bé el límit només s'aplica al que el client
conserva, o bé s'alinea el pressupost d'imatges.

**Exclusió immediata:** no amplia els límits d'imatge ni de memòria més del
necessari.

**Dependències:** T4.

**Resultat observable:** un torn amb una imatge permesa mai no falla pel límit
de línia del RPC.

**Comprovacions mínimes:** prova amb una imatge al màxim permès i una sortida
RPC que la repeteix; proves del paquet.

**PR:** una PR dedicada.

### T6: Títol I Cos De La PR

**Abast:** el resum del model que esdevé el títol públic de la PR té longitud i
caràcters limitats (sense `@` ni paraules de tancament com `closes #N`), i els
camins de fitxer del cos s'emmarquen en blocs de codi. Fitxer:
`policy/development.mjs`.

**Exclusió immediata:** no canvia el format de les PR més enllà d'aquests límits.

**Dependències:** cap.

**Resultat observable:** el títol i el cos de la PR no poden mencionar persones
ni tancar incidències, i la seva longitud és acotada.

**Comprovacions mínimes:** proves de política amb casos negatius.

**PR:** una PR dedicada.

### T7: Acceptació De L'Esmena De Recerca Web

**Abast:** una PR de documentació que registra l'acceptació de l'esmena
proposada de l'ADR 0013 per a la recerca web i actualitza l'estat de T8.10 a
l'especificació de la fase 8 i el redactat sobre l'activació al document
d'operació.

**Exclusió immediata:** no canvia codi i no activa el servei; l'activació
continua a càrrec de la persona mantenidora després de les comprovacions
d'operació.

**Dependències:** cap.

**Resultat observable:** l'estat de la recerca web és coherent entre l'ADR,
l'especificació de la fase i el document d'operació.

**Comprovacions mínimes:** `pnpm docs:check`.

**PR:** una PR dedicada de documentació.

### T8: Correccions De La Recerca Web

**Abast:** (1) que un treball sigui nou es decideix a partir de l'estat (sense
worktree ni vinculació), no de ser la primera fila admesa de la cua, de manera
que una fila rebutjada, un `/merge`, una preview o una resposta de validació no
marquin el torn següent com si necessités revisió privada; (2) els torns de només
lectura no depenen de l'indicador de recerca i un torn d'aclariment no és mai de
només lectura; (3) una prova demostra que el descriptor de fitxer de la recerca
web no arriba al contenidor del sandbox; (4) el filtre d'identificadors privats
també coincideix amb valors absoluts i amb la forma de grup sense `-100`.
Fitxers: `workflow/run-instruction.mjs`, `web-research/*`,
`runtime/pi-adapter.mjs` i `packages/telegram-pi-bridge/src/sessions/queue.mjs`.

**Exclusió immediata:** no activa la recerca web.

**Dependències:** T7 només per a l'activació, no per a les correccions.

**Resultat observable:** els quatre punts tenen una prova que falla abans del
canvi i passa després.

**Comprovacions mínimes:** `node --test` de flux de treball, recerca web i
cua; `pnpm test:server`.

**PR:** una PR dedicada.

### T9: Error Del Proveïdor En Un Torn

**Abast:** un torn del model on el resultat de Pi porta `errorMessage`
(límit de ritme, autenticació, quota) acaba com a fallada amb motiu i nota pròpia
per a la persona mantenidora, mai com a resposta i sense publicar canvis parcials; el
mateix per al torn de resolució de conflictes. Fitxer:
`workflow/run-instruction.mjs` (el RPC retorna `errorMessage` sense llançar
excepció).

**Exclusió immediata:** no reintenta automàticament.

**Dependències:** cap.

**Resultat observable:** una fallada del proveïdor mai no es presenta com a
resposta ni deixa publicats canvis parcials.

**Comprovacions mínimes:** proves de flux amb un resultat amb `errorMessage`
en un torn ordinari i en un de conflictes.

**PR:** una PR dedicada.

### T10: Feina Local I Conflictes De La Branca Del Tema

**Abast:** (1) una sincronització de merge o un gate fallit no deixa un commit
de merge local sense publicar que faci que tot `/merge` posterior respongui «ha
canviat, torna-ho a demanar»: es restableix al commit fixat quan no s'ha publicat
res, o s'informa de «feina local encara no publicada»; (2) la pregunta del model
en un conflicte no resolt després que el cap de la PR s'hagi mogut arriba a la
persona; (3) la pregunta de conflicte del model es registra com a resposta del
model, no com a nota del servei; (4) el torn de conflicte de la sincronització
prepara les dependències si `main` ha canviat el lockfile; (5) la comprovació
d'espais en blanc d'un commit de merge només cobreix els canvis propis de la
branca; (6) l'informe `movedHead` es divideix en motius diferenciats amb avisos
clars que no demanen repetir ni usen «proposta». Fitxers:
`workflow/run-instruction.mjs`, `repository/worktrees.mjs` i
`policy/development.mjs`.

**Exclusió immediata:** no canvia la prioritat de resolució de conflictes de
[la sincronització abans del merge](agent-sync-before-merge.md).

**Dependències:** cap.

**Resultat observable:** cap fallada de sincronització o de gate deixa el tema
bloquejat; cada motiu té el seu avís.

**Comprovacions mínimes:** proves de flux i de worktrees amb Git real per a cada
punt.

**PR:** una PR dedicada.

### T11: Estats Que Bloquegen Sense Sortida

**Abast:** (1) una vigilància de CI i una petició de preview caduquen per edat
encara que les lectures de GitHub continuïn fallant; (2) `/merge` sobre una PR
fusionada o tancada ho diu en lloc de «il·legible»; (3) un merge incert el pot
resoldre l'operador (tipus de reconciliació) de manera que ja no bloqueja
indefinidament l'ordre d'actualització. Fitxers: `workflow/ci-watch.mjs`,
`workflow/preview-request.mjs`, `workflow/merge-request.mjs`,
`commands/reconcile/` i `commands/update/command.mjs`.

**Exclusió immediata:** no canvia els temps límit acceptats pels ADR.

**Dependències:** cap.

**Resultat observable:** cap vigilància, petició ni merge incert queda bloquejat
per sempre.

**Comprovacions mínimes:** proves amb lectures de GitHub que fallen
contínuament, PR tancada i reconciliació d'un merge incert.

**PR:** una PR dedicada.

### T12: Reconciliació Completa D'Una Publicació

**Abast:** reconciliar una instrucció o reparació publicada restaura tot el que
deixa una publicació normal (vigilància de CI, fila de seguiment de la preview,
vinculació del tema, comprovació de l'etiqueta `preview`), de manera que `/merge`
pugui tornar a fixar; una PR absent després d'un push no es classifica com a
refús local. Fitxers: `commands/reconcile/uncertain-cases.mjs`,
`repository/publisher.mjs` i `workflow/run-instruction.mjs`.

**Exclusió immediata:** no canvia el camí de publicació normal.

**Dependències:** cap.

**Resultat observable:** després de reconciliar, el tema queda equivalent a una
publicació normal.

**Comprovacions mínimes:** proves de reconciliació que comparen l'estat resultant
amb el d'una publicació normal.

**PR:** una PR dedicada.

### T13: Informes De Fallada Amb Motiu

**Abast:** quan les comprovacions locals fallen o el publicador refusa, la
persona rep igualment la resposta del model si n'hi ha, i la nota del servei
porta el motiu (per exemple quina comprovació ha fallat o quin camí s'ha
refusat) perquè el torn següent ho pugui corregir; un avortament durant les
comprovacions no es registra com a `checksFailed`. Fitxers:
`workflow/run-instruction.mjs` i `policy/development.mjs`.

**Exclusió immediata:** no exposa sortides crues d'eines a la persona.

**Dependències:** cap.

**Resultat observable:** cada fallada té un motiu registrat i la resposta del
model no es perd.

**Comprovacions mínimes:** proves de flux per a comprovació fallida, refús del
publicador i avortament.

**PR:** una PR dedicada.

### T14: Avisos De Publicacions Substituïdes

**Abast:** l'avís de fallada de la preview, també el de la sincronització abans
del merge, no es repeteix més enllà del que accepti l'ADR 0014 esmenat a T25, i
un commit que una publicació posterior del servei ha substituït no genera cap
avís de fallada. Les curses de les reparacions en cua desapareixen amb la
retirada de la reparació automàtica a T26. Fitxers:
`workflow/preview-request.mjs`, `workflow/ci-watch.mjs` i
`repository/ci-watch-store.mjs`.

**Exclusió immediata:** no toca la reparació automàtica, que retira T26.

**Dependències:** T26.

**Resultat observable:** cap avís fals ni repetit per publicacions substituïdes.

**Comprovacions mínimes:** proves dels avisos de preview i de CI.

**PR:** una PR dedicada.

### T15: Pont De Telegram

**Abast:** un àlbum no s'admet abans que se'n llegeixin les imatges posteriors;
una actualització només es marca com a processada després d'una admissió
correcta; `sendMessage` respecta `retry_after` una vegada davant un 429; el tall
de 4000 caràcters no parteix mai un parell de substitució; una resposta RPC
`success:false` diferent de la del prompt acaba el torn en lloc d'esperar el
temps límit. Fitxers: `packages/telegram-pi-bridge/src/telegram/bridge.mjs`,
`api.mjs` i `src/pi/rpc.mjs`.

**Exclusió immediata:** no canvia el model de cua ni de sessions.

**Dependències:** cap.

**Resultat observable:** els cinc comportaments tenen una prova pròpia.

**Comprovacions mínimes:** proves del paquet (`node --test`) i `pnpm test:server`.

**PR:** una PR dedicada.

### T16: Detalls De La Confirmació Del Merge

**Abast:** una pregunta que s'ha enviat però no s'ha desat no queda
contestable per un torn amb permís d'escriptura; una confirmació repetida rep una
resposta determinista; es decideix si una pregunta caduca (límit de temps
opcional). Fitxers: `workflow/merge-request.mjs` i
`repository/merge-request-store.mjs`.

**Exclusió immediata:** no canvia el flux de confirmació en dos passos.

**Dependències:** cap.

**Resultat observable:** la confirmació és determinista i el criteri de caducitat
queda decidit i registrat.

**Comprovacions mínimes:** proves de la confirmació amb enviament sense desat i
confirmació repetida.

**PR:** una PR dedicada.

### T17: Codi Mort I Branques Només De Proves

**Abast:** eliminar el residu entre temes (`fromAnotherTopic`, `source`, el SQL de
pertinença i els `lastReported*` només de proves a `ci-watch-store.mjs`), els
mètodes d'emmagatzematge només de proves, les dependències opcionals que la
producció sempre proporciona (`ciWatches ? … : undefined`,
`sessionNotes === undefined`, `attachmentStore === undefined`, els ganxos
opcionals de recerca), `researchReview.initialize()`, la branca de cancel·lació
inabastable de les aprovacions de divulgació, la comprovació duplicada després
del gate, la doble lectura de `main`, les comprovacions d'inactivitat
redundants, les exportacions no usades del paquet i l'entrada d'arrel.

**Exclusió immediata:** el comportament no canvia.

**Dependències:** cap, però s'ordena després de les correccions del bloc B que
toquen els mateixos fitxers.

**Resultat observable:** menys codi amb la mateixa funcionalitat.

**Comprovacions mínimes:** la suite existent verda sense afeblir assegurances;
`pnpm test:server`.

**PR:** una PR dedicada.

### T18: Migracions I Estat Antic

**Abast:** després de comprovacions de només lectura al VPS fetes per la persona mantenidora
(cap nom de worktree `topic_*` antic, cap arxiu `*-before-*`, cap fila de preview
en `commenting` ni `uncertain`, cada tema publicat té una fila a `topic_jobs`,
les columnes actuals presents), eliminar el canvi de nom d'identificadors i
`commands/migrate-identifiers`, la branca d'arxiu d'`ensureSessionWorktree`,
`topic-job-migration`, les migracions ad hoc de columnes i estats, i els estats
antics de preview. Les comprovacions prèvies es registren a la PR.

**Exclusió immediata:** no s'elimina res fins que la persona mantenidora confirmi les
comprovacions.

**Dependències:** comprovacions prèvies al VPS.

**Resultat observable:** el codi ja no conté camins de migració d'estats que no
existeixen.

**Comprovacions mínimes:** suite existent verda; `pnpm test:server`.

**PR:** una PR dedicada.

### T19: Retirada Del Classificador

**Abast:** eliminar `runtime/request-kind.mjs`, les crides de classificació i
el camí de petició de preview en llenguatge natural; els missatges ordinaris
executen sempre el torn del tema. Conciliar els torns de només lectura de la
recerca web amb l'especificació de T8.10 (tots els torns són d'escriptura i la
feina contaminada per la recerca continua exigint la revisió privada abans del
push) i actualitzar el text de T8.10 i T8.9 si cal.

**Exclusió immediata:** no canvia la preview ni el merge més enllà de retirar la
petició en llenguatge natural.

**Dependències:** T8.

**Resultat observable:** codi i especificació coincideixen: no hi ha cap
classificador i cap missatge es tracta de manera especial segons el seu contingut.

**Comprovacions mínimes:** `pnpm test:server` i `pnpm docs:check`.

**PR:** una PR dedicada.

### T20: Estructura Del Torn

**Abast:** dividir `execute` de `workflow/run-instruction.mjs` (unes 615 línies)
en funcions de fase amb nom, compartir la cua posterior a la publicació entre la
publicació ordinària i la sincronització del merge, un sol ajudant per a la
revalidació de la fixació del merge, i motius de resultat tipats en lloc
d'indicadors.

**Exclusió immediata:** el comportament no canvia.

**Dependències:** T9–T14.

**Resultat observable:** `execute` es llegeix com un esquema de fases.

**Comprovacions mínimes:** suite existent verda sense afeblir assegurances;
`pnpm test:server`.

**PR:** una PR dedicada.

### T21: Correccions Del Tractament D'Imatges

**Abast:** revisió del 25 de novembre de 2026. La reescriptura prevista, que
descodificava les imatges originals amb sharp dins del sandbox, es descarta
després de la revisió de seguretat: les imatges originals, amb GPS, haurien quedat
al worktree on s'executa codi del repositori. Es manté l'arquitectura actual (el
procés de confiança treu les metadades i només les imatges netes arriben al
sandbox) i se'n corregeixen quatre defectes: un JPEG amb dades després d'EOI es
talla a la primera EOI en lloc de refusar-lo; el perfil de color es conserva igual
en JPEG, PNG i WebP, amb un sol perfil ben situat i com a màxim 64 KiB; el
comptador d'adjunts no es reinicia ni reutilitza noms; i el format dels
megabytes reutilitza el del paquet. Fitxers: `attachments/image-format.mjs`,
`attachments/store.mjs` i `policy/development.mjs`.

**Exclusió immediata:** no amplia els formats ni els límits d'imatge i no mou la
descodificació al sandbox.

**Dependències:** cap. Necessita revisió de seguretat.

**Resultat observable:** les quatre fallades desapareixen sense que cap imatge
original arribi al worktree.

**Comprovacions mínimes:** proves d'adjunts i del pont.

**PR:** una PR dedicada.

### T22: Eines D'Operador

**Abast:** l'ordre d'actualització esdevé un script curt amb les garanties que
importen (commit revisat de `main`, comprovació d'ocupació, còpia, revisió);
l'ordre de traça esdevé una consulta de només lectura documentada; el CLI de
retenció es nega a executar-se mentre el servei és actiu.

**Exclusió immediata:** no canvia el procediment d'actualització acceptat a
[`docs/operations/agent.md`](../operations/agent.md#actualitzar) més enllà de la
simplificació.

**Dependències:** T4 si toca la verificació de versió.

**Resultat observable:** menys codi d'operador i les mateixes garanties.

**Comprovacions mínimes:** proves de les ordres; `pnpm docs:check`.

**PR:** una PR dedicada.

### T23: Paquet `telegram-pi-bridge`

**Abast:** mantenir-lo com a mòdul intern amb una API estreta fins que existeixi
un segon consumidor: eliminar la prova de tarball i autònoma, l'exemple i
l'entrada d'arrel.

**Exclusió immediata:** no mou el paquet de lloc ni canvia el seu comportament.

**Dependències:** T17.

**Resultat observable:** el paquet només exposa el que l'agent usa.

**Comprovacions mínimes:** proves del paquet i `pnpm test:server`.

**PR:** una PR dedicada.

### T24: Proves

**Abast:** fixtures compartits (repositori Git, simulacions de GitHub i
Telegram), eliminar les proves de funcionalitats eliminades, importar els textos
d'avís des de la política en lloc de cadenes escrites a mà, i dividir
`run-instruction.test.mjs` segons les fases de T20.

**Exclusió immediata:** no afebleix cap assegurança.

**Dependències:** T20.

**Resultat observable:** menys codi de test duplicat amb la mateixa cobertura.

**Comprovacions mínimes:** `pnpm test:server`.

**PR:** una PR dedicada.

### T25: Esmena Dels ADR 0013 I 0014

**Abast:** una sola PR de documentació que esmena l'ADR 0013 (el merge es limita
a les PR només de contingut; sense reexecució de jobs ni permís `Actions: write`;
sense reparació automàtica de CI) i l'ADR 0014 (avisos de CI repetibles). Abans
d'esmenar, la PR registra com a evidència quantes reparacions consten a la traça
privada (només el recompte, sense dades privades).

**Exclusió immediata:** només documentació d'ADR; cap canvi de codi ni de
permisos remots.

**Dependències:** cap. S'executa just després de T1.

**Resultat observable:** els ADR reflecteixen les decisions de la persona
mantenidora.

**Comprovacions mínimes:** `pnpm docs:check`.

**PR:** una PR dedicada d'esmena, amb títol `docs(agent-audit-t25): …`.

### T26: Aplicar L'Esmena

**Abast:** implementar les decisions de T25: eliminar la reexecució de jobs
fallits, la taula `ci_reruns` i els estats relacionats; fer repetibles els
avisos de CI (eliminant els estats d'avís `sending` i `uncertain` i la
reconciliació `--kind notice`); eliminar la reparació automàtica de CI
(`workflow/ci-repair.mjs`, la taula `ci_repairs`, els avisos i els prompts de
reparació); actualitzar el README de l'agent i el document d'operació. Després
de la fusió, la persona mantenidora retira `Actions: write` del token (canvi
remot fet per una persona).

**Exclusió immediata:** els agents no toquen el token ni cap configuració remota.

**Dependències:** T25.

**Resultat observable:** codi, permisos documentats i documents propietaris
coincideixen amb l'esmena.

**Comprovacions mínimes:** `pnpm test:server` i `pnpm docs:check`.

**PR:** una PR dedicada.

### T27: Estat Unificat

**Abast:** una sola base de dades SQLite amb una fila per commit publicat (CI,
preview, identificador d'avís) en lloc de quatre registres de la mateixa
publicació; com a màxim uns quatre estats per taula; migracions amb
`PRAGMA user_version`.

**Exclusió immediata:** no canvia el comportament observable.

**Dependències:** T18, T26.

**Resultat observable:** una publicació té un únic registre.

**Comprovacions mínimes:** proves de migració des de les bases actuals;
`pnpm test:server`.

**PR:** una PR dedicada, o dividida si la revisió ho exigeix.

### T28: Documentació De L'Agent

**Abast:** el README de l'agent esdevé una visió general curta (unes 250
línies) amb un diagrama i una taula d'estats; les regles detallades viuen amb el
codi que descriuen; el document d'operació conserva instal·lació,
actualització, retrocés, còpies, reconciliació i incidents (els registres del
pilot passen a l'especificació de la fase); l'ADR 0013 rep un resum «Decisió
vigent» al capdamunt; es decideix si `docs/phase-8-system-map.html` es genera o
s'elimina.

**Exclusió immediata:** no canvia comportament.

**Dependències:** la majoria de tasques; és l'última.

**Resultat observable:** la documentació descriu l'estat final sense duplicats.

**Comprovacions mínimes:** `pnpm docs:check`; revisió de la propietat segons la
skill `docs-ownership`.

**PR:** una PR dedicada.

## Troballes De L'Auditoria

| Troballa                                                                                                                                                                                               | Tasca |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Repositoris niats i submòduls del worktree arriben al Git del servei                                                                                                                                   | T1    |
| `/merge` no limita quins fitxers es fusionen                                                                                                                                                           | T2    |
| Credencials a l'entorn del procés                                                                                                                                                                      | T3    |
| La llista de variables del proveïdor accepta els noms de les variables del servei                                                                                                                      | T3    |
| Títol i cos de la PR sense límits                                                                                                                                                                      | T6    |
| Versió de Pi no fixada                                                                                                                                                                                 | T4    |
| Un error del proveïdor en un torn no es tracta com a fallada                                                                                                                                           | T9    |
| Límit per línia del RPC davant les imatges del prompt                                                                                                                                                  | T5    |
| Una sincronització de merge fallida deixa un commit local sense publicar i `/merge` entra en bucle                                                                                                     | T10   |
| Les vigilàncies de CI i les peticions de preview no caduquen quan les lectures fallen                                                                                                                  | T11   |
| `/merge` sobre una PR fusionada o tancada respon «il·legible»                                                                                                                                          | T11   |
| Un merge incert bloqueja l'ordre d'actualització sense via per a l'operador                                                                                                                            | T11   |
| La reconciliació no restaura tot el que deixa una publicació                                                                                                                                           | T12   |
| Una PR absent després d'un push es classifica com a refús local                                                                                                                                        | T12   |
| Les fallades perden la resposta del model i el motiu                                                                                                                                                   | T13   |
| Un avortament durant les comprovacions es registra com a fallada de comprovació                                                                                                                        | T13   |
| Reparacions en cua i reserves competeixen amb publicacions més noves                                                                                                                                   | T14   |
| L'avís de fallada de la preview es pot repetir                                                                                                                                                         | T14   |
| Un àlbum s'admet abans d'hora                                                                                                                                                                          | T15   |
| Una actualització es marca com a processada abans de l'admissió                                                                                                                                        | T15   |
| `sendMessage` ignora `retry_after`                                                                                                                                                                     | T15   |
| El tall de text pot partir un parell de substitució                                                                                                                                                    | T15   |
| El RPC espera el temps límit després d'una resposta fallida que no és la del prompt                                                                                                                    | T15   |
| Recerca web: el treball nou depèn de l'ordre de la cua, els torns de només lectura depenen de l'indicador de recerca, el descriptor de fitxer no té prova i el filtre d'identificadors és massa estret | T8    |
| L'esmena de l'ADR de la recerca web continua «proposada» (acceptació)                                                                                                                                  | T7    |
| Imatges: JPEG amb dades finals refusat, perfil de color eliminat de manera inconsistent i reutilització del comptador d'adjunts                                                                        | T21   |

Troballes ja corregides a `main`:

- #299: neteja dels contenidors en paral·lel.
- #307: inici de la publicació després de l'escaneig local, ordre de
  comprovació després de la sincronització i conflictes binaris detectats abans
  del torn del model.
- #305: worktrees de temes fusionats recuperats.
- #309: pressupost del RPC, parcialment (la resta és a T5).

## Estratègia De Tests I Qualitat

Cada tasca afegeix o ajusta proves al nivell més barat que detecti la regressió,
segons [`docs/testing-strategy.md`](../testing-strategy.md). Les tasques que
conserven el comportament mantenen verda la suite existent sense afeblir
assegurances; les de seguretat afegeixen proves negatives. S'executen
`pnpm test:server`, `pnpm docs:check` i `pnpm check:local` segons correspongui.
Cada PR té una revisió independent.

## Seguretat I Privacitat

El document és públic: no conté detalls d'explotació, credencials ni
identificadors. Les tasques de seguretat són prioritàries i la persona mantenidora
actualitza el VPS poc després de fusionar-les. La simplificació no elimina mai un
control exigit per un ADR sense una esmena prèvia.

## Fora D'Abast

- Funcionalitats noves i el xat públic.
- El desplegament a producció i els canvis de configuració remota fets per
  agents.
- Fusionar PR.

## Criteris D'Acceptació

1. Cada tasca és `Completada` o descartada explícitament amb el motiu registrat
   aquí.
2. Cap troballa crítica o alta queda oberta.
3. Els documents vius descriuen el comportament resultant.
4. Les línies de codi es tornen a mesurar amb l'ordre de la línia base i es
   registra el resultat.
