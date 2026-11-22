# Especificació: Confirmació Del Merge Amb Una Pregunta I Una Resposta

## Estat

Pendent. Defineix l'entrada del
[backlog](../backlog.md#fusionar-quan-la-persona-dona-la-feina-per-validada) i
una esmena proposada a
[l'ADR 0013](../decisions/0013-private-development-agent-boundary.md). Cap tasca
passa a `En curs` fins que es fusioni la PR d'aquesta especificació. No canvia cap
token, entorn ni configuració remota, no activa cap permís i no fa cap merge real.

## Objectiu

Quan una persona verificada valida al tema la versió revisada, el servei respon
amb una pregunta fixa. Només la resposta «Sí» d'aquella persona a aquella pregunta
autoritza fusionar amb squash la PR i el SHA de la preview confirmada. El text no
autoritza res més.

## Límits I Decisions Confirmades

La persona mantenidora confirma aquestes decisions el 22 de novembre de 2026:

- L'única autorització nova és la resposta «Sí» d'una persona verificada a la
  pregunta fixa del servei. Autoritza només la PR i el SHA de la preview
  confirmada vigent, resolts amb l'estat del servei i mai amb el text ni amb dades
  del client.
- La validació només provoca la pregunta. Cap prosa, cita o reenviament, text d'una
  PR, del model o d'una eina, ni un assentiment simple com «Perfecte» autoritza.
- No hi ha model ni interfície ni credencial nova: la pregunta és un missatge i la
  confirmació una resposta, i el transport de Telegram no canvia.
- La fusió és a `main`. El desplegament s'inicia amb aquest push segons
  `.github/workflows/artifact.yml` i els controls de producció de
  [`docs/operations/web-and-releases.md`](../operations/web-and-releases.md#controls); el servei no fa cap operació nova, no
  garanteix la publicació, no en consulta l'estat i no tanca cap PR sense fusionar.
- Es mantenen la pertinença verificada, les comprovacions en verd, la branca al
  dia, l'absència de bypass, el squash i l'absència d'auto-merge i de desplegament
  per iniciativa del servei.
- Les formes de `/merge` no canvien. «Publica-la» és una aprovació editorial, no un
  merge.

Derivat de T8.9, de l'ADR 0009 i del backlog, sense decisió nova:

- L'avís de preview confirmada fixa el SHA del merge; avui el fixa el seguiment de
  CI i la T1 ho corregeix.
- Es conserven les fronteres de l'ADR 0009 i de l'etiqueta `preview`: només
  branques del repositori principal, revalidació abans d'actuar i
  `preview-revoked` amb precedència.
- El servei no pot provar que la persona ha obert l'enllaç: anuncia la versió
  revisada i registra la confirmació, sense afirmar cap lectura.

## Resultats Esperats

- Una persona verificada respon a l'avís amb «La feina està validada» i el tema rep
  només la pregunta fixa. «Perfecte», qualsevol altre text, un avís anterior o una
  persona no verificada no reben cap pregunta.
- La resposta «Sí» d'aquella persona a aquella pregunta fusiona el SHA de la
  preview i el tema n'informa. Un «Sí» repetit, d'una altra persona, reenviat o
  editat no fusiona res, i si la preview, el cap, les comprovacions o la feina han
  canviat, la confirmació no fusiona i ho diu planerament.
- `/merge` conserva les formes i els controls.

## Dependències I Ordre D'Inici

- Previews de la fase 6 i etiqueta `preview`.
- Esmena proposada de l'ADR 0013 fusionada.
- La T2 depèn de la T1: sense el SHA de la preview confirmada, la pregunta no pot
  autoritzar-lo.
- Abans d'activar cal verificar els controls i alinear les instruccions dins de la
  T2. Aquest esborrany no canvia les regles vigents, i la primera fusió real
  necessita l'aprovació explícita de la persona mantenidora.

## Tasques, Entregues I Seguiment

| Tasca | Estat   | Dependències    | Resultat verificable                                     | PR  |
| ----- | ------- | --------------- | -------------------------------------------------------- | --- |
| T1    | Pendent | Esmena ADR 0013 | El merge fixa el SHA de la preview confirmada i lliurada | -   |
| T2    | Pendent | T1 i esmena ADR | El «Sí» a la pregunta autoritza aquell merge i cap altre | -   |

### T1: Fixació Del Merge A La Preview Confirmada

**Abast:** el seguiment de la preview, la resolució del merge, les proves,
`tools/server/agent/README.md` i, si el pin de CI hi queda incorrecte,
[`docs/operations/agent.md`](../operations/agent.md).

**Exclusió immediata:** no afegeix cap pregunta ni canvia el sandbox, el token,
l'etiqueta o el publicador. `/merge` conserva les formes i la resta de controls.

**Resultat observable:** el merge resol la PR i el SHA de l'última preview
confirmada i lliurada, i refusa si no n'hi ha cap de vigent.

**Comprovacions mínimes:** `pnpm test:server`.

**PR:** una sola,
`feat(phase-8-merge-confirmation-t1): pin the merge to the confirmed preview`.

### T2: Confirmació Del Merge Amb Pregunta I Resposta

**Abast:** la pregunta i la confirmació a `tools/server/agent/`, les proves,
`tools/server/agent/README.md` i l'alineació de les instruccions d'agents
(`AGENTS.md`, `CONTRIBUTING.md`, [`docs/ai-assistant.md`](../ai-assistant.md)) i de
la documentació operativa i d'arquitectura afectada
([`docs/architecture.md`](../architecture.md),
[`docs/operations/agent.md`](../operations/agent.md) i
guies).

**Exclusió immediata:** no canvia les formes de `/merge`, la reparació de CI, els
avisos, el build de la preview, el component de GitHub ni el transport de
Telegram. No afegeix cap credencial.

**Resultat observable:** una validació explícita a l'avís vigent ofereix la
pregunta, i el «Sí» d'aquella persona a aquella pregunta fusiona la PR i el SHA
fixats.

**Comprovacions mínimes:** `pnpm test:server`, sense cap merge real.

**PR:** una sola,
`feat(phase-8-merge-confirmation-t2): confirm the merge with a question and a reply`.

## Fixació Del Merge (T1)

- L'únic que fixa el SHA és l'avís de preview confirmada i lliurada, amb
  l'identificador del missatge desat després de l'enviament; un enviament fallit o
  incert no deixa cap vincle i un verd de CI no és cap prova de lliurament.
- Només compta la preview confirmada de la publicació més nova; una publicació
  posterior sense avís confirmat no permet tornar a l'anterior.
- El merge exigeix PR oberta, no esborrany, base `main`, repositori principal, cap
  igual al SHA, comprovacions obligatòries en verd, branca al dia, etiqueta
  `preview` i cap `preview-revoked`. No fusiona si en falta res, si el lliurament és
  pendent o incert o si hi ha feina més nova que l'avís.
- Aprovada la T1, totes les formes de `/merge` resolen el SHA nou; la sintaxi i la
  resta de controls no canvien. `/merge <PR> <SHA>` pot reconciliar un resultat
  desconegut sense cap preview nova, sense autoritzar repetició ni salt de controls.

## Pregunta Fixa

El servei fa la pregunta només quan es compleixen totes aquestes condicions:

- El missatge és una resposta al missatge de l'avís vigent, identificat per
  l'identificador que el servei ha desat, i l'autor és membre verificat del grup en
  aquell moment. El transport actual només sap que respon a un missatge del bot: la
  T2 conserva la identitat exacta de la resposta (mateix grup, tema, missatge i
  bot) des de l'actualització fiable fins al maneig, i denega `external_reply`,
  cites, reenviaments, edicions i fitxers o llegendes.
- El text sencer, normalitzat (espais, majúscules i minúscules i puntuació final),
  coincideix exactament amb una validació d'una llista tancada. «La feina està
  validada» n'és l'exemple; «Perfecte» no hi és. No hi ha coincidència parcial ni
  difusa, i les variants queden pendents.
- La preview compleix [Fixació del merge](#fixació-del-merge-t1), i el tema no té
  feina més nova ni cap merge en curs o desconegut per a aquella PR.

La pregunta i la confirmació es reconeixen abans del classificador i no inicien
cap torn de model. El servei respon amb aquesta pregunta fixa, i res més:

> Segur que vols donar aquesta feina per acabada? Si confirmes, els canvis
> d'aquesta versió es fusionaran i es publicaran a producció si el desplegament
> acaba bé. Respon «Sí» a aquest missatge per confirmar.

La pregunta queda fixada a l'avís, a la PR i el SHA vigents i a la persona. El
servei en desa l'identificador després d'un enviament confirmat; si l'enviament
falla o és incert, no hi ha cap pregunta vàlida. Un avís substituït per un de més
nou també és inert. Qualsevol altre text segueix el camí actual i no fusiona res.

## Confirmació Amb «Sí»

- Només compta la resposta directa «Sí» a aquella pregunta, de la mateixa persona
  verificada, comprovada de nou, al mateix grup i tema, en un missatge escrit pel
  servei i amb l'identificador exacte desat. Es conserva la mateixa identitat de
  resposta i els mateixos denegats que a la pregunta, i no s'autoritza a partir de
  text citat ni de noms visibles.
- No compta cap «Sí» solt sense ser resposta a la pregunta, ni el d'una tercera
  persona, ni un missatge copiat, reenviat, citat o editat, ni buit ni amb altre
  text. La normalització, si és coherent, es limita a retallar espais i a ignorar
  majúscules i minúscules; el servei no entén prosa i no llegeix cap PR ni SHA del
  text.
- Un canvi de SHA, la retirada de l'etiqueta `preview`, una preview revocada o una
  feina nova invaliden la pregunta. El «Sí» no es recondueix mai a un altre SHA.
- Si tot es compleix, fa l'única operació de merge existent amb el SHA fixat i
  mètode squash. La fusió és a `main` i el desplegament segueix
  `.github/workflows/artifact.yml` i els controls de producció; el servei no en
  garanteix el resultat ni en consulta l'estat. Cap bypass, auto-merge ni
  desplegament per part del servei, i cap PR tancada sense fusionar.
- Una comprovació fallida o no concloent no fusiona i respon en llenguatge planer.

## Idempotència I Reconciliació

- Un «Sí» repetit o una pregunta duplicada no fusiona dues vegades, encara que el
  servei es reiniciï.
- Un resultat desconegut no es repeteix: es llegeix la PR. Si GitHub la mostra
  fusionada, es tanca i s'informa; si no, només una persona verificada decideix amb
  `/merge <PR> <SHA>`.
- Un reinici o un estat incert fallen en tancat: no es repeteix cap merge ni se
  n'inventa el resultat.
- La traça privada registra autor, moment, PR, SHA i mètode, sense el text de la
  conversa.

## Estratègia De Tests I Qualitat

Se segueix [l'estratègia de proves](../testing-strategy.md). Les proves són de
servidor (`pnpm test:server`) amb Telegram i GitHub simulats, i no fusionen cap PR.

- T1: preview confirmada i lliurada vigent; sense cap preview; confirmació d'un cap
  anterior; lliurament pendent o incert; sense etiqueta; amb `preview-revoked`; feina
  més nova; publicació posterior sense avís confirmat; verd de CI no enviat;
  identificador desat només després de l'enviament; SHA opcional igual i diferent;
  resultat desconegut reconciliat amb `/merge <PR> <SHA>` sense preview nova.
- T2, pregunta: l'exemple acceptat; «Perfecte»; validació incrustada en més text;
  resposta a un avís anterior; avís substituït; autor no verificat; feina més nova;
  preview pendent, sense etiqueta o revocada; enviament de la pregunta fallit o
  incert.
- T2, confirmació: «Sí» correcte; «Sí» solt; tercera persona o una altra persona
  verificada; missatge copiat, reenviat, citat o editat; buit o amb altre text;
  identificador desconegut; missatge no escrit pel servei; `external_reply`, cita,
  reenviament, edició, fitxer o llegenda; SHA mogut; etiqueta retirada; preview
  revocada; feina nova; duplicat; reinici; estat incert; cap PR tancada sense
  fusionar.
- Comprovació manual: cap merge real; després de l'activació aprovada.

## Seguretat I Privacitat

Aquests requisits es deriven de les decisions anteriors; no són decisions noves.

- La confirmació afegeix una via d'autorització, així que el servei només pot
  autoritzar el que ha desat ell mateix: una dada del text o del client no tria la
  PR ni el SHA.
- La mateixa persona, tema i identificador de pregunta eviten que un «Sí» copiat,
  citat o d'un altre fil autoritzi res. Un enviament incert, una lectura fallida o
  una pertinença no verificada deneguen l'acció, i cap camí concedeix permís per
  defecte.
- La confirmació no arriba al model ni al sandbox, no amplia la xarxa ni les
  credencials, i la traça no desa el text de la conversa.
- La fusió inicia el desplegament; el risc és explícit i la primera fusió real
  requereix l'aprovació de la persona mantenidora.

## Fora D'Abast

- Qualsevol interfície específica; interpretar prosa o autoritzar per un text que no
  sigui la resposta «Sí».
- Canviar les formes o els controls de `/merge` més enllà de la font del SHA que
  proposa l'esmena, o tractar «publica-la» com una autorització de merge.
- Consultar l'estat de producció o corregir permisos d'Actions, el flux de la
  preview o qualsevol defecte aliè.
- Afegir una operació de GitHub, una credencial o un permís nou.
- Auto-merge, desplegament manual, bypass d'administrador o canvis de protecció.
- Editar `AGENTS.md` o `CONTRIBUTING.md` en aquest lliurament.
- Fer cap merge real durant les proves o la verificació.

## Criteris D'Acceptació

1. L'esmena de l'ADR 0013 és proposada i es fusiona abans de la implementació,
   sense activar cap permís; la primera fusió real requereix l'aprovació de la
   persona mantenidora.
2. El merge fixa el SHA de la preview confirmada i lliurada, amb l'identificador
   del missatge desat després de l'enviament. No fusiona sense preview vigent, amb
   un cap anterior, amb lliurament pendent o incert, sense etiqueta, amb
   `preview-revoked`, amb feina més nova o amb una publicació posterior sense avís
   confirmat. Les formes de `/merge` no canvien; `/merge <PR> <SHA>` reconcilia un
   incert sense preview nova, sense repetir ni saltar controls.
3. «La feina està validada» a l'avís vigent, d'una persona verificada, respon només
   amb la pregunta fixa i no inicia cap torn de model.
4. «Perfecte», qualsevol altre text, un avís anterior, una persona no verificada,
   un `external_reply`, una cita, un reenviament, una edició o un fitxer o llegenda
   no reben cap pregunta ni cap resposta inventada.
5. Només el «Sí» d'aquella persona a aquella pregunta fusiona amb squash la PR i el
   SHA fixats; la fusió és a `main`, el desplegament s'inicia amb el push i cap PR
   es tanca sense fusionar.
6. Una comprovació fallida o no concloent, un canvi de SHA, la retirada de
   l'etiqueta o una preview revocada no fusionen i responen en llenguatge planer.
7. Un «Sí» duplicat, també després d'un reinici, o un estat incert no fusionen dues
   vegades i fallen en tancat.
8. No hi ha model, interfície nova, credencial ni operació de GitHub nova, i cap
   PR/SHA no surt del text.
9. Cap prova no fa cap merge real; la verificació manual queda per a després de
   l'activació aprovada.
