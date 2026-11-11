# Direcció De Desplegament

## Estat Actual

El repositori disposa de CI de qualitat, seguretat, contracte d'artefacte i
desplegament continu protegit des de `main`. L'apex i `www` ja serveixen des
del VPS (19 d'agost de 2026) i la fase 5 es va tancar el 28 d'agost de 2026
amb el gate de llançament, l'HSTS i el període d'observació completats
([runbook](runbook.md#9-tall-dns-i-primera-activació-pública)). Les fases 5 i 6
estan tancades: la T6.1 i la T6.2 van fixar els requisits i l'arquitectura de
previews ([ADR 0009](decisions/0009-pr-previews-same-domain-and-own-branches.md)),
la T6.3 implementa la frontera entre el build no fiable i el publicador, i el
sistema de previews està activat i validat al VPS (T6.5).

## Destí

El projecte s'adreça a un VPS modest, amb Caddy com a proxy invers públic i
terminador TLS. La web estàtica i la futura API de xat es mantenen com a unitats
de desplegament separades.

## Controls

- La branca principal està protegida i els desplegaments de producció només
  s'originen des d'execucions CI/CD revisades i correctes.
- Les credencials del servidor, claus d'API i configuració de serveis es desen
  fora del repositori, en magatzems de secrets aprovats.
- L'accés a producció aplica el principi de mínim privilegi i es limita a
  persones mantenidores identificades.
- Cal definir la reversió, els logs i les comprovacions de salut abans del
  primer desplegament a producció.
- Cap agent, sessió local de shell ni flux editorial pot desplegar directament.

## Contracte De Build Actual

- `pnpm build` genera una sortida Astro estàtica a `apps/web/dist/`.
- `PUBLIC_SITE_ORIGIN` és obligatori per generar canonical, `hreflang`, sitemap
  i `robots.txt`; producció ha d'utilitzar `https://mountainrunners.cat`.
- `PUBLIC_PREVIEW` només accepta `true`, `false`, cadena buida o absència. Els dos
  últims casos equivalen a `false`.
  Els entry points oficials fixen explícitament `false` per a producció i `true`
  per a preview i rebutgen flags contradictoris. El constructor d'artefactes de
  preview exigeix l'origen exacte de la PR, mai el de producció; el constructor
  de producció exigeix `https://mountainrunners.cat`. El preview només habilita esborranys de
  posts complets, segons l'[ADR 0011](decisions/0011-news-blog-editorial-previews.md).
- `BUILD_TODAY` permet fixar la data editorial del build. Les proves i la CI la
  fixen per obtenir resultats deterministes; un build sense aquesta variable
  utilitza la data actual de Madrid.
- `dist/` és un artefacte generat i no una font de veritat. Producció no pot
  reutilitzar una sortida local existent: ha de desplegar un artefacte net creat
  per CI des del commit aprovat.

## Contracte D'Artefacte (T5.2)

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
   estructuralment i es revisen remotament al gate de llançament.
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
Madrid, i puja el paquet i el manifest com a artefacte del run (retenció de 30
dies). El job de build no accedeix a cap secret. El job `Deploy to production`
del mateix workflow, darrere de l'entorn GitHub `production` restringit a
`main`, descarrega aquest artefacte, en verifica manifest i digests, el
transfereix amb `mountain-release receive`, l'instal·la i l'activa, i executa
els smoke tests. El workflow `Rollback production` reverteix sense reconstruir.
Tots dos comparteixen el grup de concurrència `production-release` amb
`cancel-in-progress: false`. L'operació completa és a
[`docs/runbook.md`](runbook.md).

Límits coneguts del contracte (no bloquejants a la T5.2): l'arxiu es verifica
per llista de noms al build; el job de desplegament re-verifica el digest de
l'arxiu després de `receive` i el daemon re-verifica cada fitxer extret contra
el manifest. La reproductibilitat s'executa sobre dos builds calents del
mateix runner (el store de pnpm persisteix); els enllaços absoluts es validen
només estructuralment, amb qualsevol protocol, i es revisen remotament al gate
de llançament; i la cobertura d'enllaços és `href`, `src`, `srcset` i `url()`
de CSS, no atributs JS dinàmics.

## Servidor I Releases (T5.3)

Les eines de la T5.3 viuen a `tools/server/` i l'operació completa al
[`docs/runbook.md`](runbook.md). El diagrama Mermaid de la configuració del
servidor (identitats, Caddy, gate, daemon i layout) és a
[`docs/runbook.md`](runbook.md#arquitectura-del-servidor); s'actualitza amb
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

### Ordres de `mountain-release`

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
extraordinària amb aprovació explícita, i la resposta d'emergència del runbook
s'aplica quan no queda cap release elegible.

## Desplegament Continu (T5.4)

`tools/deploy/` orquestra el pas de l'artefacte de CI al VPS:

- `deploy.mjs` verifica manifest i digests, rebutja un commit que ja no és el
  HEAD de `main`, transfereix amb `receive`, instal·la, activa, executa smoke
  tests i, finalment, poda la finestra de releases perquè el disc no creixi amb
  cada desplegament. Una fallada després d'activar restaura el commit que era
  actiu, no un `rollback` genèric; una poda fallida només deixa un avís. La
  comprovació de HEAD es repeteix després d'activar.
- `rollback.mjs` és l'única via automatitzada per activar una release anterior
  elegible, sense reconstruir.
- L'entorn GitHub `production` (restringit a `main`) allotja els secrets de
  deploy. L'entorn `production-rollback` en té una còpia amb els mateixos
  noms i required reviewers permanents, perquè retirar el gate de deploy no
  desprotegeixi la reversió. El job de build no llegeix cap dels dos i no es
  comparteixen amb la futura infraestructura de previews.

L'operació, els noms de secrets i el procediment d'aprovació són a
[`docs/runbook.md`](runbook.md).

## Tall I Operació (T5.5)

El procediment (Caddy de producció **abans** del DNS, Hostinger, smoke de
l'apex, HSTS i observació) és al [`docs/runbook.md`](runbook.md).
`verify-site.mjs --expect-indexable` comprova el contracte de l'apex;
`--expect-hsts` exigeix `max-age=31536000` sense `includeSubDomains`.
Les redireccions de llegat i de rutes sense prefix d'idioma es comproven
sempre, també als smoke tests de desplegament i reversió. Un host nou ha de
tenir el fragment de Caddy instal·lat abans d'executar-los.

L'inventari previ al tall és a
[`docs/phase-5-t55-dns-inventory.md`](phase-5-t55-dns-inventory.md). La
checklist d'evidència és a
[`docs/validation/phase-5-t55-launch-gate.md`](validation/phase-5-t55-launch-gate.md).
Cap canvi DNS, de Caddy o dels entorns GitHub no s'executa sense la persona
mantenidora.

## Previews De Pull Request (T6.3)

La frontera de previews viu en dues meitats que mai comparteixen confiança,
dins del límit de l'[ADR 0009](decisions/0009-pr-previews-same-domain-and-own-branches.md)
(origen sota `*.preview.mountainrunners.cat`, publicació només a branques
pròpies, cap segon domini ni servei extern) i de la decisió T6.2
([`docs/phase-6-t62-decisions.md`](phase-6-t62-decisions.md)): cap credencial
DNS, certificats individuals HTTP-01, un procés Caddy amb blocs separats.

### Noms del flux de previews

Cada programa executable té una carpeta pròpia. Els mòduls compartits queden
a `tools/server/preview/`:

```text
tools/server/preview/
├── config.mjs                 # Directoris i origen de cada PR
├── authorization-proof.mjs    # Contracte de signatures compartit
├── commands/mountain-preview/
│   ├── cli.mjs                # Comanda SSH/CLI
│   ├── site-request.mjs       # Peticions al procés de previews
│   ├── capacity.mjs           # Límit de previews simultànies
│   ├── inventory.mjs          # Inventari de PR publicades
│   ├── prune.mjs              # Neteja de versions inactives
│   └── retire.mjs             # Retirada d'una PR
└── processes/
    ├── mountain-preview-site/
    │   ├── main.mjs           # Procés persistent, engegat per systemd
    │   ├── caddy.mjs          # Canvis a la configuració de Caddy
    │   └── caddy-fragment.mjs # Plantilla dels subdominis de PR
    └── preview-authorization/
        └── main.mjs           # Procés fill breu que escriu l'autorització
```

### Ordres de `mountain-preview`

El nom de cada ordre descriu el seu efecte. Les de consulta són pures: no
creen directoris, no prenen el bloqueig de capacitat i no esborren res.

| Ordre                                | Consulta o escriptura | Efecte                                                 |
| ------------------------------------ | --------------------- | ------------------------------------------------------ |
| `inventory`                          | Consulta              | Llista els orígens per reconciliar; `[]` si no n'hi ha |
| `list <n>` / `health <n>`            | Consulta              | Registre i salut del namespace; no el creen            |
| `receive/install/authorize/activate` | Escriptura            | Publicació al namespace assignat                       |
| `retire <n>` / `prune <n>`           | Escriptura            | Retirada i poda per PR                                 |
| `cleanup-retired`                    | Escriptura            | Elimina directoris de retirades interrompudes          |
| `site-enable/site-disable <n>`       | Escriptura            | Activa o retira un origen a Caddy                      |
| `site-reconcile`                     | Escriptura            | Elimina blocs Caddy sense `current` i reinicia Caddy   |

| Nom                                     | Què és                                                                                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview-deploy`                        | Usuari restringit del VPS compartit per totes les previews. Escriu als seus directoris, sense accés a les releases de producció ni a la configuració de Caddy.                                                               |
| `mountain-preview` / `preview-ssh-gate` | El mateix programa invocat amb dos noms: comanda per operar previews i comanda forçada quan s'hi accedeix per SSH. Valida cada petició.                                                                                      |
| `mountain-preview-site`                 | Procés local del VPS, engegat per `systemd` com a `root`. Rep peticions de `mountain-preview` per un socket Unix (canal local entre processos), verifica les signatures d'autorització i aplica els canvis permesos a Caddy. |
| `preview-authorization`                 | Procés fill temporal engegat per `mountain-preview-site` després de verificar la signatura. Escriu l'autorització com a `preview-deploy`.                                                                                    |
| `pr-<n>`                                | Directori de dades d'una PR, també anomenat _namespace_, amb les seves versions i el registre d'autoritzacions. No és un usuari ni un aïllament del sistema operatiu.                                                        |
| _Release_                               | Versió de la web instal·lada al directori d'una PR; només una és activa en cada moment.                                                                                                                                      |
| SHA del commit                          | Identificador del commit vigent de la PR. La petició de publicació es vincula a aquest commit, no a tots els futurs canvis de la PR.                                                                                         |
| _Workflow_ / _job_                      | Automatització de GitHub Actions / una de les seves etapes, com `authorize`, `build` o `publish`.                                                                                                                            |

Una **comanda forçada** és una regla de la clau SSH. Encara que el client demani
`mountain-preview receive 130 ...`, el servidor executa sempre
`preview-ssh-gate`, no la petició directament. Aquest programa llegeix la
petició original, comprova que sigui una operació admesa i tria el directori de
la PR indicada. Rebutja ordres arbitràries i no obre cap terminal. La regla
limita què es pot demanar per SSH, però **no lliga la clau a una sola PR**.

### Un sol workflow, disparat sota demanda

Res no es construeix ni es publica perquè s'obri o s'actualitzi una PR. El
workflow `Preview` (`.github/workflows/preview.yml`) s'activa només amb un
**comentari a la PR amb el text exacte `/preview`** d'una persona
col·laboradora (verificada via API), o amb un `workflow_dispatch` amb el número
de PR. El job `authorize` vincula la petició al commit que encapçala la PR,
identificat pel seu SHA. L'entorn GitHub `previews` separa els secrets
`PREVIEW_*` dels de producció, però no exigeix revisors abans d'executar-se.
Qualsevol col·laboradora pot demanar una preview d'una PR del repositori
principal; el sistema rebutja forks, PR tancades i commits que hagin canviat
abans de publicar. El flux té tres jobs amb fronteres explícites:

1. **`authorize`** (codi de confiança des de la branca per defecte):
   `tools/preview/resolve-publish.mjs` comprova el comentari i l'autor,
   resol el número de PR i el head SHA vigent i rebutja aviat una PR tancada
   o un fork. Un comentari qualsevol produeix un run verd que no fa res.
2. **`build`** (no fiable): `tools/preview/build-artifact.mjs` compila la web
   amb l'origen exacte de la preview
   (`https://pr-<n>.preview.mountainrunners.cat`, derivat i validat a partir
   del número de PR) i registra un manifest que vincula commit (el head SHA
   del checkout, llegit amb `git rev-parse HEAD` i no de `GITHUB_SHA`, que en
   un `issue_comment` apunta a la branca per defecte i no es pot sobreescriure),
   número de PR, origen, `BUILD_TODAY`, workflow i fitxers amb mida i
   SHA-256; fa checkout del head SHA, executa `pnpm validate` complet i puja
   l'artefacte intermedi (`mountain-runners-preview`, retenció de 7 dies).
   El job no rep cap secret, no usa cap cache compartida amb jobs de
   confiança i no té cap permís d'escriptura.
3. **`publish`** (de confiança, `needs: [authorize, build]`): descarrega
   l'artefacte del mateix run, valida manifest, mida, nombre de fitxers,
   digests i paths amb els mateixos validadors de producció, comprova la
   coherència manifest↔PR (commit, origen, número), transfereix amb
   `receive`, instal·la, revalida que la PR continua oberta i al mateix head
   SHA i que continua vigent l'autorització (col·laboradora per a `/preview` o
   permís d'escriptura per a `workflow_dispatch`) immediatament abans d'activar;
   signa l'autorització amb `PREVIEW_AUTH_PRIVATE_KEY` (absent del build) i
   l'envia per l'entrada estàndard al procés `mountain-preview-site`, que
   verifica la signatura amb la clau pública del VPS abans de registrar
   l'autorització. Després demana el bloc Caddy, torna a comprovar la PR i
   l'autorització abans d'activar, comprova TLS, capçaleres i salut, i neteja les
   releases anteriors. Mai no fa checkout ni executa codi de la PR.

Quan el smoke de la preview passa, `publish` torna a validar l'estat, el SHA i
l'autorització de la PR. Amb el permís `pull-requests: write`, exclusiu d'aquest
job, crea o actualitza un únic comentari propi amb l'URL i el SHA activats. Cerca
el marcador fix només als comentaris de `github-actions[bot]`; mai no modifica
comentaris d'altres persones. Si l'activació o el smoke fallen, no comenta res.
Un error en escriure el comentari fa fallar el job, però no desfà una preview que
ja està activa: cal comprovar-ne l'estat abans de reexecutar-lo.

### Frontera del servidor

- Les releases de cada PR es guarden a
  `/var/lib/mountain-runners-previews/namespaces/pr-<n>/`. La comanda SSH
  forçada les escriu com a `preview-deploy` i selecciona el directori segons el
  número de PR. El mateix usuari pot operar als directoris de diverses PR,
  inclosa la retirada d'una preview; els directoris per PR no són una barrera
  de permisos entre previews. Qui tingui la clau SSH pot demanar `retire` o
  `site-disable` per a qualsevol PR; registrar una autorització nova exigeix la
  signatura del publicador. Producció (`/var/lib/mountain-runners`), Caddy,
  claus TLS i estat ACME no són modificables per aquesta identitat. Un ACL
  POSIX anomenat denega a `preview-deploy` la lectura i el recorregut de
  `/var/lib/mountain-runners`
  sense canviar el mode `0755` que necessiten Caddy i `mountain-deploy`. No
  s'ha donat accés al socket del procés de releases de producció. El procés
  `mountain-preview-site` rep pel seu socket peticions per registrar
  autoritzacions signades i activar, desactivar o sincronitzar orígens derivats
  de números de PR. No accepta directives Caddy arbitràries; la clau SSH
  per si sola no pot signar una autorització. Cap secret de
  previews es comparteix amb producció.
- El bootstrap instal·la la comanda a `preview/commands/mountain-preview/` i crea el symlink
  `release -> .`, que el resol contra les eines de release planes sense còpies
  duplicades. En un VPS ja actiu, segueix el procediment preview-only del
  [runbook](runbook.md); no tornis a executar el bootstrap complet.
- La publicació és atòmica: l'install extrau en un directori nou i l'activació
  mou el symlink `current` del namespace de manera atòmica; un error conserva
  la versió anterior de la mateixa PR o no crea cap origen.

La T6.4 crea els orígens Caddy (blocs per PR, TLS individual, identificació
de no-producció, caché i política de capçaleres) i el cicle de vida complet;
la T6.5 va validar el sistema end-to-end al VPS.

## Agent Privat De Desenvolupament (T8.3)

La T8.3 implementa la base operativa de l'assistent privat de la fase 8:
Telegram, sessions i un entorn aïllat que porta una tasca petita fins a una PR.
**No s'ha desplegat ni activat** cap servei, bot, grup, compte ni credencial. La
instal·lació al VPS i l'activació del pilot requereixen aprovació explícita i es
fan per una PR i un procediment revisats.

Les eines viuen a `tools/server/agent/` i s'instal·len a
`/usr/local/lib/mountain-runners/agent/`. La unitat és
`tools/server/systemd/mountain-agent.service`. El nucli reutilitzable és
[`packages/telegram-pi-bridge`](../packages/telegram-pi-bridge/README.md), amb
llicència MIT i sense dependències npm. El servei el consumeix per l'API pública;
GitHub, Docker i la política del projecte no formen part del paquet.
El [mapa de mòduls i el recorregut
d'una petició](../tools/server/agent/README.md) expliquen quina peça fa cada pas.

### Components i frontera

| Component           | Accés                                                                        | Límit                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Pont de Telegram    | Token del bot, grup configurat, cua duradora i traça privada                 | No entrega cap credencial a Pi, a l'entorn aïllat ni a les proves                                       |
| Pi i model          | Credencial del proveïdor i sessions per tema                                 | Confiança de projecte denegada: no carrega extensions, hooks ni `settings` del repositori               |
| Entorn aïllat       | Worktree de la feina                                                         | Sense xarxa, sense credencials, sistema de fitxers de només lectura, sense socket de Docker             |
| Component de GitHub | Compte `rboixaderg`: `push` de la branca i obertura o reutilització de la PR | Sense merge, auto-merge, push a `main`, canvis de protecció ni desplegament; el merge demanat és a T8.4 |

El pont és l'únic procés amb el token de Telegram i el de GitHub. Arrenca Pi amb
una llista blanca d'entorn: `PATH`, `HOME`, el perfil de l'agent, la configuració
de l'entorn aïllat i només les variables del proveïdor que declara
`MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES`. Els tokens de Telegram i GitHub
no arriben mai al procés de Pi. Aquesta política viu a
`tools/server/agent/runtime/pi-adapter.mjs`; el client RPC del paquet només rep
les opcions i l'entorn explícits. Per defecte, el paquet no habilita eines ni
càrrega automàtica d'extensions. L'adaptador selecciona l'extensió aïllada
instal·lada i proporciona el callback de neteja dels contenidors de Podman.

Pi no exposa la `bash` del host. El model només pot executar ordres amb
`sandbox_bash`, una extensió del perfil de confiança que aplica el mateix
constructor d'arguments que el component de confiança: contenidor no
privilegiat, `--network=none`, `--read-only`, `--cap-drop=ALL`,
`--security-opt=no-new-privileges`, límits de CPU, memòria i processos i
l'UID/GID no root del propietari del worktree. Només munta el worktree a `/work`,
en mode de només lectura per a consultes. No exposa eines natives de fitxers del
host. El pont i Pi executen Podman local sense root, amb `--remote=false`
i `--userns=keep-id`. No pertanyen al grup Docker ni reben cap socket de
contenidors del host. La unitat també fa inaccessibles els sockets habituals
de Docker i Podman amb root.

Podman usa `cgroupfs` i la unitat delega el seu cgroup amb `Delegate=yes`.
`RuntimeDirectory` crea `/run/mountain-runners-agent` amb mode `0700`;
`XDG_RUNTIME_DIR` arriba a Pi i al runtime, però no al contenidor com a variable
d'entorn del host. El runtime només rep `PATH`, `HOME` i `XDG_RUNTIME_DIR`.
Els helpers de sistema `newuidmap` i `newgidmap` necessiten els permisos
restringits per mapar els rangs subordinats de l'usuari. Per això la unitat del
pont no fixa `NoNewPrivileges=true`; el contenidor sí que conserva
`--security-opt=no-new-privileges` i `--cap-drop=ALL`. Aquesta excepció no dona
accés a un dimoni privilegiat. Cal provar aquesta configuració a Linux abans
d'activar-la; les proves Docker anteriors no validen Podman.

El perfil de cada instrucció es reconstrueix a l'estat del servei amb només
recursos de confiança instal·lats. Pi no carrega automàticament context ni
skills del repositori al host: el model ha de llegir `AGENTS.md`, les skills
aplicables i la documentació amb `sandbox_bash`. Això evita seguir symlinks del
repositori cap a fitxers del host. No es mantenen còpies de les convencions.

Les metadades Git no es munten al contenidor. El component de confiança
selecciona el directori Git del registre del clon, comprova el fitxer indicador
`.git` i rebutja qualsevol alteració abans d'executar Git. Les ordres del host
desactiven hooks i fsmonitor, ignoren la configuració global i reben un entorn
restringit, sense els tokens del pont. Només el push rep l'autenticació de GitHub.
Abans d'aquest push, el servei inspecciona tots els objectes nous del rang
`origin/main..HEAD`, inclosos fitxers de commits anteriors, missatges de commit
i noms dins dels arbres Git. Compara els bytes amb els tokens de Telegram,
GitHub i els valors declarats a `MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES`.
Un objecte il·legible, un objecte de més de 2 MiB o un total superior a 32 MiB
refusa la publicació; no se salta cap fitxer per continuar. No segueix symlinks
del worktree per llegir el contingut.

Qualsevol commit del rang que afegeixi, modifiqui, mogui o esborri `.github/**`
o un fitxer `CODEOWNERS` refusa la publicació, encara que un commit posterior
reverteixi el canvi. El push publica exactament el SHA inspeccionat, sense
forçar-lo. La credencial de GitHub ha de ser un token acotat al repositori amb
`Contents: write` i `Pull requests: write`, sense `Workflows: write` ni permisos
d'administració. El rol administrador del compte no prova els permisos del
token. Abans del pilot cal verificar els permisos reals i les regles de branca
dels entorns `previews` i `production`; aquestes proves locals no ho demostren.

Un timeout o una cancel·lació de Pi també espera l'aturada dels contenidors de
la sessió; si no es pot confirmar, l'execució queda fallida o incerta.

### Sessions, admissió i recuperació

- El tema del fòrum (`chat_id` + `message_thread_id`) és la sessió. El
  identificador de sessió de Pi deriva del tema; dos temes no comparteixen
  historial.
- Només s'accepta un missatge d'una persona del grup configurat, dins d'un tema,
  que menciona el bot o respon a un missatge seu; els reenviaments, els àmbits
  anònims, els altres grups i els missatges privats s'ignoren. La pertinença es
  consulta a Telegram per a cada instrucció, sense memòria cau. Una fallada
  de la consulta denega la instrucció i informa l'autor perquè ho torni a provar.
- L'admissió és duradora abans d'avançar l'offset de Telegram. Els updates es
  dedupliquen, la cua admet deu instruccions pendents i només hi ha una
  execució global. Una cua plena es registra i es comunica al tema.
- Un reinici marca com a incert qualsevol treball en curs i refusa l'arrencada.
  El servei continua refusant totes les arrencades mentre hi hagi una instrucció
  incerta. Mentre el procés encara funciona amb la cua bloquejada, les peticions
  noves es registren com a refusades i reben un avís; no s'acumulen com a pendents. Cal revisar l'estat real; no es repeteix cap acció
  externa automàticament. La reconciliació completa és a T8.4/T8.5.
- Una primera crida efímera al model classifica només la petició verificada,
  sense eines, historial ni context del repositori. Distingeix consulta, feina
  nova i continuació explícita de la feina pendent. Una resposta invàlida demana
  aclariment, no habilita escriptures. Una petició de continuació sense feina
  pendent també demana aclariment.
- Una consulta munta el worktree en mode de només lectura, sense crear cap
  branca ni publicar feina anterior pendent. Una feina nova preserva el worktree
  anterior, inclosos els fitxers ignorats, a `<tema>-before-<update>` i comença des de `origin/main` en
  una branca pròpia. Una continuació explícita reutilitza només la feina
  pendent actual; no incorpora automàticament altres treballs arxivats. Les
  operacions executen `pnpm check` al contenidor abans de commit, push i PR.
- Un error local, un timeout o una cancel·lació confirmada no bloquegen la cua.
  Un error després d'iniciar la publicació queda incert, excepte un refús local
  identificat pel publicador. Una aturada de contenidors no confirmada també
  bloqueja, perquè encara podria executar-se codi no fiable.
- La sortida conjunta de stdout i stderr té un límit d'1 MiB per ordre del
  sandbox i per torn RPC de Pi. Superar-lo atura el procés i espera la neteja
  dels contenidors. Si afecta el torn RPC o les comprovacions, la instrucció
  falla abans de publicar. El timeout es manté independent. L'adaptador també
  verifica la neteja després de cada torn completat de Pi, abans de comprovar
  o publicar, encara que el model hagi tractat un error d'eina.
- Un worktree net no implica que s'hagi publicat. El servei conserva la branca
  amb commits pendents fins que push i PR estiguin confirmats; només llavors
  registra el commit publicat fora del muntatge i pot tornar a `origin/main`.

### Configuració

Les variables es documenten, sense valors, a `.env.example`. El fitxer real viu
fora del repositori a `/etc/mountain-runners-agent/agent.env`, amb mode `0600` i
propietat de la identitat del servei. La instal·lació prevista és:

```text
/var/lib/mountain-runners-agent/           0700  mountain-agent:mountain-agent
├── repository/                            clon amb origin i main
├── worktrees/                             worktree actual per tema i feina preservada
├── sessions/                              historial de Pi per tema
└── state/                                 admission.sqlite, perfils i traça
/etc/mountain-runners-agent/agent.env      0600  credencials del servei
/usr/local/lib/mountain-runners/agent/     aplicació instal·lada
/usr/local/lib/mountain-runners/node_modules/
└── telegram-pi-bridge/                    paquet autònom, sense node_modules propi
```

`MOUNTAIN_AGENT_BASE_BRANCH`, si s'informa, ha de ser `main`. La imatge de
l'entorn aïllat ha d'estar fixada i no pot usar l'etiqueta `latest`. Els límits
numèrics (CPU, memòria, processos, temps d'execució i cua) tenen valors inicials
al codi, però **no estan verificats al VPS** de 2 vCPU, 4 GB i 40 GB, que
comparteix amb la resta de serveis.

### Instal·lació prevista

El procediment següent és la preparació prevista; **no s'ha executat** i cap ordre
no es pot llançar sense aprovació explícita. Crea una identitat, un clon i una
unitat separats de producció i de previews.

```sh
# No executat. Requereix aprovació explícita abans de cada pas.
useradd --system --home /var/lib/mountain-runners-agent \
  --shell /usr/sbin/nologin mountain-agent
install -d -m 0700 -o mountain-agent -g mountain-agent \
  /var/lib/mountain-runners-agent/{repository,worktrees,sessions,state}
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

Abans d'arrencar, cal Linux amb cgroup v2, Podman local sense root, un runtime
OCI compatible i els helpers `newuidmap` i `newgidmap`. Una persona
administradora ha d'assignar rangs no solapats a `mountain-agent` a `/etc/subuid`
i `/etc/subgid`, sense incloure UID/GID de comptes reals del VPS, i preparar
l'emmagatzematge i la imatge de Podman amb aquest
usuari. No s'usa `podman.socket`, ni `sudo podman`, ni el magatzem d'imatges de
root. Si s'havia seguit una versió anterior del procediment, cal retirar la
pertinença al grup Docker abans d'activar el servei. La instal·lació ha de
comprovar que `podman --remote=false info --format '{{.Host.Security.Rootless}}'`
retorna `true` com a `mountain-agent`, i demostrar els límits dins del cgroup
delegat de la unitat. No s'han fet aquestes operacions al VPS.

La imatge aïllada ha d'incloure Node 24.11.0, pnpm, git i les dependències que
necessita `pnpm check`, perquè el contenidor no té xarxa. El paquet no requereix instal·lar dependències ni compilar-lo al servidor.
La disposició instal·lada del servei i del paquet es comprova amb una prova
local sense symlinks al workspace; no equival a haver-lo desplegat.
El clon del servei no comparteix el worktree principal de la persona mantenidora ni el de cap altra
feina local.

### Verificació

```sh
pnpm --filter telegram-pi-bridge test
pnpm test:server
# Opcional: Linux amb Podman sense root i imatge local ja disponible:
MR_ISOLATION_TEST_IMAGE=<imatge-local> node --test tools/server/agent/sandbox/commands.test.mjs
# Càrrega del perfil real a Pi, sense credencials ni petició al model:
MR_AGENT_PI_COMMAND=<executable-pi> node --test tools/server/agent/runtime/profile-smoke.test.mjs
```

Les proves cobreixen autorització, deduplicació, ordre, cua plena, reinici amb
resultat desconegut, branques i `main`, secrets a tot l'historial publicable,
rutes protegides, límits d'inspecció i objectes il·legibles, reutilització de
PR, consulta sense branca i el recorregut sintètic fins a PR amb Git i GitHub
simulats. El gate també executa la suite del paquet en una còpia independent,
crea un tarball local i el consumeix sense GitHub ni Docker, i verifica la
resolució d'imports de la disposició instal·lada. No publica el paquet ni crea
cap repositori remot. Una prova simulada no demostra els permisos reals de GitHub ni
l'aïllament al VPS.

### Pendents abans d'activar el pilot

1. Crear el bot, el supergrup privat amb temes i la credencial de GitHub sense
   `Workflows: write` ni administració, amb aprovació explícita i fora del
   repositori. Verificar també les restriccions dels entorns de GitHub.
2. Instal·lar la unitat, la identitat `mountain-agent`, el clon i les eines; no
   reutilitzar identitats, directoris ni secrets de producció o previews.
3. Demostrar l'aïllament al VPS (xarxa, credencials, filesystem, socket) i
   verificar els límits de recursos reals.
4. Proporcionar dependències offline a la imatge perquè `pnpm check` funcioni
   sense xarxa dins del contenidor.
5. Provar la pertinença, la revocació, dos autors i la represa entre temes
   (T8.4/T8.5) i documentar l'aturada, la rotació i la retenció (T8.5/T8.6).
6. Fer un smoke autoritzat d'una consulta i d'una tasca petita fins a PR. El
   primer merge real continua sent posterior, explícit i humà (T8.4).

Fins aleshores, el servei no s'activa i cap agent no desplega ni fusiona res.

## CI Implementada

GitHub Actions executa qualitat, E2E, Conventional Commits, detecció de secrets,
revisió de dependències, CodeQL, el contracte d'artefacte de la T5.2, el
desplegament continu i el rollback de la T5.4, el build no fiable i el
publicador de previews de la T6.3, i els tests de les eines del
servidor (`pnpm test:server`). `pnpm validate` no executa Lighthouse;
`pnpm lighthouse` és una auditoria manual separada.

## No Implementat

La fase 5 està tancada; HSTS, entorn `production-rollback` i retirada dels
required reviewers de `production` estan registrats a la
[checklist de la T5.5](validation/phase-5-t55-launch-gate.md). La fase 6 també
està tancada: les previews de PR són operatives i validades al VPS. La fase 7
continua planificada i sense implementació. La fase 8 té la base T8.3
implementada al repositori, però el servei no s'ha desplegat ni activat i la
resta de la fase continua pendent. Només cal un ADR nou quan la implementació
introdueixi o canviï una decisió arquitectònica; els detalls que apliquen la
direcció acceptada continuen requerint una pull request revisada.
