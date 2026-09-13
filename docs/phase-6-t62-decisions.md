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
conversa directa el 13 de setembre de 2026. La prova de foc VR-01, la delegació
NS VR-02 i la creació del compte i el token VR-03 són accions remotes que
requereixen l'aprovació i l'execució de la persona mantenidora; queden com a
passos signats pendents dins d'aquesta tasca. Aquesta decisió no implementa el
publicador (T6.3), no crea cap compte ni zona (l'alta és de la persona
mantenidora) i no migra la zona de producció.

## Decisions Confirmades

### Zona De DNS De Les Previews (RQ-03, VR-03)

- La zona `preview.mountainrunners.cat` viu a **deSEC.io**, servei gratuït de
  DNS gestionat per la societat civil alemanya sense ànim de lucre deSEC e.V.
- **Esmena de la primera versió d'aquesta decisió.** Originalment es va triar la
  Hetzner Console dins d'un projecte dedicat, però la creació de la zona va ser
  rebutjada ("invalid domain") i la documentació oficial d'Hetzner ho confirma:
  "Subzones are not supported" — la Console només allotja zones de dominis
  registrables complets. L'alternativa Cloudflare tampoc no és viable per a
  subzones: el "subdomain setup" requereix pla Enterprise. Crear la zona
  `mountainrunners.cat` sencera a un altre proveïdor mouria l'autoritat de la
  zona de producció, cosa que ADR 0009 i la fase 5 prohibeixen. deSEC compleix
  tots els requisits: allotja subzones com a zones pròpies, el registre és
  gratuït, i els tokens admeten polítiques de rang limitades per domini.
- La credencial és un token API de deSEC amb una política de RRset que només
  permet escriure al domini `preview.mountainrunners.cat` (tipus A). Si el token
  es filtra, el dany màxim és editar registres d'aquest domini; no pot tocar cap
  altra zona del compte ni crear recursos. Això compleix AM-04 amb un àmbit fins
  i tot més estret que un projecte monozona.
- **Cost: 0 €/mes.** deSEC és gratuït (donacions); no cal cap IP ni recurs nou.
- La zona de producció continua a Hostinger i no es mou. La delegació és només
  de la subzona: dos registres NS a la zona d'Hostinger
  (`preview.mountainrunners.cat` → nameservers de deSEC). Cap credencial de
  previews pot escriure mai a l'apex, `www`, MX, SPF, DKIM, DMARC ni cap altre
  registre de producció (VR-02).
- **Comparativa tancada.** Hetzner Console: rebutjada perquè no admet subzones
  (documentat més amunt). Cloudflare només DNS: el token per zona compleix
  AM-04, però una zona de subdomini exigeix pla Enterprise, i un compte i
  proveïdor nous són dependència que el projecte no paga per res. Zone
  sencera a Hetzner o Cloudflare: mou l'autoritat de producció, prohibida.
  deSEC: subzones acceptades, token limitat per domini, gratuït, entitat
  europea sense ànim de lucre (coherent amb la sobirania de dades d'AM-10).
- Matisos de deSEC registrats: DNSSEC automàtic (transparent per a la
  delegació; si cal, s'afegeix el registre DS a Hostinger com a pas opcional);
  límit de 300 modificacions de RRset per domini i dia, irrellevant per a un
  ús manual; el registre del compte exigeix un correu i 2FA recomanada.

### Registres DNS Per Origina (VR-02, VR-04, VR-05)

- **Registre wildcard únic**: `*.preview.mountainrunners.cat` A → la IPv4 del
  procés de previews del VPS. Es crea **manualment, un cop, amb aprovació
  explícita** de la persona mantenidora (VR-02).
- Cap registre per PR i cap crida a l'API DNS en temps d'execució. El token de
  la zona no viu en cap workflow ni al servidor: només serveix per a canvis
  manuals excepcionals. Això és més fort que l'ALT-A original, que creava
  registres per PR via API, i elimina la credencial DNS de tot el camí
  d'execució de la T6.3 i la T6.4.
- Conseqüència acceptada i escrita: qualsevol nom sota la zona resol a la IP de
  previews. Un nom sense origen configurat rep la resposta per defecte del
  procés de previews (404 sense servidor), no toca mai producció. L'esquema de
  noms d'origen és enumerable (`pr-<n>.preview.mountainrunners.cat`), cosa que
  VR-04 accepta perquè la visibilitat escollida és pública (vegeu més avall).
- **Comparativa tancada.** Registres per PR via API: descartats perquè
  posarien una credencial DNS dins del flux de publicació sense cap guany amb
  el volum d'aquest repo (VR-05).

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
| Zona DNS de la subzona a deSEC                                 | 0 € (servei gratuït finançat amb donacions)                      |
| IP nova                                                        | 0 €/mes (el wildcard apunta a la mateixa VPS; cap IP addicional) |
| Certificats Let's Encrypt                                      | 0 €                                                              |
| Servidor (mateix VPS, espai disc i memòria propis de previews) | 0 €/mes afegit; el marge el confirma la T6.4                     |
| Escalada possible: Floating IPv4                               | 3,00 €/mes només si la T6.5 ho demana                            |

Dependència nova: un compte gratuït a deSEC. La dependència de deSEC per a la
subzona és limitada: si deSEC deixés de funcionar, producció no es veu afectada
(la zona de producció és a Hostinger) i les previews deixen de resoldre fins a
restaurar la zona. El pla de sortida és eliminar els dos registres NS
d'Hostinger i tornar a servir les previews (o no servir-les) sense cap rastre de
la zona delegada; la zona de deSEC es pot exportar i recrear a qualsevol altre
DNS que allotgi subzones.

### Credencial I Verificació De Producció (AM-04)

- L'únic secret nou és el token de deSEC amb la política limitada al domini de
  previews. Viu fora del repositori, al magatzem de secrets aprovat, i només la
  persona mantenidora el conserva; cap workflow, ni el publicador, ni el
  servidor el llegeixen.
- Comprovació de frontera exigida per l'espec: la zona de producció continua a
  Hostinger; el token de previews només pot escriure RRset del domini
  `preview.mountainrunners.cat`; cap credencial de previews té permís sobre
  l'apex, `www`, MX ni polítiques de correu. La T6.3 i la T6.5 reexecuten aquesta
  comprovació a les seves validacions.

## Riscos Registrats

- La delegació NS des d'Hostinger és un canvi a la zona de producció: es fa amb
  la persona mantenidora, després d'exportar la zona actual, i la T6.1 ja fixa
  que no toca apex, `www`, MX ni correu (VR-02).
- Un token de deSEC té l'àmbit que les seves polítiques concedeixin: la política
  d'escriptura ha de quedar limitada al domini de previews i al tipus A, i la
  reconciliació de la T6.4 ho revalida. El compte de deSEC ha de romandre amb
  només aquest domini; si s'hi afegís cap altre, l'aïllament es verifica igual
  per la política de domini del token, però es redueix la claredat del compte.
- El wildcard fa que qualsevol nom sota la zona resolgui: la superfície és
  resposta 404 del procés de previews, mai producció; la identificació de
  no-producció i `noindex` cobreixen el contingut servible.
- La retenció pública d'HTML de PR (14 dies màxim) és un risc d'exposició
  acceptat perquè l'origen és només de branques pròpies autoritzades; AM-11
  queda cobert per revocació immediata.

## Verificacions Pendents De Signatura

| ID    | Verificació                                                                                                                                           | Responsable         | Estat     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------- |
| VR-01 | Prova de foc: emissió contra l'staging de Let's Encrypt des del procés de previews abans d'activar res                                                | Persona mantenidora | Pendent   |
| VR-02 | Delegació NS de la subzona des d'Hostinger provada, sense tocar apex, `www`, MX ni correu                                                             | Persona mantenidora | Pendent   |
| VR-03 | Compte deSEC dedicat, domini creat, token amb política limitada a `preview.mountainrunners.cat` tipus A, conservat fora del repo, permisos comprovats | Persona mantenidora | Pendent   |
| VR-04 | Visibilitat pública i retenció de 14 dies signades; esquema `pr-<n>` enumerable acceptat                                                              | Persona mantenidora | Confirmat |
| VR-05 | Pressupost de quotes amb el volum real (TLS, API DNS, orígens simultanis) escrit a aquest document                                                    | Agent + mantenidora | Confirmat |
| VR-06 | No s'adopta Cloudflare com a proxy, accés ni frontera; no cal ADR addicional per aquesta via                                                          | Persona mantenidora | Confirmat |
| VR-07 | Criteri de visibilitat restringida obligatòria escrit; procediment de retirada ràpida definit per la T6.4                                             | Persona mantenidora | Parcial   |

VR-01, VR-02 i VR-03 s'executen amb aprovació explícita de la persona
mantenidora dins d'aquesta tasca, abans que la T6.3 implementi el publicador.
VR-07 queda tancat quan la T6.4 defineixi el procediment de retirada ràpida.

## Fonts

- FAQ de zones de la documentació de DNS d'Hetzner
  (docs.hetzner.com/networking/dns/faq/zones): "Subzones are not supported";
  motiu del rebuig de la zona `preview.mountainrunners.cat` a la Hetzner
  Console, confirmat en prova real ("invalid domain").
- Documentació de Cloudflare sobre "Subdomain setup"
  (developers.cloudflare.com/dns/zone-setups/subdomain-setup): "Subdomain setup
  is only available for Enterprise accounts".
- Documentació de deSEC (desec.readthedocs.io): gestió de dominis qualsevol per
  API, polítiques de tokens amb rang per domini i tipus de RRset, límits de
  300 RRset per domini i dia, DNSSEC automàtic.
- Preus oficials d'IP d'Hetzner (docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing):
  Floating IPv4 3,00 €/mes; Primary IPv4 0,50 €/mes; IPv6 primària gratuïta.
- Límits oficials de Let's Encrypt (letsencrypt.org/docs/rate-limits).
- Documentació de Caddy sobre HTTPS automàtic i repte HTTP-01 (caddyserver.com).
- Limitacions dels tokens del DNS Console antic documentades per tercers
  (certautopilot.com, fòrum de Cloudron): sense àmbit per zona; motiu del descart
  original d'Hetzner a la T6.1, superat per l'àmbit de projecte de la Console.
- Estat actual del repo: `docs/phase-6-t61-requisits-alternatives.md`,
  `docs/decisions/0009-pr-previews-same-domain-and-own-branches.md`,
  `docs/deployment.md`, `docs/runbook.md`, `tools/server/`.
