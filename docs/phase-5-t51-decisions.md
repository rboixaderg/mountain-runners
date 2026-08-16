# T5.1: Decisions I Porta De Llançament

## Estat

Registre de la T5.1 de
[`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md),
completada el 16 d'agost de 2026 amb la confirmació de la persona mantenidora.
La fase 4 està tancada i verificada; no queda cap decisió oberta que bloquegi la
T5.2.

Aquest document ratifica les decisions preliminars de
[`docs/phase-5-t51-preparacio.md`](phase-5-t51-preparacio.md) i registra les
respostes a les preguntes obertes amb la seva evidència.

## Decisions Confirmades

### VPS

- VPS de Hetzner administrat per la persona mantenidora, amb accés per SSH amb
  clau i usuari administratiu no `root` amb `sudo`.
- La restauració de les còpies de seguretat es prova dins del runbook de la
  T5.3.

### Desplegament I Entorn De Producció

- El primer tall l'aprova manualment la persona mantenidora, que pot executar
  accions manuals durant el tall si cal.
- L'entorn de producció resta restringit a la branca `main` i el job de build no
  rep credencials de producció.
- El gate manual es retira només quan la T5.5 registra el període d'observació
  superat i els smoke tests i les vies de reversió verificades.

### Canal Privat De Vulnerabilitats

- Mecanisme: Private Vulnerability Reporting de GitHub, amb un `SECURITY.md`
  públic que descriu com reportar.
- Persona responsable: la persona mantenidora.
- Activat el 16 d'agost de 2026 per la persona mantenidora. La prova privada
  (informe de prova i confirmació de recepció) queda registrada a l'apartat
  final d'aquest document.

### Logs

Només tres registres, tots allotjats al VPS:

| Registre | Contingut                                                         | Ubicació                                  | Retenció               |
| -------- | ----------------------------------------------------------------- | ----------------------------------------- | ---------------------- |
| Access   | Temps, IP, mètode, path sense query string, status, bytes, durada | `/var/log/mountain-runners/access.log`    | 7 dies, rotació diària |
| Error    | Fallades TLS/ACME i errors del servidor                           | `/var/log/mountain-runners/error.log`     | 30 dies                |
| Releases | Commit, digest SHA-256, data i estat de cada release              | `/var/lib/mountain-runners/releases.json` | Permanent              |

- Accés només per `root` via sudo; cap credencial ni query sensible als logs.
- La política pública de privacitat s'actualitza a la T5.3 amb el hosting i els
  logs que s'activaran.

### Headers Mínims I CSP

CSP aprovada, sense comodins ni `unsafe-eval`:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self';
font-src 'self';
frame-src https://www.youtube-nocookie.com;
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
object-src 'none';
```

Justificació verificada sobre el build actual: la web no conté JavaScript
executable propi (només JSON-LD, que no s'executa) i els vídeos s'incrusten
exclusivament des de `www.youtube-nocookie.com`, per això `frame-src` es limita
a aquest orígen. `style-src 'unsafe-inline'` és necessari perquè Astro emet
`<style>` inline; no es fa servir `unsafe-eval` en cap directiva.

Headers mínims addicionals: `X-Content-Type-Options: nosniff`, una
`Referrer-Policy` restrictiva i una `Permissions-Policy` que desactiva
capacitats no utilitzades. HSTS s'activa després de validar TLS i els subdominis
afectats, sense `includeSubDomains`.

### Caché

- Assets amb nom versionat (`/_astro/*`): caché immutable llarga (1 any).
- Recursos editorials sense hash (`/content-resources/**`): `max-age=3600,
must-revalidate`.
- HTML, `sitemap.xml`, `robots.txt` i 404: `no-cache, must-revalidate`.

### Reversió I Tall

- El tall només modifica els registres web de l'apex i `www` per apuntar a la IP
  del VPS de Hetzner; la resta de la zona es preserva.
- **No es manté l'allotjament anterior com a servei de reversió.** La reversió
  rutinària és interna: activar una release anterior elegible a Hetzner sense
  tocar DNS. Si no queda cap release elegible, s'aplica la resposta
  d'emergència que defineix el runbook.
- L'inventari i els valors anteriors dels registres queden exportats del hPanel
  de Hostinger abans del tall, perquè una restauració manual sigui possible com
  a via extraordinària amb aprovació explícita, però no és la via prevista.
- Aquesta decisió substitueix el text de la spec que conservava temporalment
  l'allotjament anterior com a opció de reversió DNS.

## Riscos Registrats

- Sense una reversió DNS prevista, el risc es concentra en la qualitat de la
  release activada i en les vies de reversió interna; per això la T5.4 exigeix
  smoke tests i rollback comprovats abans del tall.
- El correu i els serveis no migrats continuen a Hostinger: la T5.5 verifica
  MX, SPF, DKIM, DMARC, `mail`, `autodiscover` i `autoconfig` abans i després
  del tall, i es confirma una URL de webmail independent de l'apex.
- No es publica un registre `AAAA` fins que IPv6, el tallafoc, Caddy i els smoke
  tests funcionin per IPv6.
- Els logs contenen dades personals (IP): accés restringit, retenció curta i
  esborrat definit al runbook.
- El canal privat de vulnerabilitats ha d'estar activat i provat abans del
  primer desplegament públic; fins llavors, cap ruta de producció s'activa.

## Responsables

- Persona mantenidora: administració del VPS, aprovació del primer tall, canal
  privat de vulnerabilitats, decisions de logs i caché, rollback i resposta a
  incidències.

## Comprovació Del Canal Privat De Vulnerabilitats

- [x] Canal activat el 16 d'agost de 2026 per la persona mantenidora
      (Settings → Security → Private vulnerability reporting → Enable).
- [x] Prova privada rebuda i tancada el 16 d'agost de 2026.

El canal és operatiu i comprovat; cap desplegament públic no s'inicia fins que
aquesta comprovació està registrada, i ja ho està.
