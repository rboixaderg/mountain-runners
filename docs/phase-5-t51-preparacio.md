# Preparació De La T5.1: Decisions Preliminars De Desplegament

## Estat

Nota de planificació (agost de 2026) que recull les decisions de desplegament
confirmades amb la persona mantenidora i les preguntes que queden obertes per a
la T5.1 de
[`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md).

La nota es va revisar després de separar el desplegament de producció i els
previews en les fases 5 i 6. Les propostes inicials de migrar els nameservers a
Cloudflare i utilitzar `*.preview.mountainrunners.cat` queden substituïdes per la
decisió posterior: la fase 5 manté Hostinger com a DNS autoritatiu i la fase 6
reinvestiga Cloudflare, DNS, TLS i domini de previews sense donar cap proveïdor
per aprovat.

La fase 4 es va completar el 16 d'agost de 2026 i ja no bloqueja T5.1. Aquesta
nota no substitueix la ratificació formal de T5.1: cap acció remota sobre DNS,
VPS, entorns o secrets s'executa abans, i qualsevol canvi requerirà l'aprovació
explícita de la persona mantenidora en el moment corresponent.

## Decisions Preliminars Confirmades

| Àmbit               | Decisió                                                                | Què comporta                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Destí de producció  | VPS de Hetzner amb Caddy.                                              | Cal confirmar mida, administració i accés a T5.1; la web continua sent una compilació Astro estàtica d'acord amb l'ADR 0001.    |
| Correu              | El correu continua a Hostinger i ha de seguir funcionant com fins ara. | Preservar MX, SPF, DKIM, DMARC, `mail`, `autodiscover`, `autoconfig` i qualsevol altre registre de correu durant el tall web.   |
| Registre del domini | Hostinger continua sent la interfície de gestió del domini.            | Openprovider consta com a registrador al registre de `.cat`; la renovació i la gestió continuen a través de Hostinger.          |
| DNS de producció    | Hostinger continua sent el DNS autoritatiu durant la fase 5.           | Només es modifiquen l'apex i `www` per apuntar a Hetzner; no es canvien nameservers, DNSSEC ni registres de serveis no migrats. |
| Host de validació   | La release es valida abans del tall en un host temporal aprovat.       | Pot utilitzar un subdomini creat a Hostinger o resolució local controlada, amb TLS de Caddy i `X-Robots-Tag: noindex`.          |
| Desplegament        | Primer tall supervisat i autodeploy posterior des de `main` protegida. | La primera activació requereix aprovació; després, cada merge validat pot activar-se automàticament amb smoke tests i rollback. |
| TLS                 | Caddy és el terminador TLS de producció i del host de validació.       | Certificats públics amb el challenge aprovat; les decisions TLS de previews queden íntegrament a la fase 6.                     |
| Previews            | S'han separat de producció i corresponen a la fase 6.                  | No bloquegen el llançament. La fase 6 exigeix un domini registrable separat i reavalua Cloudflare, wildcards i proveïdors.      |
| Cloudflare          | No s'adopta ni es configura a la fase 5.                               | Pot ser una opció de la fase 6, però necessita comparativa, revisió de seguretat, privacitat, cost i pla de sortida.            |
| Identitats al VPS   | Identitats separades de desplegament i de Caddy.                       | Deploy no és `root`, no gestiona TLS ni Caddy i només carrega, verifica i activa releases; Caddy només llegeix la release.      |
| HSTS                | S'activa només després de validar TLS i els subdominis afectats.       | Començar amb una política prudent; no usar `includeSubDomains` fins que l'inventari i els serveis siguin compatibles.           |

## Preguntes Obertes Per A La T5.1

Aquestes decisions s'han de tancar amb evidència traçable i revisió humana. Les
respostes confirmades es registren a
[`docs/phase-5-t51-decisions.md`](phase-5-t51-decisions.md):

1. **Administració del VPS**: mida del servidor de Hetzner, responsable,
   hardening, actualitzacions, còpies de configuració i forma d'accés aprovada.
2. **Entorn de producció**: persona que aprova el primer tall, restricció a
   `main`, secret de desplegament i criteri per retirar el gate manual després de
   la primera release estable.
3. **Canal privat de vulnerabilitats**: mecanisme, persona responsable i prova
   privada abans del primer desplegament públic.
4. **Política de logs**: camps aprovats, accés, retenció i esborrat, coherent amb
   les polítiques públiques de privacitat.
5. **Headers mínims i CSP**: CSP sense comodins ni `unsafe-eval`; `frame-src`
   limitat als orígens aprovats si es mantenen els vídeos.
6. **Caché**: política curta per als recursos editorials sense hash i revalidació
   per a HTML, sitemap i robots.
7. **Reversió inicial**: temps de conservació de l'allotjament anterior, TTL,
   responsable i procediment per restaurar els registres web de Hostinger.

## Comprovacions Abans Del Tall Web

La T5.3 prepara la infraestructura sense canviar producció i la T5.5 aplica el
tall. Abans cal:

- exportar l'inventari i els TTL actuals des de Hostinger;
- identificar exactament els registres de l'apex i `www` que es substituiran;
- preservar i tornar a verificar MX, SPF, DKIM, DMARC, `mail`, `autodiscover`,
  `autoconfig` i la resta de serveis no migrats;
- obtenir i provar una URL directa de webmail de Hostinger que no depengui de
  `https://mountainrunners.cat/webmail`;
- reduir els TTL només amb el marge temporal aprovat i conservar els valors
  anteriors per a la reversió;
- no publicar un registre `AAAA` fins que IPv6, el tallafoc, Caddy i els smoke
  tests funcionin per IPv6;
- validar al host temporal TLS, 404, headers, caché, logs, rutes, idiomes i
  reversió abans d'apuntar el domini públic.

## Condicionants Tècnics Registrats

- El primer rollback pot requerir restaurar DNS cap a Hostinger perquè encara no
  existeix una release anterior elegible a Hetzner. Els rollbacks posteriors
  canvien atòmicament la release activa sense tocar DNS.
- Una execució de deploy retardada no pot activar un commit més antic que el
  commit desitjat actual de `main`; només el workflow protegit de rollback pot
  activar una release anterior.
- El runner de CI és efímer i allotjat per GitHub. No s'instal·la cap runner
  d'Actions al VPS de producció.
- Cap agent ni sessió local toca DNS o producció directament. Les credencials
  viuen al job mínim de l'entorn protegit i no arriben al build.
- Els previews són contingut actiu no fiable. La fase 6 no pot reutilitzar la
  zona DNS editable, les cookies, caches, credencials ni namespaces de producció.
- Si una decisió futura canvia una frontera arquitectònica —per exemple,
  proxificar producció amb Cloudflare—, cal l'ADR i la revisió corresponents.

## Ordre Previst

Amb la fase 4 completada, l'ordre és: T5.1 (decisions i gate) → T5.2 (artefacte
immutable) → T5.3 (Hetzner, Caddy, releases i reversió) → T5.4 (desplegament
continu des de `main`) → T5.5 (tall, validació i operació).

La fase 6 comença després amb T6.1 (requisits i amenaces), T6.2 (decisió de
domini, DNS, TLS i proveïdor) i les tasques d'implementació dels previews. Cada
tasca té worktree, branca i PR propis.

## Preparatius Que La Persona Mantenidora Pot Fer Ara

Passos sense impacte en el funcionament actual:

- confirmar el compte, la regió, la mida prevista i la persona administradora
  del VPS de Hetzner sense provisionar-lo encara des d'una sessió d'agent;
- exportar els registres DNS actuals de Hostinger i verificar qui administra el
  correu;
- obtenir i provar l'URL directa de webmail de Hostinger;
- confirmar la persona responsable del primer tall, rollback, logs i incidències;
- activar i provar el canal privat de vulnerabilitats pel procediment aprovat.

No cal crear ara cap compte o zona a Cloudflare per completar la fase 5.

## Fonts

- [`docs/deployment.md`](deployment.md): direcció i límits operatius de
  producció.
- [`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md):
  tasques T5.1 a T5.5 de publicació i operació.
- [`docs/specs/phase-6-pull-request-previews.md`](specs/phase-6-pull-request-previews.md):
  recerca i implementació posterior dels previews.
- ADR 0001 (web estàtica i contingut en Git) i ADR 0003 (flux d'agents i
  seguretat).
- [`docs/validation/phase-4-design-review.md`](validation/phase-4-design-review.md):
  registre final del tancament de la fase 4.
