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
La implementació està fusionada i instal·lada al VPS, i el pilot s'ha executat
supervisat: una consulta que no crea branca i una tasca petita que arriba a PR,
sense merge ni preview. El servei roman **aturat** per defecte i cada activació
requereix aprovació explícita. Les capacitats de T8.4 (avís i reparació de CI,
preview i merge demanats al tema, continuació entre temes, avís de solapaments i
adjunts) estan implementades (vegeu més avall), però inactives.

Les eines viuen a `tools/server/agent/` i s'instal·len a
`/usr/local/lib/mountain-runners/agent/`. La unitat és
`tools/server/systemd/mountain-agent.service`. El nucli reutilitzable és
[`packages/telegram-pi-bridge`](../packages/telegram-pi-bridge/README.md), amb
llicència MIT i sense dependències npm. El servei el consumeix per l'API pública;
GitHub, Docker i la política del projecte no formen part del paquet.
El [mapa de mòduls i el recorregut
d'una petició](../tools/server/agent/README.md) expliquen quina peça fa cada pas.

### Components i frontera

| Component           | Accés                                                                                                                                | Límit                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Pont de Telegram    | Token del bot, grup configurat, cua duradora i traça privada                                                                         | No entrega cap credencial a Pi, a l'entorn aïllat ni a les proves                                                                      |
| Pi i model          | Credencial del proveïdor i sessions per tema                                                                                         | Confiança de projecte denegada: no carrega extensions, hooks ni `settings` del repositori                                              |
| Entorn aïllat       | Worktree de la feina                                                                                                                 | Sense xarxa, sense credencials, sistema de fitxers de només lectura, sense socket de Docker                                            |
| Component de GitHub | Compte `rboixaderg`: `push` de la branca, obertura o reutilització de la PR, lectura de la CI del commit publicat i el merge demanat | Sense auto-merge, push a `main`, canvis de protecció ni desplegament; l'únic merge és el squash demanat amb `/merge` (vegeu més avall) |

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
`sandbox_bash` i tornar a mirar un adjunt amb `view_attachment`, una extensió del
perfil de confiança que aplica el mateix
constructor d'arguments que el component de confiança: contenidor no
privilegiat, `--network=none`, `--read-only`, `--cap-drop=ALL`,
`--security-opt=no-new-privileges`, límits de CPU, memòria i processos i
l'UID/GID no root del propietari del worktree. Només munta el worktree a `/work`,
en mode de només lectura per a consultes. `view_attachment` llegeix el fitxer
dins del worktree amb `O_NOFOLLOW`, comprova que és un fitxer regular dins la
mida i en revalida la capçalera; no accepta cap camí lliure. No exposa eines
natives de fitxers del host. El pont i Pi executen Podman local sense root, amb `--remote=false`
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
La unitat arrenca amb `UMask=0077` perquè l'estat privat quedi privat, així que
les ordres Git de confiança executen amb `umask 022`: si no, els fitxers que
genera el checkout perden els bits d'execució que consten a l'índex i les
comprovacions del projecte fallen dins dels worktrees de l'agent.
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
`Contents: write`, `Pull requests: write` i `Actions: write`, sense
`Workflows: write` ni permisos d'administració. `Actions: write` permet llegir el
resultat de la preview i reexecutar una sola vegada els jobs fallits d'una
execució cancel·lada, esgotada o fallida en la preparació. Aquest permís també
permet altres accions sobre execucions de workflows i augmenta el risc d'abús i
de consum de recursos si es compromet el servei o el token. La credencial
continua fora del sandbox; el servei limita i registra les reexecucions. El rol
administrador del compte no prova els permisos del token. Abans d'activar la
capacitat cal aprovar l'esmena de l'ADR 0013 i verificar els controls; aquest
document no concedeix cap permís.
Abans del pilot cal verificar els permisos reals i les regles de branca
dels entorns `previews` i `production`; aquestes proves locals no ho demostren.

Tota ordre Git de confiança té termini i aturada: 120 s per a una operació local
i 300 s per a un `fetch` o un `push`. En esgotar-se el termini, o quan s'atura el
servei, `execFile` mata el procés amb `SIGKILL` i l'ordre falla; una ordre morta
no compta com un refús innocent. El senyal de la instrucció arriba a totes les
ordres Git i a totes les crides a l'API de GitHub que fa la instrucció, i una
crida a l'API sense senyal del cridant agafa el termini de petició de 30 s. Un
timeout o una aturada abans de la primera escriptura remota és una fallada
local. Si arriba després del push o de la petició de PR, la instrucció queda
incerta i no es repeteix. La lectura de la PR que el publicador fa abans del
push d'una reparació o d'una continuació és dins de la primera part: un termini
esgotat allà es comunica com a refús local amb el seu avís, i una aturada no es
converteix en incertesa.

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
  La consulta té un termini de 30 s i respecta l'aturada del servei. Un termini
  esgotat denega la instrucció pel camí `membership_check_failed`; una aturada
  no avança l'offset de Telegram, així que l'update es torna a llegir a la
  propera arrencada.
- L'admissió és duradora abans d'avançar l'offset de Telegram. Els updates es
  dedupliquen, la cua admet deu instruccions pendents i només hi ha una
  execució global. Una cua plena es registra i es comunica al tema.
- Quan una instrucció s'admet, el tema rep de seguida un avís de recepció amb un
  retall d'una línia de la petició. S'envia després de desar-la i abans
  d'executar-la, i no inclou cap credencial. Si Telegram no accepta l'avís, la
  feina continua i només es registra `reply_failed`; la resposta final arriba
  igualment en aquell tema.
- Tota petició del client de Telegram té un termini propi, combinat amb el
  senyal d'aturada del servei: 30 s per defecte i, al long polling, els 25 s
  demanats al servidor més 15 s de marge. Un termini esgotat és un error del
  client que no conté cap URL ni el token; una aturada continua sent una
  aturada. Un enviament que s'esgota és un lliurament desconegut: l'avís de
  recepció només deixa `reply_failed` i la feina continua, i l'avís de CI deixa
  el seguiment incert i avorta la reserva de reparació.
- La revocació talla només el que encara no s'ha admès. Una persona que deixa
  el grup o és expulsada no pot donar instruccions noves, però la feina
  ordinària ja acceptada (implementacions, continuacions, consultes i
  reparacions) continua i no torna a comprovar la pertinença. Les dues accions
  que exposen o fusionen una PR, la preview i el merge, la tornen a comprovar en
  executar-se.
- Un error local es registra amb el nom i el missatge de l'excepció perquè es
  pugui diagnosticar al journal. El tema només rep l'avís genèric: ni rutes, ni
  noms d'eines ni cap detall intern.
- Un reinici marca com a incert qualsevol treball en curs i refusa l'arrencada.
  El servei continua refusant totes les arrencades mentre hi hagi una instrucció
  incerta. Mentre el procés encara funciona amb la cua bloquejada, les peticions
  noves es registren com a refusades i reben un avís; no s'acumulen com a pendents. Cal revisar l'estat real; no es repeteix cap acció
  externa automàticament. La reconciliació d'aquests casos es fa amb l'ordre
  d'operador de [Reconciliació de resultats desconeguts (T8.5)](#reconciliació-de-resultats-desconeguts-t85).
- Una primera crida efímera al model classifica només la petició verificada,
  sense eines, historial ni context del repositori. Distingeix consulta, feina
  nova i continuació de la feina pendent, i rep només el context acotat del tema
  descrit a [Continuïtat de la conversa d'un tema (T8.7)](#continuïtat-de-la-conversa-dun-tema-t87).
  Una resposta invàlida no habilita escriptures: el torn és una consulta i el
  text fix d'aclariment només respon si el model no diu res. Una petició de
  continuació sense feina pendent ni PR del tema també és una consulta.
- Una consulta munta el worktree en mode de només lectura, sense crear cap
  branca ni publicar feina anterior pendent. Una feina nova preserva el worktree
  anterior, inclosos els fitxers ignorats, a `topic-<16hex>-before-<8hex>` i
  comença des de `origin/main` en una branca pròpia. Una continuació explícita reutilitza només la feina
  pendent actual o, si nomena una sola PR que el servei va publicar, la reprèn
  (vegeu «Continuació d'una PR des d'un altre tema»); no incorpora
  automàticament altres treballs arxivats. Les operacions executen `pnpm check`
  al contenidor abans de commit, push i PR; si tots els camins que la publicació
  contindria són dins de `apps/web/src/content` o `apps/web/src/content-assets`,
  executen `pnpm check:local`, i qualsevol altre camí manté `pnpm check`
  (ADR 0012).
- Un error local, un timeout o una cancel·lació confirmada no bloquegen la cua.
  Un error després d'iniciar la publicació queda incert, excepte un refús local
  identificat pel publicador. Una aturada de contenidors no confirmada també
  bloqueja, perquè encara podria executar-se codi no fiable.
- La sortida conjunta de stdout i stderr té un límit d'1 MiB per ordre del
  sandbox i per torn RPC de Pi. Superar-lo atura el procés i espera la neteja
  dels contenidors. Si afecta el torn RPC o les comprovacions, la instrucció
  falla abans de publicar. El timeout es manté independent. L'adaptador també
  verifica la neteja després de cada ordre del sandbox i de cada torn completat
  de Pi, abans de comprovar o publicar. Atura els contenidors actius de la sessió, elimina els seus
  registres aturats i comprova que no en quedi cap. Si Podman no pot completar
  la neteja, el resultat és incert; els worktrees i sessions es conserven.
- Un worktree net no implica que s'hagi publicat. El servei conserva la branca
  amb commits pendents fins que push i PR estiguin confirmats; només llavors
  registra el commit publicat fora del muntatge i pot tornar a `origin/main`.
- Cada worktree arxivat conserva la seva còpia de dependències, així que el
  volum acotat s'omple amb les iteracions. A l'arrencada el servei elimina només
  els worktrees arxivats sense commits per davant d'`origin/main` i sense canvis
  pendents, i sempre conserva l'arxiu més recent de cada tema. Com que el sufix
  de l'arxiu és opac, l'antiguitat surt de la data de naixement del directori,
  que el reanomenament conserva i una escriptura a dins no canvia. La comanda
  `node storage/prune-worktrees.mjs --dry-run`, executada com la identitat del
  servei, mostra la mateixa decisió sense esborrar res; sense `--dry-run`
  l'aplica. Un worktree amb treball no publicat o sense cometre no s'esborra
  mai, i el worktree actiu del tema tampoc.

### Noms opacs i migració

Els identificadors de Telegram no arriben a cap nom públic ni a cap nom que el
sandbox pugui llegir.

- **Salt.** `state/identifier-salt` és un valor aleatori de 32 bytes amb mode
  `0600` que el servei crea una sola vegada a l'arrencada si no existeix. No
  viatja al repositori, a la traça, als logs ni a l'entorn de Pi. Una altra
  instal·lació produeix altres noms. Sense aquest fitxer no es poden
  reconstruir els noms dels worktrees existents: entra a la còpia de seguretat
  de `state/`.
- **Worktree.** El directori és `topic-<16hex>`, un HMAC-SHA256 del salt i de la
  clau de sessió (`<chat>:<tema>`). El fitxer `/work/.git`, l'etiqueta
  `mountain-agent.session` dels contenidors i `MR_AGENT_SESSION_IDENTIFIER`, que
  rep Pi, porten només aquest valor.
- **Arxiu.** Un arxiu és `topic-<16hex>-before-<8hex>`, amb el mateix HMAC sobre
  l'identificador d'actualització. No porta ni l'identificador ni cap ordre.
- **Branca i PR.** El sufix públic de la branca és aquest HMAC de vuit
  caràcters: `feat/agent-change-<8hex>` o `<tipus>/<slug>-<8hex>`. És estable
  per a la mateixa actualització i canvia amb el salt.
- **Sessió de Pi.** El fitxer de sessió conserva `topic_<chat>_<tema>` per no
  perdre l'historial, però no arriba mai al sandbox. El perfil de Pi es
  reconstrueix a `state/profiles/topic-<16hex>` a cada execució i arriba a Pi com
  a `PI_CODING_AGENT_DIR`; els perfils antics amb el nom privat no es fan
  servir.
- **Migració.** Canvia tres noms, perquè `git worktree move` només reanomena el
  directori muntat: el directori del worktree, el directori administratiu
  `.git/worktrees/<nom>` i el fitxer `.git` que el sandbox llegeix. Conserva la
  branca, l'índex, els canvis sense cometre i el marcador de publicació. És
  idempotent i reprensible: si s'interromp, la propera execució acaba el que
  falta. Un directori amb el nom antic que Git no registra no és un worktree: es
  registra com a `worktree_migration_unregistered` i es deixa igual. Si un
  reanomenament falla, per exemple perquè el nom opac ja existeix, el servei
  registra `worktree_migration_failed` i no arrenca: no es perd res i no queda
  mig volum amb un nom privat.
- **Marcador no fiable.** El fitxer `.git` del worktree es reescriu només amb la
  ruta del registre de confiança, en un temporal exclusiu dins del mateix
  directori i amb un `rename` atòmic. La migració no llegeix ni repara cap `.git`
  ni cap `gitdir` del registre que no sigui un fitxer regular amb un sol enllaç.
  Un enllaç físic tampoc no és de confiança: `git worktree move` reescriu els dos
  fitxers in situ i el destinatari de l'enllaç rebria l'escriptura. El temporal
  fix `.git.agent-marker-tmp` només s'esborra si és un fitxer regular amb un sol
  enllaç i el contingut exacte del marcador que es vol escriure; qualsevol altre
  fitxer es conserva i la migració es refusa. Quan refusa, registra
  `worktree_marker_untrusted` amb el nom opac, no toca res i el servei no
  arrenca. L'ordre d'operador fa el mateix i surt amb codi 1. Ho revisa una
  persona.
- **Ordre d'actualització.** Actualitza el codi, executa la migració com a pas
  d'operador, reconcilia els casos que bloquegen l'arrencada i arrenca el
  servei. La migració no necessita el servei en marxa:

  ```sh
  systemd-run --pipe --wait --uid=mountain-agent --gid=mountain-agent \
    -p EnvironmentFile=/etc/mountain-runners-agent/agent.env -p UMask=0077 \
    /usr/bin/node /usr/local/lib/mountain-runners/agent/commands/migrate-identifiers/cli.mjs
  ```

  Des del repositori, el mateix programa és
  `node tools/server/agent/commands/migrate-identifiers/cli.mjs`. La
  reconciliació no crea el salt ni migra res: si el salt no existeix o queda
  cap worktree amb un nom antic, `list` i `resolve` d'una instrucció fallen amb
  codi 1 i demanen executar la migració abans. Els casos de reparació, preview i
  avís no en depenen.

### Aturada i reinici

L'aturada del servei la fa la persona operadora amb `systemctl stop mountain-agent`.
El tema de Telegram no té cap comanda d'aturada: un membre que vulgui aturar la
feina ho demana a la persona mantenidora ([ADR 0014](decisions/0014-operator-stop-and-repeatable-telegram-notices.md)).
L'aturada conserva la feina, la branca i la PR.

El contenidor de cada ordre s'executa amb `--rm`: conmon l'elimina sol quan el
procés mor. Una aturada ordenada i una mort sobtada del pont deixen el mateix
resultat, cap contenidor ni cap registre residual. El contenidor viu dins del
cgroup de la unitat, de manera que `MemoryMax`, `CPUQuota` i `TasksMax` cobreixen
també la feina del model.

El procés `pause` de Podman sense root no respon a `SIGTERM`. Tota aturada amb
un contenidor obert arriba doncs al límit `TimeoutStopSec=30` i és systemd qui
l'ha de matar; amb el valor per defecte de 90 segons cada reinici s'endarreria
tant. El límit s'ha de mantenir per sobre del temps de neteja ordenada d'un torn
interromput.

`Restart=on-abnormal`, amb `StartLimitIntervalSec=5min` i `StartLimitBurst=3`,
evita dos bucles: una arrencada que refusa feina interrompuda amb resultat
desconegut queda fallida per a la persona operadora en lloc de reintentar-se, i
una seqüència de caigudes s'atura després de tres intents. Una caiguda o una
mort per falta de memòria sí que es reprèn.

Verificat al VPS l'11 de novembre de 2026 amb una unitat transitòria equivalent:
`SIGKILL` al pont amb una ordre llarga oberta dins del contenidor, contenidor
eliminat, cap procés ni registre residual i arrencada posterior neta. Els límits
llegits del cgroup van ser 2560 M de memòria, 150 % de CPU i 384 tasques. El
consum del procés `pause` es compta a la unitat, no al contenidor.

### Configuració

Les variables es documenten, sense valors, a `.env.example`. El fitxer real viu
fora del repositori a `/etc/mountain-runners-agent/agent.env`, amb mode `0600` i
propietat de la identitat del servei. La instal·lació prevista és:

```text
/var/lib/mountain-runners-agent/           0700  mountain-agent:mountain-agent
├── repository/                            clon amb origin i main
├── worktrees/                             worktree actual per tema i feina preservada
├── sessions/                              historial de Pi per tema
└── state/                                 identifier-salt, admission.sqlite, ci-watch.sqlite (avisos i reparacions), preview-request.sqlite (peticions de preview i URL confirmada), merge-request.sqlite (peticions de merge), session-notes.sqlite (efectes i última resposta de cada tema), attachments/ (imatges per tema, 7 dies), perfils i traça
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
en verd: la comprovació queda absent i l'avís acaba com a no confirmat. El
servei llegeix els check runs (`filter=latest`) i els estats de commit heretats
del SHA publicat, i envia un avís al mateix tema quan acaben les comprovacions
obligatòries. El seguiment es desa a
`state/ci-watch.sqlite`, no bloqueja la cua i no es repeteix automàticament: si
Telegram no confirma un enviament, la fila queda com a incerta i el servei ho
registra a l'arrencada, sense reintentar el missatge. Qualsevol avís incert del
tema compta com una publicació sense informe: el tema no pot resoldre cap
`/merge` ni cap `/preview` fins que una persona el tanqui amb `--kind notice`
(vegeu
[Reconciliació de resultats desconeguts (T8.5)](#reconciliació-de-resultats-desconeguts-t85)).
La comparació no depèn de l'ordre en què arriben els avisos: un avís incert
bloqueja encara que un altre avís del tema s'hagi lliurat després. Una
publicació confirmada el seguiment de la qual no es pot desar acaba com a
incerta: la publicació s'ha fet i no es repeteix, però cap avís durador la pot
autoritzar i cal reconciliar la instrucció amb la seva PR (`--pull-request`),
que restaura el seguiment. Un canvi del cap de la PR
o una PR tancada també es comuniquen i no confirmen cap estat del commit nou.
L'interval de consulta i el termini del seguiment tenen valors inicials al codi
(`MOUNTAIN_AGENT_CI_POLL_INTERVAL_MS`, `MOUNTAIN_AGENT_CI_WATCH_TIMEOUT_MS`).
Si canvia la protecció de `main`, actualitza la llista al mateix moment: el
servei no la pot contrastar i l'avís només confirma les comprovacions que hi
consten. El tema rep un avís planer sense noms de comprovació; el detall amb el
commit i els noms queda al registre privat `ci_notification_sent` i a la nota del
servei. Una fallada que arriba a una reparació automàtica desa a més la seva
evidència a `state/ci-watch.sqlite`.

Si una comprovació obligatòria es cancel·la, s'esgota o falla en la preparació
abans dels passos del projecte, el servei reserva a `state/ci-watch.sqlite` una
sola reexecució dels jobs fallits d'aquella execució de GitHub. Desa la reserva
abans de la crida i continua seguint el mateix commit. Després d'un reinici
consulta l'intent de GitHub; si el resultat no es pot confirmar, no torna a fer
la crida i avisa. Una fallada posterior al reintent també s'avisa sense reparar
ni tornar a executar. Els noms de passos reconeguts són a
`tools/server/agent/repository/ci-failure.mjs`.

Per a una fallada d'un pas de projecte reconegut amb un resum no buit de la
comprovació, el servei pot intentar reparar-la, amb un límit de dues reparacions
consecutives per conjunt de comprovacions fallides. Sense aquesta evidència,
avisa sense iniciar el model. La
identitat de la fallada és aquest conjunt de noms; el missatge de la comprovació
i el SHA són evidència i abast de l'intent, no identitat, perquè un SHA nou a
cada reparació faria impossible comptar res i un missatge variable reiniciaria el
pressupost sense límit. El servei només actua quan ja no queda cap comprovació
obligatòria en curs, i un intent declinat o cancel·lat també consumeix el
pressupost.
La reparació continua sent treball del servei: el model només proposa codi dins
del sandbox i el servei fixa el commit, comprova el cap del worktree, executa
`pnpm check` i publica pel mateix camí de sempre, sobre la mateixa branca i la
mateixa PR. Un commit de reparació reobre el seguiment del tema, de manera que
el tema continua rebent l'avís de la CI nova. La reparació només s'inicia quan
la cua d'instruccions és buida i no està bloquejada per un resultat incert, amb
els mateixos límits de temps i la mateixa execució única que una implementació.
Abans de tocar la branca torna a llegir la PR: si és tancada o el cap ja no és
el commit que va fallar, no repara res i ho comunica. Tampoc no repara un
worktree amb canvis sense publicar d'una instrucció posterior, perquè no es
publiquin com a reparació. Una reparació no crea mai una PR: just abans del push
torna a comprovar que la PR continuï oberta al mateix commit i, si no, no
publica res.

El prompt de reparació inclou el diff publicat, el resum del canvi, els noms de
les comprovacions fallides i la seva sortida pública, retallada, tractada com a
dada no fiable i sense les credencials conegudes. El model no rep cap operació
de GitHub. Decidir si la fallada és dins de l'abast és criteri seu; els controls
deterministes són el límit d'intents, la comprovació del cap de la PR i de
l'estat publicat, `pnpm check` i la revisió humana. El servei no converteix mai una fallada en èxit: si la reparació no
canvia res, si les comprovacions locals fallen o si la fallada és externa, tanca
l'intent i ho comunica amb el resultat real. Abans d'executar un intent torna a
llegir la PR i les comprovacions obligatòries: si la PR s'ha tancat o mogut, si
el commit ja és verd o si l'estat encara no és concloent, no publica res i ho
comunica. En arribar al límit informa
dels dos intents i espera una instrucció nova al tema. El nombre d'intents és
finit: cada conjunt de comprovacions fallides en té dos, i qualsevol conjunt nou
en té dos més, però cap conjunt no els pot renovar sol.

Els intents es desen a `state/ci-watch.sqlite` abans de qualsevol efecte, de
manera que sobreviuen a un reinici. Només compta l'intent que s'ha arribat a
agafar, i el mateix avís, commit i fallada només es reserva una vegada. Un
intent reservat només es pot executar després que l'avís «en curs» s'hagi
enviat al tema; si l'avís no s'envia, la reserva es tanca de seguida com a
`aborted` amb el resultat `announcement_failed` i l'intent no s'executa. Com que
la reserva ja s'havia pres, continua comptant per al límit i una fallada no es
pot reintentar sense fi. A l'arrencada, tota reserva que no va arribar a la cua
es tanca com a `aborted` amb el resultat `interrupted_before_queue` i no
s'executa mai. Una CI verda o una publicació humana nova també descarten les
reserves que mai no han corregut; conserven les reparacions en cua, en curs o
amb resultat desconegut. Si una fallada reutilitza un intent que ja ha acabat
(`aborted`, `done` o `uncertain`), el tema no rep cap avís de reparació en curs:
rep que no s'executarà cap reparació d'aquell intent i que cal una instrucció
nova, amb la traça `ci_repair_not_run`. Una reparació interrompuda pot haver fet
push i mai no es repeteix sola: el servei refusa arrencar fins que una persona
reconciliï l'estat real, igual que amb una instrucció interrompuda; el
procediment és a
[Reconciliació de resultats desconeguts (T8.5)](#reconciliació-de-resultats-desconeguts-t85). Amb el
servei en marxa, una reparació amb resultat desconegut atura les reparacions
automàtiques, també les que es reservarien per una fallada nova: el tema ho
informa en lloc d'anunciar un intent que no es farà. Les instruccions del tema
continuen. Ni una CI verda ni una
publicació nova esborren aquesta incertesa, i l'intent ja gastat no es
recupera. Un missatge
de resultat que no es pugui confirmar no es reenvia. Si el resultat d'un intent
no es pot desar, l'intent queda en curs i atura la cua de reparacions fins al
reinici, que el marca com a desconegut; el tema ho rep amb el resultat. Si el
termini del seguiment s'esgota amb comprovacions fallides però el conjunt no és
concloent, la nota del servei en dona els noms, el tema rep un avís planer i no
s'inicia cap reparació. La traça privada registra
`ci_repair_requested` (només quan l'intent ha arribat a la cua),
`ci_repair_not_announced`, `ci_repair_not_queued`, `ci_repair_not_run`,
`ci_repair_blocked`, `ci_repair_limit_reached`, `ci_repair_published`,
`ci_repair_not_published`, `ci_repair_aborted`, `ci_repair_uncertain` i
`ci_repair_close_failed` amb la PR i el commit, sense text de conversa ni
credencials. Una traça que no es pot escriure es registra al log i no perd
l'avís al tema.

### Preview demanada al tema (T8.4)

Una persona verificada demana la preview en llenguatge natural. El servei no
inicia el model: el classificador només etiqueta la petició i un tractament
determinista del servei fa la resta. La delegació segueix l'[ADR 0009](decisions/0009-pr-previews-same-domain-and-own-branches.md)
i l'[ADR 0013](decisions/0013-private-development-agent-boundary.md): no hi ha segona
confirmació, només es treballa amb branques del repositori principal i el
publicador de la fase 6 continua comprovant que l'autor del comentari és
col·laborador. La pertinença i l'atribució de la persona només viuen a la traça
privada.

- **PR i fixació.** El destí és la PR que el servei va informar en verd en
  aquell tema (la fila de `ci_watches` amb l'avís enviat com a èxit). Mai
  s'accepta un número de PR ni un SHA escrits per la persona. Sense aquesta fila,
  el servei refusa. Si el tema té una publicació més nova sense informe
  confirmat, tampoc no la demana: l'avís anterior ha quedat enrere.
- **Condicions, rellegides en directe.** PR oberta, repositori de la branca igual
  al principal i comprovacions obligatòries del cap actual de la PR totes en verd
  amb el mateix classificador que la CI. El cap pot ser més nou que el commit
  informat, perquè una persona pot haver actualitzat la PR fora de l'agent: la
  petició es fixa llavors al cap i queda lligada a aquest SHA exacte. Qualsevol
  resultat vermell, pendent, absent, ambigu o un error de lectura refusa la
  petició.
- **Pertinença.** Es torna a consultar a Telegram en el moment d'executar la
  petició, com al merge i després de resoldre el commit fixat: una preview
  publica la PR en un subdomini públic, així que no és feina ordinària de la
  cua. Un autor que ja no és membre rep el rebuig `membership_revoked`; una
  fallada de la consulta, el rebuig `membership_unavailable`, que demana
  tornar-ho a provar. La lectura queda dins del termini de petició del
  servei; si s'esgota, compta com una fallada i es respon demanant tornar-ho a
  provar. En tots dos casos no es desa cap fila ni es publica cap
  comentari. La comprovació superada queda a la traça
  (`preview_membership_verified`).
- **Comentari.** El servei publica exactament `/preview`. L'entorn aïllat i el
  model no tenen accés a l'API de GitHub.
- **Estats** (`state/preview-request.sqlite`): `commenting` (desat abans de
  publicar), `awaiting`, `confirmed`, `timed_out`, `failed` (no s'ha publicat
  res i no bloqueja el servei: GitHub ha rebutjat el comentari amb un 4xx
  definitiu que no és 408 ni 429, o l'execució de la preview ha acabat sense
  èxit) i `uncertain` (error de xarxa, temps esgotat, 408, 429, 5xx o resposta
  mal formada: bloqueja fins que una persona reconciliï). Una actualització
  de Telegram només es tramita una vegada. Es refusa una petició nova pel mateix
  PR i commit mentre n'hi hagi una en `commenting`, `awaiting` o `uncertain`; es
  permet quan l'anterior ha acabat com a `confirmed`, `failed` o `timed_out` (per exemple per tornar a publicar després de
  retirar la preview). Un commit verd nou sempre permet una petició nova.
- **Resultat de l'execució.** Mentre la petició espera, el bucle llegeix les
  execucions del flux `preview.yml` creades pel comentari a la PR
  (`Actions: read`). El flux s'executa per a cada comentari de cada PR, així que
  una execució només compta quan l'ha iniciada la identitat de GitHub del servei
  (`actor` o `triggering_actor`, llegida una vegada amb `GET /user`) i quan és
  dins de la finestra de la petició: creada després del comentari del servei i
  abans del comentari de la petició següent. Un `issue_comment` porta
  el commit de `main` a `head_sha`, així que ni el commit ni la PR es poden
  llegir de l'execució. L'execució s'identifica per l'autor i pel moment; el
  comentari del publicador és el que lliga l'URL al commit. La finestra d'una
  petició va del seu comentari al comentari de la petició següent, també quan
  aquella petició ja ha acabat, així que les finestres no es mouen ni deixen cap
  forat. Dins de la finestra només decideix la primera execució acabada: si no ha
  acabat bé, la petició acaba com a `failed` (traça `preview_failed_run`, amb
  l'execució) amb un avís planer, sense reparació ni reintent automàtics, i una
  execució posterior de la mateixa finestra no canvia res. Una execució correcta
  no confirma res per si sola, i una execució acabada sense conclusió calculada
  (`null`) tampoc no decideix: la petició continua esperant. El comentari del
  publicador es llegeix abans que les execucions, així que una confirmació
  existent sempre guanya. Dues peticions del mateix segon comparteixen la
  finestra, perquè GitHub només dona precisió de segon, i les seves execucions
  s'assignen per ordre: primer la de la petició amb l'identificador més baix. Una
  execució que no encaixa en cap finestra s'ignora, i un encert equivocat només
  pot acabar la petició com a fallada, mai confirmar cap adreça. Si la credencial
  no pot llegir execucions (403 o 404) o la seva identitat, el servei es queda
  amb el comentari del publicador i ho registra
  (`preview_runs_permission_denied` o `preview_identity_read_failed`); torna a
  provar la lectura com a màxim un cop l'hora, així que concedir `Actions: read`
  no necessita reiniciar el servei. Qualsevol altre error de lectura deixa el
  cicle amb el comentari sol i es registra (`preview_run_read_failed`).
- **Confirmació.** Un bucle en segon pla llegeix els comentaris de la PR i
  només accepta el del publicador de la fase 6: autor `github-actions[bot]`,
  marcador, origen exacte `https://pr-<n>.preview.mountainrunners.cat`, SHA igual
  al fixat i comentari escrit o actualitzat després de la petició. La
  confirmació es valida sempre contra el moment de la petició (`created_at`),
  també quan una persona la reconcilia després. Retorna l'URL confirmada al
  tema. Si en 25 minuts no hi ha confirmació, ho comunica com a no confirmada;
  mai construeix ni suposa l'URL.
- **Reinicis.** Una petició en `commenting` passa a `uncertain` i no es torna a
  publicar mai sola; com amb una reparació interrompuda, el servei refusa
  arrencar fins que una persona reconciliï l'estat real a GitHub, amb
  [Reconciliació de resultats desconeguts (T8.5)](#reconciliació-de-resultats-desconeguts-t85).
  Una petició en `awaiting` reprèn la lectura de comentaris i d'execucions amb
  el termini original.
- **Traça privada.** `preview_requested`, `preview_membership_verified`,
  `preview_refused` (amb el motiu i la feina nova no informada si és el cas),
  `preview_commented`, `preview_confirmed`, `preview_unconfirmed`,
  `preview_failed`, `preview_failed_run` i `preview_uncertain`, amb la PR i el commit i l'autor, sense text de conversa
  ni credencials.
- **Llenguatge.** L'avís al tema és curt i planer, per a una persona que no
  treballa amb Git: diu què ha passat i què pot fer. El número de la PR només
  apareix a l'última línia, com a `Enllaç per a revisió: <URL>`; la preview
  confirmada sempre porta la seva adreça. El detall tècnic (estat, commit, PR i
  adreça) queda a la traça privada i a la nota del tema que rep el model.
- **Mai automàtic.** Ni una CI verda, ni crear una PR, ni publicar una reparació
  demanen cap preview. Només quan la mateixa petició que demana el canvi demana
  explícitament la preview, el servei la demana quan ha enviat l'avís verd, en
  nom de l'autor desat a la fila de `ci_watches` i amb el mateix tractament
  determinista; aleshores l'avís diu que la demana en comptes d'invitar-la a
  demanar, i tornar a tramitar el mateix avís no publica cap `/preview` nou.

- **Avís de confirmació.** L'avís s'envia abans de tancar la petició i només
  es tanca si l'enviament ha anat bé; si falla, es reintenta al cicle següent.
  Una caiguda entre l'enviament i el tancament pot duplicar l'avís. La duplicació
  d'aquest avís de Telegram és una excepció acceptada ([ADR 0014](decisions/0014-operator-stop-and-repeatable-telegram-notices.md)): el
  comentari `/preview` de GitHub no es repeteix. Una lectura
  fallida de comentaris no tanca la petició i el termini només s'aplica després
  d'una lectura correcta de comentaris. Una lectura fallida d'execucions no
  tanca res per si sola: el cicle continua amb el comentari del publicador i el
  termini, així que la petició pot acabar com a no confirmada sense el resultat
  de l'execució.
- **Repetició pel mateix commit.** Confia que GitHub actualitza el camp
  `updated_at` del comentari del publicador quan el torna a escriure. Si no ho
  fa, la petició acaba com a no confirmada tot i que la preview pot estar
  activa.
- **Granularitat d'un segon.** `updated_at` només té precisió de segon, així
  que només s'accepta un comentari actualitzat estrictament després de la
  petició. Una publicació anterior del mateix commit feta dins del mateix segon
  no es confon amb la confirmació. Una publicació real sempre acaba més tard,
  perquè el build triga minuts; el cost de la regla és una no confirmació falsa,
  que és la fallada segura.
- **Cursa acceptada.** Si arriba un commit nou entre la comprovació i
  l'execució del flux, el flux construeix el cap nou i el servei informa de no
  confirmada perquè el SHA no coincideix.

L'activació continua depenent de la verificació del pilot: la credencial ha de
tenir escriptura a Pull requests (per comentar), lectura de Checks i Statuses,
lectura d'execucions de fluxos (`Actions: read`, per llegir el resultat de la
preview) i cap escriptura a Workflows; la identitat de GitHub de l'agent ha de ser col·laboradora del repositori, perquè el publicador de la fase 6 en comprova l'autor del comentari. El flux de la fase 6 ha de tenir configurats els
secrets `PREVIEW_*`, l'entorn `previews` i el DNS de `*.preview.mountainrunners.cat`.
Aquesta implementació no activa res.

### Merge demanat al tema (T8.4)

Una persona verificada demana el merge amb la comanda literal `/merge`. No es
tria mai amb llenguatge natural: el servei reconeix el text complet abans del
classificador, el model no veu la comanda i una frase com «fusiona-la» no fusiona
res. La decisió segueix l'[ADR 0013](decisions/0013-private-development-agent-boundary.md)
(esmena `/merge` sense número). No hi ha auto-merge, ni push a `main`, ni canvi de
proteccions, ni tancament de la PR.

- **Formes.** `/merge`, `/merge <PR>` (amb `#` opcional) i `/merge <PR> <SHA>`
  (SHA complet de 40 caràcters), amb les regles de menció o resposta del pont.
  Qualsevol altra cosa que comenci per `/merge` respon amb l'ajuda i no fusiona.
- **Fixació.** La PR i el commit són els de l'últim avís de CI lliurat al tema,
  que ha de ser en verd (`ci_watches`). El número i el SHA escrits han de coincidir
  amb aquest avís; només es pot fusionar l'última PR informada del tema.
- **Si no es pot resoldre, pregunta i no fusiona.** No hi ha cap avís; l'últim
  avís no és verd; el número no és el de l'últim avís; o el tema té feina més
  nova (una altra instrucció pendent o en curs, una reparació reservada, en cua o
  en curs, un seguiment de CI encara sense informar o un avís de CI amb resultat
  desconegut més nou que l'últim lliurat). La resposta nomena la proposta
  i demana esperar l'informe nou i tornar a escriure `/merge`.
- **Pertinença.** Es torna a consultar a Telegram en el moment d'executar la
  comanda, a més de l'admissió; una fallada de la consulta o un autor que ja no
  és membre refusa el merge. La lectura queda dins del termini de petició del
  servei; si s'esgota, compta com una fallada i refusa demanant tornar-ho a
  provar. La consulta es fa després de resoldre el
  vincle i la feina més nova, i la comprovació superada queda a la traça
  (`merge_membership_verified`).
- **Condicions, rellegides en directe i en fallada tancada.** PR oberta, no
  esborrany, base `main`, repositori del cap igual al configurat (sense forks),
  cap igual al commit fixat, comprovacions obligatòries totes en verd amb el
  classificador de la CI i `mergeable_state` igual a `clean` (branca al dia i sense
  bloquejos). `behind` refusa i ho ha de revisar la persona que manté el servei;
  `unknown` es torna a llegir un
  màxim de tres vegades i després es refusa com a no llegible, sense llegir
  abans les comprovacions; `blocked`,
  `dirty`, `unstable`, `has_hooks` i qualsevol altre valor refusen. Un error de
  lectura refusa.
- **Crida.** `PUT /repos/{repo}/pulls/{n}/merge` amb el cos exacte
  `{"sha": <commit fixat>, "merge_method": "squash"}`: GitHub rebutja el merge si
  el cap ja no és aquest SHA. El servei no envia títol, missatge ni altre mètode.
  La resposta ha de dir `merged: true` i portar el SHA del merge.
- **Estats** (`state/merge-request.sqlite`): `merging` (desat abans de la crida),
  `merged`, `failed` (4xx definitiu que no és 408 ni 429, com 405, 409 o 422: no
  s'ha fusionat res, es respon i una petició nova és possible), `uncertain`
  (xarxa, aturada, 408, 429, 5xx o resposta mal formada) i `not_merged` (una
  persona ha confirmat que un resultat desconegut no va fusionar res). Una
  actualització de Telegram només es tramita una vegada i una PR té com a màxim
  una petició no acabada. Si la crida confirma el merge però no es pot desar
  l'estat, el servei informa igualment de la fusió amb un avís; la petició queda
  `merging` i en reiniciar-se passa a `uncertain` i es tanca com a `merged`
  llegint la PR. Si no es pot desar el final d'un rebuig o d'un resultat
  desconegut, la resposta és la del resultat desconegut.
- **Resultat desconegut i camí de l'operador.** No es repeteix mai el merge sense
  llegir la PR. Amb una petició `uncertain`, el `/merge` següent d'aquella PR i
  l'arrencada del servei llegeixen la PR:
  - Si GitHub la mostra fusionada, la petició es tanca com a `merged` i el tema
    rep «GitHub mostra la proposta #N fusionada. Un merge anterior havia quedat
    sense confirmar.», sense afirmar qui l'ha fusionada (pot haver estat per una
    altra via). L'última línia és l'enllaç de revisió amb el canvi fusionat:
    «Enllaç per a revisió: <URL> (canvi fusionat <SHA curt>)». Si no es pot
    llegir l'URL, només s'omet l'enllaç.
  - Si no la mostra fusionada, el tema rep una vegada per petició (a
    l'arrencada, o a la resposta si el resultat desconegut ha sorgit en
    executar-se) l'avís que GitHub no la mostra fusionada, oberta o tancada
    sense fusionar. Un lliurament desconegut pot enviar aquest avís dues
    vegades; és l'excepció acceptada de l'[ADR 0014](decisions/0014-operator-stop-and-repeatable-telegram-notices.md) i no
    repeteix cap efecte de GitHub. Una `/merge` o `/merge <PR>` mai no
    desbloqueja res: dona la forma estricta `/merge <PR> <SHA>` amb el commit
    fixat, per copiar i enganxar.
  - Quan una persona verificada escriu `/merge <PR> <SHA>` amb el SHA del commit
    fixat de la petició `uncertain`, i una lectura nova continua mostrant la PR
    oberta i no fusionada, aquesta és la seva decisió: la petició es tanca com a
    `not_merged` (traça `merge_uncertain_cleared` amb autor, PR i SHA) i la
    petició continua des de zero amb tot el flux normal (vincle a l'últim avís
    en verd, feina més nova, pertinença, condicions en directe, desat previ i
    crida). Si el cap de la PR s'ha mogut des del commit fixat, l'avís demana
    el SHA del cap actual i només aquest SHA ho desbloqueja (el flux normal
    exigeix igualment que sigui l'últim commit informat en verd). No cal editar
    SQLite. Una PR tancada sense fusionar no es pot
    fusionar: l'avís ho diu i no s'envia cap crida.
    Aquest resultat no bloqueja la cua ni l'arrencada del servei (a diferència d'un
    comentari `/preview` interromput), perquè només afecta un nou merge de la
    mateixa PR. Si la lectura no és possible, la petició continua `uncertain` i es
    torna a intentar. Una petició `merging` interrompuda per un reinici passa a
    `uncertain`.
- **Resposta.** Nomena sempre la proposta fusionada i el canvi fusionat (SHA
  curt) a l'última línia, després de l'enllaç de revisió:
  «Enllaç per a revisió: <URL> (canvi fusionat <SHA curt>)». Si l'URL no és
  llegible, l'última línia és «Canvi fusionat <SHA curt>.».
- **Traça privada.** `merge_membership_verified` (autor, PR i SHA),
  `merge_requested`, `merge_refused` (amb el motiu), `merge_completed` (autor,
  PR, SHA fixat, mètode i commit de merge), `merge_failed`, `merge_uncertain`,
  `merge_uncertain_cleared` (autor, PR i SHA) i `merge_reconciled`, sense text
  de conversa ni credencials.
- **Després del merge.** La PR queda tancada: el seguiment de CI i la reparació
  ja es detenen amb una PR no oberta, i la preview la refusa. L'avís «la PR ja no
  està oberta» passa a ser l'últim del tema; un `/merge` posterior (amb o sense
  número) llegeix la PR i, si és fusionada, respon «La proposta #N ja està
  fusionada. No he fet res més.» i la línia de revisió amb el canvi fusionat, en
  lloc de refusar-se com a no verda.

Bloquejos d'activació, per a una persona. El permís `Contents: write` del token
permet usar l'API de merge i el compte és administrador: l'API REST podria
saltar-se la protecció de la branca llevat que s'activi «enforce admins». La
guarda efectiva són les comprovacions del servei (`clean`, SHA fixat, avís verd)
i el risc residual està acceptat a l'ADR 0013. `MOUNTAIN_AGENT_REQUIRED_CHECKS` ha
de coincidir amb la protecció de `main` amb «Require branches to be up to date»,
perquè `clean` signifiqui el mateix per als dos. El primer merge real requereix
l'aprovació explícita de la persona mantenidora. Aquesta implementació no activa
res.

### Continuació d'una PR des d'un altre tema (T8.4)

Una continuació pot reprendre una PR que el servei va publicar en un altre tema.
No hi ha cap coincidència entre persones de Telegram i comptes de GitHub ni cap
transferència de converses: el context viatja amb la PR.

- **Destí.** Només quan el classificador diu `continuation` i el text conté
  exactament un testimoni sencer `#<número>`, que parseja el servei i mai el
  model. Dos números diferents responen amb una petició d'aclariment. Sense
  número, el comportament és la feina pendent del tema o, si no n'hi ha i el
  tema té una PR oberta pròpia, aquella PR (vegeu «Continuïtat de la conversa
  d'un tema»).
- **Elegibilitat, rellegida a GitHub.** PR oberta, no esborrany, base `main`,
  repositori del cap igual al configurat (sense forks), branca que supera
  `assertWorkBranch` i almenys una fila de `ci_watches` amb aquell número: les PR
  obertes per persones no es reprenen mai. Qualsevol incompliment respon en
  català i no toca res. El nom de la branca no identifica res: una fork que
  reutilitza la branca d'una PR del tema també es refusa. Només després
  d'aquestes comprovacions, si el worktree del tema ja té aquella branca,
  s'aplica el camí de sempre.
- **Traspàs.** El tema de la fila de `ci_watches` més recent és el propietari
  actual. La represa espera que no tingui cap altra instrucció pendent o en curs
  ni cap avís sense informar, de manera que dos temes no escriuen mai la mateixa
  branca alhora. Després d'una publicació confirmada, `registerCiWatch` afegeix
  la fila del tema nou (no automàtica): el tema nou és el propietari, rep els
  avisos de CI i les reparacions, i `/merge` sense número s'hi resol. Si la
  fila no es pot desar, la publicació es manté, no s'avisa ningú, es traça
  `continuation_owner_unregistered`, la resposta diu que el canvi de tema no
  s'ha pogut registrar i la instrucció acaba com a incerta: cap seguiment
  durador pot autoritzar la publicació i una persona la reconcilia. Si el propietari anterior és un altre tema, rep un avís
  curt («La feina de la proposta #N continua en un altre tema.»), sense dades
  personals ni autoria. L'enviament té el mateix termini que les altres
  lectures i respecta l'aturada del servei: un temps esgotat o una aturada es
  traça com a fallit i no canvia el resultat publicat.
- **Feina local.** El servei busca tots els worktrees registrats, actuals o
  arxivats, que tinguin la branca en checkout. Si un té canvis sense cometre o
  commits sense publicar, refusa i ho explica; no sobreescriu mai res. Si no, el
  deixa en `--detach` al seu HEAD per alliberar la branca. Si la branca local
  existeix i la seva punta no és avantpassada del cap de la PR, refusa per
  història local no publicada. El worktree del tema es preserva com
  `topic-<16hex>-before-<8hex>` com en una feina nova; després es baixa
  `refs/heads/<branca>` d'`origin`, es comprova que el SHA baixat és el cap que
  ha retornat GitHub (si no, el cap s'ha mogut i es refusa per tornar-ho a
  provar), es fixa la branca local en aquell SHA i es fa `git worktree add`.
  El cap queda registrat com a publicat, així que una represa sense canvis no
  torna a publicar res.
- **Canvis externs.** La represa parteix del cap actual de la PR encara que una
  persona hi hagi fet push després de l'últim commit del servei. El push continua
  sent només fast-forward i la resposta nomena el SHA des del qual s'ha
  continuat.
- **Publicació i context.** El canvi reutilitza l'opció `repair` del publicador
  amb el número de PR i el SHA de partida: comprova que la PR segueix oberta i
  amb aquell cap abans del push i no obre mai cap PR. El model rep, com a dades
  no fiables i retallades, el número, la branca, el SHA de partida, el diff
  `origin/main...HEAD`, els últims vint comentaris i l'estat de les
  comprovacions obligatòries del cap, seguits de la petició de la persona.
- **Traça privada.** `continuation_resumed`, `continuation_refused` (amb el
  motiu i el SHA curt del cap quan s'ha pogut llegir),
  `continuation_owner_unregistered`, `continuation_handover_notified` i
  `continuation_handover_failed`, amb `#N` i el SHA curt, sense text de
  conversa.

### Avís de solapaments (T8.4)

Quan les comprovacions passen i abans del commit, una implementació o una
continuació avisa el tema dels fitxers que també apareixen en feines actives
conegudes. No bloqueja res: només afegeix unes línies al resultat, i un error en
calcular-lo es registra i s'ignora.

- **Què compta.** L'última fila de `ci_watches` de cada PR que el servei va
  publicar, llevat que l'últim avís lliurat digui que la PR s'ha tancat, i el
  worktree actual de cada altre tema amb canvis sense cometre o commits sense
  publicar. Mai les carpetes `-before-<8hex>`, mai el tema que fa la petició, i
  mai la PR que aquell canvi continua o repara. Un worktree net o ja publicat
  sense res pendent no compta; un tema amb una PR tancada o no situada en una
  branca de treball conserva la seva feina pendent com a feina local.
- **Font local.** Només Git: `git diff --name-only -z origin/main...HEAD` i els
  canvis sense cometre, amb els dos costats d'un reanomenament. No es fa cap
  crida a GitHub. Una PR només es pot situar en una branca de treball quan és la
  publicació més recent del seu tema i aquell worktree la té en checkout; si no,
  s'omet.
- **Missatge.** Els fitxers compartits (10 com a màxim, ordenats, amb «i N més»)
  i cada PR com a `PR #N`. Cada camí es mostra retallat a 120 caràcters i amb els
  caràcters de control, els canvis de direcció i els accents greus escapats,
  perquè cap camí aliè pugui reescriure l'avís. Una feina local sense PR es diu
  «una feina local d'un altre tema», sense nom del tema, de l'autor ni dades de
  Telegram. Acaba amb una frase que recorda que l'absència d'avís no garanteix
  que no hi hagi altres conflictes.
- **Traça privada.** `overlap_warned` amb els números de PR i el nombre de
  feines locals i de fitxers; cap nom de fitxer ni cap clau de tema. Sense
  solapament no es traça res.

### Adjunts (T8.8)

Una implementació o una continuació poden rebre imatges del tema. El servei
les descarrega quan executa la instrucció, mai en admetre-la.

- **Què s'accepta.** Fotos comprimides de Telegram i documents JPEG, PNG i
  WebP. D'una foto es pren la mida més gran, que Telegram envia com a JPEG. El
  límit d'entrada és de 20 MB, el màxim de descàrrega de la Bot API. Cada
  missatge o àlbum admet fins a cinc imatges. Una foto o un document d'un altre
  tipus es refusa amb un avís i no ocupa la cua.
- **Àlbum.** Telegram envia cada imatge d'un àlbum com una actualització pròpia
  amb el mateix `media_group_id`, i sovint només una porta la llegenda. El pont
  les recull durant una espera acotada d'un segon i les classifica com una sola
  instrucció; la menció o la llegenda poden ser en qualsevol imatge. Més de cinc
  imatges es refusen. L'àlbum és una unitat: si una imatge no s'accepta, es
  refusa el conjunt i no se'n desa cap. Mentre l'àlbum espera, l'offset de Telegram no avança més
  enllà de la primera imatge, així que un reinici torna a llegir el grup i la
  reentrega no reinicia l'espera. Els missatges d'altres sessions s'admeten
  sense esperar; els de la mateixa sessió esperen darrere l'àlbum per conservar
  l'ordre.
- **Com s'envia.** La imatge ha de ser al missatge que menciona el bot (menció a
  la llegenda) o que respon a un missatge seu, o al missatge que la mateixa
  instrucció respon, dins del tema. Els reenviaments s'ignoren i la instrucció
  necessita text: la llegenda o el missatge.
- **Validació.** El tipus real surt dels bytes i ha de coincidir amb l'extensió
  i el tipus que ha declarat Telegram. Les dimensions es llegeixen només de les
  capçaleres (PNG `IHDR`, JPEG SOF0–SOF15, WebP `VP8`, `VP8L` i `VP8X`), sense
  descodificar cap píxel. L'estructura també es comprova: al PNG, l'`IHDR` fa 13
  bytes i va primer, cada tros té el CRC correcte, hi ha d'haver `IDAT` i
  l'`IEND` ha de tancar el fitxer; al WebP, la mida RIFF ha de consumir el
  fitxer exacte, hi ha d'haver un sol fotograma i, en un fitxer estès, la tela ha
  de coincidir amb el fotograma (l'animació no s'accepta); al JPEG, el
  recorregut arriba a l'`EOI` i cap dada no el pot seguir. Un fitxer que no
  compleix aquestes condicions es refusa.
- **Metadades.** S'eliminen EXIF, XMP, IPTC, comentaris i dates del contenidor
  (JPEG: APP1, APP13 i COM; PNG: `eXIf`, `tEXt`, `iTXt`, `zTXt` i `tIME`;
  WebP: `EXIF`, `XMP ` i els bits corresponents de `VP8X`). APP0 i APP2 (ICC) es
  conserven. Al JPEG el recorregut és complet, també entre les exploracions d'un
  fitxer progressiu, i els segments de metadades s'eliminen a qualsevol posició.
  Després de reescriure es torna a llegir el resultat i es comprova que el tipus,
  les dimensions i la resta de dades d'imatge no canvien i que no hi queda cap
  metadada.
- **Reducció.** Si el costat llarg supera 2.400 px, `attachments/scale.mjs` posa
  la imatge neta en un directori temporal ignorat del worktree i executa un
  script dins del sandbox amb el `sharp` que la imatge ja té al store fora de
  línia. El procés de confiança no descodifica cap píxel. Després torna a llegir
  la sortida sense seguir enllaços simbòlics i amb un màxim de 20 MB, i la valida
  amb el lector de capçaleres: tipus, dimensions de 2.400 px com a màxim i cap
  metadada. Si no quadra, refusa. Una imatge més petita que la
  portada recomanada (1200 × 675 px) s'accepta i el model ho diu en una frase.
- **Destinació i retenció.** El magatzem és
  `state/attachments/topic-<hex>/`, fora del worktree i de Git, amb noms curts i
  estables (`imatge-1.jpg`, `imatge-2.png`). Un adjunt hi és fins que es
  publica o durant set dies; a l'arrencada s'esborren els vençuts. Cada torn
  copia el magatzem a `.agent-attachments/` del worktree perquè el sandbox el
  pugui llegir. Abans de les comprovacions i del commit, el servei esborra la
  còpia. Una imatge s'ha utilitzat quan el worktree conté, fora de
  `.agent-attachments/`, un fitxer regular amb els mateixos bytes (mateix
  SHA-256); si la publicació acaba bé, llavors la treu del magatzem. La publicació també refusa qualsevol història que
  contingui una ruta sota `.agent-attachments/`. El fitxer original només viu
  al directori temporal del servei i s'esborra sempre.
- **Què rep el model.** La llista d'imatges del tema amb el nom, les dimensions
  i si són noves en aquest missatge; les noves arriben com a entrada d'imatge
  del prompt i la resta es poden tornar a mirar amb l'eina `view_attachment`.
  Les imatges noves d'un prompt sumen com a màxim 8 MB; les que no hi caben no
  s'envien com a entrada i el text diu al model que les miri amb l'eina.
  El text de servei fixa els drets: una imatge que envia un membre verificat
  sense cap altra indicació és del club, amb el crèdit «Mountain Runners», i
  només es pregunta quan sembla de tercers. Amb diverses imatges noves, la
  persona diu on va cada una o el model fa una sola pregunta. Un cartell
  vertical es mostra sencer. El text alternatiu surt del que mostra la imatge i
  el model compara el text del cartell amb els fets de l'entrada. No s'hi posen
  consentiments ni dades personals.
- **Eina de consulta.** `view_attachment` només accepta un nom de la llista del
  servei, obre el fitxer amb `O_NOFOLLOW`, comprova que és un fitxer regular
  dins la mida i revalida la capçalera abans de retornar-lo. Un enllaç
  simbòlic, una ruta o un nom desconegut es refusen.
- **Abast i traça.** Només una implementació i una continuació apliquen les
  imatges; qualsevol altra instrucció les ignora i ho diu en una frase. La traça
  privada registra `attachment_accepted` (tipus, dimensions i bytes),
  `attachment_refused` (motiu i, quan es coneix, el tipus declarat i la mida) i
  `attachment_used` (noms utilitzats), mai el nom original ni el contingut.

### Continuïtat de la conversa d'un tema (T8.7)

Cada tema té una sola sessió de Pi i Pi conserva l'historial entre torns. El
servei hi manté, però, estat propi perquè cap missatge acceptat ni cap efecte
seu no quedi fora de la sessió.

- **Un torn per missatge acceptat.** Tota instrucció admesa que no és `/merge`
  ni una preview executa un torn de Pi a la sessió del tema. Si el classificador
  retorna aclariment, o una continuació no té feina pendent ni PR del tema, el
  torn és una consulta: worktree de només lectura, sense branca ni publicació, i
  una línia del prompt que diu que el servei no ha pogut distingir si la persona
  vol un canvi. El text fix d'aclariment només es fa servir si el model no
  respon.
- **Efectes del servei.** `repository/session-note-store.mjs` desa a
  `state/session-notes.sqlite`, per tema, el text de cada efecte que decideix el
  servei i que no és la resposta del model: l'informe de publicació i qualsevol
  altre informe d'instrucció, els avisos de CI i de reparació, la preview, el
  merge, el traspàs de tema, l'adjunt refusat (també el que es refusa en
  admetre'l) i la resolució d'un resultat desconegut. Una nota només conté text
  escrit pel servei: si un avís seu incorpora text del model, la nota en guarda
  només la part del servei, i les paraules del model només queden com a última
  resposta del tema. La nota es desa quan el servei decideix el text, abans de
  l'enviament: l'efecte existeix encara que l'avís falli. Cada efecte té una
  identitat duradora (`preview:<id>:<estat>`, `merge:<id>:<estat>`,
  `ci:<id>:<commit>:<estat de l'avís>`,
  `repair:<id>:<commit>:<instant de l'intent>:<estat>`, `handover:<id>`,
  `instruction:<id>`, `reconcile:<tipus>:<id>`): dos avisos diferents del mateix
  commit són dos efectes, i la identitat d'una reparació no depèn d'una fila que
  es pot reutilitzar. Així, un reenviament de Telegram no duplica la nota i una
  identitat ja lliurada no es reviu. Les identitats lliurades es conserven sense
  poda: qualsevol reintent pot arribar molt més tard, i la taula només té una
  clau curta per efecte. Un informe que barreja text del servei i text del model
  (per exemple la línia de represa seguida de la resposta del model) només desa
  la part del servei com a nota, i el text complet queda com a última resposta
  del tema. Cada nota es retalla a 1.500 caràcters i el tema conserva les 20 més
  noves sense lliurar.
- **Lliurament únic.** Les notes es reclamen al darrer moment, després de la
  preparació del sandbox i del perfil de Pi i just abans que Pi rebi el prompt,
  i es posen davant de la petició en un bloc de servei separat («Service events
  since your previous turn...»). Qualsevol fallada anterior a aquest punt
  (preparació, perfil o aturada) deixa les notes pendents. Un cop reclamades,
  s'esborren quan el torn acaba o falla, perquè el prompt pot haver arribat a
  Pi. L'única excepció és que el prompt no s'hagi escrit mai (el servei ho sap
  pel fet d'enviament, `onPromptSent`, encara que després falli també la neteja
  del sandbox o l'error de llançament quedi substituït): llavors les notes tornen
  a quedar pendents, perquè cap prompt no hi ha arribat. Un reinici conserva les
  pendents i no repeteix cap nota d'un torn interromput: una reclamació que el
  reinici troba oberta compta com a lliurada i la seva identitat es desa abans
  d'esborrar la fila. El classificador no rep mai aquest bloc. La reparació
  automàtica també és un torn del tema i rep les notes.
- **Context del classificador.** La crida efímera continua sense eines,
  historial ni repositori. Rep, com a dada JSON, l'última resposta del tema
  retallada a 800 caràcters (resposta del model o informe del servei), si el
  worktree del tema té canvis o commits sense publicar (lectura de Git, sense
  fetch ni worktree nou) i el número de la PR que el tema va publicar i encara
  té. Una petició que actua sobre el canvi del tema (l'edita, el publica, el
  reintenta o hi aporta dades, correccions, una aprovació o una resposta) és una
  continuació; un agraïment, un dubte sobre l'estat o una ordre d'esperar és una
  consulta, i publicar mai no és una preview. Una feina sobre un altre contingut
  és una implementació. Un límit de peticions del proveïdor (HTTP 429) es
  reintenta com a màxim dues vegades amb una espera curta dins del mateix termini
  de la classificació; si persisteix, la petició falla en lloc de tractar-se com
  un aclariment. Cap altre error es reintenta i una aturada no ho fa mai. Cada
  classificació es traça com
  a `instruction_classified`, amb el tipus com a detall; una petició que demana
  la preview juntament amb el canvi ho traça com a `preview_after_change`.
- **Continuació sobre la PR del tema.** Si una continuació no nomena cap `#N`,
  no té canvis locals ni commits pendents i el tema té una PR oberta pròpia, el
  servei la reprèn amb les comprovacions de «Continuació d'una PR des d'un altre
  tema». Si el worktree ja té aquella branca al cap de la PR, continua allà
  mateix sense moure res, i la publicació fixa aquella PR i aquell cap: els
  revalida abans del push i no n'obre mai una altra. Si té una
  altra branca, usa el camí de represa i arxiva el worktree com en una feina
  nova. Un refús s'informa com sempre; una PR fusionada o tancada deixa la
  petició com a consulta. Un adjunt de la continuació s'aplica al worktree
  corresponent.

### Llengua, avisos i publicació (T8.8)

El prompt de cada torn inclou un bloc fix amb el públic i el to de la resposta:
les persones del tema són membres del club i majoritàriament no tècniques, la
resposta va en la seva llengua amb el català per defecte, amb frases curtes, i no
s'esmenten rutes, noms de fitxer, camps YAML, ordres, proves, commits, branques,
ADR ni skills si la persona no demana detall tècnic. El model redacta amb els
fets que té i fa com a màxim una pregunta.

El prompt rep l'instant actual en Europe/Madrid amb el seu desplaçament
(`formatMadridInstant`), no del rellotge del sandbox. Una entrada es crea sempre
com a esborrany; `published: true` i `publishedAt` amb aquell instant només
s'apliquen quan una persona verificada demana explícitament de publicar l'entrada
al tema. Aquesta petició és l'aprovació editorial d'aquella entrada. El merge
continua sent humà i el desplegament no canvia. Les variants en castellà i anglès
només s'escriuen quan algú les demana.

`stripChangeSummary` elimina qualsevol línia `SUMMARY`, també amb espais al
davant, del text que arriba a Telegram; `parseChangeSummary` continua llegint la
línia vàlida per al títol i la branca.

Després d'una publicació, el tema rep la resposta del model, una línia curta sobre
el que passa amb el canvi i l'enllaç de revisió com a darrera línia. La línia
curta diu que el canvi s'està comprovant i que el tema rebrà un avís quan estigui
a punt només si el seguiment de CI s'ha desat; si no s'ha pogut desar, diu que no
hi haurà avís i que ho ha de revisar una persona; sense cap seguiment, diu només
que el canvi està publicat. La resposta del model es retalla perquè l'enllaç no
es perdi mai pel límit de 4000 caràcters del transport. Amb les comprovacions
obligatòries en verd rep un sol avís, que convida a demanar la preview, amb el
mateix enllaç. Una fallada, una reparació en curs, el límit de reparacions, un
resultat desconegut, un cap canviat o una PR tancada tenen cada un un avís
planer.

Els noms de les comprovacions i el commit queden al registre privat del servei
(`ci_notification_sent`) i a la nota del servei de
`state/session-notes.sqlite`, que és l'única que veu el model; l'evidència d'un
intent de reparació es desa a `state/ci-watch.sqlite`. La nota de la publicació és
tècnica i separada del text planer: `publicationNoteText` hi desa el número de la
proposta, la branca, el commit publicat i el resultat de les comprovacions
locals. També la publicació d'una reparació automàtica desa aquesta nota
(`ciRepairReports.publishedNote`): les paraules del model arriben al tema, però
no són mai text de servei. La fixació al commit, el lliurament com a màxim una
vegada i el tractament d'un resultat desconegut no canvien.

Quan el seguiment veu que el cap de la proposta ha canviat, ho diu i no promet cap
avís nou: les comprovacions de la versió nova no es fan totes soles, i la persona
ha de demanar en aquell tema que es revisin o, més endavant, la preview.

### Estat del tema (T8.8 i T8.9)

Abans de cada torn, el servei identifica la PR del tema amb els seguiments
persistits. Llegeix de GitHub la PR, el cap i les comprovacions obligatòries, i
revalida el cap. Per a una petició de preview del cap actual, llegeix el
comentari del publicador i només facilita l'URL confirmada per a aquell commit.
Si la lectura falla o el cap canvia durant la consulta, el bloc indica que no
es pot comprovar l'estat i es registra `topic_state_failed` al journal. El bloc
no conté identificadors de Telegram ni dades personals, i el classificador no el
rep. El model el rep dins del sandbox sense xarxa ni credencials.

La petició explícita de preview torna a comprovar la PR i les comprovacions del
cap encara que l'últim resultat desat no sigui verd. Just abans de publicar el
comentari, torna a llegir el cap i la CI i refusa la petició si han canviat o no
es poden llegir. Els treballs pendents i els
resultats desconeguts continuen bloquejant la petició. Abans d'un merge o una
reparació, el servei torna a comprovar el cap i la CI; el merge continua fixat
al commit informat al tema.

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

### Consulta de la traça privada (T8.5)

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

### Reconciliació de resultats desconeguts (T8.5)

Una aturada o un reinici pot deixar una acció externa amb resultat desconegut:
una instrucció que podia haver fet push o obert una PR, una reparació automàtica
que podia haver fet push o un comentari `/preview` que podia haver-se publicat.
El servei refusa arrencar mentre en quedi cap. Un avís de CI que potser no va
arribar al tema no bloqueja l'arrencada, però bloqueja la resolució d'un merge o
d'una preview a partir de l'avís anterior. La decisió és d'una persona: l'ordre
no repeteix l'acció, no fa push, no comenta i no fusiona res.

Després d'una actualització amb worktrees antics, executa abans la migració
d'identificadors (vegeu «Noms opacs i migració»). Una instrucció incerta no es
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
   (`instruction`, `repair`, `preview` o `notice`), `update_identifier`,
   `session_key`, `created_at` i els fets que pot llegir.
   - `instruction`: `worktree` amb la branca del tema, el HEAD local i si aquell
     HEAD ja consta com a publicat, i la PR oberta d'aquella branca amb el
     número i el cap.
   - `repair`: `update_identifier` (l'actualització de Telegram), `sequence`
     (la seqüència de la fila), `failed_commit`, `pull_request_number` i
     l'estat de la PR amb el seu cap.
   - `preview`: `pull_request_number`, el commit i `comment_found`, que diu si el
     compte del servei ha creat un comentari amb el cos exacte `/preview`
     després de la petició. Un comentari creat abans i editat després no compta.
   - `notice`: `pull_request_number`, el commit i `result`, que és el resultat
     de la CI que l'avís hauria comunicat. No fa cap lectura de GitHub.

   Si una lectura de GitHub falla, aquell cas porta `"github": "unavailable"` i
   la resta es llisten igualment. Si el tema no té worktree local, `github` val
   `"skipped"` i no es llegeix cap PR. La sortida no conté cap token ni el text de
   la instrucció.

2. **Comprova l'estat real a GitHub** amb la PR, la branca, els commits i els
   comentaris que mostra la llista.

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
     resolve --kind preview --update 21 --resolution commented
   /usr/bin/node /usr/local/lib/mountain-runners/agent/commands/reconcile/cli.mjs \
     resolve --kind notice --update 31 --resolution delivered
   ```

   | Cas        | Resolució                                     | Efecte                                                                                                                                                                                                                                                                                     |
   | ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | instrucció | `published --commit <SHA> --pull-request <n>` | Estat `done` i resultat `reconciled_published`; si el HEAD del worktree del tema és aquell commit, es marca com a publicat i no es torna a publicar mai. A més, desa un seguiment de CI pendent d'aquell commit, perquè el tema rebi el seu informe abans que cap merge es pugui resoldre. |
   | instrucció | `not_published`                               | Estat `done` i resultat `reconciled_not_published`; el treball local es conserva i una persona pot demanar-ne la continuació.                                                                                                                                                              |
   | reparació  | `published --commit <SHA>`                    | Estat `done` i resultat `reconciled_published`; no es reobre cap seguiment de CI.                                                                                                                                                                                                          |
   | reparació  | `not_published`                               | Estat `done` i resultat `reconciled_not_published`; no es reobre cap seguiment de CI.                                                                                                                                                                                                      |
   | preview    | `commented`                                   | Estat `awaiting` amb el moment actual; el servei continua esperant la confirmació del publicador i la informa al tema.                                                                                                                                                                     |
   | preview    | `not_commented`                               | Estat `failed`; no s'ha publicat res.                                                                                                                                                                                                                                                      |
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
   sola transacció; en una reparació o una preview, la traça s'escriu abans del
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

### Retenció de la traça, l'estat i les sessions (T8.5)

Decisió de la persona mantenidora: per ara no s'esborra res automàticament. La
traça privada, les bases de dades de `state/` i l'historial de Pi de `sessions/`
es conserven fins a una revisió explícita. Les identitats dels efectes ja
lliurats a la sessió (`session_delivered_effects`) tampoc no es poden: cada
reintent d'un avís les consulta, i la mida és d'unes poques desenes de bytes per
efecte. Els worktrees arxivats segueixen la
neteja que preserva treball no publicat (`storage/prune-worktrees.mjs`).

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

### Instal·lació prevista

El procediment següent és la preparació prevista; **no s'ha executat** i cap ordre
no es pot llançar sense aprovació explícita. Crea una identitat, un clon i una
unitat separats de producció i de previews.

```sh
# No executat. Requereix aprovació explícita abans de cada pas.
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
delegat de la unitat. No s'han fet aquestes operacions al VPS.

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
secrets ni dades privades. Una comprovació omesa o fallida no completa la T8.3.

### Estat de la verificació del pilot

Verificat al VPS amb la identitat i la unitat instal·lades:

1. Bot, supergrup privat amb temes i credencials de Telegram, model i GitHub
   creats fora del repositori. La credencial de GitHub refusa escriure a
   `.github/workflows` (403) i no té lectura d'administració, de manera que
   l'agent no pot introduir ni modificar workflows. L'entorn `production`
   limita el desplegament a les branques que fixa la seva política; l'entorn
   `previews` no té regla pròpia i només el condiciona el workflow.
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
  resultat desconegut real, aturada i rotació de credencials documentades al
  runbook. La pertinença, la revocació, la reconciliació i la retenció ja estan
  definides (T8.5).

Mentre aquests casos no estiguin resolts, el servei no s'activa de manera
permanent i cap agent no desplega ni fusiona res.

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
