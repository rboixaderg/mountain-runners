# Preparació De La T5.1: Decisions Preliminars De Desplegament

## Estat

Nota de planificació (agost de 2026) que recull les decisions de desplegament
confirmades amb la persona mantenidora en conversa i les preguntes que queden
obertes per a la T5.1 de
[`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md).

La T5.1 continua bloquejada fins que la fase 4 tanqui les discrepàncies de la
revisió de disseny i el tractament d'embeds i textos legals. Aquesta nota no
substitueix la ratificació formal de la T5.1: cap acció remota (DNS, VPS,
secrets) s'executa abans, i qualsevol canvi de DNS, entorn o servidor requerirà
l'aprovació explícita de la persona mantenidora en el moment corresponent.

## Decisions Preliminars Confirmades

| Àmbit               | Decisió                                                                            | Què comporta                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correu              | El correu continua a Hostinger i ha de seguir funcionant com fins ara.             | Replicar 1:1 els registres MX, SPF, DKIM, DMARC i qualsevol CNAME de correu (`autodiscover`, `autoconfig`) en delegar el DNS. Els hostnames de correu no es proxifiquen mai (DNS-only).                                                                             |
| Registre del domini | `mountainrunners.cat` es queda registrat a Hostinger.                              | Només es deleguen els nameservers a Cloudflare, sense transferència del registre ni del correu. La renovació continua a Hostinger.                                                                                                                                  |
| DNS i wildcards     | Cloudflare com a proveïdor de DNS, pla Free.                                       | La recerca prèvia (agost de 2026) el situa com la millor opció per a `.cat`: DNS hosting per a qualsevol TLD, registres wildcard DNS-only a tots els plans, TTL mínim de 60 s i tokens d'API limitats a la zona.                                                    |
| Host de validació   | Primer desplegament a `new.mountainrunners.cat` per validar la web abans del tall. | Coincideix amb l'host de validació previst a la T5.4. Registre A DNS-only cap al VPS, TLS amb Caddy i `X-Robots-Tag: noindex` per evitar contingut duplicat indexat.                                                                                                |
| TLS                 | Caddy és sempre el terminador TLS.                                                 | Producció i validació: certificats Let's Encrypt amb challenge HTTP-01. Previews: certificat wildcard `*.preview.mountainrunners.cat` amb challenge DNS-01 (mòdul `caddy-dns/cloudflare` i token limitat a la zona) o TLS on-demand per hostname amb llista blanca. |
| Previews            | Wildcard `*.preview.mountainrunners.cat`, DNS-only, mai proxied.                   | El SSL universal del pla Free no cobreix hostnames multi-nivell (`*.preview.*`); mantenir els previews DNS-only evita certificats de pagament i manté Caddy com a únic terminador TLS. Crear una preview equival a publicar fitxers, sense crides DNS per PR.       |
| CDN de Cloudflare   | Postergat; es pot afegir després davant d'apex i `www` sense cost.                 | Si s'activa, implica doble TLS (mode Full strict) i actualitzar les polítiques públiques de privacitat i la política de logs, perquè el trànsit passaria per Cloudflare. No s'activa d'entrada.                                                                     |
| Identitats al VPS   | Identitats separades de desplegament i de Caddy.                                   | La identitat de desplegament no és `root` i no pot escriure la configuració de Caddy, les claus TLS ni l'estat ACME; només carrega releases, verifica digests i activa atòmicament.                                                                                 |
| HSTS                | S'activa al final, després de validar TLS a tot l'arbre de subdominis.             | HSTS és irreversible per al navegador; amb `includeSubDomains` afectaria `new.` i tots els previews efímers. Primer `max-age` curt, verificació i després allargament.                                                                                              |

## Preguntes Obertes Per A La T5.1

Aquestes decisions no s'han confirmat encara i la T5.1 les ha de tancar amb
evidència traçable i revisió humana:

1. **Proveïdor i administració del VPS**: proveïdor, mida, responsable
   d'administració i forma d'accés aprovada.
2. **Política de previews**: públiques, autenticades o restringides; retenció,
   expiració i neteja.
3. **Canal privat de vulnerabilitats**: mecanisme, persona responsable i prova
   privada del canal abans de publicar cap preview.
4. **Política de logs**: camps aprovats, accés, retenció i esborrat, coherent
   amb les polítiques públiques de privacitat.
5. **Headers mínims i CSP**: la T5.1 aprova una CSP sense comodins ni
   `unsafe-eval`; `frame-src` limitat als orígens aprovats si es mantenen els
   vídeos.
6. **Caché**: política curta per als recursos editorials sense hash, i
   confirmació de la política de revalidació per a HTML, sitemap i robots.
7. **Verificació de la resolució de fase 4** sobre embeds i textos legals,
   precondició per iniciar cap preview o desplegament.

## Comprovacions Tècniques Abans Del Canvi De Nameservers

Quan la T5.4 prepari el canvi de DNS, caldrà:

- Exportar l'inventari actual de registres DNS des de Hostinger i comparar-lo
  amb els registres importats per Cloudflare, especialment MX, SPF, DKIM,
  DMARC i CNAME de correu.
- Comprovar l'estat de DNSSEC a Hostinger: desactivar-lo en fer la delegació i
  reactivar-lo amb els registres DS de Cloudflare.
- Deixar la zona de Cloudflare en estat pendent fins al canvi de nameservers i
  verificar la continuïtat del mirall actual de `mountainrunners.cat` fins al
  tall de DNS de la T5.5.
- Validar que cap hostname de correu queda proxied després de la migració.

## Condicionants Tècnics Registrats

- El registre wildcard DNS-only només encamina trànsit cap al VPS; no intervé
  en TLS ni en el contingut servit.
- Amb un wildcard actiu, qui controli la configuració de Caddy controla el que
  es serveix sota tot l'arbre de subdominis: d'aquí la separació estricta
  d'identitats al servidor.
- Cap agent ni sessió local toca DNS directament; les credencials de Cloudflare
  viuen al servei de desplegament revisat, d'acord amb els ADR 0001 i 0003.
- Les decisions d'aquesta nota apliquen la direcció acceptada (VPS + Caddy,
  web estàtica); si una decisió futura canviés una frontera arquitectònica
  (per exemple, proxificar el trànsit de producció), caldria un ADR abans
  d'implementar-la.

## Ordre Previst

La T5.1 ratifica aquestes decisions i tanca les preguntes obertes quan la fase
4 estigui tancada. Després: T5.2 (artefacte immutable) → T5.3 (previews) i
T5.4 (VPS, Caddy i canvis de DNS, inclòs el host de validació `new.`) en
paral·lel → T5.5 (tall de DNS i desplegament protegit) → T5.6 (gate final).
Cada tasca s'implementa en un worktree propi amb PR revisada.

## Preparatius Que La Persona Mantenidora Pot Fer Ara

Passos sense impacte en el funcionament actual, que la persona mantenidora pot
executar abans de la T5.1:

- Crear el compte de Cloudflare i afegir la zona `mountainrunners.cat` en
  estat pendent, sense canviar els nameservers.
- Exportar els registres DNS actuals de Hostinger i verificar els registres de
  correu.
- Comprovar l'estat de DNSSEC a Hostinger.

## Fonts

- [`docs/deployment.md`](deployment.md): direcció i límits operatius de la
  fase 5.
- [`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md):
  tasques T5.1 a T5.6, especialment les seccions de previews, Caddy, TLS,
  seguretat i privacitat.
- ADR 0001 (web estàtica i contingut en git) i ADR 0003 (flux d'agents i
  seguretat).
- [`docs/validation/phase-4-design-review.md`](validation/phase-4-design-review.md):
  discrepàncies que bloquegen el tancament de la fase 4.
