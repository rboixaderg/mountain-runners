# Mountain Runners

Web de codi obert de l'associació esportiva Mountain Runners del Berguedà.

## Estat

Aquest repositori conté la base executable de l'aplicació Astro, el model
editorial validat, la infraestructura multiidioma, la direcció de disseny i les
normes de col·laboració. Les plantilles visuals i el contingut públic definitiu
encara no s'han implementat.

## Desenvolupament Local

Cal utilitzar Node 24.11.0, pnpm 10.33.0 mitjançant Corepack i Gitleaks 8.30.1
per als hooks locals. Consulta les [instruccions d'instal·lació de Gitleaks a
cada sistema operatiu](CONTRIBUTING.md#eines-locals).

```sh
corepack enable
pnpm install
pnpm dev
```

`pnpm validate` executa format, lint, typecheck, tests i build amb les mateixes
condicions que la integració contínua.

## Arquitectura

- Web estàtica: Astro, TypeScript i Content Collections amb Zod.
- Font de veritat: contingut estructurat i versionat a Git.
- Allotjament: un VPS modest darrere de Caddy.
- Xat públic: servei Hono separat, de només lectura, previst per a una fase
  posterior.
- Assistent editorial: flux privat i controlat que crea branques, valida canvis
  i obre pull requests. No desplega directament.

Llegeix [l'arquitectura tècnica](docs/architecture.md) abans de modificar
l'arquitectura. Les normes generals per a persones i agents són a
[AGENTS.md](AGENTS.md).

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
