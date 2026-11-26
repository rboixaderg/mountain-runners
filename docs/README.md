# Mapa De Documentació

## Fonts Vigents

Quan dos documents discrepen, cal distingir comportament implementat i decisió
acceptada:

1. El codi, el contingut, els tests i els scripts de cada component descriuen el
   comportament implementat.
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
- [`phase-8-system-map.html`](phase-8-system-map.html): mapa visual dels
  components de l'agent privat, amb enllaços a les fonts vigents. HTML autònom
  per obrir al navegador.
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
- [`ai-assistant.md`](ai-assistant.md): futur xat públic, agent privat de
  Telegram i agents locals.
- [`decisions/`](decisions/): decisions arquitectòniques acceptades.
  - [`0001`](decisions/0001-static-site-and-content-in-git.md): web estàtica i
    contingut a Git.
  - [`0002`](decisions/0002-public-chat-and-private-editor.md): xat públic i
    assistent editorial privat separats.
  - [`0003`](decisions/0003-agent-workflow-and-security.md): flux d'agents,
    worktrees i controls de seguretat.
  - [`0004`](decisions/0004-code-and-editorial-content-boundary.md): límit entre
    codi i contingut editorial.
  - [`0005`](decisions/0005-fixed-page-copy-in-translation-resources.md): textos
    de pàgines fixes als recursos de traducció.
  - [`0006`](decisions/0006-presentation-layer-structure.md): estructura de
    capes de presentació i pàgines primes.
  - [`0007`](decisions/0007-self-hosted-plausible-analytics.md): analítica
    autoallotjada amb Plausible.
  - [`0008`](decisions/0008-request-observability.md): observabilitat de
    peticions a l'origen.
  - [`0009`](decisions/0009-pr-previews-same-domain-and-own-branches.md):
    previews de PR al mateix domini registrable i només branques pròpies.
  - [`0010`](decisions/0010-preview-caddy-acme-isolation.md): frontera de Caddy i
    emmagatzematge ACME dels previews.
  - [`0011`](decisions/0011-news-blog-editorial-previews.md): esborranys de
    notícies i blog en previews editorials.
  - [`0012`](decisions/0012-local-fast-checks.md): comprovacions locals ràpides i
    CI com a autoritat.
  - [`0013`](decisions/0013-private-development-agent-boundary.md): frontera de
    l'agent privat de desenvolupament.
  - [`0014`](decisions/0014-operator-stop-and-repeatable-telegram-notices.md):
    aturada per l'operador i avisos de Telegram repetibles.
- [`specs/`](specs/README.md): convenció d'especificacions, llindar d'ús i
  requisits d'acceptació.
  - [`agent-audit-remediation.md`](specs/agent-audit-remediation.md): correccions
    de seguretat i errors, i simplificació de l'agent privat.
  - [`agent-sync-before-merge.md`](specs/agent-sync-before-merge.md):
    sincronització de la branca i nova revisió de la preview abans del merge.
  - [`docs-governance.md`](specs/docs-governance.md): govern de la documentació i
    de les skills.
  - [`legacy-url-redirects.md`](specs/legacy-url-redirects.md): redireccions
    permanents d'URLs de llegat amb trànsit.
  - [`member-services.md`](specs/member-services.md): serveis per a socis amb
    entrenaments funcionals.
  - [`news-and-blog.md`](specs/news-and-blog.md): requisits i seguiment de
    notícies, blog i esborranys editorials en preview.
  - [`plausible-analytics.md`](specs/plausible-analytics.md): analítica web amb
    Plausible, esdeveniments i exclusió en preview.
  - [`preview-label.md`](specs/preview-label.md): petició de preview amb
    l'etiqueta `preview` de la PR.
  - [`preview-merge-confirmation.md`](specs/preview-merge-confirmation.md):
    confirmació del merge amb una pregunta i una resposta.
  - [`request-observability.md`](specs/request-observability.md): observabilitat
    de totes les peticions a l'origen.
  - [`retire-preview-command.md`](specs/retire-preview-command.md): retirada de
    la petició de preview amb `/preview`.
- `specs/phase-N/`: la carpeta de cada fase amb la seva especificació i els
  documents de treball: [`phase-1/`](specs/phase-1/),
  [`phase-2/`](specs/phase-2/), [`phase-3/`](specs/phase-3/),
  [`phase-4/`](specs/phase-4/), [`phase-5/`](specs/phase-5/),
  [`phase-6/`](specs/phase-6/) i [`phase-8/`](specs/phase-8/). La fase 7 encara
  no té especificació.
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
- [`phase-5-t55-dns-inventory.md`](specs/phase-5/phase-5-t55-dns-inventory.md):
  inventari públic dels registres DNS a preservar i a substituir al tall.
- [`phase-6-t64-local.md`](specs/phase-6/phase-6-t64-local.md): registre local
  del cicle de vida dels previews abans de l'activació al VPS.
- Els documents de validació de cada fase dins de `specs/phase-N/`, com
  [`phase-4-design-review.md`](specs/phase-4/phase-4-design-review.md): evidència
  de revisions executades i punts de tancament, no substitut de l'especificació.

No s'actualitzen retrospectivament les observacions històriques per fer-les
semblar actuals. Se n'aclareix la vigència i s'afegeix el resultat posterior quan
cal.
