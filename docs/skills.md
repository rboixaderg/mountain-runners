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

| Skill                                                         | Propòsit                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`docs-ownership`](../.agents/skills/docs-ownership/SKILL.md) | Identificar el document propietari abans d'editar documentació.                                               |
| `editorial-posts`                                             | Preparar i revisar esborranys de notícies i blog, amb publicació només a petició d'un membre verificat.       |
| `frontend-testing`                                            | Triar, escriure i revisar els nivells de prova de la web estàtica i valorar-ne la redundància.                |
| `plausible-analytics`                                         | Consultar l'analítica de `mountainrunners.cat` per l'API de només lectura de Plausible.                       |
| `project-context`                                             | Carregar la documentació que governa el projecte abans de proposar o canviar res.                             |
| `quality-gate`                                                | Aplicar el gate local de les pàgines públiques: documents, ordres, rutes i llindars de Lighthouse.            |
| `spec-authoring`                                              | Redactar especificacions de fase, funcionalitat o tasca segons la convenció del projecte.                     |
| `spec-implementation-review`                                  | Revisar una implementació contra una tasca de l'especificació amb agents independents i sense modificar codi. |
| `unslop`                                                      | Treure els patrons de redacció d'IA del text, amb un mode tècnic per a documents i procediments.              |

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

## Actualitzacions Setmanals

L'execució setmanal de `.github/workflows/skills-update.yml`, els dilluns, i la
manual llegeixen el manifest, resolen la branca per defecte de cada origen i
comparen el commit fixat amb l'últim. Quan canvien fitxers d'una skill, obre o
actualitza una pull request de bot per origen a la branca
`skills/update-<origen>`, amb l'etiqueta `skills`, el manifest tornat a fixar i
el títol `chore(skills): update <origen> to <sha7>`. No aprova, no fusiona, no
activa auto-merge i no toca `reviewedAt`. Si l'origen i `main` no han canviat,
l'execució no torna a empènyer la branca i, si el títol i el cos tampoc no
canvien, no actualitza la pull request: només imprimeix
`unchanged pull request <url>`, perquè un push nou reinicia la CI sense cap
canvi. Qualsevol refús (llicència canviada, fitxers que no són documentació,
symlinks, submòduls, límits de mida, caràcters de control, frontmatter no permès
o un commit que no es pot resoldre) fa fallar l'execució amb el motiu i no obre
cap pull request. Un fitxer de l'origen amb finals de línia CRLF també es refusa,
perquè `\r` és un caràcter de control: si l'origen n'introdueix, cal una revisió
manual abans de fixar la revisió.

`pnpm skills:update` imprimeix les propostes sense escriure res i sense cap
credencial. `--apply` queda reservat al workflow, que és l'únic que té el token
de l'App; l'ús local és sempre `--dry-run`.

### Què Revisa La Persona Mantenidora

1. L'enllaç de comparació de l'origen i el diff cru de cada fitxer: una injecció
   de prompt dins del Markdown no es pot refusar automàticament.
2. La llista «Per revisar» del cos de la pull request: comentaris HTML, URLs
   externes noves, blocs de shell i línies d'ordre.
3. Que la llicència continua sent la mateixa i que el manifest torna a fixar el
   commit, el mapa de fitxers i el hash de la llicència.
4. Que la pull request només toca `.agents/skills/<nom>/` i
   `skills-manifest.json`, i que la CI i la prova del manifest passen.
5. Que `reviewedAt` no canvia: només el mou una revisió humana.

`CODEOWNERS` assigna `.agents/skills/**` i `.github/workflows/**` a la persona
mantenidora, de manera que qui fusiona revisa el diff cru i no el Markdown
renderitzat.

### Rotació I Revocació De La Clau De L'App

L'App només té `Contents: write` i `Pull requests: write`, no té permís
`Workflows`, està instal·lada només en aquest repositori i no té cap bypass al
ruleset de `main`. Els secrets `SKILLS_UPDATE_APP_ID` i
`SKILLS_UPDATE_APP_PRIVATE_KEY` viuen a l'entorn `skills-update`, restringit a
`main`, i mai són secrets de repositori. Dependabot cobreix
`actions/create-github-app-token` amb la resta d'accions.

- **Rotació**: un cop l'any i de seguida que hi hagi un dubte. Genera una clau
  nova a la configuració de l'App, desa la clau privada al secret de l'entorn i
  executa el workflow amb `workflow_dispatch` per comprovar que obre o actualitza
  una pull request; llavors esborra la clau vella a la configuració de l'App.
- **Revocació**: esborra la clau compromesa a la configuració de l'App i
  substitueix el secret de l'entorn. Sense cap clau vàlida el workflow falla i
  no escriu res.
- L'App no té permís d'Issues, així que l'etiqueta `skills` s'ha de crear abans
  de la primera execució: sense ella la pull request no es pot etiquetar.

## Historial

Aquest document substitueix la revisió de skills portables de la fase 2. Aquella
anàlisi, amb la detecció aïllada i les candidatures descartades, es conserva a
l'historial de git i no s'actualitza retrospectivament.
