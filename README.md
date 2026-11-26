# Mountain Runners

Web de codi obert de l'associació esportiva Mountain Runners del Berguedà.

## Estat

El repositori conté la web estàtica de l'associació, amb contingut en català,
castellà i anglès i seccions de notícies i blog. La web es desplega des de
`main`. El [roadmap](docs/roadmap.md) recull l'estat de cada fase.

## Desenvolupament Local

Instal·la les versions requerides a [Eines locals](CONTRIBUTING.md#eines-locals).

```sh
corepack enable
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm dev
```

`PUBLIC_SITE_ORIGIN` és l'origen públic que el build usa per a les URL
canòniques, `hreflang`, el sitemap i `robots.txt`. Cada entorn defineix el seu.

Consulta [l'estratègia de proves](docs/testing-strategy.md#validació-i-evidència)
per triar les comprovacions locals i veure què afegeix la CI.

### Consultar Plausible amb una skill

Segueix [`plausible-analytics`](.agents/skills/plausible-analytics/SKILL.md)
per consultar les estadístiques de la web.

### Auditar un build de preview

Construeix la preview amb el mode i l'origen explícits, i executa Lighthouse
sobre aquell mateix artefacte:

```sh
PUBLIC_PREVIEW=true PUBLIC_SITE_ORIGIN=https://pr-999.preview.mountainrunners.cat pnpm build
PUBLIC_PREVIEW=true node tools/lighthouse/run-lighthouse.mjs
```

El runner exigeix HTTP 200 a totes les rutes abans d'auditar-les. El `noindex`
pot fer fallar l'auditoria SEO de preview. No retiris la protecció ni rebaixis el
llindar.

## Arquitectura

- Web estàtica: Astro, TypeScript i Content Collections amb Zod.
- Font de veritat: contingut estructurat i versionat a Git.
- Allotjament: [VPS de Hetzner amb Caddy](docs/operations/README.md).
- [Agent privat de Telegram](tools/server/agent/README.md): consultes i canvis
  de codi i contingut. Consulta el [runbook](docs/operations/agent.md) per operar-lo.
- Xat públic: servei Hono separat, de només lectura, previst per a una fase
  posterior.

Llegeix [l'arquitectura tècnica](docs/architecture.md) abans de modificar
l'arquitectura. Les normes generals per a persones i agents són a
[AGENTS.md](AGENTS.md).

El [mapa de documentació](docs/README.md) diferencia les fonts vigents dels
inventaris, referències i registres històrics.

Les necessitats encara no planificades es recullen al
[backlog de necessitats](docs/backlog.md).

## Seguretat I Contribucions

- El projecte es publica sota la [llicència MIT](LICENSE).
- No pugis credencials al repositori ni despleguis des d'un directori de treball
  local.
- Segueix [CONTRIBUTING.md](CONTRIBUTING.md), incloent-hi Conventional Commits.
- Segueix [SECURITY.md](SECURITY.md) per comunicar vulnerabilitats de manera
  responsable.
