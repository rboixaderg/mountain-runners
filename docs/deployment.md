# Direcció De Desplegament

## Estat Actual

El repositori disposa de CI de qualitat, seguretat, contracte d'artefacte i
desplegament continu protegit des de `main`. L'apex i `www` ja serveixen des
del VPS (19 d'agost de 2026) i la fase 5 es va tancar el 28 d'agost de 2026
amb el gate de llançament, l'HSTS i el període d'observació completats
([runbook](runbook.md#9-tall-dns-i-primera-activació-pública)). La T6.1 i la
T6.2 han fixat requisits i arquitectura de previews
([ADR 0009](decisions/0009-pr-previews-same-domain-and-own-branches.md)); la
T6.3 implementa la frontera entre el build no fiable i el publicador. El
resta de la fase 6 no bloqueja producció.

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

1. `pnpm build` amb `PUBLIC_SITE_ORIGIN` i `BUILD_TODAY` explícits, que ja
   executa la verificació de sortida existent (`verify-i18n-output.mjs`:
   rutes, `/`, 404, sitemap, robots, recursos i exclusió d'esborranys).
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

| Límit              | Valor   | Justificació                                |
| ------------------ | ------- | ------------------------------------------- |
| Mida expandida màx | 128 MiB | Build actual ≈ 21 MB (PDF d'estatuts 12 MB) |
| Nombre de fitxers  | 5.000   | Build actual: 149 fitxers                   |

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
  s'activa al tall (T5.5) important `Caddyfile.production`.
- **CLI de releases** (`tools/server/release/`): `install` (extracció segura:
  rebutja paths absoluts, `..`, symlinks, hardlinks, dispositius, duplicats i
  límits de mida/fitxers, i verifica tots els digests contra el manifest),
  `activate` (symlink `current` atòmic), `rollback` (release anterior elegible,
  codi 3 quan no n'hi ha cap), `revoke` i `health`. La persona mantenidora les
  executa amb `sudo`; la identitat de desplegament només pot arribar-hi a
  través del forced command `ssh-gate.mjs` (tokenitza sense shell i valida tots
  els arguments) i el daemon root (`mountain-release.service`), que revalida
  cada petició per `/run/mountain-release.sock` i és l'únic escriptor de les
  releases, del registre i del symlink actiu.
- **Registre de releases** (`/var/lib/mountain-runners/releases.json`):
  permanent, amb commit, digests, dates i estat (`eligible`/`active`/`revoked`);
  les releases revocades mai no es reactiven.
- **Polítiques públiques**: la política de privacitat descriu l'allotjament a
  Hetzner i els registres del servidor (7 dies d'accés, 30 d'error).

La reversió rutinària és interna (canvia el punter atòmic sense tocar DNS); la
restauració dels registres web anteriors de Hostinger queda com a via
extraordinària amb aprovació explícita, i la resposta d'emergència del runbook
s'aplica quan no queda cap release elegible.

## Desplegament Continu (T5.4)

`tools/deploy/` orquestra el pas de l'artefacte de CI al VPS:

- `deploy.mjs` verifica manifest i digests, rebutja un commit que ja no és el
  HEAD de `main`, transfereix amb `receive`, instal·la, activa i executa smoke
  tests. Una fallada després d'activar restaura el commit que era actiu, no un
  `rollback` genèric. La comprovació de HEAD es repeteix després d'activar.
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
la T6.5 valida el sistema end-to-end.

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
[checklist de la T5.5](validation/phase-5-t55-launch-gate.md). De la fase 6,
la T6.3 té la frontera de previews implementada; la T6.4 (orígens, TLS,
cicle de vida i neteja) i la T6.5 (validació completa) resten pendents i
cap preview encara es publica. Només cal un ADR nou quan la implementació
introdueixi o canviï una decisió arquitectònica; els detalls que apliquen la
direcció acceptada continuen requerint una pull request revisada.
