# Especificació: Sincronització De La Branca Abans Del Merge

## Estat

Implementació fusionada a la [PR #307](https://github.com/rboixaderg/mountain-runners/pull/307),
amb correccions a les PR [#311](https://github.com/rboixaderg/mountain-runners/pull/311),
[#312](https://github.com/rboixaderg/mountain-runners/pull/312) i
[#326](https://github.com/rboixaderg/mountain-runners/pull/326). Aquesta entrega
concreta la sincronització prevista a [T8.9](phase-8/phase-8-editorial-assistance.md)
i la relaciona amb la
[confirmació de la preview](preview-merge-confirmation.md). La validació amb
GitHub i Telegram simulats no acredita els controls reals de merge de T8.6.

Els casos de sincronització en torns de reparació automàtica de CI es conserven
com a registre. La [T26 de l'auditoria](agent-audit-remediation.md#t26-aplicar-lesmena)
va retirar aquests torns. La [T10 de l'auditoria](agent-audit-remediation.md#t10-feina-local-i-conflictes-de-la-branca-del-tema)
va corregir els bucles de sincronització que deixaven feina local pendent.

## Objectiu

Quan una persona verificada demana el merge i la branca no incorpora el `main`
actual, l'agent prepara una versió actualitzada perquè la persona la pugui
revisar a la preview abans de tornar a demanar el merge. Igualment, quan un torn
ordinari o de reparació té canvis o feina pendent de validar i publicar en un
worktree endarrerit, el servei integra el `main` actual abans que les
comprovacions locals bloquegin la publicació per una base antiga.

## Límits I Decisions Confirmades

- La petició que detecta la branca desactualitzada no autoritza el merge del
  commit nou. Cal una nova petició humana després de la preview actualitzada.
- S'apliquen els controls dels
  [ADR 0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md) i
  [0013](../decisions/0013-private-development-agent-boundary.md). L'agent no
  desplega directament: el merge a `main` inicia el pipeline aprovat, que pot
  fallar o quedar pendent.
- La sincronització dels worktrees actius es fa dins del flux de treball de
  l'agent en validar i publicar canvis o abans del merge, mai de manera
  automàtica durant l'actualització del servei al VPS. Les consultes i els torns
  sense canvis ni feina pendent no modifiquen el worktree; si la branca ja
  incorpora `main`, no s'afegeix cap commit de merge ni cap validació redundant.
- El model intenta resoldre els conflictes de text, però no es presumeix que
  una resolució sense marcadors sigui correcta. En cas de conflicte, prioritza
  normalment els canvis de la branca de treball i conserva els canvis
  compatibles de `main`. Si no es pot resoldre amb seguretat o cal una
  decisió de contingut, s'atura i pregunta.
- La preview és pública i el servei no pot verificar que la persona l'hagi
  oberta. Només pot informar-ne i registrar la petició posterior.

## Resultats Esperats

- Si la branca ja està al dia, el merge segueix el camí existent i els seus
  controls, sense exigir una revisió nova només per aquesta comprovació.
- Si no està al dia en una petició de merge, el servei prepara la branca i
  anuncia la nova preview, però no fusiona fins que una persona torna a
  autoritzar el merge.
- En un torn ordinari o de reparació amb canvis o feina pendent en una branca
  endarrerida, el servei integra `main` abans de les comprovacions locals; així
  les correccions ja fusionades a `main` eviten bloquejar el gate amb una base
  antiga i es conserva la feina local.
- Si la sincronització, la validació o la preview fallen, el servei ho comunica
  i no publica ni fusiona.

## Dependències I Ordre D'Inici

- Flux de branca i resolució de conflictes de T8.9, previews de la fase 6 i
  vinculació del merge a la preview confirmada i lliurada de
  [confirmació del merge](preview-merge-confirmation.md).
- Revisió de seguretat de la implementació i verificació dels controls i
  permisos existents abans d'activar-la. Qualsevol ampliació de la frontera
  acceptada exigeix una esmena d'ADR abans d'implementar-la.

## Tasques, Entregues I Seguiment

| Tasca | Estat      | Dependències                         | Resultat verificable                                           | PR                                                              |
| ----- | ---------- | ------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------- |
| T1    | Completada | T8.9 i fixació del SHA de la preview | Sincronització abans del gate i del merge, i nova autorització | [#307](https://github.com/rboixaderg/mountain-runners/pull/307) |

### T1: Sincronització I Nova Autorització

**Abast:** el flux de merge de l'agent privat, la sincronització amb `origin/main`
abans del gate local als torns ordinaris i de reparació, la reutilització del
flux de sincronització i la prioritat de resolució de conflictes, l'avís de
preview, les proves i l'actualització del document propietari del comportament
implementat.

**Exclusió immediata:** no canvia els mecanismes d'autorització, els permisos,
el publicador de preview ni el pipeline de producció, i no sincronitza worktrees
durant l'actualització del servei al VPS.

**Dependències:** les indicades a l'apartat anterior.

**Resultat observable:** una petició de merge sobre una branca desactualitzada
prepara una preview nova sense fusionar-la amb la petició anterior; un torn
ordinari o de reparació amb canvis o feina pendent en un worktree endarrerit
integra `main` abans de les comprovacions locals i no queda bloquejat per un
gate ja corregit a `main`.

**Comprovacions mínimes:** `pnpm test:server` i els casos de l'estratègia de
tests, sense cap merge ni desplegament real.

**PR:** una PR dedicada a T1.

## Sincronització I Revisió

1. En una petició de merge vàlida i atribuïble, el servei resol la PR i el SHA
   amb el seu estat fiable i comprova l'estat actual de `main`. En el flux de
   dos passos, si la persona valida la preview i la branca va per darrere, el
   servei inicia la sincronització sense formular la pregunta de confirmació
   antiga. No usa el model ni text no fiable per triar la PR o el SHA. Una
   petició de reconciliació d'un resultat desconegut conserva el seu camí de
   només consulta i no inicia sincronització.
2. En un torn ordinari o de reparació amb canvis o feina pendent de validar i
   publicar, el servei comprova l'estat de `origin/main` abans d'executar el
   gate local. Si la branca va per darrere, integra el `main` verificat sense
   rebase ni force-push, conserva la feina local (commitejada o sense
   commitejar) i executa les comprovacions locals sobre l'estat ja sincronitzat.
   La selecció del gate (`pnpm check:local` o `pnpm check`) es calcula respecte
   al `main` verificat sense degradar mai canvis fora del contingut. Si la
   branca ja està al dia, no afegeix cap commit de merge ni repeteix el gate.
   Si `main` torna a avançar entre la validació i la publicació, el servei el
   torna a integrar amb les mateixes regles i repeteix les comprovacions locals
   abans del push.
3. En una petició de merge sobre una branca endarrerida, el servei aplica la
   mateixa integració del `main` verificat amb un commit de merge, sense rebase
   ni force-push, conserva la feina existent i executa les comprovacions locals
   abans de publicar. En tots dos fluxos conserva també qualsevol revisió
   privada i aprovació abans del push exigides per les fronteres vigents de la
   feina; si canvia el commit, la base o l'estat que fixen aquella aprovació,
   no la reutilitza.
4. Davant un conflicte de text en qualsevol sincronització, el model prioritza
   els canvis de la branca de treball i intenta incorporar els canvis
   compatibles de `main` dins del sandbox. Si la prioritat no permet prendre
   una decisió segura o manca informació, pregunta a la persona sense triar per
   ella. Els conflictes binaris, una resolució fallida o amb marcadors, o un
   avortament que no es pot confirmar aturen el flux; no es publica una branca a
   mig resoldre ni es perd la feina local.
5. Després del push de sincronització prèvia al merge, el servei espera la
   preview confirmada per al nou cap i comunica al tema que cal revisar-la i
   tornar a sol·licitar el merge. La confirmació de CI sola no substitueix la
   preview ni l'avís lliurat.
6. La petició inicial de merge i qualsevol pregunta o confirmació anterior
   queden invàlides per al nou cap. No hi ha merge automàtic després de la
   sincronització. La nova petició segueix els mecanismes autoritzats vigents,
   tant `/merge` com la confirmació en dos passos, si està activa.
7. Abans de cada intent posterior de merge, el servei torna a comprovar el cap
   i `main`, la identitat, la PR, les comprovacions i la preview vigent. Si
   `main` ha tornat a avançar, es repeteix el cicle i cal una altra petició
   després de la nova preview. Si el cap canvia per qualsevol altra causa,
   s'invalida l'autorització anterior i s'exigeix la revisió de la preview
   corresponent.

El servei fixa l'estat esperat de la PR, la branca i la base per evitar
sobreescriure canvis concurrents. Revalida abans de publicar i abans del merge,
i falla en tancat si l'estat no es pot confirmar. El merge només pot afectar el
SHA de la preview vigent; si no es pot garantir que la branca continua al dia
fins a l'operació efectiva, no es fusiona. Una acció externa de resultat
desconegut es reconcilia abans de repetir-la.

## Estratègia De Tests I Qualitat

Les proves de servidor simulen Telegram, GitHub i el publicador, sense efectes
reals. Cobreixen la branca al dia; branca endarrerida sense conflictes; conflicte
de text resolt prioritzant la branca i conservant els canvis compatibles de
`main`; decisió que requereix consultar la persona; conflicte binari; resolució,
validació, push o preview fallits; avís no lliurat; i recuperació després d'un
resultat desconegut o reinici.

També cobreixen una petició o confirmació anterior que no fusiona el nou SHA,
una nova petició després de l'avís, la validació en dos passos amb branca
endarrerida sense pregunta antiga, la sincronització prèvia al gate local als
torns ordinaris i de reparació (worktree endarrerit amb canvis sense commitejar
o feina pendent que passa el gate només després d'incorporar `main`, preservació
de la feina si la sincronització o el gate fallen, absència de merge o validació
duplicada quan la branca ja està al dia, consultes o torns sense canvis que no
toquen el worktree, selecció correcta de `pnpm check:local` o `pnpm check`
respecte al `main` verificat i un segon avançament de `main` entre validació i
push), la prioritat de conflictes al push ordinari, la invalidació de qualsevol
revisió privada aplicable, canvis concurrents de cap o de `main`, revocació de
preview, manca de pertinença i comprovacions pendents o fallides. Es verifica
que la protecció efectiva de la branca impedeix fusionar quan `main` avança
durant la cursa final.

## Seguretat I Privacitat

Els continguts, camins i sortides del repositori són dades no fiables. El model
resol dins del sandbox existent, sense credencials ni accés de xarxa. El
component de confiança conserva les operacions acotades, els controls de
publicació i la reconciliació. No s'exposen dades privades a la PR ni a la
preview; les comprovacions automàtiques no garanteixen detectar-les totes.

## Fora D'Abast

- Auto-merge, bypass, force-push, push directe a `main` o desplegament directe.
- Afegir un mecanisme de monitoratge continu de `main`.
- Sincronitzar o modificar automàticament els worktrees actius durant
  l'actualització o el reinici del servei al VPS.
- Canviar el format de les autoritzacions, afegir credencials o afirmar que la
  persona ha llegit la preview.
- Garantir que el model resol tots els conflictes o que els tests detecten tots
  els errors semàntics.

## Criteris D'Acceptació

1. Una branca al dia segueix els controls de merge existents; una branca
   endarrerida es prepara sense executar el merge demanat.
2. En un torn ordinari o de reparació amb canvis o feina pendent en un worktree
   endarrerit, el servei integra el `main` verificat abans de les comprovacions
   locals, conserva la feina local en cas d'error i evita bloquejar-se per un
   gate ja corregit a `main`, sense modificar el worktree en consultes ni torns
   sense canvis.
3. La sincronització preserva la feina i resol els conflictes de text quan és
   possible, prioritzant la branca i conservant els canvis compatibles de
   `main`; si cal una decisió o la resolució no és segura, s'atura i informa.
4. Un nou SHA exigeix preview confirmada i avís lliurat, revisió humana i una
   nova autorització. Cap petició o confirmació anterior fusiona el nou SHA.
5. Les curses, fallades i estats incerts no permeten publicar una resolució
   incompleta ni fusionar una versió no autoritzada o desactualitzada.
6. Les comprovacions definides passen sense cap merge ni desplegament real.
