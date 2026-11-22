# Agent privat de desenvolupament

L'agent privat rep instruccions en un grup privat de Telegram i les porta fins a
una PR, una preview o un merge demanat. Aquest document descriu l'operació del
component: la identitat i les peces, la configuració, la instal·lació,
l'arrencada i l'aturada, l'actualització, la rotació de credencials, les còpies i
la restauració, la retenció, la consulta de la traça, la reconciliació de
resultats desconeguts i la verificació.

El comportament implementat, amb les fronteres de confiança i el recorregut d'una
petició, viu només a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md). El contingut
genèric del servidor —destí, identitats, còpies de seguretat, logs i salut— és a
[`docs/operations/README.md`](README.md); les previews de PR, a
[`docs/operations/previews.md`](previews.md), i el desplegament continu de la web
i les releases, a
[`docs/operations/web-and-releases.md`](web-and-releases.md).

Aturar el servei, arrencar-lo o actualitzar-lo requereix l'aprovació explícita de
la persona mantenidora. L'agent no desplega, no opera producció i no comparteix
credencials amb les releases, Caddy ni les previews.

## Com funciona

L'agent és una aplicació que porta una petició de Telegram fins a una PR. Les
eines viuen a `tools/server/agent/`; el nucli reutilitzable, la disposició del
codi i el recorregut d'una petició són a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md).

| Component           | Accés                                                                                                                                | Límit                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pont de Telegram    | Token del bot, grup configurat, cua duradora i traça privada                                                                         | No entrega cap credencial a Pi, a l'entorn aïllat ni a les proves                                                                                                                                                       |
| Pi i model          | Credencial del proveïdor i sessions per tema                                                                                         | Confiança de projecte denegada: no carrega extensions, hooks ni `settings` del repositori                                                                                                                               |
| Entorn aïllat       | Worktree de la feina                                                                                                                 | Sense xarxa, sense credencials, sistema de fitxers de només lectura, sense socket de Docker                                                                                                                             |
| Component de GitHub | Compte `rboixaderg`: `push` de la branca, obertura o reutilització de la PR, lectura de la CI del commit publicat i el merge demanat | Sense auto-merge, push a `main`, canvis de protecció ni desplegament; l'únic merge és el squash demanat amb `/merge`, amb el detall al [README del component](../../tools/server/agent/README.md#merge-demanat-al-tema) |

El detall de la frontera, amb l'aïllament del sandbox, la llista blanca d'entorn,
l'escaneig de secrets i els terminis, és a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md#fronteres-de-confiança).

## Com s'opera

### Identitat i peces

| Peça                      | Valor                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Unitat                    | `mountain-agent.service`, instal·lada a `/etc/systemd/system/` des de `tools/server/systemd/mountain-agent.service`                 |
| Identitat del servei      | Usuari i grup `mountain-agent`, sense shell; `UMask=0077`                                                                           |
| Codi instal·lat           | `/usr/local/lib/mountain-runners/agent/` i el paquet `/usr/local/lib/mountain-runners/node_modules/telegram-pi-bridge/`             |
| Estat i treball           | `/var/lib/mountain-runners-agent/` (`0700`) amb `repository/`, `worktrees/`, `sessions/`, `state/` i `tmp/`                         |
| Volums                    | Dos ext4 preassignats: 11 GiB per a Podman, repositori i worktrees, i 1 GiB per a la cua, la traça i l'estat                        |
| Configuració              | `/etc/mountain-runners-agent/agent.env` (`0600`), amb el directori `/etc/mountain-runners-agent/` (`0750` de `root:mountain-agent`) |
| Imatge de l'entorn aïllat | Fixada amb `MOUNTAIN_AGENT_SANDBOX_IMAGE`; sense l'etiqueta `latest` i present al magatzem local de Podman abans d'arrencar         |
| Model                     | `MOUNTAIN_AGENT_MODEL`; si no s'informa, el servei usa `opencode-go/glm-5.3-flash`                                                  |
| Límits de la unitat       | 1,5 CPU, 2560 MiB, 384 tasques i `TimeoutStopSec=30`                                                                                |

El VPS usa Node 24.22.3 del repositori apt `node_24.x` de NodeSource. La versió
de Node és la mateixa a `.node-version`, al VPS i a la imatge del sandbox, i les
tres peces es mouen juntes: actualitzar Node vol dir reconstruir la imatge a
partir de `tools/server/agent/sandbox/Containerfile` i canviar
`MOUNTAIN_AGENT_SANDBOX_IMAGE` abans d'arrencar el servei.

Les credencials es declaren només pel nom: `MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN`,
`MOUNTAIN_AGENT_GITHUB_TOKEN` i les que llista
`MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES` per al proveïdor del model. Els
valors viuen només a `agent.env`, amb mode `0600` i el propietari de la
identitat del servei. Els noms de les variables del servei són a
`.env.example`; els valors no
es copien mai al repositori, al tema, a la PR ni a un registre. El token de
Telegram i el de GitHub no arriben a Pi, al contenidor ni al model, i el del
proveïdor només arriba a Pi.

### Configuració

Les variables es documenten, sense valors, a `.env.example`. El fitxer real viu
fora del repositori a `/etc/mountain-runners-agent/agent.env`, amb mode `0600` i
propietat de la identitat del servei. La instal·lació prevista és:

```text
/var/lib/mountain-runners-agent/           0700  mountain-agent:mountain-agent
├── repository/                            clon amb origin i main
├── worktrees/                             worktree actual per tema i feina preservada
├── sessions/                              historial de Pi per tema
└── state/                                 identifier-salt, admission.sqlite, ci-watch.sqlite (avisos i reparacions), preview-request.sqlite (peticions de preview i URL confirmada), merge-request.sqlite (peticions de merge), topic-jobs.sqlite (branca i PR per tema), session-notes.sqlite (efectes i última resposta de cada tema), attachments/ (imatges per tema, 7 dies), perfils i traça
/etc/mountain-runners-agent/agent.env      0600  credencials del servei
/usr/local/lib/mountain-runners/agent/     aplicació instal·lada
/usr/local/lib/mountain-runners/node_modules/
└── telegram-pi-bridge/                    paquet autònom, sense node_modules propi
```

`MOUNTAIN_AGENT_BASE_BRANCH`, si s'informa, ha de ser `main`. La imatge de
l'entorn aïllat ha d'estar fixada i no pot usar l'etiqueta `latest`.

`MOUNTAIN_AGENT_REQUIRED_CHECKS` és obligatori i conté, separats per comes, els
noms exactes de les comprovacions obligatòries de `main`. Verificat el 14 de
novembre de 2026, la protecció de `main` exigeix aquestes set comprovacions amb
la branca al dia:

```text
Validate, Conventional commits, Conventional title, Gitleaks, Dependency review, Analyze JavaScript and TypeScript, CodeQL
```

La credencial de l'agent no pot llegir la protecció de branca (respon 403), així
que la llista es configura explícitament. Un nom incorrecte no es converteix mai
en verd: la comprovació queda absent i l'avís acaba com a no confirmat. Si canvia
la protecció de `main`, actualitza la llista al mateix moment: el servei no la pot
contrastar i l'avís només confirma les comprovacions que hi consten.

L'interval de consulta i el termini del seguiment de CI tenen valors inicials al
codi (`MOUNTAIN_AGENT_CI_POLL_INTERVAL_MS`, `MOUNTAIN_AGENT_CI_WATCH_TIMEOUT_MS`).

### Recursos i emmagatzematge

Els límits numèrics (CPU, memòria, processos, temps d'execució i cua) tenen valors
inicials al codi. La unitat limita el conjunt del servei i els seus contenidors a 1,5 CPU,
2560 MiB de memòria, sense swap i 384 processos. Cada contenidor té inicialment
1 CPU i 2048 MiB; el límit de la unitat inclou també Pi i el pont. Aquests
valors són provisionals i **no estan verificats al VPS** de 2 vCPU, 4 GB i 40 GB,
que comparteix amb la resta de serveis. L'emmagatzematge previst utilitza dos
volums ext4 preassignats: 11 GiB per a Podman, repositori i worktrees, i 1 GiB
separat per a la cua i la traça. La quota no inclou el journal ni `/run`; cal
limitar-los i comprovar-ne l'impacte abans d'activar el pilot.

Les unitats de muntatge viuen a `tools/server/systemd/`. Abans d'arrencar,
`storage/verify-volumes.mjs` comprova els dos punts de muntatge, el dispositiu
loop, el fitxer de suport, la mida, la reserva física, els permisos i les rutes
de configuració. També comprova el magatzem rootless de Podman. Una fallada
impedeix l'arrencada. La verificació no substitueix les proves reals de disc
ple, recuperació i publicació segura.

La inicialització diferida d'ext4 pot alliberar blocs del fitxer després del
primer muntatge, fins i tot amb `nodiscard`. Per això els volums nous es creen
amb la inicialització completa de la taula d'inodes i del journal, i es tornen
a reservar després del format. Comprova la reserva també després de muntar-los.

`nodiscard` no impedeix una ordre `fstrim` explícita: aquesta pot alliberar la
reserva física mentre l'agent funciona. No executis `fstrim` sobre aquests dos
volums ni els afegeixis a una selecció automàtica de trim. Abans del pilot,
comprova la configuració efectiva del temporitzador del host i la seva selecció
amb una prova en sec. Al VPS actual, `fstrim.service` usa `--listed-in` amb
`/etc/fstab` com a primera font; mentre aquest fitxer no sigui buit, la prova en
sec ha de mostrar només els sistemes previstos i excloure els dos volums de
l'agent. Torna a comprovar-ho si canvien el servei o `fstab`. El verificador
només comprova la reserva abans d'arrencar; no detecta una pèrdua posterior en
temps real.

Si la reserva és incompleta, no arrenquis l'agent ni tornis a formatar els
volums. Amb aprovació explícita, atura el servei i els processos que els usin;
comprova que els dispositius loop apunten als fitxers esperats i desmunta primer
l'estat i després el treball. Comprova els dos sistemes de fitxers fora de línia,
reserva de nou els fitxers amb `fallocate` sense canviar-ne la mida i repeteix
la comprovació. Munta primer el treball i després l'estat. Verifica la reserva,
els continguts necessaris i `verify-volumes.mjs` abans de reprendre el pilot.
Investiga i elimina la causa de la pèrdua abans de donar-la per resolta.

### Instal·lació prevista

El procediment següent és la primera instal·lació del servei, ja executada al
VPS. Només es repeteix per instal·lar-lo en un servidor nou i cada ordre
requereix aprovació explícita. Crea una identitat, un clon i una unitat separats
de producció i de previews. Per actualitzar una instal·lació existent, segueix
[la secció d'actualització](#actualitzar): aquest script formata volums.

```sh
# Primera instal·lació. Requereix aprovació explícita abans de cada pas.
set -eu
useradd --system --home /var/lib/mountain-runners-agent \
  --shell /usr/sbin/nologin mountain-agent
# Refusa una instal·lació existent; no sobreescriguis mai volums amb dades.
test ! -e /var/lib/mountain-runners-agent-volumes
mkdir -m 0711 /var/lib/mountain-runners-agent-volumes
umask 077
( set -C; : > /var/lib/mountain-runners-agent-volumes/work.ext4 )
( set -C; : > /var/lib/mountain-runners-agent-volumes/state.ext4 )
fallocate -l 11G /var/lib/mountain-runners-agent-volumes/work.ext4
fallocate -l 1G /var/lib/mountain-runners-agent-volumes/state.ext4
mkfs.ext4 -E nodiscard,lazy_itable_init=0,lazy_journal_init=0 /var/lib/mountain-runners-agent-volumes/work.ext4
mkfs.ext4 -E nodiscard,lazy_itable_init=0,lazy_journal_init=0 /var/lib/mountain-runners-agent-volumes/state.ext4
# Verifica la reserva després de formatar; mkfs pot desassignar blocs.
fallocate -l 11G /var/lib/mountain-runners-agent-volumes/work.ext4
fallocate -l 1G /var/lib/mountain-runners-agent-volumes/state.ext4
install -m 0644 'tools/server/systemd/var-lib-mountain\x2drunners\x2dagent.mount' /etc/systemd/system/
install -m 0644 'tools/server/systemd/var-lib-mountain\x2drunners\x2dagent-state.mount' /etc/systemd/system/
systemctl daemon-reload
systemctl start 'var-lib-mountain\x2drunners\x2dagent.mount'
chown mountain-agent:mountain-agent /var/lib/mountain-runners-agent
chmod 0700 /var/lib/mountain-runners-agent
install -d -m 0700 -o mountain-agent -g mountain-agent \
  /var/lib/mountain-runners-agent/state
systemctl start 'var-lib-mountain\x2drunners\x2dagent-state.mount'
chown mountain-agent:mountain-agent /var/lib/mountain-runners-agent/state
chmod 0700 /var/lib/mountain-runners-agent/state
# Comprova que els blocs reservats cobreixen la mida lògica de cada fitxer.
stat -c '%n size=%s blocks=%b blocksize=%B' \
  /var/lib/mountain-runners-agent-volumes/{work,state}.ext4
install -d -m 0700 -o mountain-agent -g mountain-agent \
  /var/lib/mountain-runners-agent/{repository,worktrees,sessions,tmp}
install -d -m 0750 -o root -g mountain-agent /etc/mountain-runners-agent
runuser -u mountain-agent -- git clone --branch main \
  https://github.com/rboixaderg/mountain-runners.git \
  /var/lib/mountain-runners-agent/repository
install -d -m 0755 /usr/local/lib/mountain-runners/agent
cp -a tools/server/agent/. /usr/local/lib/mountain-runners/agent/
install -d -m 0755 \
  /usr/local/lib/mountain-runners/node_modules/telegram-pi-bridge
cp -a packages/telegram-pi-bridge/{src,examples,package.json,LICENSE,README.md} \
  /usr/local/lib/mountain-runners/node_modules/telegram-pi-bridge/
install -m 0644 tools/server/systemd/mountain-agent.service \
  /etc/systemd/system/mountain-agent.service
# Abans d'arrencar: agent.env amb els noms de `.env.example` i la imatge
# aïllada fixada i ja present localment.
systemctl daemon-reload
```

Abans d'arrencar, cal Linux amb cgroup v2, systemd 254 o posterior, Podman
local sense root, un runtime OCI compatible i els helpers `newuidmap` i
`newgidmap`. Una persona
administradora ha d'assignar rangs no solapats a `mountain-agent` a `/etc/subuid`
i `/etc/subgid`, sense incloure UID/GID de comptes reals del VPS, i preparar
l'emmagatzematge i la imatge de Podman amb aquest
usuari. No s'usa `podman.socket`, ni `sudo podman`, ni el magatzem d'imatges de
root. Si s'havia seguit una versió anterior del procediment, cal retirar la
pertinença al grup Docker abans d'activar el servei. La instal·lació ha de
comprovar que `podman --remote=false info --format '{{.Host.Security.Rootless}}'`
retorna `true` com a `mountain-agent`, i demostrar els límits dins del cgroup
delegat de la unitat. Al VPS aquestes comprovacions consten a
[la verificació al VPS](#verificació-al-vps).

La imatge aïllada ha d'incloure Node 24.22.3, pnpm, git, Chromium, `sharp` de
`apps/web` i les altres dependències que necessita `pnpm check`, perquè el
contenidor no té xarxa. `sharp` arriba al store fora de línia com la resta de
dependències i el servei el fa servir per reduir imatges dins del sandbox.
El perfil de l'agent executa les proves de navegador només amb Chromium abans
de publicar la PR. La CI executa la prova completa i els E2E també amb Firefox
i WebKit; la protecció de `main` ha d'exigir que la CI passi abans del merge.
El paquet no requereix instal·lar dependències ni compilar-lo al servidor.
La disposició instal·lada del servei i del paquet es comprova amb una prova
local sense symlinks al workspace; no equival a haver-lo desplegat.
El clon del servei no comparteix el worktree principal de la persona mantenidora ni el de cap altra
feina local.

La versió de Node és la mateixa a tot arreu: `.node-version`, el VPS i la imatge
del sandbox. El VPS usa Node 24.22.3 del repositori apt `node_24.x` de
NodeSource. Actualitzar Node és un sol canvi: puja la versió a `.node-version` i
a l'apartat `engines.node`, reconstrueix la imatge del sandbox a partir del
`sandbox/Containerfile` i canvia `MOUNTAIN_AGENT_SANDBOX_IMAGE` abans d'arrencar
el servei.

### Activar, aturar i reiniciar

```sh
sudo systemctl start mountain-agent
sudo systemctl stop mountain-agent
sudo systemctl restart mountain-agent
systemctl status mountain-agent
sudo journalctl -u mountain-agent -n 100
```

No l'aturis, l'arrenquis ni l'habilitis a l'arrencada del sistema sense
aprovació. Una aturada no esborra res: worktrees, feina sense publicar,
sessions, estat, branques i PR publicades continuen. Els contenidors del sandbox s'eliminen sols
(`--rm`) i una ordre en curs queda amb resultat desconegut. Una aturada amb un
contenidor obert pot arribar als 30 segons de `TimeoutStopSec`, perquè el procés
`pause` de Podman sense root no respon a `SIGTERM` i systemd acaba matant-lo.

El contenidor de cada ordre s'executa amb `--rm`: conmon l'elimina sol quan el
procés mor. Una aturada ordenada i una mort sobtada del pont deixen el mateix
resultat, cap contenidor ni cap registre residual. El contenidor viu dins del
cgroup de la unitat, de manera que `MemoryMax`, `CPUQuota` i `TasksMax` cobreixen
també la feina del model. Tota aturada amb un contenidor obert arriba al límit
`TimeoutStopSec=30` i és systemd qui l'ha de matar; amb el valor per defecte de
90 segons cada reinici s'endarreria tant. El límit s'ha de mantenir per sobre del
temps de neteja ordenada d'un torn interromput.

`Restart=on-abnormal`, amb `StartLimitIntervalSec=5min` i `StartLimitBurst=3`,
evita dos bucles: una arrencada que refusa feina interrompuda amb resultat
desconegut queda fallida per a la persona operadora en lloc de reintentar-se, i
una seqüència de caigudes s'atura després de tres intents. Una caiguda o una
mort per falta de memòria sí que es reprèn.

Si el servei refusa arrencar, no insisteixis: un reinici marca com a incert el
treball en curs i la negativa es manté fins que una persona reconciliï el cas.
`Restart=on-abnormal` i `StartLimitBurst=3` eviten bucles, així que tres
arrencades fallides aturen el reintent automàtic. Segueix la
[reconciliació de resultats desconeguts](#reconciliació-de-resultats-desconeguts).
Si falla `ExecStartPre`, el cas és dels volums: comprova la reserva i els
muntatges segons la
[instal·lació prevista](#installació-prevista) i no tornis a
formatar cap volum amb dades.

Verificat al VPS l'11 de novembre de 2026 amb una unitat transitòria equivalent:
`SIGKILL` al pont amb una ordre llarga oberta dins del contenidor, contenidor
eliminat, cap procés ni registre residual i arrencada posterior neta. Els límits
llegits del cgroup van ser 2560 M de memòria, 150 % de CPU i 384 tasques. El
consum del procés `pause` es compta a la unitat, no al contenidor.

### Actualitzar

L'actualització la fa una persona operadora o una sessió local d'agent d'IA, en
una màquina controlada per la persona mantenidora, que ha rebut la seva
aprovació explícita a la mateixa conversa. Una aprovació arribada per Telegram
no hi compta. Només s'instal·la un commit revisat de `main`. Aquest procediment
no s'aplica a la web de producció, que només es desplega amb el
[flux continu](web-and-releases.md#desplegament-continu-des-de-main), i l'agent de Telegram no
s'actualitza mai a si mateix.

1. Confirma que el commit és a `main` i que l'ha revisat una persona. La
   instal·lació copia fitxers i no desa cap marca del commit instal·lat, així que
   comprova el que hi ha ara: compara `/usr/local/lib/mountain-runners/agent/`
   amb `tools/server/agent/` d'una còpia del commit instal·lat, per exemple amb
   `diff -r`.
2. Compara `.env.example` amb `agent.env` i afegeix-hi les variables noves abans
   d'arrencar. Revisa si el commit nou canvia l'esquema de `state/`; si el canvia,
   fes la [còpia de l'estat](#còpies-i-restauració) abans d'instal·lar.
3. Atura el servei i conserva la instal·lació actual per poder tornar enrere:

   ```sh
   sudo systemctl stop mountain-agent
   sudo install -d -m 0700 /var/backups/mountain-runners-agent
   sudo cp -a /usr/local/lib/mountain-runners/agent \
     /var/backups/mountain-runners-agent/agent-previous
   ```

4. Copia el codi i el paquet del commit revisat amb el procediment de la
   [instal·lació prevista](#installació-prevista). `cp -a` no
   esborra fitxers retirats: si el commit nou elimina un mòdul, substitueix el
   directori sencer en lloc de copiar-hi a sobre. Si el commit fixa una imatge
   diferent, ha d'estar al magatzem de `mountain-agent` abans d'arrencar;
   descarregar-la necessita xarxa i aprovació.
5. Comprova els volums; la unitat ho fa a `ExecStartPre` amb
   `storage/verify-volumes.mjs`. Reinicia el servei, comprova
   `systemctl is-active mountain-agent` i el journal, i fes una consulta al tema
   que no hagi de crear cap branca.
6. **Tornar enrere.** Atura el servei, restaura la còpia anterior a
   `/usr/local/lib/mountain-runners/agent/` i el paquet si va canviar, reinicia i
   repeteix la comprovació. Si el commit nou havia canviat l'esquema de `state/`,
   restaura també l'estat; si no tens aquesta còpia, no tornis enrere sense
   aprovació explícita.

### Migració de noms

L'ordre d'actualització és actualitzar el codi, executar la migració com a pas
d'operador, reconciliar els casos que bloquegen l'arrencada i arrencar el
servei. La migració no necessita el servei en marxa:

- Executa-la amb la identitat del servei:

  ```sh
  systemd-run --pipe --wait --uid=mountain-agent --gid=mountain-agent \
    -p EnvironmentFile=/etc/mountain-runners-agent/agent.env -p UMask=0077 \
    /usr/bin/node /usr/local/lib/mountain-runners/agent/commands/migrate-identifiers/cli.mjs
  ```

Des del repositori, el mateix programa és
`node tools/server/agent/commands/migrate-identifiers/cli.mjs`. La
reconciliació no crea el salt ni migra res: si el salt no existeix o queda
cap worktree amb un nom antic, `list` i `resolve` d'una instrucció fallen amb
codi 1 i demanen executar la migració abans. Els casos de reparació i
avís no en depenen. Si encara no s'ha instal·lat la versió que retira les
peticions `/preview`, comprova abans la precondició de
[Reinicis](../../tools/server/agent/README.md#preview-demanada-al-tema).

### Rotació de credencials

Els valors no es mostren mai en aquest document, al tema, a la PR ni a la sortida
d'una ordre. Edita `agent.env` com a root i comprova que conserva el mode `0600`.

| Credencial                | On es genera               | Abast                                                                                                                                                                       |
| ------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token del bot de Telegram | BotFather                  | Només el bot del grup configurat                                                                                                                                            |
| Token de GitHub           | Compte de l'agent a GitHub | `Contents: write`, `Pull requests: write`, lectura de checks i estats, `Actions: write` per reexecutar una comprovació; sense `Workflows: write` ni lectura d'administració |
| Credencial del model      | Proveïdor del model        | Només la crida al model; arriba a Pi i no al pont                                                                                                                           |

1. Genera la credencial nova a l'emissor i no revoquis l'antiga encara. El token
   de Telegram és l'excepció: el bot en té un de sol i revocar-lo invalida
   l'anterior de seguida.
2. Atura el servei.
3. Substitueix el valor a `agent.env` i comprova el mode i el propietari.
4. Arrenca el servei, revisa el journal i fes al tema una consulta que no hagi de
   crear cap branca.
5. Revoca la credencial anterior a l'emissor i comprova que el servei segueix
   treballant.

Per al token de GitHub, crea'l amb el mateix àmbit i els mateixos permisos; els
dos conviuen mentre fas el canvi. Comprova que el nou refusa escriure a
`.github/workflows` i llegir l'administració abans de revocar l'antic. Si una
credencial s'ha exposat en una sortida, un registre o una PR, rota-la de seguida,
revisa la traça i les PR obertes del compte de l'agent i informa la persona
mantenidora.

### Còpies i restauració

Atura el servei abans de copiar l'estat o les sessions; així les bases de dades
són coherents. Copia:

| Element       | Contingut                                                                                                                                                           | Criteri                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state/`      | `admission.sqlite` (cua i traça), `ci-watch.sqlite`, `preview-request.sqlite` (peticions i URL confirmada), `merge-request.sqlite`, `session-notes.sqlite`, perfils | Imprescindible: és la memòria recuperable del servei                                                                                                |
| `sessions/`   | Historial de Pi per tema                                                                                                                                            | Imprescindible si es vol conservar el context conversacional                                                                                        |
| `worktrees/`  | Feina en curs i feina preservada                                                                                                                                    | Copia els worktrees amb commits sense publicar o canvis sense cometre; un worktree net i sense commits per davant de `origin/main` es pot descartar |
| `repository/` | Clon amb `origin` i `main`                                                                                                                                          | Es pot tornar a clonar                                                                                                                              |
| `agent.env`   | Credencials                                                                                                                                                         | Copia'l com un secret, mai al costat de les dades ni al repositori                                                                                  |
| Unitats       | `mountain-agent.service` i les dues unitats de muntatge dels volums                                                                                                 | Es tornen a instal·lar des del commit revisat                                                                                                       |

Ordre de restauració:

1. Recrea la identitat, els volums i els muntatges amb la
   [instal·lació prevista](#installació-prevista). Munta primer el
   treball i després l'estat, i no formatis cap volum amb dades.
2. Restaura els continguts amb el propietari `mountain-agent:mountain-agent` i
   mode `0700`.
3. Restaura `agent.env` com a root amb mode `0600`. Si la còpia ha pogut quedar
   accessible a tercers, fes la [rotació](#rotació-de-credencials) abans
   d'arrencar.
4. Instal·la el codi del commit revisat que correspon a l'estat restaurat.
5. Executa `storage/verify-volumes.mjs` i la
   [reconciliació](#reconciliació-de-resultats-desconeguts)
   abans d'arrencar: una còpia pot contenir un cas incert del moment de la
   còpia.
6. Arrenca el servei i comprova el journal i una consulta sense branca.

Una restauració no desfà res a GitHub: les branques, PR, comentaris i merges
publicats hi continuen. Després de restaurar, revisa les PR obertes del compte de
l'agent i la traça per saber què es va publicar. Les còpies contenen la traça i
l'historial amb identificadors de Telegram: tracta-les com a dades privades i no
les restauris en una altra màquina per provar.

**Cobertura dels backups del VPS: comprovació pendent.** La documentació del
projecte no diu si els backups automàtics de Hetzner (secció
[còpies de seguretat i restauració](README.md#còpies-de-seguretat-i-restauració)) inclouen `/var/lib/mountain-runners-agent`
i `/etc/mountain-runners-agent`. Comprova-ho abans del pilot. Si no hi són, cal
una còpia separada d'aquestes rutes i una restauració de prova amb el servei
aturat.

### Retenció

Decisió de la persona mantenidora: per ara no s'esborra res automàticament. La
traça privada, les bases de dades de `state/` i l'historial de Pi de `sessions/`
es conserven fins a una revisió explícita. Les identitats dels efectes ja
lliurats a la sessió (`session_delivered_effects`) tampoc no es poden: cada
reintent d'un avís les consulta, i la mida és d'unes poques desenes de bytes per
efecte.

Els worktrees arxivats segueixen la neteja que preserva treball no publicat. A
l'arrencada el servei elimina només els worktrees arxivats sense commits per
davant d'`origin/main` i sense canvis pendents, i sempre conserva l'arxiu més
recent de cada tema. La comanda
`node storage/prune-worktrees.mjs --dry-run`, executada com la identitat del
servei, mostra la mateixa decisió sense esborrar res; sense `--dry-run`
l'aplica. Un worktree amb treball no publicat o sense cometre no s'esborra
mai, i el worktree actiu del tema tampoc.

- **Cost estimat.** La traça i les bases de `state/` creixen pocs MB l'any i
  queden lluny de l'1 GiB del volum d'estat. L'historial de Pi és el que creix
  més, perquè desa les sortides de les eines, però amb una desena de temes
  actius s'estima en centenars de MB dins del volum de treball d'11 GiB. Són
  estimacions, no mesures del VPS.
- **Vigilància.** La comprovació periòdica mira l'ús dels dos volums:
  `df -h /var/lib/mountain-runners-agent /var/lib/mountain-runners-agent/state`
  i `du -sh /var/lib/mountain-runners-agent/{sessions,worktrees,state}`.
- **Revisió.** Cal revisar aquesta decisió i fixar terminis si un dels dos
  volums passa del 50 %, abans d'ampliar el pilot a més persones o quan una
  persona demani esborrar les seves dades.
- **Còpies.** Si hi ha còpies de seguretat del VPS, també contenen la traça i
  l'historial. Esborrar l'original no esborra les còpies; la revisió les ha
  d'incloure. La còpia de `state/` ha d'incloure `identifier-salt`: sense aquest
  fitxer canvien els noms opacs i els worktrees existents queden orfes.
  `state/attachments/` conté imatges privades dels temes; s'esborren en
  publicar-se o al cap de set dies, però una còpia de seguretat anterior encara
  les pot contenir.

### Revocació

Treure una persona del grup talla les instruccions noves i no
cancel·la la feina ja acceptada. Per tallar-ho tot, atura el servei; per
revocar una credencial, fes la [rotació](#rotació-de-credencials). El detall de
què continua i què es torna a comprovar és a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md#sessions-admissió-i-recuperació).

### Consulta de la traça privada

La traça viu a la taula `trace` de `state/admission.sqlite` i no s'exposa mai
per Telegram. La consulta només una persona amb accés root al VPS, amb una ordre
que llegeix la base de dades en mode de només lectura i no necessita les
credencials del servei. S'executa amb la identitat del servei, perquè SQLite pot
crear fitxers auxiliars al costat de la base de dades i han de quedar del
propietari `mountain-agent`:

```sh
runuser -u mountain-agent -- env \
  MOUNTAIN_AGENT_STATE_PATH=/var/lib/mountain-runners-agent/state \
  node /usr/local/lib/mountain-runners/agent/commands/trace/cli.mjs \
  --since 2026-12-01T00:00:00Z --until 2026-12-02T00:00:00Z --limit 50
```

- **Filtres.** `--since` i `--until` comparen `created_at` en UTC, el primer
  inclòs i el segon exclòs. Accepten data sola o data i hora ISO 8601, amb
  mil·lisegons com a màxim, i refusen una data o una hora impossible.
  `--topic=<session_key>` filtra per tema i necessita el signe igual, perquè
  l'identificador comença per `-`. També hi ha `--update`, `--action`,
  `--pull-request` i `--limit`. El filtre de PR accepta el número com a token
  sencer del detall: `#21` no coincideix amb `#215` ni amb `#21abc`.
- **Límits.** `--limit` val 100 per defecte i 10000 com a màxim. Amb un límit
  que trunca, la sortida conté les entrades més noves, sempre en ordre ascendent.
- **Sortida.** Una línia JSON per entrada, amb les columnes de la taula
  (`sequence`, `update_identifier`, `author_identifier`, `session_key`,
  `action`, `detail`, `created_at`) ordenades per `sequence` ascendent.
- **Identificadors de Telegram.** Es mostren tal com es van desar. Només la
  persona amb accés root al VPS la pot consultar i no hi ha cap opció
  d'emmascarament.
- **Errors.** Una opció desconeguda o un valor invàlid escriuen una ajuda breu a
  stderr i acaben amb codi 2. Una base de dades absent acaba amb codi 1 i no es
  crea.

### Reconciliació de resultats desconeguts

Una aturada o un reinici pot deixar una acció externa amb resultat desconegut:
una instrucció que podia haver fet push o obert una PR, o una reparació
automàtica que podia haver fet push.
El servei refusa arrencar mentre en quedi cap. Un avís de CI que potser no va
arribar al tema no bloqueja l'arrencada, però bloqueja la resolució d'un merge
a partir de l'avís anterior. La decisió és d'una persona: l'ordre
no repeteix l'acció, no fa push, no comenta i no fusiona res.

Després d'una actualització amb worktrees antics, executa abans la migració
d'identificadors (vegeu «Noms opacs i migració» a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md#noms-opacs-i-migració)).
Una instrucció incerta no es
pot atribuir al seu worktree fins que la migració ha acabat, així que `list` i
`resolve` la refusen amb codi 1 en lloc de tancar una publicació sense marcar el
commit confirmat.

**Precondició.** Atura el servei abans de fer res:

```sh
systemctl stop mountain-agent
```

Les ordres s'executen amb la identitat del servei i el seu entorn, que inclou les
credencials de GitHub i Telegram:

```sh
systemd-run --pipe --wait --uid=mountain-agent --gid=mountain-agent \
  -p EnvironmentFile=/etc/mountain-runners-agent/agent.env -p UMask=0077 \
  /usr/bin/node /usr/local/lib/mountain-runners/agent/commands/reconcile/cli.mjs list
```

L'ordre fixa el seu propi `umask` i no crea cap base de dades: una base absent
compta com que no hi ha cap cas d'aquell tipus.

1. **Llista els casos.** `list` escriu una línia JSON per cas amb `kind`
   (`instruction`, `repair` o `notice`), `update_identifier`,
   `session_key`, `created_at` i els fets que pot llegir.
   - `instruction`: `worktree` amb la branca del tema, el HEAD local i si aquell
     HEAD ja consta com a publicat, i la PR oberta d'aquella branca amb el
     número i el cap.
   - `repair`: `update_identifier` (l'actualització de Telegram), `sequence`
     (la seqüència de la fila), `failed_commit`, `pull_request_number` i
     l'estat de la PR amb el seu cap.
   - `notice`: `pull_request_number`, el commit i `result`, que és el resultat
     de la CI que l'avís hauria comunicat. No fa cap lectura de GitHub.

   Si una lectura de GitHub falla, aquell cas porta `"github": "unavailable"` i
   la resta es llisten igualment. Si el tema no té worktree local, `github` val
   `"skipped"` i no es llegeix cap PR. La sortida no conté cap token ni el text de
   la instrucció.

2. **Comprova l'estat real a GitHub** amb la PR, la branca i els commits que
   mostra la llista.

3. **Resol un cas per ordre.** Afegeix `resolve` amb el `kind` i els
   identificadors de la llista, dins de la mateixa ordre `systemd-run`:

   ```sh
   /usr/bin/node /usr/local/lib/mountain-runners/agent/commands/reconcile/cli.mjs \
     resolve --kind instruction --update 12 --resolution published \
       --commit <SHA> --pull-request <n>
   /usr/bin/node /usr/local/lib/mountain-runners/agent/commands/reconcile/cli.mjs \
     resolve --kind repair --update 3 --sequence 1 --failed-commit <SHA> \
       --resolution not_published
   /usr/bin/node /usr/local/lib/mountain-runners/agent/commands/reconcile/cli.mjs \
     resolve --kind notice --update 31 --resolution delivered
   ```

   | Cas        | Resolució                                     | Efecte                                                                                                                                                                                                                                                                                     |
   | ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | instrucció | `published --commit <SHA> --pull-request <n>` | Estat `done` i resultat `reconciled_published`; si el HEAD del worktree del tema és aquell commit, es marca com a publicat i no es torna a publicar mai. A més, desa un seguiment de CI pendent d'aquell commit, perquè el tema rebi el seu informe abans que cap merge es pugui resoldre. |
   | instrucció | `not_published`                               | Estat `done` i resultat `reconciled_not_published`; el treball local es conserva i el següent torn ordinari en torna a intentar la publicació.                                                                                                                                             |
   | reparació  | `published --commit <SHA>`                    | Estat `done` i resultat `reconciled_published`; no es reobre cap seguiment de CI.                                                                                                                                                                                                          |
   | reparació  | `not_published`                               | Estat `done` i resultat `reconciled_not_published`; no es reobre cap seguiment de CI.                                                                                                                                                                                                      |
   | avís       | `delivered`                                   | Estat `sent`: el tema ja havia rebut l'avís i el seu resultat passa a ser l'últim informat.                                                                                                                                                                                                |
   | avís       | `resend`                                      | Estat `pending`: el treballador ordinari el torna a enviar. És una decisió humana, no un reintent automàtic.                                                                                                                                                                               |

   `--commit` és obligatori amb `published` i no s'accepta en cap altre cas.
   `--pull-request` és obligatori amb `--kind instruction --resolution published`
   i no s'accepta en cap altre cas: confirma publicada una PR que potser no té
   cap avís, i el tema n'ha de rebre l'informe. El seguiment s'escriu abans de
   tancar la instrucció i abans del senyal de publicació; si no es pot desar, la
   instrucció continua incerta i la comanda acaba amb codi 1. Si el seguiment
   d'aquella actualització ja existeix, no se'n crea cap altre. Una
   reparació exigeix `--update`, `--sequence` i `--failed-commit`, i la
   transacció només afecta la fila que coincideix amb els tres: si una reparació
   posterior reutilitza la mateixa seqüència, l'ordre antiga es refusa. Cada
   crida afecta un sol cas, en una transacció limitada per l'estat incert: un cas
   ja resolt es refusa amb codi 1 i no es sobreescriu.

4. **Avís i traça.** Cada resolució registra `uncertain_reconciled` a la traça
   privada amb el tipus, la resolució, la PR i el SHA curt quan es coneixen, sense
   text de conversa ni identitat de l'operador. Després envia al tema un únic
   avís neutre («Ja està resolt el que havia quedat a mitges: la feina s'ha
   publicat. Si cal continuar la feina, demana-ho de nou en aquest tema.»),
   excepte amb `--kind notice`: `delivered` confirma un avís que el tema
   ja tenia i `resend` encarrega l'enviament al treballador, així que la comanda
   no hi afegeix cap avís propi. L'avís també és un efecte del servei: es desa a
   `state/session-notes.sqlite` abans d'enviar-lo, amb la identitat
   `reconcile:<tipus>:<id>`, perquè el torn següent del tema el rebi encara que
   l'enviament falli. Si l'avís falla, s'escriu a stderr i es traça com a
   `uncertain_reconciled_notice_failed`; la resolució es manté. Mai es desa una
   resolució sense traça: en una instrucció, el canvi d'estat i la traça són una
   sola transacció; en una reparació o un avís, la traça s'escriu abans del
   canvi i, si falla, no es modifica res. Si el canvi falla després de la traça,
   es registra `uncertain_reconcile_failed` i la comanda acaba amb codi 1. En una
   instrucció publicada, el seguiment de CI i el senyal de publicació del
   worktree s'escriuen abans de tancar-la: si falla qualsevol dels dos, la
   instrucció continua incerta i es pot reintentar.

5. **Torna a arrencar.** Amb tots els casos resolts, el recompte que llegeix
   l'arrencada és zero i el servei arrenca. Cap acció interrompuda no s'ha
   repetit. L'arrencada completa totes les recuperacions locals abans de
   refusar, així que un sol reinici deixa tots els casos atribuïts a la traça i
   visibles a `list`.

Codis de sortida: 0 correcte. També és 0 quan `list` troba una lectura de GitHub
no disponible (`"github": "unavailable"`) i quan `resolve` només falla en
l'avís al tema. 1 és per a una fallada que impedeix completar l'ordre: un cas
inexistent o ja resolt, una traça que no es pot escriure o una fallada de
GitHub, Telegram o de la base de dades. 2 és un error d'ús (`parseArgs`, tipus,
resolució, identificador o SHA invàlids, `--commit` que falta o que sobra,
`--pull-request` que falta en una instrucció publicada o que sobra en qualsevol
altre cas, `--sequence` o `--failed-commit` fora d'una reparació).

### Verificació

```sh
pnpm --filter telegram-pi-bridge test
pnpm test:server
# Opcional: Linux amb Podman sense root i imatge local ja disponible:
MR_ISOLATION_TEST_IMAGE=<imatge-local> node --test tools/server/agent/sandbox/commands.test.mjs
# Càrrega del perfil real a Pi, sense credencials ni petició al model:
MR_AGENT_PI_COMMAND=<executable-pi> node --test tools/server/agent/runtime/profile-smoke.test.mjs
```

L'abast de cada prova i l'execució des de l'arrel són a
[Proves i fonts de veritat](../../tools/server/agent/README.md#proves-i-fonts-de-veritat).
Una prova simulada no demostra els permisos reals de GitHub ni l'aïllament al
VPS.

### Preflight del primer pilot

Aquest preflight no autoritza instal·lar ni activar el servei. Atura el
procediment si una comprovació falla. Conserva les credencials i les dades
privades fora de la PR i dels logs.

1. Revisa el codi i la instal·lació amb una persona independent. Confirma que
   el commit instal·lat és el revisat. No executis el bootstrap complet de
   producció per preparar l'agent.
2. Mesura el disc i la memòria disponibles. Verifica els límits efectius de
   CPU, memòria, processos, temps i disc, inclosos el journal i `/run`. Verifica
   que el trim programat exclou els volums de l'agent. Prova l'esgotament del
   volum de treball i del d'estat, la recuperació de la cua i
   l'absència de publicació incompleta. Comprova la salut de producció i previews.
3. Amb la identitat i unitat previstes, verifica Podman sense root, el mapatge
   UID/GID, els cgroups, els muntatges i l'absència de xarxa, credencials i
   sockets del host al sandbox. Prova la neteja després d'un timeout i d'una
   fallada de disc. Un test amb Docker no substitueix aquestes proves.
4. Prepara una imatge fixada a partir del commit revisat. Des d'un worktree
   nou, executa `pnpm check` al sandbox sense xarxa. Verifica les versions de
   Node i pnpm i que no es reutilitza `node_modules` d'una altra feina.
5. Verifica els permisos de la credencial real i les restriccions dels entorns
   `production` i `previews`, sense exposar secrets. Revisa els workflows que
   poden rebre secrets i prova els rebuigs sense fusionar cap PR ni fer push a
   `main`. Si la frontera no es pot demostrar, no activis l'escriptura.
6. Amb autorització explícita, prova una consulta que no creï branca i una
   tasca petita fins a PR. Comprova l'autor, la sessió, les validacions i la
   branca. No demanis preview ni merge durant aquest pilot. Si una acció té un
   resultat desconegut, atura el pilot i reconcilia'l abans de reprendre'l.

Registra a la PR el digest de la imatge, els límits i els resultats, sense
secrets ni dades privades. Una comprovació omesa o fallida no completa el
pilot.

### Validació del pilot

La persona mantenidora executa aquesta checklist al VPS amb el servei sota
supervisió. Els resultats van a la pull request de la T8.6 amb el commit
instal·lat, el digest de la imatge i què ha passat a cada pas; no s'afegeixen
informes al repositori. Totes les proves utilitzen PR sintètiques i canvis
inofensius, mai dades de producció, secrets ni contingut editorial real. Si un
pas falla, atura la validació, deixa el servei aturat i anota el resultat abans
de corregir-lo. La revocació d'una persona no es prova amb Telegram: la decisió
de la persona mantenidora consta a l'especificació.

0. **Precondicions.**
   - Fer: comprova que `systemctl is-active caddy` respon `active`, i el mateix
     amb `systemctl is-active mountain-release` i
     `systemctl is-active mountain-preview-site`. Comprova que
     `systemctl is-active mountain-agent` respon `inactive`. Instal·la el commit
     revisat de `main` ([actualitzar](#actualitzar)), verifica els volums,
     comprova que la imatge fixada és al magatzem de `mountain-agent` i executa
     la [reconciliació](#reconciliació-de-resultats-desconeguts)
     amb `list`.
   - Esperat: producció i previews serveixen, el servei està aturat i `list` no
     retorna cap cas.
   - Si falla: no arrenquis el servei; resol primer els volums o els casos
     incerts.
1. **Credencial de GitHub i protecció de `main`.**
   - Fer: revisa el token del compte de l'agent: `Contents: write`,
     `Pull requests: write`, lectura de checks i estats, `Actions: write` per
     reexecutar una comprovació, sense escriptura a
     `.github/workflows` i sense lectura d'administració. Comprova que el compte
     de l'agent és col·laborador del repositori, que
     `MOUNTAIN_AGENT_REQUIRED_CHECKS` coincideix amb la protecció de `main` amb la
     branca al dia, i registra la decisió sobre «enforce admins». Comprova els
     secrets `PREVIEW_*`, l'entorn `previews` i el DNS wildcard de
     `*.preview.mountainrunners.cat`.
   - Esperat: cada permís és el documentat i la llista de comprovacions
     coincideix amb la protecció, de manera que `clean` vol dir el mateix per al
     servei i per a GitHub.
   - Si falla: no activis l'escriptura ni el merge; corregeix el token o la
     configuració i torna a començar la validació.
2. **Flux bàsic.**
   - Fer: al tema, fes una consulta sobre el codi i després una implementació
     petita fins a PR, per exemple una correcció de documentació. Espera l'avís
     de CI. Després demana una notícia curta amb una foto i, quan estigui a punt,
     demana-la publicada amb «publica-la».
   - Esperat: la consulta respon sense crear cap branca i sense rutes, noms de
     fitxer, camps YAML, ordres, recomptes de proves, commits ni noms de
     comprovació, i fa com a màxim una pregunta. La implementació crea una
     branca, un sol commit i una PR amb la identitat de l'agent. El tema rep la
     resposta del model, una línia curta que diu que el canvi s'està comprovant i
     l'enllaç de revisió com a darrera línia. Amb les comprovacions obligatòries
     en verd arriba un sol avís, i no un missatge per la PR, pel seguiment i
     pel verd. Quan el publicador confirma la preview del commit, arriba un
     altre avís amb la seva adreça. La notícia es crea com a
     esborrany; «publica-la» la marca com a publicada amb l'hora de la petició,
     que és la seva aprovació editorial. El merge continua sent humà. Sense
     petició no s'escriuen les variants en castellà ni en anglès.
   - Si falla: atura el servei i anota la instrucció; no repeteixis cap
     publicació. Si el resultat és desconegut, reconcilia'l.
3. **Reparació de CI.**
   - Fer: obre una PR sintètica que trenqui una comprovació obligatòria amb un
     error que una correcció petita pugui resoldre, i deixa que el servei la
     repari. Repeteix-ho amb una fallada que no sigui dins de l'abast.
   - Esperat: un intent de reparació amb el commit nou i l'avís de CI nova. Amb
     una fallada externa, dos intents com a màxim, l'avís del límit i cap bucle.
   - Si falla: atura el servei i anota l'intent i el seu SHA a la PR; si un intent
     ha quedat incert, reconcilia'l abans de continuar.
4. **Preview.**
   - Fer: comprova que la PR creada pel servei té l'etiqueta `preview` i que el
     servei no ha comentat `/preview`. Espera l'avís de l'adreça sense demanar-la
     i demana un canvi més al mateix tema. Treu l'etiqueta d'una PR de prova i
     comprova que el servei no anuncia cap preview; afegeix `preview-revoked` amb
     l'etiqueta posada i comprova el mateix.
   - Esperat: per a cada push del servei, el tema rep només l'URL
     `https://pr-<n>.preview.mountainrunners.cat` que el publicador de la fase 6
     confirma per al cap actual, sense esperar el verd ni cap comentari
     `/preview`; sense l'etiqueta o amb `preview-revoked`, cap adreça.
   - Si falla: no escriguis `/preview` a mà; comprova l'etiqueta, els secrets
     `PREVIEW_*`, el DNS i l'estat de la preview, i atura el servei mentre no es
     confirmi.
5. **Merge.**
   - Fer: prova els rebuigs en una PR sintètica: `/merge` sense avís verd
     resoluble, `/merge` amb un commit posterior a l'informe, `/merge` amb la CI
     vermella o pendent, `/merge <PR>` d'una altra PR i una prosa com
     «fusiona-la». Després, i només amb l'aprovació explícita de la persona
     mantenidora en aquell moment, fes un sol merge real d'un canvi sintètic
     inofensiu amb `/merge` o `/merge <PR>`.
   - Esperat: cada rebuig respon amb el motiu i no fusiona res. El merge real
     fusiona exactament el commit informat, amb squash, i la resposta nomena la
     proposta fusionada; l'última línia és l'enllaç de revisió amb el canvi
     fusionat, amb el SHA curt.
   - Si falla: atura el servei i no tornis a escriure `/merge`. Un resultat
     desconegut es reconcilia llegint la PR; només una persona verificada el pot
     tancar amb `/merge <PR> <SHA>`.
6. **Adjunts.**
   - Fer: en una implementació, adjunta una foto comprimida de Telegram, un JPEG
     i un PNG com a fitxer. En un altre missatge, envia un àlbum de tres imatges
     amb la llegenda en una de les del mig. Després envia sis imatges juntes i un
     fitxer de més de 20 MB. Demana al model que torni a mirar una imatge del
     tema en un torn posterior. Quan una imatge arribi a la PR, executa
     `exiftool` o una eina equivalent sobre el fitxer publicat.
   - Esperat: la foto, el JPEG i el PNG s'accepten. L'àlbum de tres és una sola
     instrucció i el model en rep les tres imatges. Les sis imatges i el fitxer
     de més de 20 MB es refusen amb un avís planer. El torn posterior llista la
     imatge desada i `view_attachment` la torna a mostrar. La imatge publicada
     no té EXIF, GPS ni cap altra metadada, fa com a màxim 2.400 px de costat
     llarg i `.agent-attachments/` no apareix a la PR.
   - Si falla: no afegeixis la imatge a mà; atura el servei i revisa la traça
     (`attachment_refused`, `attachment_used`) i els fitxers de
     `state/attachments/`. Un refús o una denegació de pertinença ja traçats no
     es repeteixen després d'un reinici, perquè la traça és duradora; si el
     reinici cau entre la traça i l'avís, l'avís no es repeteix. Les imatges noves d'un prompt sumen com a
     màxim 8 MB; la resta queda al magatzem del tema.
7. **Aturada i reinici.**
   - Fer: amb una implementació en curs, atura el servei amb
     `sudo systemctl stop mountain-agent`. Amb una altra execució en curs, fes
     `sudo systemctl restart mountain-agent`. Després arrenca'l amb el cas
     pendent, comprova `list`, resol el cas i torna a arrencar.
   - Esperat: worktrees, sessions i estat es conserven. La primera arrencada
     refusa, `list` mostra el cas, `resolve` el tanca i la següent arrencada és
     correcta. No hi ha commits, PR ni comentaris duplicats.
   - Si falla: no esborris res ni editis SQLite; atura el servei i anota la sortida
     de `list`.
8. **Consulta de la traça.**
   - Fer: executa la
     [consulta de la traça](#consulta-de-la-traça-privada) com la
     identitat del servei i intenta llegir `/var/lib/mountain-runners-agent/state`
     amb un usuari sense privilegis, per exemple `preview-deploy`.
   - Esperat: la consulta retorna una línia JSON per entrada amb les columnes
     documentades i sense text de conversa; l'altre usuari rep un refús de
     permisos.
   - Si falla: no ampliïs permisos per fer la prova més fàcil; anota-ho i atura la
     validació.
9. **Dos autors al mateix tema.**
   - Fer: si hi ha un segon compte de membre, fes que dos autors escriguin al
     mateix tema una consulta i una implementació.
   - Esperat: la sessió és compartida, cada instrucció queda atribuïda al seu
     autor a la traça i cap dada personal arriba a la PR.
   - Si falla o no hi ha segon compte, anota-ho; sense segon compte el pas queda
     com a no executat.
10. **Producció i tancament.**
    - Fer: comprova producció amb `verify-site.mjs` i les previews amb
      `mountain-preview list` i `health`. Atura el servei amb
      `sudo systemctl stop mountain-agent`.
    - Esperat: la web i les previews responen com abans de la validació, el servei
      queda `inactive` i no hi ha cap cas incert.
    - Si falla: si producció o una preview ha canviat, atura el servei i revisa
      Caddy abans de res més; no despleguis ni reiniciïs producció sense
      aprovació.

### Verificació al VPS

Verificat al VPS amb la identitat i la unitat instal·lades:

1. Bot, supergrup privat amb temes i credencials de Telegram, model i GitHub
   creats fora del repositori. La credencial de GitHub refusa escriure a
   `.github/workflows` (403) i no té lectura d'administració, de manera que
   l'agent no pot introduir ni modificar workflows. L'entorn `production`
   limita el desplegament a les branques de la seva política
   ([desplegament continu](web-and-releases.md#entorn-github-production)) i
   l'entorn `previews` està restringit a `main`
   ([previews](previews.md#un-sol-workflow-disparat-sota-demanda)).
2. Unitat, identitat `mountain-agent`, clon, eines, imatge fixada i volums
   acotats instal·lats i mesurats; `ExecStartPre` verifica els volums.
3. Aïllament comprovat amb la suite real del contenidor: 17 de 17 proves, sense
   xarxa, sense credencials i amb un sol worktree d'escriptura. Els límits de
   cgroup es van llegir del sistema i el cicle d'aturada i reinici està acotat;
   el consum del procés `pause` es compta a la unitat i no al contenidor.
4. Dependències offline dins de la imatge; `pnpm check` funciona sense xarxa.
5. Pilot supervisat: la consulta respon sense crear branca i la tasca petita
   arriba a una PR amb la identitat de l'agent, un sol commit i el diff
   esperat. La PR del pilot és sintètica i no s'ha de fusionar.

Pendent per a les entregues següents:

- Validació integral a T8.6: dos autors al mateix tema, reconciliació d'un
  resultat desconegut real, aturada i rotació de credencials documentades en
  aquest document. La pertinença, la revocació, la reconciliació i la retenció ja estan
  definides (T8.5).

Aquestes validacions es completen sobre el servei en marxa. L'agent de Telegram
no desplega mai res. El merge demanat encara no s'ha provat amb una PR real: no
està actiu fins que se'n verifiquin els controls, i la primera fusió requereix
l'aprovació explícita de la persona mantenidora, segons l'ADR 0013.
