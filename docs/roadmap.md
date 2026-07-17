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

- El català és l'idioma inicial de publicació.
- El model de contingut ha de ser multiidioma des del principi: tot text
  traduïble serà un objecte indexat per idioma, sense camps duplicats per llengua.
- Totes les rutes HTML públiques utilitzen prefix d'idioma: `/ca/`, `/es/` o
  `/en/`.
- Git és la font de veritat del contingut i publicar equival a fusionar a la
  branca principal protegida.
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

| Fase | Estat | Objectiu |
| --- | --- | --- |
| 0. Fundació del projecte | Completada | Governança, seguretat, ADRs i entorn d'agents |
| 1. Base executable i qualitat | Planificada | Astro, validacions, CI, multiidioma i models de contingut |
| 2. Vertical slice públic | Planificada | Shell global, inici i esdeveniments funcionals |
| 3. Cobertura de contingut | Planificada | Resta de pàgines i plantilles de la web |
| 4. Publicació i operació | Planificada | Previews, desplegament i operació segura |
| 5. Xat públic | Planificada | Consultes de només lectura sobre contingut publicat |
| 6. Assistència editorial | Planificada | Edició privada, auditada i basada en pull requests |

## Fase 0: Fundació Del Projecte

**Estat:** Completada.

- Llicència MIT, normes de contribució, seguretat i Conventional Commits.
- `AGENTS.md`, ADRs, documentació d'arquitectura i límits dels assistents IA.
- Skill portable a `.agents/skills/` i configuració d'OpenCode.

## Fase 1: Base Executable I Qualitat

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
- Definir les col·leccions inicials: configuració del lloc, pàgines, escoles,
  esdeveniments, entitats reutilitzables i documents.
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

**Objectiu:** completar les àrees públiques previstes amb plantilles consistents
i contingut editable.

**Abast:**

- Pàgina Qui som: missatge de presidència, junta, història i estatuts.
- Socis: alta, federació, avantatges i directori de col·laboradors.
- Hub d'escoles i plantilla de detall per a Trail, Skimo, BTT i Trial.
- Documents, recursos externs, galeries, vídeos i atribucions amb estats de
  disponibilitat explícits.
- Contacte, butlletí, dades de peu i enllaços legals.
- Afegir traduccions públiques quan el contingut corresponent estigui revisat i
  complet.

**Criteris de tancament:**

- Totes les àrees acordades tenen una ruta i plantilla accessibles.
- Les dades canviants viuen en contingut, no en components de pàgina.
- Els enllaços externs, PDFs i recursos absents tenen un tractament útil.

## Fase 4: Publicació I Operació

**Objectiu:** portar una aplicació ja validada a producció mitjançant un flux
segur, reproduïble i reversible.

**Abast:**

- Ampliar la CI amb comprovació d'enllaços, accessibilitat i altres controls que
  requereixin la web completa.
- Configurar previews de pull request i el flux de desplegament protegit.
- Preparar Caddy, TLS, logs, salut de serveis i reversió abans de producció.
- Confirmar la comunicació privada de vulnerabilitats abans de l'obertura
  pública o del primer desplegament.

**Criteris de tancament:**

- Les comprovacions específiques de la web completa passen abans de publicar.
- Producció només rep artefactes generats per CI des de la branca protegida.
- La documentació operativa descriu desplegament, reversió i resposta bàsica a
  incidències.

## Fase 5: Xat Públic

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

## Fase 6: Assistència Editorial Privada

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

- Proveïdor d'allotjament Git, configuració de branques protegides i CI.
- Font definitiva de dades de contacte, seu, horaris, formulari i butlletí.
- Política de conservació de logs i límits d'ús del futur xat públic.
