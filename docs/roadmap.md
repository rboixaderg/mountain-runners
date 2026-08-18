# Roadmap De Desenvolupament

## Propòsit

Aquest document recull els milestones versionats de la nova web. Explica l'ordre
de desenvolupament, les dependències i els criteris per tancar cada fase.

Cada especificació de fase defineix les pull requests d'entrega i el seu estat.
La checklist detallada de cada unitat de treball viu a la draft PR corresponent.
Les issues es reserven per a errors, decisions o seguiments independents que no
quedin resolts dins de la PR activa.

Les necessitats i idees que encara no formen part de cap fase es registren al
[`backlog de necessitats`](backlog.md), sense assignar-les a cap fase. Es pot
revisar en definir una especificació, entre entregues si es detecta una omissió o
després de completar les fases previstes. Una entrada acceptada es converteix en
una entrega explícita amb especificació i pull request pròpies; no amplia
silenciosament una pull request activa. Capturar una idea no altera per si sol el
roadmap ni l'abast d'una fase.

Una fase només passa a completada quan totes les PRs previstes estan fusionades,
les comprovacions requerides han passat i els criteris d'acceptació s'han
verificat.

## Principis Transversals

- El català va ser l'idioma inicial de publicació; des de la fase 4 la superfície
  pública completa es genera també en castellà i anglès.
- El model de contingut ha de ser multiidioma des del principi: tot text
  traduïble serà un objecte indexat per idioma, sense camps duplicats per llengua.
- Totes les rutes HTML públiques utilitzen prefix d'idioma: `/ca/`, `/es/` o
  `/en/`.
- Git és la font de veritat del contingut: fusionar a la branca principal
  protegida fa una variant editorialment publicable i la incorpora al build. La
  publicació efectiva a producció dependrà del flux de desplegament de la fase 5.
- El worktree principal es manté a `main` per planificar i seguir les fases;
  cada tasca d'implementació es desenvolupa en un worktree i una branca propis.
- El disseny segueix `DESIGN.md`; la navegació inicial és plana: Qui som, Socis,
  Escoles i Esdeveniments.
- El xat públic és de només lectura i l'assistent editorial privat no pot
  publicar ni desplegar directament.
- Cap fase pot introduir secrets al repositori ni evitar la revisió, la CI o les
  restriccions de desplegament definides a `AGENTS.md` i `SECURITY.md`.

## Límit De Codi I Contingut

Segons l'ADR 0004, el codi defineix l'estructura estable de la web i el YAML
restringit només modela dades editorials o operatives canviants. Aquesta regla
orienta totes les fases: no es crea una configuració global YAML ni un
constructor genèric de pàgines sense una necessitat editorial concreta.

## Estat General

| Fase                                         | Estat       | Objectiu                                                  |
| -------------------------------------------- | ----------- | --------------------------------------------------------- |
| 0. Fundació del projecte                     | Completada  | Governança, seguretat, ADRs i entorn d'agents             |
| 1. Base executable i qualitat                | Completada  | Astro, validacions, CI, multiidioma i models de contingut |
| 2. Vertical slice públic                     | Completada  | Shell global, inici i esdeveniments funcionals            |
| 3. Cobertura de contingut                    | Completada  | Resta de pàgines i plantilles de la web                   |
| 4. Validació integral de disseny i contingut | Completada  | Revisió pàgina a pàgina i traducció a es/en              |
| 5. Publicació a producció i operació         | Pendent     | Desplegament continu segur sobre Hetzner                  |
| 6. Previews de PR i estratègia DNS/edge      | Planificada | Previews aïllades i decisió informada sobre Cloudflare    |
| 7. Xat públic                                | Planificada | Consultes de només lectura sobre contingut publicat       |
| 8. Assistència editorial                     | Planificada | Edició privada, auditada i basada en pull requests        |

## Fase 0: Fundació Del Projecte

**Estat:** Completada.

- Llicència MIT, normes de contribució, seguretat i Conventional Commits.
- `AGENTS.md`, ADRs, documentació d'arquitectura i límits dels assistents IA.
- Skill portable a `.agents/skills/` i configuració d'OpenCode.

## Fase 1: Base Executable I Qualitat

**Estat:** Completada.

**Objectiu:** crear una base Astro estàtica, tipada i segura, amb les
validacions automàtiques actives des del primer canvi de codi i preparada per
publicar contingut real en català i traduir-lo en el futur.

**Especificació:** [`docs/specs/phase-1-foundation.md`](specs/phase-1-foundation.md).

**Abast:**

- Inicialitzar Astro amb TypeScript estricte.
- Configurar format, lint, tests, typecheck i build com a ordres reproduïbles
  del projecte.
- Configurar una CI mínima que executi aquestes comprovacions en cada pull
  request.
- Protegir la branca principal i marcar les comprovacions de CI com a
  obligatòries.
- Afegir validació de Conventional Commits i detecció de secrets abans que el
  repositori contingui codi d'aplicació o credencials de serveis.
- Configurar Content Collections amb Zod i validació local.
- Afegir proves representatives dels esquemes i de l'exclusió de contingut no
  publicat.
- Definir la configuració central d'idiomes, amb `ca` com a idioma publicat
  inicialment.
- Configurar l'i18n natiu d'Astro amb prefix obligatori i Paraglide JS 2 per als
  missatges curts d'interfície.
- Modelar contingut traduïble com a objectes per idioma, incloent-hi textos,
  CTAs, formularis, enllaços i blocs editorials quan correspongui.
- Definir les col·leccions inicials: escoles, esdeveniments, entitats
  reutilitzables i documents. La configuració estable del lloc i les pàgines
  fixes es mantenen en codi.
- Modelar esdeveniments amb edicions embegudes, `published` per a visibilitat i
  `active` per distingir-los dels històrics.
- Afegir contingut de mostra representatiu i sense dades privades.

**Criteris de tancament:**

- Format, lint, tests, typecheck, validació de contingut i build passen localment
  i a CI.
- Les pull requests no poden fusionar-se si falla una comprovació obligatòria.
- Els missatges de commit i possibles secrets es validen automàticament.
- Un contingut invàlid no pot entrar al build.
- El model permet contingut només en català ara i una traducció futura sense
  canviar-ne l'estructura.
- `/` redirigeix a `/ca/` i no es genera cap variant d'idioma incompleta.
- Cap contingut no publicat queda disponible en la sortida pública.

## Fase 2: Vertical Slice Públic

**Estat:** Completada.

**Objectiu:** validar conjuntament contingut, disseny, navegació i publicació
amb el recorregut més representatiu de la web.

**Especificació:**
[`docs/specs/phase-2-public-vertical-slice.md`](specs/phase-2-public-vertical-slice.md).

**Abast:**

- Implementar layout global, capçalera, peu, navegació mòbil, pàgina 404,
  metadades i fonaments d'accessibilitat.
- Definir i aplicar segments de ruta canònics per idioma abans de construir la
  navegació, el hub d'esdeveniments i les metadades públiques.
- Detectar les skills aplicables a l'stack, revisar-ne pertinència, seguretat i
  llicència, i versionar només les aprovades a `.agents/skills/` amb procedència
  reproduïble.
- Afegir una skill local petita que adapti les comprovacions de qualitat a les
  ordres, rutes i llindars de Mountain Runners.
- Aplicar la direcció de `DESIGN.md` mitjançant components i estils reutilitzables.
- Implementar la pàgina d'inici amb hero, esdeveniments actius, escoles, socis i
  comunitat/territori.
- Implementar hub i detall d'esdeveniment, amb estats actiu, passat, inscripció
  oberta o tancada i enllaços no disponibles.
- Implementar el selector d'idioma perquè només ofereixi variants realment
  publicades de la pàgina actual.

**Criteris de tancament:**

- L'inici i els esdeveniments es generen exclusivament des del contingut
  estructurat.
- Dates, estat i accions són clars en mòbil i no depenen només del color.
- Les pàgines compleixen les decisions de disseny, el SEO complet del vertical
  slice, els pressupostos de rendiment i les comprovacions automatitzades
  d'accessibilitat acordades.
- Les skills aprovades i el wrapper local documenten comprovacions reproduïbles
  que es poden executar o seguir sense dependre d'un únic agent.
- La fase documenta que l'automatització no equival a una auditoria manual ni a
  una declaració completa de conformitat WCAG 2.2 AA.

## Fase 3: Cobertura De Contingut

**Estat:** Completada. La T4.4 va retirar posteriorment la ruta de Contacte i va
traslladar les dades institucionals al prepeu compartit; l'especificació de fase
3 es conserva com a registre del resultat que es va lliurar llavors.

**Objectiu:** completar les àrees públiques previstes amb plantilles consistents
i contingut editable.

**Especificació:**
[`docs/specs/phase-3-content-coverage.md`](specs/phase-3-content-coverage.md).

**Abast:**

- Pàgina Qui som: missatge de presidència, junta, història i estatuts.
- Socis: alta, federació, avantatges i directori de col·laboradors.
- Hub d'escoles i plantilla de detall per a Trail, Skimo i BTT.
- Documents, recursos externs, galeries, vídeos i atribucions amb estats de
  disponibilitat explícits.
- Contacte, butlletí extern, dades de peu i pàgines d'avís legal, privacitat i
  cookies.

**Criteris de tancament:**

- Totes les àrees acordades tenen una ruta i plantilla accessibles.
- Les dades canviants viuen en contingut, no en components de pàgina.
- Els enllaços externs, PDFs i recursos absents tenen un tractament útil.
- L'avís legal, la política de privacitat i la política de cookies estan
  publicats, enllaçats des del peu i revisats abans de publicar.
- La cobertura automatitzada (Vitest, Playwright, axe i SEO) està integrada a
  CI; Lighthouse i els pressupostos es validen manualment.

## Fase 4: Validació Integral De Disseny I Contingut

**Estat:** Completada el 16 d'agost de 2026. La implementació visual i les
variants `ca`, `es` i `en` es van fusionar amb la PR #49 i les entregues de
tancament posteriors (#50, #58, #60, #61, #62, #63, #70 i #73) van resoldre
els punts de la [`revisió de fase 4`](validation/phase-4-design-review.md): la
matriu exhaustiva viu a
[`validation/phase-4-route-matrix.md`](validation/phase-4-route-matrix.md), la
revisió semàntica de les traduccions va quedar confirmada, el pressupost de
Lighthouse es va tancar amb la sèrie final (mediana d'LCP de portada de
2,330 s) i les desviacions dels ADR es van corregir.

**Objectiu:** validar, abans de preparar la publicació, que totes les rutes
públiques implementades responen a la direcció de `DESIGN.md`, tenen una
estructura coherent i accessible, i publiquen el text, les dades i els recursos
visuals aprovats que els corresponen.

**Especificació:**
[`docs/specs/phase-4-design-content-validation.md`](specs/phase-4-design-content-validation.md).

**Abast:**

- Revisar pàgina a pàgina les rutes, la navegació, el peu, les variants mòbil i
  escriptori i els estats de contingut disponibles.
- Contrastar composició, jerarquia, tipografia, color, imatges i interaccions amb
  `DESIGN.md`, sense introduir un sistema visual paral·lel.
- Verificar que textos, dades pràctiques, enllaços, documents, imatges,
  atribucions i alternatives textuals són correctes, vigents i corresponen a
  cada context públic.
- Documentar les evidències, les discrepàncies i les correccions necessàries en
  entregues petites, revisables i validades abans de donar la fase per tancada.
- Afegir traduccions públiques en castellà i anglès del contingut revisat i
  complet.

**Criteris de tancament:**

- Totes les rutes públiques i els seus estats representatius han estat revisats
  amb una evidència de validació traçable.
- No resten discrepàncies obertes de disseny, estructura, contingut o recursos
  visuals dins de l'abast publicable acordat.
- Les correccions mantenen els límits de contingut, accessibilitat, seguretat i
  qualitat de les fases anteriors.
- Les variants en castellà i anglès de tot el contingut publicat estan
  completes, revisades i oferides pel selector d'idioma.

## Fase 5: Publicació A Producció I Operació

**Estat:** T5.1 i T5.2 completades (decisions i artefacte). T5.3 implementada a
la PR #79 (servidor, Caddy, releases i reversió); falten les accions remotes
aprovades (VPS, DNS del host de validació, claus) per donar-la per completada.
La fase 4 està completada i ja no bloqueja la publicació.

**Especificació:**
[`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md).

**Objectiu:** portar una aplicació ja validada a producció mitjançant un flux
segur, reproduïble i reversible que, després del primer tall supervisat, desplega
automàticament els commits fusionats a `main`.

**Abast:**

- Generar i verificar a CI un artefacte immutable del commit fusionat a `main`.
- Preparar el VPS de Hetzner, Caddy, TLS, logs, salut, releases atòmiques i
  reversió abans de producció.
- Configurar el flux protegit de desplegament continu i separar les credencials
  del job de build.
- Mantenir Hostinger com a DNS autoritatiu, modificar només els registres web i
  preservar el correu durant el primer tall.
- Executar la revisió manual d'accessibilitat i el gate integral de llançament.
- Confirmar la comunicació privada de vulnerabilitats abans de l'obertura
  pública o del primer desplegament.
- Deixar els previews i qualsevol decisió sobre Cloudflare fora del camí crític
  de producció.

**Criteris de tancament:**

- Les comprovacions específiques de la web completa passen abans de publicar.
- Producció només rep artefactes generats per CI des de la branca protegida.
- La primera activació i el tall DNS són supervisats; després, els merges a
  `main` poden desplegar-se automàticament si passen tots els gates.
- El correu i els serveis DNS no migrats continuen operatius.
- La documentació operativa descriu desplegament, reversió i resposta bàsica a
  incidències.

## Fase 6: Previews De PR I Estratègia DNS/Edge

**Estat:** Planificada després de completar la fase 5.

**Especificació:**
[`docs/specs/phase-6-pull-request-previews.md`](specs/phase-6-pull-request-previews.md).

**Objectiu:** decidir i implementar previews de pull request aïllades, efímeres
i segures, revisant si Cloudflare, un wildcard DNS o una alternativa més simple
són realment necessaris.

**Abast:**

- Definir requisits, visibilitat, cicle de vida, costos, responsables i model
  d'amenaces abans d'adoptar cap proveïdor.
- Comparar Hostinger DNS, Hetzner i Caddy, Cloudflare DNS-only, proxy o Access,
  un domini registrable separat amb certificats individuals o wildcard i serveis
  externs de preview.
- Separar el build no fiable de PR del publicador de confiança, sense secrets de
  producció ni execució de codi de la PR en el context privilegiat.
- Publicar cada preview en un origen aïllat, amb `noindex`, expiració, revocació
  i neteja d'orfes.
- Garantir que una fallada dels previews o del proveïdor escollit no afecta
  producció.

**Criteris de tancament:**

- La decisió de DNS, TLS, domini, hosting i proveïdor està justificada i disposa
  d'ADR si canvia una frontera arquitectònica.
- Una PR pròpia o de fork no exposa secrets ni permisos de producció, utilitza un
  runner efímer i requereix autorització abans de publicar-se.
- El publicador verifica manifest, digests i paths sense executar codi no fiable.
- Les previews utilitzen un domini registrable separat, queden identificades com
  a no-producció, declaren `noindex, nofollow, noarchive` i no comparteixen
  cookies, caches ni zona DNS editable amb producció.
- La creació, actualització, caducitat, tancament, revocació i neteja són
  idempotents i estan documentades.

## Fase 7: Xat Públic

**Objectiu:** oferir un xat públic útil i verificable sobre Mountain Runners,
basat exclusivament en el contingut publicat de la web, sense crear un backend
editorial ni exposar contingut privat.

**Abast:**

- Generar un índex JSON o NDJSON de tot el contingut publicat, amb idioma,
  metadades i enllaç a la font, excloent esborranys i contingut intern.
- Implementar un servei Hono separat i de només lectura, amb recuperació lèxica
  o BM25 i sense Onyx, embeddings ni base de dades vectorial inicialment.
- Generar respostes fonamentades en fragments rellevants, amb fonts verificables
  i una resposta explícita quan no hi hagi informació suficient.
- Integrar una experiència accessible i secundària a la navegació principal,
  amb estats d'error, indisponibilitat i límit d'ús.
- Aplicar proteccions contra abús i prompt injection, minimització de dades,
  controls de cost i una política explícita de logs i retenció.
- Validar qualitat, fidelitat, negatives correctes, latència i cost amb un
  conjunt de preguntes representatives abans d'obrir el servei.
- Preparar desactivació ràpida i degradació elegant perquè una fallada del xat no
  afecti la web.

**Criteris de tancament:**

- El xat no pot modificar contingut ni activar eines editorials.
- Els esborranys i la documentació interna no entren mai a l'índex.
- Cada resposta factual es basa en contingut publicat i ofereix fonts
  verificables; quan no hi ha evidència suficient, el xat ho indica.
- La seguretat, la privacitat, el cost i la qualitat estan avaluats i documentats
  abans de l'obertura pública.
- El servei es pot desactivar sense afectar la disponibilitat ni la funcionalitat
  principal de la web.

## Fase 8: Assistència Editorial Privada

**Objectiu:** facilitar l'edició conversacional sense substituir la revisió
humana ni el flux de Git.

**Abast:**

- Definir canals i identitats autoritzades per a l'assistent privat.
- Limitar-lo a camins de contingut i scripts de validació aprovats.
- Permetre crear branca, editar, validar, obrir pull request i retornar preview.
- Afegir registre d'auditoria i revocació d'accés.

**Criteris de tancament:**

- L'assistent no pot fusionar, desplegar ni accedir a secrets.
- Cada canvi és atribuïble a una branca, diff i pull request.
- Les fallades de validació no generen publicacions ni canvis parcials a
  producció.

## Decisions Pendents Abans De Les Fases Posteriors

- Accés del VPS de Hetzner, responsables, entorn de producció i política de logs
  per completar la fase 5.
- Necessitat real de Cloudflare, wildcard DNS o TLS, visibilitat i retenció dels
  previews per a la fase 6.
- Política de minimització, accés i conservació dels logs de Caddy, coherent amb
  els textos de privacitat.
- Tractament de privacitat dels vídeos de YouTube abans del primer desplegament.
- Política de conservació de logs i límits d'ús del futur xat públic.
