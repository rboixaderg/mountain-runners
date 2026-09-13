# T6.2: Decisió De Domini, DNS, TLS I Proveïdor

## Estat

Registre de la decisió d'arquitectura de la T6.2 de
[`docs/specs/phase-6-pull-request-previews.md`](specs/phase-6-pull-request-previews.md),
elaborada el 13 de setembre de 2026 a partir dels requisits, el model d'amenaces
i les alternatives de la T6.1
([`docs/phase-6-t61-requisits-alternatives.md`](phase-6-t61-requisits-alternatives.md))
i dins de la frontera fixada per
[l'ADR 0009](decisions/0009-pr-previews-same-domain-and-own-branches.md): origen
sota `*.preview.mountainrunners.cat`, sense segon domini ni servei extern, i
publicació restringida a branques pròpies.

Les decisions d'aquest document estan confirmades amb la persona mantenidora en
conversa directa el 13 de setembre de 2026. La prova de foc VR-01 i la creació
del registre wildcard VR-02 són accions remotes que
requereixen l'aprovació i l'execució de la persona mantenidora; queden com a
passos signats pendents dins d'aquesta tasca. Aquesta decisió no implementa el
publicador (T6.3), no crea cap compte ni zona (l'alta és de la persona
mantenidora) i no migra la zona de producció.

## Decisions Confirmades

### Registres De Previews A La Zona De Producció (RQ-03, VR-03)

- **No hi ha subzona delegada.** Els registres DNS dels previews viuen
  directament a la zona de producció d'Hostinger: un únic wildcard A
  `*.preview.mountainrunners.cat` → la IPv4 del procés de previews del VPS,
  creat **manualment, un cop, amb aprovació explícita** de la persona
  mantenidora (VR-02).
- **Esmena de la primera versió d'aquesta decisió.** La versió original triava
  una subzona delegada amb credencial pròpia (primer projecte Hetzner, després
  deSEC). Les proves reals i la documentació oficial la fan irrealitzable dins
  dels límits del projecte: Hetzner no admet subzones ("Subzones are not
  supported", FAQ oficial; rebutjat en prova amb "invalid domain"); Cloudflare
  exigeix pla Enterprise per a zones de subdomini; i Hostinger, el proveïdor de
  la zona pare que la fase 5 prohibeix moure, no permet registres NS per a
  subdominis ("Hostinger domains don't allow custom nameservers (NS records)
  for subdomains – only for the main domain"). deSEC accepta la zona de
  subdomini, però sense delegació des del pare no rep cap consulta: també queda
  descartat, i el compte de prova es pot esborrar.
- **Aïllament de credencial (AM-04): cap credencial DNS de previews existeix.**
  Cap token, secret o API del registrador viu al CI, al servidor o al
  repositori; l'únic accés d'escriptura sobre els registres de previews és el
  hPanel de la persona mantenidora, el mateix que ja protegeix la zona sencera.
  El procediment manual protegeix la frontera "cap escriptura sobre l'apex,
  `www`, MX o correu": export previ de la zona, canvi mínim, comparació
  posterior (VR-02).
- **Restricció permanent** registrada a
  [l'esmena de l'ADR 0009](decisions/0009-pr-previews-same-domain-and-own-branches.md):
  els previews no automatitzen mai el DNS. Si algun dia calguessin registres
  per PR o escriptures automatitzades, cal reobrir la decisió amb un ADR,
  perquè amb Hostinger qualsevol token d'API és de compte sencer i violaria
  AM-04.
- Conseqüència acceptada i escrita: qualsevol nom sota `*.preview` resol a la
  IP de previews. Un nom sense origen configurat rep la resposta per defecte del
  procés de previews (404 sense servidor), no toca mai producció. L'esquema de
  noms d'origen és enumerable (`pr-<n>.preview.mountainrunners.cat`), cosa que
  VR-04 accepta perquè la visibilitat escollida és pública (vegeu més avall).

### Registres DNS Per Origina (VR-02, VR-04, VR-05)

- Cap registre per PR i cap crida a l'API DNS en temps d'execució: cap
  workflow, el publicador ni el servidor toquen mai el DNS. Això és més fort
  que l'ALT-A original, que creava registres per PR via API, i elimina la
  credencial DNS de tot el camí d'execució de la T6.3 i la T6.4.
- **Comparativa tancada.** Registres per PR via API: descartats perquè
  posarien una credencial DNS dins del flux de publicació sense cap guany amb
  el volum d'aquest repo (VR-05), i amb Hostinger el token seria de compte
  sencer (violaria AM-04).

### TLS (RQ-04, AM-03, VR-05)

- **Certificats individuals per origen, emesos per Caddy via HTTP-01** contra
  Let's Encrypt, amb el binari oficial de Caddy pinjat per checksum SHA-512 que
  la fase 5 ja verifica al bootstrap.
- El TLS on-demand sense allowlist queda **prohibit** (violaria RQ-10 i AM-03):
  Caddy només emet certificat per orígens configurats explícitament pel
  publicador.
- **Comparativa tancada.** Wildcard `*.preview.mountainrunners.cat` amb DNS-01:
  descartat. Exigiria compilar Caddy amb el mòdul DNS del proveïdor (perdrem el
  binari oficial pinjat), custodiar un secret DNS permanent al VPS i afegir una
  cadena de subministrament pròpia (ALT-C). Amb el volum del repo, el wildcard
  resol un problema de quotes que no tenim.
- Pressupost de quotes amb el volum real (VR-05): poques PR obertes alhora i
  màxim 5 orígens simultanis fan molt menys d'1 emissió per setmana, molt per
  sota del límit de 50 certificats per domini registrat i setmana de Let's
  Encrypt; el límit de 5 validacions fallides per compte, host i hora només és
  assolible amb una configuració trencada repetida, que la validació prèvia i
  la reconciliació detecten.

### Servidor I Separació De Fallades (RQ-16, AM-09)

- **Un sol procés Caddy al VPS actual**, amb blocs de servidor separats per a
  producció i previews, **emmagatzematge ACME separat** per a les previews i
  **directoris de logs propis**. Cap recàrrega de previews toca els blocs de
  producció, i cada recàrrega passa `caddy validate` abans d'aplicar-se.
- El risc compartit del procés queda escrit: un crash o un reload fallat
  afectaria tots dos serveis. La mitigació és la validació prèvia de
  configuració i la disciplina de blocs separats, tal com demanava la T6.1
  ("config i proves, no bones intencions"); la T6.5 prova aquesta separació.
- **Escalada documentada, no adoptada**: si la T6.5 demostra que el risc
  compartit és real, la via d'escala és un segon procés Caddy escoltant a una
  **Floating IPv4 (3,00 €/mes)**, o un segon servidor Cloud petit. No es paga
  aquest aïllament per avançat.
- **Comparativa tancada.** Allotjament de previews al mateix VPS d'Hetzner amb
  separació de blocs i d'emmagatzematge ACME; proxy extern, túnel o segon
  allotjament: descartats per dependència i cost (RQ-17, AM-10).

### Visibilitat I Autenticació (RQ-12, AM-11, VR-07)

- **Visibilitat pública per defecte**, sense autenticació. Les previews només
  existeixen per a branques del repositori principal amb autorització explícita
  per SHA (RQ-10, RQ-11), la marca de no-producció és servida per la capa de
  confiança (RQ-05) i la retirada d'una preview abusiva és immediata via
  revocació del publicador. Aquestes capes responen a AM-11 sense pagar la
  dependència d'un sistema d'accés extern (ALT-E queda descartada).
- Criteri escrit de VR-07: la visibilitat restringida per defecte esdevé
  **obligatòria** si els forks obtenen previews (cosa que exigiria revisar
  l'ADR 0009 amb un ADR nou) o si una preview pública genera un incident de
  reputació de domini. Autenticació pròpia amb cookies `__Host-`: només si la
  visibilitat restringida s'adopta algun dia.

### Retenció I Límits (RQ-14, VR-04)

- **Esborrat de l'origen en tancar o fusionar la PR**, verificat per la
  reconciliació periòdica.
- **Caducitat automàtica als 14 dies** sense actualització de l'origen.
- **Màxim 5 orígens simultanis**; un origen nou que excedeixi el màxim es
  rebutja fins que hi hagi espai (pressió de neteja, no error silenciós).

### Costos I Dependència (RQ-17)

| Concepte                                                       | Cost                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Domini                                                         | 0 € (mateix domini registrable, ADR 0009)                        |
| Registres DNS dels previews (a la zona d'Hostinger existent)   | 0 € (un registre wildcard més a la zona que ja es custodia)      |
| IP nova                                                        | 0 €/mes (el wildcard apunta a la mateixa VPS; cap IP addicional) |
| Certificats Let's Encrypt                                      | 0 €                                                              |
| Servidor (mateix VPS, espai disc i memòria propis de previews) | 0 €/mes afegit; el marge el confirma la T6.4                     |
| Escalada possible: Floating IPv4                               | 3,00 €/mes només si la T6.5 ho demana                            |

Dependència nova: **cap**. Cap compte, cap zona i cap credencial nous; els
registres de previews viuen a la zona d'Hostinger que el projecte ja custodia.
El pla de sortida és eliminar el registre wildcard `*.preview` del hPanel i
tornar a servir les previews (o no servir-les) sense cap rastre.

### Credencial I Verificació De Producció (AM-04)

- Cap secret nou. Cap credencial DNS de previews existeix: cap token ni API del
  registrador viu al repositori, al CI, al servidor o al magatzem de secrets.
- L'únic accés d'escriptura sobre els registres de previews és el hPanel de la
  persona mantenidora, que ja és l'accés de producció existent i no forma part
  de cap sistema automatitzat de previews.
- Comprovació de frontera exigida per l'espec: la zona de producció continua a
  Hostinger; cap credencial de previews té permís sobre l'apex, `www`, MX ni
  polítiques de correu, perquè no n'existeix cap; cap workflow de previews
  llegeix o escriu DNS. La T6.3 i la T6.5 reexecuten aquesta comprovació a les
  seves validacions.

## Riscos Registrats

- La creació del wildcard a la zona de producció és un canvi al hPanel: es fa
  amb la persona mantenidora, després d'exportar la zona actual, i la T6.1 ja
  fixa que no toca apex, `www`, MX ni correu (VR-02). Un error manual del
  hPanel afectaria la zona de producció; l'export previ i la comparació
  posterior són la mitigació, i la pràctica de la fase 5 (export + `dig` del
  runbook) ja és el procediment.
- El wildcard fa que qualsevol nom sota la zona resolgui: la superfície és
  resposta 404 del procés de previews, mai producció; la identificació de
  no-producció i `noindex` cobreixen el contingut servible.
- La retenció pública d'HTML de PR (14 dies màxim) és un risc d'exposició
  acceptat perquè l'origen és només de branques pròpies autoritzades; AM-11
  queda cobert per revocació immediata.

## Verificacions Pendents De Signatura

| ID    | Verificació                                                                                                                                                 | Responsable         | Estat     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------- |
| VR-01 | Prova de foc: emissió contra l'staging de Let's Encrypt des del procés de previews abans d'activar res                                                      | Persona mantenidora | Pendent   |
| VR-02 | Registre wildcard A `*.preview` creat a la zona d'Hostinger amb aprovació explícita; export previ i comparació posterior; apex, `www`, MX i correu intactes | Persona mantenidora | Pendent   |
| VR-03 | Cap credencial DNS de previews: cap token ni API del registrador al repo, CI o servidor; l'únic accés és el hPanel de la mantenidora                        | Agent + mantenidora | Confirmat |
| VR-04 | Visibilitat pública i retenció de 14 dies signades; esquema `pr-<n>` enumerable acceptat                                                                    | Persona mantenidora | Confirmat |
| VR-05 | Pressupost de quotes amb el volum real (TLS, orígens simultanis) escrit a aquest document                                                                   | Agent + mantenidora | Confirmat |
| VR-06 | No s'adopta Cloudflare com a proxy, accés ni frontera; no cal ADR addicional per aquesta via                                                                | Persona mantenidora | Confirmat |
| VR-07 | Criteri de visibilitat restringida obligatòria escrit; procediment de retirada ràpida definit per la T6.4                                                   | Persona mantenidora | Parcial   |

VR-01 i VR-02 s'executen amb aprovació explícita de la persona mantenidora
dins d'aquesta tasca, abans que la T6.3 implementi el publicador. VR-03 queda
com a propietat permanent del disseny i es revalida a les validacions de la
T6.3 i la T6.5. VR-07 queda tancat quan la T6.4 defineixi el procediment de
retirada ràpida.

## Fonts

- Article oficial de gestió de registres DNS d'Hostinger
  (hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger):
  "Hostinger domains don't allow custom nameservers (NS records) for subdomains
  – only for the main domain"; motiu de la impossibilitat de la subzona
  delegada, confirmat per suport oficial d'Hostinger.
- FAQ de zones de la documentació de DNS d'Hetzner
  (docs.hetzner.com/networking/dns/faq/zones): "Subzones are not supported";
  motiu del rebuig de la zona `preview.mountainrunners.cat` a la Hetzner
  Console, confirmat en prova real ("invalid domain").
- Documentació de Cloudflare sobre "Subdomain setup"
  (developers.cloudflare.com/dns/zone-setups/subdomain-setup): "Subdomain setup
  is only available for Enterprise accounts".
- Documentació de deSEC (desec.readthedocs.io): accepta zones de subdomini;
  descartada perquè el pare d'Hostinger no pot delegar-hi.
- Preus oficials d'IP d'Hetzner (docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing):
  Floating IPv4 3,00 €/mes; Primary IPv4 0,50 €/mes; IPv6 primària gratuïta.
- Límits oficials de Let's Encrypt (letsencrypt.org/docs/rate-limits).
- Documentació de Caddy sobre HTTPS automàtic i repte HTTP-01 (caddyserver.com).
- Estat actual del repo: `docs/phase-6-t61-requisits-alternatives.md`,
  `docs/decisions/0009-pr-previews-same-domain-and-own-branches.md`,
  `docs/deployment.md`, `docs/runbook.md`, `tools/server/`.
