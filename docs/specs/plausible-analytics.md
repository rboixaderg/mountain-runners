# Especificació: Analítica Plausible

## Estat

En curs.

## Objectiu

Disposar de mètriques mínimes i accionables de la web pública —visites de pàgina
i referències agregades— mitjançant Plausible Community Edition autoallotjat a
`analytics.rogerbg.cat`, sense analítica publicitària, sense cookies pròpies no
tècniques i sense que una fallada del servei trenqui la navegació.

## Límits I Decisions Confirmades

- Es reutilitza la instància Plausible existent; no es desplega
  `analytics.mountainrunners.cat` ni una pila nova al VPS de la web.
- L'origen de confiança de l'script i de les peticions és
  `https://analytics.rogerbg.cat` ([ADR 0007](../decisions/0007-self-hosted-plausible-analytics.md)).
- L'snippet públic és el que genera aquella instància per al lloc
  `mountainrunners.cat`; el fitxer amb nom versionat no és un secret.
- No hi ha banner de consentiment: Plausible es configura sense cookies, sense
  identificadors persistents i sense seguiment individual ni entre llocs
  (LSSI 22.2 / guia AEPD de mesura d'audiència, gener 2024). La transparència
  del RGPD s'aplica actualitzant privacitat i cookies.
- La cua i `plausible.init()` s'emeten des de `/js/plausible-init.js` (origen
  propi) per no introduir `unsafe-inline` a `script-src`.
- El `Caddyfile` del repositori és la font de la CSP; aplicar-la al VPS és una
  acció supervisada de la persona mantenidora, no del desplegament de l'artefacte.
- Aquesta entrega no forma part de la fase 5; n'amplia la CSP original de la
  T5.1 amb l'origen explícit.

## Resultats Esperats

- Totes les pàgines públiques que usen `PublicLayout` carreguen l'script de
  Plausible de manera asíncrona i inicialitzen la cua sense bloquejar el render.
- La CSP de Caddy permet l'script i `connect-src` cap a
  `https://analytics.rogerbg.cat`, sense comodins ni `unsafe-eval`.
- Les pàgines de privacitat i de cookies descriuen l'analítica real, en els tres
  idiomes, i continuen sense banner general.
- Bloquejar o aturar Plausible no impedeix carregar ni navegar la web.
- El build no incorpora tokens d'administració ni de l'API de Plausible.

## Dependències I Ordre D'Inici

La web pública, l'apex a producció i el lloc `mountainrunners.cat` a la
instància Plausible ja existeixen. La CSP nova s'ha d'aplicar al VPS quan es
fusioni l'entrega; si l'artefacte es publica abans, l'script queda bloquejat per
la CSP anterior i les pàgines continuen funcionant.

## Tasques, Entregues I Seguiment

| Tasca | Estat   | Resultat                                                                                         | Enllaç |
| ----- | ------- | ------------------------------------------------------------------------------------------------ | ------ |
| T1    | En curs | Script al layout, CSP, textos legals, ADR 0007 i comprovacions que l'analítica no trenqui la web |        |

### T1. Integrar Plausible A La Web Pública

**Abast:** constants de l'origen i de l'script, component al `PublicLayout`,
inicialització a l'origen propi, esmena de la CSP de Caddy i del verifier,
textos de cookies i privacitat, ADR 0007 i documentació operativa mínima.

**Fora d'aquesta tasca:** esdeveniments personalitzats, tauler públic, instància
pròpia, listmonk, canvis DNS i qualsevol acció remota al VPS.

**Dependències:** snippet generat per la instància Plausible per a
`mountainrunners.cat`.

**Resultat observable:** l'HTML públic inclou l'script asíncron i la cua; la CSP
del repositori permet origen i connexions; les pàgines legals descriuen el
servei.

**Comprovacions mínimes:** `pnpm check` i el recorregut E2E del shell que cobreix
layout, cookies i privacitat.

**PR:** `feat(analytics-t1): add self-hosted Plausible pageviews`. Una sola PR
perquè és una funcionalitat d'una tasca.

## Integració A La Web

- L'script remot és `https://analytics.rogerbg.cat/js/pa-gRKxE0JnFqvhkV5c5BUwD.js`,
  carregat amb `async`.
- La cua oficial (`window.plausible` i `plausible.init()`) s'executa des de
  `/js/plausible-init.js`, servit per `'self'`.
- No s'afegeixen esdeveniments més enllà de la visita de pàgina que envia
  Plausible per defecte.
- El host de validació i l'entorn local poden carregar l'script; el filtre de
  nom d'amfitrió de Plausible descarta visites que no siguin de
  `mountainrunners.cat`.

## Operació De La CSP

La directiva vigent, sense comodins ni `unsafe-eval`, és:

```text
default-src 'self';
script-src 'self' https://analytics.rogerbg.cat;
connect-src 'self' https://analytics.rogerbg.cat;
style-src 'self' 'unsafe-inline';
img-src 'self';
font-src 'self';
frame-src https://www.youtube-nocookie.com;
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
object-src 'none';
```

`connect-src` és necessari perquè, un cop es declara, ja no hereta
`default-src`: sense aquest origen les peticions d'esdeveniment quedarien
bloquejades. Actualitzar `/etc/caddy/Caddyfile` al VPS és un canvi quirúrgic de
la línia de CSP a `(common_headers)`, sense reexecutar el bootstrap (que
tornaria a comentar l'import de producció). El procediment és al runbook.

## Textos Legals

Les pàgines de cookies i de privacitat, en ca/es/en, han de descriure:

- analítica agregada autoallotjada amb Plausible, sense cookies pròpies no
  tècniques i sense publicitat;
- absència de banner general, i el paper continuat de YouTube;
- interès legítim, retenció màxima de 25 mesos de les mètriques i l'host
  `analytics.rogerbg.cat` com a encarregat d'aquest tractament.

## Estratègia De Tests I Qualitat

- Vitest: el layout emet l'script asíncron amb l'URL canònica i no introdueix
  l'snippet com a `script` inline executable.
- `node --test`: el `Caddyfile` i el verifier comparteixen la CSP esperada.
- Playwright: el shell públic carrega l'script; cookies i privacitat esmenten
  Plausible. No es comprova que l'host remot respongui.
- No s'executa Lighthouse per aquesta entrega: l'script és asíncron i no canvia
  el disseny; una regressió de pressupost es tractaria a part.

## Seguretat I Privacitat

- Frontera de confiança: l'operador de `analytics.rogerbg.cat` pot executar
  JavaScript a l'origen de la web.
- Sense tokens d'API, comptes ni secrets al repositori ni a l'HTML.
- Sense `unsafe-eval`, sense comodins a la CSP i sense `unsafe-inline` a
  `script-src`.
- Una fallada de Plausible no pot ser un punt únic de fallada de la web.
- No s'amplia el consentiment de cookies; si l'analítica passés a identificar
  persones o a instal·lar cookies, caldria una entrega nova.

## Fora D'Abast

- Esdeveniments personalitzats, objectius o embuts.
- Instància Plausible pròpia, DNS `analytics.mountainrunners.cat`, listmonk i
  newsletter.
- Tauler públic de mètriques, contracte d'encarregat formal i auditoria del VPS
  de Plausible (operació fora del repositori).
- Canviar Caddy al VPS des d'una sessió d'agent.

## Criteris D'Acceptació

1. Cada pàgina amb `PublicLayout` inclou l'script asíncron de Plausible i la
   inicialització a l'origen propi.
2. La CSP del repositori permet només l'origen `https://analytics.rogerbg.cat` a
   `script-src` i `connect-src`, sense `unsafe-eval`.
3. Privacitat i cookies, en els tres idiomes, descriuen l'analítica real i
   mantenen que no hi ha banner general.
4. Les comprovacions mínimes de la T1 passen.
5. El runbook explica com aplicar la CSP al VPS sense reexecutar el bootstrap.
6. Bloquejar l'origen de Plausible no impedeix renderitzar ni navegar.
