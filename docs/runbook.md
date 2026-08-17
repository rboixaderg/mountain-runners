# Runbook De Producció

## Propòsit I Estat

Aquest runbook descriu l'operació mínima de producció de Mountain Runners:
servidor, TLS, logs, salut, desplegament, reversió i resposta a incidències.
Les seccions de servidor, TLS, logs, salut i reversió corresponen a la T5.3 de
[`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md).
La T5.4 afegeix les seccions del workflow de desplegament i la T5.5 consolida el
document amb el tall i el període d'observació.

Cap acció remota (crear el VPS, registres DNS, claus SSH, secrets o activacions)
no s'executa sense l'aprovació explícita de la persona mantenidora. Cap agent,
sessió local ni assistent editorial no pot desplegar ni operar producció.

## Responsables I Canal De Vulnerabilitats

- **Persona mantenidora**: administració del VPS, aprovació del primer tall,
  rollback, revocacions, logs i resposta a incidències (T5.1).
- **Canal privat de vulnerabilitats**: Private Vulnerability Reporting de
  GitHub (`SECURITY.md`), activat i provat el 16 d'agost de 2026 (T5.1).

## 1. Servidor

### Destí

VPS de Hetzner administrat per la persona mantenidora, Debian 12 (o compatible),
amb Caddy 2.11.4 (versió pinjada i checksum SHA-512 verificat al bootstrap) com a
terminador TLS i servidor de la release activa. L'accés SSH és només amb clau
(el bootstrap desactiva l'autenticació per contrasenya); el tallafoc extern de
Hetzner només ha d'obrir 22, 80 i 443.

### Identitats

| Identitat           | Rol                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Persona mantenidora | Usuari administratiu no `root` amb `sudo` (accés per SSH amb clau; host key verificat)                          |
| `mountain-deploy`   | Usuari de sistema amb shell restringit (només el gate); clau SSH amb `command="mountain-ssh-gate"` i `restrict` |
| Daemon de releases  | Servei systemd com a `root` (`mountain-release.service`); únic escriptor de releases, registre i `current`      |
| `caddy`             | Usuari del paquet; només llegeix la release activa i escriu els logs                                            |

La clau de desplegament es fixa a
`/var/lib/mountain-runners/.ssh/authorized_keys` amb `restrict`, sense PTY ni
forwarding. La identitat de desplegament no té cap accés privilegiat al
filesystem ni `sudo`: el gate tokenitza sense shell i envia la petició al daemon
per `/run/mountain-release.sock` (grup `mountain-runners`, mode 0660), que la
revalida i l'executa com a `root`. El daemon tampoc pot escriure la
configuració de Caddy, les claus TLS ni l'estat ACME.

### Estructura

```text
/var/lib/mountain-runners/         755  root:root
├── releases/<commit>/             755  root:root (una release per commit)
├── incoming/                      2770 root:mountain-runners (uploads)
├── current                        symlink atòmic a la release activa (root)
├── releases.json                  600  root:root (registre permanent)
└── .ssh/authorized_keys           600  clau de desplegament
/var/log/mountain-runners/         700  caddy:caddy (accés només via sudo)
/run/mountain-release.sock         660  root:mountain-runners (socket del daemon)
/usr/local/lib/mountain-runners/        eines instal·lades pel bootstrap
```

### Bootstrap (provisió inicial)

Requereix aprovació prèvia i el registre DNS del host de validació apuntant al
VPS. Executar com a `root` des del checkout del repositori:

```sh
VALIDATION_HOST=validate.mountainrunners.cat \
DEPLOY_PUBLIC_KEY="ssh-ed25519 AAAA... deploy@ci" \
./tools/server/bootstrap/bootstrap.sh
```

El bootstrap és reproduïble i idempotent: instal·la Caddy pinjat amb checksum
SHA-512 verificat (`checksums.txt` oficial), crea les identitats, el layout, els directoris de logs, la
configuració de Caddy validada, el servei del daemon de releases i les eines.
Si no es passa `DEPLOY_PUBLIC_KEY`, la clau de desplegament s'afegeix després
manualment amb les mateixes opcions de forced command.

### Verificació Del Host I Accés SSH

1. Confirmar que `https://<host de validació>` respon i que el certificat és
   vàlid.
2. Fixar la identitat del servidor: registrar el fingerprint de la clau pública
   SSH del VPS (p. ex. amb `ssh-keyscan`) a `known_hosts` de les màquines
   autoritzades i verificar-lo cada vegada que canviï.
3. Comprovar permisos: cap identitat diferent de `root` no ha de poder escriure
   `/etc/caddy/`, els certificats, l'estat ACME, `releases.json` ni el symlink
   `current`. El daemon de releases ha d'estar actiu
   (`systemctl status mountain-release`).

### Còpies De Seguretat I Restauració

Hetzner fa còpies automàtiques del disc del VPS (Backups al Cloud Console).
Aquesta és la via de recuperació si es perd el servidor; no substitueix la
reversió interna de releases.

**Abans de servir el host de validació:** activar els backups automàtics del
VPS al Cloud Console de Hetzner (retenció la que ofereixi el producte, com a
mínim una còpia diària).

**Restauració** (aprovació explícita de la persona mantenidora):

1. Al Cloud Console, crear un servidor nou a partir de l'últim backup (o
   reconstruir el VPS des del backup si Hetzner ho ofereix per a aquella
   instància). No s'editen fitxers a mà dins de les releases.
2. Verificar el fingerprint SSH nou o restablert i actualitzar `known_hosts`.
3. Comprovar `systemctl is-active caddy mountain-release`,
   `sudo mountain-release health` i
   `node tools/server/verify/verify-site.mjs --base-url https://<host> --expect-noindex`.
4. Si el backup és anterior a l'última release activa, instal·lar i activar
   l'artefacte aprovat més recent pel canal de T5.4; no reconstruir al
   servidor.

La primera restauració de prova es fa després del bootstrap del VPS, abans del
tall de producció, amb un servidor de prova o un rebuild controlat.

## 2. TLS

- Caddy emet i renova certificats automàticament (Let's Encrypt) per al host de
  validació i, després del tall, per a `mountainrunners.cat` i `www`.
- El certificat de producció només es completa quan els registres DNS apunten
  al VPS; fins llavors l'error log pot mostrar intents ACME fallits (esperat).
- **HSTS**: s'activa únicament després que el tall hagi validat TLS i tots els
  subdominis afectats, sense `includeSubDomains` (decisió T5.1). La directiva
  està comentada a `Caddyfile.production` com
  `# header Strict-Transport-Security "max-age=31536000"`; s'activa
  descomentant-la, validant amb `caddy validate`, reiniciant Caddy i
  revalidant.
- Verificació de TLS: `curl --fail https://<host>/` i comprovació de la data de
  caducitat amb `openssl s_client -servername <host> -connect <host>:443`.
- Els canvis de configuració de Caddy requereixen `systemctl restart caddy`
  (`admin off` desactiva l'API de configuració en temps d'execució).

## 3. Logs

Tres registres, tots al VPS (T5.1):

| Registre | Contingut                                                  | Ubicació                                  | Retenció               |
| -------- | ---------------------------------------------------------- | ----------------------------------------- | ---------------------- |
| Access   | Temps, IP, mètode, path sense query, status, bytes, durada | `/var/log/mountain-runners/access.log`    | 7 dies, rotació diària |
| Error    | Fallades TLS/ACME i errors del servidor                    | `/var/log/mountain-runners/error.log`     | 30 dies                |
| Releases | Commit, digests, dates i estat de cada release             | `/var/lib/mountain-runners/releases.json` | Permanent              |

- La rotació és diària a mitjanit (integració de Caddy) amb compressió gzip.
- Accés exclusivament per `root` via `sudo`; cap credencial ni query string
  sensible no es registra. Caddy sempre afegeix `ts`, `level`, `logger` i
  `msg` als JSON; no es poden filtrar. La resta de camps no aprovats
  (`resp_headers`, `uri`, capçaleres, TLS, etc.) s'esborren.
- Esborrat: eliminar els fitxers de `/var/log/mountain-runners/` (la rotació
  ja n'elimina els antics segons la retenció).

## 4. Salut

Comprovacions locals (com a `root`):

```sh
sudo mountain-release health             # registre, symlink, digests
systemctl is-active mountain-release     # daemon de releases actiu
systemctl is-active caddy                # servei actiu
curl --fail https://<host>/ca/           # resposta TLS + HTTP
```

La identitat de desplegament consulta l'estat a través del gate
(`mountain-release health`), que el daemon resol com a `root`.

Comprovació remota del contracte complet (headers, 404, caché, noindex):

```sh
node tools/server/verify/verify-site.mjs --base-url https://<host> --expect-noindex
```

`mountain-release health` verifica que el registre es pot llegir, que `current`
apunta a una release registrada com a `active` i que els digests de la release
activa coincideixen amb el manifest. Un estat `DEGRADED` requereix revisió
immediata: no s'activa cap release nova fins a resoldre'l.

## 5. Releases I Reversió

### Instal·lació I Activació

L'artefacte i el manifest els genera el workflow d'artefacte (T5.2). Es pugen a
`/var/lib/mountain-runners/incoming/` i s'instal·len:

```sh
sudo mountain-release install <arxiu.tar.gz> <manifest.json>
sudo mountain-release activate <commit>
```

La identitat de desplegament executa les mateixes operacions a través del gate
SSH (forçat al daemon), que tokenitza sense shell. El daemon valida tots els
arguments i no permet cap altra ordena. `install` rebutja paths absoluts,
`..`, symlinks, hardlinks, dispositius, fitxers duplicats, qualsevol tipus
inesperat i qualsevol arxiu que superi els límits aprovats (128 MiB expandits,
5.000 entrades, arxiu comprimit màxim 256 MiB); verifica tots els digests
contra el manifest i, en cas de fallada, elimina la release incompleta sense
tocar el punter actiu. `activate` canvia el symlink `current` de manera
atòmica (rename) després de verificar digests i elegibilitat.

### Reversió Rutinària (Interna)

Sense tocar DNS, s'activa la release anterior elegible més recent:

```sh
sudo mountain-release rollback            # release anterior elegible
sudo mountain-release rollback <commit>   # release elegible concreta
```

La reversió verifica elegibilitat i digests i rebutja releases revocades. Si el
workflow de desplegament ha quedat inconsistent amb el registre, `activate` és
idempotent i reconvergeix l'estat.

### Revocació

```sh
sudo mountain-release revoke <commit> --reason "vulnerabilitat X"
```

Motius aprovats: vulnerabilitat, retirada de consentiment, contingut incorrecte
o incidència legal. La release activa no es pot revocar: primer s'activa o es
reverteix a una altra. Les releases revocades no es poden reactivar mai.

### Reversió DNS Inicial (Via Extraordinària)

Si no queda cap release elegible i s'ha d'aturar el servei de la release
activa, la resposta d'emergència (secció 6) és la via prevista. La restauració
dels registres web anteriors de Hostinger queda només com a via extraordinària:
requereix l'exportació prèvia al tall (T5.5), aprovació explícita de la persona
mantenidora i no es pot executar automàticament.

## 6. Resposta D'Emergència (Sense Cap Release Elegible)

Quan `mountain-release rollback` informa que no queda cap release elegible
(codi 3), la resposta d'emergència és la següent:

1. **Registrar l'incident**: causa, releases implicades i motius de revocació
   (el registre de releases és permanent i traçable).
2. **Avaluar la release activa**: si `mountain-release health` està OK, el lloc
   continua servint la release activa; no es retira res més.
3. **Preparar una correcció pel canal aprovat**: PR revisada i fusionada a
   `main` → el workflow d'artefacte genera un artefacte nou → `install` i
   `activate`. Aquesta és l'única via de recuperació: no es reconstrueix al
   servidor, no s'editen fitxers manualment dins de la release, no es reactiva
   cap artefacte revocat i no s'altera el registre a mà.
4. **Si cal retirar la web de servei mentre es prepara la correcció**: decisió
   de la persona mantenidora amb aprovació explícita; documentar l'estat al
   registre de releases i al canal de vulnerabilitats.
5. **Via extraordinària**: la restauració dels registres web anteriors a
   Hostinger (secció 5) només s'executa amb aprovació explícita i registre de
   la decisió.

Prohibicions permanents: reconstruir al servidor, editar fitxers de la release
a mà, reactivar una release revocada i editar `releases.json` manualment.

## 7. Seccions Pendents

- **Desplegament continu des de `main`** (T5.4): workflow protegit, secret de
  mínim privilegi, smoke tests i workflow de rollback.
- **Tall i operació de producció** (T5.5): canvis DNS, primer tall, període
  d'observació i consolidació d'aquest runbook.
