# ADR 0012: Comprovacions Locals Ràpides I CI Com A Autoritat

## Estat

Acceptada per la persona mantenidora el 12 d'octubre de 2026.

## Context

El hook `pre-push` executava `pnpm validate`, la mateixa ordre que el workflow
`Quality`. Aquesta ordre inclou el build i tota la suite de Playwright als sis
projectes de navegador i viewport. Repetir-la a cada push local fa lenta la feina
diària i duplica comprovacions que la CI ja executa de manera autoritativa.

El requisit de la fase 1 «`pnpm validate` ha de ser la mateixa entrada utilitzada
pel hook de pre-push i per la CI» queda substituït, només pel que fa al hook
local, per aquesta decisió.

## Decisió

El hook `pre-push` executa `pnpm check:local`: formatació, lint, typecheck i
Vitest. No executa el build, les proves operatives de servidor ni la suite E2E.

El hook ràpid no autoritza lliurar sense provar. Si el canvi afegeix o modifica
un recorregut E2E, la persona que desenvolupa ha d'executar les proves E2E
afectades localment abans de declarar la feina feta; la CI continua executant la
suite completa.

La CI continua executant el gate complet: `pnpm check` (formatació, lint,
typecheck, Vitest i proves operatives) i `pnpm test:e2e` (build i Playwright),
equivalents a `pnpm validate`. El build no fiable de previews també manté
`pnpm validate`.

L'ordre `pnpm validate` no canvia i continua sent l'entrada completa per
reproduir la CI quan calgui.

## Conseqüències

- El feedback local és ràpid i la CI continua sent l'autoritat de les
  comprovacions obligatòries.
- Els errors que només detecten les proves de servidor o l'E2E no es veuen al
  hook; els de servidor es veuen a CI i els E2E afectats pel canvi s'han
  d'executar localment. Cal `pnpm check` o `pnpm validate` quan el canvi ho
  requereixi.
- `pnpm check:local` no substitueix cap comprovació obligatòria de CI ni les
  proves E2E que el canvi afecti.
