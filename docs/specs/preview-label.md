# Especificació: Petició De Preview Amb Una Etiqueta De La PR

## Estat

Pendent. Defineix l'entrada del [backlog](../backlog.md#demanar-la-preview-amb-una-etiqueta-de-la-pr)
i l'[issue #261](https://github.com/rboixaderg/mountain-runners/issues/261).
Cap tasca passa a `En curs` fins que la PR d'aquesta especificació, amb les
esmenes proposades als
[ADR 0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md) i
[ADR 0013](../decisions/0013-private-development-agent-boundary.md), es revisi i
es fusioni. Aquesta especificació no canvia cap token, entorn o configuració
remota.

## Objectiu

Una persona amb permís d'escriptura posa l'etiqueta `preview` a una PR del
repositori principal i la preview es publica al cap actual i a cada push
posterior, sense cap comentari. Treure l'etiqueta retira la preview. L'agent
privat de la fase 8 posa l'etiqueta quan obre la PR del tema i deixa de comentar
`/preview`.

## Límits I Decisions Confirmades

La persona mantenidora confirma aquestes decisions el 21 de novembre de 2026:

- L'etiqueta `preview` i el comentari `/preview` conviuen. `workflow_dispatch`
  es manté. La retirada de `/preview` és una entrada pròpia del backlog i no
  forma part d'aquesta especificació.
- Treure l'etiqueta `preview` retira la preview de la PR, també si s'havia
  publicat amb `/preview` o amb una execució manual.
- L'agent de la fase 8 demana la preview amb l'etiqueta quan crea la PR del
  tema, no amb el comentari `/preview`.
- El disparador és `pull_request_target`, que executa el workflow des de `main`,
  mai `pull_request`. L'entorn `previews` no té regles de protecció ni política
  de branques (verificat amb l'API de GitHub el 21 de novembre de 2026): amb
  `pull_request`, una branca del repositori podria canviar el workflow i llegir
  els secrets `PREVIEW_*`.
- Es mantenen les fronteres de l'ADR 0009: només branques del repositori
  principal, vinculació al SHA del cap, revalidació abans d'activar,
  `preview-revoked` amb precedència, retirada en tancar la PR i
  `PreviewNotice` amb `PUBLIC_PREVIEW`.
- La petició deixa de ser per commit i passa a valer per a la PR mentre tingui
  l'etiqueta: cada push publica sense cap acte humà nou. És el canvi que
  recullen les esmenes dels ADR 0009 i 0013.

## Resultats Esperats

- Posar `preview` a una PR pròpia publica el cap actual. Un push posterior
  publica el cap nou sense cap altra acció.
- Un push a una PR sense l'etiqueta no executa cap build: el run apareix com a
  omès.
- Treure l'etiqueta retira la preview. Una publicació de l'etiqueta que encara
  no s'ha activat no s'activa.
- `/preview` i `workflow_dispatch` es comporten com ara.
- L'agent obre la PR amb l'etiqueta i informa l'URL que confirma el publicador
  per al cap actual, sense comentar `/preview`.

## Dependències I Ordre D'Inici

- Depèn de les previews de la fase 6 i de les esmenes dels ADR 0009 i 0013
  d'aquesta mateixa PR.
- Substitueix el bloc 4 de
  [T8.9](phase-8-editorial-assistance.md#un-tema-una-feina-t89) (preview
  automàtica amb `/preview`), que encara no s'ha implementat.
- L'etiqueta `preview` existeix al repositori des del 21 de novembre de 2026,
  creada amb l'aprovació de la persona mantenidora. Fins que es fusioni la
  implementació, posar-la a una PR no publica cap preview.

## Tasques, Entregues I Seguiment

| Tasca | Estat   | Dependències            | Resultat verificable                                      | PR                                                              |
| ----- | ------- | ----------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| T1    | En curs | Esmenes ADR 0009 i 0013 | L'etiqueta publica i retira la preview, i l'agent la posa | [#268](https://github.com/rboixaderg/mountain-runners/pull/268) |

### T1: Petició De Preview Amb L'Etiqueta

**Abast:** publicació i retirada amb l'etiqueta
(`.github/workflows/preview.yml`, `.github/workflows/preview-cleanup.yml` i
`tools/preview/`), la petició de l'agent (`tools/server/agent/repository/github.mjs`,
`tools/server/agent/workflow/preview-request.mjs` i els mòduls que els criden),
les seves proves, [`docs/deployment.md`](../deployment.md) i
[`docs/runbook.md`](../runbook.md).

**Exclusió immediata:** no canvia `/preview`, `workflow_dispatch`, el build no
fiable, el procés `mountain-preview-site`, el token del servei, `/merge` ni els
avisos fixos de T8.9.

**Dependències:** esmenes dels ADR 0009 i 0013 aprovades.

**Resultat observable:** posar l'etiqueta publica el cap actual i cada push
posterior; treure-la retira la preview; una PR nova d'un tema té l'etiqueta i
el servei informa l'URL confirmada sense comentar `/preview`.

**Comprovacions mínimes:** `pnpm test:server` i `actionlint` si està
disponible. Després del merge, la prova real de
[Verificacions a GitHub](#verificacions-a-github).

**PR:** una sola, `feat(phase-8-t8.9): request previews with a pull request label`.

## Publicació Amb L'Etiqueta

- El workflow `Preview` s'activa també amb `pull_request_target` dels tipus
  `labeled` i `synchronize`. Una condició a nivell de job deixa passar només
  `labeled` amb l'etiqueta `preview` i `synchronize` d'una PR que la té; la
  resta de runs queden omesos sense ocupar cap executor de build.
- El job `authorize` executa codi de `main`, com ara. Llegeix el número de PR de
  l'esdeveniment i resol el cap per API amb `resolvePullRequestState`. No usa
  `GITHUB_SHA`, que en aquest esdeveniment és l'últim commit de `main`.
- L'actor és el `sender` de l'esdeveniment: qui posa l'etiqueta a `labeled` i
  qui fa el push a `synchronize`. `authorize` i `publish` exigeixen que tingui
  permís `write` o `admin` amb `collaborators/{user}/permission`, la mateixa
  comprovació que `assertDispatchActorAuthorized`. Si no el té, el run falla de
  manera visible i no publica.
- En un run de l'etiqueta, a més de les revalidacions actuals, `publish`
  comprova que la PR continua tenint l'etiqueta `preview` immediatament abans
  d'activar i abans de comentar l'URL. Un run de `/preview` o de
  `workflow_dispatch` no exigeix l'etiqueta. `preview-revoked` continua tenint
  precedència.
- El job `build` no canvia: fa checkout del cap resolt, sense secrets, caches
  ni permisos d'escriptura.
- Una execució nova per a la mateixa PR cancel·la el `build` d'una execució
  anterior que encara no ha acabat, sigui quin sigui el mecanisme de petició.
  Una publicació en curs no s'interromp: el grup `previews` continua
  serialitzant `publish`, i `publish` continua refusant un cap mogut.
- Tornar a posar l'etiqueta no és la via de reintent. Una preview fallida es
  torna a publicar amb un push nou, amb `/preview` o amb `workflow_dispatch`, o
  traient i tornant a posar l'etiqueta.
- Una PR reoberta amb l'etiqueta no publica fins al proper push o una petició
  explícita.

## Retirada En Treure L'Etiqueta

- `preview-cleanup.yml` s'activa també amb `pull_request_target` del tipus
  `unlabeled`. Si l'etiqueta treta és `preview`, retira la preview d'aquella PR
  i en desactiva el lloc, amb les ordres `retire` i `site-disable` existents.
  Treure qualsevol altra etiqueta no retira res.
- La retirada s'executa al grup `previews`, com la resta de la reconciliació:
  no pot coincidir amb una activació. Si una publicació de l'etiqueta
  s'executa després, la comprovació de l'etiqueta n'impedeix l'activació. Una petició
  posterior amb `/preview` o `workflow_dispatch` torna a publicar, perquè és una
  petició explícita nova.
- Retirar una PR sense preview activa acaba sense error.

## Petició De L'Agent

- Quan el servei crea la PR d'un tema, hi posa l'etiqueta `preview` amb
  `POST /repos/{owner}/{repo}/issues/{number}/labels`. És l'única operació
  d'etiquetes del component de GitHub: només a la PR del tema, només
  l'etiqueta `preview` i mai per treure'n cap.
- Posar l'etiqueta és idempotent. Després d'un resultat desconegut, el servei
  llegeix les etiquetes de la PR abans de repetir-ho. Si no la pot posar, ho
  diu amb l'avís de fallada de T8.9 i no comenta `/preview`.
- El servei no torna a posar l'etiqueta a una PR existent. Si una persona
  mantenidora l'ha treta, el servei no anuncia cap preview per a aquella PR.
  Les PR obertes abans d'aquest canvi no tenen l'etiqueta fins que una persona la posi.
- Cada push del servei a la PR del tema publica la preview amb `synchronize`.
  El servei espera el comentari del publicador que nomena el cap actual i
  informa aquella URL, com a T8.8. No construeix ni endevina cap URL.
- El servei ja no espera les comprovacions verdes per demanar la preview: el
  `build` de la preview executa `pnpm validate` i un cap vermell no es publica.
- La correlació d'un run fallit amb la PR i el cap no pot dependre del
  `head_sha` del run, que en `pull_request_target` no és el cap de la PR. Si
  la prova real no demostra una correlació fiable, el servei s'atura al
  termini existent i envia l'avís de fallada.
- El servei deixa d'escriure peticions `/preview`. Els estats `commenting` i
  `uncertain` i la correlació per finestres de comentari es retiren només
  quan cap petició pendent els necessiti després d'un reinici.

## Verificacions A GitHub

Les fonts consultades el 21 de novembre de 2026 són la
[referència d'esdeveniments](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
la [referència d'etiquetes](https://docs.github.com/en/rest/issues/labels),
els [nivells de permís d'un repositori personal](https://docs.github.com/en/account-and-profile/reference/permission-levels-for-a-personal-account-repository),
la [guia de Dependabot a Actions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions)
i la [facturació d'Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Verificat a la documentació:

- `pull_request_target` s'executa en el context de la branca per defecte;
  `GITHUB_SHA` és l'últim commit de la branca per defecte.
- Al repositori personal `rboixaderg/mountain-runners`, gestionar etiquetes és
  una acció de col·laboradora, i les col·laboradores tenen escriptura. Els
  autors de forks no són col·laboradors.
- Afegir etiquetes accepta un token amb `Issues: write` o `Pull requests: write`.
  El token del servei ja té `Pull requests: write`: no cal cap permís nou.
- Les restriccions de Dependabot (token de només lectura, sense secrets
  d'Actions) s'apliquen a `push`, `pull_request` i les revisions, no a
  `pull_request_target`. Una PR de Dependabot amb l'etiqueta arribaria a
  `authorize`, que la refusa perquè `dependabot[bot]` no té permís `write`.
- Els esdeveniments creats amb el `GITHUB_TOKEN` d'un workflow no inicien
  workflows, excepte `workflow_dispatch` i `repository_dispatch`. El servei usa
  el seu token propi, no el `GITHUB_TOKEN`.
- Els executors estàndard de GitHub són gratuïts als repositoris públics.

Pendent de verificar amb GitHub real abans d'activar-ho a l'agent:

- El `sender` de `synchronize` és qui fa el push.
- El token real del servei pot posar l'etiqueta i no pot treure `preview-revoked`
  pel component.
- Tornar a posar una etiqueta que la PR ja té no genera cap esdeveniment.
- Quins camps del run de `pull_request_target` (`pull_requests`,
  `display_title`) permeten correlacionar-lo amb la PR i el cap.

## Estratègia De Tests I Qualitat

Se segueix [l'estratègia de proves](../testing-strategy.md). Les proves són de
servidor (`pnpm test:server`) amb GitHub i transport simulats.

- Publicació: `labeled` amb `preview` i amb una altra etiqueta; `synchronize` amb i
  sense etiqueta; actor `write`, `admin`, `read` i sense permís; etiqueta treta
  entre `authorize` i l'activació; `preview-revoked`; fork; PR tancada; cap
  mogut. Les proves del workflow comproven el disparador `pull_request_target`,
  la condició de job i que `build` no rep secrets.
- Retirada: `unlabeled` de `preview` amb preview activa i sense; `unlabeled` d'una
  altra etiqueta.
- Agent: creació de PR amb etiqueta; resultat desconegut i reintent sense duplicar;
  fallada en posar l'etiqueta; PR sense etiqueta sense avís de preview; dos
  pushes seguits amb només l'URL del cap final informada; absència de
  comentaris `/preview`; reinici amb una petició pendent antiga.
- Prova real després del merge, en una PR de prova pròpia: posar l'etiqueta,
  fer un push i treure-la. No requereix cap merge ni cap push a `main`.

## Seguretat I Privacitat

- `pull_request_target` dona secrets i permisos d'escriptura al workflow. El
  codi de la PR només s'executa al job `build`, sense secrets, caches ni
  permisos d'escriptura, el mateix risc que `issue_comment` ja accepta. Cap job
  amb secrets fa checkout de la PR.
- L'autorització per PR amplia el nombre de publicacions de contingut no fiable:
  cada push d'una col·laboradora publica. La població que pot fer push a una
  branca pròpia és la mateixa que pot comentar `/preview`.
- La comprovació de l'actor és més estricta que la de `/preview` (col·laboradora
  sense nivell): exigeix `write` o `admin`.
- El component de GitHub de l'agent rep una sola operació nova i acotada. No
  exposa cap altra operació d'etiquetes.
- Treure l'etiqueta és una via de retirada ràpida, a més de `preview-revoked`.

## Fora D'Abast

- Retirar `/preview`: entrada pròpia del [backlog](../backlog.md#retirar-la-petició-de-preview-amb-preview).
- Publicar en reobrir una PR, publicar PR de forks o canviar el build no fiable.
- Que la reconciliació periòdica retiri previews de PR sense etiqueta.
- Canviar el token del servei, l'entorn `previews` o les proteccions de `main`.

## Criteris D'Acceptació

1. Les esmenes dels ADR 0009 i 0013 estan fusionades abans de la implementació.
2. Posar `preview` a una PR pròpia publica el cap actual, i un push posterior
   publica el cap nou, amb l'actor revalidat amb `write` o `admin`.
3. Un push a una PR sense etiqueta, una etiqueta diferent, un actor sense
   escriptura, `preview-revoked` o un fork no publiquen.
4. Treure `preview` retira la preview, i una publicació de l'etiqueta pendent
   no s'activa.
5. `/preview` i `workflow_dispatch` continuen funcionant sense canvis.
6. L'agent crea la PR del tema amb l'etiqueta, no comenta `/preview` i informa
   només l'URL que el publicador confirma per al cap actual.
7. Els punts pendents de [Verificacions a GitHub](#verificacions-a-github)
   s'han comprovat amb GitHub real abans d'activar-ho a l'agent.
