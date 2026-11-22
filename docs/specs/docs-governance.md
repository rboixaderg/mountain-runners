# Especificació: Govern De La Documentació I De Les Skills

## Estat

Pendent. Defineix l'entrada del [backlog](../backlog.md#govern-de-la-documentació-i-de-les-skills).
Cap tasca passa a `En curs` fins que la PR d'aquesta especificació es fusioni. La T10
requereix una revisió de seguretat i cap tasca no s'executa contra el servei real. No
canvia cap decisió dels [ADR](../decisions/), cap configuració remota ni el
comportament desplegat.

## Objectiu

Els documents es degraden perquè cada agent afegeix el comportament nou al document
més proper. Fets verificats el 22 de novembre de 2026:

- El comportament de l'agent privat de la fase 8 es descriu a quatre llocs:
  l'especificació de la fase 8, `docs/deployment.md` (unes 1.400 de les seves 1.787
  línies), [`tools/server/agent/README.md`](../../tools/server/agent/README.md) i
  `docs/phase-8-system-map.html`. Les contradiccions resultants, com el text «no
  desplegat» ja obsolet, s'han corregit a la PR #281.
- `docs/deployment.md` i `docs/runbook.md` (1.618 línies) se solapen en la CLI de
  releases, el flux de previews, la frontera de `preview-deploy`, les ordres de
  `mountain-preview` i la instal·lació de l'agent.
- Els documents de treball d'una tasca viuen a l'arrel de `docs/` (`phase-5-t51-*`,
  `phase-5-t55-dns-inventory.md`, `phase-6-t61-*`, `phase-6-t62-*`, `phase-8-t81-*`,
  `phase-2/3-editorial-inventory.md`) i hi ha fitxers obsolets.
- El procediment «Actualitzar» de l'agent no té cap script versionat, no enregistra el
  commit instal·lat, no comprova l'estat ocupat abans d'aturar, no diu quan cal
  reconstruir la imatge del sandbox ni com fer-ho, i no cobreix la reinstal·lació de la
  unitat de systemd.
- `.agents/skills/vitest/SKILL.md` no coincideix amb el hash fixat a
  [`skills-manifest.json`](../../.agents/skills/skills-manifest.json) perquè la PR
  #156 hi va afegir «Test value and redundancy», cosa que trenca la regla que les
  skills externes es conserven sense modificar. Cap prova comprova els hashes i les
  skills pròpies no tenen versió.

L'objectiu és que cada tipus de contingut tingui un únic document propietari, que
l'operació s'organitzi per component, que l'actualització de l'agent sigui un script
versionat i que una comprovació ràpida impedeixi que la documentació torni a divergir.

## Límits I Decisions Confirmades

La persona mantenidora confirma aquestes decisions el 22 de novembre de 2026.

**Propietat i vigència.** `AGENTS.md` incorpora una taula que assigna cada tipus de
contingut al seu únic document propietari: els requisits a l'especificació, les
decisions a l'ADR, el comportament implementat a un únic document viu, i el procediment
i l'operació al document d'operacions del component. El mapa viu a `docs/README.md` i
la resta de documents enllacen el propietari sense resumir-lo.

- Els documents vius s'organitzen per component, mai per tasca: els identificadors de
  tasca com (T8.4) no apareixen als seus títols, sinó a les especificacions, les PR i
  l'historial de git.
- Els documents vius descriuen només l'estat actual: quan una funcionalitat es retira,
  se suprimeix la descripció en lloc d'afegir-hi una nota. Els ADR i les
  especificacions són registres i n'estan exempts.
- Una PR que canvia comportament actualitza el document propietari i no el duplica
  enlloc més.

**Operació per component.** `docs/deployment.md` i `docs/runbook.md` se substitueixen
per `docs/operations/`, amb un document per component que té una part «Com funciona»
(contractes, fronteres, noms) i una part «Com s'opera» (ordres, instal·lació,
actualització, reversió, incidències). Components: web i releases (desplegament
continu, reversió, TLS/Caddy, tall DNS, HSTS i gate de llançament), previews de PR i
agent privat. El contingut genèric de servidor i identitat (VPS, identitats, còpies,
logs, salut) viu a `docs/operations/README.md`, perquè no té cap component propietari i
el README ja és el punt d'entrada de la carpeta; un `servidor.md` seria un quart
document amb aparença de component sense ser-ho. Els enllaços entrants (ADR,
`AGENTS.md`, `SECURITY.md`, READMEs, comentaris de codi i les proves que llegeixen
aquests documents, com [`gate.test.mjs`](../../tools/server/preview/gate.test.mjs))
s'actualitzen.

**Agent.** El comportament implementat de l'agent viu només a
[`tools/server/agent/README.md`](../../tools/server/agent/README.md).
L'especificació de la fase 8 conserva els requisits i `docs/operations/` només hi
enllaça. `docs/phase-8-system-map.html` queda fora d'abast: més endavant serà la vista
visual de l'arquitectura i aquesta especificació no l'edita.

**Carpetes per fase.** Totes les fases, de l'1 a la 8, també les tancades 2 a 6, viuen a
`docs/specs/phase-N/`, amb l'especificació de la fase i els seus documents de treball:
decisions, requisits, inventaris (incloent-hi els editorials de les fases 2 i 3) i
documents de validació de `docs/validation/`. Les especificacions de funcionalitat que
no són de fase continuen a `docs/specs/`. S'actualitzen tots els enllaços entrants,
inclòs [`development.mjs`](../../tools/server/agent/policy/development.mjs), que cita
el document de la T8.1. Els documents d'una fase tancada ja no es mantenen.

**Neteja.** S'eliminen `docs/tailwind-v4-migration-plan.md`,
`docs/phase-5-t51-preparacio.md` i `docs/design-references.md`; git en conserva
l'historial. El `phase-5-t51-dns-migracio.md` no versionat de la persona mantenidora es
descarta i no es versiona. El `newsletter-and-analytics.md` no versionat es converteix
en una entrada del backlog que en resumeix la proposta. Es treu de `docs/README.md`
l'enllaç al `diari-de-treball.md`, que és ignorat per git.
`docs/phase-2-portable-skills-review.md` es converteix en el registre viu de les skills
del projecte amb el nom `docs/skills.md`: no és un document de fase i el nom en diu
l'objecte sense prefix de fase, així que continua sent vàlid quan el registre creixi.

**Skills (només les del projecte a `.agents/skills/`).** Les skills externes
(`accessibility`, `seo`, `vitest`, `typescript-advanced-types`) es conserven idèntiques
byte a byte, fitxer a fitxer, a la revisió fixada al manifest. La secció «Test value and
redundancy» de `vitest` es trasllada a la skill pròpia `frontend-testing` i
`vitest/SKILL.md` es restaura a l'original. Una prova automàtica falla si apareix, falta o
canvia qualsevol fitxer d'una skill externa, o si el frontmatter té una clau no permesa o
un `name` canviat. Una comprovació setmanal proposa cada revisió externa nova com a PR de
bot amb el manifest tornat a fixar; la PR es revisa i la fusió continua sent humana. Les
skills pròpies porten `metadata.version` al frontmatter (camp permès d'Agent Skills), la
versió puja quan canvia el comportament de la skill i la comprovació en verifica la
presència. La paritat de symlinks de `.claude/skills/` no canvia.

**Skill de documentació.** S'afegeix a `.agents/skills/` la skill `docs-ownership`, que
els agents carreguen abans de tocar `docs/`, els ADR, les especificacions o els
READMEs. Apunta a la taula d'`AGENTS.md` i no la duplica. Necessita el symlink a
`.claude/skills/` i `metadata.version`.

**Comprovació automàtica.** Una comprovació ràpida s'executa a `pnpm check:local`
(pre-push) i a la CI i falla per les cinc divergències de
[Comprovació automàtica](#comprovació-automàtica). És sense dependències (Node), viu a
`tools/` i té proves pròpies. Un document és viu quan és qualsevol Markdown versionat
sota `docs/`, `tools/` o `packages/`, excepte `docs/decisions/` i `docs/specs/`; la regla
del mapa només afecta `docs/`.

**Script d'actualització de l'agent.** El procediment es versiona com a script a
`tools/server/agent/`, seguint les convencions de `tools/server/preview` que hi siguin
aplicables, per exemple `commands/<nom>/cli.mjs`. Els passos i les comprovacions són a
[Script d'actualització de l'agent](#script-dactualització-de-lagent); la reversió i la
reconstrucció de la imatge es documenten al document d'operacions. La frontera de la PR
#281 no canvia: l'agent s'actualitza des d'un commit revisat de `main` amb l'aprovació
explícita de la persona mantenidora, una sessió local d'IA en una màquina de la persona
mantenidora només ho pot fer amb aquesta aprovació a la mateixa conversa, i l'agent de
Telegram no desplega mai, ni a si mateix. Aquesta tasca necessita una revisió de
seguretat.

**Entrega En Set PR.** La persona mantenidora decideix el 22 de novembre de 2026 agrupar les
onze tasques en set PR, amb una raó per a cada agrupació: la 1 uneix la T1 i la T5 perquè són
canvis petits de documentació i la neteja és la primera aplicació de les regles de propietat;
la 2 uneix la T2 i la T3 perquè totes dues toquen les skills i el manifest i el registre depèn
de la prova del manifest; la 3 és la T4 sola perquè és CI amb secrets i necessita revisió de
seguretat i els passos manuals de GitHub; la 4 és la T6 sola perquè és un moviment pur de
fitxers i el diff de renoms ha de quedar fàcil de revisar; la 5 uneix la T7, la T8 i la T9
perquè el contingut es mou, no es reescriu, i `docs/deployment.md` i `docs/runbook.md`
desapareixen d'una vegada en lloc de quedar partits entre PR; la 6 és la T10 sola perquè és
codi que opera el VPS i necessita revisió de seguretat; i la 7 és la T11 sola perquè ha
d'arribar l'última perquè sigui verda. L'ordre és a
[Dependències i ordre d'inici](#dependències-i-ordre-dinici).

## Resultats Esperats

- Un agent que vol documentar un comportament troba a `AGENTS.md` un únic propietari
  per tipus de contingut i una skill que el carrega abans de tocar `docs/`.
- Cap procediment operatiu apareix a dos documents: cada component té un sol document
  d'operacions i la resta hi enllaça.
- El comportament de l'agent es descriu en un sol lloc i la seva actualització és una
  ordre versionada, reproduïble i reversible.
- Cada fase té la seva carpeta i cap document de treball d'una tasca viu a l'arrel de
  `docs/`.
- Les quatre skills externes coincideixen amb el manifest fitxer a fitxer i amb el
  frontmatter permès, una prova ho comprova, cada revisió externa nova arriba com a PR de
  bot revisable i cada skill pròpia té versió.
- `pnpm check:local` falla davant d'un enllaç trencat, un document fora del mapa, un
  identificador de tasca en un títol viu, un hash divergent o una skill pròpia sense
  versió.
- Les rutes, el contingut publicat i el comportament observable de la web no canvien en
  cap tasca.

## Dependències I Ordre D'inici

Aquesta PR s'ha de fusionar abans d'iniciar cap tasca. L'ordre és:

1. PR 1: T1 i T5.
2. PR 2: T2 i T3.
3. PR 3: T4, amb la GitHub App i els secrets que crea la persona mantenidora abans de la
   primera execució.
4. PR 4: T6.
5. PR 5: T7, T8 i T9, en aquest ordre dins la mateixa PR.
6. PR 6: T10, després del document d'operacions de la PR 5.
7. PR 7: T11, l'última, perquè arribi verda.

La T5 depèn de la T1 i va a la mateixa PR. La T3 depèn de la T2 i va a la mateixa PR. La T8 i
la T9 depenen de la T7 dins la PR 5. La T10 depèn de la T9 perquè la reversió i la
reconstrucció de la imatge s'hi documenten. La T11 depèn de totes les anteriors perquè el
mapa, les carpetes i les versions han d'estar estabilitzats. No hi ha cap altra dependència
externa.

## Tasques, Entregues I Seguiment

| Tasca | Estat   | Entrega | Dependències | Resultat verificable                                                                         | PR  |
| ----- | ------- | ------- | ------------ | -------------------------------------------------------------------------------------------- | --- |
| T1    | Pendent | PR 1    | Cap          | Taula de propietat a `AGENTS.md` i skill `docs-ownership` carregable                         | -   |
| T5    | Pendent | PR 1    | T1           | Tres documents esborrats, cap enllaç trencat i una entrada nova al backlog                   | -   |
| T2    | Pendent | PR 2    | T1           | Els hashes de cada fitxer de les quatre skills externes coincideixen i una prova ho comprova | -   |
| T3    | Pendent | PR 2    | T2           | Cada skill pròpia té `metadata.version` i `docs/skills.md` és el registre únic               | -   |
| T4    | Pendent | PR 3    | T3 + App     | Cada origen amb canvis rep una PR de bot revisable i cada refús fa fallar l'execució         | -   |
| T6    | Pendent | PR 4    | T5           | Cada fase té la seva carpeta i cap document de treball viu a l'arrel de `docs/`              | -   |
| T7    | Pendent | PR 5    | T6           | `docs/operations/` té el README i el document de web i releases                              | -   |
| T8    | Pendent | PR 5    | T7           | `docs/operations/previews.md` descriu les previews i la resta hi enllaça                     | -   |
| T9    | Pendent | PR 5    | T8           | `docs/operations/agent.md` descriu l'agent i `deployment.md`/`runbook.md` desapareixen       | -   |
| T10   | Pendent | PR 6    | T9           | Una ordre versionada actualitza l'agent amb comprovacions, còpia i `REVISION`                | -   |
| T11   | Pendent | PR 7    | T1 a T10     | `pnpm check:local` falla davant de cada divergència documental definida                      | -   |

### T1: Regles De Propietat I Skill De Documentació

**Abast:** `AGENTS.md` (taula de propietat i regla de vigència), `docs/README.md` (mapa
i remissió a la taula) i `.agents/skills/docs-ownership/` amb `metadata.version` i el
symlink a `.claude/skills/`.

**Exclusió immediata:** no mou ni esborra documents i no toca cap skill existent.

**Dependències:** cap.

**Resultat observable:** la taula assigna cada tipus de contingut a un sol document i
la skill la referencia sense repetir-ne el contingut.

**Comprovacions mínimes:** `pnpm format:check` i `pnpm test:server`, que inclou la
paritat de symlinks de
[`skill-links.test.mjs`](../../tools/agent-skills/skill-links.test.mjs).

**PR:** la PR 1, compartida amb la T5,
`docs(docs-governance-t1-t5): define documentation ownership and remove obsolete documents`.

### T2: Restauració De `vitest` I Prova Del Manifest

**Abast:** `.agents/skills/vitest/SKILL.md` restaurat a la revisió fixada,
`.agents/skills/frontend-testing/SKILL.md` amb la secció «Test value and redundancy»
adaptada, `tools/agent-skills/skills-manifest.test.mjs` amb el mòdul que compara arbres,
`skillSha256` substituït al manifest per un mapatge de ruta a sha256 de cada fitxer de cada
skill externa, llicència inclosa, i el hash de la llicència conservat.

**Exclusió immediata:** no actualitza cap revisió externa, ni la resta de skills pròpies,
ni el workflow de la CI, i no toca `reviewedAt`.

**Dependències:** T1, de la PR 1, perquè la secció traslladada queda sota la regla de
propietat i perquè la prova del manifest encara no existeix abans.

**Resultat observable:** cada skill externa coincideix amb el manifest fitxer a fitxer, de
manera que un fitxer afegit, eliminat o modificat fa fallar la prova; `vitest` conserva
`references/` i `GENERATION.md` fixats i el seu `SKILL.md` torna a tenir el hash `87c8cf…`;
i el frontmatter amb una clau fora de `name`, `description`, `license`, `compatibility` o
`metadata`, o amb un `name` canviat, també falla.

**Comprovacions mínimes:** `pnpm test:server` i `shasum -a 256` sobre tots els fitxers de
les quatre skills externes.

**PR:** la PR 2, compartida amb la T3,
`feat(docs-governance-t2-t3): pin external skills by file and version project skills`.

### T3: Versions De Les Skills Pròpies I Registre

**Abast:** `metadata.version` a les skills pròpies, la regla de pujada de versió a
`AGENTS.md`, el registre `docs/skills.md` en lloc de
`docs/phase-2-portable-skills-review.md`, i l'entrada corresponent a `docs/README.md`.

**Exclusió immediata:** no toca les skills externes ni els seus hashes i no reescriu
l'anàlisi de la T2.2, que es conserva a l'historial de git.

**Dependències:** T2, a la mateixa PR: el registre depèn de la prova del manifest.

**Resultat observable:** cada skill pròpia té una versió inicial i `docs/skills.md` en diu
l'origen, el propòsit, la llicència i les regles de cadena de subministrament, i enllaça
`skills-manifest.json` com a única font de la revisió fixada i dels hashes; no repeteix cap
commit ni cap hash de les skills externes.

**Comprovacions mínimes:** `pnpm format:check`, `pnpm test:server` i una comprovació que
cada fitxer propi té el camp al frontmatter.

**PR:** la PR 2, compartida amb la T2,
`feat(docs-governance-t2-t3): pin external skills by file and version project skills`.

### T4: Actualitzacions Externes Proposades Com A Pull Requests

**Abast:** `.github/workflows/skills-update.yml`, `tools/agent-skills/update-upstream.mjs`
i les seves proves, l'ordre `skills:update` a `package.json` i l'entrada de `CODEOWNERS`
per a `.agents/skills/**` i `.github/workflows/**`.

**Exclusió immediata:** no afegeix ni actualitza cap skill a `main`, no aprova, no fusiona,
no activa auto-merge, no modifica `reviewedAt` i no escriu fora de `.agents/skills/<nom>/`
i de `.agents/skills/skills-manifest.json`.

**Dependències:** T3 i els passos manuals de la persona mantenidora: la GitHub App amb
`Contents: write` i `Pull requests: write`, els secrets `SKILLS_UPDATE_APP_ID` i
`SKILLS_UPDATE_APP_PRIVATE_KEY` a l'entorn `skills-update` restringit a `main`, l'etiqueta
`skills` i el ruleset de `main` sense bypass per a l'App.

**Resultat observable:** una execució setmanal o manual obre o actualitza una PR de bot per
cada origen amb canvis, amb el manifest tornat a fixar i el títol
`chore(skills): update <source-slug> to <sha7>`; si detecta un refús, no obre cap PR i falla
amb el motiu.

**Comprovacions mínimes:** `pnpm test:server` amb l'API simulada (revisió nova amb canvis,
revisió nova sense canvis a la skill, PR ja oberta que s'actualitza, PR d'una altra autoria o
branca de bot amb commits aliens que es refusa, i cada refús), `actionlint` si està
disponible i una execució `workflow_dispatch` en una branca abans del merge que obri una PR
real d'un origen de prova o mostri el `--dry-run`.

**PR:** la PR 3, sola:
`ci(docs-governance-t4): propose upstream skill updates as pull requests`.

### T5: Neteja De Documents Oberts I Obsolets

**Abast:** esborrar `docs/tailwind-v4-migration-plan.md`,
`docs/phase-5-t51-preparacio.md` i `docs/design-references.md`; treure de
`docs/README.md` les seves entrades i l'enllaç al `diari-de-treball.md`; substituir per
text els enllaços a aquests fitxers a `docs/phase-5-t51-decisions.md`,
`docs/phase-2-editorial-inventory.md` i `docs/validation/phase-4-design-review.md`;
afegir al backlog l'entrada de la proposta de butlletí i analítica.

**Exclusió immediata:** no mou cap document de fase, no reorganitza l'operació i no
reescriu l'apartat de notícies i blog del mateix àmbit.

**Dependències:** T1, a la mateixa PR: la neteja és la primera aplicació de les regles de
propietat.

**Resultat observable:** cap document versionat enllaça un fitxer inexistent ni un
fitxer ignorat per git, i el backlog recull la proposta que no es versiona.

**Comprovacions mínimes:** `pnpm format:check` i una cerca dels tres noms als Markdown
versionats. Rutes, contingut i comportament observable no canvien.

**PR:** la PR 1, compartida amb la T1,
`docs(docs-governance-t1-t5): define documentation ownership and remove obsolete documents`.

### T6: Carpetes Per Fase

**Abast:** `docs/specs/phase-N/` per a les vuit fases, de l'1 a la 8, amb les
especificacions, els documents de treball (`phase-5-t51-decisions.md`,
`phase-5-t55-dns-inventory.md`, `phase-6-t61-*`, `phase-6-t62-*`, `phase-8-t81-*`), els
inventaris editorials de les fases 2 i 3 i els documents de `docs/validation/`;
actualitzar tots els enllaços entrants, inclosos `docs/roadmap.md`,
`docs/architecture.md`, els ADR 0013 i 0014,
[`development.mjs`](../../tools/server/agent/policy/development.mjs),
`tools/server/README.md` i el mapa de `docs/README.md`.

**Exclusió immediata:** no reescriu el contingut mogut, no fusiona especificacions i no
toca les especificacions de funcionalitat.

**Dependències:** T5, de la PR 1.

**Resultat observable:** cada fase té una carpeta amb la seva especificació i els seus
documents; els noms de fitxer es conserven perquè el diff només mogui camins i cap
enllaç queda trencat.

**Comprovacions mínimes:** `pnpm format:check` i una cerca dels noms de fitxer antics al
repositori. Rutes, contingut i comportament observable no canvien.

**PR:** la PR 4, sola:
`docs(docs-governance-t6): group every phase under its own folder`.

### T7: Operacions De Web I Releases

**Abast:** `docs/operations/README.md` (mapa de components i operació compartida: VPS,
identitats, còpies, logs, salut i emergència) i `docs/operations/web-and-releases.md`
amb el contingut de build i artefacte, releases, desplegament continu, reversió,
TLS/Caddy, redireccions, tall DNS, HSTS, gate de llançament i període d'observació;
enllaços entrants actualitzats.

**Exclusió immediata:** no mou les seccions de previews ni d'agent, no canvia cap ordre,
llindar o decisió operativa i no toca `tools/server/agent/README.md`.

**Dependències:** T6, de la PR 4.

**Resultat observable:** el procediment de web i releases té un sol propietari; en tancar la
PR 5, `docs/deployment.md` i `docs/runbook.md` ja no existeixen i cada component té el seu
document.

**Comprovacions mínimes:** `pnpm format:check`, enllaços resolts i una cerca que
demostri que cada ordre moguda apareix un sol cop. Rutes, contingut i comportament
observable no canvien.

**PR:** la PR 5, compartida amb la T8 i la T9,
`docs(docs-governance-t7-t9): move operations to one document per component`.

### T8: Operacions De Previews

**Abast:** `docs/operations/previews.md` amb el publicador, l'autorització per etiqueta,
el gate `mountain-preview`, la instal·lació al VPS, la política d'Actions, la retirada i
la reconciliació; moure-hi les seccions de previews dels dos documents antics;
actualitzar [`gate.test.mjs`](../../tools/server/preview/gate.test.mjs), que llegeix
`docs/runbook.md`, i la resta d'enllaços entrants.

**Exclusió immediata:** no canvia el publicador, el gate ni la política d'Actions i no
mou el contingut d'agent.

**Dependències:** T7, dins la mateixa PR.

**Resultat observable:** el flux de previews es descriu en un sol document i la prova
que en llegeix l'ordre d'instal·lació apunta al nou propietari.

**Comprovacions mínimes:** `node --test tools/server/preview/*.test.mjs` i
`pnpm format:check`. Rutes, contingut i comportament observable no canvien.

**PR:** la PR 5, compartida amb la T7 i la T9,
`docs(docs-governance-t7-t9): move operations to one document per component`.

### T9: Operacions De L'Agent

**Abast:** `docs/operations/agent.md` amb instal·lació, configuració, arrencada i
aturada, actualització, reversió, reconstrucció de la imatge, credencials, estat,
retenció i reconciliació; moure-hi les seccions d'agent dels dos documents i
esborrar-los; deixar els requisits a l'especificació de la fase 8 i el comportament
implementat només a [`tools/server/agent/README.md`](../../tools/server/agent/README.md),
amb els títols sense identificadors de tasca com «(T8.8)» i les seccions duplicades
fusionades; actualitzar `docs/architecture.md`, `docs/README.md`, `AGENTS.md`,
`SECURITY.md`, els READMEs de `tools/` i els ADR que els citen.

**Exclusió immediata:** no edita `docs/phase-8-system-map.html` ni canvia cap frontera
de l'ADR 0013 o cap procediment operatiu real.

**Dependències:** T8, dins la mateixa PR.

**Resultat observable:** comportament, operació i requisits de l'agent tenen un sol
propietari cadascun i `docs/deployment.md` i `docs/runbook.md` ja no existeixen.

**Comprovacions mínimes:** `pnpm format:check`, `pnpm test:server` i una cerca dels dos
noms al repositori. Rutes, contingut i comportament observable no canvien.

**PR:** la PR 5, compartida amb la T7 i la T8,
`docs(docs-governance-t7-t9): move operations to one document per component`.

### T10: Script D'Actualització De L'Agent

**Abast:** `tools/server/agent/commands/update/cli.mjs` amb els mòduls i les proves que
necessiti, `docs/operations/agent.md` (ordre, reversió i reconstrucció de la imatge) i,
si cal, una ordre nova a `package.json`.

**Exclusió immediata:** no arrenca el servei, no desplega, no canvia la frontera de
l'ADR 0013, no toca la unitat de systemd i no modifica `state/` més enllà de la còpia. Pot
aturar el servei, i només després que la comprovació d'inactivitat passi.

**Dependències:** T9, de la PR 5, i la revisió de seguretat.

**Resultat observable:** una sola ordre comprova que el commit és abastable des
d'`origin/main`, verifica la revisió instal·lada, confirma l'estat inactiu, atura el
servei, fa la còpia, substitueix directoris des d'un `git archive`, verifica per sha256 i
escriu `REVISION`. Refusa instal·lar si la imatge del sandbox s'ha de reconstruir, tret
que la persona operadora ho affirmi explícitament, i reporta les accions pendents sobre
systemd o `.env.example`. No arrenca mai el servei.

**Comprovacions mínimes:** `pnpm test:server` amb un sistema de fitxers temporal (amb i
sense `REVISION` previ, amb l'estat ocupat, amb la imatge per reconstruir i amb el senyal
explícit), l'ordre documentada executada en sec i una comprovació que la sortida no mostra
cap credencial.

**PR:** la PR 6, sola:
`feat(docs-governance-t10): add the versioned agent update command`.

### T11: Comprovació Automàtica De La Documentació

**Abast:** `tools/docs/check-docs.mjs` i `tools/docs/check-docs.test.mjs` amb Node,
l'ordre `docs:check` a `package.json` dins de `check:local` i `check`, i el patró de
`test:server` per incloure les proves noves.

**Exclusió immediata:** no valida URLs externes, no reescriu documents i no afegeix cap
dependència ni cap servei.

**Dependències:** T1 a T10.

**Resultat observable:** `pnpm check:local` falla davant de cada divergència definida a
[Comprovació automàtica](#comprovació-automàtica) i passa amb l'estat fusionat de les
tasques anteriors.

**Comprovacions mínimes:** `pnpm docs:check` verd, `pnpm test:server` amb els casos de
fallada i `pnpm check:local` complet.

**PR:** la PR 7, sola, l'última:
`feat(docs-governance-t11): verify documentation ownership and skill integrity`.

## Propietat I Vigència Dels Documents

- La taula d'`AGENTS.md` és l'única font de la propietat; `docs/README.md` en dona el
  mapa i no repeteix les regles.
- Un document viu no duu identificadors de tasca als títols, no descriu versions
  anteriors i no conserva notes de retirada.
- Els ADR, les especificacions i els documents de fase tancada són registres i no
  s'actualitzen retrospectivament.
- Una PR que canvia comportament actualitza el document propietari dins la mateixa PR;
  si afecta un ADR, en proposa l'esmena.

## Operacions Per Component

- `docs/operations/README.md`: mapa de components, destí del servidor, identitats,
  còpies i restauració, logs, salut i resposta d'emergència.
- `docs/operations/web-and-releases.md`: build i artefacte, releases, desplegament
  continu, reversió, TLS i Caddy, redireccions, tall DNS, HSTS, gate de llançament i
  període d'observació.
- `docs/operations/previews.md`: publicador, autorització per etiqueta, gate
  `mountain-preview`, instal·lació al VPS, política d'Actions i retirada.
- `docs/operations/agent.md`: instal·lació, configuració, arrencada, actualització,
  reversió, reconstrucció de la imatge, credencials, estat, retenció i reconciliació.

Cada document té una part «Com funciona» i una part «Com s'opera». Els noms de fitxer
són en anglès, com la resta de documents tècnics, i el contingut en català. Les proves
que llegeixen aquests documents apunten al nou propietari a la mateixa PR que el mou.

## Skills Del Projecte

Les skills externes del manifest i les pròpies tenen regles diferents.

### Actualitzacions Externes

- **Workflow.** `.github/workflows/skills-update.yml` s'executa amb `schedule` setmanal en
  dilluns, com Dependabot, i amb `workflow_dispatch`. Els permisos del workflow són
  `contents: read` i el `GITHUB_TOKEN` no escriu mai. El job declara
  `environment: skills-update`.
- **Entorn i secrets.** `SKILLS_UPDATE_APP_ID` i `SKILLS_UPDATE_APP_PRIVATE_KEY` viuen a
  l'entorn `skills-update`, restringit a la branca `main` com l'entorn `previews`, i mai són
  secrets de repositori: un workflow de `pull_request` d'una branca del mateix repositori els
  podria llegir. Els noms es documenten i els valors no. L'entorn, l'App i l'etiqueta
  `skills` els crea la persona mantenidora: és un canvi de configuració remot, fora de
  l'abast de qualsevol agent, i la PR de la T4 el registra com a pas manual.
- **Token.** L'App només té `Contents: write` i `Pull requests: write`, no té permís
  `Workflows`, està instal·lada «Only on this account» i només en aquest repositori.
  `actions/create-github-app-token`, fixat per SHA complet, rep `owner`, `repositories` amb
  aquest repositori, `permission-contents: write` i `permission-pull-requests: write`.
  `actions/checkout` fa servir `persist-credentials: false` i el token de l'App només arriba
  al pas de push i de PR.
- **Ruleset.** El ruleset de `main` no dona cap bypass a l'App i bloqueja el force-push i la
  supressió de `main`. Exigir revisió de code-owner és una decisió de la persona
  mantenidora.
- **Fixació per fitxer.** El manifest fixa cada fitxer de cada skill externa, no només
  `SKILL.md`, amb un mapatge de ruta a sha256 o un hash de directori calculat sobre la
  llista ordenada de ruta i sha256, i conserva el hash de la llicència. Inclou `references/`
  i `GENERATION.md` de `vitest`. Un fitxer afegit, eliminat o modificat fa fallar la prova
  de la T2 i la comprovació automàtica.
- **Frontmatter.** L'actualització refusa una clau de `SKILL.md` fora de `name`,
  `description`, `license`, `compatibility` i `metadata`, com ara `allowed-tools`, que
  alguns agents apliquen sense preguntar, i un canvi de `name`.
- **Script.** `tools/agent-skills/update-upstream.mjs`, amb Node i proves que simulen
  l'API: per cada `source` del manifest resol l'últim commit de la branca per defecte i el
  compara amb el commit fixat; només proposa si han canviat fitxers sota `sourceSkillPath` o
  el fitxer de la llicència. Baixa cada fitxer pel SHA resolt, mai pel nom de la branca, i
  només els fitxers de `sourceSkillPath` i la llicència. Substitueix el directori sencer
  `.agents/skills/<nom>/` byte a byte: els fitxers esborrats a l'origen s'esborren aquí i la
  llicència de `sourceLicensePath` es desa amb el nom local que el manifest ja fa servir
  (`LICENSE` o `LICENSE.md`). Torna a fixar `commit`, els hashes per fitxer i
  `licenseSha256`, i no toca `reviewedAt`, que és humà. Només escriu dins de
  `.agents/skills/<nom>/` i de `.agents/skills/skills-manifest.json` i refusa qualsevol
  altra ruta. `pnpm skills:update --dry-run` imprimeix les propostes sense escriure res.
- **Agrupació.** Una PR per `source`: `accessibility` i `seo` comparteixen
  `addyosmani/web-quality-skills` i van juntes, i `vitest` i `typescript-advanced-types` en
  tenen una cadascuna. Cada PR usa una branca de bot estable, `skills/update-<source-slug>`,
  i un sol grup de `concurrency` per al job que processa tots els orígens evita que dues
  execucions competeixin per la mateixa branca.
- **Sense prendre PR alienes.** L'execució actualitza una PR oberta només si l'autora és
  l'App i la branca de cap és d'aquest repositori; si no, refusa i fa fallar el job. Fa el
  push amb `--force-with-lease=<sha esperat>` i refusa una branca de bot amb commits que no
  siguin de l'App.
- **Títol i etiqueta.** El títol de la PR i el missatge de commit són
  `chore(skills): update <source-slug> to <sha7>`, que `pr-title.yml` i commitlint accepten.
  La PR porta l'etiqueta `skills` i mai `preview`, perquè no canvia la web.
- **Cos de la PR.** Enllaç de comparació de l'origen (`old...new`), fitxers canviats, hashes
  nous i el recordatori que el contingut és no fiable fins que una persona el revisa, perquè
  els agents el carreguen després del merge. Com que una injecció de prompt dins del
  Markdown no es pot refusar automàticament, també llista per a la revisió els comentaris
  HTML, les URLs externes noves i els blocs de shell o les línies d'ordre (`curl`, `| sh`,
  `npm i`, `git push` i semblants).
- **CI i revisió.** Com que la PR l'escriu l'App i no `GITHUB_TOKEN`, els workflows de CI
  habituals s'hi executen i la prova de hashes del manifest de la T2 valida el manifest
  tornat a fixar. `CODEOWNERS` assigna `.agents/skills/**` i `.github/workflows/**` a la
  persona mantenidora; amb una sola persona mantenidora, qui fusiona revisa el diff cru i no
  el Markdown renderitzat.
- **Agent de Telegram.** La seva ordre `/merge` només actua sobre PR que el servei ha
  reportat al mateix tema, així que les PR de skills queden fora del seu abast.
- **Refusos.** No obren cap PR, fan fallar l'execució amb el motiu i exigeixen una revisió
  manual de cadena de subministrament. Són: el canvi del fitxer de llicència o de la
  llicència declarada; un fitxer executable, un script o qualsevol fitxer que no sigui
  documentació, és a dir, qualsevol cosa que no sigui `.md` o `.txt` o qualsevol fitxer amb
  bit d'execució, amb l'excepció del fitxer de llicència que el manifest nomena per a aquella
  skill, que queda exempt de la regla d'extensió però no del refús per canvi de llicència; un
  fitxer de més de 256 KiB o un total de més d'1 MiB per skill; una
  entrada de submòdul o de punter de Git LFS; un symlink; una ruta fora de `sourceSkillPath`;
  una redirecció o un canvi de nom del repositori de l'origen (un `301` o un identificador
  de repositori diferent); caràcters bidi o d'amplada zero i caràcters de control diferents
  de `\n` i `\t`; una clau de frontmatter no permesa o un `name` canviat; i un commit de
  l'origen que no es pot resoldre.
- **Operació.** La rotació i la revocació de la clau privada de l'App es documenten a
  `docs/skills.md`: es rota un cop l'any i de seguida que hi hagi un dubte, i es revoca
  esborrant la clau a la configuració de l'App i substituint el secret de l'entorn. L'App no
  té permís d'Issues, així que l'etiqueta `skills` s'ha de crear abans, i les actualitzacions
  `github-actions` de Dependabot cobreixen `actions/create-github-app-token`.

### Skills Pròpies I Registre

- Les skills externes es conserven sense cap modificació i el manifest en fixa origen,
  revisió, hashes de cada fitxer i de la llicència; `reviewedAt` és humà. Una revisió nova
  només entra amb la PR revisada de la T4, que torna a fixar el manifest.
- Les skills pròpies porten `metadata.version`; la versió puja quan canvia el
  comportament de la skill, no quan se'n corregeix una errata.
- `docs/skills.md` és el registre únic d'origen, propòsit, llicència i regles d'entrada de
  cada skill. No repeteix el commit ni els hashes de les externes: enllaça
  `skills-manifest.json` com a única font de la revisió fixada, i recull la rotació i la
  revocació de la clau de l'App.
- `docs-ownership` es carrega abans de tocar documentació i no duplica la taula d'`AGENTS.md`.

## Comprovació Automàtica

`tools/docs/check-docs.mjs` és una ordre de Node sense dependències que llegeix els
fitxers versionats i falla amb un missatge per a cada troballa:

1. Enllaç relatiu que no resol a un fitxer versionat, o anchor que no correspon a cap
   títol del document destí, amb els anchors calculats com a GitHub i ignorant els blocs
   de codi.
2. Fitxer versionat sota `docs/` que no és accessible des del mapa de `docs/README.md`,
   incloent-hi els mapes de carpeta.
3. Identificador de tasca (`T` seguit de nombre i punt, o forma equivalent) en un títol
   de document viu.
4. Fitxer d'una skill externa afegit, eliminat o modificat que no coincideix amb el
   manifest, o clau de frontmatter no permesa o `name` canviat, amb la mateixa comparació
   que la prova de la T2.
5. Skill pròpia sense `metadata.version` al frontmatter.

Un document viu és qualsevol Markdown versionat sota `docs/`, `tools/` o `packages/`,
excepte `docs/decisions/` i `docs/specs/`; la regla del mapa només afecta els fitxers de
`docs/`. El mapa es deriva dels enllaços relatius de `docs/README.md`; no s'afegeix cap
llista paral·lela que pugui divergir. La comprovació no valida URLs externes.

## Script D'Actualització De L'Agent

L'ordre és `tools/server/agent/commands/update/cli.mjs`. Rep la ruta d'instal·lació i la
de còpies com a paràmetres amb els valors de producció per defecte, perquè les proves
treballin sobre un sistema de fitxers temporal. Els fitxers instal·lats surten sempre
d'un `git archive` nou d'un repositori que controla la persona operadora; mai del clon de
l'agent a `/var/lib/mountain-runners-agent/repository`, que l'agent escriu. L'aprovació
explícita de la persona mantenidora en la conversa actual és una precondició de qui
executa l'ordre, no una comprovació de l'script. Passos:

1. Comprova que el commit és abastable des d'`origin/main`.
2. Verifica que l'arbre instal·lat coincideix amb el `REVISION` enregistrat. Si encara no
   hi ha cap `REVISION`, la persona operadora passa el commit instal·lat esperat i
   l'script compara l'arbre amb un `git archive` d'aquell commit.
3. Comprova l'estat inactiu amb el servei en marxa i les bases d'estat en només lectura:
   cap instrucció pendent o en curs, cap reparació de CI reservada, en cua o en curs, cap
   vigilància de CI pendent, enviant o incerta, cap merge en curs o incert, cap preview
   pendent del publicador i cap cas incert de `reconcile`.
4. Atura el servei i confirma que és inactiu.
5. Fa la còpia d'`agent/`, `node_modules/telegram-pi-bridge` i `state/`.
6. Instal·la els fitxers del `git archive`, substituint directoris sencers.
7. Verifica el resultat per sha256 i escriu `REVISION`.
8. No arrenca el servei: l'arrencada és un pas posterior explícit.

Si han canviat el lockfile, `.node-version`, `package.json` o el `Containerfile` del
sandbox respecte de la revisió instal·lada, l'script refusa instal·lar. L'única excepció
és un senyal explícit de la persona operadora que afirma que la imatge del commit nou ja
està construïda i configurada. Els canvis a `tools/server/systemd/` o `.env.example` es
reporten com a accions que la persona operadora ha de fer abans d'arrencar.

## Estratègia De Tests I Qualitat

Se segueix [l'estratègia de proves](../testing-strategy.md) i es tria el nivell més barat
que detecta la regressió.

- Proves de Node amb fixtures temporals per a la comprovació de la T11 i per a l'script
  de la T10, amb els casos de fallada i el camí feliç.
- La prova del manifest de la T2 substitueix qualsevol comprovació manual de hashes.
- `pnpm format:check` a cada tasca, `pnpm test:server` quan canvia codi d'eines i
  `pnpm check:local` complet a la T11.
- No s'afegeixen proves de navegador ni de compilació: cap tasca canvia el comportament
  de la web.
- L'evidència de validació es registra a cada PR, com a la resta del projecte.

## Seguretat I Privacitat

- Els secrets de l'App viuen a l'entorn `skills-update`, restringit a `main`, i no a nivell
  de repositori, perquè un workflow de `pull_request` d'una branca del mateix repositori pot
  llegir els secrets de repositori. La clau privada només existeix com a secret de l'entorn i
  el token que se'n deriva és curt.
- L'App té permisos mínims (`Contents: write` i `Pull requests: write`), sense permís
  `Workflows`, instal·lada només en aquest repositori. El ruleset de `main` no li dona cap
  bypass i bloqueja el force-push i la supressió de la branca.
- `create-github-app-token` fixa `owner`, `repositories` i els dos permisos; `actions/checkout`
  fa servir `persist-credentials: false` i el token de l'App només arriba al pas de push i de
  PR. La clau privada no es versiona ni es documenta.
- El workflow s'executa només per `schedule` o `workflow_dispatch` des de `main`, mai en
  `pull_request_target`, i no fa checkout ni executa codi de l'origen: baixa cada fitxer pel
  SHA resolt i només el fa servir per calcular hashes.
- L'execució no pren mai una PR aliena: només actualitza una PR oberta de l'App en una branca
  d'aquest repositori, amb `--force-with-lease`, i refusa una branca amb commits aliens.
- Els refusos de [Actualitzacions externes](#actualitzacions-externes) aturen l'execució
  davant d'una llicència canviada, un fitxer executable o que no és documentació, tret del
  fitxer de llicència que el manifest nomena, una mida excessiva, un submòdul o un punter de
  Git LFS, un symlink, una ruta fora de la skill, una redirecció o un canvi de nom de
  l'origen, caràcters bidi, d'amplada zero o de control, una clau de frontmatter no permesa o
  un commit irresoluble.
- Una injecció de prompt dins del Markdown no es pot refusar automàticament: el cos de la PR
  assenyala a la persona revisora els comentaris HTML, les URLs externes noves i els blocs de
  shell o les línies d'ordre.
- El bot no aprova, no fusiona i no activa auto-merge; les PR de skills no porten mai
  l'etiqueta `preview`. `CODEOWNERS` assigna `.agents/skills/**` i `.github/workflows/**` a la
  persona mantenidora, que revisa el diff cru; exigir revisió de code-owner és una decisió del
  ruleset.
- L'agent de Telegram només fusiona PR que el servei ha reportat al mateix tema, així que no
  arriba a les PR de skills.
- El contingut d'una skill externa és no fiable fins que una persona el revisa; el
  manifest fixa la revisió, no n'avala el contingut.
- L'script d'actualització no tracta credencials ni imprimeix secrets, i la seva sortida
  no inclou valors d'`agent.env`. Els fitxers que instal·la surten d'un `git archive` d'un
  repositori que controla la persona operadora, mai del clon que l'agent escriu.
- La frontera de desplegament de l'ADR 0013 i de la PR #281 no canvia: l'agent de
  Telegram no desplega, ni a si mateix.
- Tot el text versionat és públic: cap document nou no conté secrets, dades personals no
  publicables ni URLs privades amb credencials.

## Fora D'Abast

- `docs/phase-8-system-map.html`, que més endavant serà la vista visual de l'arquitectura.
- Reescriure contingut més enllà de moure'l i deduplicar-lo.
- Canviar decisions dels ADR.
- Automatitzar el desplegament de l'agent des de la CI.
- Crear la GitHub App, l'entorn `skills-update`, l'etiqueta `skills` o el ruleset: són passos
  manuals de la persona mantenidora.
- Skills globals, fora del projecte.
- Els serveis Hono planificats.

## Criteris D'Acceptació

1. `AGENTS.md` assigna cada tipus de contingut a un sol document propietari i
   `docs-ownership` hi apunta sense duplicar-lo.
2. Les quatre skills externes coincideixen amb el manifest fitxer a fitxer, amb només les
   claus de frontmatter permeses, `vitest` inclòs, una prova falla si divergeixen i la secció
   de redundància de tests viu a `frontend-testing`.
3. Cada skill pròpia té `metadata.version` i `docs/skills.md` n'és el registre únic.
4. Una execució setmanal o manual, amb els secrets a l'entorn `skills-update` restringit a
   `main`, obre o actualitza una PR de bot per cada origen extern amb canvis, amb el manifest
   tornat a fixar i el títol convencional, i falla sense obrir res en cada cas de refús.
5. Els documents obsolets i els enllaços trencats s'han eliminat, i la proposta de
   butlletí i analítica és una entrada del backlog.
6. Cada fase, de l'1 a la 8, té la seva carpeta, i tots els enllaços hi resolen.
7. `docs/operations/` té un document per component amb les parts «Com funciona» i «Com
   s'opera», i `docs/deployment.md` i `docs/runbook.md` ja no existeixen.
8. El comportament implementat de l'agent viu només a `tools/server/agent/README.md`, amb
   títols sense identificadors de tasca, i `docs/phase-8-system-map.html` no s'ha editat.
9. L'actualització de l'agent és una ordre versionada que verifica la revisió instal·lada
   i l'estat inactiu, atura el servei, fa la còpia, instal·la des d'un `git archive`,
   verifica per sha256, escriu `REVISION`, refusa instal·lar si el sandbox s'ha de
   reconstruir i no arrenca mai el servei.
10. `pnpm check:local` i la CI fallen davant de cada divergència definida a
    [Comprovació automàtica](#comprovació-automàtica) i passen amb l'estat fusionat.
11. Cap tasca no canvia rutes, contingut publicat ni comportament observable de la web.
12. `CODEOWNERS` assigna `.agents/skills/**` i `.github/workflows/**` a la persona
    mantenidora.
