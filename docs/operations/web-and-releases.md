# Web I Releases

Aquest document descriu com funciona i com s'opera el desplegament de la web i
les releases. El contingut compartit de servidor, identitats, còpies, logs,
salut i resposta a emergències és al [`README.md`](README.md).

## Com funciona

### Controls

- La branca principal està protegida i els desplegaments de producció només
  s'originen des d'execucions CI/CD revisades i correctes.
- Les credencials del servidor, claus d'API i configuració de serveis es desen
  fora del repositori, en magatzems de secrets aprovats.
- L'accés a producció aplica el principi de mínim privilegi i es limita a
  persones mantenidores identificades.
- Per als límits de l'operació manual, consulta el
  [procediment compartit](README.md#propòsit).

### Contracte De Build

- `pnpm build` genera una sortida Astro estàtica a `apps/web/dist/`.
- `PUBLIC_SITE_ORIGIN` és obligatori per generar canonical, `hreflang`, sitemap
  i `robots.txt`; producció ha d'utilitzar `https://mountainrunners.cat`.
- `PUBLIC_PREVIEW` només accepta `true`, `false`, cadena buida o absència. Els dos
  últims casos equivalen a `false`.
  Els entry points oficials fixen explícitament `false` per a producció i `true`
  per a preview i rebutgen flags contradictoris. El constructor d'artefactes de
  preview exigeix l'origen exacte de la PR, mai el de producció; el constructor
  de producció exigeix `https://mountainrunners.cat`. El preview només habilita esborranys de
  posts complets, segons l'[ADR 0011](../decisions/0011-news-blog-editorial-previews.md).
- `BUILD_TODAY` permet fixar la data editorial del build. Les proves i la CI la
  fixen per obtenir resultats deterministes; un build sense aquesta variable
  utilitza la data actual de Madrid.
- `dist/` és un artefacte generat i no una font de veritat. Producció no pot
  reutilitzar una sortida local existent: ha de desplegar un artefacte net creat
  per CI des del commit aprovat.

### Contracte D'Artefacte

`tools/release/build-artifact.mjs` és el contracte reutilitzable de la T5.2:
construeix la web, verifica la superfície canònica de sortida, registra un
manifest immutable i empaqueta només fitxers regulars amb paths relatius. El
job de desplegament de la T5.4 transfereix aquest paquet; no es reconstrueix
al servidor.

Ordre d'execució (a CI o manualment):

1. `pnpm build` amb `PUBLIC_PREVIEW=false`, `PUBLIC_SITE_ORIGIN` i `BUILD_TODAY` explícits, que ja
   executa la verificació de sortida existent (`verify-i18n-output.mjs`:
   rutes seleccionades des de les fonts, `/`, 404, sitemap, robots, recursos i
   exclusió de rutes i marcadors d'esborranys). El mateix verificador permet
   detalls editorials d'esborrany només amb `PUBLIC_PREVIEW=true`; mai al sitemap.
2. `tools/release/verify-internal-links.mjs`: els enllaços interns (href, src,
   srcset i `url()` de CSS) i fitxers locals són bloquejants i han de resoldre
   dins del build. Els absoluts (inclosos els same-origin que apunten fora del
   build, com el web anterior de l'Anella Verda) es validen només
   estructuralment.
3. Generació del manifest `artifacts/release/manifest.json` amb schema,
   commit, origen, `BUILD_TODAY`, workflow, límits, totals i la llista de
   fitxers amb mida i SHA-256.
4. Empaquetat `artifacts/release/mountain-runners-<commit>.tar.gz` només amb
   fitxers regulars i paths relatius; el contingut del paquet es verifica
   contra la llista del manifest.

Límits aprovats de l'artefacte (fitxers regulars, mida expandida):

| Límit              | Valor   | Justificació                                      |
| ------------------ | ------- | ------------------------------------------------- |
| Mida expandida màx | 128 MiB | Build actual ≈ 21 MB (PDF d'estatuts 12 MB)       |
| Nombre de fitxers  | 5.000   | Recompte real registrat al manifest de cada build |

Scripts associats: `pnpm artifact` (contracte complet) i
`pnpm artifact:reproducibility` (dos builds nets amb les mateixes entrades han
de produir la mateixa llista de fitxers i els mateixos digests SHA-256). Els
scripts resolen `BUILD_TODAY` a la data de Madrid quan no es defineix, i es pot
sobreescriure amb qualsevol `YYYY-MM-DD` per reproduir un manifest anterior;
`PUBLIC_SITE_ORIGIN` es fixa a `https://mountainrunners.cat`.

El workflow `Artifact` (`.github/workflows/artifact.yml`) executa el contracte
a cada push a `main` i de forma manual, amb `BUILD_TODAY` resolt a la data de
Madrid, i puja el paquet i el manifest com a artefacte del run (retenció de 3
dies: el job de desplegament del mateix run el descarrega per nom i la reversió
activa releases ja instal·lades al host). El job de build no accedeix a cap
secret. El job `Deploy to production` del mateix workflow, darrere de l'entorn
GitHub `production` restringit a `main`, descarrega aquest artefacte, en
verifica manifest i digests, el transfereix amb `mountain-release receive`,
l'instal·la i l'activa, i executa els smoke tests. El workflow `Rollback
production` reverteix sense reconstruir.
Tots dos comparteixen el grup de concurrència `production-release` amb
`cancel-in-progress: false`. L'operació completa és a [Com s'opera](#com-sopera).

Límits coneguts del contracte (no bloquejants a la T5.2): l'arxiu es verifica
per llista de noms al build; el job de desplegament re-verifica el digest de
l'arxiu després de `receive` i el daemon re-verifica cada fitxer extret contra
el manifest. La reproductibilitat s'executa sobre dos builds calents del
mateix runner (el store de pnpm persisteix); i la cobertura d'enllaços és
`href`, `src`, `srcset` i `url()` de CSS, no atributs JS dinàmics.

### Servidor I Releases

Les eines de la T5.3 viuen a `tools/server/` i l'operació completa a
[Com s'opera](#com-sopera). El diagrama Mermaid de la configuració del
servidor (identitats, Caddy, gate, daemon i layout) és a
[`README.md`](README.md#arquitectura-del-servidor); s'actualitza amb
cada canvi d'aquesta arquitectura.

- **Bootstrap reproduïble** (`tools/server/bootstrap/bootstrap.sh`): provisiona
  el VPS de Hetzner amb Caddy 2.11.4 pinjat (checksum SHA-512 del
  `checksums.txt` oficial de Caddy),
  identitats separades de desplegament i Caddy, el layout de releases, els
  directoris de logs, la configuració de Caddy validada i el daemon de releases
  (systemd, root). Cap acció remota s'executa sense l'aprovació de la persona
  mantenidora.
- **Configuració Caddy** (`tools/server/caddy/`): host de validació amb
  `X-Robots-Tag: noindex, nofollow, noarchive`, headers mínims i CSP aprovades a
  T5.1, 404 global, rutes amb barra final preservades, caché immutable per a
  `/_astro/*` i curta per a `/content-resources/*`, i logs minimitzats amb els
  camps aprovats (la query string mai no es registra). El host de producció
  s'activa al tall (T5.5) important `Caddyfile.production`. El fragment
  `Caddyfile.redirects` conté el mapa de redireccions permanents de les URLs de
  llegat amb trànsit, amb les rutes no incloses en 404.
- **CLI de releases** (`tools/server/release/`): `install` (extracció segura:
  rebutja paths absoluts, `..`, symlinks, hardlinks, dispositius, duplicats i
  límits de mida/fitxers, verifica tots els digests contra el manifest i
  consumeix els uploads que ha instal·lat), `activate` (symlink `current`
  atòmic), `rollback` (release anterior elegible, codi 3 quan no n'hi ha cap),
  `revoke`, `prune` (finestra de retenció de 5) i `health`. La persona
  mantenidora les executa amb `sudo`; la identitat de desplegament només pot
  arribar-hi a través del forced command `ssh-gate.mjs` (tokenitza sense shell i
  valida tots els arguments) i el daemon root
  (`mountain-release.service`), que revalida cada petició per
  `/run/mountain-release.sock` i és l'únic escriptor de les releases, del
  registre i del symlink actiu.
- **Registre de releases** (`/var/lib/mountain-runners/releases.json`):
  permanent, amb commit, digests, dates i estat (`eligible`/`active`/`revoked`);
  les releases revocades mai no es reactiven. La permanència cobreix el
  registre, no els arbres extrets: `prune` marca amb `prunedAt` les entrades que
  ja no tenen directori, de manera que una release podada no torna a ser
  elegible. La poda prioritza l'anterior activa elegible abans de les altres
  candidates més recents.
- **Polítiques públiques**: la política de privacitat descriu l'allotjament a
  Hetzner i els registres del servidor (7 dies d'accés, 30 d'error).

#### Ordres de `mountain-release`

Les de consulta no muten res. Les d'escriptura passen pel bloqueig del registre.
Pel gate SSH, la identitat de desplegament només pot enviar `install`,
`activate`, `rollback`, `revoke`, `prune` (sense arguments), `list` i `health`.

| Ordre                    | Consulta o escriptura | Efecte                                                            |
| ------------------------ | --------------------- | ----------------------------------------------------------------- |
| `list` / `health`        | Consulta              | Registre, symlink, digests i coherència disc-registre             |
| `install <arxiu> <json>` | Escriptura            | Registra una release i consumeix els uploads                      |
| `activate <commit>`      | Escriptura            | Mou `current` de manera atòmica                                   |
| `rollback [<commit>]`    | Escriptura            | Activa la release anterior elegible                               |
| `revoke <commit>`        | Escriptura            | Marca la release com a revocada; mai no es reactiva               |
| `prune [--keep <n>]`     | Escriptura            | Conserva la finestra, marca `prunedAt` i esborra arbres i uploads |
| `receive <fitxer>`       | Escriptura            | Desa un upload a `incoming/` (no passa pel daemon)                |
| `daemon`                 | Servei                | Escolta el socket i executa les peticions validades               |

La reversió rutinària és interna (canvia el punter atòmic sense tocar DNS); la
restauració dels registres web anteriors de Hostinger queda com a via
extraordinària amb aprovació explícita, i la
[resposta d'emergència](README.md#resposta-demergència-sense-cap-release-elegible)
s'aplica quan no queda cap release elegible.

### Desplegament Continu

`tools/deploy/` orquestra el pas de l'artefacte de CI al VPS:

- `deploy.mjs` verifica manifest i digests, rebutja un commit que ja no és el
  HEAD de `main`, transfereix amb `receive`, instal·la, activa, executa smoke
  tests i, finalment, poda la finestra de releases perquè el disc no creixi amb
  cada desplegament. Una fallada després d'activar restaura el commit que era
  actiu, no un `rollback` genèric; una poda fallida només deixa un avís. La
  comprovació de HEAD es repeteix després d'activar.
- `rollback.mjs` és l'única via automatitzada per activar una release anterior
  elegible, sense reconstruir.

L'operació, els noms de secrets i el procediment d'aprovació són a
[Com s'opera](#com-sopera).

### CI Implementada

GitHub Actions executa qualitat, E2E, Conventional Commits, detecció de secrets,
revisió de dependències, CodeQL, el contracte d'artefacte de la T5.2, el
desplegament continu i el rollback de la T5.4, el build no fiable i el
publicador de previews de la T6.3, i els tests de les eines del
servidor (`pnpm test:server`). `pnpm validate` no executa Lighthouse;
`pnpm lighthouse` és una auditoria manual separada.

## Com s'opera

### Bloqueig De Lectura De Les Releases De Producció

El bootstrap instal·la `acl` i, després de crear `preview-deploy`, afegeix una
ACL d'accés `u:preview-deploy:---` només a
`/var/lib/mountain-runners`. El directori continua amb el mateix owner, grup i
mode `0755`; Caddy i `mountain-deploy` continuen travessant-lo. L'entrada
nominal d'usuari es comprova abans de les entrades de grup, per tant també
denega accés si `preview-deploy` rep algun grup de producció per error. No
afegeixis membres a `mountain-runners` ni toquis el socket del daemon.

Per migrar un VPS existent, una persona mantenidora ha de revisar primer la
sortida actual de `getfacl -p` i comprovar que el root és `root:root 0755`.
Desa l'ACL original fora del repositori. Després que `preview-deploy` existeixi,
executa només aquesta ACL, sense `-R` i sense canviar `chmod` o grups:

```sh
RELEASE_ROOT=/var/lib/mountain-runners
sudo apt-get install acl
sudo stat -c '%U:%G %a %n' "$RELEASE_ROOT"
sudo getfacl -p "$RELEASE_ROOT"
sudo getfacl -p "$RELEASE_ROOT" > "$HOME/mountain-runners-release.acl.before-preview"
sudo -u caddy test -x "$RELEASE_ROOT"
sudo -u mountain-deploy test -x "$RELEASE_ROOT"
sudo setfacl -n -m u:preview-deploy:--- "$RELEASE_ROOT"
sudo getfacl -p "$RELEASE_ROOT"
sudo -u preview-deploy ls "$RELEASE_ROOT" >/dev/null
sudo -u preview-deploy /bin/sh -c 'cd "$1"' sh "$RELEASE_ROOT"
sudo -u caddy test -r "$RELEASE_ROOT"
sudo -u caddy test -x "$RELEASE_ROOT"
sudo -u mountain-deploy test -r "$RELEASE_ROOT"
sudo -u mountain-deploy test -x "$RELEASE_ROOT"
```

Les dues ordres com a `preview-deploy` han de fallar perquè no pot llistar ni
travessar el directori; confirma que l'error és de permisos. Les comprovacions
amb `test -r` i `test -x` poden donar falsos positius en aquest entorn i no són
prova suficient de l'aïllament.

`-n` conserva una ACL mask existent. Sense una ACL estesa prèvia, la màscara
creada és igual als permisos del grup existent (`r-x`), i la nova entrada
`---` no els amplia. Compara `getfacl` abans i després: només ha d'aparèixer
l'entrada de `preview-deploy` i, si no n'hi havia, la màscara equivalent a
`group::`. Atura't i restaura el fitxer desat si canvia qualsevol altra entrada
o fallen les comprovacions de Caddy o del desplegament:
`sudo setfacl --restore="$HOME/mountain-runners-release.acl.before-preview"`.
Després comprova `sudo mountain-release health` i el lloc públic.
L'ACL no cobreix `/etc/caddy`, claus TLS o ACME; aquestes rutes mantenen els
permisos existents.

### Releases I Reversió

#### Instal·lació I Activació

El workflow `Artifact` genera l'artefacte i el manifest. El job de desplegament
els transfereix a `incoming/` amb `mountain-release receive` i els instal·la.
En una recuperació aprovada, la persona mantenidora pot instal·lar i activar al
VPS el mateix artefacte verificat de CI:

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
tocar el punter actiu. En cas d'èxit consumeix l'arxiu i el manifest, de manera
que `incoming/` no creix amb els desplegaments. `activate` canvia el symlink
`current` de manera atòmica (rename) després de verificar digests i
elegibilitat.

#### Retenció I Poda

Després d'un desplegament verificat, `prune` conserva fins a 5 releases: l'activa,
l'anterior activa si encara és elegible, i les elegibles instal·lades més
recentment. El límit correspon a uns 120 MB amb la mida actual:

```sh
sudo mountain-release prune              # finestra aprovada de 5
sudo mountain-release prune --keep 3     # només si cal reduir el disc
```

- El registre és permanent: cada entrada conserva commit, digests, dates i
  estat, amb `prunedAt` quan el directori ja no hi és. Una release podada no
  torna a ser elegible ni es pot reinstal·lar amb el mateix commit. Per recuperar
  el contingut cal preparar un commit nou i publicar-lo pel flux revisat.
- `prune` s'executa sota el bloqueig del registre, desa el registre abans
  d'esborrar directoris i, si s'interromp, la propera execució el reconcilia
  (un directori orfe és inofensiu; una entrada orfe trencaria la reversió).
- Rebutja podar si no hi ha exactament una release activa, si `current` no hi
  apunta o si falta l'arbre actiu. Marca com a podades les entrades inactives
  sense directori i conserva les candidates disponibles. La finestra és un
  màxim: no garanteix que existeixi cap release elegible.
- Esborra també els directoris sense entrada i els uploads de més d'un dia.
- El job de desplegament l'executa després de verificar la release activa; una
  poda fallida no reverteix el desplegament. La identitat de desplegament no
  pot canviar la finestra: pel gate, `prune` no accepta arguments.

#### Actualitzar les eines en un VPS existent

Segueix els [límits del manteniment manual](README.md#propòsit). Amb l'aprovació
explícita de la persona mantenidora, prepara al VPS un commit revisat de `main`.
No executis el bootstrap: reescriu el Caddyfile. Si el canvi afecta les previews
o els mòduls compartits, comença per l'[actualització coordinada](previews.md#actualitzar-les-eines).
Si només afecta releases, obre una
[finestra de manteniment](README.md#finestra-de-manteniment-de-releases-i-previews)
i segueix el pas següent.

##### Substituir les eines de releases

Amb la finestra de manteniment oberta, executa com a root:

```sh
REPO=/path/to/reviewed/mountain_runners
LIB=/usr/local/lib/mountain-runners
install -d -m 2770 -o root -g mountain-runners /var/lib/mountain-runners/incoming
install -m 0644 -o root -g root \
  "$REPO/tools/server/release/"{config,fsutil,manifest,archive,registry,validate,operations,receive}.mjs "$LIB/"
install -m 0755 -o root -g root \
  "$REPO/tools/server/release/"{cli,daemon,ssh-gate}.mjs "$LIB/"
systemctl restart mountain-release.service
mountain-release health
```

Si `health` només informa d'arbres inactius absents, executa
`mountain-release prune` i torna a comprovar `health`. Si falta l'arbre actiu o
la poda falla, atura l'actualització i segueix la resposta d'emergència. Abans
de reprendre els desplegaments, comprova també el gate SSH.

#### Reversió Rutinària (Interna)

La reversió requereix l'aprovació explícita de la persona mantenidora. Fes-la
amb el [workflow protegit](#reversió-des-del-workflow). Si cal operar al VPS,
aquestes ordres són de la persona mantenidora. Sense tocar DNS, s'activa
l'anterior release activa si encara és elegible. Si no es coneix o ja no és
elegible, se selecciona la instal·lada més recent:

```sh
sudo mountain-release rollback            # release anterior elegible
sudo mountain-release rollback <commit>   # release elegible concreta
```

Una release podada no és elegible. La finestra limita les candidates de
reversió, però no en garanteix cap si falten arbres o s'han revocat releases.

La reversió verifica elegibilitat i digests i rebutja releases revocades. Si el
workflow de desplegament ha quedat inconsistent amb el registre, `activate` és
idempotent i reconvergeix l'estat.

#### Revocació

```sh
sudo mountain-release revoke <commit> --reason "vulnerabilitat X"
```

Motius aprovats: vulnerabilitat, retirada de consentiment, contingut incorrecte
o incidència legal. La release activa no es pot revocar: primer s'activa o es
reverteix a una altra. Les releases revocades no es poden reactivar mai.

#### Reversió DNS Inicial (Via Extraordinària)

Si no queda cap release elegible i s'ha d'aturar el servei de la release
activa, la [resposta d'emergència](README.md#resposta-demergència-sense-cap-release-elegible)
és la via prevista. La restauració
dels registres web anteriors de Hostinger queda només com a via extraordinària:
requereix l'exportació prèvia al tall (T5.5), aprovació explícita de la persona
mantenidora i no es pot executar automàticament.

### Desplegament Continu Des De `main`

El workflow `Artifact` construeix i valida l'artefacte (T5.2) i, al mateix run,
el job `Deploy to production` transfereix **el mateix** paquet al VPS. El job
de build no té `environment` ni secrets de producció. El job de desplegament
llegeix els secrets de l'entorn `production`; el de rollback, els de
`production-rollback`.

#### Entorn GitHub `production`

Configuració vigent a Settings → Environments. El gate manual de
desplegament es va retirar un cop tancat el
[llançament](#tall-dns-i-primera-activació-pública).

| Control             | Valor        |
| ------------------- | ------------ |
| Nom                 | `production` |
| Deployment branches | només `main` |
| Required reviewers  | cap          |
| Wait timer          | 0            |

Variables d'entorn (Settings → Environments → `production` → Environment
variables):

| Nom                    | Contingut                                                    |
| ---------------------- | ------------------------------------------------------------ |
| `DEPLOY_HOST`          | hostname o IP del VPS per a SSH                              |
| `DEPLOY_USER`          | `mountain-deploy` (opcional; aquest és el valor per defecte) |
| `SMOKE_BASE_URL`       | `https://mountainrunners.cat`                                |
| `SMOKE_EXPECT_NOINDEX` | `false`                                                      |

Secrets d'entorn:

| Nom                      | Contingut                                            |
| ------------------------ | ---------------------------------------------------- |
| `DEPLOY_SSH_PRIVATE_KEY` | clau privada de la identitat `mountain-deploy`       |
| `DEPLOY_KNOWN_HOSTS`     | línia `known_hosts` amb el fingerprint SSH verificat |

Aquests secrets no es comparteixen amb previews (fase 6) ni amb el job de
build. El workflow no desplega des de forks ni des de branques diferents de
`main`.

#### Entorn GitHub `production-rollback`

El workflow `Rollback production` usa un entorn separat que exigeix
aprovació humana en cada reversió.

| Control             | Valor                                         |
| ------------------- | --------------------------------------------- |
| Nom                 | `production-rollback`                         |
| Deployment branches | només `main`                                  |
| Required reviewers  | la persona mantenidora; **no es retiren mai** |
| Wait timer          | 0                                             |

Abans d'executar `Rollback production`, comprova que l'entorn existeix i té
aquestes proteccions. Si el nom no existeix, GitHub el crea sense regles de
protecció ni secrets. Ha de tenir els **mateixos noms**
de variables i secrets que `production` (`DEPLOY_HOST`, `DEPLOY_USER`,
`SMOKE_BASE_URL`, `SMOKE_EXPECT_NOINDEX`, `DEPLOY_SSH_PRIVATE_KEY`,
`DEPLOY_KNOWN_HOSTS`). Els valors no es documenten. Només la persona
mantenidora configura aquests entorns i aprova les reversions.

#### Flux

1. Push (o `workflow_dispatch`) a `main` → jobs `build` i `reproducibility`
   sense secrets.
2. El job `deploy` usa l'entorn `production` i ocupa el grup de
   concurrència `production-release` (`cancel-in-progress: false`).
3. `tools/deploy/deploy.mjs` comprova que `github.sha` encara és el HEAD de
   `main`; si no, rebutja l'execució (no és una reversió).
4. Verifica el manifest i l'arxiu localment (commit, origen, llista de
   fitxers).
5. Transfereix l'arxiu i el manifest amb `mountain-release receive` (stdin
   per SSH; `restrict` impedeix scp/sftp) i comprova el SHA-256 retornat.
6. `install` (extracció segura al servidor) i, immediatament abans d'activar,
   torna a comprovar el HEAD de `main`.
7. Llegeix el commit actiu actual i fa `activate` (symlink atòmic). Una
   fallada abans d'aquest pas no mou el punter actiu.
8. Torna a comprovar el HEAD de `main`, després `health` i smoke tests
   (`tools/server/verify/verify-site.mjs` amb `--expect-noindex` mentre el
   host de validació és el destí, o `--expect-indexable` quan
   `SMOKE_EXPECT_NOINDEX` és `false`). Si fallen, restaura el commit que era
   actiu abans d'aquest `activate` (no un `rollback` genèric). Si no n'hi
   havia cap, registra la
   [resposta d'emergència](README.md#resposta-demergència-sense-cap-release-elegible)
   i falla.
9. Amb la release activa verificada, executa `mountain-release prune` per
   mantenir la finestra de 5. Si la poda falla, ho registra com a avís i el
   desplegament continua.

Reexecutar el mateix commit és idempotent: si la release ja és activa, el job
només revalida salut i smoke.

#### Smoke Tests

L'apex ja és públic. El smoke de CI usa `SMOKE_BASE_URL=https://mountainrunners.cat`
i `SMOKE_EXPECT_NOINDEX=false`, que afegeix `--expect-indexable` i comprova la
redirecció `www` → apex. El valor buit o distint de `false` continuaria
afegint `--expect-noindex` (host de validació).

```sh
# Host de validació
node tools/server/verify/verify-site.mjs \
  --base-url "$SMOKE_BASE_URL" \
  --expect-noindex

# Apex, després del tall
node tools/server/verify/verify-site.mjs \
  --base-url https://mountainrunners.cat \
  --expect-indexable
```

### Reversió Des Del Workflow

El workflow `Rollback production` (`.github/workflows/rollback.yml`) és
`workflow_dispatch` sobre `main`, amb l'entorn `production-rollback` (required
reviewers permanents) i el mateix grup de concurrència `production-release`.
No reconstrueix. L'input opcional `commit` ha de ser un SHA-1 de 40 caràcters
d'una release **elegible**; buit selecciona la release elegible anterior.

Una execució retardada del workflow `Artifact` d'un commit antic **no** és una
reversió: es rebutja al pas 3 del [flux](#flux). Només aquest workflow (o
`sudo mountain-release rollback` al servidor) pot moure el punter enrere.

Després d'activar, executa els mateixos smoke tests. Si fallen, restaura el
commit que era actiu abans d'aquest rollback. Una release revocada és
rebutjada pel daemon.

### TLS

- Caddy emet i renova certificats automàticament (Let's Encrypt) per al host de
  validació, `mountainrunners.cat` i `www`.
- A l'apex s'aplica HSTS amb `max-age=31536000` i sense `includeSubDomains`.
  Afegeix `--expect-hsts` al [smoke de l'apex](#smoke-tests) per comprovar-lo.
  Si refàs la configuració des de `Caddyfile.production`, valida TLS i els
  subdominis afectats abans de recuperar la capçalera.
- Verificació de TLS: `curl --fail https://<host>/` i comprovació de la data de
  caducitat amb `openssl s_client -servername <host> -connect <host>:443`.
- Els canvis de configuració de Caddy requereixen `systemctl restart caddy`
  (`admin off` desactiva l'API de configuració en temps d'execució).

#### Redirecció De L'Arrel

El matcher `@unprefixed_root` de `(common_site)` respon a `GET /` amb una
redirecció HTTP permanent a `/ca/` abans que `file_server` serveixi
`index.html`. Només coincideix amb l'arrel, de manera que `/ca/`, `/es/`,
`/en/` i la resta de rutes publicades no canvien. L'`index.html` amb
`meta refresh` es conserva a l'artefacte com a fallback si se serveix sense
Caddy.

El desplegament de l'artefacte no actualitza Caddy. Després de fusionar el canvi,
una persona mantenidora ha d'afegir aquestes directives dins de
`(common_site)`, després dels imports de capçaleres i memòria cau, a
`/etc/caddy/Caddyfile`:

```caddyfile
@unprefixed_root path /
redir @unprefixed_root /ca/ permanent
```

Tot seguit cal validar, reiniciar i comprovar el contracte:

```sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl restart caddy
node tools/server/verify/verify-site.mjs --base-url https://mountainrunners.cat --expect-indexable
```

#### Redireccions D'URLs De Llegat

El fragment `(legacy_redirects)` viu a `tools/server/caddy/Caddyfile.redirects`
i el mapa complet, amb els volums de Plausible i les exclusions, és a
[`docs/specs/legacy-url-redirects.md`](../specs/legacy-url-redirects.md). El
fragment importa regles tancades de paths: cap ruta no inclosa no canvia i
continua responent 404. El desplegament de l'artefacte no actualitza Caddy.

Per aplicar el mapa al VPS, una persona mantenidora copia el fragment i
afegeix els tres imports a `/etc/caddy/Caddyfile`, sense reexecutar el bootstrap
(que tornaria a comentar `import Caddyfile.production`):

```sh
install -m 0644 -o root -g root tools/server/caddy/Caddyfile.redirects /etc/caddy/Caddyfile.redirects
```

```caddyfile
# A l'inici de /etc/caddy/Caddyfile, després del bloc global d'opcions:
import Caddyfile.redirects

# Dins de (common_site), després de la redirecció d'arrel:
import legacy_redirects
import locale_redirects
```

`legacy_redirects` cobreix les URLs antigues i les sondes, i `locale_redirects`
afegeix el prefix d'idioma (ca, es o en) a les rutes actuals que arriben sense
prefix, inclosos els detalls catalans d'escoles, esdeveniments i blog. Les
variants amb i sense barra final apunten directament a la ruta canònica amb
barra, sense un segon salt de `file_server`.

Tot seguit cal validar, reiniciar i comprovar les redireccions representatives i
el 404 de les rutes excloses:

```sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl restart caddy
node tools/server/verify/verify-site.mjs --base-url https://mountainrunners.cat --expect-indexable
```

`verify-site` comprova sempre les redireccions, també quan l'executen els
smoke tests de desplegament i de reversió. No cal cap flag addicional. Si una
redirecció comprovada falla, el smoke falla. Abans d'utilitzar el verificador
en un host nou, cal instal·lar i activar el fragment de Caddy; el desplegament
de l'artefacte continua sense actualitzar aquesta configuració.

#### CSP I Analítica

La CSP vigent (T5.1 esmenada per l'[ADR 0007](../decisions/0007-self-hosted-plausible-analytics.md))
viu a `tools/server/caddy/Caddyfile` dins de `(common_headers)` i s'aplica tant
al host de validació com al de producció. El desplegament de l'artefacte no
actualitza Caddy.

Per aplicar una esmena de CSP al VPS, una persona mantenidora actualitza
**només** la línia `header Content-Security-Policy` d'`/etc/caddy/Caddyfile`
perquè coincideixi amb el repositori, sense reexecutar el bootstrap (que
tornaria a comentar `import Caddyfile.production`). Després:

```sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl restart caddy
node tools/server/verify/verify-site.mjs --base-url https://mountainrunners.cat --expect-indexable
```

Si l'artefacte amb l'script de Plausible es publica abans d'aquesta esmena, la
CSP anterior bloqueja l'script i les pàgines continuen navegables.

### Tall DNS I Primera Activació Pública

El tall públic es va fer el 19 d'agost de 2026. El
[registre de llançament](../specs/phase-5/phase-5-t55-launch-gate.md) recull la
validació del tall, HSTS, l'observació i la retirada del gate de `production`
el 28 d'agost. L'[inventari DNS](../specs/phase-5/phase-5-t55-dns-inventory.md)
conserva els registres previs al tall. Qualsevol canvi de DNS l'aprova i
l'aplica la persona mantenidora.
