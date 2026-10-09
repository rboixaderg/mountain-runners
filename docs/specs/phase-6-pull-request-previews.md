# Especificació De La Fase 6: Previews De Pull Request I Estratègia DNS/Edge

## Estat

En implementació. La dependència inicial era producció estable i operable segons
l'acceptació de la fase 5. El workflow `Preview` ja ha publicat previews
autoritzades de la PR #140; això no declara completada la fase ni substitueix
els criteris de tancament i les revisions de cada tasca.

## Objectiu

Esmena del 2 d'octubre de 2026: l'[ADR 0011](../decisions/0011-news-blog-editorial-previews.md)
i l'[especificació de notícies i blog](news-and-blog.md) autoritzen una excepció
posterior per mostrar esborranys de `posts` en preview, amb estat explícit.
Les exclusions de contingut despublicat d'aquest document es mantenen per a
totes les altres col·leccions. La PR #140 implementa aquesta excepció i continua
pendent de revisió i merge. No canvia la infraestructura ni els requisits de
confiança de la fase 6.

Decidir i implementar un sistema de previews de pull request aïllat, efímer i
segur que permeti revisar la web abans del merge sense exposar secrets, permisos
de producció ni contingut despublicat.

La fase reavalua si cal Cloudflare, un wildcard DNS, certificats wildcard o una
alternativa més simple. Cloudflare és una opció a comparar, no una decisió presa.

## Límits I Decisions Confirmades

- Els previews no són una dependència del desplegament ni de l'operació de
  producció establerts a la fase 5.
- Producció i preview reben artefactes diferents perquè tenen orígens diferents.
  Un artefacte de preview no es promociona mai a producció.
- El codi d'una PR i d'un fork es tracta com a contingut actiu no fiable. El job
  que el compila utilitza un runner efímer i aïllat i no rep secrets, caches
  compartides amb contextos de confiança ni permisos d'escriptura sobre
  infraestructura persistent.
- La publicació la fa un context de confiança amb codi fixat des de `main`, que
  verifica l'artefacte sense executar scripts ni fer checkout de la PR.
- Cap artefacte es publica només perquè s'hagi obert o actualitzat una PR. La
  publicació requereix autorització explícita d'una persona mantenidora i es
  limita a branques del repositori principal: els forks i les contribucions
  externes no tenen cap preview, ni automàtica ni autoritzada, i les previews
  mostren una identificació de no-producció en el layout del build; l'ADR 0009
  esmenat a la T6.4 accepta que una PR maliciosa la pot ocultar.
- Cada preview utilitza un origen únic sota `*.preview.mountainrunners.cat`, el
  mateix domini registrable de producció, amb els controls compensatoris de
  l'ADR 0009, exclou el contingut marcat `published: false` en el build
  ordinari, declara `noindex, noarchive` i té caducitat i neteja definides. El
  manifest no es considera prova suficient que HTML arbitrari d'una PR sigui
  segur o publicable.
- La fase no pressuposa que calgui traslladar els nameservers de Hostinger. T6.1
  compara opcions i T6.2 aprova la mínima arquitectura que satisfà els requisits.
- L'adopció de Cloudflare com a proxy, capa d'accés o frontera permanent de
  confiança requereix una decisió explícita de seguretat, privacitat, cost,
  reversió i responsabilitat. T6.2 determina si també cal un ADR.
- La fase 6 no pot compartir credencials, zona DNS amb permís d'escriptura,
  paths de releases, caches, cookies ni namespaces amb producció. L'única
  excepció és el magatzem ACME global del procés Caddy compartit (ADR 0010),
  inaccessible a la identitat de previews.
- Cap agent o sessió local pot publicar o conservar una preview fora del workflow
  aprovat.

## Resultats Esperats

- Requisits i model d'amenaces aprovats abans de triar proveïdor o topologia.
- Comparativa reproduïble de les opcions DNS, TLS, hosting, accés i neteja,
  inclosa l'opció de no utilitzar Cloudflare.
- Decisió traçable sobre dominis, certificats, publicador, visibilitat, retenció,
  cost i responsabilitats.
- Preview aïllada per PR com a subdomini de `*.preview.mountainrunners.cat`
  segons l'ADR 0009, vinculada al commit, amb canonical del seu origen, accés
  aprovat i identificació de no-producció.
- Publicador de confiança que valida manifest, digests i arxiu abans d'escriure
  només al namespace assignat.
- Caducitat, retirada en tancar la PR, revocació i runbook verificats.
- Comentari idempotent del publicador de confiança a la PR amb l'URL i el SHA
  de la preview activada correctament.

## Dependències I Ordre D'Inici

La fase depèn de la fase 5 completada perquè reutilitza el contracte d'artefacte,
les convencions de Caddy i l'experiència operativa sense modificar producció.
T6.1 fixa requisits i amenaces. T6.2 pren la decisió d'arquitectura. T6.3 adapta
el build i crea la frontera de publicació. T6.4 implementa DNS, TLS, cicle de vida
i accés segons la decisió. T6.6 notifica una activació correcta a la PR. T6.7
esmena el contracte CLI de la T6.4 perquè les consultes siguin pures abans
d'instal·lar-lo al VPS. T6.5 valida el sistema complet i tanca el runbook.

Cada tasca s'implementa en un worktree i una branca propis des de l'últim
`main`. Qualsevol alta de servei, canvi de nameservers, DNS, secrets, repositori o
VPS requereix aprovació explícita de la persona mantenidora.

## Tasques, Entregues I Seguiment

| Unitat                                       | Estat      | Dependències | Resultat verificable                          | PR      |
| -------------------------------------------- | ---------- | ------------ | --------------------------------------------- | ------- |
| T6.1 Requisits, amenaces i alternatives      | Completada | Fase 5       | Comparativa i riscos aprovats                 | PR #113 |
| T6.2 Decisió de domini, DNS, TLS i proveïdor | Completada | T6.1         | Arquitectura mínima decidida                  | PR #117 |
| T6.3 Artefacte i publicador de confiança     | Completada | T6.2         | Frontera segura sense executar codi no fiable | PR #121 |
| T6.4 Cicle de vida, aïllament i neteja       | Pendent    | T6.3         | Orígens efímers creats i retirats             | -       |
| T6.6 Notificació de preview a la PR          | Pendent    | T6.4         | URL i SHA comunicats després d'activar        | -       |
| T6.7 Contracte de consulta i escriptura      | En curs    | T6.4         | CLI amb consultes pures i verbs explícits     | PR #136 |
| T6.5 Validació de previews i operació        | Pendent    | T6.6, T6.7   | Gate i runbook verificats                     | -       |

### T6.1: Requisits, Amenaces I Alternatives

**Abast:** definir qui necessita previews, visibilitat pública, restringida o
autenticada, autorització prèvia per publicar, suport per a forks, volum esperat,
durada, cost, origen de les previews (domini registrable separat o no),
canonical, identificació visual, logs,
responsabilitats i criteris de neteja; modelar codi de PR, artefactes, runner,
caches, publicador, DNS, TLS, navegador i servidor com a fronteres diferenciades;
comparar Hostinger DNS, Caddy, Cloudflare i serveis externs. **Exclusió:** no
crea comptes, zones, registres, certificats ni secrets. **Depèn de:** fase 5.
**Resultat:** requisits observables, alternatives comparables i riscos sense
decisions implícites. **Comprovació:** revisió de seguretat, privacitat,
operació, cost i reversibilitat. **PR:** pròpia.

### T6.2: Decisió De Domini, DNS, TLS I Proveïdor

**Abast:** escollir la mínima solució que compleix T6.1 i documentar subdomini,
wildcard DNS o registres per PR, TLS individual o wildcard, allotjament, proxy,
autenticació, API necessàries, límits, costos, responsable i pla de sortida.
L'ADR 0009 fixa la frontera: origen sota `*.preview.mountainrunners.cat` amb
controls compensatoris i publicació restringida a branques pròpies, sense segon
domini ni servei extern de previews. Dins d'aquest límit ha de comparar com a
mínim: una subzona DNS delegada amb credencial pròpia; registres per PR a la
zona de previews; certificats individuals gestionats per Caddy; wildcard TLS amb
DNS-01; i la comprovació que cap credencial toca la zona de producció.
**Exclusió:** no implementa encara el
publicador ni migra la zona només per conveniència. **Depèn de:** T6.1.
**Resultat:** decisió aprovada, ADR si
introdueix o canvia una frontera arquitectònica, i cap dependència no
justificada. **Comprovació:** prova limitada sense dades ni secrets de producció,
revisió de quotes, rate limits, privacitat, fallada i reversió. **PR:** pròpia.

### T6.3: Artefacte I Publicador De Confiança

**Abast:** adaptar el contracte de la fase 5 perquè el job no fiable construeixi
amb l'origen exacte de la preview, manifesti commit, PR, origen, data i digests i
publiqui només un artefacte intermedi; implementar un publicador de confiança
fixat a `main` que no executa codi de la PR, valida l'arxiu i escriu només al
namespace assignat. El publicador obté de metadades de confiança el repositori,
workflow, run, artefacte, esdeveniment, número de PR i SHA del head; immediatament
abans d'activar comprova que la PR continua oberta, autoritzada i al mateix SHA.
**Exclusió:** no utilitza `pull_request_target` per executar codi o scripts de la
PR, no comparteix secrets de producció i no promociona
l'artefacte. **Depèn de:** T6.2. **Resultat:** frontera verificable entre build no
fiable i publicació. **Comprovació:** fork sense secrets, commit i origen
incorrectes, digest invàlid, arxiu absolut, `..`, symlinks, tipus inesperats,
fitxers duplicats i contingut despublicat. **PR:** pròpia.

### T6.4: Cicle De Vida, Aïllament I Neteja

**Abast:** crear l'origen segons T6.2, aplicar TLS, headers de robots, CSP,
identificació de no-producció al layout i política de caché, aïllar cookies i
storage, registrar propietat, autorització i caducitat, actualitzar una PR sense
deixar releases òrfenes i retirar la preview en tancar o revocar la PR.
**Exclusió:** no modifica l'origen, els secrets, els fitxers ni el
workflow de producció. **Depèn de:** T6.3. **Resultat:** cicle complet de creació,
actualització, expiració i eliminació. **Comprovació:** dues PR simultànies,
reexecució, PR tancada o reoberta, job cancel·lat, quota exhaurida, certificat o
DNS fallit, expiració i neteja idempotent. **PR:** pròpia.

### T6.6: Notificació De Preview A La PR

**Abast:** el publicador de confiança, fixat a `main`, crea o actualitza el seu
únic comentari amb marcador fix a la PR, amb l'URL de l'origen activat i el SHA
que ha publicat, només després d'activar-lo correctament i de revalidar PR
oberta, autoritzada i amb el mateix SHA. **Exclusió:** no escriu comentaris el
build no fiable, no usa cap dada controlada per la PR, no afegeix comandaments
de comentari ni altera autorització, activació, DNS o producció. **Depèn de:**
T6.4. **Resultat:** la persona revisora rep la URL efectiva sense comentaris
duplicats en reexecucions. **Comprovació:** provar que no hi ha comentari si
l'activació falla o la PR és de fork, tancada, revocada o té un SHA obsolet; que
l'URL i el SHA són correctes després d'activar, i que la reexecució només
actualitza el comentari existent creat pel publicador amb el marcador fix.
**PR:** pròpia.

### T6.7: Contracte De Consulta I Escriptura

**Abast:** esmena de la T6.4 detectada en preparar l'activació de la T6.5:
`inventory`, `list` i `health` modificaven l'estat. Fer-les pures, afegir
`cleanup-retired` per a les retirades interrompudes, reanomenar `site-sync` a
`site-reconcile` sense àlies (el sistema no s'ha activat mai), tolerar
`namespaces/` absent a l'inventari, adaptar `tools/preview/reconcile.mjs` i
classificar cada ordre a `docs/deployment.md` i `docs/runbook.md`.
**Exclusió:** no canvia l'autenticació, l'autorització signada, el format del
registre, la política de retenció ni cap frontera de l'ADR 0009 o de l'ADR 0010;
no executa la T6.5. **Depèn de:** T6.4. **Resultat:** el nom de cada ordre
descriu el seu efecte i la reconciliació horària usa el nou contracte.
**Comprovació:** `pnpm test:server`, `prettier --check` i `eslint` sobre els
fitxers tocats. **PR:** pròpia.

### T6.5: Validació De Previews I Operació

**Abast:** validar previews pròpies, navegació i metadades en els tres
idiomes, autorització i visibilitat acordades, absència de secrets, comportament
ordinari de `published: false`, identificació de no-producció, expiració, logs,
alertes, revocació i runbook; verificar que una fallada del sistema de previews
no afecta producció. **Exclusió:** no converteix la preview en staging de
producció ni introdueix analítica. **Depèn de:** T6.6 i T6.7. **Resultat:** sistema
operable i responsabilitats acceptades. **Comprovació:** `pnpm validate`, smoke
de preview, `noindex, noarchive`, canonical, headers, cap publicació de fork,
invariant de cookies de producció (ADR 0009), neteja, fallada del proveïdor i
producció inalterada. **PR:** pròpia i darrera de la fase.

## Alternatives I Porta De Decisió

T6.1 i T6.2 no parteixen d'una preferència de proveïdor. La comparativa registra
per cada opció:

- control i automatització de DNS, inclosos wildcards i TTL;
- mecanisme TLS, renovació, quotes i límits d'emissió;
- aïllament d'origen, cookies, storage, caché i CSP;
- tractament de forks i separació entre build no fiable i publicador;
- origen de previews dins del límit de l'ADR 0009, autorització i identificació
  de no-producció;
- autenticació opcional sense donar credencials al build;
- costos fixos i variables, límits i dependència del proveïdor;
- camps i retenció de logs, ubicació i tractament de dades;
- neteja, recuperació de fallades i pla de sortida;
- impacte sobre Hostinger, Hetzner, Caddy i producció.

Un wildcard DNS no implica necessàriament un certificat wildcard ni l'ús de
Cloudflare. La decisió ha de justificar per separat resolució DNS, emissió TLS,
proxy, autenticació i hosting. Si una solució amb menys fronteres satisfà els
requisits, es prefereix a una migració completa de la zona.

## Artefacte I Frontera De Publicació

El build no fiable només disposa del codi de la PR i permisos de lectura.
S'executa en un runner efímer que es destrueix en acabar, no desa caches i no pot
escriure en cap cache que després restauri un job de `main`, del publicador o de
producció. Genera un artefacte per a l'origen assignat, sense secrets. El build
ordinari manté l'exclusió de `published: false`, però el resultat complet es
tracta com a contingut actiu controlat per la PR: ni els seus tests ni el seu
manifest proven que HTML arbitrari sigui editorialment publicable. L'artefacte
no conté credencials, tokens, configuració del publicador ni dades privades.

El publicador s'executa amb codi de confiança versionat a `main`. No fa checkout
de la PR, no executa hooks, scripts o binaris de l'arxiu i no interpreta fitxers
com a configuració. Verifica amb metadades de plataforma de confiança repositori,
workflow, run, artefacte, esdeveniment, PR, SHA i conclusió; després valida
manifest, mida, nombre de fitxers, digests i paths abans d'extreure en un
directori nou del namespace autoritzat. Revalida l'estat, l'autorització i el
head SHA de la PR immediatament abans de l'activació.

La publicació és atòmica. Un error conserva la versió anterior de la mateixa PR
o no crea cap origen. Cap identitat de preview pot llegir o escriure releases,
configuració, claus TLS, estat ACME o secrets de producció.

## Dominis, TLS I Robots

Cada preview té un origen únic i estable per al commit o la PR segons la decisió
de T6.2, com a subdomini de `*.preview.mountainrunners.cat`, el mateix domini
registrable de producció (ADR 0009). L'aïllament d'origen (cookies, storage,
document) el dona l'origen propi; la frontera _same-site_ queda acceptada amb
els controls compensatoris de l'ADR 0009: publicació restringida a branques
pròpies, producció sense cookies i, si en guanyés cap, sempre `__Host-` o
`__Secure-`, host-only i sense atribut `Domain`, de manera que contingut d'una
preview no pugui definir ni sobreescriure cookies del lloc públic. Si
s'utilitza un wildcard, es limita al prefix `preview.` de la zona de producció
(esmena de l'ADR 0009 a la T6.2). Qualsevol
autenticació utilitza cookies host-only amb prefix `__Host-` i es prova contra
accés creuat entre previews.

Totes les respostes HTML i els recursos tècnics aplicables declaren
`X-Robots-Tag: noindex, nofollow, noarchive`; el `robots.txt` de preview bloqueja
el rastreig sense considerar-lo l'única protecció. Si la política exigeix accés
restringit, l'autenticació s'aplica abans de servir l'artefacte i no s'injecta al
build estàtic.

La solució TLS documenta emissió, renovació, quotes i fallades. Els previews
no automatitzen el DNS i no disposen de cap credencial DNS (esmena de l'ADR
0009 a la T6.2): els registres de previews són el wildcard manual creat per la
persona mantenidora a la zona de producció. Si algun dia calgués automatitzar
el DNS, es reobriria la decisió amb un ADR; qualsevol credencial llavors només
podria modificar una zona separada o una subzona delegada de previews i mai la
zona que conté l'apex, `www`, MX o polítiques de correu de producció. No
s'exposa cap API global del registrador o de producció al job de build.

## Cicle De Vida I Operació

Cada origen registra PR, commit, moment de creació, última actualització,
autorització, caducitat i estat. El publicador rebutja una execució obsoleta o
una PR tancada, revocada o amb un head SHA diferent. El tancament, merge o
revocació inicia la retirada. Una reconciliació periòdica detecta i elimina
namespaces orfes sense confiar només
en un únic esdeveniment de GitHub.

Un canvi del head SHA de la branca no retira una preview ja publicada ni
en renova la caducitat. La preview continua servint el commit autoritzat
fins que es demana una nova publicació o es compleix un criteri de retirada.
La comprovació del head SHA vigent s'aplica a les noves publicacions,
no a la conservació de la preview existent durant la reconciliació.

La retenció per defecte és la mínima necessària per revisar la PR i es confirma
a T6.1. Els logs no desen query strings, cookies, capçaleres d'autorització ni
contingut dels artefactes. El runbook cobreix quota, certificats, DNS, neteja,
revocació i desactivació completa del sistema sense afectar producció.

### Contracte De `mountain-preview`

El nom de cada ordre descriu el seu efecte (T6.7):

- Consulta: `inventory`, `list <n>` i `health <n>` només llegeixen. No creen
  fitxers ni directoris, no prenen el bloqueig de capacitat, no esborren res i
  mai fallen per límit de capacitat. `inventory` retorna `[]` si `namespaces/`
  no existeix; `health` d'un namespace absent és `DEGRADED`.
- Escriptura: `receive`, `install`, `authorize`, `activate`, `retire`, `prune`,
  `cleanup-retired` (elimina `.retired-pr-<n>-<uuid>`), `site-enable`,
  `site-disable` i `site-reconcile` (elimina blocs Caddy sense `current` i
  reinicia Caddy). Només `receive`, `install`, `authorize`, `activate` i
  `prune` passen per la comprovació de capacitat i creen el namespace.
- La reconciliació executa `cleanup-retired`, `site-reconcile` i `inventory`,
  i després `retire`, `site-disable` o `prune` per a cada entrada.

## Estratègia De Tests I Qualitat

- Reutilitzar el contracte de build de la fase 5 amb origen de preview explícit.
- Executar `pnpm validate` en el context no fiable abans de publicar l'artefacte.
- Provar casos negatius de manifest, digest, mida, paths, symlinks, tipus de
  fitxer i contingut despublicat.
- Verificar que forks i PRs no reben secrets ni permisos d'escriptura.
- Verificar runner efímer, absència de cache compartida i rebuig de publicació
  sense autorització o amb PR/SHA obsolets.
- Cobrir canonical, `hreflang`, sitemap o la política que el substitueixi,
  robots, recursos i navegació representativa en `ca`, `es` i `en`.
- Provar creació, actualització, concurrència, cancel·lació, expiració, tancament,
  reobertura, revocació i reconciliació d'orfes.
- Verificar que el publicador comenta l'URL i SHA correctes només després d'una
  activació reeixida i que la reexecució només actualitza el comentari del
  publicador amb marcador fix, sense generar-ne duplicats.
- Provar que les consultes de `mountain-preview` no esperen el bloqueig de
  capacitat ni creen el namespace, que `cleanup-retired` neteja el que
  `inventory` conserva, que el gate i el socket rebutgen `site-sync` i que la
  reconciliació respecta l'ordre del contracte.
- Validar l'origen sota `*.preview.mountainrunners.cat` dins dels controls de
  l'ADR 0009, TLS, headers, identificació de no-producció, caché, cookies
  `__Host-`, storage i autenticació si s'aplica.
- Verificar la invariant de cookies de producció de l'ADR 0009 amb una
  comprovació determinista que falla si qualsevol resposta de producció declara
  un `Set-Cookie` sense prefix `__Host-` o `__Secure-`.
- Simular indisponibilitat de DNS, TLS, hosting o proveïdor i demostrar que
  producció continua operativa en els casos provats. Una fallada del procés
  Caddy o de l'ACME compartit pot afectar-la (ADR 0010): si una prova detecta
  interrupció, aturar les previews i revisar-ne l'arquitectura.

## Seguretat I Privacitat

- Revisió de seguretat obligatòria a T6.1, T6.2 i abans d'activar el publicador.
- Permisos `read` per defecte i escriptura només al job i namespace mínims.
- Cap ús de `pull_request_target` per executar codi no fiable.
- Runner efímer i aïllat per al codi no fiable; no desa caches ni comparteix
  claus de cache amb jobs de confiança.
- Accions fixades per commit complet i dependències bloquejades pel lockfile.
- Secrets separats de producció, limitats per zona, host, path i operació, i
  absents d'arguments, URLs, artefactes i logs.
- Extracció segura que rebutja paths absoluts, `..`, symlinks, hardlinks,
  dispositius i tipus inesperats abans d'escriure.
- Aïllament d'origen entre preview i producció; la frontera _same-site_ queda
  acceptada amb els controls compensatoris de l'ADR 0009; no es confia només en
  `noindex` com a control d'accés.
- Autorització humana abans de publicar, cap preview per a forks i marca de
  no-producció en el layout amb el risc residual de l'ADR 0009 esmenat.
- Només el job de publicació de confiança té el permís mínim per escriure el
  comentari de preview; el build no fiable no té aquest permís ni dades que
  s'interpolin al comentari, i només pot actualitzar un comentari propi amb
  marcador fix.
- Credencial DNS sense permisos sobre la zona de producció o correu.
- Política explícita de visibilitat, logs, retenció, ubicació i responsable del
  proveïdor escollit.
- Revocació i desactivació provades sense accés manual ad hoc al servidor.

## Fora D'Abast

- Desplegament o reversió de producció, resolts a la fase 5.
- Migració obligatòria a Cloudflare o ús obligatori d'un wildcard.
- CDN, WAF, analítica o optimització de rendiment que no sigui necessària per als
  previews.
- Entorn de staging permanent o promoció d'una preview a producció.
- Execució de serveis dinàmics, bases de dades o APIs dins la preview.
- Xat públic i assistent editorial; només es deixa una preview consumible per
  fluxos futurs de pull request.
- Previews editorials destinades expressament a mostrar entrades marcades
  `published: false`, secrets o dades privades. El build ordinari continua
  excloent-les, sense presentar aquesta comprovació com a garantia contra HTML
  arbitrari controlat per una PR.

## Criteris D'Acceptació

La fase es considera completada quan:

1. Els requisits, amenaces, alternatives i responsabilitats estan aprovats abans
   d'adoptar serveis o aplicar canvis remots.
2. Les set unitats tenen PR pròpia revisada, validada i fusionada en ordre de
   dependències.
3. La decisió justifica l'opció triada dins del límit de l'ADR 0009 (origen sota
   `*.preview.mountainrunners.cat`, publicació restringida a branques pròpies,
   sense segon domini ni servei extern), i inclou cost, privacitat, reversió i
   ADR quan correspongui.
4. El build no fiable utilitza un runner efímer, no rep secrets ni permisos
   d'escriptura, no desa caches consumibles per jobs de confiança i el publicador
   no executa ni fa checkout del codi de la PR.
5. Cada preview requereix autorització, està vinculada a la PR i al seu head SHA
   vigent en el moment de publicar-la,
   utilitza l'origen correcte, queda identificada com a no-producció i no pot
   promocionar-se a producció; els forks i les contribucions externes no tenen
   cap preview.
6. Manifest, digests, límits i arxiu es verifiquen abans d'escriure en un
   namespace aïllat; els casos malformats són rebutjats sense publicació parcial.
7. La preview serveix TLS, canonical i headers aprovats des d'un subdomini propi
   de `mountainrunners.cat` segons l'ADR 0009, declara
   `noindex, nofollow, noarchive` i no comparteix cookies, storage, zona DNS
   editable ni credencials amb producció.
8. Crear, actualitzar, tancar, expirar, revocar i reconciliar previews funciona
   de manera idempotent i elimina recursos orfes.
9. Una PR de fork segueix la política aprovada sense exposar secrets, sense
   publicació automàtica i sense convertir un context privilegiat en executor de
   codi no fiable; una PR tancada, revocada o amb SHA obsolet no es pot activar.
10. Després d'activar correctament una preview, el publicador de confiança crea
    o actualitza el seu únic comentari amb marcador fix a la PR amb l'URL i SHA
    efectius; cap error, fork, tancament, revocació o SHA obsolet no en crea cap.
11. Les fallades simulades de DNS, TLS, hosting, neteja o proveïdor de previews
    no modifiquen ni interrompen producció; el risc residual del procés i del
    magatzem ACME compartits queda acceptat a l'ADR 0010 i qualsevol
    interrupció observada obliga a aturar les previews i revisar la decisió.
12. El runbook descriu publicació, accés, quota, logs, renovació TLS, neteja,
    revocació, incidències i desactivació completa amb responsables verificats.
13. Les ordres de consulta de `mountain-preview` no modifiquen cap estat i tota
    mutació té un verb explícit, documentat com a escriptura.
