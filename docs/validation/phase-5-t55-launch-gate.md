# Gate De Llançament De La T5.5

## Estat

Checklist del tall, la validació i el període d'observació de la T5.5.
Completada el 28 d'agost de 2026: tall i smoke, gate complet, HSTS, 48 hores
d'observació i retirada del gate de `production` registrats. Aquest document
no certifica WCAG 2.2 AA.

El procediment operatiu és al [`docs/runbook.md`](../runbook.md). L'inventari
DNS és a [`docs/phase-5-t55-dns-inventory.md`](../phase-5-t55-dns-inventory.md).

## Abans Del Tall

- [x] Canal privat de vulnerabilitats operatiu (T5.1, 16 d'agost de 2026).
- [x] Polítiques públiques de privacitat i cookies coherents amb Hetzner,
      YouTube i els logs.
- [x] VPS bootstrapjat, host de validació amb TLS i `X-Robots-Tag: noindex`.
- [x] Entorn GitHub `production` creat, restringit a `main`, amb required
      reviewers.
- [x] Entorn GitHub `production-rollback` creat, restringit a `main`, amb
      required reviewers permanents i els mateixos noms de variables i
      secrets que `production`.
- [x] Almenys una release elegible activa al host de validació.
- [x] Export de hPanel i `dig` de correu/web conservats fora del repositori.
- [x] TTL de l'apex i `www` reduïts i esperats.
- [x] Sessió a `https://mail.hostinger.com` amb la bústia institucional.
- [x] Backups del VPS actius al Cloud Console de Hetzner.

## Tall I Smoke

- [x] `import Caddyfile.production` actiu **abans** del canvi DNS, `caddy
validate` i Caddy reiniciat.
- [x] Registres web de l'apex i `www` apuntant a la IPv4 del VPS; AAAA d'apex
      i `www` esborrats; CNAME de `www` retirat.
- [x] `dig` de MX/TXT/DKIM/`mail`/autodiscover/autoconfig igual que abans del
      tall; apex i `www` només amb la IPv4 del VPS, sense CNAME de `www` ni
      AAAA web; `mail` sense registre nou.
- [x] TLS vàlid a `https://mountainrunners.cat` i `https://www.mountainrunners.cat`.
- [x] `node tools/server/verify/verify-site.mjs --base-url https://mountainrunners.cat --expect-indexable`.
- [x] Correu institucional enviat i rebut; `https://mail.hostinger.com`
      operatiu.
- [x] `SMOKE_BASE_URL=https://mountainrunners.cat` i
      `SMOKE_EXPECT_NOINDEX=false` a `production` i a `production-rollback`.

## Gate Complet

- [x] `pnpm validate` del commit desplegat (CI de `main`).
- [x] `pnpm lighthouse` dins dels llindars i pressupostos aprovats.
- [x] Navegació representativa `ca` / `es` / `en`: portada, hub
      d'esdeveniments, un detall i 404.
- [x] Revisió manual d'accessibilitat de llançament (teclat, contrast,
      lector de pantalla en una mostra). No s'afirma conformitat WCAG
      completa.
- [x] `sudo mountain-release health` OK.
- [x] Logs d'accés i d'error al VPS amb els camps i la rotació de T5.1,
      sense query string ni secrets.
- [x] Reversió interna executada amb èxit via `production-rollback` i
      release desitjada reactivada.

## HSTS I Observació

- [x] HSTS activat després de validar TLS, sense `includeSubDomains`, i
      comprovat amb `--expect-hsts`.
- [x] 48 hores d'observació sense incidència de tall, correu o TLS.
- [x] Required reviewers retirats **només** de l'entorn `production` per la
      persona mantenidora. `production-rollback` els conserva. Data: 28 d'agost
      de 2026.

El workflow `Rollback production` continua amb aprovació humana a
`production-rollback` després de retirar el gate de desplegament rutinari.
