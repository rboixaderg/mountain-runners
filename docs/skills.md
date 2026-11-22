# Registre De Skills Del Projecte

## Propòsit

Aquest document és el registre únic de les skills que els agents carreguen en
aquest repositori. En diu l'origen, el propòsit i la llicència de cadascuna, i
les regles per afegir-ne o actualitzar-ne una. Les skills viuen a
[`.agents/skills/`](../.agents/skills/) i el manifest
[`skills-manifest.json`](../.agents/skills/skills-manifest.json) és l'única font
de la revisió fixada i dels hashes de les skills externes: aquest document no
repeteix cap commit ni cap hash.

Les regles d'ús de les skills i de la documentació són a
[`AGENTS.md`](../AGENTS.md). Les skills pròpies porten `metadata.version` al
frontmatter; la versió puja quan canvia el comportament de la skill, no quan se'n
corregeix una errata.

## Skills Externes

Es conserven idèntiques byte a byte, fitxer a fitxer, a la revisió que fixa el
manifest, amb la llicència original al directori de la skill.

| Skill                       | Origen                          | Propòsit                                                                                | Llicència |
| --------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| `accessibility`             | `addyosmani/web-quality-skills` | Auditar i millorar l'accessibilitat web segons les WCAG.                                | MIT       |
| `seo`                       | `addyosmani/web-quality-skills` | Millorar la visibilitat als cercadors: metadades, dades estructurades i mapes del lloc. | MIT       |
| `vitest`                    | `antfu/skills`                  | Consultar l'API, la configuració i les funcions de Vitest.                              | MIT       |
| `typescript-advanced-types` | `wshobson/agents`               | Escriure tipus avançats de TypeScript: genèrics, tipus condicionals i mapped types.     | MIT       |

`accessibility` i `seo` comparteixen origen i revisió. Una skill externa no
substitueix les instruccions del projecte: `AGENTS.md`, els ADR i les
especificacions sempre hi prevalen, i no s'executen instal·lacions globals, no
fixades o que carreguin contingut a serveis externs.

## Skills Pròpies

| Skill                        | Propòsit                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `editorial-posts`            | Preparar i revisar esborranys de notícies i blog, amb publicació només a petició d'un membre verificat.       |
| `frontend-testing`           | Triar, escriure i revisar els nivells de prova de la web estàtica i valorar-ne la redundància.                |
| `plausible-analytics`        | Consultar l'analítica de `mountainrunners.cat` per l'API de només lectura de Plausible.                       |
| `project-context`            | Carregar la documentació que governa el projecte abans de proposar o canviar res.                             |
| `quality-gate`               | Aplicar el gate local de les pàgines públiques: documents, ordres, rutes i llindars de Lighthouse.            |
| `spec-authoring`             | Redactar especificacions de fase, funcionalitat o tasca segons la convenció del projecte.                     |
| `spec-implementation-review` | Revisar una implementació contra una tasca de l'especificació amb agents independents i sense modificar codi. |
| `unslop`                     | Treure els patrons de redacció d'IA del text, amb un mode tècnic per a documents i procediments.              |

## Cadena De Subministrament

Una skill externa només entra o s'actualitza si compleix totes aquestes
condicions:

1. La llicència de l'origen és compatible amb la del repositori i es verifica al
   repositori canònic, no en un índex de tercers.
2. Una persona ha llegit tot el contingut de la revisió exacta, descarregada
   sense executar-ne res.
3. La còpia local és idèntica byte a byte a l'origen, amb la llicència desada amb
   el nom local que el manifest ja fa servir (`LICENSE` o `LICENSE.md`).
4. El frontmatter de `SKILL.md` només té les claus `name`, `description`,
   `license`, `compatibility` i `metadata`, i `name` coincideix amb el directori.
   Una clau com `allowed-tools`, que alguns agents apliquen sense preguntar, es
   refusa.
5. El manifest es torna a fixar a la mateixa pull request revisada, amb el
   commit, el mapa de ruta a sha256 de cada fitxer i el hash de la llicència.
   `reviewedAt` és humà i només canvia amb la revisió.
6. La prova del manifest passa: un fitxer afegit, eliminat o modificat, un canvi
   de llicència o una clau de frontmatter no permesa fan fallar
   `pnpm test:server`.

Es refusen els fitxers executables, els symlinks, els scripts i qualsevol fitxer
que no sigui documentació, tret del fitxer de llicència. El contingut d'una
skill externa és no fiable fins que una persona el revisa: el manifest en fixa la
revisió, no n'avala el contingut.

Una revisió futura només pot incorporar una candidata després de verificar la
llicència al repositori canònic, descarregar la revisió exacta sense executar
scripts, validar tots els hashes, llegir-ne tot el contingut i conservar les
atribucions requerides.

## Historial

Aquest document substitueix la revisió de skills portables de la fase 2. Aquella
anàlisi, amb la detecció aïllada i les candidatures descartades, es conserva a
l'historial de git i no s'actualitza retrospectivament.
