# Especificació De La Fase 6: Previews De Pull Request I Estratègia DNS/Edge

## Estat

Planificada després de completar la fase 5. No comença cap tasca, no s'adopta cap
proveïdor, no es migra el DNS i no es publica cap preview fins que producció sigui
estable i operable segons l'acceptació de la fase 5.

## Objectiu

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
  publicació requereix autorització explícita d'una persona mantenidora; els
  forks i contribucions externes queden restringits per defecte i mostren una
  identificació inequívoca de no-producció servida per la capa de confiança.
- Cada preview utilitza un origen en un domini registrable diferent de producció,
  exclou el contingut marcat `published: false` en el build ordinari, declara
  `noindex, noarchive` i té caducitat i neteja definides. El manifest no es
  considera prova suficient que HTML arbitrari d'una PR sigui segur o publicable.
- La fase no pressuposa que calgui traslladar els nameservers de Hostinger. T6.1
  compara opcions i T6.2 aprova la mínima arquitectura que satisfà els requisits.
- L'adopció de Cloudflare com a proxy, capa d'accés o frontera permanent de
  confiança requereix una decisió explícita de seguretat, privacitat, cost,
  reversió i responsabilitat. T6.2 determina si també cal un ADR.
- La fase 6 no pot compartir credencials, zona DNS amb permís d'escriptura,
  paths, caches, cookies ni namespaces amb producció.
- Cap agent o sessió local pot publicar o conservar una preview fora del workflow
  aprovat.

## Resultats Esperats

- Requisits i model d'amenaces aprovats abans de triar proveïdor o topologia.
- Comparativa reproduïble de les opcions DNS, TLS, hosting, accés i neteja,
  inclosa l'opció de no utilitzar Cloudflare.
- Decisió traçable sobre dominis, certificats, publicador, visibilitat, retenció,
  cost i responsabilitats.
- Preview aïllada per PR en un domini registrable diferent, vinculada al commit,
  amb canonical del seu origen, accés aprovat i identificació de no-producció.
- Publicador de confiança que valida manifest, digests i arxiu abans d'escriure
  només al namespace assignat.
- Caducitat, retirada en tancar la PR, revocació i runbook verificats.

## Dependències I Ordre D'Inici

La fase depèn de la fase 5 completada perquè reutilitza el contracte d'artefacte,
les convencions de Caddy i l'experiència operativa sense modificar producció.
T6.1 fixa requisits i amenaces. T6.2 pren la decisió d'arquitectura. T6.3 adapta
el build i crea la frontera de publicació. T6.4 implementa DNS, TLS, cicle de vida
i accés segons la decisió. T6.5 valida el sistema complet i tanca el runbook.

Cada tasca s'implementa en un worktree i una branca propis des de l'últim
`main`. Qualsevol alta de servei, canvi de nameservers, DNS, secrets, repositori o
VPS requereix aprovació explícita de la persona mantenidora.

## Tasques, Entregues I Seguiment

| Unitat                                       | Estat   | Dependències | Resultat verificable                          | PR  |
| -------------------------------------------- | ------- | ------------ | --------------------------------------------- | --- |
| T6.1 Requisits, amenaces i alternatives      | Pendent | Fase 5       | Comparativa i riscos aprovats                 | -   |
| T6.2 Decisió de domini, DNS, TLS i proveïdor | Pendent | T6.1         | Arquitectura mínima decidida                  | -   |
| T6.3 Artefacte i publicador de confiança     | Pendent | T6.2         | Frontera segura sense executar codi no fiable | -   |
| T6.4 Cicle de vida, aïllament i neteja       | Pendent | T6.3         | Orígens efímers creats i retirats             | -   |
| T6.5 Validació de previews i operació        | Pendent | T6.4         | Gate i runbook verificats                     | -   |

### T6.1: Requisits, Amenaces I Alternatives

**Abast:** definir qui necessita previews, visibilitat pública, restringida o
autenticada, autorització prèvia per publicar, suport per a forks, volum esperat,
durada, cost, domini registrable separat, canonical, identificació visual, logs,
responsabilitats i criteris de neteja; modelar codi de PR, artefactes, runner,
caches, publicador, DNS, TLS, navegador i servidor com a fronteres diferenciades;
comparar Hostinger DNS, Caddy, Cloudflare i serveis externs. **Exclusió:** no
crea comptes, zones, registres, certificats ni secrets. **Depèn de:** fase 5.
**Resultat:** requisits observables, alternatives comparables i riscos sense
decisions implícites. **Comprovació:** revisió de seguretat, privacitat,
operació, cost i reversibilitat. **PR:** pròpia.

### T6.2: Decisió De Domini, DNS, TLS I Proveïdor

**Abast:** escollir la mínima solució que compleix T6.1 i documentar domini o
subdomini, wildcard DNS o registres per PR, TLS individual o wildcard,
allotjament, proxy, autenticació, API necessàries, límits, costos, responsable i
pla de sortida. Ha de comparar com a mínim: un domini registrable separat amb
zona pròpia; una subzona DNS delegada només com a aïllament de credencials;
certificats individuals gestionats per Caddy; wildcard TLS amb DNS-01;
Cloudflare DNS-only; Cloudflare proxied o Access; i un servei de previews extern.
No s'accepta `*.preview.mountainrunners.cat` com a aïllament de navegador perquè
continua sent _same-site_ amb producció. **Exclusió:** no implementa encara el
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
identificació inequívoca de no-producció i política de caché, aïllar cookies i
storage, registrar propietat, autorització i caducitat, actualitzar una PR sense
deixar releases òrfenes i retirar la preview en tancar o revocar la PR.
**Exclusió:** no modifica l'origen, els secrets, els fitxers ni el
workflow de producció. **Depèn de:** T6.3. **Resultat:** cicle complet de creació,
actualització, expiració i eliminació. **Comprovació:** dues PR simultànies,
reexecució, PR tancada o reoberta, job cancel·lat, quota exhaurida, certificat o
DNS fallit, expiració i neteja idempotent. **PR:** pròpia.

### T6.5: Validació De Previews I Operació

**Abast:** validar previews pròpies i de fork, navegació i metadades en els tres
idiomes, autorització i visibilitat acordades, absència de secrets, comportament
ordinari de `published: false`, identificació de no-producció, expiració, logs,
alertes, revocació i runbook; verificar que una fallada del sistema de previews
no afecta producció. **Exclusió:** no converteix la preview en staging de
producció ni introdueix analítica. **Depèn de:** T6.4. **Resultat:** sistema
operable i responsabilitats acceptades. **Comprovació:** `pnpm validate`, smoke
de preview, `noindex, noarchive`, canonical, headers, fork, neteja, fallada del
proveïdor i producció inalterada. **PR:** pròpia i darrera de la fase.

## Alternatives I Porta De Decisió

T6.1 i T6.2 no parteixen d'una preferència de proveïdor. La comparativa registra
per cada opció:

- control i automatització de DNS, inclosos wildcards i TTL;
- mecanisme TLS, renovació, quotes i límits d'emissió;
- aïllament d'origen, cookies, storage, caché i CSP;
- tractament de forks i separació entre build no fiable i publicador;
- domini registrable separat, autorització i identificació de no-producció;
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
de T6.2, sota un domini registrable diferent de `mountainrunners.cat`. Això evita
la relació _same-site_ amb producció i impedeix que contingut actiu no fiable
defineixi cookies de domini pare per al lloc públic. Si s'utilitza un wildcard,
es limita a la zona pròpia dels previews. Qualsevol autenticació utilitza cookies
host-only amb prefix `__Host-` i es prova contra accés creuat entre previews.

Totes les respostes HTML i els recursos tècnics aplicables declaren
`X-Robots-Tag: noindex, nofollow, noarchive`; el `robots.txt` de preview bloqueja
el rastreig sense considerar-lo l'única protecció. Si la política exigeix accés
restringit, l'autenticació s'aplica abans de servir l'artefacte i no s'injecta al
build estàtic.

La solució TLS documenta emissió, renovació, quotes i fallades. L'automatització
DNS utilitza una credencial limitada a la zona o prefix imprescindible i només
si l'opció aprovada ho necessita. La credencial només pot modificar una zona
separada o una subzona delegada de previews; no s'accepta escriptura sobre la zona
que conté l'apex, `www`, MX o polítiques de correu de producció. No s'exposa cap
API global del registrador o de producció al job de build.

## Cicle De Vida I Operació

Cada origen registra PR, commit, moment de creació, última actualització,
autorització, caducitat i estat. El publicador rebutja una execució obsoleta o
una PR tancada, revocada o amb un head SHA diferent. El tancament, merge o
revocació inicia la retirada. Una reconciliació periòdica detecta i elimina
namespaces orfes sense confiar només
en un únic esdeveniment de GitHub.

La retenció per defecte és la mínima necessària per revisar la PR i es confirma
a T6.1. Els logs no desen query strings, cookies, capçaleres d'autorització ni
contingut dels artefactes. El runbook cobreix quota, certificats, DNS, neteja,
revocació i desactivació completa del sistema sense afectar producció.

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
- Validar domini registrable separat, TLS, headers, identificació de
  no-producció, caché, cookies `__Host-`, storage i autenticació si s'aplica.
- Simular indisponibilitat de DNS, TLS, hosting o proveïdor i demostrar que
  producció continua operativa.

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
- Aïllament d'origen i de navegador; no es confia només en `noindex` com a control
  d'accés.
- Autorització humana abans de publicar, accés restringit per defecte per a
  forks i identificació inequívoca que no és producció.
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
2. Les cinc unitats tenen PR pròpia revisada, validada i fusionada en ordre de
   dependències.
3. La decisió justifica si s'utilitzen Hostinger, Hetzner, Caddy, Cloudflare, un
   wildcard o un servei extern, i inclou domini registrable separat, cost,
   privacitat, reversió i ADR quan correspongui.
4. El build no fiable utilitza un runner efímer, no rep secrets ni permisos
   d'escriptura, no desa caches consumibles per jobs de confiança i el publicador
   no executa ni fa checkout del codi de la PR.
5. Cada preview requereix autorització, està vinculada a PR i head SHA vigents,
   utilitza l'origen correcte, queda identificada com a no-producció i no pot
   promocionar-se a producció; els forks tenen accés restringit per defecte.
6. Manifest, digests, límits i arxiu es verifiquen abans d'escriure en un
   namespace aïllat; els casos malformats són rebutjats sense publicació parcial.
7. La preview serveix TLS, canonical i headers aprovats des d'un domini
   registrable diferent, declara `noindex, nofollow, noarchive` i no comparteix
   cookies, storage, zona DNS editable ni credencials amb producció.
8. Crear, actualitzar, tancar, expirar, revocar i reconciliar previews funciona
   de manera idempotent i elimina recursos orfes.
9. Una PR de fork segueix la política aprovada sense exposar secrets, sense
   publicació automàtica i sense convertir un context privilegiat en executor de
   codi no fiable; una PR tancada, revocada o amb SHA obsolet no es pot activar.
10. Una fallada de DNS, TLS, hosting, neteja o proveïdor de previews no modifica
    ni interromp producció.
11. El runbook descriu publicació, accés, quota, logs, renovació TLS, neteja,
    revocació, incidències i desactivació completa amb responsables verificats.
