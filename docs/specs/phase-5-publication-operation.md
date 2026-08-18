# Especificació De La Fase 5: Publicació A Producció I Operació

## Estat

T5.1 completada el 16 d'agost de 2026, amb les decisions registrades a
[`docs/phase-5-t51-decisions.md`](../phase-5-t51-decisions.md). La fase 4 es va
completar el 16 d'agost de 2026 i ja no bloqueja la publicació. No es provisiona
ni s'activa producció fins a completar les decisions i controls de T5.1.

## Objectiu

Publicar l'aplicació Astro validada a `https://mountainrunners.cat` mitjançant un
flux segur, reproduïble i reversible que parteixi de cada commit fusionat a
`main`, servir-la amb Caddy des del VPS de Hetzner i deixar documentada l'operació
mínima de llançament, salut, logs, incidències i reversió.

La fase converteix el build estàtic actual en un artefacte de CI desplegable i
estableix el desplegament continu de producció. No implementa previews de pull
request, Cloudflare, funcionalitat editorial, xat, autenticació ni serveis de
negoci.

## Límits I Decisions Confirmades

- Producció només rep un artefacte net creat per CI des del commit exacte
  fusionat a la branca `main` protegida. No es desplega cap `dist/` local ni es
  reconstrueix al servidor.
- La web continua sent Astro estàtic darrere de Caddy, d'acord amb l'ADR 0001.
  El destí previst és un VPS de Hetzner administrat pel projecte.
- Hostinger continua sent la interfície de gestió del domini i el DNS autoritatiu
  durant aquesta fase, mentre Openprovider consta com a registrador al registre
  de `.cat`. El tall modifica només els registres web imprescindibles i preserva
  els registres de correu i altres serveis que no es migren.
- La primera activació pública i el tall DNS són supervisats i requereixen
  aprovació explícita de la persona mantenidora. Després d'acceptar aquesta
  primera release, cada merge posterior a `main` pot desplegar-se automàticament
  si passen tots els gates del workflow protegit.
- La reversió de producció continua sent una acció protegida i aprovada. No es
  manté l'allotjament anterior com a servei de reversió: la reversió rutinària
  activa una release anterior elegible a Hetzner sense tocar DNS i, si no queda
  cap release elegible, s'aplica la resposta d'emergència del runbook. Els
  registres web anteriors queden exportats i restaurables manualment com a via
  extraordinària, però no és la via prevista (decisió de T5.1).
- Cap agent, sessió local ni assistent editorial pot desplegar, fusionar,
  habilitar auto-merge o obtenir accés persistent a producció.
- Els secrets viuen exclusivament a l'entorn de producció o al magatzem de
  secrets aprovat; no entren al repositori, als artefactes ni als logs.
- El desplegament és atòmic i reversible a un artefacte anterior elegible sense
  fer un build nou.
- Els previews de PR i la possible adopció de Cloudflare pertanyen a la fase 6 i
  no són dependències del llançament ni del desplegament de producció.
- El proveïdor i accés del VPS, l'entorn de producció, els camps i retenció de
  logs, els responsables i el canal privat de vulnerabilitats es confirmen a
  T5.1 abans d'adoptar serveis o escriure automatització.
- El canal privat de vulnerabilitats ha d'estar activat i comprovat a T5.1 abans
  d'activar cap ruta de producció.
- Una decisió que canviï un ADR vigent requereix un ADR nou o substitutiu abans
  de la implementació.

## Resultats Esperats

- Decisions operatives i de privacitat aprovades, sense credencials al text, i
  canal privat de vulnerabilitats operatiu.
- Artefacte estàtic reproduïble, amb manifest de commit, origen, data editorial
  i digests SHA-256, validat íntegrament a CI.
- Comprovació de totes les rutes, recursos i enllaços interns de la superfície
  pública en català, castellà i anglès.
- VPS de Hetzner amb Caddy, TLS, 404, capçaleres, caché i logs mínims configurats
  i validats.
- Workflow protegit que desplega la release de `main`, executa smoke tests i
  permet revertir sense reconstruir.
- Tall DNS controlat des de Hostinger, sense migrar la zona ni interrompre el
  correu.
- Runbook públic sense dades sensibles per a desplegament, reversió, renovació
  TLS, salut, incidències i responsabilitats.

## Dependències I Ordre D'Inici

La fase 4 està completada. T5.1 en verifica el resultat i requereix una persona
mantenidora disponible per confirmar les decisions operatives. T5.2 comença
després de T5.1. T5.3 depèn del contracte
d'artefacte de T5.2; T5.4 integra l'artefacte i el servidor preparats; T5.5 fa el
primer tall públic i valida el sistema complet.

La fase 6 només comença després que aquesta fase hagi establert una producció
estable i una operació mínima. No pot reobrir ni debilitar el contracte de
producció per facilitar previews.

Cada tasca s'implementa en un worktree i una branca propis des de l'últim
`main`. Les accions que creen o alteren recursos remots, DNS, entorns, secrets o
servidors requereixen aprovació explícita de la persona mantenidora en la
conversa o procediment corresponent.

## Tasques, Entregues I Seguiment

| Unitat                                       | Estat      | Dependències      | Resultat verificable                        | PR     |
| -------------------------------------------- | ---------- | ----------------- | ------------------------------------------- | ------ |
| T5.1 Decisions i porta de llançament         | Completada | Fase 4 completada | Decisions, riscos i responsables confirmats | PR #76 |
| T5.2 Artefacte i controls de publicació      | Completada | T5.1              | Artefacte CI complet i verificat            | PR #77 |
| T5.3 VPS, Caddy, releases i reversió         | Completada | T5.2              | Servidor TLS preparat i reversió comprovada | PR #79 |
| T5.4 Desplegament continu des de `main`      | En curs    | T5.2 i T5.3       | Workflow protegit amb smoke tests           | -      |
| T5.5 Tall, validació i operació de producció | Pendent    | T5.4              | Web pública i runbook verificats            | -      |

### T5.1: Decisions I Porta De Llançament

**Abast:** verificar el tancament de la fase 4; confirmar administració i
capacitat del VPS de Hetzner, propietat del domini i del DNS de Hostinger,
responsables, entorn de producció, política de desplegament automàtic posterior
al primer tall, headers mínims, caché, logs i reversió; activar el canal privat de
vulnerabilitats amb una persona responsable. **Exclusió:** no crea el VPS,
credencials de desplegament, secrets ni recursos de Cloudflare. **Depèn de:** fase
4 tancada. **Resultat:** decisions traçables, riscos sense bloqueig, canal privat
operatiu i ADR quan canviï una frontera. **Comprovació:** prova privada del canal
i revisió humana de seguretat, privacitat i operació. **PR:** pròpia; qualsevol
canvi remot requereix aprovació explícita.

### T5.2: Artefacte I Controls De Publicació

**Abast:** definir un contracte reutilitzable que construeixi amb lockfile
immutable, origen de producció explícit i data editorial registrada; verificar la
llista canònica vigent de rutes, `/`, 404, sitemap, robots, recursos publicats,
absència d'esborranys i enllaços interns; generar un manifest amb commit, origen,
`BUILD_TODAY`, workflow, llista de fitxers i digests SHA-256; empaquetar només
fitxers regulars sota una arrel relativa, amb límits aprovats de mida expandida i
nombre de fitxers. **Exclusió:** no desplega, no implementa l'origen variable dels
previews i no converteix en gate
els enllaços externs canviants. **Depèn de:** T5.1. **Resultat:** artefacte
immutable de producció verificable abans i després de travessar la frontera del
servidor. **Comprovació:** `pnpm validate`, dos builds nets amb les mateixes
entrades i digests idèntics, verificació de sortida i prova negativa contra
contingut despublicat. **PR:** pròpia.

### T5.3: VPS, Caddy, Releases I Reversió

**Abast:** provisionar l'accés i l'estructura mínima del VPS de Hetzner, crear
identitats separades de desplegament i Caddy, servir un artefacte de prova en un
host de validació aprovat amb TLS, 404, headers, caché, logs minimitzats, releases
atòmiques, `X-Robots-Tag: noindex, nofollow, noarchive` i registre de releases
elegibles o revocades; preparar la reversió interna i la reversió DNS inicial cap
a Hostinger. També escriu les seccions de servidor, TLS, logs, salut i reversió
del runbook i actualitza les polítiques
públiques amb el hosting i els logs que s'activaran. **Exclusió:** no aplica el
tall dels registres web de producció, no migra nameservers ni introdueix API,
base de dades, contenidors o observabilitat externa. **Depèn de:** T5.2 i les
decisions de T5.1. **Resultat:** servidor preparat, polítiques vigents i release
de prova activable i reversible sense reconstruir. **Comprovació:** bootstrap
reproduïble, identitat del host, permisos, configuració, TLS, headers, 404,
caché, `X-Robots-Tag`, logs, polítiques, reversió i resposta quan no queda cap
release segura. **PR:** pròpia; cap canvi remot sense aprovació explícita.

### T5.4: Desplegament Continu Des De `main`

**Abast:** desplegar l'artefacte aprovat del commit fusionat a `main` mitjançant
un entorn de producció restringit a aquesta branca; controlar la concurrència,
usar una credencial de mínim privilegi, verificar manifest i digests, activar la
release atòmicament i executar smoke tests. La primera execució queda a l'espera
d'aprovació; T5.5 documenta quan es retira aquest gate perquè els merges
posteriors s'activin automàticament. **Exclusió:** no permet deploy local, des de
forks o des de branques no protegides, no gestiona DNS i no comparteix
credencials amb la futura infraestructura de previews. **Depèn de:** T5.2 i
T5.3. **Resultat:** desplegament auditable i amb fallada segura, més un workflow
protegit de reversió. **Comprovació:** permisos, restricció de branca, digest i
manifest, rebuig d'una execució obsoleta, extracció segura, exclusió mútua,
simulació de fallada, release revocada, smoke tests i reversió. **PR:** pròpia;
escriu les seccions del runbook relatives al workflow.

### T5.5: Tall, Validació I Operació De Producció

**Abast:** verificar que el canal privat, les polítiques públiques i la reversió
són vigents; reduir els TTL quan correspongui, aplicar des de Hostinger només els
canvis web aprovats, preservar i comprovar el correu, activar la primera release,
executar el gate complet sobre producció i consolidar el runbook. Després del
període d'observació aprovat, confirma que el workflow pot activar automàticament
els merges posteriors a `main`. **Exclusió:** no trasllada la zona DNS a
Cloudflare, no activa DNSSEC, no introdueix previews ni analítica i no presenta
l'automatització com una certificació WCAG. **Depèn de:** T5.4. **Resultat:** web
pública, reversió inicial i rutinària verificades, polítiques coherents i
responsabilitats acceptades. **Comprovació:** `pnpm validate`, Lighthouse dins
dels pressupostos aprovats, navegació representativa `ca`/`es`/`en`, revisió
manual d'accessibilitat, TLS, correu, smoke, rollback, salut, logs i runbook.
**PR:** pròpia i darrera de la fase; qualsevol canvi DNS requereix aprovació
explícita.

## Artefacte, Rutes I Enllaços

El contracte construeix en un checkout net amb
`pnpm install --frozen-lockfile`, `PUBLIC_SITE_ORIGIN=https://mountainrunners.cat`
i un `BUILD_TODAY` explícit, coherent amb la data de Madrid. El directori
`apps/web/dist/` només existeix com a resultat generat i no es desplega des del
worktree.

El manifest vincula commit, origen, `BUILD_TODAY`, workflow i llista de fitxers
amb els seus SHA-256. La reproduïbilitat significa que dos builds nets amb el
mateix commit, lockfile, origen, data i versions d'eina produeixen la mateixa
llista de fitxers i els mateixos digests. El job de desplegament verifica el
manifest abans d'extreure o activar res.

L'extracció es fa en un directori de release nou i rebutja paths absoluts, `..`,
symlinks, hardlinks, dispositius, tipus inesperats, fitxers duplicats i qualsevol
arxiu que superi els límits aprovats de mida expandida o nombre de fitxers. Una
fallada elimina la release incompleta i no altera el punter actiu.

La comprovació de sortida deriva del contracte canònic vigent de l'aplicació i
no duplica manualment un recompte que pugui quedar obsolet. Els enllaços interns
i fitxers locals són bloquejants. Els enllaços externs es validen estructuralment
a CI i es revisen remotament al gate de llançament amb timeout i reintent.

## Desplegament Continu I Entorn De Producció

El workflow s'activa sobre el commit resultant de cada canvi fusionat a `main`,
construeix i valida una sola vegada i transfereix el mateix artefacte a l'entorn
de producció. El job de build no rep credencials de producció; només el job mínim
de desplegament pot accedir al secret restringit.

L'entorn de producció limita les branques autoritzades a `main`. La primera
activació requereix aprovació humana. Quan T5.5 registra que el tall, els smoke
tests i les dues vies de reversió són vàlids, els desplegaments rutinaris poden
activar-se sense una segona aprovació després del merge. El workflow de reversió
continua protegit i no reconstrueix l'artefacte.

El deploy i el rollback comparteixen exclusió mútua local i remota, amb
`cancel-in-progress: false`, per impedir dues activacions parcials. Una fallada
abans de canviar la release activa no altera producció; una fallada posterior
executa o habilita la reversió documentada i registra l'estat.

Immediatament abans d'activar, el workflow comprova que el candidat continua
sent el commit desitjat més recent de la branca protegida. Una execució retardada
d'un commit anterior es rebutja i no es pot convertir implícitament en una
reversió. Només el workflow protegit de rollback pot activar una release anterior.

## Caddy, TLS, Logs I Reversió

Caddy serveix només el directori de la release activa amb una identitat separada
i accés de només lectura. La identitat de desplegament no és `root`, no pot
escriure la configuració de Caddy, les claus TLS ni l'estat ACME, i queda
restringida a carregar releases, verificar digests i activar-les atòmicament. La
identitat SSH del servidor es fixa i es verifica.

La configuració preserva les rutes amb barra final, retorna la 404 global, evita
llistats de directoris i redirigeix HTTP a HTTPS. Com a mínim defineix
`X-Content-Type-Options: nosniff`, una `Referrer-Policy` restrictiva i una
`Permissions-Policy` que desactiva capacitats no utilitzades. T5.1 aprova una
CSP sense comodins ni `unsafe-eval`; si es mantenen els vídeos, `frame-src` es
limita als orígens aprovats. HSTS només s'activa després de validar TLS i tots els
subdominis afectats.

Els assets amb nom versionat tenen caché immutable llarg. HTML, sitemap i robots
es revaliden i no mantenen contingut obsolet després d'una activació. Els
recursos editorials sense hash tenen la política curta acordada a T5.1.

Els logs recullen només els camps aprovats a T5.1, tenen accés restringit,
retenció definida i cap credencial o query sensible. El registre de releases
permet revocar un artefacte per vulnerabilitat, retirada de consentiment,
contingut incorrecte o incidència legal. La reversió verifica digest i
elegibilitat i rebutja releases revocades.

Si no queda cap release elegible —inclosa la primera etapa després de retirar la
reversió DNS cap a Hostinger—, el runbook defineix una resposta d'emergència que
no reconstrueix, no edita fitxers manualment al servidor i no reactiva un
artefacte revocat.

## DNS I Primer Tall

Hostinger conserva la delegació DNS durant tota la fase. Abans del tall
s'inventarien i exporten els registres i TTL vigents. Només es modifiquen els
registres de l'apex i `www` necessaris per servir la web des de Hetzner. No es
publica un registre `AAAA` fins que IPv6, el tallafoc, Caddy i els smoke tests
funcionin també per IPv6.

Els registres MX, SPF, DKIM, DMARC, `mail`, `autodiscover`, `autoconfig` i
qualsevol altre servei existent es preserven i es verifiquen abans i després del
tall. També es confirma una URL de webmail independent de l'apex abans de moure
la web. El canvi de nameservers, Cloudflare i DNSSEC queden fora d'abast.

L'inventari i els valors anteriors dels registres s'exporten i es conserven
abans del tall, però no es manté l'allotjament anterior com a servei de
reversió (decisió de T5.1). La reversió rutinària canvia el punter atòmic a una
release anterior elegible a Hetzner sense tocar DNS; si no queda cap release
elegible, s'aplica la resposta d'emergència del runbook. La restauració manual
dels registres web anteriors queda només com a via extraordinària, amb aprovació
explícita.

## Estratègia De Tests I Qualitat

- Mantenir `pnpm check`, `pnpm test:e2e` i `pnpm validate` com a gates de codi.
- Executar les comprovacions de build i sortida en un entorn net i sobre
  l'artefacte exacte que es desplega.
- Comparar dos builds nets amb entrades idèntiques i verificar manifest i
  digests abans de transferir, activar o revertir.
- Cobrir selector, canonical, `hreflang`, navegació, hubs, detalls, pàgines fixes
  i 404 en una mostra representativa de `ca`, `es` i `en`.
- Comprovar enllaços interns, recursos i exclusions de contingut en totes les
  variants publicades.
- Mantenir Lighthouse com a gate manual reproduïble fins que existeixi una
  decisió explícita i estable per automatitzar-lo.
- Fer una revisió manual d'accessibilitat de llançament; axe no equival a una
  declaració completa de conformitat WCAG 2.2 AA.
- Provar desplegament, fallada abans i després de l'activació, release revocada,
  concurrència, smoke i reversió sense credencials de producció en fixtures.
- Verificar DNS, TLS, apex, `www`, IPv4 i només l'IPv6 publicat, i comprovar que
  el correu continua resolent i funcionant després del tall.
- Verificar que qualsevol host temporal de validació declara
  `X-Robots-Tag: noindex, nofollow, noarchive` abans de servir l'artefacte.

## Seguretat I Privacitat

- Revisió obligatòria de seguretat abans d'adoptar accions de CI, accessos de
  xarxa o mecanismes de desplegament.
- Accions de tercers fixades per commit i permisos `read` per defecte; qualsevol
  permís d'escriptura es justifica al job mínim que el necessita.
- Runner efímer allotjat per GitHub; no s'instal·la cap runner d'Actions al VPS
  de producció.
- Manifest i SHA-256 verificats abans i després de transferir l'artefacte i abans
  de producció o reversió.
- Extracció en un directori nou amb rebuig de traversal, symlinks, hardlinks,
  dispositius, duplicats, tipus inesperats i bombes de mida o nombre de fitxers.
- Credencial de desplegament no-root restringida a l'host, els paths i les
  operacions imprescindibles, sense `sudo` ni shell interactiva general. Caddy
  només llegeix releases i la identitat de deploy no gestiona TLS.
- Cap secret en arguments, URL, artefactes, logs, captures o documentació.
- Canal privat de vulnerabilitats actiu i amb una persona responsable abans del
  primer desplegament públic.
- Polítiques de cookies i privacitat coherents amb YouTube, Hetzner, TLS i logs
  abans del llançament.
- Logs minimitzats, amb finalitat, accés, retenció i esborrat explícits.
- La publicació automàtica posterior al merge no redueix la protecció de `main`,
  els checks obligatoris ni la revisió humana de la pull request.

## Fora D'Abast

- Previews de pull request, dominis efímers i publicació de codi no fiable.
- Migració de nameservers, Cloudflare, DNSSEC o CDN.
- Xat públic, índex de contingut o servei Hono.
- Assistent editorial, Telegram, Discord o Hermes.
- CMS, base de dades, comptes, autenticació, formularis o pagaments.
- Analítica, newsletter, telemetria o nous serveis no imprescindibles per
  publicar la web estàtica.
- Canvis editorials, de disseny, rutes o models que no siguin necessaris per al
  gate de publicació.
- Contenidors, orquestració o infraestructura com a codi si T5.1 no en demostra
  la necessitat.
- Certificació legal, de llicències o WCAG completa.
- Desplegament de serveis futurs al mateix procés o directori que la web.

## Criteris D'Acceptació

La fase es considera completada quan:

1. La fase 4 està tancada, les decisions i responsabilitats de T5.1 estan
   aprovades sense secrets a la documentació i el canal privat de
   vulnerabilitats s'ha activat i provat.
2. Les cinc unitats tenen PR pròpia revisada, validada i fusionada en ordre de
   dependències.
3. Producció rep exactament l'artefacte immutable construït i validat per CI des
   del commit fusionat a `main`, vinculat a origen, data, workflow i SHA-256,
   sense reconstrucció al servidor; l'extracció segura rebutja paths, tipus i
   límits no admesos abans d'escriure una release nova.
4. La superfície canònica vigent, els recursos globals, els enllaços interns i
   l'exclusió de contingut despublicat s'han verificat sobre l'artefacte.
5. El VPS està provisionat amb identitats separades i Caddy serveix TLS, 404,
   headers i caché aprovats, amb logs mínims i sense exposar directoris, fitxers
   interns ni credencials; el host temporal declara `X-Robots-Tag: noindex,
nofollow, noarchive`.
6. La primera activació i el tall DNS han estat aprovats i el correu continua
   operatiu; la reversió provada és interna (release anterior elegible a
   Hetzner) i l'export dels registres anteriors permet una restauració manual
   extraordinària amb aprovació explícita.
7. Després del primer llançament acceptat, cada merge a `main` pot desplegar-se
   automàticament només si passen els gates, sense donar accés de producció al
   job de build, a agents, forks o sessions locals; una execució obsoleta no pot
   activar-se després d'un commit més recent.
8. Els smoke tests passen i la reversió a una release anterior elegible s'ha
   executat amb èxit sense un build nou; una release revocada és rebutjada.
9. Les polítiques públiques descriuen fidelment embeds, hosting i logs, i el
   canal privat de vulnerabilitats és operatiu.
10. El gate de llançament inclou `pnpm validate`, Lighthouse dins dels llindars
    aprovats, cobertura representativa dels tres idiomes i revisió manual
    d'accessibilitat sense afirmar una certificació que no existeix.
11. El runbook descriu desplegament, reversió, salut, TLS, DNS, correu, logs i
    resposta bàsica a incidències, inclòs el cas sense cap release elegible, amb
    responsables i procediments verificats.
12. Cap preview de PR ni servei de Cloudflare és necessari per construir,
    desplegar, operar o revertir producció.
