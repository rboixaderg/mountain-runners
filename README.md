# Mountain Runners

Web de codi obert de l'associació esportiva Mountain Runners del Berguedà.

## Estat

Aquest repositori conté l'aplicació Astro estàtica implementada fins a la fase 4,
el model editorial validat, la infraestructura multiidioma, el sistema visual i
les normes de col·laboració. La sortida actual genera 66 rutes canòniques: 22 en
català, 22 en castellà i 22 en anglès, a més dels recursos tècnics globals.

La fase 4 es va completar el 16 d'agost de 2026 i el seu tancament és a `main`.
La fase 5 ha completat la T5.1 (decisions), la T5.2 (artefacte), la T5.3
(servidor i releases) i la T5.4 (desplegament continu des de `main`). La T5.5
documenta el tall DNS, el gate de llançament i el període d'observació; cap
canvi DNS ni activació pública no s'executa sense aprovació explícita de la
persona mantenidora. Els previews i la decisió sobre Cloudflare s'han separat
a la fase 6.

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

`pnpm validate` executa format, lint, typecheck, tests unitaris i recorreguts
Playwright, incloses les comprovacions axe aplicables, amb les mateixes
condicions que la integració contínua. `pnpm check` ofereix les comprovacions
ràpides (format, lint, typecheck i tests). `pnpm lighthouse` és una auditoria
manual separada, fora de `pnpm validate` i de la CI, que valida les rutes
representatives contra els llindars i pressupostos configurats.

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
