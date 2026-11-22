# Previews De Pull Request

La frontera de previews viu en dues meitats que mai comparteixen confiança,
dins del límit de l'[ADR 0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md)
(origen sota `*.preview.mountainrunners.cat`, publicació només a branques
pròpies, cap segon domini ni servei extern) i de la decisió T6.2
([`docs/specs/phase-6/phase-6-t62-decisions.md`](../specs/phase-6/phase-6-t62-decisions.md)): cap credencial
DNS, certificats individuals HTTP-01, un procés Caddy amb blocs separats.

Les previews de PR (fase 6, decisió T6.2 esmenada per l'ADR 0010) les serveix
Caddy al mateix VPS que producció, amb blocs i registres d'accés separats però
emmagatzematge ACME compartit. El DNS és un wildcard manual
(`*.preview.mountainrunners.cat` → aquest VPS) i cap
sistema de previews té credencials DNS. La T6.3 implementa la frontera entre
el build no fiable i el publicador de confiança. Els noms de la comanda, el
procés i el directori per PR es defineixen a
[«Noms del flux de previews»](#noms-del-flux-de-previews).

## Com funciona

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

| Nom                                     | Què és                                                                                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview-deploy`                        | Usuari restringit del VPS compartit per totes les previews. Escriu als seus directoris, sense accés a les releases de producció ni a la configuració de Caddy.                                                               |
| `mountain-preview` / `preview-ssh-gate` | El mateix programa invocat amb dos noms: comanda per operar previews i comanda forçada quan s'hi accedeix per SSH. Valida cada petició.                                                                                      |
| `mountain-preview-site`                 | Procés local del VPS, engegat per `systemd` com a `root`. Rep peticions de `mountain-preview` per un socket Unix (canal local entre processos), verifica les signatures d'autorització i aplica els canvis permesos a Caddy. |
| `preview-authorization`                 | Procés fill temporal engegat per `mountain-preview-site` després de verificar la signatura. Escriu l'autorització com a `preview-deploy`.                                                                                    |
| `pr-<n>`                                | Directori de dades d'una PR, també anomenat _namespace_, amb les seves versions i el registre d'autoritzacions. No és un usuari ni un aïllament del sistema operatiu.                                                        |
| _Release_                               | Versió de la web instal·lada al directori d'una PR; només una és activa en cada moment.                                                                                                                                      |
| SHA del commit                          | Identificador del commit vigent de la PR. Cada publicació s'hi vincula; l'etiqueta `preview` també autoritza els push posteriors.                                                                                            |
| _Workflow_ / _job_                      | Automatització de GitHub Actions / una de les seves etapes, com `authorize`, `build` o `publish`.                                                                                                                            |

Una **comanda forçada** és una regla de la clau SSH. Encara que el client demani
`mountain-preview receive 130 ...`, el servidor executa sempre
`preview-ssh-gate`, no la petició directament. Aquest programa llegeix la
petició original, comprova que sigui una operació admesa i tria el directori de
la PR indicada. Rebutja ordres arbitràries i no obre cap terminal. La regla
limita què es pot demanar per SSH, però **no lliga la clau a una sola PR**.

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

### Un sol workflow, disparat sota demanda

Res no es construeix ni es publica perquè s'obri una PR. El workflow `Preview`
(`.github/workflows/preview.yml`) exigeix l'**etiqueta `preview`** de la PR.
Posar-la publica el cap actual. Mentre hi és, cada push i cada reintent manual
(`workflow_dispatch` amb el número de PR) publica el cap vigent. L'actor ha de
tenir permís `write` o `admin`. Treure l'etiqueta retira la preview. Un comentari
`/preview` ja no inicia el workflow.

L'etiqueta usa `pull_request_target` (tipus `labeled` i `synchronize`), que
executa el workflow des de `main`. No s'ha de canviar mai a `pull_request`:
l'entorn `previews` està restringit a la branca `main` des del 22 de novembre de
2026, i una branca del repositori podria canviar el workflow i llegir els
secrets `PREVIEW_*`. Una condició del
job `authorize` deixa passar `labeled` només si l'etiqueta posada és `preview`
i `synchronize` només si la PR la té; la resta de runs queden omesos i no
ocupen cap executor de build. Qualsevol altra etiqueta no fa res.

Des del 2 de desembre de 2026, GitHub només executa `pull_request_target`,
que fan servir `Preview cleanup` i l'etiqueta de preview, si una política
d'Actions del repositori ho permet; la
[política d'Actions](#política-dactions-de-pull_request_target-per-a-les-previews)
en descriu el contingut i la comprovació. Si es perd l'esdeveniment de retirada,
la reconciliació horària retira la preview si la PR no té l'etiqueta.

El job `authorize` vincula la petició al commit que encapçala la PR,
identificat pel seu SHA. L'entorn GitHub `previews` separa els secrets
`PREVIEW_*` dels de producció, però no exigeix revisors abans d'executar-se.
Només es publiquen previews de PR obertes del repositori principal. El sistema
rebutja commits que hagin canviat abans de publicar. El flux té tres jobs amb
fronteres explícites:

1. **`authorize`** (codi de confiança des de la branca per defecte):
   `tools/preview/resolve-publish.mjs` comprova que el `sender` de l'esdeveniment
   de PR o l'actor de l'execució manual té permís `write` o `admin`. Resol el SHA
   vigent per l'API, mai de `GITHUB_SHA`, i comprova que la PR és oberta, del
   repositori principal, té `preview` i no té `preview-revoked`. Si no compleix
   els requisits, el job falla abans del build. En un esdeveniment de PR, si
   l'etiqueta `preview` ja no hi és, el job omet el build.
2. **`build`** (no fiable): `tools/preview/build-artifact.mjs` compila la web
   amb l'origen exacte de la preview
   (`https://pr-<n>.preview.mountainrunners.cat`, derivat i validat a partir
   del número de PR) i registra un manifest que vincula commit (el head SHA
   del checkout, llegit amb `git rev-parse HEAD` i no de `GITHUB_SHA`, que en
   un `pull_request_target` apunta a la branca per defecte
   i no es pot sobreescriure),
   número de PR, origen, `BUILD_TODAY`, workflow i fitxers amb mida i
   SHA-256; fa checkout del head SHA, executa `pnpm validate` complet i puja
   l'artefacte intermedi (`mountain-runners-preview`, retenció de 7 dies).
   El job no rep cap secret, no usa cap cache compartida amb jobs de
   confiança i no té cap permís d'escriptura. Té un grup de concurrència per PR
   (`preview-build-<n>`, amb `cancel-in-progress`) per a totes les peticions:
   una execució nova cancel·la el build encara en curs d'una anterior. El grup
   `previews` de `publish` no canvia: una publicació en curs no s'interromp.
3. **`publish`** (de confiança, `needs: [authorize, build]`): descarrega
   l'artefacte del mateix run, valida manifest, mida, nombre de fitxers,
   digests i paths amb els mateixos validadors de producció, comprova la
   coherència manifest↔PR (commit, origen, número) i exigeix que el manifest i
   el cap vigent coincideixin amb el SHA d'`authorize`. Transfereix amb
   `receive` i instal·la. Abans d'autoritzar, d'activar i de comentar l'URL,
   revalida que la PR continua oberta, al mateix SHA, amb `preview` i sense
   `preview-revoked`, i que l'actor conserva `write` o `admin`.
   Signa l'autorització amb `PREVIEW_AUTH_PRIVATE_KEY` (absent del build) i
   l'envia per l'entrada estàndard al procés `mountain-preview-site`, que
   verifica la signatura amb la clau pública del VPS abans de registrar
   l'autorització. Després demana el bloc Caddy, torna a comprovar la PR i
   l'autorització abans d'activar i comprova TLS, capçaleres i salut. Mai no fa
   checkout ni executa codi de la PR.

Quan el smoke de la preview passa, `publish` busca el comentari del publicador
i torna a validar l'actor, l'estat i el SHA just abans d'escriure. Si comprova
que la PR ja no és elegible, retira la preview, encara que existís abans.
Amb el permís
`pull-requests: write`, que només tenen aquest job i el de neteja, crea o
actualitza un únic comentari propi amb l'URL i el SHA activats. Cerca
el marcador fix només als comentaris de `github-actions[bot]`; mai no modifica
comentaris d'altres persones. Si l'activació o el smoke fallen, no comenta res.
Quan una preview es retira, aquell mateix comentari passa a
`<marcador>\nPreview retirada.`: conserva el marcador però ja no nomena cap
adreça ni cap commit, així que ningú no el llegeix com una preview a punt i
l'agent no el confirma. Si la PR no té comentari del publicador no es fa cap
escriptura, i el comentari d'una persona amb el marcador no es toca.
Després d'intentar escriure el comentari, el publicador neteja les releases
anteriors. Si no pot escriure el comentari, el job falla però la preview
continua activa. Comprova'n l'estat abans de reexecutar el workflow.

Per reintentar una publicació fallida, conserva `preview` i executa el workflow
`Preview` manualment des de `main` amb el número de PR, o fes un push nou. Una
PR reoberta amb l'etiqueta no publica fins al proper push o reintent manual.

### Retirada en treure l'etiqueta

`Preview cleanup` (`.github/workflows/preview-cleanup.yml`) també escolta
`pull_request_target` de tipus `unlabeled`. Si l'etiqueta treta és `preview`,
`tools/preview/reconcile.mjs` retira la preview d'aquella PR amb
`mountain-preview retire <n>` i `site-disable <n>`, també si s'havia publicat
amb `/preview` o amb una execució manual. Treure qualsevol altra etiqueta omet
el job. Retirar una PR sense preview acaba sense error. S'executa al grup
`previews`, així que no coincideix amb una activació; si una publicació de
l'etiqueta encara no activada s'executa després, la comprovació de l'etiqueta
n'impedeix l'activació. Després de desactivar el lloc, el job edita el comentari
del publicador com s'ha dit a dalt; per això aquest job (i només aquest)
declara `pull-requests: write` a nivell de job, mentre el workflow manté
`contents: read` i `pull-requests: read`. Les retirades de la reconciliació
(caducitat, PR tancada, `preview-revoked`, fork, espai inconsistent o PR oberta
sense `preview`) i la retirada posterior a l'activació de `publish` també
marquen el comentari. En el primer cicle després del merge es retiren també les
previews antigues de PR obertes que no tinguin `preview`. Dels esdeveniments
de PR, el job només accepta `closed`, afegir `preview-revoked` i treure `preview`.

La T6.4 afegeix `mountain-preview retire <n>`: despublica l'origen canviant
atòmicament el nom del namespace i després n'esborra les releases. Repetir-lo
quan el namespace ja no existeix no falla. La reconciliació i la retirada
automatitzada estan verificades al VPS (T6.5). La instal·lació de la primitiva
en un VPS nou requereix una aprovació explícita separada.

### Reconciliació

El workflow `Preview cleanup` reconcilia cada hora, en tancar una PR i en afegir
`preview-revoked`. Retira les previews de PR tancades, revocades, de forks o
sense `preview`, i les previews que portin 14 dies sense actualitzar-se.
El job de publicació i el de neteja comparteixen el grup de concurrència
`previews` amb `queue: max`: una retirada pendent espera el seu torn i no la
substitueix una execució posterior. Si una preview continua servint-se després
de treure l'etiqueta, executa `Preview cleanup` manualment des de `main` o
espera el cicle horari següent. Comprova que el comentari del publicador diu
`Preview retirada.` i que l'origen ja no serveix la preview.
La comprovació del head SHA vigent es manté per a les noves publicacions.
Els fitxers rebuts però no instal·lats caduquen al cap d'un
dia. La reconciliació comença amb `mountain-preview cleanup-retired`, que
elimina directoris de retirades interrompudes, i `mountain-preview
site-reconcile`, que elimina blocs Caddy sense versió activa i reinicia Caddy.
`mountain-preview prune <n>` esborra versions anteriors, directoris d'una
instal·lació interrompuda i fitxers rebuts ja utilitzats. Si una entrada de
l'inventari falla, la reconciliació continua amb les altres previews i acaba
fent fallar el job amb la llista d'incidències. Un namespace danyat, on
`current` i el registre no concorden, es retira abans de continuar perquè
se'n revisi la causa. La comanda `mountain-preview` rebutja un sisè origen
actiu. La marca visual `PUBLIC_PREVIEW` és part del build i una PR maliciosa la
pot ocultar (esmena de l'ADR 0009): cal revisar el contingut abans
d'autoritzar-lo.

Per revocar immediatament una preview d'una PR oberta, la persona mantenidora
afegeix l'etiqueta `preview-revoked` a GitHub. El workflow de neteja reacciona
a l'esdeveniment i la reconciliació horària ho torna a comprovar; el publicador
rebutja qualsevol nova activació mentre l'etiqueta hi sigui. Per reprendre la
publicació, treu `preview-revoked` i comprova que la PR té `preview`. Fes un
push nou o executa `Preview` manualment des de `main` amb el número de PR.
Si GitHub o el workflow fallen, cal suspendre les previews i
executar la retirada pel canal administratiu aprovat; no editar releases a mà.

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
  duplicades. En un VPS ja actiu, segueix el procediment preview-only de
  [«Instal·lació En Un VPS Ja Actiu»](#installació-en-un-vps-ja-actiu-preview-only);
  no tornis a executar el bootstrap complet.
- La publicació és atòmica: l'install extrau en un directori nou i l'activació
  mou el symlink `current` del namespace de manera atòmica; un error conserva
  la versió anterior de la mateixa PR o no crea cap origen.

La T6.4 crea els orígens Caddy (blocs per PR, TLS individual, identificació
de no-producció, caché i política de capçaleres) i el cicle de vida complet;
la T6.5 va validar el sistema end-to-end al VPS.

## Com s'opera

### Usuari i directori de previews

| Element          | Què és                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `preview-deploy` | Usuari de sistema amb accés SSH limitat a la comanda `preview-ssh-gate`; clau amb `command="preview-ssh-gate"` i `restrict` |
| Directori per PR | `/var/lib/mountain-runners-previews/namespaces/pr-<n>/`; tots comparteixen l'usuari `preview-deploy`                        |

La identitat de previews executa les operacions de releases directament com a
`preview-deploy`. És propietària de `namespaces/` i dels directoris de totes
les PR que hi crea; no hi ha comptes ni permisos independents per PR.
L'autorització signada i els canvis dels blocs Caddy passen pel procés
`mountain-preview-site` mitjançant un socket restringit al grup de previews.
L'ACL `u:preview-deploy:---` a
`/var/lib/mountain-runners` impedeix llegir i travessar
les releases de producció, tot i que el mode UNIX segueix sent `0755` perquè
Caddy i `mountain-deploy` conservin l'accés existent. La identitat no pot
escriure a `/etc/caddy`, les claus TLS o l'estat ACME, i no pertany al grup
`mountain-runners`. No li concedeixis accés a `/run/mountain-release.sock` ni
afegeixis-la a grups de producció.

### Publicar una preview

Obrir una PR no inicia el workflow `Preview`. Un comentari `/preview` tampoc.

1. Per demanar una preview, posa l'**etiqueta `preview`** a una PR oberta del
   repositori principal. Cal permís `write` o `admin`. L'agent de la fase 8
   posa l'etiqueta quan crea la PR d'un tema. Mentre la PR té l'etiqueta, els
   pushes d'actors amb escriptura publiquen el cap nou. Per reintentar una
   publicació, conserva `preview`, comprova que no hi ha `preview-revoked` i
   executa `Preview` manualment des de `main` amb el número de PR.
2. El job `authorize` (codi de confiança des de la branca per defecte)
   comprova els permisos de l'actor i l'estat de la PR i resol el SHA vigent.
   Un push a una PR sense `preview` no executa cap build. Si el reintent manual
   no compleix els requisits, falla abans del build i no publica res.
3. El job `build` (no fiable, sense secrets ni caches) fa checkout del commit
   vigent de la PR, executa `pnpm validate` complet i compila l'artefacte amb
   l'origen `pr-<n>.preview.mountainrunners.cat`; el job `publish` valida manifest,
   mida, fitxers, digests i paths amb els validadors de producció i
   revalida que la PR continua oberta i al mateix commit, amb `preview` i sense
   `preview-revoked`, i que l'actor conserva `write` o `admin`. El publicador
   signa l'autorització amb la clau privada exclusiva del job de confiança.
   El procés `mountain-preview-site`
   verifica la signatura amb la clau pública del VPS abans de registrar-la.
   La clau SSH de previews per si sola no pot autoritzar una release. El
   procés valida el Caddyfile abans de reiniciar Caddy per configurar l'origen.
   El publicador torna a comprovar la PR i l'autorització just abans d'activar
   la versió instal·lada al directori de la PR.
   Després de comprovar la salut i el smoke, torna a validar la PR i actualitza
   el seu comentari amb l'URL i el SHA publicats. Si el job falla escrivint el
   comentari, la preview pot continuar activa: comprova `list` i `health` abans
   de reexecutar el workflow. El build no fiable no pot escriure comentaris.
4. Verificació posterior a l'activació:

   ```sh
   sudo mountain-preview list <n>     # registre del namespace
   sudo mountain-preview health <n>   # registre + digests del build actiu
   ```

### Política d'Actions de `pull_request_target` per a les previews

Des del 2 de desembre de 2026 GitHub Actions bloqueja `pull_request_target`
per defecte als repositoris públics, tret que una política d'esdeveniments
aplicable el permeti
([canvi de GitHub](https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2),
[guia](https://docs.github.com/actions/how-tos/administer/control-workflow-execution),
[API REST](https://docs.github.com/en/rest/actions/policies)). El 22 de
novembre de 2026 la persona mantenidora va crear aquesta política del
repositori:

- Nom: `Allow pull_request_target for preview workflows`, id 16808, aplicació
  `active`.
- Workflows: `.github/workflows/preview.yml` i
  `.github/workflows/preview-cleanup.yml`.
- Regla `restrict_action_events` amb els esdeveniments `pull_request_target`,
  `issue_comment`, `workflow_dispatch` i `schedule`.

La regla és una llista de permesos per a aquests dos workflows: tot esdeveniment
que usin hi ha de constar. Cal afegir-hi qualsevol esdeveniment nou abans
de fusionar el canvi del workflow. Encara no s'ha provat amb una execució
bloquejada.

Després de fusionar la [T1 de la retirada de `/preview`](../specs/retire-preview-command.md#t1-retirada-de-preview-al-publicador),
treu `issue_comment` de la política només amb l'aprovació explícita de la persona
mantenidora. Conserva `pull_request_target`, `workflow_dispatch` i `schedule`.

Per comprovar-la:

```sh
gh api -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/rboixaderg/mountain-runners/actions/policies/16808
```

Si falta o no coincideix, les execucions afectades poden quedar bloquejades.
El bloqueig per defecte de `pull_request_target` impedeix publicar amb
l'etiqueta i activar la neteja en tancar la PR, revocar la preview o treure
l'etiqueta; no bloqueja per si sol els altres disparadors. Per recrear la
política, a Settings → Actions → Policies, o amb el `POST` de l'API REST de
polítiques amb els esdeveniments vigents. Només amb l'aprovació explícita de la
persona mantenidora.

### Instal·lació En Un VPS Ja Actiu (preview-only)

La instal·lació s'ha de fer per una persona mantenidora, des d'un checkout
revisat de la branca desplegada. No executis `bootstrap.sh` ni cap ordre de
`tools/deploy/`. El gate reutilitza les eines de release planes mitjançant un
symlink root-owned `release -> .`, sense duplicar mòduls. No substitueixis un
directori o symlink `release` existent: atura't i revisa'l abans de migrar.

```sh
REPO=/path/to/reviewed/mountain_runners
LIB=/usr/local/lib/mountain-runners

sudo install -d -o root -g root -m 0755 "$LIB"
if sudo test -L "$LIB/release"; then
  test "$(sudo readlink "$LIB/release")" = . || {
    echo "Unexpected release symlink; stop and inspect." >&2
    exit 1
  }
elif sudo test -e "$LIB/release"; then
  echo "Existing release path is not a symlink; stop and inspect." >&2
  exit 1
else
  sudo ln -s . "$LIB/release"
fi
sudo chown -h root:root "$LIB/release"
sudo install -d -o root -g root -m 0755 \
  "$LIB/preview" \
  "$LIB/preview/commands" \
  "$LIB/preview/commands/mountain-preview" \
  "$LIB/preview/processes" \
  "$LIB/preview/processes/mountain-preview-site" \
  "$LIB/preview/processes/preview-authorization"
sudo install -o root -g root -m 0644 \
  "$REPO/tools/server/preview/config.mjs" \
  "$REPO/tools/server/preview/authorization-proof.mjs" \
  "$LIB/preview/"
sudo install -o root -g root -m 0644 \
  "$REPO/tools/server/preview/commands/mountain-preview/cli.mjs" \
  "$REPO/tools/server/preview/commands/mountain-preview/site-request.mjs" \
  "$REPO/tools/server/preview/commands/mountain-preview/capacity.mjs" \
  "$REPO/tools/server/preview/commands/mountain-preview/inventory.mjs" \
  "$REPO/tools/server/preview/commands/mountain-preview/prune.mjs" \
  "$REPO/tools/server/preview/commands/mountain-preview/retire.mjs" \
  "$LIB/preview/commands/mountain-preview/"
sudo install -o root -g root -m 0644 \
  "$REPO/tools/server/preview/processes/mountain-preview-site/main.mjs" \
  "$REPO/tools/server/preview/processes/mountain-preview-site/caddy.mjs" \
  "$REPO/tools/server/preview/processes/mountain-preview-site/caddy-fragment.mjs" \
  "$LIB/preview/processes/mountain-preview-site/"
sudo install -o root -g root -m 0644 \
  "$REPO/tools/server/preview/processes/preview-authorization/main.mjs" \
  "$LIB/preview/processes/preview-authorization/"
sudo chmod 0755 "$LIB/preview/commands/mountain-preview/cli.mjs" "$LIB/preview/processes/mountain-preview-site/main.mjs"
sudo ln -s "$LIB/preview/commands/mountain-preview/cli.mjs" /usr/local/bin/mountain-preview
sudo ln -s "$LIB/preview/commands/mountain-preview/cli.mjs" /usr/local/bin/preview-ssh-gate
```

La identitat SSH, el shell forçat i els namespaces no es creen amb aquestes
ordres. Provisiona'ls seguint com a referència només el bloc T6.3 de
`tools/server/bootstrap/bootstrap.sh`; no executis el script. Si `preview-deploy`
ja existeix, revisa'n grup, shell, estat de contrasenya i claus abans de
modificar-ne res. No canviïs la contrasenya ni reemplaçis
`/var/lib/mountain-runners-previews/.ssh/authorized_keys`; afegeix la clau
revisada amb forced command després de revisar el fitxer existent. La identitat
no ha de pertànyer a `mountain-runners` ni accedir a
`/run/mountain-release.sock`. La configuració d'origen, TLS i Caddy continua
fora de T6.3.

### Instal·lació al VPS existent (només amb aprovació)

La persona mantenidora instal·la els mòduls nous de `tools/server/preview/`
com a `root:root` a `/usr/local/lib/mountain-runners/preview/`, conservant les
subcarpetes `commands/mountain-preview/`, `processes/mountain-preview-site/` i
`processes/preview-authorization/`, i el servei
`tools/server/systemd/mountain-preview-site.service` a
`/etc/systemd/system/`, substituint el GID `0` de la plantilla pel GID real
del grup `preview-deploy` i l'UID `0` per l'UID de l'usuari `preview-deploy`.
La unitat munta `/var/log/mountain-runners` i
`/var/log/mountain-runners-previews` com a `TemporaryFileSystem=` privats:
`caddy validate` obre els logs que declara el Caddyfile, i sense aquests
muntatges falla amb `read-only file system` per `ProtectSystem=strict`. El
procés no escriu mai als logs reals de Caddy.
Si ja hi ha una instal·lació de T6.3, la persona mantenidora actualitza els
enllaços `/usr/local/bin/mountain-preview` i `/usr/local/bin/preview-ssh-gate`
perquè tots dos apuntin a
`/usr/local/lib/mountain-runners/preview/commands/mountain-preview/cli.mjs`.
Comprova també que la unitat `mountain-preview-site.service` engega
`/usr/local/lib/mountain-runners/preview/processes/mountain-preview-site/main.mjs` abans de
reprendre cap publicació; els fitxers antics al directori `preview/` no són els
punts d'entrada nous.
Instal·la la clau pública de signatura a
`/etc/mountain-runners/preview-auth.pub` com a `root:root` mode `0644`, i
configura `PREVIEW_AUTH_PRIVATE_KEY` només com a secret de l'entorn GitHub
`previews`; la clau privada no s'instal·la al VPS ni es desa al repositori.
La persona mantenidora genera el parell fora del repositori i comprova que
el procés `mountain-preview-site` rebutja una signatura absent o invàlida
abans de publicar res.
Crea `/var/log/mountain-runners-previews/` com a
`caddy:caddy` mode `0700` amb `access.log` com a `caddy:caddy` mode `0600`
abans de validar Caddy. Instal·la el drop-in revisat
`tools/server/systemd/caddy-mountain-runners.conf`, que autoritza aquesta
ruta de logs al sandbox de Caddy, i `/etc/caddy/Caddyfile.previews` buit com a
`root:root` mode `0644`. Afegeix només `import Caddyfile.previews` al final del
`Caddyfile` vigent i instal·la `tools/server/caddy/preview-robots/robots.txt`
a `/etc/caddy/preview-robots/robots.txt` com a `root:root` mode `0644`.
No substitueix els blocs de producció ni toca les seves credencials; no
reexecuta el bootstrap sobre el VPS actiu. El bootstrap tampoc no sobreescriu
un `/etc/caddy/Caddyfile.previews` que ja existeix, de manera que una reexecució
no despublica els orígens actius, però la instal·lació manual segueix sent la
via aprovada.
Valida **tot** `/etc/caddy/Caddyfile` abans de reiniciar Caddy; després
comprova producció. Recarrega systemd i activa el servei
`mountain-preview-site`, que executa el procés com a `root`, amb el
socket `/run/mountain-preview-site.sock` mode `0660`, grup `preview-deploy`.
La unitat manté `/var/lib` en mode només lectura excepte
`/var/lib/mountain-runners-previews/namespaces`: el procés fill
`preview-authorization` necessita escriure el registre i el fitxer de bloqueig
d'una PR com a `preview-deploy`. La validació de la T6.5 va comprovar amb una
autorització signada que el registre de la PR s'actualitza sota el servei real
de `systemd`; els tests locals no reprodueixen aquest sandbox.
En un VPS nou, no obris el sistema a previews de revisió fins que la prova TLS
contra l'staging de Let's Encrypt, la retirada, la reconciliació, els logs i els
smoke tests passin. La primera preview de prova requereix aprovació explícita i
retirada immediata en acabar la validació.
Si falla la validació, restaura la configuració anterior i no reinicia Caddy.
Si falla el reinici o el smoke de producció, restaura el fragment anterior,
reinicia i suspèn les previews; no edita cap release de producció.

L'entorn GitHub `previews` només separa els secrets de producció: no té
required reviewers. El publicador exigeix `preview` i permís `write` o `admin`.
Els secrets de previews (`PREVIEW_SSH_PRIVATE_KEY`, `PREVIEW_KNOWN_HOSTS`,
`PREVIEW_AUTH_PRIVATE_KEY`) viuen
només a l'entorn `previews`, mai compartits amb producció. El risc residual
acceptat és que una persona amb escriptura al repositori pot demanar la
publicació de contingut no fiable d'una PR pròpia. El publicador rebutja
forks, PR tancades i caps que han canviat.

Els canvis de Caddy dels previews requereixen validació completa abans de
reiniciar i comprovació de producció després. Els blocs de lloc i els logs
estan separats, però el procés i el magatzem ACME són compartits; una fallada
del procés, del magatzem o del reinici pot afectar producció. Si passa, cal
aturar l'activació de previews i revisar l'ADR 0010. El DNS de producció i
les credencials de desplegament continuen fora de l'abast dels previews.

### Actualitzar les eines

L'actualització de les eines de release instal·la també el `cli.mjs` de
previews. El procediment és a
[`web-and-releases.md`](web-and-releases.md#actualitzar-les-eines-en-un-vps-existent).
