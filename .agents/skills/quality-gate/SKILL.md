---
name: quality-gate
description: Use when implementing or reviewing public pages of the Mountain Runners web app to load the local quality gate: governing documents, mandatory commands, representative routes and viewports, Lighthouse thresholds, budgets and required evidence.
---

# Mountain Runners Quality Gate

Local wrapper that adapts general quality skills (`accessibility`, `seo`) and
external recommendations to this project. It activates whenever you implement,
modify or review public pages.

## Governing Documents

- Design and visual decisions: `DESIGN.md`.
- Architecture and content boundaries: `docs/architecture.md`,
  `docs/content-model.md` and `docs/decisions/` (ADRs).
- Product requirements and security: `docs/roadmap.md`, `docs/backlog.md`,
  `SECURITY.md`.
- This phase: `docs/specs/phase-2-public-vertical-slice.md`.

Local instructions and accepted ADRs always take precedence over external
recommendations (skills, blogs, checklists).

## Mandatory Commands

Run the smallest relevant check before declaring work complete:

| Command                | Responsibility                                        |
| ---------------------- | ----------------------------------------------------- |
| `pnpm check`           | Format, lint, typecheck and Vitest                    |
| `pnpm test:e2e`        | Playwright journeys in Chromium, Firefox and WebKit   |
| `pnpm test:a11y`       | axe automated accessibility checks                    |
| `pnpm lighthouse`      | Lighthouse scores and budgets on representative routes|
| `pnpm validate`        | All mandatory checks of the phase                     |

`pnpm check` no construeix ni fixa el rellotge. Les ordres que construeixen i
serveixen el build (`pnpm test:e2e`, `pnpm test:a11y`, `pnpm lighthouse`)
executen amb `PUBLIC_SITE_ORIGIN=https://mountainrunners.cat` i
`BUILD_TODAY=2026-08-04` per mantenir builds i assertions deterministes; la CI
els defineix també a nivell de job.

## Representative Routes And Viewports

Minimum sample: homepage (`/ca/`), events hub (`/ca/esdeveniments/`) and one
event detail (e.g. `/ca/esdeveniments/ultra-pirineu/`), plus the 404 page.

- Functional and responsive journeys run on desktop (1280x720) and mobile
  (320x720) across Chromium, Firefox and WebKit.
- axe checks run on Chromium in both viewports over all representative
  templates, including the 404.
- Lighthouse runs on mobile (390x844) over the routes picked from the built
  sitemap.

## Mandatory Thresholds And Budgets

On mobile, for homepage, hub and one representative detail:

| Check                                   | Threshold |
| --------------------------------------- | --------- |
| Lighthouse Performance                  | >= 90     |
| Lighthouse Accessibility                 | 100       |
| Lighthouse Best Practices               | 100       |
| Lighthouse SEO                          | 100       |
| Largest Contentful Paint (lab)          | <= 2.5 s  |
| Cumulative Layout Shift                 | <= 0.1    |
| Total Blocking Time                     | <= 200 ms |
| JavaScript transfer (all requests)      | <= 30 KiB |
| CSS transfer (all requests)             | <= 50 KiB |
| Fonts transfer (all requests)           | <= 200 KiB|
| Largest single image                    | <= 300 KiB|
| Total transfer (all requests)           | <= 1.5 MiB|

Budgets live in `tools/lighthouse/budgets.json` and are enforced by
`tools/lighthouse/run-lighthouse.mjs`, which also writes JSON reports to
`artifacts/lighthouse/`. Measurements are conservative upper bounds of the
spec's "initial, compressed" budgets: the preview server serves the build
uncompressed and every network request of a type is counted. Thresholds must
never be relaxed silently; if Lighthouse is variable, use multiple runs and the
median.

## Required Evidence

For any public-page change, record:

- results of the applicable commands (scores, budgets, tests);
- sitemap, robots, canonical, social metadata and JSON-LD validation (covered
  by unit and E2E tests, not only by Lighthouse scores);
- visual or content evidence when the change is user-visible;
- accessibility, SEO, performance, security and licensing impact notes.

## Scope Limits

- Automated checks alone never prove full WCAG 2.2 AA compliance; a manual
  audit remains a separate backlog need. Do not claim complete conformance.
- External URLs are validated structurally only; remote availability checks
  are out of scope.
- Do not scaffold analytics, third-party scripts or new services to satisfy
  quality checks.
