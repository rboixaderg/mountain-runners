# Pla de notícies, blog i previsualització editorial

## Estat

La investigació següent es conserva com a antecedent. La persona mantenidora ha
autoritzat començar la implementació el 2 d'octubre de 2026. La font de veritat
d'abast, tasques i acceptació és ara l'[especificació de notícies i blog](specs/news-and-blog.md),
amb l'[ADR 0011](decisions/0011-news-blog-editorial-previews.md). Les mencions a
decisions pendents d'aquest pla descriuen la preparació, no substitueixen la spec.

Proposta d'investigació i implementació del 2 d'octubre de 2026. No és una
especificació aprovada ni autoritza canvis de codi, serveis o desplegaments.
Respon a la necessitat del [backlog](backlog.md#avaluar-notícies-blog-i-estructures-editorials-reutilitzables).
No s'assigna un número de fase fins que se n'aprovi l'encaix al roadmap.

Interpretem "sense que estigui en estat de duplicat" com poder revisar una entrada
sense marcar-la com a publicada ni crear-ne una còpia. El model actual no té un
estat editorial `duplicat`. Si es vol detectar contingut duplicat, cal concretar
aquesta necessitat per separat. La unicitat d'identificadors i rutes sí que entra
en aquest pla.

La persona mantenidora ha aprovat permetre esborranys de notícies i blog en
preview i accepta que el contingut de Git públic i de les previews no és
confidencial. També assumeix la revisió editorial. La resta de recomanacions
continuen pendents d'aprovació formal a l'especificació. Els contractes acceptats
continuen vigents fins que es revisin explícitament.

## Objectiu

Publicar notícies del club i articles de blog amb una estructura coherent,
autoria, dates i fonts verificables. Poder revisar-los en una preview amb el seu
estat visible, mantenint producció limitada a contingut publicat i complet en
l'idioma de la ruta.

## Límits i decisions confirmades

Es mantenen Astro estàtic, Git com a font de veritat, YAML restringit, validació
estricta, tres idiomes i revisió per PR. No cal un CMS, una base de dades ni un
backend. Les fronteres són les dels ADR
[0001](decisions/0001-static-site-and-content-in-git.md),
[0004](decisions/0004-code-and-editorial-content-boundary.md) i
[0006](decisions/0006-presentation-layer-structure.md).

La infraestructura de previews existent manté autorització humana, branques
pròpies, origen separat de producció, retirada, caducitat i artefactes diferents.
No es promociona un artefacte de preview a producció. L'ADR
[0009](decisions/0009-pr-previews-same-domain-and-own-branches.md) exigeix canonical
del mateix origen de preview i instruccions de no-indexació.

El requisit nou canvia una frontera: la
[fase 6](specs/phase-6-pull-request-previews.md) exclou expressament
`published: false` també del build ordinari de preview. Cal una decisió explícita
i una esmena de l'especificació abans d'habilitar l'excepció editorial. Si la
revisió afecta una decisió acceptada, es documentarà amb un ADR; no es modificarà
la política silenciosament.

## Resultats esperats

1. Dos espais recognoscibles, Notícies i Blog, amb llistat i detall.
2. Un únic model compartit amb `type: news | blog`, sense contingut duplicat.
3. Esborranys navegables al preview sense canviar `published`.
4. Avís global de preview i estat explícit a cada entrada editorial del preview.
5. Absència de textos, rutes i recursos exclusius d'esborranys a producció.
6. Guia editorial, dues plantilles i una skill local que prepari contingut,
   però no pugui aprovar-lo, publicar-lo ni desplegar-lo.

## Dependències i ordre d'inici

Primer s'han de resoldre les decisions de producte i exposició dels esborranys.
Després s'aprovarà una especificació amb la
[convenció del projecte](specs/README.md) i les esmenes de publicació necessàries.
La implementació local pot avançar sense canvis d'infraestructura. La prova d'una
preview desplegada depèn del sistema de fase 6 operatiu i d'una autorització
explícita, no d'aquest pla.

La persona mantenidora farà la revisió editorial. Cal obtenir dos pilots aprovats,
una notícia i un article. No s'importarà l'arxiu de la web antiga en bloc.

Els temes dels pilots ja estan escollits:

- Notícia sobre la inauguració del nou local, en format de crònica d'un acte
  ja celebrat.
- Article de blog "Com fer-te soci o sòcia de Mountain Runners". Serà una guia
  explicativa que remeti a la pàgina de Socis i al procés d'alta vigent, sense
  convertir-se en una segona font de quotes, condicions o avantatges.

L'elecció dels temes no implica que els textos, les imatges o la publicació
estiguin aprovats. Tots dos es prepararan com a esborranys per a revisió.

Ja s'han preparat els primers textos:

- [Crònica de la inauguració](editorial/drafts/inauguracio-nou-local.md), celebrada
  el 26 de setembre de 2026 al local de la plaça de Sant Joan, número 15, de Berga, amb
  caminada a Queralt i piscolabis a la tornada. Falta rebre la
  fotografia amb autoria i permís d'ús.
- [Guia per fer-te soci o sòcia](editorial/drafts/com-fer-te-soci.md), amb dades
  personals a la primera pantalla i dades de pagament a la segona. La descripció
  del formulari és provisional i es validarà abans de publicar.

## Tasques, entregues i seguiment

Identificadors provisionals, sense atribuir-los a una fase aprovada. Cada tasca
té una PR dedicada i un worktree des de l'últim `main`. La planificació queda al
worktree principal. No es barregen refactors amb aquesta entrega.

| Tasca | Entrega                                     | Dependències       | Estat   |
| ----- | ------------------------------------------- | ------------------ | ------- |
| NB-01 | Decisions i especificació aprovada          | Validació del club | Pendent |
| NB-02 | Guia editorial, plantilles i skill local    | NB-01              | Pendent |
| NB-03 | Col·lecció, esquemes i selecció editorial   | NB-01              | Pendent |
| NB-04 | Recursos i builds públic/preview verificats | NB-03              | Pendent |
| NB-05 | Llistats, detall i navegació                | NB-02, NB-04       | Pendent |
| NB-06 | Metadades i descoberta pública              | NB-05              | Pendent |
| NB-07 | Pilots i validació final                    | NB-02 a NB-06      | Pendent |

### NB-01. Decisions i especificació

- Abast: aprovar arquitectura, rutes, dos estats, traduccions, exposició pública
  dels esborranys i propietat editorial. Revisar els documents de publicació.
- Exclusions: codi d'aplicació, desplegament i decisions sobre serveis nous.
- Resultat: especificació amb tasques, criteris observables i dependències.
- Comprovacions: enllaços, convenció de specs i coherència amb ADR i fase 6.

### NB-02. Guia, plantilles i skill

- Abast: guia catalana, plantilla de notícia, plantilla de blog i skill local.
  Reutilitzar `unslop`, `seo` i `accessibility` sense duplicar-ne les instruccions.
- Exclusions: instal·lació de skills externes sense revisió i redacció autònoma
  de fets que el club no hagi proporcionat o verificat.
- Resultat: una mateixa entrada es pot preparar amb estructura i criteris
  equivalents per una persona o un agent.
- Comprovacions: exercitar les dues plantilles, informació insuficient, fonts
  contradictòries i peticions de publicar sense autorització.

### NB-03. Model i catàlegs

- Abast: registrar `posts`, validar contingut i referències i implementar les
  variants publicables i les variants de preview amb polítiques separades.
- Exclusions: migrar `published` de les col·leccions actuals, enriquir el parser
  Markdown global o afegir un constructor genèric de pàgines.
- Resultat: producció només selecciona posts publicats; preview selecciona també
  esborranys complets. Les altres col·leccions no canvien de visibilitat.
- Comprovacions: esquemes, dates, idiomes, rutes, referències i matriu d'estats.

### NB-04. Recursos i artefactes

- Abast: vincular la còpia de recursos al catàleg seleccionat, adaptar les
  verificacions de sortida i provar els dos builds en directoris nets separats.
  Fer explícit el mode als entry points de producció i preview.
- Exclusions: canviar DNS, Caddy, credencials, l'accés o el publicador de previews.
- Resultat: el build de preview pot contenir recursos de posts esborrany;
  l'artefacte de producció no els conté ni accepta el mode preview.
- Comprovacions: detecció de filtracions, assets transformats, enllaços interns,
  modes invàlids, build de preview seguit de producció i contractes d'artefacte.

### NB-05. Pàgines i estats visibles

- Abast: hubs, detalls, navegació, seccions compartides, estat editorial i
  selector d'idioma. Reutilitzar layout, `PageSection` i tokens de disseny.
- Exclusions: cercador, comentaris, filtres complexos i redisseny global.
- Resultat: les entrades es descobreixen sense URL manual i els esborranys no
  poden confondre's amb publicacions públiques al preview.
- Comprovacions: E2E de llistat a detall, estats, teclat, mòbil i traduccions.

### NB-06. Metadades i descoberta

- Abast: canonical, alternatives, sitemap, Open Graph i JSON-LD d'articles
  publicats. Revisar `/llms.txt` per incorporar els nous apartats públics.
- Exclusions: RSS, sitemap de Google News, enviament de butlletins i índex del
  futur xat. Aquestes sortides reutilitzaran el catàleg públic quan existeixin.
- Resultat: cada idioma publicat té metadades coherents, sense esborranys a les
  sortides destinades a indexació.
- Comprovacions: parseig de metadades, URL, JSON-LD, dates i variants incompletes.

### NB-07. Pilots i tancament

- Abast: dos continguts reals revisats, traduccions aprovades si n'hi ha,
  validació integrada i evidència visual/editorial. Actualitzar model, arquitectura,
  documentació i backlog amb el resultat real.
- Exclusions: fer merge, publicar o desplegar des de la sessió d'un agent.
- Resultat: entrega revisable amb evidència de les dues modalitats de build.
- Comprovacions: `pnpm validate`, builds, comprovacions d'artefacte afectades,
  Lighthouse i revisió editorial/manual. Activació remota només autoritzada.

## Diagnòstic del repositori

| Peça actual                                                             | Implicació                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/content.config.ts`                                        | No existeix col·lecció de notícies o blog.                                                                          |
| `src/lib/content/publication.ts`                                        | `published` participa en les comprovacions de completesa; no n'hi ha prou amb afegir un filtre a la pàgina.         |
| `src/lib/content/repository.ts`                                         | Centralitza lectura, validació de recursos i construcció del catàleg. Cal preservar aquest punt d'entrada.          |
| `src/lib/content/routes.ts`                                             | Els dominis, tipus de detall, alternatives i sitemap coneixen només escoles i esdeveniments.                        |
| `src/lib/content/markdown.ts`                                           | Admet paràgrafs, èmfasi, llistes i HTTPS, però no encapçalaments, imatges ni blockquotes.                           |
| `src/layouts/PublicLayout.astro`                                        | Ja mostra `PreviewNotice` i `noindex` amb `PUBLIC_PREVIEW=true`. No informa de l'estat d'una entrada.               |
| `apps/web/scripts/verify-i18n-output.mjs`                               | L'inventari actual de rutes i sitemap és explícit. Cal incorporar els posts sense eliminar comprovacions existents. |
| `tools/release/build-artifact.mjs` i `tools/preview/build-artifact.mjs` | Hi ha entry points diferents; el mode editorial ha de quedar inequívoc abans del build.                             |

Les rutes de la taula que comencen per `src/` són relatives a `apps/web/`.
Algunes introduccions de README i arquitectura encara descriuen previews com a
futurs, però ja hi ha codi i tasques de fase 6 completades. L'existència d'aquest
codi no demostra l'activació remota ni el tancament operatiu de la fase.

La documentació d'Astro proposa filtrar drafts amb `import.meta.env.PROD`. Aquí
no és suficient: una preview desplegada també és un build de producció d'Astro.
La política ha de dependre del mode explícit de preview, no de `DEV` o `PROD`.

## Arquitectura recomanada i alternatives

### Una col·lecció, dos tipus i dos apartats

Recomanem `posts` amb `type: news | blog`. Comparteixen identitat, traduccions,
autoria, publicació, imatges i render segur. El tipus determina el hub, la ruta,
la plantilla editorial i el tipus de dades estructurades.

- Notícia: què ha passat o què anuncia el club. Fets datats, resum ràpid i
  informació ordenada per importància.
- Blog: coneixement, experiències, entrevistes o reflexions amb una utilitat
  clara. Pot tenir veu personal; les opinions no es presenten com a fets.

Dos models independents duplicarien ara gairebé tots els camps i comprovacions.
Un únic hub indiferenciat, en canvi, amagaria la diferència editorial.
Una col·lecció compartida no obliga a un component gegant amb condicions per a
cada tipus: les peces comunes es comparteixen quan hi ha la segona ocurrència.

MDX o un CMS extern facilitarien formats més lliures, però afegirien execució,
permisos o dependències que el projecte no necessita. Markdown lliure amb
frontmatter també canviaria el contracte YAML. Es descarten per a aquesta entrega.

### Dos estats, sense dues fonts de veritat

Conservar `published: boolean`, igual que la resta del projecte:

| Valor   | Estat visible en preview                 | Producció                        |
| ------- | ---------------------------------------- | -------------------------------- |
| `false` | Esborrany · No publicat a la web pública | No genera ruta ni contingut      |
| `true`  | Marcat per publicar · Versió de preview  | Genera la variant si és completa |

No afegir alhora `status: published` i `published: true`. Tampoc estats de
"duplicat", "programat" o "aprovat" sense una necessitat real. La revisió i
l'aprovació queden a la PR. Si el club necessita distingir "En revisió" a la web,
caldrà aprovar un enum que substitueixi el booleà en posts, no que el dupliqui.

`published: true` en una branca no prova que aquella versió ja sigui a producció.
Per això el preview no dirà simplement "Publicat a la web pública". Comparar
automàticament revisions amb producció és fora d'abast.

## Model de contingut proposat

Un fitxer `apps/web/src/content/posts/<id>.yaml` per entrada. Esquema estricte,
identificador igual al nom del fitxer i reutilització de primitives existents.

| Camp                               | Contracte inicial                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                               | Identitat estable, independent de l'idioma i del títol.                                                                                                                              |
| `type`                             | `news` o `blog`, valors tipats en una constant compartida.                                                                                                                           |
| `published`                        | Obligatori, sense valor predeterminat que publiqui per accident.                                                                                                                     |
| `slug`, `title`, `summary`, `lead` | Traduïbles; català obligatori. `summary` serveix al llistat, `lead` és l'entrada del detall.                                                                                         |
| `sections`                         | Array ordenat de seccions amb `heading` opcional i `body` traduïbles. Markdown restringit al cos; el component genera els H2 quan hi ha encapçalament.                               |
| `author`                           | Nom públic i tipus `person` o `organization`. Notícies poden signar-se com a club; blog amb persona responsable identificada. Sense correu privat ni col·lecció d'autors anticipada. |
| `createdAt`                        | Data editorial ISO de preparació, per ordenar esborranys. No és una data de publicació.                                                                                              |
| `publishedAt`                      | Data/hora ISO amb offset, obligatòria si `published: true`; absent en esborrany inicial. Es conserva si es retira una entrada abans publicada.                                       |
| `updatedAt`                        | Opcional, canvi editorial material. No es regenera per build ni per corregir un espai.                                                                                               |
| `cover`                            | Opcional, imatge local amb alt traduït i crèdit. No s'obliga a inventar una foto.                                                                                                    |
| `sources`                          | Fonts públiques amb nom traduïble i URL HTTPS. Pot ser buit si és informació directa del club, que s'ha d'atribuir al text.                                                          |
| `correction`                       | Nota traduïble opcional per a rectificacions materials, amb data.                                                                                                                    |
| `relatedEventIds`                  | Referències opcionals a esdeveniments; els enllaços es construeixen en codi.                                                                                                         |

No introduir categories, etiquetes, destacats, galeries, vídeos, perfils d'autor
ni múltiples tipus de bloc fins que els pilots en demostrin una necessitat.
Un resum o una entradeta diferent no constitueixen còpies de l'article.

### Estructura segura de text

La seqüència `lead` i seccions d'article és un model editorial específic, no un
constructor de pàgines. La plantilla continua controlant autoria, dates, coberta,
cos, fonts i rectificacions. Els encapçalaments són text pla; el cos passa pel
parser restringit existent. No cal ampliar els nodes Markdown globals per tenir H2.

Les seccions han de permetre una notícia breu sense subtítols artificials. Es
pot admetre una primera secció sense `heading`; la resta de subtítols són
opcionals segons el contingut, mantenint una jerarquia H1/H2 correcta. El contracte
exacte s'ha de provar amb els dos pilots abans de tancar NB-01.

La completesa transitiva exigeix tots els camps obligatoris i totes les seccions
en l'idioma seleccionat. Una traducció parcial no renderitza fragments catalans.
Una coberta opcional sense alt o crèdit traduïts s'omet en aquell idioma, igual
que altres camps opcionals no complets. Els recursos que només pertanyen a una
variant omesa no s'han de copiar per aquella variant.

### Dates, ordenació i retirada

- Publicats ordenats per `publishedAt` descendent, amb `id` com a desempat.
- En preview, esborranys en un grup propi ordenat per `createdAt` descendent.
- Dates llegibles segons idioma i `Europe/Madrid`, mitjançant helpers purs.
  Dates semàntiques amb `<time datetime>`.
- `updatedAt` no pot precedir la primera publicació quan existeix. Dates de
  publicació futures es rebutgen per als posts publicats amb referència a la
  data de build. No hi ha publicació programada ni cron implícit.
- Retirar una entrada amb `published: false` elimina la ruta en el següent
  build públic. No es generen redireccions ni pàgines que en revelin el títol.
  Un canvi de slug publicat requereix decidir la redirecció o conservar-lo.
- Corregir text no altera `publishedAt`; un canvi material actualitza
  `updatedAt` i, si escau, la nota de rectificació.

## Contracte de producció i preview

Separar tres preguntes en domini: és una entrada vàlida, és una variant completa,
i és visible en aquest build? No posar excepcions disperses a les pàgines.

El catàleg públic manté el nom i la garantia actuals. La selecció de preview
s'afegeix de forma explícita per a posts; no es farà que una funció anomenada
`getPublicationCatalog` retorni esborranys segons una variable oculta.
La càrrega i validació de la font es comparteixen sense crear una capa de
configuració genèrica. La forma exacta dels tipus es decideix a NB-03.

| Entrada                              | Build públic     | Build de preview                          |
| ------------------------------------ | ---------------- | ----------------------------------------- |
| Post publicat i complet              | Detall i llistat | Detall i llistat, marcat per publicar     |
| Post esborrany i complet             | Absent           | Detall i grup d'esborranys, avís explícit |
| Variant `es` o `en` incompleta       | No es genera     | No es genera, diagnòstic d'idioma         |
| YAML, recurs o referència invàlids   | Build falla      | Build falla                               |
| Escola, event o document no publicat | Absent           | Continua absent                           |

Els esborranys han de tenir almenys una variant catalana vàlida per entrar al
preview. No es permeten placeholders publicables ni relaxar la seguretat perquè
un text estigui en preparació. La falta d'idiomes opcionals s'explica amb un
diagnòstic de validació, no amb una ruta falsa.

### Mode de build i defensa contra errors

Reutilitzar `PUBLIC_PREVIEW=true` com a mode explícit, sense afegir una segona
bandera editorial independent. El mode absent o `false` selecciona publicació
ordinària; valors mal formats fallen. Els entry points oficials fixen o
comproven el mode i l'origen abans de construir:

- Producció rebutja `PUBLIC_PREVIEW=true` i comprova l'origen de producció.
- Preview exigeix `PUBLIC_PREVIEW=true` i l'origen assignat a la PR.
- Ni el nom de branca, ni `NODE_ENV`, ni `import.meta.env.PROD` concedeixen
  visibilitat d'esborranys.
- Cada artefacte es genera amb sortida neta. Una execució prèvia de preview no
  pot deixar rutes o imatges residuals al següent build de producció.

Això prevé errors operatius; no converteix el codi d'una PR en codi fiable.
La verificació de l'artefacte i el publicador de confiança continuen vigents.

### Recursos i sortides auxiliars

No desar imatges d'esborrany a `public/`, que es copia sense filtre. Utilitzar
els paths locals validats dins `src/assets/` o `src/content-assets/` i auditar
tant els recursos copiats com les imatges optimitzades a `_astro/`.

La sortida pública no pot contenir un recurs exclusiu d'un post esborrany.
Un recurs compartit amb contingut publicat és legítim i no s'elimina. El collector
ha de treballar sobre els camps realment renderitzats per cada variant, no només
recórrer cegament tota l'entrada amb totes les traduccions opcionals.

Sitemap, metadades públiques i `/llms.txt` parteixen del catàleg públic. El sitemap
del preview pot conservar les rutes publicades al seu origen, però no incorpora
esborranys. El selector d'idioma del detall de preview sí que pot enllaçar altres
variants completes d'aquell esborrany al mateix origen. No s'emet JSON-LD
`NewsArticle` o `BlogPosting` per presentar un esborrany com a publicació.
RSS, índex del xat o exportacions futures no poden reutilitzar el catàleg de
preview per defecte.

## Rutes, navegació i disseny

| Tipus    | Català          | Castellà        | Anglès          |
| -------- | --------------- | --------------- | --------------- |
| Notícies | `/ca/noticies/` | `/es/noticias/` | `/en/news/`     |
| Blog     | `/ca/blog/`     | `/es/blog/`     | `/en/blog/`     |
| Detall   | `<hub>/<slug>/` | `<hub>/<slug>/` | `<hub>/<slug>/` |

Mateixa ruta relativa en producció i preview, amb origen diferent. No hi ha
`/draft/` ni duplicació d'entrades. Slugs únics per tipus i idioma, amb validació
de col·lisions contra segments reservats, hubs, paginació i rutes fixes.

Els hubs tenen missatges traduïts i un estat buit honest. Inicialment llistat
estàtic complet; no hi ha scroll infinit. Si l'inventari inicial exigeix
paginació, s'ha d'aprovar a NB-01 amb un llindar, mida de pàgina i rutes reservades.
No s'anticipa amb un sistema de filtres.

Afegir Notícies i Blog a la navegació de manera coherent en mòbil i escriptori,
sense amagar escoles, agenda o serveis del club. No afegir un segon hub
"Actualitat" que dupliqui els dos llistats. La portada no canvia en aquesta
entrega; un bloc de darreres notícies es pot planificar després.

Llistats editorials amb titular, resum, data, autoria i imatge quan n'hi ha.
Detall amb una única H1, entradeta, metadades, coberta opcional, cos, fonts i
rectificacions. Fons clar, amplada de lectura limitada i tokens de `DESIGN.md`,
sense carrusels ni targetes comercials repetitives. Sense imatge, no es deixa un
marc buit ni es substitueix per fotografia genèrica.

En preview es conserva `PreviewNotice` al layout i s'afegeix:

- Etiqueta textual d'estat a totes les entrades de llistat.
- Avís a l'inici del detall d'esborrany: "Esborrany. Aquest contingut no està
  publicat a la web pública i pot canviar".
- Identificació del post publicable: "Marcat per publicar. Estàs veient una
  versió de preview".
- Grup d'esborranys separat, sense fer-los passar per les darreres publicacions.

L'estat no depèn només del color ni necessita JavaScript. Tots els missatges
viuen als recursos de traducció. Les pàgines són primes; dates i decisions de
presentació van a `src/lib/presentation/`, sense imports d'Astro o Paraglide.

## Criteris editorials i fonts investigades

No existeix un únic estàndard que obligui totes les notícies i blogs a tenir el
mateix índex. Hi ha convencions de redacció i principis ètics. La proposta combina
aquests criteris amb una guia pròpia del club, sense copiar manuals aliens.

Fonts consultades el 2 d'octubre de 2026:

| Font                                                                                                                                                  | Què aporta al pla                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Codi Deontològic del periodisme català](https://www.periodistes.cat/collegi/codi-deontologic), versió de novembre de 2025                            | Precisió, distinció entre informació i opinió, fonts, rectificació, privacitat, menors i tractament de la IA. Referència de bones pràctiques, no afirmació que el club sigui un mitjà periodístic professional. |
| [Reuters, Standards and Values](https://reutersagency.com/about/standards-values)                                                                     | Exactitud abans que rapidesa, atribució honesta i correccions transparents.                                                                                                                                     |
| [Purdue OWL, The inverted pyramid](https://owl.purdue.edu/owl/subject_specific_writing/journalism_and_journalistic_writing/the_inverted_pyramid.html) | Fets principals al principi i detalls per ordre d'importància; també explica les limitacions per a narracions.                                                                                                  |
| [Unió Europea, The inverted pyramid](https://data.europa.eu/apps/data-visualisation-guide/the-inverted-pyramid)                                       | Qui, què, quan, on i per què com a comprovació de cobertura informativa.                                                                                                                                        |
| [Google Search Central, Article](https://developers.google.com/search/docs/appearance/structured-data/article)                                        | Metadades d'Article, NewsArticle i BlogPosting, autoria, titulars, imatges i dates coherents amb la pàgina. No garanteixen indexació ni rich results.                                                           |
| [Astro, Content collections](https://docs.astro.build/en/guides/content-collections/)                                                                 | Generació estàtica amb `getStaticPaths` i filtratge de drafts; cal adaptar el filtre al preview explícit del projecte. Consultat també amb Context7.                                                            |

### Plantilla de notícia

1. Titular factual que expliqui el fet, sense pescaclics ni superlatius gratuïts.
2. Resum breu que aporti informació i no repeteixi literalment el titular.
3. Entradeta amb el fet principal i qui, quan i on. El perquè i el com s'hi
   incorporen quan són rellevants i coneguts; no s'inventen per omplir camps.
4. Desenvolupament amb dades, context i conseqüències, en ordre d'importància.
5. Declaracions només si existeixen i estan verificades, amb atribució.
6. Informació pràctica o enllaç a la fitxa d'esdeveniment quan sigui pertinent.
7. Fonts, autoria, data i crèdits. Rectificació visible si cal.

Per a una crònica esportiva, comprovar prova i edició, lloc i data, categoria,
distància, desnivell i resultats abans de publicar-los. Prioritzar l'experiència
del club, no només podis. No fer que una notícia esdevingui una segona agenda:
inscripcions i dades vigents remeten a la fitxa autoritativa de l'esdeveniment.

### Plantilla de blog

1. Títol específic, lector destinatari i pregunta o experiència central.
2. Entradeta que expliqui què aporta el text.
3. Seccions amb subtítols informatius i una idea principal per secció.
4. Exemples reals, fonts i límits de les afirmacions.
5. Tancament útil; no un resum mecànic ni una crida comercial obligatòria.
6. Autoria personal, dates, crèdits i fonts quan corresponen.

No imposar la piràmide invertida a una entrevista o narració d'experiència.
Homogeneïtat significa dades, jerarquia i criteris compartits, no textos idèntics.
Consells de salut, nutrició o seguretat de muntanya requereixen revisió competent;
un avís genèric no substitueix aquesta revisió.

### Guia d'estil local

- Català natural i revisió humana. Terminologia esportiva coherent, topònims
  oficials, noms propis respectats i dates absolutes quan el text ha de perdurar.
- Unitat i context a les xifres. No confondre distància, desnivell o classificació.
- Paràgrafs breus, verbs concrets i enllaços descriptius. Sense llenguatge
  publicitari, conclusions buides o titulars tot en majúscules.
- Separar fets, opinions i comunicació institucional. Reconèixer que el club
  parla de les seves activitats; no simular independència periodística.
- No fabricar testimonis, quotes, resultats, fonts ni experiències en primera
  persona. Si falta informació, l'agent pregunta i manté el text en esborrany.
- Fotografia documental real amb autoria i drets revisats. No generar una imatge
  realista que faci passar un fet inexistent per notícia.
- Revisar noms i imatges de menors, salut i altres dades personals abans de
  pujar-los al repositori. El permís i la seva prova es custodien fora del Git públic.
- Les traduccions conserven noms, xifres, dates, sentit i fonts. Sense traducció
  automàtica no revisada ni fallback encobert.

Les llargades són orientacions editorials a definir amb els pilots, no límits
periodístics universals ni comprovacions que premiïn afegir farciment. Els límits
tècnics de mida i complexitat sí que són obligatoris.

## Skills investigades i proposta local

La cerca web ha localitzat i permès llegir aquestes candidates. Les cerques CLI
`skills find` de "news writing", "content research writer" i "blog writing"
no han retornat coincidències en aquesta sessió; això no prova que no existeixin.
No s'ha instal·lat cap skill externa.

| Candidata                                                                                                                      | Valoració                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ComposioHQ, content-research-writer](https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer) | Bon flux de recerca, esquema, citacions i revisió. No imposa periodisme ni YAML, i els exemples de xifres no són fonts verificades reutilitzables. Referència útil, pendent de revisió de llicència i revisió fixada. |
| [getsentry, blog-writing-guide](https://skills.sh/getsentry/skills/blog-writing-guide)                                         | Claredat, titulars específics i evitar farciment. Està explícitament pensada per Sentry i públic desenvolupador; les normes de sarcasme, SEO, FAQ i signatura no s'adopten automàticament.                            |
| [technical-blog-writing](https://www.skills.sh/skills-101/superpowers/technical-blog-writing)                                  | Orientada a desenvolupadors i amb requeriments d'una CLI/servei extern. No encaixa com a dependència del flux del club.                                                                                               |
| [blog-post-creator](https://www.skills.sh/veermuchandi/rad-skills/blog-post-creator)                                           | Anuncis comercials de productes d'IA i imatges generades obligatòries. Descartada per to i ús d'imatges incompatibles amb el projecte.                                                                                |

La lectura completa s'ha pogut fer per a `content-research-writer` i
`blog-writing-guide`; per a les altres, la valoració es limita a les instruccions
visibles al catàleg. No és una auditoria completa de seguretat de cap paquet.
La popularitat o un segell del catàleg no substitueixen revisió pròpia.

Recomanem escriure una skill pròpia `mountain-runners-editorial` a
`.agents/skills/`, amb instruccions en anglès i resultats en català. Referenciarà
una guia catalana i dues plantilles fora de les col·leccions, per exemple a
`docs/editorial/`. Un únic punt d'entrada és suficient per als dos tipus.

Flux de la skill:

1. Identificar notícia o blog, públic destinatari i fets disponibles.
2. Demanar les dades que falten. Reunir fonts públiques i registrar-ne la
   procedència sense enviar informació privada a eines externes.
3. Proposar l'esquema corresponent i preparar el YAML amb `published: false`.
4. Revisar exactitud, drets d'imatge, estructura i llengua amb la guia i `unslop`.
5. Preparar traduccions només si s'han demanat i fer-les revisar.
6. Executar les validacions permeses i lliurar el diff i les qüestions pendents.
7. Sol·licitar revisió humana. Ni posar `published: true`, ni fer commit, ni
   push, ni obrir PR o activar preview sense l'autorització que correspongui.

Els límits d'un futur assistent editorial han de ser enforceables amb permisos
i scripts, no només amb una skill. La skill no és una frontera de seguretat.
No s'implementa el servei d'assistent en aquesta entrega.

Si s'adopta una skill externa, seguir la
[revisió portable del projecte](phase-2-portable-skills-review.md): repositori
canònic, commit fixat, llicència compatible, lectura completa, hashes i
atribucions. No fer una instal·lació global no fixada ni copiar manuals amb
restriccions de reutilització.

## Metadades i SEO

- Canonical i Open Graph amb l'origen del build. En preview, mai canonical de
  producció per a una ruta d'esborrany.
- `hreflang` públic només entre variants realment publicades i completes.
- `NewsArticle` per a notícies, `BlogPosting` per a blog, autoria `Person` o
  `Organization` segons la signatura, i club com a editor.
- Titular, descripció, idioma, URL i dates coherents amb el text visible.
  `dateModified` només quan existeix una actualització material; sense dates
  artificials. Imatge només si hi ha coberta aprovada.
- JSON-LD serialitzat de forma segura dins HTML, sense interpolació de text
  editorial com a codi i amb proves de caràcters que puguin tancar el script.
- Sense pressupostar elegibilitat a Google News, Discover o resultats enriquits.
- Preview manté `robots.txt` restrictiu, meta robots i `X-Robots-Tag` servit
  per infraestructura. Les etiquetes socials no poden actuar com a promesa de
  confidencialitat ni de publicació real.

## Estratègia de tests i qualitat

### Unitàries i model

Cobrir explícitament els casos diferents, sense repetir el mateix test en cada
capa:

- Tipus i estat requerits, camps desconeguts, dates invàlides i dates futures.
- Identificadors duplicats, slugs per tipus/idioma i col·lisions amb hubs.
- Completesa de titular, slug, entradeta, seccions i camps opcionals.
- Esborrany visible només en catàleg de preview; col·leccions actuals invariants.
- Referències inexistents fallen; referències existents no publicades o sense
  idioma complet no produeixen enllaços, sense fallback.
- HTML cru, nodes Markdown no permesos, URL insegures, paths que escapen,
  symlinks i límits de mida continuen rebutjats.
- Ordenació estable, dates de presentació i conversió segura a text pla.

### Integració de build i artefacte

Utilitzar fixtures identificables fora del contingut real: un post publicat,
un esborrany amb recurs exclusiu, un recurs compartit i una traducció incompleta.
Les fixtures no es publiquen com a notícies reals.

Construir producció i preview amb la mateixa font i data editorial, en sortides
netes. Comprovar rutes, HTML, assets originals i transformats, sitemap,
alternatives, `/llms.txt` i qualsevol JSON generat. Fer també preview seguit de
producció per detectar contaminació de sortida. Una comprovació negativa no es
pot limitar a veure que no hi ha un enllaç al menú.

Adaptar l'inventari explícit del verificador per admetre les rutes editorials
esperades del conjunt de prova, sense convertir qualsevol ruta present en una
ruta aprovada. Conservar les negatives existents d'escoles i esdeveniments.
El recompte històric de 66 rutes deixarà de ser una invariant del producte.

### E2E i revisió manual

- Llistat a detall per a notícia i blog; URL directa d'esborrany absent a públic.
- En preview, avís global i estat per entrada, inclòs el post publicable.
- Idioma incomplet absent del selector; no hi ha rutes inventades.
- Estats buits, article sense coberta, títol llarg i contingut extens.
- Tests amb rols, noms accessibles, text i relacions semàntiques, no classes CSS.
- Teclat, focus, zoom, contrast, jerarquia, alt i amplada de lectura en mòbil i
  escriptori. Axe no certifica conformitat WCAG completa.
- Revisió de fets, fonts, drets, equivalència de traduccions i rectificacions
  per la persona editorial designada.

Durant implementació, carregar `quality-gate` i aplicar les rutes, viewports,
pressupostos i llindars vigents. Ampliar la matriu representativa amb notícia,
blog i esborrany de preview. Executar els checks mínims de cada PR i
`pnpm validate` al tancament. Lighthouse és una auditoria separada, no una
conseqüència de `pnpm validate`.

Aquest pla només requereix format, revisió de paths, enllaços i coherència
documental. No s'ha validat encara una implementació que no existeix.

## Seguretat i privacitat

Una preview accessible per URL no és privada. `noindex`, un subdomini efímer o
un estat "Esborrany" no impedeixen llegir, copiar, compartir o capturar-ne el text.
Git és públic: el mateix YAML ja es pot llegir abans que es publiqui a la web.

Per tant, aquest model només serveix per a esborranys segurs de compartir
públicament, encara pendents d'aprovació editorial. No serveix per a embargaments,
informació confidencial, dades sanitàries, documents de consentiment ni secrets.
Si el club necessita revisar material realment privat, cal un magatzem privat i
una política d'accés nova; protegir només el subdomini no protegeix Git públic.

La petició de preview autoritza l'exposició dels esborranys inclosos en aquell
commit. Aquest advertiment ha de constar al flux editorial. Caducitat i revocació
no retiren còpies que una tercera persona ja n'hagi fet.

No es modifica l'aïllament de producció, el límit a branques pròpies, la revisió
humana ni la garantia de l'artefacte. No es creen serveis, integracions de
publicació, cookies o permisos nous. Els recursos editorials continuen passant
les validacions de confiança existents.

## Fora d'abast

CMS, comptes d'autors, editor WYSIWYG, MDX, comentaris, cerca, likes, compartició
automàtica, RSS, newsletter, cron de publicació, migració massiva d'arxiu,
generació d'imatges documentals, índex del xat i assistent editorial desplegat.
També queda fora d'abast mostrar esborranys d'escoles, agenda o documents.

## Criteris d'acceptació

1. Una notícia i un blog `published: false`, complets en català, es poden llegir
   en preview al hub i per URL directa sense duplicar fitxers ni alterar-ne l'estat.
2. Les dues entrades mostren "Esborrany" al llistat i avís de no-publicació al
   detall. El layout manté l'avís de preview i les instruccions de no-indexació.
3. Producció no conté les rutes, textos o recursos exclusius d'aquests esborranys,
   ni en metadades o altres sortides auxiliars. No es permet un build oficial de
   producció en mode preview.
4. Marcar una entrada com a publicada, validar-la i fer-la passar pel flux humà
   de PR permet que el següent build públic generi només els idiomes complets.
5. Un post publicable en preview no afirma que la mateixa versió ja sigui pública.
6. Les col·leccions actuals conserven el seu filtratge i les rutes existents no
   canvien. No apareixen esborranys d'altres dominis.
7. Guia, plantilles i skill produeixen estructura coherent i no inventen dades,
   cites ni fotografies. Un revisor humà continua decidint la publicació.
8. Hi ha evidència de proves de model, builds negatius/positius, E2E, accessibilitat
   i revisió editorial. No es declara desplegada una funcionalitat només validada
   localment.

## Decisions que falten abans d'aprovar l'especificació

| Decisió                      | Recomanació                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Significat de "duplicat"     | Confirmar que es vol dir no haver de publicar ni duplicar l'entrada per revisar-la.                                  |
| Dos apartats o un únic espai | Dos hubs, Notícies i Blog, sobre una col·lecció compartida.                                                          |
| Estats                       | `published: false/true`, revisió a la PR. Enum només si cal mostrar "En revisió".                                    |
| Exposició dels esborranys    | Aprovat: només material segur de compartir públicament. Falta formalitzar l'esmena del contracte de preview.         |
| Autoria i aprovació          | Revisió editorial assumida per la persona mantenidora. Falta confirmar club o persona en notícies i persona en blog. |
| Idiomes                      | Català obligatori; publicar `es` i `en` de manera independent quan siguin complets i revisats.                       |
| Estructura del cos           | Seccions específiques amb Markdown restringit, provades amb dos pilots.                                              |
| Inventari inicial            | Dos pilots, sense migració massiva ni paginació anticipada.                                                          |
| Prioritat                    | Vincular a backlog fins que s'aprovi com a fase o funcionalitat; no ampliar una tasca activa de fase 6.              |

El següent pas és validar aquestes decisions amb el club i transformar aquest
pla en una especificació aprovada. La recomanació tècnica es pot implementar
sense afegir dependències de runtime ni cap servei nou.
