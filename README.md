# Mountain Runners

Web de codi obert de l'associació esportiva Mountain Runners del Berguedà.

## Estat

Aquest repositori conté l'aplicació Astro estàtica implementada fins a la fase 4,
el model editorial validat, la infraestructura multiidioma, el sistema visual i
les normes de col·laboració. Aquesta branca afegeix els hubs de notícies i blog:
75 rutes canòniques, 27 en català i 24 en cada altre idioma, a més dels recursos
tècnics globals. La notícia del local i els dos articles de blog estan marcats
per publicar després de l'aprovació editorial del 8 d'octubre de 2026; el merge
i el desplegament continuen pendents.

La fase 4 es va completar el 16 d'agost de 2026 i el seu tancament és a `main`.
La fase 5 ha completat la T5.1 (decisions), la T5.2 (artefacte), la T5.3
(servidor i releases) i la T5.4 (desplegament continu des de `main`). L'apex
ja serveix des del VPS (T5.5); resten el gate de llançament, HSTS, l'entorn
`production-rollback` i el període d'observació. Els previews i la decisió
sobre Cloudflare s'han separat a la fase 6.

## Desenvolupament Local

Cal utilitzar Node 24.11.0, pnpm 10.33.0 mitjançant Corepack i Gitleaks 8.30.1
per als hooks locals. Consulta les [instruccions d'instal·lació de Gitleaks a
cada sistema operatiu](CONTRIBUTING.md#eines-locals).

```sh
corepack enable
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm exec playwright install chromium firefox webkit
pnpm dev
```

`PUBLIC_SITE_ORIGIN` is the public build-time origin used for canonical URLs,
`hreflang`, the sitemap and `robots.txt`. Preview and production deployments
must provide their own value.

`pnpm validate` executa el gate complet (format, lint, typecheck, tests
unitaris, proves de servidor i Playwright), igual que la CI. `pnpm check` n'omet
Playwright i `pnpm check:local`, el hook `pre-push`, n'omet també les proves de
servidor. `pnpm lighthouse` és una auditoria manual separada.

### Consultar Plausible amb una skill

La skill de projecte
[`plausible-analytics`](.agents/skills/plausible-analytics/SKILL.md) consulta
l'API Stats v2 directament, sense servidor MCP ni dependències addicionals.
Està limitada al lloc `mountainrunners.cat` i només fa consultes de lectura.
No canvia el tracker públic ni incorpora secrets al build.

Abans d'iniciar OpenCode o Pi, exporta `PLAUSIBLE_BASE_URL` amb l'origen HTTPS
de la instància i `PLAUSIBLE_API_KEY` amb una clau Stats de lectura que tingui
accés al lloc. Es reutilitzen les variables de la integració anterior; el
script no carrega fitxers `.env`. No desis ni imprimeixis la clau.
`--use-system-ca` afegeix els certificats de confiança del sistema sense
desactivar la verificació TLS.

```sh
node --use-system-ca .agents/skills/plausible-analytics/scripts/query.mjs <<'JSON'
{"metrics": ["pageviews"], "date_range": "7d"}
JSON
```

Pi descobreix la skill a `.agents/skills/`; es pot invocar explícitament amb
`/skill:plausible-analytics`. OpenCode utilitza el directori de skills de
projecte configurat a `opencode.json`. Després de substituir la integració,
fes `/reload` a Pi o reinicia OpenCode per deixar de carregar el MCP anterior.
`pnpm test:analytics` executa les proves del client sense accés de xarxa ni
credencials reals.

Per auditar també els pilots d'esborrany, construeix un preview amb el mode i
l'origen explícits, i executa el runner sobre aquell mateix artefacte:

```sh
PUBLIC_PREVIEW=true PUBLIC_SITE_ORIGIN=https://pr-999.preview.mountainrunners.cat BUILD_TODAY=2026-10-04 pnpm build
PUBLIC_PREVIEW=true node tools/lighthouse/run-lighthouse.mjs
```

El runner exigeix HTTP 200 a totes les rutes abans d'auditar-les. Els pilots
continuen amb `noindex`; el llindar SEO 100 pot fer fallar l'auditoria de preview
per aquest motiu. No s'ha de retirar la protecció ni rebaixar el llindar.

## Arquitectura

- Web estàtica: Astro, TypeScript i Content Collections amb Zod.
- Font de veritat: contingut estructurat i versionat a Git.
- Allotjament: VPS de Hetzner darrere de Caddy, amb desplegament continu des
  de `main` (T5.4); el tall públic és la T5.5.
- Xat públic: servei Hono separat, de només lectura, previst per a una fase
  posterior.
- Assistent editorial futur: flux privat i controlat que crea branques, valida
  canvis i obre pull requests. No desplega directament.

Llegeix [l'arquitectura tècnica](docs/architecture.md) abans de modificar
l'arquitectura. Les normes generals per a persones i agents són a
[AGENTS.md](AGENTS.md).

El [mapa de documentació](docs/README.md) diferencia les fonts vigents dels
inventaris, referències i registres històrics.

La planificació de producte i desenvolupament és a
[docs/roadmap.md](docs/roadmap.md).
Les necessitats encara no planificades es recullen al
[backlog de necessitats](docs/backlog.md).

## Seguretat I Contribucions

- El projecte es publica sota la [llicència MIT](LICENSE).
- No pugis credencials al repositori ni despleguis des d'un directori de treball
  local.
- Segueix [CONTRIBUTING.md](CONTRIBUTING.md), incloent-hi Conventional Commits.
- Segueix [SECURITY.md](SECURITY.md) per comunicar vulnerabilitats de manera
  responsable.
