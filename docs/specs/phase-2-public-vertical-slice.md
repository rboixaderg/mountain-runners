# Especificació De La Fase 2: Vertical Slice Públic

## Estat

Preparada per desglossar-se en tasques implementables quan les dependències de
la fase 1 estiguin fusionades.

## Objectiu

Validar conjuntament el model editorial, la direcció visual, la navegació, el
SEO i la qualitat pública mitjançant el primer recorregut real de la web:
portada, hub d'esdeveniments i detall d'esdeveniment.

La fase ha de convertir la base tècnica de la fase 1 en pàgines útils, ràpides i
accessibles generades des de contingut estructurat. No ha de completar encara
totes les àrees del web ni desplegar a producció.

## Límit De Codi I Contingut

La fase aplica l'ADR 0004: el shell, les rutes, la navegació i l'ordre de les
seccions són estructura estable implementada en components. Les col·leccions
editorials aporten només les dades canviants, com esdeveniments, escoles, dates,
estats, textos, recursos i URL. Aquesta regla preval sobre qualsevol referència
anterior a una configuració YAML global del lloc.

## Resultats Esperats

- Shell global responsive amb capçalera, navegació mòbil, peu i pàgina 404.
- Fonaments visuals reutilitzables coherents amb `DESIGN.md`.
- Portada en català basada de manera adaptable en la referència aprovada de
  Stitch.
- Hub i detall d'esdeveniment basats en referències de Stitch aprovades abans de
  la implementació.
- Tres casos reals d'esdeveniment revisats que cobreixin els estats funcionals
  acordats.
- Navegació d'esdeveniments clara, sense filtres ni JavaScript innecessari.
- Selector d'idioma preparat per mostrar només variants publicades i amagat quan
  no existeixi cap alternativa.
- SEO complet del vertical slice, incloent-hi sitemap i dades estructurades quan
  les dades siguin suficients i verificades.
- Validacions automatitzades de comportament, accessibilitat, rendiment i SEO.
- Skills portables pertinents per a l'stack, revisades i versionades, més una
  skill local que adapti les comprovacions al projecte.
- Contingut i recursos reals amb procedència, drets i atribucions revisats.

## Dependències I Ordre D'Inici

El codi de la fase 2 no comença fins que les quatre entregues de la fase 1 que
afectin runtime, i18n, contingut i publicació estiguin fusionades a `main`.

Mentre la fase 1 continua en curs, es poden avançar només tasques que no depenen
dels contractes TypeScript encara inestables:

- preparar i aprovar les referències de Stitch;
- inventariar contingut i recursos de la web actual;
- identificar els tres casos d'esdeveniment;
- revisar vigència, exactitud, drets i atribucions;
- preparar la matriu de comprovacions de qualitat.

Cada tasca d'implementació utilitza un worktree i una branca propis creats des de
la `main` actualitzada, segons `AGENTS.md`. La fase 2 no es desenvolupa dins del
worktree principal.

## Entregues I Seguiment

No es fixa anticipadament un nombre de pull requests. Les PRs es defineixen a
partir d'unitats cohesionades, amb dependències clares i un resultat que es pugui
revisar i validar de manera independent.

Una PR pot agrupar unitats adjacents només quan:

- comparteixen el mateix resultat verificable;
- no introdueixen una revisió massa gran o heterogènia;
- totes les seves dependències ja estan fusionades;
- es poden revertir juntes sense afectar treball no relacionat;
- la descripció de la PR pot demostrar-ne completament l'acceptació.

| Unitat                                       | Estat   | Dependències                                            | Resultat verificable                          | PR  |
| -------------------------------------------- | ------- | ------------------------------------------------------- | --------------------------------------------- | --- |
| Referències visuals i inventari editorial    | Pendent | Cap dependència de codi                                 | Dissenys i contingut candidats revisats       | -   |
| Skills externes portables                    | Pendent | Fase 1 fusionada                                        | Conjunt pertinent, segur i reproduïble        | -   |
| Fonaments visuals i shell global             | Pendent | Fase 1 i referències aplicables                         | Shell responsive i accessible                 | -   |
| Portada content-driven                       | Pendent | Shell i contingut aprovat                               | Inici real generat des de col·leccions        | -   |
| Hub i detall d'esdeveniments                 | Pendent | Shell, dissenys i contingut d'esdeveniments aprovats    | Recorregut complet amb estats reals           | -   |
| SEO, rendiment, wrapper local i qualitat E2E | Pendent | Pàgines representatives i skills externes implementades | Llindars, wrapper i recorreguts automatitzats | -   |

Els únics estats permesos són `Pendent`, `En curs`, `Bloquejada` i `Completada`.
Quan una unitat entra en una PR, se n'afegeix l'enllaç i s'actualitza l'estat.
Només passa a `Completada` quan la PR corresponent està validada, revisada i
fusionada.

Cada draft PR ha d'incloure:

- enllaç a aquesta especificació;
- unitats i criteris d'acceptació que cobreix;
- comprovacions executades i resultats;
- evidència visual o de contingut quan correspongui;
- impacte d'accessibilitat, SEO, rendiment, seguretat i llicències;
- decisions pendents i seguiments que quedin fora de la PR.

## Referències Visuals

### Fonts De Veritat

`DESIGN.md` governa els principis visuals, de composició, accessibilitat i
interacció. Les pantalles de Stitch són referències adaptables, no especificacions
de píxel ni codi font autoritatiu.

La portada parteix de la pantalla:

- projecte Stitch `6497516597197145737`;
- pantalla `53b4861b1b6b4b6aad6128a73aba617b`, **Mountain Runners - Inici
  (Red Kit Energy)**.

Abans d'implementar esdeveniments s'han de crear i aprovar a Stitch:

- una referència desktop i una de mòbil per al hub d'esdeveniments;
- una referència desktop i una de mòbil per al detall d'esdeveniment;
- els estats visuals d'inscripció oberta, tancada i recurs no disponible;
- el tractament d'un esdeveniment vigent sense pròxima data anunciada.

La implementació pot corregir la referència per responsive, semàntica,
accessibilitat, contingut real o rendiment. No s'ha de copiar automàticament
l'HTML generat per Stitch ni introduir dependències suggerides per aquell codi.

Si una iteració revela un principi visual durable que no existeix a `DESIGN.md`,
primer se'n proposa una actualització petita i revisable. Els detalls exclusius
d'un component es queden al codi i no amplien innecessàriament `DESIGN.md`.

## Sistema Visual I Components

### Tipografia I Recursos De Marca

- Utilitzar Oswald per a titulars i etiquetes compactes, i Inter per al cos i la
  navegació.
- Servir les fonts localment en formats web optimitzats; no fer peticions a
  Google Fonts ni a altres CDNs.
- Versionar les llicències i atribucions exigides per les fonts.
- Limitar pesos i variants als que s'utilitzin realment.
- Aplicar `font-display: swap` i precarregar només els fitxers crítics demostrats.
- Utilitzar el logo i la pinzellada de marca com a recursos controlats, sense
  convertir la pinzellada en decoració repetitiva.

### Fonaments Reutilitzables

La fase ha de definir, com a mínim:

- tokens CSS de color, tipografia, espaiat, amplada de lectura i focus;
- contenidor i grid editorial responsive;
- enllaços, accions primàries acotades i estats de focus;
- capçalera, navegació desktop i navegació mòbil;
- peu global;
- tractament compartit d'imatges, figures i atribucions;
- primitives per a dates, estats i accions d'esdeveniment;
- metadades i shell SEO compartits.

Els components Astro han de mantenir-se petits i orientats a patrons reals. No
s'ha de crear una llibreria genèrica, un paquet compartit ni abstraccions per a
un únic ús. No s'afegeix React, Vue ni cap altre runtime de components.

### Responsive I Interacció

- La lectura i les accions principals han de funcionar des de 320 CSS px sense
  scroll horitzontal.
- Els punts de ruptura han de respondre al contingut, no a dispositius concrets.
- La navegació mòbil ha de ser operable amb teclat, exposar nom i estat
  accessibles i evitar trampes de focus.
- La funcionalitat essencial i l'accés als enllaços no poden dependre de
  JavaScript al client.
- Les animacions, si n'hi ha, han de ser prescindibles, respectar
  `prefers-reduced-motion` i no bloquejar contingut ni interacció.
- Cap estat pot comunicar-se només amb color.

## Shell Global I Navegació

El shell inclou:

- `lang` coherent amb la locale de la ruta;
- skip link al contingut principal;
- landmarks i jerarquia de títols semàntics;
- logo amb retorn a la portada localitzada;
- navegació principal plana;
- peu mínim amb identitat del club i enllaços vàlids a Inici i Esdeveniments;
- títol, descripció, canonical i metadades socials per pàgina;
- pàgina 404 útil, no indexable i amb retorn a contingut publicat.

El peu no incorpora encara contacte, butlletí, documents legals ni el directori
complet d'enllaços socials, que pertanyen a la fase 3.

Durant la fase 2, només Inici i Esdeveniments tenen destinacions completes. Qui
som, Socis i Escoles es mostren com a contingut no disponible amb l'etiqueta
`Properament`, però no com a enllaços desactivats ni com a àncores sense destí.
La fase 3 els convertirà en enllaços quan les rutes existeixin.

La pàgina tècnica global `/404.html` és una excepció al prefix de locale, declara
`lang="ca"` i pot ser només en català perquè és l'únic idioma publicat. No es
generen variants `/ca/404`, `/es/404` o `/en/404`, ni s'hi suggereix que
existeixen traduccions. El comportament del servidor davant URL desconegudes amb
o sense prefix es definirà amb Caddy a la fase 4; en aquesta fase es valida el
document 404 generat i els seus enllaços.

## Selector D'Idioma

- Derivar les alternatives de les variants publicades i completes de l'entrada
  actual.
- Enllaçar a l'slug traduït corresponent, no a la mateixa ruta sota un altre
  prefix.
- No oferir locales configurades que no tinguin una variant publicable.
- Amagar completament el selector quan només existeixi la variant actual.
- No mostrar castellà o anglès com a opcions desactivades o `Properament`.
- No introduir preferències en cookies ni detecció del navegador; la URL continua
  governant l'idioma.

La fase 2 només publica contingut real en català. Les proves han de demostrar que
el selector apareixerà correctament amb fixtures traduïdes, sense publicar
aquelles fixtures com a pàgines reals.

## Portada

La portada `/ca/` ha de construir-se exclusivament des de la configuració del
lloc i les col·leccions editorials. Ha d'incloure:

- hero d'identitat amb contingut i imatge aprovats;
- selecció d'esdeveniments amb `active: true`, prioritzant els que tenen una
  pròxima edició i continuant amb els vigents sense data futura;
- presentació de les escoles;
- entrada a l'àrea de socis;
- bloc de comunitat i territori;
- accions coherents amb la disponibilitat real de cada destinació.

Les escoles, socis i comunitat poden presentar informació real i acotada, però
no implementen les plantilles completes de la fase 3. Quan una destinació encara
no existeixi, el component ha de comunicar `Properament` sense generar un enllaç
trencat.

No es poden codificar dins dels components dates, estats, textos editorials,
formularis ni URL que hagin de canviar sense desplegar codi.

## Esdeveniments

### Hub

El hub `/ca/esdeveniments/` no incorpora filtres, cerca, calendari interactiu ni
estat al client. Cada entrada publicada pertany a un únic grup, aplicant aquesta
precedència:

1. `active: true` amb una edició en curs o futura: pròximes edicions;
2. `active: true` sense cap edició en curs o futura: vigents sense pròxima data;
3. `active: false`: esdeveniments passats.

Les pròximes edicions s'ordenen cronològicament de més propera a més llunyana.
Els esdeveniments passats s'ordenen per l'edició més recent en ordre descendent.
Els empats utilitzen un criteri estable, com l'identificador de l'entrada.

`active` expressa vigència editorial i no es dedueix de la data. Una entrada
publicada amb `active: false` i una edició futura és inconsistent i ha de fer
fallar la validació editorial en lloc de classificar-se silenciosament. Un
esdeveniment passat sense edicions s'ordena després dels que tenen data, amb
l'identificador estable com a desempat.

Un esdeveniment amb `active: true` i només edicions passades continua entre els
vigents amb el
missatge `Sense pròxima data anunciada`. No s'ha de presentar com una edició
futura ni moure'l automàticament a l'històric.

### Detall

El detall ha de prioritzar:

- títol, relació del club i estat vigent o històric;
- descripció i imatge aprovades;
- pròxima edició o edició més rellevant;
- data, ubicació, modalitats i estat d'inscripció;
- accions d'inscripció i més informació quan existeixin;
- edicions anteriors disponibles;
- entitats referenciades i atribucions publicables.

Les dates es renderitzen en català, amb elements `<time>` i valors `datetime`
vàlids. La zona temporal del lloc és `Europe/Madrid`; els tests que depenguin de
la data han de fixar el rellotge per ser deterministes.

### Estats I Accions

- `active` i `published` mantenen els significats definits a la fase 1.
- L'estat d'inscripció és explícit al contingut i no es dedueix de l'existència
  d'una URL.
- Una inscripció oberta amb URL ofereix una acció descriptiva.
- Una inscripció tancada mostra l'estat, però no un botó desactivat.
- Un recurs no disponible mostra text útil i no genera `href` buit, `#` ni una
  àncora amb `aria-disabled`.
- Els enllaços externs han d'indicar clarament el destí quan el context no sigui
  suficient i utilitzar només URL validades pel model.
- Els estats han de tenir text o iconografia amb nom accessible, a més del color.

## Contingut Real I Revisió Editorial

### Conjunt Inicial

La fase migra només el contingut necessari per a la portada i tres casos
representatius d'esdeveniment. El conjunt ha de cobrir col·lectivament:

- esdeveniment vigent amb pròxima edició;
- esdeveniment passat;
- inscripció oberta;
- inscripció tancada;
- enllaç o recurs no disponible;
- esdeveniment vigent sense pròxima data, si existeix un cas real adequat.

No cal que cada estat pertanyi a una entrada diferent. Si la web actual no conté
un cas real fiable, no s'han d'inventar dades per satisfer la matriu: es documenta
la mancança i es cobreix el comportament amb una fixture no publicada.

### Font I Aprovació

La web actual és una font candidata, no l'autoritat final. Abans de publicar una
entrada s'ha de revisar explícitament:

- vigència de textos, dates, ubicacions i estat;
- URL d'inscripció i informació externa;
- relació de Mountain Runners amb l'esdeveniment;
- ortografia, to i claredat en català;
- drets, consentiment, atribució i font dels recursos;
- absència de dades personals o informació interna no necessària.

L'inventari públic pot distingir `Candidat`, `Revisat`, `Aprovat` i `Descartat`,
però abans de l'aprovació només pot contenir metadades sanejades, URL de la font
i observacions que ja siguin publicables. Com que branques, commits i PRs també
són públics, no es copien al repositori textos complets, imatges ni dades
heretades fins que hagin superat la revisió de privacitat, exactitud i llicència.

Només el contingut `Aprovat` entra als fitxers editorials reals i pot tenir
`published: true`. L'aprovació ha de quedar documentada a la PR o en un document
editorial públic sense incloure dades privades. Les fixtures no publicades han
de ser sintètiques o utilitzar únicament material que ja sigui públic, revisat i
amb llicència compatible.

No es fa una importació automàtica de WordPress directament a contingut publicat
ni una migració completa de l'històric.

### Imatges I Llicències

- Prioritzar fotografies autèntiques del club, activitats i territori.
- Es poden reutilitzar imatges de la web actual només després de revisar-ne l'ús
  públic, autoria, consentiment i atribució.
- Es poden utilitzar imatges open source o amb llicència compatible quan siguin
  representatives i no semblin publicitat esportiva genèrica.
- Registrar origen, autor, llicència i atribució exigida de cada recurs extern.
- No utilitzar recursos sense procedència clara, amb restriccions incompatibles
  o obtinguts d'una cerca sense revisar-ne la llicència original.
- No fer hotlinking d'imatges editorials ni dependre d'un CDN de tercers.
- Optimitzar i versionar només les variants necessàries per a publicació.
- Mantenir amplada i alçada explícites per evitar canvis de layout.
- Garantir que recursos exclusius d'entrades no publicades no arribin al build.

## Skills Portables

### Descobriment

Quan la fase 1 estigui fusionada, es pot executar una detecció en mode
`--dry-run` amb una versió exacta i revisada d'`autoskills`. La versió s'ha
d'escollir en aquell moment perquè sigui estable, compatible amb el Node fixat i
coberta per la política de seguretat del projecte extern.

Abans de la primera execució s'ha de verificar el registre i repositori
autoritzats, la integritat del paquet o tarball, la correspondència amb el commit
font revisat, els scripts de lifecycle i el codi que s'executarà. Una versió npm
no és per si sola una fixació suficient.

La detecció és orientativa. No autoritza la instal·lació automàtica de totes les
propostes ni converteix `autoskills` en una dependència de runtime, CI o hooks.
Si no hi ha una versió suportada o no es pot verificar de manera fiable, es
revisa manualment el registre i els repositoris originals sense executar el CLI.

`autoskills` no s'executa amb credencials disponibles ni directament sobre el
worktree. La detecció utilitza una còpia mínima i sanejada dels manifests públics
en un directori temporal, amb `HOME` aïllat, sense configuracions Git o npm de
l'usuari i amb escriptura limitada a aquell entorn d'un sol ús. Sempre que les
eines disponibles ho permetin, el paquet es baixa i verifica abans d'executar-lo
sense xarxa. Els scripts de lifecycle es desactiven o es revisen explícitament.
No s'utilitza `-y` abans d'haver revisat el resultat del dry run.

### Criteris D'Incorporació

Cada skill detectada s'incorpora només si:

- correspon a tecnologia o responsabilitat real de la fase;
- aporta instruccions no cobertes millor pels documents del projecte;
- té una llicència clara i compatible amb la redistribució pública;
- conserva els avisos d'autoria i llicència requerits;
- no inclou instruccions de publicació, desplegament, secrets o ordres
  destructives contràries a `AGENTS.md`;
- no introdueix dependències, serveis o arquitectura fora d'abast;
- no conté prompt injection, càrrega remota d'instruccions ni scripts no
  revisats;
- es pot fixar a una revisió i hash verificables.

Les llicències no comercials o amb restriccions incompatibles no s'incorporen
silenciosament. Requereixen una decisió explícita i documentada; en absència
d'aquesta decisió, la skill queda exclosa.

S'espera avaluar com a mínim les propostes relacionades amb Astro, Tailwind CSS,
TypeScript, Zod, Vitest, Playwright, accessibilitat i SEO. Detectar una skill no
implica que sigui pertinent.

### Versionat I Actualitzacions

- Desar les skills aprovades a `.agents/skills/`.
- Versionar un lock o manifest amb origen, revisió, hash, llicència i data de
  revisió.
- No descarregar ni actualitzar skills automàticament a CI.
- Fer qualsevol actualització posterior mitjançant una PR amb diff revisable.
- Tornar a executar les comprovacions de seguretat i compatibilitat en cada
  actualització.
- Evitar duplicar una mateixa skill per a agents diferents; `.agents/skills/` és
  la ubicació portable autoritativa.

### Wrapper De Mountain Runners

La unitat de SEO, rendiment i qualitat afegeix una skill local petita quan les
ordres i llindars definitius ja existeixen. S'ha d'activar en implementar o
revisar pàgines públiques i indicar:

- quins documents governen disseny, arquitectura, contingut i seguretat;
- quines ordres locals s'han d'executar;
- quines rutes i viewports formen la mostra mínima;
- quins llindars de Lighthouse i pressupostos són obligatoris;
- quina evidència automatitzada s'ha de registrar;
- que les instruccions locals i els ADR prevalen sobre recomanacions externes;
- que no es pot afirmar conformitat WCAG completa només amb automatització.

Les skills externes es mantenen sense modificacions locals perquè se'n pugui
revisar l'origen i actualitzar-les amb un diff clar. El wrapper conté l'adaptació
específica del projecte.

## SEO Del Vertical Slice

### Metadades I Indexació

Cada pàgina indexable ha de tenir:

- `title` i descripció únics derivats de contingut validat;
- canonical absolut amb l'origen públic configurat centralment;
- `lang` correcte;
- Open Graph i metadades socials amb imatge aprovada quan correspongui;
- alternatives `hreflang` només per a variants realment publicades;
- una única jerarquia principal de contingut coherent.

La 404 no s'inclou al sitemap i declara `noindex`. Els esborranys, fixtures,
variants incompletes i recursos interns no apareixen en sitemap, metadades
alternatives ni dades estructurades.

### Sitemap I Robots

- Generar el sitemap des de les rutes publicades del build.
- Incloure només URL canòniques indexables.
- Publicar un `robots.txt` coherent amb l'origen canònic i l'URL del sitemap.
- No utilitzar `robots.txt` com a control de confidencialitat.
- No enviar encara el sitemap a cercadors ni configurar Search Console; aquestes
  accions depenen del domini i del flux de producció de la fase 4.

### Dades Estructurades

- Incloure `Organization` o `SportsOrganization` només amb dades públiques
  revisades.
- Incloure `WebSite` quan l'origen canònic sigui definitiu.
- Generar `Event` per a edicions que tinguin prou dades fiables.
- No inventar preus, disponibilitat, organitzadors, ubicacions ni dates.
- Ometre propietats opcionals absents en lloc de publicar valors buits.
- Fer coincidir estat, URL i dates estructurades amb el contingut visible.
- Validar el JSON-LD sintàcticament i amb tests de contracte; la validació amb
  serveis externs pot documentar-se com a comprovació no bloquejant.

## Accessibilitat Automatitzada

L'objectiu és prevenir regressions detectables i complir els criteris aplicables
que es puguin verificar de manera automatitzada. La fase no afirma una
conformitat completa amb WCAG 2.2 AA perquè no inclou una auditoria manual amb
teclat, lector de pantalla, zoom i tecnologies d'assistència.

La cobertura mínima inclou:

- HTML semàntic, landmarks, `lang`, títols i noms accessibles;
- contrast de text, components i focus conforme als llindars AA aplicables;
- focus visible i estats no dependents només del color;
- absència d'errors automàtics d'axe a les rutes representatives;
- auditoria Lighthouse d'accessibilitat amb puntuació 100;
- comprovacions E2E de navegació mòbil, skip link, selector d'idioma i accions;
- text alternatiu i dimensions per a les imatges publicades;
- respecte per `prefers-reduced-motion`.

L'auditoria manual queda registrada com a necessitat separada a
[`docs/backlog.md`](../backlog.md) i no forma part del tancament d'aquesta fase.

## Rendiment

### Pressupostos

Les pàgines representatives en mòbil han de complir:

| Mètrica                                | Llindar            |
| -------------------------------------- | ------------------ |
| Lighthouse Performance                 | 90 o superior      |
| Largest Contentful Paint de laboratori | 2,5 s o inferior   |
| Cumulative Layout Shift                | 0,1 o inferior     |
| Total Blocking Time                    | 200 ms o inferior  |
| JavaScript inicial propi, comprimit    | 30 KiB o inferior  |
| CSS inicial propi, comprimit           | 50 KiB o inferior  |
| Fonts transferides inicialment         | 200 KiB o inferior |
| Imatge LCP en mòbil                    | 300 KiB o inferior |
| Transferència inicial total            | 1,5 MiB o inferior |

Els llindars es mesuren sobre un build de producció servit localment en un
entorn de CI reproduïble. Si Lighthouse introdueix variabilitat, la configuració
pot usar múltiples execucions i la mediana, però no relaxar silenciosament els
llindars.

### Estratègia

- Utilitzar el pipeline d'imatges d'Astro per generar mides i formats responsive.
- No carregar sota el primer viewport les imatges que no siguin necessàries.
- Prioritzar correctament la imatge LCP sense precarregar recursos indiscriminats.
- Evitar llibreries de client per interaccions que resol HTML o JavaScript petit.
- No afegir analítica, píxels, widgets ni scripts de tercers.
- Servir fonts i recursos visuals localment.
- Evitar animacions o efectes que augmentin treball al fil principal.

## Estratègia De Tests

### Tests Unitaris I D'Integració

Vitest ha de cobrir com a mínim:

- classificació i ordre d'esdeveniments amb rellotge fix;
- diferència entre vigència `active` i dates d'edicions;
- resolució d'edició pròxima o més rellevant;
- presentació d'inscripció oberta, tancada i recurs absent;
- alternatives del selector d'idioma;
- generació de canonical, `hreflang`, sitemap i JSON-LD;
- serialització segura de JSON-LD davant `</script>`, `<`, variants codificades i
  caràcters Unicode inusuals, verificant l'HTML final renderitzat;
- exclusió de contingut i variants no publicades.

### Playwright

Playwright s'executa en Chromium, Firefox i WebKit. La matriu mínima cobreix una
mida mòbil i una d'escriptori per als recorreguts essencials:

- càrrega i navegació de la portada;
- obertura i tancament de la navegació mòbil;
- accés de la portada al hub d'esdeveniments;
- accés del hub a un detall;
- representació dels estats dels tres casos;
- comportament de la 404;
- absència del selector d'idioma quan no hi ha alternatives;
- absència d'enllaços trencats o falsament desactivats dins del slice.

Les comprovacions axe es poden concentrar en Chromium per evitar duplicació,
però han de cobrir els dos viewports i totes les plantilles representatives. Les
proves funcionals i responsive continuen executant-se als tres motors.

Les captures de regressió visual no formen part d'aquesta fase. La necessitat
continua registrada al backlog.

### Lighthouse I SEO

Sobre portada, hub i un detall representatiu, la CI exigeix en mòbil:

- Performance: 90 o superior;
- Accessibility: 100;
- Best Practices: 100;
- SEO: 100.

També s'han de validar sitemap, robots, canonical, metadades socials i JSON-LD
sense dependre exclusivament de la puntuació Lighthouse.

## Ordres I CI

La interfície arrel ha d'incorporar les comprovacions noves sense trencar les
ordres de la fase 1. Els noms exactes poden adaptar-se a les convencions
implementades, però han d'existir entrades equivalents per a:

| Ordre             | Responsabilitat                                            |
| ----------------- | ---------------------------------------------------------- |
| `pnpm test:e2e`   | Executar els recorreguts Playwright                        |
| `pnpm test:a11y`  | Executar les comprovacions automatitzades d'accessibilitat |
| `pnpm lighthouse` | Validar Lighthouse i pressupostos                          |
| `pnpm validate`   | Incloure totes les comprovacions obligatòries de la fase   |

Les comprovacions costoses es poden separar en jobs de CI paral·lels, però han
de ser obligatòries abans de fusionar. La CI ha de conservar artefactes útils
com informes Playwright i Lighthouse quan hi hagi una fallada. Els uploads
utilitzen una allowlist de camins, retenció màxima de set dies i exclouen el
build complet, variables d'entorn, configuracions de l'usuari i traces, vídeos,
captures o snapshots del DOM que no s'hagin revisat explícitament. Cap artefacte
pot contenir contingut no aprovat, dades locals ni camins sensibles.

Cap test depèn de serveis externs en temps d'execució. Les URL externes es
validen estructuralment; la comprovació de disponibilitat remota completa queda
per a una fase que defineixi una política de link checking.

## Seguretat I Privacitat

- El build continua sent estàtic i sense secrets.
- No s'afegeixen formularis funcionals, autenticació, cookies ni backend.
- No s'afegeix analítica ni scripts de tercers.
- El contingut heretat es tracta com a entrada no fiable i passa pels esquemes
  i sanititzadors de la fase 1.
- No es copia HTML de WordPress ni de Stitch al contingut o components.
- Les dades estructurades s'escapen i serialitzen de manera segura.
- Les URL, Markdown i camins locals utilitzen els validadors compartits.
- Les skills externes es tracten com a dependències de cadena de subministrament
  i instruccions no fiables fins que superen la revisió definida.
- Cap skill pot modificar les regles de publicació, protecció de branca,
  desplegament o gestió de secrets.
- Els informes de CI no han d'incloure credencials, camins locals sensibles ni
  contingut editorial no publicable.

## Fora D'Abast

- Plantilles completes de Qui som, Socis i Escoles.
- Migració completa del contingut o de l'històric d'esdeveniments.
- Publicació real en castellà o anglès.
- Filtres, cerca, paginació o calendari interactiu d'esdeveniments.
- Formularis, butlletí, correu o inscripcions gestionades pel web.
- Analítica web, cookies o gestió de consentiment.
- Auditoria manual d'accessibilitat o certificació WCAG completa.
- Regressió visual amb captures de Playwright.
- Comprovació remota exhaustiva d'enllaços externs.
- Search Console, enviament de sitemap o monitoratge SEO de producció.
- Previews de PR, Caddy, VPS i desplegament a producció.
- Servei Hono, xat públic o assistent editorial.
- React, Vue, base de dades, SSR o endpoints de servidor.

## Criteris D'Acceptació

La fase es considera completada quan:

1. Totes les unitats previstes estan vinculades a PRs revisades, validades i
   fusionades.
2. La portada, el hub i els tres detalls representatius es generen només des de
   contingut estructurat, aprovat i publicat.
3. La web actual no s'ha importat automàticament ni s'ha publicat cap dada sense
   revisió editorial explícita.
4. La portada segueix de manera adaptable la referència Stitch aprovada i les
   pantalles d'esdeveniments tenen referències desktop i mòbil aprovades.
5. `DESIGN.md` preval sobre el codi generat o les decisions puntuals de Stitch.
6. El shell, la navegació mòbil, el peu i la 404 funcionen en els tres motors i
   als viewports acordats.
7. Qui som, Socis i Escoles es comuniquen com a `Properament` sense enllaços
   trencats ni controls falsament interactius.
8. Els esdeveniments distingeixen publicació, vigència, temporalitat i estat
   d'inscripció sense dependre només del color.
9. Un esdeveniment vigent sense pròxima edició, real o representat per una
   fixture sintètica quan no existeixi un cas publicable, es renderitza com
   `Sense pròxima data anunciada` i no com a passat.
10. El selector d'idioma només deriva variants completes publicades i queda
    amagat a les pàgines reals només disponibles en català.
11. Canonical, Open Graph, `hreflang`, sitemap, robots i JSON-LD es generen només
    amb URL i dades públiques vàlides.
12. Els recursos tenen procedència i llicència revisades, les atribucions
    necessàries són visibles i no hi ha hotlinking editorial.
13. Les skills incorporades tenen origen, revisió, hash i llicència documentats,
    i han superat la revisió de seguretat i compatibilitat.
14. El wrapper local documenta ordres, rutes, llindars, evidències i precedència
    de les normes del projecte.
15. Playwright passa en Chromium, Firefox i WebKit per a mòbil i escriptori.
16. Les rutes representatives no tenen errors axe detectables i Lighthouse obté
    100 en Accessibility, sense presentar-ho com una auditoria manual completa.
17. Lighthouse mòbil obté com a mínim 90 en Performance i 100 en Best Practices
    i SEO, i es compleixen els pressupostos definits.
18. `pnpm validate` i `pnpm build` passen localment i a CI des d'una instal·lació
    neta amb les versions fixades.
19. No s'han introduït secrets, serveis de servidor, analítica, scripts de
    tercers ni contingut despublicat a la sortida pública.
20. `README.md`, `docs/architecture.md`, `docs/content-model.md`, el roadmap i
    aquesta especificació descriuen fidelment l'estat implementat en tancar la
    fase.
