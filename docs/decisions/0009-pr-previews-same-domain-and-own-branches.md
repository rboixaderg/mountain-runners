# ADR 0009: Previews de PR al mateix domini registrable i només branques pròpies

## Estat

Acceptada.

## Decisió

Les previews de pull request de la fase 6 viuen com a subdominis de
`*.preview.mountainrunners.cat`, el mateix domini registrable que producció, i
la publicació es limita a branques del repositori principal. Els forks i les
contribucions externes no tenen cap preview: ni automàtica ni autoritzada.

Cada preview té un origen únic i estable per PR i commit, amb canonical al seu
propi origen, `noindex, nofollow, noarchive` i capçaleres de seguretat servides
per la capa de confiança. La zona DNS dels previews és una subzona delegada amb
credencial pròpia; cap credencial de previews pot escriure a la zona que conté
l'apex, `www`, MX o polítiques de correu. El mecanisme TLS exacte (certificats
individuals HTTP-01 o wildcard DNS-01) el decideix la T6.2.

La frontera _same-site_ amb producció queda acceptada amb controls
compensatoris permanents, que formen part del contracte de la web pública:

- La web pública no publica cookies. Qualsevol cookie futura de producció ha de
  ser `__Host-` o `__Secure-`, host-only i sense atribut `Domain`, de manera que
  contingut d'una preview no pugui definir ni sobreescriure cookies del lloc
  públic. La invariant es verifica de manera determinista: una comprovació
  automàtica de les respostes de producció falla si troba cap `Set-Cookie`
  sense aquests prefixes, i forma part de la validació regular.
- Qualsevol subdomini nou de producció aplica CORS d'origen exacte i mai
  reflecteixi orígens de previews.
- La identificació inequívoca de no-producció es serveix des de la capa de
  confiança i no pot ser ocultada pel contingut de la PR.

La T6.2 decideix DNS i TLS dins d'aquesta frontera i ja no compara domini
registrable separat ni serveis externs de previews. Si el projecte necessités
previews de forks o cookies a producció, aquesta decisió s'ha de revisar amb un
ADR nou.

## Raonament

La T6.1 (PR #113) modela el contingut d'una PR com a contingut actiu no fiable
i proposa un domini registrable diferent com a aïllament de navegador. És la
frontera més forta, però exigeix comprar i custodiar un segon domini, cosa que
el projecte ha descartat. Les dues vies que la reemplacen sense comprar res
tenen costos clars:

- Un servei extern (Netlify, Cloudflare Pages) compleix l'aïllament de
  navegador perquè serveix sota el seu propi domini registrable, però posa el
  codi de cada PR, els logs i les dades de revisores en mans d'un tercer, amb
  retenció i pla de sortida alienes. Descartat per sobirania de dades (AM-10 de
  la T6.1).
- Reutilitzar `rogerbg.cat`, el domini personal on ja viu l'analítica
  autoallotjada (ADR 0007), donaria aïllament de navegador sense comprar res,
  però posaria contingut no fiable sota el mateix domini registrable que la CSP
  de producció declara origen de JavaScript de confiança, i dependria d'un
  actiu personal del mantenidor. Descartat.

Amb el mateix domini registrable, l'aïllament real és l'origen: cookies,
storage i documents de `pr-<n>.preview.mountainrunners.cat` no són accessibles
des de `www.mountainrunners.cat`. L'atac que motivava el domini separat —
cookies de domini pare — només té superfície si producció publica cookies sense
prefix. Avui la web és estàtica i no publica cap cookie; la invariant de
prefixes elimina la superfície futura. Restringir la publicació a branques
pròpies redueix el contingut actiu a revisions humanes del propi repositori i
afebleix AM-11 (phishing): tota preview publicada ha passat per autorització
d'una mantenidora, tot i que la identificació de no-producció continua sent
obligatòria.

La subzona delegada aïlla credencials (el token només toca la zona de previews)
i no toca el registre, `www`, MX ni el correu, tal com analitza l'alternativa
ALT-D de la T6.1: com a origen era rebutjada per manca d'aïllament de navegador,
decisió que aquest ADR reverteix explícitament amb els controls compensatoris
anteriors.
