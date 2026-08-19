# Gate De Llançament De La T5.5

## Estat

Checklist del tall, la validació i el període d'observació de la T5.5. L'apex
públic ja és operatiu (19 d'agost de 2026); les caselles romanen obertes fins
que la persona mantenidora hi registri l'evidència. Aquest document no
certifica WCAG 2.2 AA.

El procediment operatiu és al [`docs/runbook.md`](../runbook.md). L'inventari
DNS és a [`docs/phase-5-t55-dns-inventory.md`](../phase-5-t55-dns-inventory.md).

## Abans Del Tall

- [ ] Canal privat de vulnerabilitats operatiu (T5.1, 16 d'agost de 2026).
- [ ] Polítiques públiques de privacitat i cookies coherents amb Hetzner,
      YouTube i els logs.
- [ ] VPS bootstrapjat, host de validació amb TLS i `X-Robots-Tag: noindex`.
- [ ] Entorn GitHub `production` creat, restringit a `main`, amb required
      reviewers.
- [ ] Entorn GitHub `production-rollback` creat, restringit a `main`, amb
      required reviewers permanents i els mateixos noms de variables i
      secrets que `production`.
- [ ] Almenys una release elegible activa al host de validació.
- [ ] Export de hPanel i `dig` de correu/web conservats fora del repositori.
- [ ] TTL de l'apex i `www` reduïts i esperats.
- [ ] Sessió a `https://mail.hostinger.com` amb la bústia institucional.
- [ ] Backups del VPS actius al Cloud Console de Hetzner.

## Tall I Smoke

- [ ] `import Caddyfile.production` actiu **abans** del canvi DNS, `caddy
  validate` i Caddy reiniciat.
- [ ] Registres web de l'apex i `www` apuntant a la IPv4 del VPS; AAAA d'apex
      i `www` esborrats; CNAME de `www` retirat.
- [ ] `dig` de MX/TXT/DKIM/`mail`/autodiscover/autoconfig igual que abans del
      tall; apex i `www` només amb la IPv4 del VPS, sense CNAME de `www` ni
      AAAA web; `mail` sense registre nou.
- [ ] TLS vàlid a `https://mountainrunners.cat` i `https://www.mountainrunners.cat`.
- [ ] `node tools/server/verify/verify-site.mjs --base-url https://mountainrunners.cat --expect-indexable`.
- [ ] Correu institucional enviat i rebut; `https://mail.hostinger.com`
      operatiu.
- [ ] `SMOKE_BASE_URL=https://mountainrunners.cat` i
      `SMOKE_EXPECT_NOINDEX=false` a `production` i a `production-rollback`.

## Gate Complet

- [ ] `pnpm validate` del commit desplegat (CI de `main`).
- [ ] `pnpm lighthouse` dins dels llindars i pressupostos aprovats.
- [ ] Navegació representativa `ca` / `es` / `en`: portada, hub
      d'esdeveniments, un detall i 404.
- [ ] Revisió manual d'accessibilitat de llançament (teclat, contrast,
      lector de pantalla en una mostra). No s'afirma conformitat WCAG
      completa.
- [ ] `sudo mountain-release health` OK.
- [ ] Logs d'accés i d'error al VPS amb els camps i la rotació de T5.1,
      sense query string ni secrets.
- [ ] Reversió interna executada amb èxit via `production-rollback` i
      release desitjada reactivada.

## HSTS I Observació

- [ ] HSTS activat després de validar TLS, sense `includeSubDomains`, i
      comprovat amb `--expect-hsts`.
- [ ] 48 hores d'observació sense incidència de tall, correu o TLS.
- [ ] Required reviewers retirats **només** de l'entorn `production` per la
      persona mantenidora. `production-rollback` els conserva. Data:

El workflow `Rollback production` continua amb aprovació humana a
`production-rollback` després de retirar el gate de desplegament rutinari.
