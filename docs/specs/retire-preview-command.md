# Especificació: Retirada De La Petició De Preview Amb `/preview`

## Estat

Pendent. Defineix l'entrada del
[backlog](../backlog.md#retirar-la-petició-de-preview-amb-preview). Cap tasca
passa a `En curs` fins que la PR d'aquesta especificació, amb les esmenes
proposades als
[ADR 0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md) i
[ADR 0013](../decisions/0013-private-development-agent-boundary.md), es revisi i
es fusioni. Aquesta especificació no canvia cap token, entorn o configuració
remota.

## Objectiu

L'etiqueta `preview` de la PR passa a ser l'única autorització d'una preview. El
comentari `/preview` deixa de publicar res, l'execució manual només torna a
publicar una PR que té l'etiqueta i la reconciliació periòdica retira la preview
de qualsevol PR oberta sense l'etiqueta. L'agent de la fase 8 deixa de conservar
el codi que reconciliava els comentaris `/preview` que publicava abans de
l'etiqueta.

## Límits I Decisions Confirmades

La persona mantenidora confirma aquestes decisions el 21 de novembre de 2026:

- Es retira el disparador `issue_comment` del workflow `Preview` i tota
  l'autorització per comentari. Un comentari `/preview` posterior no executa
  res.
- `workflow_dispatch` es manté només com a reintent: exigeix que la PR tingui
  l'etiqueta `preview`, no tingui `preview-revoked` i que l'actor tingui permís
  `write` o `admin`.
- Amb l'etiqueta com a única autorització, la reconciliació periòdica retira la
  preview de qualsevol PR oberta sense l'etiqueta. Això tanca el risc d'una
  retirada per `unlabeled` perduda.
- El codi de l'agent que només existeix per a les peticions `/preview` anteriors
  a l'etiqueta es retira en una tasca pròpia, quan el servei desplegat no en
  tingui cap pendent.
- Es mantenen les fronteres de l'ADR 0009: només branques del repositori
  principal, vinculació al SHA del cap, revalidació abans d'activar,
  `preview-revoked` amb precedència, retirada en tancar la PR i
  `PreviewNotice` amb `PUBLIC_PREVIEW`.

## Resultats Esperats

- Un comentari `/preview` a una PR no inicia cap execució del workflow
  `Preview`.
- Una execució manual d'una PR sense l'etiqueta o amb `preview-revoked` falla de
  manera visible i no publica. Amb l'etiqueta, torna a publicar el cap actual.
- La reconciliació horària retira la preview d'una PR oberta que no té
  l'etiqueta, també si s'havia publicat abans d'aquest canvi.
- El publicador i les seves proves no tenen cap camí de comentari.
- L'agent no conté l'ordre `/preview`, la lectura del compte autenticat ni els
  estats `commenting` i `uncertain` de les peticions de preview.

## Dependències I Ordre D'Inici

- Depèn de l'[especificació de l'etiqueta de preview](preview-label.md) amb la
  T1 completada i les seves verificacions a GitHub real comprovades.
- Depèn de les esmenes dels ADR 0009 i 0013 d'aquesta mateixa PR.
- La T2 depèn de la T1 i que el servei desplegat amb la T1 de l'etiqueta hagi
  arrencat sense cap petició de preview incerta.

## Tasques, Entregues I Seguiment

| Tasca | Estat   | Dependències                        | Resultat verificable                                           | PR  |
| ----- | ------- | ----------------------------------- | -------------------------------------------------------------- | --- |
| T1    | Pendent | Etiqueta verificada, esmenes ADR    | `/preview` no publica i la reconciliació retira sense etiqueta | -   |
| T2    | Pendent | T1, servei sense peticions incertes | L'agent no conté el codi de les peticions `/preview`           | -   |

### T1: Retirada De `/preview` Al Publicador

**Abast:** `.github/workflows/preview.yml`, `.github/workflows/preview-cleanup.yml`,
`tools/preview/`, `tools/server/preview/gate.test.mjs`, les seves proves,
[`docs/deployment.md`](../deployment.md) i [`docs/runbook.md`](../runbook.md).

**Exclusió immediata:** no canvia el build no fiable, el procés
`mountain-preview-site`, el grup de concurrència `previews`, el token del servei
ni l'agent.

**Dependències:** etiqueta verificada a GitHub real i esmenes aprovades.

**Resultat observable:** un comentari `/preview` no executa res; una execució
manual exigeix l'etiqueta; la reconciliació horària retira les previews de PR
obertes sense etiqueta.

**Comprovacions mínimes:** `pnpm test:server` i `actionlint` si està
disponible. Després del merge, la prova real de
[Verificació a GitHub](#verificació-a-github).

**PR:** una sola, `feat(phase-8-t8.9): retire the /preview comment request`.

### T2: Retirada Del Codi `/preview` De L'Agent

**Abast:** `tools/server/agent/` (`policy/development.mjs`, `repository/github.mjs`,
`repository/preview-request-store.mjs`, `workflow/preview-request.mjs`,
`processes/telegram-bridge/main.mjs`, `commands/reconcile/`), les seves proves,
`tools/server/agent/README.md` i [`docs/deployment.md`](../deployment.md).

**Exclusió immediata:** no canvia el seguiment de la preview de cada
publicació, la petició d'una persona, la confirmació pel comentari del
publicador ni la reconciliació d'instruccions, avisos, reparacions i merges.

**Dependències:** T1 fusionada i servei desplegat sense cap petició de preview
incerta.

**Resultat observable:** l'agent arrenca i treballa sense cap codi de petició
`/preview`, i l'ordre de reconciliació ja no llista casos de preview.

**Comprovacions mínimes:** `pnpm test:server`.

**PR:** una sola, `refactor(phase-8-t8.9): remove the legacy /preview requests`.

## Publicador

- El workflow `Preview` s'activa amb `pull_request_target` (`labeled`,
  `synchronize`) i `workflow_dispatch`. Desapareix `issue_comment`.
- Tot camí de publicació exigeix l'etiqueta `preview` i rebutja
  `preview-revoked` abans d'autoritzar, d'activar i de comentar l'URL. Deixa de
  ser una opció del publicador.
- L'actor sempre necessita `write` o `admin`: el `sender` en un esdeveniment de
  la PR i qui llança l'execució manual. Desapareix la comprovació de
  col·laboradora del comentari.
- Una execució manual d'una PR sense l'etiqueta falla abans del build, de manera
  visible, sense publicar res.
- Les instruccions del runbook per demanar o reintentar una preview parlen
  només de l'etiqueta i de l'execució manual.

## Reconciliació

- `reconcile.mjs` retira, a més dels casos actuals, la preview de qualsevol PR
  oberta sense l'etiqueta `preview`.
- En el primer cicle després del merge, una PR oberta publicada amb `/preview`
  i sense l'etiqueta perd la preview. Si s'ha de conservar, una persona amb
  permís hi posa l'etiqueta abans del merge.
- La retirada immediata en treure l'etiqueta i la retirada en tancar la PR no
  canvien.

## Agent

- Es retiren `previewCommand`, `getAuthenticatedLogin`, la recuperació
  `recoverCommenting`, les resolucions de peticions incertes, el recompte que
  bloqueja l'arrencada i els casos de preview de l'ordre de reconciliació.
- L'esquema de `preview_requests` no es migra: les files acabades conserven el
  seu estat i el servei no en llegeix cap en `commenting` o `uncertain`.
- Abans d'instal·lar la T2, la persona operadora comprova amb l'ordre de
  reconciliació de la versió anterior que no queda cap petició de preview
  incerta. Si n'hi ha, la reconcilia primer.

## Verificació A GitHub

Després del merge de la T1, en una PR de prova pròpia:

- Un comentari `/preview` no inicia cap execució del workflow `Preview`.
- Una execució manual sense l'etiqueta falla; amb l'etiqueta, publica el cap.
- Una preview d'una PR oberta sense l'etiqueta desapareix a la reconciliació
  horària següent.

## Estratègia De Tests I Qualitat

Se segueix [l'estratègia de proves](../testing-strategy.md). Les proves són de
servidor (`pnpm test:server`) amb GitHub i transport simulats.

- Publicador: execució manual amb i sense etiqueta, amb `preview-revoked` i amb
  un actor `read`; cap disparador `issue_comment` ni camí de comentari al
  workflow ni als scripts; l'etiqueta comprovada abans d'autoritzar, d'activar i
  de comentar en tots els camins.
- Reconciliació: PR oberta sense etiqueta retirada; PR oberta amb etiqueta
  conservada; casos actuals sense canvis.
- Agent: arrencada amb peticions `awaiting`, `confirmed`, `timed_out` i
  `failed`; seguiment d'una publicació i petició d'una persona sense canvis;
  ordre de reconciliació sense casos de preview.

## Seguretat I Privacitat

- Desapareix una via de publicació de contingut no fiable i la comprovació
  més feble (col·laboradora sense nivell). Queda una sola autorització, amb
  `write` o `admin`.
- L'agent perd codi que llegia la identitat del seu compte a GitHub. No guanya
  cap operació nova.
- La retirada de PR sense etiqueta redueix les previews actives.

## Fora D'Abast

- Canviar el build no fiable, el grup `previews`, els secrets `PREVIEW_*` o el
  DNS.
- Respondre a un comentari `/preview` amb un missatge a la PR.
- Migrar o esborrar files antigues de `preview_requests`.
- Retirar `workflow_dispatch`.

## Criteris D'Acceptació

1. Les esmenes dels ADR 0009 i 0013 estan fusionades abans de la
   implementació.
2. Un comentari `/preview` no inicia cap execució del workflow `Preview`.
3. Una execució manual sense l'etiqueta, amb `preview-revoked` o d'un actor
   sense escriptura no publica; amb l'etiqueta, publica el cap actual.
4. La reconciliació periòdica retira la preview de les PR obertes sense
   l'etiqueta i conserva la de les que la tenen.
5. L'agent no conté l'ordre `/preview`, la lectura del compte autenticat ni els
   estats `commenting` i `uncertain`, i el seguiment de preview no canvia.
6. Els punts de [Verificació a GitHub](#verificació-a-github) s'han comprovat
   després del merge de la T1.
