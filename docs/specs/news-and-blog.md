# Especificació de notícies, blog i previews editorials

## Estat

Funcionalitat autoritzada per la persona mantenidora el 2 d'octubre de 2026 a
partir del [pla d'investigació](../news-and-blog-plan.md). Les decisions de
publicació es registren a l'[ADR 0011](../decisions/0011-news-blog-editorial-previews.md).
No s'afegeix una fase ni es renumeren les fases existents. Cap tasca es considera
completada fins que la seva PR estigui revisada, validada i fusionada.

La persona mantenidora farà la revisió editorial. Els pilots són la inauguració
del local del 26 de setembre de 2026 i la guia per fer-se soci. La fotografia
i la comprovació del formulari continuen pendents;
no bloquegen el model ni les proves amb fixtures, però sí la publicació editorial.

## Objectiu

Oferir dos apartats, Notícies i Blog, amb llistat i detall multilingües, i revisar
esborranys al preview sense publicar-los ni duplicar-los. Producció només exposa
contingut publicat i complet en l'idioma de la ruta.

## Límits i decisions confirmades

- Astro estàtic, Git, YAML restringit i Zod estricte. La persona mantenidora
  autoritza `sharp` per optimitzar imatges; no s'autoritzen altres dependències.
- Una col·lecció `posts`, tipus `news | blog` i estat `published: boolean`.
- Català obligatori. Castellà i anglès només si la variant requerida és completa,
  sense fallback de text català sota una ruta d'un altre idioma.
- La preview editorial només amplia visibilitat de posts; la resta de
  col·leccions i les rutes existents mantenen els contractes actuals.
- Es mantenen l'avís de preview, la no-indexació, els orígens i artefactes
  separats i l'autorització de l'ADR 0009. No hi ha canvis DNS ni de serveis.
- L'agent no aprova contingut, fa merge ni desplega. Les decisions editorials
  materials es revisen amb la persona mantenidora.

## Resultats esperats

- Hubs i detalls de notícies i blog accessibles en els idiomes disponibles.
- Esborranys descobribles al preview amb estat textual explícit.
- Producció sense rutes, textos, metadades o recursos exclusius d'esborranys.
- Guia, dues plantilles i skill local amb estructura i criteris editorials comuns.
- Dos pilots en esborrany, sense informació ni imatges inventades.

## Dependències i ordre d'inici

NB-01 formalitza la decisió i els requisits. NB-03 pot començar després de
NB-01, independentment de NB-02. NB-04 prova els builds sobre NB-03; NB-05
construeix les pàgines sobre NB-02 i NB-04; NB-06 completa metadades i NB-07
valida l'entrega. Per petició de la persona mantenidora, la documentació i la
implementació d'aquesta funcionalitat es lliuraran en una única PR. Les unitats
NB-01 a NB-07 es conserven per delimitar abast, dependències i acceptació, no
com a PR independents.

El worktree actiu és `mountain_runners-news-blog-artifacts`, branca
`feat/news-blog-artifacts`, creat des de `origin/main`. Hi viuen l'especificació,
l'ADR, els pilots, el codi i les evidències. El worktree anterior de NB-03 es
conserva com a còpia històrica, no com a font per continuar implementant.
Aquesta agrupació i el trasllat de la planificació fora de `main` són excepcions
autoritzades per a aquesta funcionalitat; no canvien les normes generals del
repositori. Sense commits, push o creació de PR remotes no autoritzats.

La implementació local no requereix activar una preview remota. Aquesta prova
necessita el sistema de fase 6 operatiu i autorització explícita per publicar.

## Tasques, entregues i seguiment

| Unitat | Abast                        | Dependències                        | Estat      | PR   |
| ------ | ---------------------------- | ----------------------------------- | ---------- | ---- |
| NB-01  | Decisió i especificació      | Aprovació de la persona mantenidora | En revisió | #140 |
| NB-02  | Guia, plantilles i skill     | NB-01                               | En revisió | #140 |
| NB-03  | Model, col·lecció i selecció | NB-01                               | En revisió | #140 |
| NB-04  | Recursos i modes de build    | NB-03                               | En revisió | #140 |
| NB-05  | Hubs, detall i navegació     | NB-02, NB-04                        | En revisió | #140 |
| NB-06  | Metadades i descoberta       | NB-05                               | En revisió | #140 |
| NB-07  | Pilots i validació integrada | NB-02 a NB-06                       | En curs    | #140 |

Continuació local del 2 i 3 d'octubre de 2026: implementació tècnica de totes les
unitats, amb un commit per tasca pendent. NB-07 conserva pendents la revisió visual
manual i l'aprovació editorial humana. L'[evidència integrada](../validation/news-blog-integrated.md)
separa comprovacions executades i pendents. No s'ha fet push d'aquesta continuació,
merge, activació remota ni desplegament.

### NB-01. Decisió i especificació

Abast: ADR 0011, requisits, esmena explícita de la fase 6 i enllaç al backlog.
Exclou codi i activació remota. Resultat: excepció editorial traçable i tasques
amb acceptació. Comprovacions: convenció de specs, links, format i coherència
amb ADR. Inclosa a la PR conjunta.

### NB-02. Guia, plantilles i skill

Abast: guia catalana, plantilles de notícia i blog i skill local en anglès que
produeix contingut català i reutilitza `unslop`. Exclou serveis d'assistent i
skills externes no revisades. Resultat: preparació consistent amb preguntes quan
falten dades. Comprovacions: els dos pilots, fonts contradictòries, dades
insuficients i petició de publicar sense revisió. Inclosa a la PR conjunta.

NB-02 implementada localment: [guia editorial](../editorial/guide.md), plantilles
i skill `editorial-posts`. Contracte revisat amb els dos pilots i casos de fonts
contradictòries, dades insuficients i publicació sense revisió. No és aprovació
editorial ni una prova automàtica del model.

### NB-03. Model, col·lecció i selecció

Abast: esquema `posts`, registre al loader restringit, validació de dates,
referències, recursos i seleccions públiques i de preview explícites. Exclou
noves rutes, còpia d'assets, metadades i canvi de visibilitat d'altres dominis.
Resultat: esborrany seleccionable només al catàleg editorial de preview.
Comprovacions: unitàries positives i negatives, typecheck, lint i build ordinari
amb rutes existents inalterades. Inclosa a la PR conjunta; no es declara complet el filtre
d'artefacte fins a NB-04.

Progrés local del 2 d'octubre de 2026: model i seleccions implementats a la branca
`feat/news-blog-model`, al worktree `mountain_runners-news-blog-model`.
`pnpm check` passa amb 358 tests de web i 115 de servidor; passen els builds
públic/preview i els 18 E2E existents de preview. No hi ha rutes noves, pilots
registrats, commit ni PR. L'evidència viu a `docs/validation/news-blog-model.md`
en aquella branca. Aquests canvis i l'evidència s'han consolidat al worktree
actiu. La tasca continua `En curs` fins al flux de revisió i merge.

### NB-04. Recursos i modes de build

Abast: recursos segons camps realment renderitzats, mode `PUBLIC_PREVIEW` explícit
als builds oficials i verificacions de sortida separades. Exclou infraestructura,
DNS i publicador. Resultat: cap residu ni recurs exclusiu d'esborrany al build
públic. Comprovacions: dos builds nets, preview seguit de producció, recurs
exclusiu/compartit, assets optimitzats, enllaços i modes incoherents. Inclosa a la PR conjunta.

Progrés local del 2 d'octubre de 2026: selecció de cobertes i controls de mode
implementats a `feat/news-blog-artifacts`, amb NB-03 copiat com a dependència
local no comesa. `pnpm check` passa amb 364 tests de web i 116 de servidor,
inclosa la prova de quatre builds reals i comparació de paths/digests.
L'evidència és `docs/validation/news-blog-artifacts.md` en aquella branca.
L'aïllament d'imatges transformades continua pendent: no hi ha `sharp` i no
s'han autoritzat dependències noves. Una prova exploratòria també confirma que
un glob lazy de totes les imatges pot filtrar originals d'esborranys a `_astro`;
no s'incorpora aquesta estratègia. La tasca no es declara completa.

### NB-05. Hubs, detall i navegació

Abast: dos hubs, detalls, selector d'idioma, grup d'esborranys, estats textuals i
navegació de mòbil/escriptori. Exclou portada, cerca, comentaris i paginació.
Resultat: lectura amb URL directa i descoberta des de la navegació.
Comprovacions: E2E públic/preview, teclat, idiomes i estats buits. Inclosa a la PR conjunta.

### NB-06. Metadades i descoberta

Abast: canonical, Open Graph, alternatives, sitemap, JSON-LD publicat i revisió
de `/llms.txt`. Exclou RSS, newsletter, índex del xat i Google News sitemap.
Resultat: descoberta només de variants publicades amb metadades coherents.
Comprovacions: parseig de sortides, dates, idiomes i serialització segura.
Inclosa a la PR conjunta.

### NB-07. Pilots i validació integrada

Abast: integrar pilots revisats com a esborranys, verificar l'entrega i actualitzar
documentació del comportament real. Exclou publicació dels articles sense
aprovació, merge i desplegament. Resultat: evidència integrada i contingut llest
per revisar. Comprovacions: `pnpm validate`, builds públic/preview, Lighthouse,
revisió manual/editorial i negatives de filtracions. Inclosa a la PR conjunta.

## Model de contingut

Fitxers `apps/web/src/content/posts/<id>.yaml`, identificador igual al nom del
fitxer. Camps desconeguts rebutjats. Constants tipades per als valors compartits.

- `id`, `type`, `published`, `slug`, `title`, `summary`, `lead`, `sections`,
  `author` i `createdAt` obligatoris. Textos i slug traduïbles, català obligatori.
- `sections` és una seqüència de cossos Markdown restringits amb encapçalament
  textual opcional traduïble. Pot ser buida per a una notícia que ja expliqui
  els fets a l'entradeta. No és un constructor de blocs ni admet HTML, MDX o H1.
- `author` té nom públic i tipus `person | organization`. Per decisió de la
  persona mantenidora, notícies i blog se signen `mountain runners`, amb tipus
  `organization`. No es creen perfils, comptes ni una col·lecció d'autors.
- `createdAt` és una data ISO de preparació. `publishedAt` és data/hora ISO amb
  offset i és obligatori per publicar. `updatedAt` és opcional, només per canvis
  materials. Una retirada pot conservar `publishedAt`.
- `cover` opcional, recurs local amb alt i crèdit traduïbles obligatoris quan hi
  ha coberta. Sense fotografia aprovada no es crea una coberta fictícia.
- `sources` opcional, llista limitada de fonts públiques amb nom traduïble i
  HTTPS. La informació directa del club pot atribuir-se al cos sense URL.
- `correction` opcional, data i nota traduïble per a rectificacions materials.
- `relatedEventIds` opcional, identificadors d'esdeveniments existents. Referència
  inexistent fa fallar; referència no publicada o incompleta no genera enllaç.
- `relatedPage` opcional, actualment només `members`, per relacionar una guia
  amb la informació vigent de socis. El component construeix l'enllaç localitzat.

`publishedAt` no pot ser anterior a `createdAt`; `updatedAt` no precedeix la
publicació, o la preparació si encara no hi ha publicació. Dates de publicació
futures d'entrades publicades es rebutgen segons `BUILD_TODAY` a Madrid.
No hi ha programació implícita. Les comparacions de timestamps respecten l'offset.

Una variant requereix slug, títol, resum, entradeta i totes les seccions completes
en el seu idioma. Encapsular un encapçalament traduïble opcional no el converteix
en un camp prescindible si existeix: sense traducció, aquella secció no és completa.
Coberta o rectificació opcionals incompletes s'ometen; fonts opcionals només es
mostren quan el nom està traduït. Sense fallback.

Els identificadors són únics a tota la col·lecció. Slugs únics per tipus i idioma:
una notícia i un blog poden compartir slug perquè tenen dominis diferents.
Publicats ordenats per instant de `publishedAt` descendent, amb `id` com a
desempat; esborranys separats i ordenats per `createdAt` descendent amb el mateix
desempat.

## Publicació i preview

La completesa de traducció és independent de la visibilitat editorial. El
catàleg públic no rep una excepció ambiental oculta. Les seleccions de posts
publicats i de preview són explícites i comparteixen validació sense duplicar-la.

Producció només selecciona `published: true`; preview pot seleccionar també
`false`. No canvia la visibilitat d'altres col·leccions. Invàlids fallen en tots
dos modes. Només `PUBLIC_PREVIEW=true` habilita el mode de preview, mai `DEV`,
`PROD` o el nom de branca. Els builds oficials comproven mode i origen, rebutgen
valors invàlids i no promocionen l'artefacte de preview a producció.

El preview mostra "Esborrany · No publicat a la web pública" o "Marcat per
publicar · Versió de preview" a cada entrada. Al detall d'esborrany s'explica
que el contingut pot canviar. Es manté `PreviewNotice`; l'estat no depèn de color.

Textos i recursos exclusius de variants no seleccionades queden fora de producció,
incloses les imatges transformades. No s'ubiquen assets d'esborrany a `public/`.
Recursos compartits amb contingut publicat no s'eliminen. Sitemap, JSON-LD i
sortides d'indexació no exposen esborranys; el selector de preview només enllaça
variants completes al mateix origen.

## Rutes, presentació i contingut editorial

Hubs `/ca/noticies/`, `/es/noticias/`, `/en/news/` i `/{locale}/blog/`.
Detalls `<hub>/<slug>/`, amb la mateixa ruta relativa en públic i preview.
Validar col·lisions amb dominis i segments reservats existents. Hubs amb estat
buit traduït, llistat complet estàtic i grup d'esborranys només al preview.

Pàgines primes, helpers purs i seccions propietàries de missatges i guards segons
ADR 0006. Reutilitzar layout, `PageSection` i tokens de `DESIGN.md`. Una H1,
encapçalaments H2 quan calgui, dates amb `<time>`, amplada de lectura limitada,
imatges locals i estats accessibles. Sense marcs buits quan no hi ha coberta.

La guia aplica exactitud, atribució, distinció de fets/opinions, rectificacions,
drets d'imatge i protecció de menors. Notícies amb fets principals primer;
blog amb estructura que respongui a la pregunta del lector. L'agent pregunta
quan falten fets i no inventa resultats, quotes, testimonis o fotografies.

La notícia pilot utilitza els fets confirmats del
[seu esborrany](../editorial/drafts/inauguracio-nou-local.md). La
[guia de socis](../editorial/drafts/com-fer-te-soci.md) descriu provisionalment
dues pantalles, dades personals i de pagament. No promet alta efectiva o cobrament;
la descripció s'ha de verificar abans de publicar. Enllaça a Socis amb el helper
de rutes, sense duplicar les condicions vigents.

## Estratègia de tests i qualitat

- Esquemes: camps requerits/desconeguts, tipus, autoria, dates, Markdown segur,
  paths locals i recursos. Dates amb offsets diferents i ordre cronològic real.
- Domini: identitats/slugs, referències inexistents, idiomes parcials, ordre
  estable i mateixa font seleccionada en públic/preview. Col·leccions existents
  conserven les seves negatives de publicació.
- Integració: fixtures publicades i esborranys, recursos exclusius/compartits,
  assets transformats, builds nets i preview seguit de públic. No admetre qualsevol
  ruta del build com a ruta esperada per fer passar el verificador.
- E2E: navegació, detalls, URL directa absent en públic, estats, idiomes i sense
  imatge. Selectors semàntics, mai classes CSS.
- Manual: fets, traduccions, autoria, drets, focus, teclat, zoom, jerarquia i
  contrast en mòbil/escriptori. Axe no acredita conformitat WCAG completa.
- Aplicar `quality-gate` a les pàgines; afegir notícia, blog i esborrany a la
  matriu representativa. `pnpm validate` al tancament, Lighthouse separat.

## Seguretat i privacitat

La persona mantenidora accepta que Git i previews són públics. Només esborranys
segurs de compartir; no secrets, consentiments, salut o embargaments privats.
Permisos i proves de drets d'imatge es custodien fora del repositori públic.
No es valida el formulari de socis amb dades personals o pagaments reals.

Mantenir autorització i frontera del publicador. Les proves de build prevenen
errors editorials, però no demostren que HTML arbitrari d'una PR sigui fiable.
La skill no és una frontera de permisos; l'assistent privat continua fora d'abast.

## Fora d'abast

CMS, backend, comptes, MDX, constructor de blocs, comentaris, cerca, categories,
paginació, portada, RSS, butlletins, cron, migració d'arxiu, assistent desplegat,
índex de xat, imatges generades i previews de despublicats d'altres col·leccions.
Cap canvi DNS, nou servei, commit, push, merge o desplegament no autoritzat.

## Criteris d'acceptació

1. Els dos pilots complets es poden llegir en preview amb `published: false`,
   sense duplicació ni canvi d'estat, i no tenen ruta pública.
2. Llistat i detall identifiquen l'esborrany, amb avís global de preview. Una
   entrada publicable no afirma que la mateixa versió ja sigui a producció.
3. Producció no conté textos, metadades ni recursos exclusius d'esborranys.
   Un build oficial públic rebutja mode preview i no conserva residus anteriors.
4. Variants publicades completes tenen ruta, autoria, dates i metadades coherents;
   variants parcials no fan fallback ni apareixen a alternatives.
5. Les col·leccions i rutes existents conserven comportament i filtratge.
6. Les plantilles i skill no inventen dades i deixen publicació a la revisió
   humana. Els pilots no es publiquen per haver-se integrat a una PR tècnica.
7. Hi ha evidència de model, builds, E2E, revisió manual/editorial i pressupostos
   aplicables. Validació local no es presenta com a desplegament remot.
