# Especificació: Cadena D'Eines Biome

## Estat

En curs. Una sola tasca d'implementació, T1.

## Objectiu

Substituir ESLint i Prettier com a linter i formatador de JS/TS/JSON/CSS/Astro
per Biome, actualitzar la resta de dependències compatibles i mantenir
TypeScript 6 i Node 24, perquè `astro check` encara no pot carregar TypeScript 7.

## Límits I Decisions Confirmades

- S'aplica l'[ADR 0007](../decisions/0007-biome-and-typescript-7.md).
- Node roman a 24.11.0, TypeScript a 6.0.x i `@types/node` a la línia 24.
- TypeScript 7 no s'adopta com a paquet `typescript` mentre `astro check`
  necessiti l'API de TypeScript 6.
- El YAML editorial continua validant-se al loader restringit i a Zod.
- Prettier es conserva només per a Markdown i YAML.
- No es migra Paraglide 2.22.0 en aquesta entrega.
- No s'activa el suport HTML experimental complet de Biome per als `.astro`.
- No es canvien rutes, contingut publicat ni selectors E2E, excepte treure una
  clau duplicada inòcua als catàlegs de missatges.

## Resultats Esperats

- `pnpm check` passa amb Biome, TypeScript 6 i les dependències actualitzades.
- ESLint i els connectors de Prettier per a Astro i Tailwind queden fora del
  lockfile.
- La documentació vigent descriu la cadena nova; la fase 1 conserva el requisit
  històric.

## Dependències I Ordre D'Inici

Cap tasca prèvia. S'implementa des de l'últim `main` en un worktree dedicat.

## Tasques, Entregues I Seguiment

| Unitat | Estat   | Dependències | Resultat verificable                   | PR  |
| ------ | ------- | ------------ | -------------------------------------- | --- |
| T1     | En curs | Cap          | Cadena Biome validada amb TypeScript 6 | -   |

### T1 Cadena D'Eines

**Abast:** migrar lint i format a Biome, mantenir TypeScript 6, actualitzar paquets
compatibles, documentar l'ADR i ajustar Dependabot.

**Exclusió immediata:** Paraglide 2.24, `@types/node` 26, suport HTML
experimental de Biome, canvis visuals o editorials.

**Dependències:** cap.

**Resultat observable:** `pnpm check` verd amb Biome i sense paquets ESLint.

**Comprovacions mínimes:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck` i
`pnpm test`.

**PR:** una sola, perquè ADR, documentació i implementació descriuen el mateix
canvi de cadena.

## Cadena D'Eines

- Biome 2.5 fa lint i format de JS, TS, JSON, CSS i el frontmatter Astro.
- Prettier formata Markdown i YAML.
- TypeScript 6.0.3 és el compilador del typecheck i del build.
- El YAML editorial no es linta amb Biome.

## Estratègia De Tests I Qualitat

Les ordres existents (`pnpm check`, `pnpm validate`) romanen l'entrada única.
No calen recorreguts E2E nous: el canvi no altera rutes ni markup publicat.

## Seguretat I Privacitat

No s'introdueixen serveis, secrets ni telemetria. Es redueix la superfície npm
d'ESLint i connectors.

## Fora D'Abast

- Migració de Paraglide.
- TypeScript 7 com a paquet `typescript` (bloquejat per `astro check`).
- Actualització de Node o `@types/node` a 26.
- Format experimental de plantilles Astro, Markdown o YAML amb Biome.
- Canvis de disseny, contingut o desplegament.

## Criteris D'Acceptació

1. `pnpm lint` executa Biome i no ESLint.
2. `pnpm typecheck` passa amb TypeScript 6.0.3.
3. `@types/node` roman a 24.x i `engines.node` és 24.11.0.
4. Markdown i YAML es comproven amb Prettier.
5. L'ADR 0007 i aquesta especificació descriuen la cadena vigent.
