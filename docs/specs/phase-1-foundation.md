# Especificació De La Fase 1: Base Executable I Qualitat

## Estat

Preparada per convertir-se en issues i implementar-se.

## Objectiu

Crear la base executable de la web com un monorepo lleuger, amb Astro, contingut
estructurat multiidioma i controls de qualitat i seguretat actius des del primer
canvi de codi.

La fase ha de produir una base fiable per construir les pàgines públiques, però
no ha d'implementar encara el disseny final, migrar el contingut actual ni
desplegar a producció.

## Resultats Esperats

- Monorepo pnpm reproduïble amb l'aplicació Astro a `apps/web`.
- Web estàtica mínima que compila sense errors i no necessita secrets.
- Content Collections tipades i validades amb Zod.
- Models base per al lloc, pàgines, escoles, esdeveniments, entitats i documents.
- Routing i18n natiu d'Astro amb prefix obligatori per a tots els idiomes.
- Paraglide JS 2 per als missatges d'interfície tipats.
- Contingut editorial en YAML restringit, amb català obligatori i castellà i
  anglès opcionals.
- Format, lint, tests, typecheck, validació de contingut i build executables
  localment i a GitHub Actions.
- Hooks locals i proteccions remotes coherents amb Conventional Commits.
- Controls inicials de secrets, dependències i anàlisi estàtica.

## Pla D'Entrega I Seguiment

La fase s'implementa en quatre pull requests seqüencials. Cada PR parteix de la
branca principal després de fusionar l'anterior i s'obre com a draft des del
primer commit.

| PR                             | Estat   | Resultat                                                                      | Enllaç                                                         |
| ------------------------------ | ------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Base executable i qualitat  | En curs | Monorepo, Astro, Tailwind, validacions locals, hooks i CI de seguretat        | [PR #1](https://github.com/rboixaderg/mountain-runners/pull/1) |
| 2. Infraestructura multiidioma | Pendent | I18n natiu, prefixes, Paraglide i tests de routing                            | -                                                              |
| 3. Nucli editorial segur       | Pendent | YAML restringit, primitives Zod, Markdown, URL, slugs i recursos              | -                                                              |
| 4. Models i publicació         | Pendent | Sis col·leccions, rutes editorials, publicació, fixtures i documentació final | -                                                              |

Els únics estats permesos són `Pendent`, `En curs`, `Bloquejada` i `Completada`.
En començar una PR, s'actualitza la seva fila a `En curs` i s'hi afegeix
l'enllaç. En fusionar-la, passa a `Completada`. No es marca una PR com a
completada basant-se només en codi escrit: ha d'estar revisada, validada i
fusionada.

La descripció de cada draft PR ha d'incloure:

- Enllaç a aquesta especificació.
- Checklist del seu abast i criteris d'acceptació.
- Comprovacions executades i resultats.
- Impacte de seguretat, contingut o arquitectura.
- Decisions pendents i seguiments que quedin fora de la PR.

Els commits dins de cada PR han de ser petits, semàntics i deixar el repositori
en un estat coherent sempre que sigui possible. La PR es fusiona amb squash i
un títol compatible amb Conventional Commits.

### PR 1: Base Executable I Qualitat

- Configurar pnpm workspaces i versions fixades.
- Crear l'aplicació Astro estàtica a `apps/web` i integrar Tailwind.
- Afegir format, lint, typecheck, Vitest, build i `pnpm validate`.
- Afegir hooks locals i validació de Conventional Commits.
- Afegir workflows de qualitat i seguretat i Dependabot.
- Activar la protecció de branca quan els checks existeixin després de la fusió.

**Límit:** no inclou i18n, Paraglide ni models editorials.

**Resultat verificable:** una web Astro mínima compila i qualsevol PR posterior
queda sotmesa a `pnpm validate` i als controls de CI.

### PR 2: Infraestructura Multiidioma

- Configurar l'i18n natiu d'Astro i els prefixes `/ca/`, `/es/` i `/en/`.
- Redirigir `/` a `/ca/`.
- Integrar Paraglide JS 2 i els catàlegs de missatges.
- Sincronitzar l'idioma de Paraglide amb la ruta d'Astro.
- Afegir tests de routing, catàlegs i generació determinista.

**Límit:** utilitza pàgines mínimes de prova; no genera encara rutes des de
Content Collections ni defineix schemas editorials.

**Resultat verificable:** `/` redirigeix a `/ca/`, les tres rutes mínimes
renderitzen els missatges correctes i la locale de la URL governa Paraglide.

### PR 3: Nucli Editorial Segur

- Configurar el parser i lint de YAML restringit.
- Implementar primitives Zod per a idiomes, slugs, URL i recursos.
- Implementar Markdown restringit i render segur.
- Definir primitives reutilitzables per comprovar la completesa d'un valor
  traduïble i la seguretat d'un recurs.
- Cobrir els contractes i casos de seguretat amb Vitest.

**Límit:** no registra les sis col·leccions, no resol referències entre models i
no decideix si una pàgina editorial concreta es publica.

**Resultat verificable:** les primitives accepten casos vàlids i rebutgen YAML,
Markdown, slugs, URL, recursos i traduccions insegurs o incomplets.

### PR 4: Models I Publicació

- Implementar `site`, `pages`, `schools`, `events`, `entities` i `documents`.
- Implementar edicions embegudes, referències i filtratge `published`.
- Aplicar la completesa de traduccions de manera transitiva a blocs i referències.
- Generar les rutes editorials localitzades a partir de les col·leccions.
- Afegir fixtures mínimes vàlides i invàlides.
- Verificar que contingut i recursos despublicats no arriben al build.
- Actualitzar documentació, executar la checklist final i marcar la fase com a
  completada.

**Límit:** no implementa les plantilles visuals finals ni migra contingut de la
web actual.

**Resultat verificable:** les sis col·leccions generen només variants publicades
i traduïdes completament, amb referències vàlides i sense exposar esborranys ni
recursos exclusius.

## Estructura Del Repositori

```text
.
├── apps/
│   └── web/
│       ├── messages/
│       ├── public/
│       ├── project.inlang/
│       ├── src/
│       │   ├── assets/
│       │   ├── content/
│       │   ├── content-assets/
│       │   ├── lib/
│       │   ├── paraglide/
│       │   └── pages/
│       ├── astro.config.mjs
│       └── package.json
├── docs/
├── .github/
│   ├── workflows/
│   └── dependabot.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── tsconfig.json
```

No es crearà `services/chat-api` fins que comenci la fase del xat públic. El
workspace pot reservar el patró `services/*`, però no ha de contenir un servei
buit ni dependències de Hono.

No es crearà `packages/` fins que existeixi codi compartit real que justifiqui
un paquet independent.

## Runtime I Gestió De Paquets

- Utilitzar pnpm workspaces amb un únic lockfile a l'arrel.
- Marcar el paquet arrel com a privat.
- Fixar una versió LTS concreta de Node i una versió exacta de pnpm.
- Declarar pnpm al camp `packageManager` i utilitzar Corepack.
- Fer servir la mateixa versió de Node i pnpm localment, als hooks i a CI.
- Instal·lar dependències a CI amb el lockfile congelat.

Les versions exactes es decidiran en implementar la fase a partir de les
versions estables i compatibles d'aquell moment. Qualsevol actualització quedarà
registrada al lockfile i passarà per pull request.

## Aplicació Astro

- Utilitzar Astro amb TypeScript estricte i sortida estàtica.
- No afegir React, Vue ni cap altre framework de components.
- Integrar Tailwind CSS amb el plugin oficial de Vite i la importació CSS de
  Tailwind.
- No definir encara el sistema visual complet; la fase només ha de comprovar que
  la integració funciona i deixar un punt d'entrada global per a la fase 2.
- No afegir adaptadors SSR, base de dades, autenticació ni endpoints de servidor.
- Evitar JavaScript al client si la pàgina mínima no el necessita.
- Configurar l'i18n natiu d'Astro amb `ca`, `es` i `en`, `ca` com a idioma per
  defecte, `prefixDefaultLocale: true` i `redirectToDefaultLocale: true`.
- Fer que `/` redirigeixi a `/ca/` i exigir prefix a totes les altres rutes.
- Integrar `@inlang/paraglide-js` directament amb el plugin de Vite i l'estratègia
  d'output estàtic. No utilitzar el paquet deprecado `@inlang/paraglide-astro`.
- Generar el runtime tipat de Paraglide durant la instal·lació o el build. El
  codi generat queda fora del control de versions, no s'edita manualment ni
  actua com a font de veritat.
- Derivar l'idioma actiu de Paraglide exclusivament del prefix validat per Astro.
  Cookies, preferències del navegador o estat de client no poden sobreescriure
  l'idioma de la URL.
- Netejar i regenerar Paraglide de manera determinista abans de typecheck i
  build. El codi generat també queda cobert pel typecheck i l'anàlisi estàtica.

## Contingut I Idiomes

### Format

- Desar les entrades editorials com a YAML dins de `apps/web/src/content/`.
- Configurar les col·leccions a `apps/web/src/content.config.ts` amb els loaders
  locals d'Astro i esquemes Zod.
- No utilitzar MDX ni permetre components o codi executable dins del contingut.
- Limitar els fitxers a YAML 1.2 sense àncores, aliases, merges ni tags
  personalitzats.
- Tractar dates i valors ambigus com a strings explícits i validar-los amb Zod.
- Rebutjar claus duplicades i claus desconegudes, i executar lint de YAML a local
  i CI.
- Utilitzar un parser en mode segur i rebutjar claus de mapatge perilloses com
  `__proto__`, `prototype` i `constructor`.
- Limitar cada fitxer a 1 MiB, una profunditat màxima de 20 nivells, 10.000 nodes
  i 100.000 caràcters per valor escalar.
- Permetre text enriquit només amb un subconjunt controlat de Markdown:
  paràgrafs, negreta, cursiva, llistes i enllaços.
- Rebutjar HTML cru, scripts, iframes i protocols d'enllaç no aprovats.
- Renderitzar Markdown mitjançant un AST amb allowlist explícita o un sanititzador
  equivalent, amb HTML desactivat per defecte.
- Validar URI després de decodificar i normalitzar caràcters i entitats, abans de
  generar HTML.
- Utilitzar un validador compartit per a totes les URL del model, no només per
  als enllaços dins de Markdown.
- Acceptar `https` per a recursos web i limitar `mailto` i `tel` als camps que
  els necessitin explícitament. Rebutjar altres protocols.
- Normalitzar els camins locals i rebutjar rutes absolutes, travessia de
  directoris i referències fora dels directoris de recursos aprovats.

### Model Multiidioma

- Declarar `ca`, `es` i `en` com a idiomes coneguts.
- Exigir sempre el valor `ca` en qualsevol camp traduïble.
- Permetre `es` i `en` com a valors opcionals.
- Rebutjar claus d'idioma desconegudes per detectar errors tipogràfics.
- Utilitzar objectes indexats per idioma, no camps com `titleCa` o `titleEs`.
- Centralitzar la resolució d'idioma i els helpers de generació de rutes.
- Modelar els slugs com a valors traduïbles vinculats a un identificador estable.
- Limitar cada slug a un únic segment ASCII en minúscules amb format kebab-case.
  Rebutjar punts, separadors literals o codificats, segments reservats i valors
  que canviïn després de normalitzar la URL.
- Validar la unicitat dels slugs per idioma després de normalitzar-los i evitar
  col·lisions amb rutes tècniques o reservades.
- Generar una ruta només quan l'entrada tingui completa la traducció requerida
  per a aquell idioma. No servir contingut català sota `/es/` o `/en/`.
- Definir un predicat de completesa per model que cobreixi tots els camps
  renderitzats, blocs niats i referències a entitats o documents. Els camps
  opcionals sense traducció s'ometen; no fan fallback silenciós.
- Utilitzar el català com a fallback intern només fora de la generació de rutes
  públiques, mai per aparentar que una pàgina està traduïda.
- Generar metadades canòniques i `hreflang` només per a les variants realment
  publicades d'una entrada.

### Missatges D'Interfície

- Utilitzar Paraglide JS 2 per a navegació, botons, etiquetes, errors, textos
  d'accessibilitat i altres missatges curts de la interfície.
- Mantenir els catàlegs font a `messages/ca.json`, `messages/es.json` i
  `messages/en.json`.
- Exigir que totes les claus d'interfície existeixin en els tres idiomes abans
  del build.
- Utilitzar les funcions tipades generades per Paraglide, no claus de traducció
  lliures repartides pels components.
- Sincronitzar Paraglide amb `Astro.currentLocale` durant la generació estàtica i
  rebutjar de manera determinista qualsevol locale no configurat.
- No utilitzar Paraglide per desar pàgines, escoles, esdeveniments ni altres
  continguts editorials.

Exemple conceptual:

```yaml
title:
  ca: Escola de Trail
  es: Escuela de Trail
  en: Trail School
```

## Models Base

Els noms finals dels helpers TypeScript poden variar, però els contractes
següents han de quedar representats i validats.

### Configuració Del Lloc

- Identitat i nom públic del club.
- Idioma per defecte i idiomes coneguts.
- Navegació principal plana.
- Dades de contacte, seu i horaris.
- Xarxes socials, enllaços legals i configuració del peu.
- Enllaços de formularis o serveis externs que puguin variar per idioma.

La configuració ha de tenir una única entrada autoritativa.

### Pàgines

- Identificador i slug estables.
- Estat `published`.
- Títol, resum i metadades SEO traduïbles.
- Blocs editorials ordenats i validats.
- Conjunt inicial i acotat de blocs: text enriquit, imatge, galeria, enllaços i
  referències a documents.

Els llistats de domini, com esdeveniments o escoles, s'han de generar des de les
seves col·leccions i no duplicar-se manualment dins dels blocs de pàgina.

### Escoles

- Identificador, slug, estat `published`, nom, resum i descripció traduïbles.
- Imatge de portada, galeria, vídeo promocional opcional i atribucions.
- Enllaç d'inscripció opcional i estat d'inscripció explícit.
- Sis apartats fixos i traduïbles: des de quan, per a què, per a qui, quan
  entrenem, on i preus.

No es modelaran inicialment responsables, col·laboradors ni relacions amb
entitats dins de les escoles.

### Esdeveniments

- Identificador, slug, estat `published` i estat `active` independents.
- Títol i descripció traduïbles.
- Relació del club: organitza o col·labora.
- Imatge de portada, galeria, vídeos opcionals i atribucions.
- Enllaços opcionals d'inscripció i més informació.
- Referències a entitats organitzadores i col·laboradores.
- Edicions embegudes dins de l'esdeveniment, amb identificador, dates,
  ubicació, modalitats, estat d'inscripció i recursos disponibles.

Les dates de les edicions permeten ordenar i contextualitzar el calendari, però
no substitueixen `active`, que expressa si l'esdeveniment continua vigent dins
del projecte editorial.

### Entitats

- Identificador, estat `published`, nom, logotip, descripció traduïble i web
  opcional.
- Atribució o metadades públiques quan correspongui.
- Avantatge de soci opcional, com a màxim un per entitat, amb contingut
  traduïble i enllaç opcional.

Una entitat pot reutilitzar-se com a organitzadora, col·laboradora, patrocinadora
contextual o empresa amb avantatge. No es crearà una col·lecció separada de
patrocinadors.

### Documents

- Identificador, estat `published`, títol i descripció traduïbles.
- Fitxer públic local o URL externa explícita.
- Tipus de document, data opcional, idioma del recurs i estat de disponibilitat.
- Atribució o font quan correspongui.

## Recursos Públics

- Versionar només imatges i documents finals, optimitzats i autoritzats per a
  publicació.
- Desar els recursos vinculats a contingut dins de `src/assets/` o
  `src/content-assets/` perquè el build només emeti els que utilitza contingut
  publicat. Reservar `public/` per a recursos globals que sempre siguin públics.
- Mantenir els originals de gran mida fora del repositori.
- Exigir text alternatiu traduïble per a imatges informatives.
- Permetre una atribució visible i una font quan els drets ho requereixin.
- Utilitzar URL externes només per a recursos realment externs, com formularis
  d'inscripció, tracks, vídeos o webs de tercers.
- No introduir Git LFS en aquesta fase.
- Acceptar només formats d'imatge i documents aprovats. No publicar HTML ni SVG
  no sanititzat com a recurs de contingut.

## Publicació I Esborranys

- `published` és la font de veritat de la visibilitat editorial.
- Centralitzar les consultes públiques perquè filtrin contingut despublicat.
- Garantir amb tests que esborranys i entrades despublicades no generen rutes ni
  apareixen en consultes públiques, i que els seus recursos exclusius no es
  copien a la sortida del build.
- No implementar cookies, URL especials ni autenticació de preview en aquesta
  fase.
- Els futurs previews de pull request hauran de definir el seu propi límit de
  seguretat abans d'exposar contingut despublicat.

## Ordres Del Projecte

El paquet arrel ha d'oferir una interfície única per executar com a mínim:

| Ordre               | Responsabilitat                               |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Iniciar la web en desenvolupament             |
| `pnpm format`       | Aplicar formatació                            |
| `pnpm format:check` | Verificar formatació sense modificar fitxers  |
| `pnpm lint`         | Executar ESLint                               |
| `pnpm typecheck`    | Executar `astro check` i TypeScript           |
| `pnpm test`         | Executar Vitest                               |
| `pnpm build`        | Generar la web estàtica                       |
| `pnpm validate`     | Executar totes les comprovacions obligatòries |

`pnpm validate` ha de ser la mateixa entrada utilitzada pel hook de pre-push i
per la CI, evitant divergències entre entorns.

## Qualitat Local

- ESLint amb suport específic per a Astro i TypeScript.
- Prettier amb suport per a fitxers Astro, YAML, Markdown, CSS i TypeScript.
- Lint de YAML amb les restriccions editorials definides en aquest document.
- Vitest per a helpers purs, esquemes, idioma i filtratge editorial.
- Commitlint amb Conventional Commits.
- Hook `commit-msg` per validar el missatge de commit.
- Hook `pre-commit` amb lint-staged i detecció de secrets per comprovar només
  fitxers staged.
- Hook `pre-push` amb `pnpm validate`.

Els hooks milloren el feedback local, però la CI continua sent l'autoritat i ha
de repetir totes les comprovacions obligatòries.

Playwright i les proves end-to-end queden per a la fase 2, quan existeixin
recorreguts públics reals.

## GitHub Actions I Protecció De Branca

### Workflows Versionats

- Workflow de qualitat per instal·lar amb lockfile congelat i executar
  `pnpm validate` en pull requests i canvis a la branca principal.
- Validació de títols de pull request i commits amb Conventional Commits.
- Gitleaks per detectar secrets en canvis locals i a CI. La CI ha de disposar de
  prou historial i escanejar des del merge base fins al cap de la pull request,
  no només l'estat final dels fitxers.
- CodeQL per analitzar JavaScript i TypeScript.
- Dependabot per a dependències pnpm i GitHub Actions.
- Dependency review en pull requests quan estigui disponible.

Totes les referències `uses:`, incloent-hi actions de GitHub, actions de tercers
i workflows reutilitzables, s'han de fixar a un SHA complet i immutable, amb un
comentari que indiqui la versió humana. Dependabot n'ha de proposar les
actualitzacions mitjançant pull requests.

Els workflows han de declarar permisos mínims, evitar `pull_request_target` per
executar codi no fiable i no tenir accés a secrets si no són imprescindibles.
La fase 1 no necessita secrets de desplegament.

### Configuració Manual De GitHub

- Activar secret scanning i push protection.
- Protegir la branca principal i exigir pull request.
- Marcar els checks de qualitat i seguretat com a obligatoris.
- Bloquejar push directe i force push a la branca principal.
- Configurar squash merge com a estratègia de merge.
- Exigir que el títol de la pull request segueixi Conventional Commits.
- No permetre bypass automàtic de les regles a agents, workflows o aplicacions.
- Aplicar les regles també a administradors i persones mantenidores. Qualsevol
  excepció d'emergència ha de ser manual, temporal, justificada i auditada, i ha
  d'anar seguida d'una revisió i restauració immediata de les proteccions.

Amb dues o més persones mantenidores, cal exigir com a mínim una aprovació
independent. Si inicialment només hi ha una persona mantenidora, aquesta
limitació s'ha de documentar: continuen sent obligatoris la pull request, els
checks, la revisió final explícita del diff i la fusió manual; cap agent o
workflow pot autoaprovar o fusionar.

## Estratègia De Tests

La fase ha d'incloure com a mínim proves per demostrar que:

- Els objectes traduïbles exigeixen català i rebutgen idiomes desconeguts.
- Totes les rutes HTML públiques comencen per `/ca/`, `/es/` o `/en/`, i `/`
  redirigeix a `/ca/`. Queden exceptuats els recursos tècnics globals aprovats,
  com `robots.txt` o la icona del lloc.
- Una entrada sense traducció completa no genera una ruta per aquell idioma.
- La completesa inclou blocs niats i contingut referenciat que es renderitza a la
  pàgina.
- Els catàlegs de Paraglide tenen les mateixes claus als tres idiomes.
- El parser editorial rebutja àncores, aliases, tags, claus duplicades i valors
  fora de l'esquema.
- El parser rebutja fitxers que superen els límits de mida o complexitat i claus
  de mapatge perilloses.
- Cada col·lecció accepta una entrada vàlida representativa.
- Cada col·lecció rebutja camps obligatoris absents i estats no permesos.
- Les referències entre esdeveniments, entitats i documents són vàlides.
- Les edicions d'esdeveniments es validen dins del model pare.
- El Markdown restringit rebutja HTML o protocols perillosos.
- El render de Markdown neutralitza URI perilloses codificades o ofuscades.
- Els slugs compleixen la gramàtica, són únics per idioma i no col·lideixen amb
  rutes reservades després de normalitzar-los.
- Tots els camps URL rebutgen protocols no aprovats i els camins locals no poden
  escapar dels directoris autoritzats.
- Les consultes públiques exclouen contingut amb `published: false`.
- Entitats i documents despublicats no apareixen en llistats ni poden emetre's
  indirectament a través de referències públiques.
- Els recursos exclusius de contingut despublicat no apareixen al build.

No es fixa un percentatge arbitrari de cobertura. Les proves han de protegir els
contractes i riscos descrits en aquesta especificació.

## Contingut De Mostra

- Crear només una entrada mínima i representativa per col·lecció.
- Utilitzar dades fictícies o explícitament públiques, sense copiar informació
  possiblement obsoleta de la web actual.
- Mantenir fixtures invàlides separades per provar els errors dels esquemes.
- No iniciar la migració editorial ni revisar el contingut històric en aquesta
  fase.

## Fora D'Abast

- Disseny final, components visuals i implementació de `DESIGN.md`.
- Pàgina d'inici i plantilles públiques completes.
- Migració o actualització del contingut de la web actual.
- Implementació visual del selector d'idioma i traducció completa del contingut.
- Preview de contingut despublicat.
- Formularis funcionals, butlletí o enviament de correu.
- Servei Hono, índex del xat públic o assistent editorial.
- Caddy, VPS, previews de pull request i desplegament a producció.
- Playwright i proves end-to-end.

## Criteris D'Acceptació

La fase es considera completada quan:

1. Una instal·lació neta amb les versions fixades pot executar `pnpm validate`
   i `pnpm build` correctament.
2. La CI executa les mateixes validacions i bloqueja una pull request amb format,
   lint, tests, tipus, contingut, build, commits o secrets invàlids.
3. Les sis col·leccions base estan registrades, tipades, documentades i tenen
   mostres mínimes vàlides.
4. Totes les rutes HTML utilitzen prefix d'idioma, `/` redirigeix a `/ca/` i
   només es generen variants amb traducció completa.
5. Cap entrada amb `published: false` apareix en consultes o sortides públiques.
6. Els hooks locals validen commit, fitxers staged i push sense substituir els
   controls remots.
7. GitHub té actius branch protection, checks obligatoris, secret scanning,
   push protection, Dependabot i CodeQL.
8. Totes les referències `uses:` estan fixades per SHA i utilitzen permisos
   mínims.
9. No s'han introduït secrets, serveis de servidor, dades privades ni contingut
   migrat sense revisar.
10. `README.md`, `docs/content-model.md` i aquest document reflecteixen la base
    implementada i no descriuen l'aplicació com a inexistent.
11. Paraglide valida i genera missatges tipats per a `ca`, `es` i `en` sense
    gestionar ni duplicar contingut editorial.
