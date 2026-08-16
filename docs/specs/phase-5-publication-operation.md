# Especificació De La Fase 5: Publicació I Operació

## Estat

Bloquejada fins que la fase 4 tanqui les discrepàncies publicables registrades a
`docs/validation/phase-4-design-review.md`. La planificació es pot revisar, però
no s'inicia cap preview ni desplegament fins a completar T5.1.

## Objectiu

Publicar l'aplicació Astro ja validada mitjançant un flux segur, reproduïble i
reversible, servir-la amb Caddy des del VPS aprovat i deixar documentades les
operacions mínimes de llançament, salut, logs, incidències i reversió.

La fase converteix el build estàtic actual en un artefacte de CI desplegable. No
afegeix funcionalitat editorial, xat, autenticació ni serveis de negoci.

## Límits I Decisions Confirmades

- Producció només rep un artefacte net creat per CI des d'un commit fusionat a
  la branca `main` protegida. No es desplega cap `dist/` local.
- La web continua sent Astro estàtic. Caddy serveix els fitxers i acaba TLS des
  d'un VPS modest, d'acord amb l'ADR 0001.
- Cap agent, sessió local ni assistent editorial pot desplegar, fusionar,
  habilitar auto-merge o obtenir accés persistent a producció.
- Els secrets viuen exclusivament a l'entorn protegit o al magatzem de secrets
  aprovat; no entren al repositori, als artefactes, als logs ni a les previews.
- Cada destí rep un artefacte immutable construït una sola vegada per al seu
  origen. Una preview de PR i producció són artefactes diferents: la preview no
  es promociona mai a producció, i producció no reconstrueix ni modifica
  l'artefacte validat de `main`.
- El desplegament és atòmic i reversible a un artefacte anterior sense fer un
  build nou.
- La política de previews, el proveïdor i accés del VPS, l'entorn d'aprovació,
  els camps i retenció de logs i el canal privat de vulnerabilitats s'han de
  confirmar a T5.1 abans d'adoptar serveis o escriure automatització.
- El canal privat de vulnerabilitats ha d'estar activat i comprovat a T5.1,
  abans de publicar cap preview o activar cap ruta de producció.
- Una decisió que canviï un ADR vigent requereix un ADR nou o substitutiu abans
  de la implementació.

## Resultats Esperats

- Decisions operatives i de privacitat aprovades, sense credencials al text, i
  canal privat de vulnerabilitats operatiu.
- Artefacte estàtic reproduïble, amb manifest de commit, origen, data editorial
  i digest SHA-256, validat íntegrament a CI.
- Comprovació de rutes, recursos i enllaços interns de tota la superfície
  pública en català, castellà i anglès.
- Previews de pull request aïllades segons la política aprovada, sense secrets de
  producció ni contingut despublicat.
- Caddy amb TLS, 404, capçaleres, caché i logs mínims configurats i validats.
- Desplegament protegit a producció, smoke tests posteriors i reversió provada.
- Runbook públic sense dades sensibles per a desplegament, reversió, renovació
  TLS, salut, incidències i responsabilitats.

## Dependències I Ordre D'Inici

La fase 4 resol el tractament dels embeds i els textos legals abans de tancar.
T5.1 en verifica el resultat i requereix una persona mantenidora disponible per
confirmar la resta de decisions operatives. T5.2 comença després de T5.1. T5.3 i
T5.4 poden avançar en paral·lel després de T5.2 si no comparteixen secrets ni
infraestructura mutable. T5.5 depèn de totes dues. T5.6 valida el sistema complet
i és l'última entrega.

Cada tasca s'implementa en un worktree i una branca propis des de l'últim
`main`. Les accions que creen o alteren recursos remots, DNS, entorns, secrets o
servidors requereixen aprovació explícita de la persona mantenidora en la
conversa o procediment corresponent.

## Tasques, Entregues I Seguiment

| Unitat                                  | Estat      | Dependències           | Resultat verificable                        | PR  |
| --------------------------------------- | ---------- | ---------------------- | ------------------------------------------- | --- |
| T5.1 Decisions i porta de llançament    | Bloquejada | Tancament de la fase 4 | Decisions, riscos i responsables confirmats | -   |
| T5.2 Artefacte i controls de publicació | Pendent    | T5.1                   | Artefacte CI complet i verificat            | -   |
| T5.3 Previews de pull request           | Pendent    | T5.2                   | Preview aïllada i efímera                   | -   |
| T5.4 VPS, Caddy, releases i reversió    | Pendent    | T5.2                   | Servidor TLS provisionat i reversió provada | -   |
| T5.5 Desplegament protegit              | Pendent    | T5.3 i T5.4            | Promoció aprovada amb smoke tests           | -   |
| T5.6 Validació de llançament i operació | Pendent    | T5.5                   | Gate final i runbook verificats             | -   |

### T5.1: Decisions I Porta De Llançament

**Abast:** verificar la resolució de fase 4 sobre embeds; confirmar proveïdor i
administració del VPS, domini i DNS, responsables, previews, aprovació de
producció, headers mínims, caché i logs; i activar el canal privat de
vulnerabilitats amb una persona responsable. **Exclusió:** no crea el VPS,
credencials de desplegament ni secrets d'aplicació. **Depèn de:** fase 4 tancada.
**Resultat:** decisions traçables i riscos sense bloqueig, canal privat operatiu
i ADR quan canviï una frontera. **Comprovació:** prova privada del canal i
revisió humana de seguretat, privacitat i operació. **PR:** pròpia; qualsevol
canvi remot al repositori requereix aprovació explícita.

### T5.2: Artefacte I Controls De Publicació

**Abast:** definir un contracte reutilitzable que construeixi amb lockfile
immutable, origen explícit i data editorial registrada; verificar les 66 rutes
canòniques, `/`, 404, sitemap, robots, recursos publicats, absència d'esborranys
i enllaços interns. Generar un manifest amb commit, origen, `BUILD_TODAY`, llista
de fitxers i digest SHA-256. **Exclusió:** no desplega ni comprova remotament
enllaços externs canviants com a gate de CI. **Depèn de:** T5.1. **Resultat:**
contracte d'artefacte immutable que els fluxos de preview i producció poden
invocar amb orígens diferents. **Comprovació:** `pnpm validate`, dos builds nets
amb les mateixes entrades i digests idèntics, verificació de sortida i prova
negativa contra contingut despublicat. **PR:** pròpia.

### T5.3: Previews De Pull Request

**Abast:** construir amb una URL de preview pròpia en un job de PR de només
lectura, sense secrets, i publicar l'artefacte en un namespace aïllat mitjançant
un job de confiança que no fa checkout ni executa codi de la PR. El publicador
verifica el manifest amb codi de confiança, extreu l'arxiu sense symlinks ni
escapaments de directori i aplica expiració, neteja i `noindex, noarchive`.
**Exclusió:** no utilitza `pull_request_target` per executar codi de PR, no
promou a producció ni publica contingut `published: false`. **Depèn de:** T5.2 i
política aprovada a T5.1. **Resultat:** preview en origen aïllat, sense cookies ni
credencials compartides amb producció, traçable a la PR i retirada en tancar-la.
**Comprovació:** permisos mínims, fork sense secrets, artefacte malformat,
absència de contingut despublicat, headers de robots i neteja. **PR:** pròpia.

### T5.4: VPS, Caddy, Releases I Reversió

**Abast:** provisionar l'accés i l'estructura mínima del VPS aprovats, preparar
els canvis de DNS, crear identitats separades de desplegament i Caddy, servir
l'artefacte en un host de validació amb TLS, 404, headers, caché, logs
minimitzats, releases atòmiques i registre de releases aprovades o revocades.
Escriu les seccions de servidor, TLS, logs, salut i reversió del runbook i
actualitza les polítiques públiques amb el hosting i els logs que s'activaran.
**Exclusió:** no aplica encara el tall de DNS de producció ni afegeix API, base
de dades, contenidors o observabilitat externa no aprovada. **Depèn de:** T5.2 i
decisions de T5.1. **Resultat:** servidor preparat, polítiques vigents i release
de prova activable i reversible sense reconstruir. **Comprovació:** bootstrap
reproduïble, identitat del host, permisos, configuració, TLS, headers, 404,
caché, logs, polítiques i reversió a una release encara elegible. **PR:** pròpia;
cap canvi remot sense aprovació explícita.

### T5.5: Desplegament Protegit

**Abast:** verificar que el canal privat i les polítiques públiques són vigents,
promocionar l'artefacte aprovat des de `main` mitjançant un entorn protegit,
aplicar el tall de DNS aprovat, controlar la concurrència, usar una credencial de
mínim privilegi, activar atòmicament i executar smoke tests. **Exclusió:** no
permet deploy local, des de forks o des de branques no protegides. **Depèn de:**
T5.3 i T5.4. **Resultat:** desplegament auditable i fallada segura, amb reversió
del mateix workflow.
**Comprovació:** permisos, aprovació humana, digest i manifest, exclusió mútua,
simulació de fallada, release revocada, smoke tests i reversió. **PR:** pròpia;
escriu les seccions del runbook relatives al workflow i a la promoció.

### T5.6: Validació De Llançament I Operació

**Abast:** executar el gate complet sobre preview i producció, validar rutes i
idiomes, fer la revisió manual d'accessibilitat acordada, comprovar enllaços
externs de llançament, TLS, renovació, salut, logs i incidències; consolidar i
validar el runbook i verificar que les polítiques públiques continuen alineades
amb el comportament real. **Exclusió:** no presenta automatització com una
certificació WCAG ni introdueix analítica. **Depèn de:** T5.5. **Resultat:**
evidència final de llançament, polítiques coherents i responsabilitats
operatives acceptades.
**Comprovació:** `pnpm validate`, Lighthouse dins dels pressupostos aprovats,
navegació representativa `ca`/`es`/`en`, revisió manual, smoke, rollback i
runbook documentats. **PR:** pròpia i darrera de la fase.

## Artefacte, Rutes I Enllaços

El contracte construeix en un checkout net amb
`pnpm install --frozen-lockfile`. Cada invocació rep el seu origen: la URL
aïllada de la PR per a preview o `https://mountainrunners.cat` per a producció.
També fixa un `BUILD_TODAY` explícit, coherent amb la data de Madrid. El
directori `apps/web/dist/` només existeix com a resultat generat i no es
desplega des del worktree.

El manifest vincula commit, origen, `BUILD_TODAY`, workflow i llista de fitxers
amb els seus SHA-256. La reproduïbilitat significa que dos builds nets amb el
mateix commit, lockfile, origen, data i versions d'eina produeixen la mateixa
llista de fitxers i els mateixos digests. El job de publicació o desplegament
verifica el manifest abans d'extreure o activar res.

La comprovació de sortida reutilitza el contracte actual i cobreix exactament les
48 URL canòniques, els recursos tècnics globals i els recursos editorials
publicables. Els enllaços interns i fitxers locals són bloquejants. Els enllaços
externs es validen estructuralment a CI i es revisen remotament al gate de
llançament amb una política de timeout i reintent que no confongui una fallada
temporal de tercers amb corrupció de l'artefacte.

## Previews I Entorns

T5.1 decideix si les previews són públiques, autenticades o restringides. En tots
els casos són temporals, mostren només contingut publicable, declaren
`noindex, noarchive` i utilitzen un origen sense cookies ni credencials
compartides amb producció. Una PR d'un fork o codi no fiable no pot executar
passos amb secrets, escriure directament en entorns persistents ni reutilitzar
credencials de producció.

El job no fiable només construeix. Un publicador de confiança, amb codi fixat des
de `main`, no executa scripts ni fa checkout de la PR: verifica el manifest,
rebutja arxius absoluts, `..`, symlinks i tipus inesperats, i escriu només al
namespace efímer d'aquella PR. `pull_request_target` no s'utilitza per executar
codi o scripts provinents de la PR.

Producció és un entorn separat amb aprovació humana i protecció de concurrència.
La mateixa release no pot desplegar-se parcialment en dos processos simultanis.

## Caddy, TLS, Logs I Reversió

Caddy serveix només el directori de la release activa amb una identitat separada
i accés de només lectura. La identitat de desplegament no és `root`, no pot
escriure la configuració de Caddy, les claus TLS ni l'estat ACME, i queda
restringida a carregar releases, verificar digests i activar-les atòmicament. La
identitat SSH del servidor es fixa i es verifica.

La configuració preserva les rutes amb barra final, retorna la 404 global,
evita llistats de directoris i redirigeix HTTP a HTTPS. Com a mínim defineix
`X-Content-Type-Options: nosniff`, una `Referrer-Policy` restrictiva i una
`Permissions-Policy` que desactiva capacitats no utilitzades. T5.1 aprova una
CSP sense comodins ni `unsafe-eval`; si es mantenen els vídeos, `frame-src` es
limita als orígens aprovats. HSTS només s'activa després de validar TLS i la
política de subdominis.

Els assets amb nom versionat tenen caché immutable llarg. HTML, sitemap i robots
es revaliden i no mantenen contingut obsolet després d'una activació. Els
recursos editorials sense hash tenen la política curta acordada a T5.1.

Els logs recullen només els camps aprovats a T5.1, tenen accés restringit,
retenció definida i cap credencial o query sensible. El registre de releases
permet revocar un artefacte per vulnerabilitat, retirada de consentiment,
contingut incorrecte o incidència legal. La reversió requereix aprovació,
verifica el digest i l'elegibilitat actual de la release i rebutja artefactes
revocats. Si no queda cap release segura, el runbook defineix la resposta
d'emergència sense reconstruir ni editar fitxers manualment al servidor.

## Estratègia De Tests I Qualitat

- Mantenir `pnpm check`, `pnpm test:e2e` i `pnpm validate` com a gates de codi.
- Executar les comprovacions de build i sortida en un entorn net i sobre
  l'artefacte que es promociona.
- Comparar dos builds nets amb entrades idèntiques i verificar manifest i digests
  abans de publicar, promocionar o revertir.
- Afegir recorreguts E2E representatius en castellà i anglès per a selector,
  canonical, `hreflang`, navegació, hub, detall, pàgina fixa i 404.
- Comprovar enllaços interns, recursos i exclusions de contingut en totes les
  variants publicades.
- Mantenir Lighthouse com a gate manual reproduïble fins que existeixi una
  decisió explícita i estable per automatitzar-lo.
- Fer una revisió manual d'accessibilitat de llançament; axe no equival a una
  declaració completa de conformitat WCAG 2.2 AA.
- Provar preview, desplegament, fallada posterior a l'activació, smoke i reversió
  sense utilitzar dades o credencials de producció en fixtures.

## Seguretat I Privacitat

- Revisió obligatòria de seguretat abans d'adoptar serveis, accions de CI,
  accessos de xarxa o mecanismes de desplegament.
- Accions de tercers fixades per commit i permisos `read` per defecte; qualsevol
  permís d'escriptura es justifica al job mínim que el necessita.
- Manifest i SHA-256 verificats abans de travessar les fronteres de preview,
  producció o reversió; les accions i dependències del workflow es fixen per
  commit complet.
- Separació entre codi de PR no fiable, previews i credencials de producció.
- Credencial de desplegament no-root restringida a l'host, els paths i les
  operacions imprescindibles, sense `sudo` ni shell interactiva general. Caddy
  només llegeix releases i la identitat de deploy no gestiona TLS.
- Cap secret en arguments, URL, artefactes, logs, captures o documentació.
- Canal privat de vulnerabilitats actiu i amb una persona responsable abans del
  primer desplegament públic.
- Polítiques de cookies i privacitat coherents amb YouTube, hosting, TLS i logs
  abans de llançar.
- Logs minimitzats, amb finalitat, accés, retenció i esborrat explícits.

## Fora D'Abast

- Xat públic, índex de contingut o servei Hono.
- Assistent editorial, Telegram, Discord o Hermes.
- CMS, base de dades, comptes, autenticació, formularis o pagaments.
- Analítica, telemetria de producte o nous serveis de tercers no imprescindibles
  per publicar.
- Canvis editorials, de disseny, rutes o models que no siguin necessaris per al
  gate de publicació; tornen al backlog o a una especificació petita.
- Contenidors, orquestració o infraestructura com a codi si T5.1 no en demostra
  la necessitat.
- Certificació legal, de llicències o WCAG completa.
- Desplegament de l'API futura al mateix procés o directori que la web estàtica.

## Criteris D'Acceptació

La fase es considera completada quan:

1. La fase 4 està tancada, totes les decisions i responsabilitats de T5.1 estan
   aprovades sense secrets a la documentació i el canal privat de
   vulnerabilitats s'ha activat i provat.
2. Les sis unitats tenen PR pròpia revisada, validada i fusionada en ordre de
   dependències.
3. Producció rep exactament l'artefacte immutable construït i validat per CI des
   de `main`, vinculat a commit, origen, data i SHA-256, sense reconstrucció al
   servidor; cap artefacte de preview es promociona.
4. Les 66 rutes canòniques, els recursos globals, els enllaços interns i
   l'exclusió de contingut despublicat s'han verificat sobre l'artefacte.
5. Les previews compleixen la política aprovada, utilitzen origen aïllat,
   `noindex, noarchive`, expiren i no exposen secrets, permisos de producció ni
   contingut despublicat; el publicador no executa codi de PR.
6. El VPS està provisionat amb identitats separades i Caddy serveix TLS, 404,
   headers i caché aprovats, amb logs mínims i sense exposar directoris, fitxers
   interns ni credencials.
7. Només una persona mantenidora pot aprovar la promoció a producció després de
   verificar les polítiques públiques; agents, forks i sessions locals no poden
   desplegar ni fusionar.
8. Els smoke tests posteriors passen i la reversió a una release anterior encara
   elegible s'ha executat amb èxit sense un build nou; una release revocada és
   rebutjada.
9. Les polítiques públiques descriuen fidelment embeds, hosting i logs, i el
   canal privat de vulnerabilitats és operatiu.
10. El gate de llançament inclou `pnpm validate`, Lighthouse dins dels llindars
    aprovats, cobertura representativa dels tres idiomes i revisió manual
    d'accessibilitat sense afirmar una certificació que no existeix.
11. El runbook descriu desplegament, reversió, salut, TLS, logs i resposta bàsica
    a incidències amb responsables i procediments verificats.
