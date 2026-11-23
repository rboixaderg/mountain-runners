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

La propietat de cada tipus de contingut i les regles de vigència dels documents
viuen a la secció «Documentation Ownership» d'[`AGENTS.md`](../AGENTS.md#documentation-ownership).
Aquest mapa enllaça els documents i no repeteix aquestes regles.

## Documents Operatius

- [`architecture.md`](architecture.md): implementació actual i direcció
  arquitectònica acceptada.
- [`phase-8-system-map.html`](phase-8-system-map.html): mapa visual de la fase 8,
  peces i fluxos de T8.3 i validació real pendent. HTML autònom per obrir al
  navegador; no substitueix l'especificació ni els ADR.
- [`content-model.md`](content-model.md): contracte editorial i de publicació.
- [`code-conventions.md`](code-conventions.md): normes d'implementació de
  `apps/web`.
- [`testing-strategy.md`](testing-strategy.md): nivells de prova, garanties de
  regressió, aïllament, redundància i validació.
- [`roadmap.md`](roadmap.md): fases, dependències i estat general.
- [`backlog.md`](backlog.md): necessitats obertes i registre del seu triatge.
- [`operations/`](operations/README.md): operació de producció organitzada per
  component.
  - [`operations/README.md`](operations/README.md): contingut compartit del
    servidor (destí, identitats, arquitectura, estructura, bootstrap, accés SSH,
    còpies, logs, salut i resposta d'emergència).
  - [`operations/web-and-releases.md`](operations/web-and-releases.md): build i
    artefacte, releases, desplegament continu, reversió, TLS, redireccions, tall
    DNS, HSTS i gate de llançament.
  - [`operations/previews.md`](operations/previews.md): publicador i retirada de
    les previews de pull request, amb el gate `mountain-preview` i la
    instal·lació al VPS.
  - [`operations/agent.md`](operations/agent.md): instal·lació, configuració,
    actualització, còpies, traça i validació de l'agent privat de Telegram.
- [`phase-5-t55-dns-inventory.md`](specs/phase-5/phase-5-t55-dns-inventory.md):
  inventari públic dels registres a preservar i a substituir al tall.
- [`ai-assistant.md`](ai-assistant.md): límits dels futurs xat públic i assistent
  editorial.
- [`decisions/`](decisions/): decisions arquitectòniques acceptades.
  - [`0001`](decisions/0001-static-site-and-content-in-git.md): web estàtica i
    contingut a Git.
  - [`0004`](decisions/0004-code-and-editorial-content-boundary.md): límit entre
    codi i contingut editorial.
  - [`0005`](decisions/0005-fixed-page-copy-in-translation-resources.md): textos
    de pàgines fixes als recursos de traducció.
  - [`0010`](decisions/0010-preview-caddy-acme-isolation.md): frontera de Caddy i
    emmagatzematge ACME dels previews.
- [`specs/`](specs/): requisits i acceptació de les funcionalitats.
  - [`docs-governance.md`](specs/docs-governance.md): govern de la documentació i
    de les skills.
  - [`member-services.md`](specs/member-services.md): serveis per a socis amb
    entrenaments funcionals.
  - [`preview-merge-confirmation.md`](specs/preview-merge-confirmation.md):
    confirmació del merge amb una pregunta i una resposta.
  - [`request-observability.md`](specs/request-observability.md): observabilitat
    de totes les peticions a l'origen.
  - [`phase-6-t64-local.md`](specs/phase-6/phase-6-t64-local.md): registre local
    del cicle de vida dels previews.
- `specs/phase-N/`: la carpeta de cada fase amb la seva especificació i els
  documents de treball: [`phase-1/`](specs/phase-1/),
  [`phase-2/`](specs/phase-2/), [`phase-3/`](specs/phase-3/),
  [`phase-4/`](specs/phase-4/), [`phase-5/`](specs/phase-5/),
  [`phase-6/`](specs/phase-6/) i [`phase-8/`](specs/phase-8/). La fase 7 encara
  no té especificació.
- [`specs/news-and-blog.md`](specs/news-and-blog.md): funcionalitat autoritzada
  de notícies, blog i esborranys editorials en preview, amb tasques en curs.
- [`editorial/guide.md`](editorial/guide.md): criteris d'exactitud, drets,
  signatura, actualització i aprovació humana. Inclou les dues plantilles.
- [`skills.md`](skills.md): registre de les skills externes i pròpies, amb
  origen, propòsit, llicència i regles de cadena de subministrament.

Els resultats de validació de notícies i blog es registren a la
[PR #140](https://github.com/rboixaderg/mountain-runners/pull/140) i les seves
execucions de CI, no en informes addicionals al repositori. Els requisits i
pendents es mantenen a l'especificació.

## Registres Històrics

Els documents següents es conserven per procedència i traçabilitat, però no
descriuen necessàriament l'estat actual:

- [`phase-2-editorial-inventory.md`](specs/phase-2/phase-2-editorial-inventory.md) i
  [`phase-3-editorial-inventory.md`](specs/phase-3/phase-3-editorial-inventory.md): inventaris i
  aprovacions disponibles en cada fase.
- Els documents de validació de cada fase dins de `specs/phase-N/`, com
  [`phase-4-design-review.md`](specs/phase-4/phase-4-design-review.md): evidència
  de revisions executades i punts de tancament, no substitut de l'especificació.

No s'actualitzen retrospectivament les observacions històriques per fer-les
semblar actuals. Se n'aclareix la vigència i s'afegeix el resultat posterior quan
cal.
