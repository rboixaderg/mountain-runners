# Previews de PR: requisits, amenaces i alternatives (T6.1)

Estat: esborrany per a revisió. Tasca T6.1 de
[la fase 6](specs/phase-6-pull-request-previews.md). Aquest document no adopta
cap proveïdor, no crea comptes ni zones, no migra el DNS i no publica cap
preview. Ho decideix la T6.2 amb aquest document a la mà.

## 1. Per a què serveixen

Les previews responen una pregunta: "aquesta PR trenca la web o la millora?"
Permeten obrir la web compilada d'una PR abans del merge i revisar rutes,
textos i estats en els tres idiomes. No són staging, no es promocionen a
producció i no executen res dinàmic. Són HTML estàtic efímer.

Consumidores: les persones mantenidores i revisores del repo. El ritme real
són poques PR obertes alhora, així que el sistema ha de ser barat de mantenir
i ha de netejar sol. Si un dia el volum canvia, la T6.2 ja haurà deixat
escrites les quotes i els límits.

## 2. Requisits

Els marcats [fixat] venen de l'especificació i no es renegocien. Els marcats
[T6.2] queden oberts per a la decisió.

**Origen i domini.**

- RQ-01 [fixat] Cada preview té un origen únic i estable, vinculat a una PR i
  a un head SHA concrets. Si el SHA canvia sense reautoritzar, no s'activa.
- RQ-02 [fixat] L'origen viu sota un domini registrable diferent de
  `mountainrunners.cat`. Res de `*.preview.mountainrunners.cat`: comparteix
  site amb producció i el contingut d'una PR podria definir cookies llegibles
  des del lloc públic.
- RQ-03 [T6.2] Quin domini concret. Ha de ser curt, òbviament no productiu i
  registrat pel club. El preu i la disponibilitat es confirmen amb el
  registrador abans de decidir.

**No indexació i identificació.**

- RQ-04 [fixat] Totes les respostes HTML i els recursos tècnics aplicables
  declaren `X-Robots-Tag: noindex, nofollow, noarchive` i el `robots.txt` de
  la preview bloqueja el rastreig. El `robots.txt` no és l'única protecció.
- RQ-05 [fixat] La preview mostra que no és producció: canonical al seu propi
  origen i una marca visual que cap revisora pugui confondre amb el lloc
  públic. La T6.4 concreta el disseny.
- RQ-06 [fixat] La preview no envia `Strict-Transport-Security` amb
  `includeSubDomains`. Producció publica HSTS sense `includeSubDomains`
  (fase 5) i una preview no ha de marcar el navegador més enllà del seu
  propi host.

**Aïllament.**

- RQ-07 [fixat] La preview no comparteix amb producció cookies, storage,
  caches, zona DNS amb permís d'escriptura, credencials ni namespaces. Les
  cookies d'autenticació, si n'hi ha, són `__Host-` i host-only.
- RQ-08 [fixat] El build de la PR es compila en un runner efímer amb permisos
  de lectura, sense secrets, sense caches compartides amb jobs de confiança i
  sense permís d'escriptura sobre infraestructura persistent.
- RQ-09 [fixat] La publicació la fa un context de confiança amb codi fixat a
  `main`. Verifica metadades de plataforma, manifest, mida, nombre de
  fitxers, digests i paths sense executar codi de la PR ni fer-ne checkout,
  i rebutja paths absoluts, `..`, symlinks, hardlinks, dispositius, tipus
  inesperats, fitxers duplicats i qualsevol excés dels límits, com ja fa
  l'eina de releases de la fase 5. Mai `pull_request_target` per
  executar codi no fiable.

**Autorització i forks.**

- RQ-10 [fixat] Cap artefacte es publica perquè s'obri o s'actualitzi una PR.
  Cal autorització explícita d'una mantenidora per cada SHA.
- RQ-11 [fixat] Els forks i les contribucions externes queden restringits per
  defecte: sense publicació automàtica i sense secrets al job no fiable.
- RQ-12 [T6.2] Visibilitat per defecte: pública, restringida o autenticada.
  Pública és més còmoda per revisar; restringida redueix l'exposició d'HTML
  no fiable. La decisió pesa comoditat contra exposició, amb el model
  d'amenaces de la secció 3 al davant.

**Cicle de vida.**

- RQ-13 [fixat] Cada origen registra PR, commit, creació, actualització,
  autorització, caducitat i estat. Tancar, fusionar o revocar inicia la
  retirada. Una reconciliació periòdica elimina orfes sense fiar-ho tot a un
  sol esdeveniment de GitHub.
- RQ-14 [T6.2] Retenció per defecte i màxim d'orígens simultanis. Proposta de
  partida: esborrar en tancar la PR i caducar als pocs dies. La xifra final la
  posa la T6.2.

**Logs, costos i operació.**

- RQ-15 [fixat] Els logs no desen query strings, cookies, capçaleres
  d'autorització ni contingut dels artefactes. Camps, retenció, ubicació i
  responsable queden escrits a la T6.2.
- RQ-16 [fixat] Una fallada de DNS, TLS, hosting, neteja o proveïdor de
  previews no modifica ni interromp producció. Si comparteixen VPS, la
  separació és concreta: procés Caddy separat, quota de disc pròpia,
  emmagatzematge ACME separat i cap reload de previews que toqui producció.
  Això es prova a la T6.5, però el disseny ja ho ha de garantir.
- RQ-17 [T6.2] Costos fixos i variables, límits i dependència del proveïdor,
  amb el pla de sortida escrit abans d'adoptar res.

## 3. Model d'amenaces

El codi d'una PR és contingut actiu no fiable. La resta del sistema és
confiança graduada: el runner és d'usar i llençar, l'artefacte és opac fins
que el publicador el valida, i el publicador només confia en metadades de
GitHub i en bytes verificats. Aquestes són les amenaces que el disseny ha de
tancar, digui el que digui l'opció escollida.

- AM-01 Contingut actiu no fiable. L'HTML d'una PR pot portar scripts que
  llegeixen el que tinguin al seu origen. Per això el domini separat de
  RQ-02 no és negociable: limita el dany a la preview mateixa.
- AM-02 Confusió amb producció. Una revisora podria validar contingut
  pensant que mira producció, o un cercador podria indexar la preview.
  RQ-04, RQ-05 i RQ-06 hi responen en tres capes.
- AM-03 Exhauriment de quotes TLS. Sense controls, qualsevol podria forçar
  emissions fins a topar amb els límits de Let's Encrypt (50 certificats per
  domini registrat i setmana, 300 comandes per compte cada 3 hores, 5
  validacions fallides per host i hora). L'emissió ha d'estar lligada a
  l'autorització de RQ-10, no a l'arribada de trànsit. L'on-demand TLS sense
  allowlist queda prohibit: només el publicador autoritzat provoca emissions.
- AM-04 Credencial DNS amb massa permisos. Un token que pot editar la zona
  de producció o el correu converteix un compromís del sistema de previews
  en un compromís del domini públic. La credencial només toca la zona de
  previews, i mai apex, `www`, MX ni polítiques de correu.
- AM-05 Contaminació entre contextos. Caches de CI, claus de cache o
  directoris compartits entre el build no fiable i jobs de confiança
  permetrien enverinar producció. RQ-08 ho prohibeix i la T6.3 ho prova.
- AM-06 Secrets a forks. Un workflow mal dissenyat exposa secrets a PR de
  fork o executa el seu codi en context privilegiat. RQ-09 i RQ-11 ho
  tanquen; qualsevol `pull_request_target` que toqui codi de PR és un defecte
  de disseny.
- AM-07 Filtració per logs. Query strings o capçaleres als logs de preview
  poden contenir tokens o dades de revisores. RQ-15 ho prohibeix.
- AM-08 Orfes persistents. Una preview que sobreviu a la seva PR continua
  servint codi vell, potser amb una vulnerabilitat coneguda. RQ-13 exigeix
  retirada i reconciliació.
- AM-09 Dependència que arrossega producció. Si el mateix Caddy, el mateix
  disc o la mateixa zona DNS sostenen producció i previews, una neteja o una
  quota de previews pot tombar el lloc públic. RQ-16 obliga a separar els
  camins de fallada.
- AM-10 Proveïdor opac. Un servei extern veu el codi de cada PR, els logs
  d'accés i les dades de qui revisa. La T6.2 ha de deixar escrit què en fa,
  on ho desa i com se'n surt.
- AM-11 Abús de la reputació del domini. Un atacant pot obrir PR amb un clon
  de phishing i compartir l'enllaç: el domini el registra el club i la
  víctima no té manera de saber que mira una preview. Agreuja qualsevol
  visibilitat pública per defecte. La T6.2 ho respon amb VR-07.

**Contingut.**

- RQ-18 [fixat] El build ordinari exclou el contingut marcat
  `published: false`, però això no es presenta com a garantia contra HTML
  arbitrari controlat per una PR. El manifest no prova que res sigui
  editorialment publicable.

**Capçaleres de la capa de confiança.**

- RQ-19 [fixat] Les capçaleres de seguretat les serveix el bloc de
  confiança, que la PR no pot sobreescriure: CSP, `frame-ancestors`,
  `X-Content-Type-Options`, `Referrer-Policy` i un `Cache-Control` que no
  retingui orfes després de la retirada.

**Derivats de la PR.**

- RQ-20 [fixat] Tot valor derivat de la PR que toqui DNS, shell, Caddy o API
  passa una validació estricta: només `[a-z0-9-]`, la resta es rebutja. El
  publicador no interpola mai títols, branques ni cap string de PR en ordres
  ni plantilles.

## 4. Alternatives comparades

Totes es comparen amb els mateixos deu punts de l'especificació: control DNS
i wildcards, mecanisme TLS i quotes, aïllament d'origen, tractament de
forks, domini separat i autorització, autenticació opcional, costos,
logs i dades, neteja i sortida, i impacte sobre Hostinger, Hetzner, Caddy i
producció. La T6.2 tria; aquí cap opció queda marcada com a guanyadora.

### ALT-A. Domini separat amb zona a Hetzner DNS i Caddy al VPS

Un domini nou amb els NS delegats al DNS d'Hetzner. Caddy, al mateix VPS de
producció però amb bloc de servidor separat, serveix cada preview amb el seu
certificat individual via HTTP-01. Els registres A per PR els crea el
publicador amb un token limitat a aquesta zona.

DNS i TLS queden fora de la zona de producció: el correu i l'apex no es
toquen. HTTP-01 no necessita cap mòdul extra de Caddy i cada preview costa
una emissió, molt per sota dels límits de Let's Encrypt amb el volum
d'aquest repo. L'aïllament de navegador el dona el domini separat. Els forks
segueixen RQ-11 perquè el build continua sent a GitHub Actions. El punt feble
és operatiu: cal confirmar que l'API d'Hetzner cobreix el que el publicador
necessita i que els registres per PR es creen i s'esborren sols. Compartir
VPS amb producció exigeix blindar RQ-16 amb config i proves, no amb bones
intencions.

### ALT-B. Domini separat amb zona a Cloudflare en mode només DNS

Igual que ALT-A però la zona viu a Cloudflare en gris, sense proxy. A canvi
d'obrir un compte i delegar-hi els NS del domini nou, s'obté una API madura
amb tokens limitables per zona i una propagació ràpida, cosa que simplifica
la creació i neteja de registres. El trànsit no passa per Cloudflare, així
que no hi ha terminació TLS aliena ni conflicte amb HTTP-01. El cost és un
proveïdor més, un compte més i una superfície de configuració més gran, a
canvi de menys codi propi d'automatització DNS. La zona de producció continua
intacta a Hostinger.

### ALT-C. Wildcard amb DNS-01 al VPS

Un sol certificat `*.previews.example` cobreix totes les PR, renovat per
Caddy contra l'API DNS de la zona de previews. S'eliminen les emissions per
PR i el publicador ja no depèn de cap quota de certificats. El preu és
alt: el wildcard exigeix DNS-01, que demana compilar Caddy amb el mòdul del
proveïdor, i el binari resultant ja no és el paquet oficial pinjat per
SHA-512 que la fase 5 verifica al bootstrap. A més, el token DNS ha de viure
al VPS amb permís d'escriptura de TXT, un secret permanent més a custodiar.
Amb el volum d'aquest repo, el wildcard resol un problema de quotes que no
tenim i afegeix una cadena de subministrament pròpia que sí que tindrem.

### ALT-D. Subzona delegada `preview.mountainrunners.cat`

Es delega només la subzona a un DNS amb API i la resta continua igual. Com a
aïllament de credencials funciona: el token no toca l'apex ni el correu.
Però continua sent el mateix lloc registrable que producció, i
l'especificació ho diu clar: no val com a aïllament de navegador. El
contingut d'una PR podria fixar cookies llegibles des del domini públic.
Útil només si algun dia cal separar permisos sense tocar el registrador,
mai com a origen de previews.

### ALT-E. Cloudflare amb proxy o túnel i accés restringit

La zona del domini nou a Cloudflare en taronja, o un túnel des del VPS, amb
Cloudflare Access davant de cada preview. Aporta el que les altres no tenen:
autenticació sense codi propi, amb pla gratuït fins a 50 usuaris i retenció
de logs de 24 hores. Però mou la frontera de confiança: el trànsit i
l'accés depenen de Cloudflare, cal compte amb forma de pagament, el proxy
trenca HTTP-01 i obliga a DNS-01 o a certificats d'origen, i cal revisar què
en fa de les dades. Té sentit si la T6.2 tria visibilitat restringida per
defecte; per a previews públiques és pagar dependència sense guanyar res.

### ALT-F. Servei extern de previews

Cloudflare Pages, Netlify o equivalents compilen la PR i la serveixen a la
seva infraestructura. L'aïllament del build queda regalat i no toca el VPS,
però el codi de cada PR, els logs i les dades de revisores viuen en un
tercer, amb la seva retenció i la seva sortida. També cal donar al servei
accés al repo i encaixar-hi autorització per SHA, `noindex` i neteja d'orfes
amb les seves primitives, no amb les nostres. És l'opció amb menys feina
pròpia i amb menys control propi. Interessant si el criteri que mana és no
tocar el VPS; dolenta si mana la sobirania de les dades.

### Taula resum

| Opció                      | DNS/TLS                       | Aïllament                      | Forks           | Cost i feina                           | Risc principal                     |
| -------------------------- | ----------------------------- | ------------------------------ | --------------- | -------------------------------------- | ---------------------------------- |
| A. Hetzner DNS + Caddy VPS | Zona nova, HTTP-01 per origen | Domini separat, mateix VPS     | RQ-11 a Actions | Domini/any, automatitzar registres     | Compartir VPS amb producció        |
| B. Cloudflare només DNS    | Zona nova, HTTP-01 per origen | Domini separat, mateix VPS     | RQ-11 a Actions | Domini/any, compte nou                 | Un proveïdor i un compte més       |
| C. Wildcard DNS-01         | TXT via API, un certificat    | Domini separat, mateix VPS     | RQ-11 a Actions | Caddy compilat propi, secret permanent | Cadena de subministrament pròpia   |
| D. Subzona delegada        | Segons opció base             | Sense aïllament de navegador   | RQ-11 a Actions | Mínim                                  | Cookies cross-subdomini, no vàlida |
| E. Cloudflare proxy/Access | DNS-01 o cert d'origen        | Domini separat, trànsit extern | RQ-11 a Actions | Gratuït fins a 50 usuaris, dependència | Frontera de confiança externa      |
| F. Servei extern           | El del servei                 | Infraestructura aliena         | El del servei   | Segons pla, repo connectat             | Dades i control fora               |

ALT-D no és una opció vàlida d'origen. Hi és perquè quedi escrit per què
no: val per a credencials, no per a navegador.

## 5. Verificacions que T6.2 ha de tancar

- VR-01 L'API de zona que toqui cobreix crear i esborrar registres de la
  zona de previews amb un token limitat, amb aprovació explícita de la
  mantenidora. Prova de foc: una emissió contra
  l'staging de Let's Encrypt abans de decidir.
- VR-02 Domini concret: disponibilitat, preu de registre i renovació, i qui
  el registra. Res de noms provisionals a la configuració final.
- VR-03 Si la zona viu a Hetzner DNS: delegació NS provada i permís mínim
  del token, amb aprovació explícita de la mantenidora. Si viu a
  Cloudflare: compte creat, zona en mode només DNS i
  token amb `Zone:Read` i `DNS:Edit` només d'aquella zona.
- VR-04 Visibilitat per defecte i retenció en dies, amb responsable que ho
  signa. Sense aquestes dues xifres no es pot escriure la T6.4. L'esquema de
  noms d'origen ha de dir si és enumerable (`pr-<n>`) i si cal aleatorietat
  quan l'accés sigui restringit.
- VR-05 Pressupost de quotes amb el volum real: emissions TLS per setmana,
  duplicats (5 per setmana), crides API DNS per desplegament i màxim
  d'orígens simultanis.
- VR-06 Si s'adopta Cloudflare com a proxy, accés o frontera permanent, cal
  la decisió explícita de seguretat, privacitat, cost, reversió i
  responsabilitat que demana l'especificació, i un ADR si canvia una
  frontera arquitectònica.
- VR-07 Resposta a AM-11: marca de no-producció que el CSS de la PR no pugui
  ocultar, procediment de retirada ràpida d'una preview abusiva, i criteri
  de quan la visibilitat restringida per defecte és obligatòria.

## 6. Costos

Estructura, sense xifres inventades. Els preus es confirmen a la T6.2 amb el
registrador i els proveïdors, i queden escrits a la decisió.

- Domini separat: registre i renovació anuals. Un sol cost fix, independent
  de l'opció.
- VPS actual: cap cost addicional si les previews viuen al mateix Hetzner,
  però cal comptar el marge de disc i memòria per als orígens simultanis.
- TLS amb Let's Encrypt: sense cost, amb els límits de la secció 3. El
  wildcard no estalvia diners, només emissions.
- Cloudflare Access: pla gratuït fins a 50 usuaris, 24 hores de logs. Més
  enllà només si el projecte supera el llindar o necessita retenció.
- Servei extern: el que digui el seu pla per a builds i ample de banda, més
  el cost de sortida si un dia se'n va.

## Fonts

- Límits oficials de Let's Encrypt (letsencrypt.org/docs/rate-limits).
- Documentació de Caddy sobre HTTPS automàtic, on-demand TLS i repte DNS-01
  (caddyserver.com).
- Proveïdors DNS de lego i guia del proveïdor de Cloudflare (go-acme.github.io).
- Fils de la comunitat Caddy sobre límits de Let's Encrypt amb on-demand
  TLS i emissió de wildcards (caddy.community).
- Revisions del pla gratuït de Cloudflare Zero Trust del 2026, fins a 50
  usuaris (zerometric.net, zerotrustcost.com, costbench.com).
- Fil de lego sobre l'API DNS de Hostinger (`developers.hostinger.com`,
  github.com/go-acme/lego discussions).
- Estat actual del repo: `docs/phase-5-t55-dns-inventory.md`,
  `docs/deployment.md`, `docs/runbook.md`, `tools/server/`,
  `.github/workflows/` i `docs/decisions/0001` i `0003`.
