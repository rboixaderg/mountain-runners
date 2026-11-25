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

| Component           | Accés                                                                                                                                | Límit                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pont de Telegram    | Token del bot, grup configurat, cua duradora i traça privada                                                                         | No entrega cap credencial a Pi, a l'entorn aïllat ni a les proves                                                                                                                                                                                                                  |
| Pi i model          | Credencial del proveïdor i sessions per tema                                                                                         | Confiança de projecte denegada: no carrega extensions, hooks ni `settings` del repositori                                                                                                                                                                                          |
| Entorn aïllat       | Worktree de la feina                                                                                                                 | Sense xarxa, sense credencials, sistema de fitxers de només lectura, sense socket de Docker                                                                                                                                                                                        |
| Component de GitHub | Compte `rboixaderg`: `push` de la branca, obertura o reutilització de la PR, lectura de la CI del commit publicat i el merge demanat | Sense auto-merge, push a `main`, canvis de protecció ni desplegament; l'únic merge és el squash demanat amb `/merge` o confirmat amb «Sí, a producció» a la pregunta del servei, amb el detall al [README del component](../../tools/server/agent/README.md#merge-demanat-al-tema) |

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
identitat del servei. En arrencar, el pont llegeix les credencials una sola
vegada, les guarda només a la configuració en memòria i les elimina de
`process.env`, de manera que cap procés fill (Git, Podman, Pi i les seves eines)
les hereta. Risc residual: el codi que s'executa com a usuari del servei encara
les pot llegir de l'entorn inicial del procés o del fitxer d'entorn; l'aïllament
complet exigiria executar Pi amb un usuari separat.
`MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES` refusa els noms que comencen per `MOUNTAIN_AGENT_` o `MR_AGENT_`. Els noms de les variables del servei són a
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
└── state/                                 identifier-salt, admission.sqlite, ci-watch.sqlite (avisos de CI), preview-request.sqlite (peticions de preview i URL confirmada), merge-request.sqlite (peticions de merge i preguntes de confirmació), topic-jobs.sqlite (branca i PR per tema), session-notes.sqlite (efectes i última resposta de cada tema), attachments/ (imatges per tema, 7 dies), perfils i traça
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

### Versió de Pi

El servei no fixa cap versió del Pi coding agent. Pi viu en un sol directori,
`/usr/local/lib/mountain-runners/pi`, i `agent.env` hi apunta amb
`MOUNTAIN_AGENT_PI_COMMAND=/usr/local/lib/mountain-runners/pi/node_modules/.bin/pi`.
A cada arrencada, el servei executa `--version` amb `PI_OFFLINE=1` i un termini
de 10 segons. La versió queda al journal i a la traça privada (`pi_version`). Si
no es pot llegir, el journal diu `pi_version_unreadable` i el servei continua.

Risc acceptat: una versió nova de Pi pot canviar el comportament, per exemple com
executa les eines o la sortida RPC. La línia `pi_version` i la pregunta posterior
a l'actualització en són la comprovació.

Per actualitzar a l'última versió, amb aprovació explícita:

```sh
sudo systemctl stop mountain-agent
# umask 022: el servei ha de poder llegir els fitxers que instal·la root.
sudo sh -c 'umask 022 && npm install --prefix /usr/local/lib/mountain-runners/pi \
  @earendil-works/pi-coding-agent@latest'
sudo runuser -u mountain-agent -- \
  /usr/local/lib/mountain-runners/pi/node_modules/.bin/pi --version
sudo systemctl start mountain-agent
sudo journalctl -u mountain-agent -n 100
```

Després, fes una pregunta en un tema i comprova que el bot respon. Per tornar
enrere, repeteix el procediment amb `@<versió anterior>` en lloc de `@latest`. La
versió anterior és a la línia `pi_version` de l'arrencada anterior
(`sudo journalctl -u mountain-agent -g pi_version`).

**Migració, una sola vegada.** La instal·lació actual és a
`/usr/local/lib/mountain-runners/pi-1.5.2`. Segueix el mateix procediment per
instal·lar al directori nou i, abans d'arrencar, canvia
`MOUNTAIN_AGENT_PI_COMMAND` a `agent.env`. Conserva el directori antic fins que
hagis verificat el nou; mentrestant, tornar enrere és restaurar el camí anterior.

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

L'actualització és una ordre versionada,
`tools/server/agent/commands/update/cli.mjs`. Fa les comprovacions, la còpia, la
substitució i la verificació, i no arrenca mai el servei.

**Preparar el clon de la persona operadora.** L'ordre llegeix el codi d'un clon
que controla la persona operadora, mai del clon que escriu el servei. Al VPS:

```sh
cd /srv/mountain-runners   # un clon de la persona operadora, no el del servei
sudo git fetch origin main
sudo git log --oneline -1 origin/main
```

L'ordre refusa com a `--repository` qualsevol ruta que, un cop resolts els
enllaços, visqui dins de `/var/lib/mountain-runners-agent`, inclòs el clon del
servei: l'escriu l'agent i no és mai la font d'una instal·lació. També refusa un
clon que no sigui de root i una execució que no sigui de root.

**Executar l'ordre.** Des del clon i amb el commit revisat de `main`. Els dos
commits s'escriuen sencers, amb 40 caràcters hexadecimals: `git rev-parse
<commit>` en dona la forma completa.

```sh
sudo node tools/server/agent/commands/update/cli.mjs \
  --repository /srv/mountain-runners \
  --commit <commit>
```

**Primera execució.** Mentre no hi hagi cap `REVISION` enregistrat cal
declarar el commit instal·lat, amb el SHA complet; al VPS és `0a5722d` des del
22 de novembre de 2026:

```sh
sudo git -C /srv/mountain-runners rev-parse 0a5722d
sudo node tools/server/agent/commands/update/cli.mjs \
  --repository /srv/mountain-runners \
  --commit <commit> --installed <sha complet del commit instal·lat>
```

A partir de la primera execució l'ordre llegeix el commit instal·lat de
`/usr/local/lib/mountain-runners/agent.REVISION` i no necessita `--installed`.
La marca viu al costat de `agent/` i no a dins: així la comparació de l'arbre
veu exactament els fitxers que instal·la l'arxiu i la marca no hi apareix mai com
un fitxer afegit. Les rutes d'instal·lació, de còpies i de dades són paràmetres
(`--install-root`, `--backups` i `--data-root`) amb els valors de producció per
defecte.

**Què comprova, en aquest ordre.**

1. Que el commit és abastable des de `refs/remotes/origin/main` del clon. Un
   commit d'una branca no fusionada es refusa.
2. Que l'arbre instal·lat coincideix amb un `git archive` del commit enregistrat
   o declarat: `agent/` sencer i les entrades instal·lades del paquet
   (`src`, `examples`, `package.json`, `LICENSE` i `README.md`, sense fitxers de
   prova), amb el sha256 de cada fitxer i el conjunt exacte. Qualsevol diferència
   la refusa i n'enumera fins a 20. Un enllaç o un fitxer especial també la
   refusa.
3. Que l'estat és inactiu, amb les bases obertes en només lectura i refusant-ne
   qualsevol que no sigui un fitxer regular: cap
   instrucció `pending`, `running` o `uncertain`, cap merge `merging` o
   `uncertain` i cap preview `awaiting`. Si n'hi ha, la refusa amb els comptes.
   Els casos incerts es resolen amb la
   [reconciliació](#reconciliació-de-resultats-desconeguts). Un seguiment de CI
   `pending` no la refusa: es reprèn després del reinici i l'avís es pot repetir.
4. Si el lockfile, `pnpm-workspace.yaml`, `.node-version`, `package.json`
   (l'arrel i `apps/web`), el `package.json` del pont o
   `tools/server/agent/sandbox/Containerfile` han canviat respecte del commit
   instal·lat, refusa instal·lar tret que `--image-rebuilt` affirmi que la
   imatge del commit nou ja està construïda i que `agent.env` ja hi apunta. Els
   canvis a `tools/server/systemd/` i a `.env.example` no la refusen: els
   reporta com a accions a fer abans d'arrencar.
5. Amb el servei encara en marxa, refusa un commit amb `export-subst` en algun
   `.gitattributes` o amb un enllaç a l'arxiu, i comprova que el sistema de
   fitxers de les còpies té almenys 1 GiB lliure; si no, remet a
   [Retenció](#retenció).
6. Atura el servei i comprova que `systemctl is-active mountain-agent` diu
   `inactive` o `failed`. Torna a comprovar l'estat després d'aturar: un torn
   que havia començat mentre el servei s'aturava encara és feina en curs i
   refusa la resta.
7. Copia `agent/` i `node_modules/telegram-pi-bridge/` a
   `/var/backups/mountain-runners-agent/`, un directori `0700` de root, amb els
   dos commits curts i la marca de temps UTC al nom, hi apunta el symlink
   `agent-previous` i desa el commit anterior a `agent-previous.REVISION`.
   L'estat no el copia root: la identitat del servei l'escriu en un sol fitxer
   `state-<instal·lat>-to-<nou>-<marca>.tar`, creat per root en mode `0600`, de
   manera que un enllaç que l'agent hi hagi deixat es desa tal com és i no es
   segueix.
8. Munta `agent.new` i `telegram-pi-bridge.new` al costat dels directoris vius
   des de l'arxiu del commit, els dona `root:root`, `0755` als directoris i
   `0644` als fitxers, i els intercanvia amb renames: els directoris se
   substitueixen sencers i un fitxer retirat a l'origen desapareix.
9. Verifica cada fitxer instal·lat pel sha256 i el conjunt exacte, i només
   llavors escriu `agent.REVISION` amb el SHA complet.

#### Reconstruir la imatge del sandbox

Cal fer-ho quan l'ordre refusa pel pas 4. Atura el servei: `podman rmi` falla
mentre un contenidor la fa servir i un torn nou pot començar entre la comprovació
de l'ordre i la reconstrucció. La imatge es construeix com `mountain-agent`, dins
del cgroup de la unitat transitòria, amb el seu magatzem local de Podman i els
seus rangs de `subuid` i `subgid`; mai amb `sudo podman`. Desa primer la imatge
actual per poder tornar enrere:

```sh
# Com a root. <imatge-actual> i <imatge-nova> són les etiquetes locals, per
# exemple localhost/mountain-agent:<commit>.
set -eu
systemctl stop mountain-agent
A=/var/lib/mountain-runners-agent
B=/var/backups/mountain-runners-agent
pm() {
  systemd-run --pipe --wait --quiet --uid=mountain-agent --gid=mountain-agent \
    -p RuntimeDirectory=mountain-runners-agent -p RuntimeDirectoryMode=0700 \
    -E HOME=$A -E TMPDIR=$A/tmp -E XDG_RUNTIME_DIR=/run/mountain-runners-agent \
    --working-directory="${WD:-$A}" podman --remote=false --cgroup-manager=cgroupfs "$@"
}
install -d -m 0700 "$B"
# 1. Desa la imatge actual; la reversió la torna a carregar amb podman load.
pm save --format oci-archive <imatge-actual> \
  > "$B/mountain-agent-<commit-instal·lat>.oci.tar"
chmod 0600 "$B/mountain-agent-<commit-instal·lat>.oci.tar"
# 2. Allibera el volum de treball abans de construir-ne una de nova.
pm rmi <imatge-actual>
pm image prune -f
df -h "$A"
# 3. Munta el context del commit revisat fora del volum de l'agent: el crea
#    root i el servei només el pot llegir.
CONTEXT=$(mktemp -d /var/tmp/mountain-agent-build.XXXXXXXX)
chmod 0755 "$CONTEXT"
git -c core.attributesFile=/dev/null -c core.fsmonitor=false \
  -c core.hooksPath=/dev/null \
  -C /srv/mountain-runners archive <commit> | tar -x -C "$CONTEXT"
chmod -R a+rX,go-w "$CONTEXT"
# 4. Construeix sense xarxa: el contenidor no en té i tot arriba al store local.
WD="$CONTEXT" pm build --pull=never \
  -f tools/server/agent/sandbox/Containerfile -t <imatge-nova> .
pm image inspect <imatge-nova> --format "{{.Id}}"
# 5. Neteja el context.
rm -rf "$CONTEXT"
```

`systemd-run --working-directory` fixa el directori de treball del `podman build`,
que s'executa com `mountain-agent`: ha de poder travessar i llegir el context, i
no l'ha de poder modificar. Per això viu fora de
`/var/lib/mountain-runners-agent`, en un `mktemp -d` de root amb directoris
`0755` i fitxers `0644`, i per això el volum de l'agent no rep cap ordre de root
que hi escrigui ni que hi esborri res. Comprova-ho abans de construir:

```sh
runuser -u mountain-agent -- test -r "$CONTEXT/package.json"
```

No hi ha cap `rm -rf`, `install` ni `tar` de root dins del volum de l'agent.

El valor que imprimeix `image inspect` és el que fixa
`MOUNTAIN_AGENT_SANDBOX_IMAGE` a `/etc/mountain-runners-agent/agent.env`, que
s'edita com a root i conserva el mode `0600`. Comprova que la imatge nova és al
magatzem de `mountain-agent` abans de repetir l'ordre amb `--image-rebuilt`, que
només n'afirma la construcció: l'ordre no construeix mai res.

```sh
# Amb la mateixa funció pm de la caixa anterior.
pm images --digests
```

**Després.** L'ordre no arrenca el servei. Si encara no ha corregut, executa la
[migració de noms](#migració-de-noms) abans d'arrencar.

```sh
sudo systemctl start mountain-agent
systemctl is-active mountain-agent
sudo journalctl -u mountain-agent -n 100
```

Comprova els volums, que la unitat verifica a `ExecStartPre` amb
`storage/verify-volumes.mjs`, el journal i una consulta al tema que no hagi de
crear cap branca.

**Tornar enrere.** Atura el servei i restaura el que l'ordre va deixar a la
carpeta de còpies. Els noms exactes els va imprimir l'ordre en actualitzar.

```sh
sudo systemctl stop mountain-agent
B=/var/backups/mountain-runners-agent
L=/usr/local/lib/mountain-runners
sudo rm -rf "$L/agent" "$L/node_modules/telegram-pi-bridge"
sudo cp -a "$(sudo readlink -f "$B/agent-previous")" "$L/agent"
sudo cp -a "$B/<còpia-del-pont>" "$L/node_modules/telegram-pi-bridge"
sudo cp "$B/agent-previous.REVISION" "$L/agent.REVISION"
# Les còpies són només per a root: restaura el propietari i els modes, i el
# servei els pot llegir.
sudo chown -R root:root "$L/agent" "$L/node_modules/telegram-pi-bridge"
sudo chmod -R u=rwX,go=rX "$L/agent" "$L/node_modules/telegram-pi-bridge"
```

Si el commit nou havia canviat l'esquema de `state/`, restaura també la còpia de
l'estat. L'extracció la fa la identitat del servei, que és qui escriu l'estat,
sobre un `state/` buit. La identitat del servei no pot entrar a la carpeta de
còpies, així que root llegeix l'arxiu i l'hi passa per l'entrada estàndard:

```sh
S=/var/lib/mountain-runners-agent/state
A="$B/<còpia-de-l'estat>.tar"
# `state/` només es buida si l'arxiu es llegeix sencer. Buidat i extracció com
# la identitat del servei: root no escriu mai dins del volum de l'agent.
# `lost+found` és del sistema de fitxers i s'hi queda.
sudo cat "$A" | sudo runuser -u mountain-agent -- tar -tf - >/dev/null &&
  sudo runuser -u mountain-agent -- find "$S" -mindepth 1 -maxdepth 1 \
    ! -name lost+found -exec rm -rf -- {} + &&
  sudo cat "$A" | sudo runuser -u mountain-agent -- \
    tar -C "$S" --exclude=./lost+found -xf -
```

Si no tens aquesta còpia, no tornis enrere sense aprovació explícita. Arrenca el
servei i repeteix la comprovació. Si la imatge del sandbox va canviar, torna a
carregar la còpia amb `podman load`, apunta-hi `MOUNTAIN_AGENT_SANDBOX_IMAGE` i
no esborris l'arxiu fins que la reversió estigui verificada.

**Si l'ordre cau durant la substitució.** Entre els renames hi pot haver
`agent.new`, `telegram-pi-bridge.new` i els `*.old` al costat dels directoris
vius. Mentre `agent.REVISION` no s'hagi escrit, cap d'ells no és una
instal·lació verificada: la marca només s'escriu després de comprovar l'arbre.
Amb el servei aturat, mira què hi ha:

```sh
ls -ld /usr/local/lib/mountain-runners/agent* \
  /usr/local/lib/mountain-runners/node_modules/telegram-pi-bridge*
```

- Si `agent/` i `node_modules/telegram-pi-bridge/` hi són i `agent.REVISION`
  encara és el commit anterior, restaura les còpies dels paràgrafs anteriors: és
  l'estat conegut.
- Si hi falta `agent/` però hi ha `agent.old`, `mv agent.old agent` el recupera;
  si ja no hi és, `agent-previous` és la còpia.
- `agent.new` i `telegram-pi-bridge.new` són un intent a mitges: esborra'ls quan
  la instal·lació bona ja és al lloc.

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
codi 1 i demanen executar la migració abans. Els casos de merge no en depenen. Si encara no s'ha instal·lat la versió que retira les
peticions `/preview`, comprova abans la precondició de
[Reinicis](../../tools/server/agent/README.md#preview-demanada-al-tema).

### Rotació de credencials

Els valors no es mostren mai en aquest document, al tema, a la PR ni a la sortida
d'una ordre. Edita `agent.env` com a root i comprova que conserva el mode `0600`.

| Credencial                | On es genera               | Abast                                                                                                                                        |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Token del bot de Telegram | BotFather                  | Només el bot del grup configurat                                                                                                             |
| Token de GitHub           | Compte de l'agent a GitHub | `Contents: write`, `Pull requests: write`, lectura de checks i estats; sense `Actions: write`, `Workflows: write` ni lectura d'administració |
| Credencial del model      | Proveïdor del model        | Només la crida al model; arriba a Pi i no al pont                                                                                            |

El servei no necessita `Actions: write`. Si el token encara el té, la persona
mantenidora el retira a GitHub després de desplegar la versió instal·lada. És un
canvi remot que fa una persona: cap agent no toca el token.

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

Els worktrees segueixen la política de retenció descrita a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md#sessions-admissió-i-recuperació),
que conserva sempre el treball no fusionat, no publicat o sense cometre i
allibera les dependències generades dels arxius i dels temes tancats. La comanda
`node storage/prune-worktrees.mjs --dry-run`, executada com la identitat del
servei amb `EnvironmentFile=/etc/mountain-runners-agent/agent.env`, mostra la
mateixa decisió sense escriure ni esborrar res; per aplicar-la sense
`--dry-run`, atura abans `mountain-agent.service`: la comanda refusa executar-se
si `systemctl is-active mountain-agent` no diu `inactive` o `failed`, o si hi ha
instruccions en curs o incertes.

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
  Conserva també `state/research-review/` amb la còpia privada del servei. Conté
  l'estat i les metadades dels candidats, no el text de les pàgines llegides.
  No l'esborris com a part d'una neteja de sessions: es necessita per mantenir
  el bloqueig de publicació de les feines amb recerca.

### Revocació

Treure una persona del grup talla les instruccions noves i no
cancel·la la feina ja acceptada. Per tallar-ho tot, atura el servei; per
revocar una credencial, fes la [rotació](#rotació-de-credencials). El detall de
què continua i què es torna a comprovar és a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md#sessions-admissió-i-recuperació).

### Consulta de la traça privada

La traça viu a la taula `trace` de `state/admission.sqlite` i no s'exposa mai
per Telegram. La consulta només una persona amb accés root al VPS, amb una
consulta que obre la base de dades en mode de només lectura i no necessita les
credencials del servei. El VPS no té `sqlite3`: s'usa `node:sqlite`. S'executa
amb la identitat del servei, perquè SQLite pot crear fitxers auxiliars al costat
de la base de dades i han de quedar del propietari `mountain-agent`, i amb
`systemd-run`, sense accés al terminal de root. `systemd-run` substitueix les
variables dels arguments: no escriguis cap `$` a l'script ni als valors.

```sh
systemd-run --quiet --pipe --wait --uid=mountain-agent --gid=mountain-agent \
  -p UMask=0077 /usr/bin/node -e '
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(
  "/var/lib/mountain-runners-agent/state/admission.sqlite",
  { readOnly: true },
);
database.exec("PRAGMA busy_timeout = 5000");
const [filter, ...values] = process.argv.slice(1);
const rows = database
  .prepare(
    "SELECT * FROM trace WHERE " + filter + " ORDER BY sequence DESC LIMIT 100",
  )
  .all(...values);
for (const row of rows.reverse()) console.log(JSON.stringify(row));
' -- 'created_at >= ? AND created_at < ?' 2026-12-01 2026-12-02
```

- **Filtres.** El primer argument després de `--` és la condició SQL i la resta
  són els valors dels `?`, en ordre. No hi interpolis cap valor. Altres
  condicions: `session_key = ?` (tema), `update_identifier = ?`, `action = ?` i,
  per a una PR com a token sencer (`#21` sense `#215`),
  `(detail || ' ') GLOB ?` amb el valor `*#21[^0-9A-Za-z_]*`. `1` les mostra
  totes.
- **Dates.** `created_at` és text ISO 8601 en UTC. Escriu només la data o la
  forma completa amb mil·lisegons (`2026-12-01T10:00:00.000Z`): la comparació és
  de text.
- **Sortida.** Una línia JSON per entrada, amb les columnes de la taula
  (`sequence`, `update_identifier`, `author_identifier`, `session_key`,
  `action`, `detail`, `created_at`): les 100 més noves, en ordre ascendent.
  Canvia `LIMIT` si en cal més.
- **Identificadors de Telegram.** Es mostren tal com es van desar. No hi ha cap
  opció d'emmascarament.
- **Errors.** Una base de dades absent fa fallar l'ordre i no es crea.

### Reconciliació de resultats desconeguts

Una aturada o un reinici pot deixar una acció externa amb resultat desconegut:
una instrucció que podia haver fet push o obert una PR, o un merge. El servei
refusa arrencar mentre quedi cap instrucció incerta; un merge incert no bloqueja
l'arrencada. La decisió és d'una persona: l'ordre
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
   (`instruction` o `merge`), `update_identifier`,
   `session_key`, `created_at` i els fets que pot llegir.
   - `instruction`: `worktree` amb la branca del tema, el HEAD local i si aquell
     HEAD ja consta com a publicat, i la PR oberta d'aquella branca amb el
     número i el cap.
   - `merge`: `pull_request_number` i el commit del `/merge` amb resultat
     desconegut. No fa cap lectura de GitHub.

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
     resolve --kind merge --update 60 --resolution merged
   ```

   | Cas        | Resolució                                     | Efecte                                                                                                                                                                                          |
   | ---------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | instrucció | `published --commit <SHA> --pull-request <n>` | Estat `done` i resultat `reconciled_published`; si el HEAD del worktree del tema és aquell commit, es marca com a publicat i no es torna a publicar mai. També desa un seguiment de CI pendent. |
   | instrucció | `not_published`                               | Estat `done` i resultat `reconciled_not_published`; el treball local es conserva i el següent torn ordinari en torna a intentar la publicació.                                                  |
   | merge      | `merged`                                      | Estat `merged` amb el commit de fusió que llegeix a GitHub; només s'accepta si la PR hi consta fusionada amb el mateix cap.                                                                     |
   | merge      | `not_merged`                                  | Estat `not_merged`: la petició acaba i es pot demanar un `/merge` nou; només s'accepta si la PR hi consta sense fusionar.                                                                       |

   `--commit` és obligatori amb `published` i no s'accepta en cap altre cas.
   `--pull-request` és obligatori amb `--kind instruction --resolution published`
   i no s'accepta en cap altre cas: confirma publicada una PR que potser no té
   cap avís, i el tema n'ha de rebre l'informe. El seguiment s'escriu abans de
   tancar la instrucció i abans del senyal de publicació; si no es pot desar, la
   instrucció continua incerta i la comanda acaba amb codi 1. Si el seguiment
   d'aquella actualització ja existeix, no se'n crea cap altre. Cada crida
   afecta un sol cas, en una transacció limitada per l'estat incert: un cas ja
   resolt es refusa amb codi 1 i no es sobreescriu.

4. **Avís i traça.** Cada resolució registra `uncertain_reconciled` a la traça
   privada amb el tipus, la resolució, la PR i el SHA curt quan es coneixen, sense
   text de conversa ni identitat de l'operador. Després envia al tema un únic
   avís neutre («Ja està resolt el que havia quedat a mitges: la feina s'ha
   publicat. Si cal continuar la feina, demana-ho de nou en aquest tema.»),
   excepte amb `--kind merge` (el tema ja va rebre la resposta de resultat
   desconegut). L'avís també és un efecte del servei: es desa a
   `state/session-notes.sqlite` abans d'enviar-lo, amb la identitat
   `reconcile:<tipus>:<id>`, perquè el torn següent del tema el rebi encara que
   l'enviament falli. Si l'avís falla, s'escriu a stderr i es traça com a
   `uncertain_reconciled_notice_failed`; la resolució es manté. Mai es desa una
   resolució sense traça: en una instrucció, el canvi d'estat i la traça són una
   sola transacció; en un merge, la traça s'escriu abans del canvi i, si falla,
   no es modifica res. Si el canvi falla després de la traça, es registra
   `uncertain_reconcile_failed` i la comanda acaba amb codi 1. En una
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
altre cas).

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

#### Comprovar el DNS abans d'activar la cerca web

Fes les comprovacions en privat. Llegir la configuració no autoritza l'agent a
consultar el DNS ni a accedir als llocs. No llegeixis `agent.env` per a aquesta
comprovació ni copiïs adreces privades a la PR.

1. Comprova l'entorn de xarxa de la unitat amb
   `systemctl show mountain-agent -p PrivateNetwork -p NetworkNamespacePath -p DropInPaths`.
   Des de l'entorn de xarxa i de fitxers del servei, obtén els resolutors que
   veu Node sense fer cap consulta: `node -e 'const { Resolver } = require("node:dns/promises"); console.log(new Resolver().getServers());'`.
   Si Node només veu un resolutor local i el VPS usa `systemd-resolved`, comprova
   els resolutors remots amb `resolvectl dns` i els dominis que dirigeix a cada
   interfície amb `resolvectl domain`.
2. Contrasta els noms i àlies del [web](web-and-releases.md) i de les
   [previews](previews.md) amb la configuració instal·lada de Caddy. Contrasta les
   adreces IPv4 i IPv6 amb `ip -brief address show` i amb les assignacions del
   proveïdor, incloses les adreces flotants i els prefixos de traducció si n'hi
   ha. Un inventari històric no substitueix aquesta comprovació.
3. Amb autorització de consulta, contrasta els registres A, AAAA i CNAME dels
   noms inventariats amb el resolutor que farà servir el servei. Si no pots
   verificar el resolutor o completar les exclusions de noms, àlies i xarxes,
   no activis la cerca. Repeteix la comprovació després de canvis de xarxa o DNS.

La cerca no està activa si `MOUNTAIN_AGENT_BRAVE_SEARCH_TOKEN` no està configurat.
No l'incloguis a les variables del proveïdor de Pi. Un cop superades les
comprovacions i autoritzada l'activació per la persona mantenidora, configura
també les exclusions de noms i xarxes, i `MOUNTAIN_AGENT_WEB_DNS_RECIPIENT` amb el
nom del resolutor que es mostrarà als membres. Les variables de consultes i URL públiques de
[`.env.example`](../../.env.example) són llistes JSON de valors exactes revisats.
Si una llista queda buida, cada petició d'aquell tipus demana confirmació.

Brave rep només la consulta de cerca i la seva pròpia credencial. El resolutor
rep el nom de domini; el lloc web rep l'URL de lectura, sense cookies ni
credencials. Els destinataris poden registrar les peticions. Abans d'activar,
verifica la retenció i el cost del compte de [Brave Search](https://brave.com/search/api/).
El servei no fixa cap pressupost mensual. Els resultats que el model rep
segueixen la mateixa retenció privada que la resta de la sessió.

#### Revisar en privat una edició amb recerca

Quan el tema indiqui que el canvi espera revisió, obre una terminal privada al
VPS com a persona operadora autoritzada. Fes servir el repositori del servei i
el directori `research-review` sota el seu directori d'estat. No copiïs la
sortida a la PR. L'ordre sense accés a GitHub mostra l'historial nou i les
metadades que es farien públiques:

```sh
node /usr/local/lib/mountain-runners/agent/commands/research-review/cli.mjs \
  show <directori-revisions> <repositori> <feina> <revisió>
```

Si la còpia és publicable, executa la mateixa ordre amb `approve` i confirma
l'identificador que mostra. L'ordre no fa push. Respon `/publica-revisio`
directament a un missatge del bot al tema per tornar a provar la publicació.
Si el servei informa d'una revisió nova, torna a revisar-la. Una feina sense
registre de recerca que conserva el worktree o la vinculació també exigeix
revisió. Aquesta aprovació no autoritza un merge.

Risc residual: un tema sense worktree, vinculació ni registre de revisió comença
net, encara que la sessió de Pi conservi recerca anterior. Això pot passar si es
perd l'estat de revisió o s'elimina manualment un worktree. En aquests casos, la
persona mantenidora ho ha de resoldre abans que el tema rebi cap més petició: no
el pot donar per net, i la feina independent va en un tema nou.

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
     `Pull requests: write`, lectura de checks i estats, sense `Actions: write`,
     sense escriptura a `.github/workflows` i sense lectura d'administració. Comprova que el compte
     de l'agent és col·laborador del repositori, que
     `MOUNTAIN_AGENT_REQUIRED_CHECKS` coincideix amb la protecció de `main` amb la
     branca al dia. Comprova que la protecció s'aplica també als administradors
     («enforce admins») i que el compte de l'agent no té cap bypass. Comprova els
     secrets `PREVIEW_*`, l'entorn `previews` i el DNS wildcard de
     `*.preview.mountainrunners.cat`.
   - Esperat: cada permís és el documentat i la llista de comprovacions
     coincideix amb la protecció. GitHub exigeix la branca al dia també al
     compte de l'agent en el moment del merge.
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
3. **CI vermella.**
   - Fer: obre una PR sintètica pel tema que trenqui una comprovació
     obligatòria.
   - Esperat: quan totes les comprovacions obligatòries han acabat, un avís de
     fallada, cap commit nou del servei i cap reexecució.
   - Si falla: atura el servei i anota el SHA a la PR.
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
   - Si s'ha migrat el registre d'avisos de preview, comprova
     [quins avisos poden fixar el merge](../../tools/server/agent/README.md#merge-demanat-al-tema)
     abans de fer les proves.
   - Fer: amb Telegram i GitHub simulats (`pnpm test:server`), respon a l'avís
     vigent amb «La feina està validada» i comprova que només arriba la pregunta
     fixa, sense torn de model ni avís de recepció. Respon «Sí, a producció» (i
     variants sense accents, comes o «a» com «si, produccio») i comprova que el
     merge simulat usa la PR i el SHA fixats. Prova també «Perfecte», «Sí» solt,
     una validació fora de context, un avís anterior, una persona no verificada
     o revocada entre passos, una cita, un reenviament, una edició, un fitxer,
     una confirmació solta, d'una altra persona o repetida, un enviament fallit
     o incert de la pregunta i una instrucció interposada entre la validació i la
     resposta.
   - Després, en una PR sintètica, prova els rebuigs de `/merge`: sense avís
     vigent de preview confirmada, amb un commit posterior a l'avís, sense
     `preview`, amb `preview-revoked`, amb la CI vermella o pendent,
     `/merge <PR>` d'una altra PR i una prosa com «fusiona-la». Aquests rebuigs
     no fan cap merge. Només amb l'aprovació explícita de la persona mantenidora
     en aquell moment, fes un sol merge real d'un canvi sintètic inofensiu amb
     `/merge` o `/merge <PR>`.
   - Esperat: cada validació acceptada i cada resposta «Sí, a producció»
     correcta arriben al camí determinista; una validació o confirmació fora de
     context segueix la conversa habitual i no fusiona res. Cada rebuig respon
     amb el motiu i no fusiona res. El merge real fusiona exactament el SHA de
     l'avís de preview, amb squash, i la resposta nomena la proposta fusionada;
     l'última línia és l'enllaç de revisió amb el canvi fusionat, amb el SHA
     curt.
   - Si falla: atura el servei i no tornis a escriure `/merge` ni a respondre
     «Sí, a producció» a cap pregunta. Un resultat desconegut es reconcilia
     llegint la PR; només una persona verificada el pot reconciliar amb
     `/merge <PR> <SHA>`. La reconciliació no torna a fusionar.
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
no desplega mai res. La pregunta i la confirmació «Sí, a producció» s'han provat
amb Telegram i GitHub simulats, sense cap merge real. El merge demanat encara no
s'ha provat amb una PR real: no està actiu fins que se'n verifiquin els controls,
i la primera fusió requereix l'aprovació explícita de la persona mantenidora,
segons l'ADR 0013.
