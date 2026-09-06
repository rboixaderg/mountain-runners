# Especificació: observabilitat de peticions

## Estat

Planificada. La decisió arquitectònica està acceptada a l'[ADR
0008](../decisions/0008-request-observability.md), però la recollida nova no
s'activa fins que aquesta entrega estigui implementada, revisada i fusionada.

## Objectiu

Comptar totes les peticions HTTP que arriben a l'origen de Mountain Runners,
incloses les de crawlers autodeclarats i els clients sense JavaScript, sense
conservar el `User-Agent` complet ni ampliar Plausible amb trànsit automatitzat.

## Límits i decisions confirmades

- Caddy és l'única font de peticions rebudes per l'origen. Una petició servida
  des de la memòria cau del navegador o aturada abans d'arribar al VPS queda fora
  de la mètrica.
- Plausible conserva l'abast de l'[ADR
  0007](../decisions/0007-self-hosted-plausible-analytics.md) i no rep
  esdeveniments sintètics de crawlers.
- El `User-Agent` només es llegeix durant la petició per produir una categoria
  tancada. El valor original no s'escriu a cap registre ni resum.
- `browser-like` no significa humà. Qualsevol categoria de crawler indica una
  identificació declarada pel client i es pot falsificar.
- Els registres individuals conserven els camps, permisos i set dies de retenció
  aprovats a la T5.1, amb l'únic camp nou `actor_family`.
- Els resums no contenen IP, ports, identificadors, query strings, referents,
  capçaleres ni paths desconeguts literals. Cap fila dimensional representa
  menys de cinc peticions; els recomptes escassos només incrementen un total
  acumulat sense dimensions. Es conserven sense termini màxim.
- No s'adopten Grafana, Loki, GoAccess, Cloudflare ni cap servei extern. La
  primera consulta és una ordre local restringida a les persones administradores.

## Resultats esperats

- Cada entrada del registre d'accés incorpora una família de client derivada
  sense exposar el `User-Agent` original.
- Els registres continuen cobrint pàgines, recursos, redireccions, 404 i altres
  respostes que arriben a Caddy.
- Un procés idempotent resumeix només fitxers diaris complets, recupera qualsevol
  dia pendent abans que caduqui el registre i no duplica un dia quan es torna a
  executar.
- Les persones administradores poden consultar peticions per data, ruta o classe
  de ruta, classe d'estat i família de client.
- La configuració i les proves demostren que cap query string, referent,
  `User-Agent`, cookie, autorització o IP entra als resums.
- El runbook i els textos públics descriuen el tractament que s'activa, la
  retenció de set dies dels registres individuals i la conservació indefinida de
  mètriques agregades sense identificadors.

## Dependències i ordre d'inici

La implementació parteix del Caddy i la rotació diària existents. Abans d'aplicar
la configuració al VPS han d'estar fusionats el classificador, l'agregador, la
programació local, les proves, el runbook i els textos de privacitat en català,
castellà i anglès. Cap sessió local aplica canvis remots; la persona mantenidora
és responsable de l'activació supervisada posterior al merge.

## Tasques, entregues i seguiment

| Tasca | Estat   | Resultat                                                                        | PR  |
| ----- | ------- | ------------------------------------------------------------------------------- | --- |
| T1    | Pendent | Classificació transitòria, resum local, documentació pública i proves completes | -   |

### T1. Classificar i resumir les peticions rebudes

**Abast:** afegir la classificació transitòria a Caddy, conservar només
`actor_family`, implementar el resum idempotent dels fitxers diaris complets i
la seva execució programada, definir la consulta administrativa, actualitzar el
runbook i els textos de privacitat en els tres idiomes i cobrir el contracte amb
proves.

**Fora d'aquesta tasca:** tauler web, servei extern, estimació de persones
úniques, verificació per IP o DNS, fingerprinting, canvis a Plausible, accés del
xat públic o de l'assistent editorial i qualsevol acció remota al VPS.

**Dependències:** Caddy de producció i rotació diària operatius; ADR 0008
acceptada.

**Resultat observable:** una petició rebuda apareix al registre individual durant
set dies amb una categoria derivada i contribueix una sola vegada a un recompte
persistent, dimensional o acumulat sense dimensions.

**Comprovacions mínimes:** format, `git diff --check`, proves del Caddyfile,
proves unitàries del classificador i l'agregador amb fixtures sensibles, i prova
manual sobre un log sintètic que inclogui navegador, crawler conegut, agent
desconegut, query string i capçaleres que no poden persistir.

**PR:** `feat(request-observability-t1): classify origin requests`. Una PR pròpia
perquè configuració, agregació, transparència i programació formen un únic canvi
de tractament i no s'han de desplegar parcialment.

## Classificació de clients

El camp `actor_family` utilitza aquest conjunt tancat:

- `openai`
- `anthropic`
- `perplexity`
- `google-ai`
- `search-crawler`
- `other-bot`
- `browser-like`
- `unknown`

Les coincidències específiques precedeixen les genèriques. Els patrons viuen en
codi versionat, amb fixtures que documenten exemples acceptats. No es consulta
cap servei de tercers ni es fa verificació inversa d'IP. Afegir una família nova
requereix una prova i no modifica registres històrics.

## Registre individual i resum agregat

El registre individual conserva el contracte vigent: timestamp, IP, mètode,
path sense query string, estat, bytes, durada i `actor_family`. Caddy elimina la
resta de camps abans d'escriure. La rotació continua sent diària i la retenció,
de set dies.

El resum processa només un fitxer diari tancat. Cada fila conté:

- data;
- ruta canònica publicada o classe `asset`, `technical` o `unknown-path`;
- classe d'estat HTTP;
- `actor_family`;
- nombre de peticions.

Els paths publicats es poden conservar perquè són rutes públiques conegudes. Els
paths que no pertanyen al contracte públic s'agrupen com `unknown-path` i no es
copien literalment. Una combinació dimensional amb menys de cinc peticions es
fusiona en un únic total acumulat `other` que omet data, ruta, classe d'estat i
família. D'aquesta manera totes les peticions contribueixen al total sense
conservar una fila dimensional escassa. L'agregador escriu de manera atòmica i
registra quins dies ja ha consolidat sense copiar camps del registre d'accés.

## Consulta i operació

La consulta inicial és una ordre local que llegeix els resums i permet filtrar
per interval de dates, ruta o classe, classe d'estat i família. No mostra ni
necessita el registre individual. Els fitxers agregats resten al VPS amb accés
restringit a les persones administradores i no se serveixen des de Caddy.

El runbook documenta generació, reexecució, comprovació, còpia de seguretat,
restauració i eliminació completa. També diferencia una pujada de peticions, una
família autodeclarada i una visita de Plausible per evitar conclusions que les
dades no permeten.

Un timer local s'executa després de la rotació i revisa tots els fitxers diaris
encara disponibles, no només el dia anterior. Una fallada no marca el dia com a
consolidat i la següent execució el torna a processar. El runbook defineix la
comprovació administrativa que detecta un dia pendent abans que caduqui el
registre de set dies.

## Estratègia de tests i qualitat

- Les proves del Caddyfile verifiquen el conjunt tancat de categories, l'ordre de
  coincidència i que el filtre continua eliminant totes les capçaleres i la URI
  amb query string.
- Les proves de l'agregador cobreixen un dia complet, reexecució idempotent,
  entrada malformada, categories desconegudes, paths públics, assets i paths no
  reconeguts.
- Les proves cobreixen els límits de quatre i cinc peticions, la fusió sense
  dimensions i la conservació del recompte total.
- Les proves de programació cobreixen una fallada, el reintent posterior,
  l'escaneig de tots els fitxers rotats disponibles i la detecció d'un dia
  pendent abans que caduqui.
- Fixtures amb query, referent, cookie, autorització i `User-Agent` comproven que
  aquests valors no apareixen a la sortida.
- `pnpm test:server`, `pnpm format:check` i `git diff --check` són obligatoris.
- La validació manual usa dades sintètiques. No es copien logs reals al
  repositori, a una PR ni a un agent.

## Seguretat i privacitat

- El `User-Agent`, la IP i qualsevol altre camp del registre individual es
  tracten com a entrada no fiable.
- No es registren cossos, queries, fragments, referents, cookies, autorització ni
  altres capçaleres.
- Els resums no contenen registres de petició ni identificadors i no es combinen
  amb Plausible ni amb cap altra font.
- L'accés continua limitat a l'administració del VPS. El xat públic i
  l'assistent editorial no poden consultar registres ni resums.
- La política de privacitat no necessita enumerar patrons o famílies concretes,
  però abans de l'activació ha d'explicar la lectura transitòria d'informació del
  client, la finalitat de comptar trànsit automatitzat, el descart del
  `User-Agent` complet, la base d'interès legítim aplicable i la conservació
  indefinida del resultat agregat sense identificadors.
- Les còpies de seguretat no poden convertir els registres individuals de set
  dies en una retenció més llarga. Els resums agregats sense identificadors sí
  que poden formar part de les còpies de seguretat sense caducitat.

## Fora d'abast

- Determinar amb certesa si una petició l'ha fet una persona o un agent.
- Comptar peticions que no arriben al VPS.
- Guardar el `User-Agent` complet, el referent o la query string.
- Perfils de visitant, sessions, identificadors persistents o fingerprinting.
- Tauler públic o privat via web, alertes i monitoratge en temps real.
- Proveïdors, dependències o bases de dades noves.

## Criteris d'acceptació

1. Tota petició que arriba a Caddy conserva el contracte actual de registre i
   incorpora exactament una categoria `actor_family` del conjunt tancat.
2. Ni el registre ni els resums contenen el `User-Agent` complet, queries,
   referents, cookies, autorització o altres capçaleres.
3. El registre individual continua caducant al cap de set dies.
4. Cada fitxer diari complet contribueix una sola vegada als resums, fins i tot
   si el procés es reexecuta.
5. Els resums no contenen IP ni paths desconeguts literals i es conserven sense
   termini màxim; cap fila dimensional conté menys de cinc peticions i els
   recomptes escassos només incrementen el total acumulat sense dimensions.
6. La consulta administrativa respon per data, ruta o classe, classe d'estat i
   família sense llegir registres individuals.
7. Runbook i privacitat en ca/es/en descriuen el comportament activat abans del
   canvi remot al VPS.
8. Les comprovacions mínimes passen amb dades exclusivament sintètiques.
9. La persona mantenidora pot activar el canvi després del merge i comprovar que
   cap fitxer diari pendent caduca sense consolidar-se.
