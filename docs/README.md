# Mapa De Documentació

## Fonts Vigents

Quan dos documents discrepen, cal distingir comportament implementat i decisió
acceptada:

1. El codi, el contingut, els tests i els scripts de `apps/web` descriuen el
   comportament que existeix avui.
2. Els ADR de [`decisions/`](decisions/) governen les fronteres arquitectòniques.
   Una desviació del codi és deute o requereix un ADR substitutiu; no converteix
   automàticament la desviació en norma.
3. L'especificació activa governa objectiu, abast i acceptació d'una entrega. Que
   el codi estigui fusionat no prova per si sol que la fase estigui tancada.
4. `DESIGN.md` governa la direcció visual i `AGENTS.md`, `CONTRIBUTING.md` i
   `SECURITY.md` governen el procés.

## Documents Operatius

- [`architecture.md`](architecture.md): implementació actual i direcció
  arquitectònica acceptada.
- [`content-model.md`](content-model.md): contracte editorial i de publicació.
- [`code-conventions.md`](code-conventions.md): normes d'implementació de
  `apps/web`.
- [`tailwind-v4-migration-plan.md`](tailwind-v4-migration-plan.md): pla operatiu
  incremental i checkpoints de la migració Tailwind de la PR #98.
- [`roadmap.md`](roadmap.md): fases, dependències i estat general.
- [`backlog.md`](backlog.md): necessitats obertes i registre del seu triatge.
- [`deployment.md`](deployment.md): estat i límits operatius de la fase 5.
- [`runbook.md`](runbook.md): operació de producció (servidor, TLS, logs, salut,
  releases, desplegament continu, reversió, tall DNS i període d'observació).
  Inclou el diagrama Mermaid viu de l'arquitectura del VPS.
- [`phase-5-t55-dns-inventory.md`](phase-5-t55-dns-inventory.md): inventari
  públic dels registres a preservar i a substituir al tall.
- [`phase-5-t51-preparacio.md`](phase-5-t51-preparacio.md): decisions
  preliminars de desplegament que la T5.1 ha de ratificar.
- [`ai-assistant.md`](ai-assistant.md): límits dels futurs xat públic i assistent
  editorial.
- [`specs/`](specs/): requisits i acceptació de fases i tasques.

## Registres Històrics

Els documents següents es conserven per procedència i traçabilitat, però no
descriuen necessàriament l'estat actual:

- [`phase-2-editorial-inventory.md`](phase-2-editorial-inventory.md) i
  [`phase-3-editorial-inventory.md`](phase-3-editorial-inventory.md): inventaris i
  aprovacions disponibles en cada fase.
- [`design-references.md`](design-references.md): referències Stitch retirades.
- [`diari-de-treball.md`](diari-de-treball.md): relat datat del període que
  declara el mateix document.
- [`validation/`](validation/): evidència de revisions executades i punts de
  tancament, no substitut de l'especificació.

No s'actualitzen retrospectivament les observacions històriques per fer-les
semblar actuals. Se n'aclareix la vigència i s'afegeix el resultat posterior quan
cal.
