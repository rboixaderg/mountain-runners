# ADR 0007: Biome Com A Cadena De Lint I Format

## Estat

Acceptada.

## Context

La fase 1 va fixar ESLint amb `typescript-eslint`, `eslint-plugin-astro` i
`eslint-plugin-yml`, i Prettier amb connectors per a Astro i Tailwind. Aquest
conjunt i `astro check` depenen de l'API programàtica de TypeScript 6.
TypeScript 7.0 no l'exposa (arriba a 7.1). Un bump agrupat de Dependabot a
TypeScript 7 feia fallar `pnpm lint` via `typescript-eslint` i, un cop retirat
ESLint, també `pnpm typecheck` via `@astrojs/language-server`.

Microsoft documenta que els projectes Astro, Vue i Svelte han de continuar amb
TypeScript 6 fins que existeixi l'API de 7.1. El lint de YAML editorial no
depenia d'ESLint: el loader restringit de `apps/web/src/lib/content/yaml.ts`
continua rebutjant àncores, aliases, claus duplicades i documents inseguros.

## Decisió

- Utilitzar Biome 2 per al lint i el format de JavaScript, TypeScript, JSON, CSS
  i el frontmatter d'Astro.
- Conservar Prettier només per a Markdown i YAML, fins que Biome els suporti de
  manera estable.
- Mantenir TypeScript 6.0.x i Node 24.11.0, amb `@types/node` a la línia 24, fins
  que `astro check` suporti TypeScript 7.1.
- No activar el suport HTML experimental complet de Biome per als fitxers Astro:
  el parser encara no accepta fragments `<>`.
- Mantenir la validació del YAML editorial al loader restringit i als esquemes
  Zod; no reintroduir ESLint només per a YAML.

## Raonament

Biome no depèn de l'API de compilador de TypeScript, de manera que deixa de
bloquejar el lint quan Dependabot puja TypeScript. No substitueix `astro check`:
adoptar TypeScript 7 com a paquet `typescript` trencaria el typecheck d'Astro.
Un únic binari de lint redueix la superfície de connectors ESLint/Prettier. Node
24 continua sent el runtime fixat.

## Conseqüències

- `pnpm lint` executa Biome; `pnpm format` aplica Biome i, després, Prettier a
  Markdown i YAML.
- Les ordres públiques `pnpm check` i `pnpm validate` no canvien de nom.
- Dependabot ignora els majors de `@types/node` i separa els majors de
  desenvolupament dels minors i patches.
- L'adopció de TypeScript 7 com a compilador del projecte requereix un ADR
  substitutiu quan Astro exposi suport per a l'API 7.1.
- Un retorn a ESLint o un canvi de runtime de Node requereix un ADR substitutiu.
