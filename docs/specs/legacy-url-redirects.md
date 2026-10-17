# Redireccions D'URLs De Llegat

## Estat

En curs.

## Objectiu

Recuperar el trànsit que arriba a adreces del web anterior del club i a
peticions de spam o sondes tècniques que avui responen 404. Les adreces
d'identificades es redirigeixen amb una resposta HTTP permanent i explícita cap
a la pàgina actual equivalent o, quan no n'hi ha cap, cap a la pàgina d'inici
catalana.

## Límits I Decisions Confirmades

- L'anàlisi surt de la Stats API de Plausible per al lloc
  `mountainrunners.cat`, amb el període retornat `2026-08-19` →
  `2026-10-16` (tot l'històric disponible).
- Les redireccions viuen al fragment de servidor
  `tools/server/caddy/Caddyfile.redirects`, importat per
  `tools/server/caddy/Caddyfile`. L'artefacte Astro és estàtic i no pot
  respondre 301; no s'introdueixen redireccions dins del build.
- El codi HTTP és 301, coherent amb la redirecció d'arrel existent.
- Es redirigeixen a `/ca/` tant les adreces del club anterior com el contingut
  de spam injectat (`/2024/*`, `/2025/*`, `/category/*`), els endpoints tècnics
  de WordPress (`/wp-json/*`, `/wp-login.php`, `/administrator`, `/webmail`), les
  sondes de correu (`/.well-known/*`) i les URLs trencades (`/tel:*`).
- Els matchers són prefixos tancats; cap ruta no inclosa es converteix en
  catch-all i continua responent 404. L'únic hostname exclòs és
  `new.mountainrunners.cat`, que no serveix aquesta configuració.
- Les rutes actuals que arriben sense prefix d'idioma reben el prefix que
  correspon al segment localitzat (ca, es o en). Els segments compartits per
  més d'un idioma (`blog`, `cookies`, `documents`) es queden al català.
- La destinació és la pàgina actual equivalent quan existeix; si no, `/ca/`.
- La redirecció descarta la query string i no encadena noves redireccions.

## Resultats Esperats

- Una llista d'adreces antigues contrastada amb Plausible, agrupada per
  destinació i amb el volum de visites de pàgina.
- Regles de Caddy explícites als fragments `(legacy_redirects)` i
  `(locale_redirects)`, invocats per `(common_site)` i resolts abans que
  `file_server` serveixi fitxers.
- Les rutes no incloses continuen responent 404.
- Verificació estàtica del Caddyfile i verificació del contracte HTTP del host.

## Dependències I Ordre D'Inici

- Accés de lectura a Plausible: disponible.
- Caddy 2.11.4 desplegat a la fase 5. El desplegament de l'artefacte no
  actualitza Caddy: una persona mantenidora aplica el canvi al VPS seguint el
  [`runbook`](../runbook.md), com amb la resta de canvis de Caddyfile.
- No hi ha cap canvi de contingut ni de rutes del build.

## Tasques, Entregues I Seguiment

| Tasca | Estat   | PR  |
| ----- | ------- | --- |
| T1    | En curs | —   |

### T1: Redireccions De Llegat I Verificació

**Abast:** afegir el mapa de redireccions al Caddyfile, provar-lo i documentar
l'aplicació al VPS.

**Exclusió immediata:** no migra contingut antic i no automatitza l'aplicació
de la configuració de Caddy.

**Dependències:** cap de tècnica; l'aplicació al VPS requereix una persona
mantenidora.

**Resultat observable:** les adreces del mapa responen 301 a la destinació
indicada i una ruta desconeguda continua responent 404.

**Comprovacions mínimes:** `pnpm test:server` i el `caddyfile.test.mjs`
actualitzat; després d'aplicar el canvi, `verify-site` contra el host.

## Mapa De Redireccions

Volums de `pageviews` del període analitzat. Cada regla cobreix les variants
amb i sense barra final.

| Adreces antigues                                                                                                                              | Destinació                         | pageviews |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------- |
| `/index.php` i `/index.php/*`                                                                                                                 | `/ca/`                             | 138       |
| `/el-club`, `/el-club/`                                                                                                                       | `/ca/qui-som/`                     | 11        |
| `/socis`, `/socis/`, `/llicencia-federativa`, `/llicencia-federativa/`, `/avantatge-per-a-socis-i-socies`, `/avantatge-per-a-socis-i-socies/` | `/ca/socis/`                       | 3         |
| `/escoles`, `/escoles/`                                                                                                                       | `/ca/escoles/`                     | 2         |
| `/escola-btt`, `/escola-btt/`                                                                                                                 | `/ca/escoles/escola-btt/`          | 15        |
| `/escola-trail`, `/escola-trail/`                                                                                                             | `/ca/escoles/escola-trail/`        | 5         |
| `/escola-skimo`, `/escola-skimo/`                                                                                                             | `/ca/escoles/escola-skimo/`        | 1         |
| `/esdeveniments`, `/esdeveniments/`, `/esdeveniments/mes/*`                                                                                   | `/ca/esdeveniments/`               | 5         |
| `/berga-trail`, `/berga-trail/`                                                                                                               | `/ca/esdeveniments/berga-trail/`   | 2         |
| `/ultra-pirineu`, `/ultra-pirineu/`                                                                                                           | `/ca/esdeveniments/ultra-pirineu/` | 1         |
| `/blog`, `/blog/`                                                                                                                             | `/ca/blog/`                        | 1         |
| `/images/*`                                                                                                                                   | `/ca/documents/`                   | 5         |
| `/contact`, `/contact/`, `/contacteu`, `/contacteu/`, `/pagina-exemple`, `/pagina-exemple/`                                                   | `/ca/`                             | 13        |
| `/2024/*`, `/2025/*`, `/category/*` (spam injectat)                                                                                           | `/ca/`                             | 43        |
| `/wp-json/*`, `/wp-login.php`, `/administrator`, `/webmail`                                                                                   | `/ca/`                             | 101       |
| `/.well-known/*`, `/tel:*`                                                                                                                    | `/ca/`                             | 6         |

El mapa cobreix 352 visites de pàgina del període. S'inclouen totes dues
variants (amb i sense barra final) encara que les dades només en mostrin una,
perquè la redirecció no depengui de la forma exacta de la petició.

Queda fora del mapa el hostname `new.mountainrunners.cat` (18 visites), que no
serveix aquesta configuració, i qualsevol ruta no inclosa en cap prefix, que
continua responent 404.

### Rutes Actuals Sense Prefix

A més del mapa de llegat, `(locale_redirects)` afegeix el prefix d'idioma a les
rutes actuals que arriben sense prefix. El prefix s'infereix del segment
localitzat i la resta del path es conserva:

| Idioma | Segments sense prefix                                                                                                   | Prefix afegit |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| ca     | `qui-som`, `noticies`, `documents`, `avis-legal`, `privacitat`, `cookies` (i el seu subarbre)                           | `/ca`         |
| es     | `quienes-somos`, `escuelas`, `eventos`, `noticias`, `socios`, `documentos`, `aviso-legal`, `privacidad` (i el subarbre) | `/es`         |
| en     | `about`, `schools`, `events`, `news`, `members`, `legal-notice`, `privacy` (i el subarbre)                              | `/en`         |

Els segments compartits per més d'un idioma (`blog`, `cookies`, `documents`) es
resolen al català. Les regles de llegat de `/escoles`, `/esdeveniments`, `/blog`
i `/socis` ja cobreixen el cas català.

## Comportament

- Els fragments `(legacy_redirects)` i `(locale_redirects)` viuen a
  `tools/server/caddy/Caddyfile.redirects`, que el bootstrap instal·la al costat
  de `/etc/caddy/Caddyfile`. El Caddyfile l'importa i `(common_site)` els invoca
  després de la redirecció d'arrel i abans de `file_server`.
- Els matchers són conjunts tancats de paths (`path ...`), amb wildcards per
  als arxius mensuals (`/esdeveniments/mes/*`) i per als prefixos de spam,
  sondes i rutes sense prefix. Cap regla equival a `/`; la ruta no llistada
  continua responent 404.
- Les destinacions són paths interns absoluts; no s'accepta cap valor de la
  petició com a destinació.

## Estratègia De Tests I Qualitat

- `tools/server/caddy/caddyfile.test.mjs`: les regles existeixen, s'importen
  abans de `file_server`, cobreixen el spam, les sondes i el prefix d'idioma, i
  no hi ha cap `redir` catch-all.
- `tools/server/verify/site-contract.test.mjs` i `verify-site.mjs`: amb el flag
  `--expect-legacy-redirects`, una mostra representativa de rutes de llegat, de
  spam, de sondes i de rutes sense prefix respon 301 a la destinació esperada.
- Manual, després d'aplicar el Caddyfile: validar, reiniciar Caddy i executar
  `verify-site` amb `--expect-legacy-redirects` contra el host.

## Seguretat I Privacitat

- No hi ha open redirect: les destinacions són constants del Caddyfile.
- No hi ha secrets ni dades personals; Plausible només forneix agregats.
- Es descarta la query string de la petició original.

## Fora D'Abast

- Migrar el contingut de les adreces antigues.
- Redirigir `new.mountainrunners.cat` o qualsevol altre hostname.
- Convertir la resta de rutes desconegudes en una redirecció catch-all.
- Automatitzar l'aplicació de la configuració de Caddy des de l'artefacte.

## Criteris D'Acceptació

- Cada adreça del mapa respon 301 a la destinació indicada; el spam, les
  sondes tècniques i les rutes sense prefix d'idioma hi són incloses.
- Una ruta desconeguda fora de tots els prefixos continua responent 404.
- `pnpm test:server` passa amb les proves noves.
- El runbook descriu com aplicar el canvi, i la verificació del host queda
  enllestida per executar-se després.
