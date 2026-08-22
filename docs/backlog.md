# Backlog De Necessitats

## Propòsit

Aquest document és la bústia única per registrar necessitats, idees i mancances
que apareixen durant el projecte però que encara no formen part de l'abast
compromès d'una fase.

Registrar una necessitat no implica implementar-la. El roadmap continua sent la
font de veritat de les fases, i les especificacions de fase defineixen les
entregues compromeses.

## Flux De Triatge

1. **Capturada:** la necessitat queda registrada amb el problema que vol resoldre.
2. **En anàlisi:** es concreten valor, abast, dependències, riscos i criteris
   d'èxit.
3. **Incorporada:** es decideix convertir la necessitat en una entrega concreta
   i deixa de ser una entrada oberta del backlog.
4. **Descartada:** es documenta breument per què no es farà.

El backlog no assigna necessitats a fases ni en condiciona l'abast. Es revisa en
definir una nova especificació, quan entre les entregues d'una fase es detecta
una omissió i després de completar les fases previstes. En qualsevol d'aquests
moments es pot decidir convertir una entrada en una entrega autònoma amb la seva
especificació i pull request.

Una necessitat no s'afegeix silenciosament a una pull request activa. Si és prou
urgent per alterar l'ordre previst, primer se'n documenta l'abast, les
dependències i els criteris d'acceptació, i després s'entrega en una pull request
revisable.

Quan una necessitat incorporada requereixi seguiment independent, es pot crear
una issue enllaçada. Si canvia una frontera arquitectònica acceptada, també ha de
tenir un ADR.

## Informació Mínima

Cada entrada ha d'indicar:

- quin problema o oportunitat s'ha detectat;
- quin resultat s'espera, sense prescriure encara tota la implementació;
- estat de triatge;
- dependències, riscos o decisions pendents rellevants;
- enllaç a l'especificació, pull request, issue o ADR si finalment s'hi
  incorpora.

## Necessitats Incorporades

### Segments De Ruta Localitzats

**Estat:** Incorporada a la fase 2.

**Problema:** actualment els slugs editorials es poden traduir, però els segments
de domini de les URLs són fixos en anglès, com `/ca/schools/{slug}/` i
`/ca/events/{slug}/`. Això produeix URLs parcialment localitzades.

**Resultat esperat:** definir en codi els segments canònics per idioma i tipus de
contingut, de manera que les rutes puguin ser, per exemple,
`/ca/escoles/{slug}/`, `/es/escuelas/{slug}/` i
`/en/schools/{slug}/`, mantenint els slugs editorials traduïbles.

**Abans de planificar-ho cal definir:**

- els segments canònics de cada domini i idioma, incloent-hi reserves i
  col·lisions amb rutes tècniques o fixes;
- la configuració tipada en codi que els representi, d'acord amb l'ADR 0004;
- l'adaptació de les rutes estàtiques d'Astro, generació de URLs canòniques i
  `hreflang`;
- les proves de rutes, variants publicades i absència de col·lisions;
- la política de redireccions si alguna URL ja publicada canvia.

**Dependències:** decisió sobre els noms canònics i una fase que modifiqui la
superfície pública de rutes.

**Seguiment:** [especificació de la fase 2](specs/phase-2-public-vertical-slice.md).

Implementada i fusionada a la T2.3 (PR #17). Es conserva aquí només com a
registre del triatge; les rutes actuals viuen al contracte tipat de
`apps/web/src/lib/content/routes.ts`.

### Revisar La Informació De Berga Trail I La Marató De Muntanya De Berga

**Estat:** Incorporada a la PR #65 (esdeveniments del Berguedà).

**Problema:** cal revisar la informació publicada de Berga Trail i la seva
relació amb la Marató de Muntanya de Berga per assegurar que la denominació,
la història, les edicions, les distàncies i l'estat actual de l'esdeveniment són
correctes i no barregen etapes diferents de la cursa.

**Resultat esperat:** disposar d'una fitxa de Berga Trail contrastada amb fonts
fiables i validada pel club, amb una explicació clara de la relació i l'evolució
entre la Marató de Muntanya de Berga i Berga Trail.

**Abans de planificar-ho cal definir:**

- les fonts i les persones del club que poden validar la informació històrica;
- la cronologia, els canvis de nom i les modalitats de cada edició;
- quines dades i traduccions de la fitxa publicada s'han de corregir;
- si cal recuperar fotografies, documents o enllaços històrics addicionals.

**Dependències:** validació editorial del club i accés a fonts històriques
fiables de l'esdeveniment.

**Seguiment:** la fitxa publicada de Berga Trail, creada i fusionada a la PR
#65, ja recull la cronologia, la relació amb la Marató de Muntanya de Berga, la
creació de Les Clàssiques de Berga, les distàncies de l'edició registrada i
l'estat actual de la cursa. Es conserva aquí com a registre del triatge; queda
pendent només la validació formal del club sobre aquestes dades.

### Revisió Dels Estils Globals I De Les Instruccions D'Ús De Tailwind

**Estat:** Incorporada a la fase 4.

> **Nota d'auditoria (15 d'agost de 2026):** el triatge d'aquesta entrada es
> tanca: la revisió dels estils globals i de les instruccions es va completar
> dins la fase 4 (PR #49 i l'actualització de `docs/code-conventions.md`).
> `global.css` té 123 rengles, el CSS està distribuït per propietari i les
> instruccions fixen les utilities de Tailwind com a primera opció. Si més
> endavant apareixen duplicacions concretes, es capturarà una necessitat nova
> amb aquell abast.

**Problema:** els estils globals de l'aplicació
(`apps/web/src/styles/global.css`) acumulen prop de dos milers de línies amb
classes CSS pròpies (homepage, events-hub, schools, about, page, members...),
mentre que Tailwind forma part de l'stack però gairebé no s'utilitza. A més, les
instruccions que reben els agents per estilitzar no delimiten quan cal fer
servir utilities de Tailwind i quan cal crear una classe CSS pròpia, cosa que
afavoreix que el CSS global continuï creixent i que cada pàgina reprodueixi
patrons semblants per separat.

**Resultat esperat:** revisar els estils globals i les directrius d'estil per
determinar quins estils es poden expressar amb utilities de Tailwind (amb
`@theme` per als tokens) i quins han de continuar com a CSS propi, i actualitzar
les instruccions als agents perquè l'ús de Tailwind sigui la norma, sense
canviar la sortida visual actual.

**Abans de planificar-ho cal definir:**

- el criteri per decidir entre utilities de Tailwind i classes CSS pròpies:
  composició de patrons repetits (kickers, marcs, seccions, enllaços d'acció),
  estats, selectors o `clamp()` que les utilities no cobreixen, i si convé
  `@apply` només per als patrons que es repeteixen de veritat;
- la migració dels tokens actuals (`--color-*`, `--font-*`, `--space-*`,
  `--page-width`, `--reading-width`) al `@theme` de Tailwind 4 i la
  correspondència amb les utilities generades;
- com es redueix el CSS global aprofitant les classes existents per detectar
  patrons duplicats entre pàgines (events-hub i schools-hub, intro i seccions
  editorials, about i fixed pages) sense alterar el resultat visual;
- quines instruccions s'han d'actualitzar (`AGENTS.md`,
  `docs/code-conventions.md` i els skills de la UI) i com es revisa el seu
  compliment a les PR;
- les comprovacions que garanteixin que el refactor no canvia la sortida:
  regressió visual, selectors E2E existents i els llindars de Lighthouse.

**Dependències:** revisió de les convencions i de les instruccions als agents,
i una fase que toqui la capa de presentació de l'aplicació.

**Seguiment:** coberta per la fase 4 (T4.4, PR #49).

### Analítica Web Respectuosa Amb La Privacitat

**Estat:** Incorporada com a entrega autònoma.

**Problema:** després de publicar la nova web caldrà entendre quines pàgines i
continguts són útils, sense introduir analítica publicitària ni un seguiment
invasiu de les persones visitants.

**Resultat esperat:** disposar de mètriques mínimes i accionables de la web
pública mitjançant Plausible autoallotjat, mantenint-lo com un servei operatiu
separat de la compilació estàtica.

**Dependències:** web pública funcional, destí de producció definit i instància
Plausible existent a `analytics.rogerbg.cat`.

**Seguiment:** [especificació d'analítica Plausible](specs/plausible-analytics.md)
i [ADR 0007](decisions/0007-self-hosted-plausible-analytics.md). La T1 està
fusionada a la PR #90. Els esdeveniments d'acció i el temps d'estada es recullen
a l'entrada oberta corresponent; no s'amplien silenciosament aquesta entrega.

## Necessitats Obertes

### Esdeveniments D'Acció I Temps D'Estada

**Estat:** Incorporada com a entrega autònoma (T2 d'analítica Plausible).

**Problema:** les visites de pàgina i els comptadors automàtics de clics sortints,
baixades i formularis no expliquen quines accions de la web pública són útils
(inscripció, alta de soci, butlletí, documents, navegació, selector d'idioma) ni
quant de temps visible passen les persones visitants a cada pàgina o a la visita.
Sense aquestes mètriques agregades el club no pot prioritzar contingut ni
detectar recorreguts que acaben en una acció.

**Resultat esperat:** emetre esdeveniments personalitzats agregats a Plausible
per a les accions rellevants de la interfície i mesurar l'estona activa d'estada
i la profunditat de scroll, amb llindars reproduïbles, sense cookies pròpies no
tècniques, sense identificadors persistents i sense que una fallada de
l'analítica trenqui la navegació. Els textos de privacitat i de cookies han de
descriure aquests esdeveniments reals.

**Abans de planificar-ho cal definir:**

- el catàleg tancat d'esdeveniments i propietats (noms estables, àrea de la
  pàgina, locale, ruta, tipus de pàgina) per a accions com la navegació de la
  capçalera i el peu, el selector d'idioma, les inscripcions i informació
  d'esdeveniments i escoles, l'alta de soci i la federació, el butlletí, els
  documents i estatuts, els enllaços de contacte i xarxes, els col·laboradors i
  els recorreguts del calendari;
- el solapament entre els comptadors automàtics de clics sortints, baixades i
  enviaments de formulari i els esdeveniments personalitzats, acceptat i
  documentat a l'especificació: el comptador automàtic no aporta ni àrea de la
  pàgina ni identitat de l'acció;
- el mesurament del temps i de la profunditat: només temps visible (pausa amb la
  pestanya oculta), llindars per pàgina (per exemple 15, 30, 60 i 120 segons) i
  llindars de scroll (50% i 90%), una vegada per llindar i càrrega de pàgina, i
  si cal una agregació de l'estona total de la visita sense emmagatzemar
  identificadors persistents;
- el contracte de privacitat: etiquetes sanititzades i truncades, cap adreça de
  correu, telèfon, query string ni text lliure que pugui identificar una
  persona; propietats només agregables;
- com s'executa el client a un lloc estàtic multipàgina: script servit per
  `'self'`, sense `unsafe-inline` a `script-src`, i reinici del temps a cada
  càrrega de pàgina;
- l'actualització de privacitat i cookies en ca/es/en, i si cal ampliar l'ADR
  0007 o l'especificació d'analítica ja acceptada;
- les comprovacions: el catàleg d'esdeveniments està cobert per proves, el
  recorregut E2E continua funcionant amb l'origen de Plausible bloquejat i no es
  canvien rutes, contingut editorial ni selectors E2E existents.

**Seguiment:** [especificació d'analítica Plausible](specs/plausible-analytics.md)
(T2). Implementació a la branca `feat/analytics-events`.

### Entrada Sense Idioma Més Ràpida

**Estat:** Incorporada com a entrega autònoma.

**Problema:** quan una persona visita l'origen sense prefix d'idioma (per
exemple `https://mountainrunners.cat/`), la web redirigeix al català
(`/ca/`). Avui aquesta resposta es percep lenta: l'arrel emet un document
mínim amb `meta refresh` cap a `/ca/` en lloc de servir ja el contingut
català o una redirecció HTTP immediata. Això afegeix un salt perceptible
abans de veure la pàgina d'inici.

**Resultat esperat:** analitzar i triar una estratègia perquè l'entrada sense
idioma mostri el català amb menys latència —servir el català per defecte a
l'arrel, una redirecció HTTP ràpida a la vora o al servidor, o una altra
opció compatible amb el contracte d'i18n— sense perdre URLs canòniques,
`hreflang`, SEO ni el selector d'idioma.

**Abans de planificar-ho cal definir:**

- la causa mesurable de la lentitud (document intermedi amb `meta refresh`,
  cadena de redireccions Astro/`redirectToDefaultLocale`, o latència de
  xarxa) i un criteri d'èxit (temps fins al primer contingut útil);
- si es pot servir el català a `/` sense prefix, mantenint `/ca/`, `/es/` i
  `/en/` com a rutes publicades, o si cal conservar sempre el prefix i només
  accelerar la redirecció (HTTP 301/302 a Caddy o a l'artefacte);
- l'impacte sobre `prefixDefaultLocale`, canòniques, `hreflang`, sitemap,
  robots i proves que avui exigeixen que l'arrel redirigeixi a `/ca/`;
- la coherència amb l'entrada de declaració de rutes per idioma i amb el
  contracte tipat de rutes;
- les comprovacions de regressió: arrel, variants localitzades, E2E del shell
  i matriu de rutes.

**Dependències:** configuració i18n d'Astro (`prefixDefaultLocale` i
`redirectToDefaultLocale`), pàgina arrel i, si s'opta per redirecció al
servidor, el `Caddyfile` de producció.

**Seguiment:** la causa és el `200` de l'arrel que serveix l'`index.html` amb
`meta refresh` al cap de 2 segons; una mesura des de desenvolupament el 21
d'agost de 2026 va registrar, a més, 225 ms fins al primer byte d'aquest
document intermedi. La
[PR #95](https://github.com/rboixaderg/mountain-runners/pull/95) incorpora una
redirecció HTTP permanent i exacta de `/` a `/ca/` a Caddy, la comprovació del
contracte viu i les instruccions d'activació. El criteri d'èxit és que l'arrel
respongui directament amb `301` o `308` i `Location: /ca/`, sense servir el
document intermedi.

### Equipa't Amb Nosaltres

**Estat:** Capturada.

**Problema:** la web no disposa d'un espai on les persones sòcies i seguidores
puguin consultar tota la roba disponible amb la marca de Mountain Runners.

**Resultat esperat:** crear una nova secció pública «Equipa't amb nosaltres» que
presenti de manera clara el catàleg complet de roba del club, amb la informació
i les imatges necessàries per conèixer cada peça i saber com adquirir-la.

**Abans de planificar-ho cal definir:**

- quines dades tindrà cada peça, com ara nom, descripció, fotografies, talles,
  preu, disponibilitat i instruccions de compra;
- qui mantindrà el catàleg i com es gestionaran els canvis d'estoc, preu o
  temporada;
- si la secció serà només informativa, enllaçarà a un canal extern o requerirà
  un procés propi de reserva, comanda o pagament;
- l'estructura de contingut, les traduccions i la integració amb la navegació i
  el sistema visual actuals;
- els drets d'ús de les fotografies i les necessitats d'accessibilitat, proves i
  seguiment de les accions de compra.

**Dependències:** inventari validat de peces, fotografies i informació
comercial; decisió sobre el procés d'adquisició i la persona responsable de
mantenir el catàleg actualitzat.

**Seguiment:** pendent de triatge.

### Revisar El Directori De Col·laboradors

**Estat:** Capturada.

**Problema:** cal comprovar que el directori actual de col·laboradors representa
les entitats que continuen col·laborant amb Mountain Runners, retirar o marcar
les que ja no estan actives i detectar nous col·laboradors que encara no hi
apareixen.

**Resultat esperat:** disposar d'un directori complet, vigent i validat pel club,
amb l'estat i la informació correcta de cada col·laborador.

**Abans de planificar-ho cal definir:**

- la persona del club que validarà les altes, baixes i continuïtats;
- la llista completa de col·laboradors actuals i les noves incorporacions;
- quina informació cal actualitzar de cada entitat, incloent-hi nom, logotip,
  enllaç, descripció i avantatge per a les persones sòcies;
- com es representaran els col·laboradors inactius i si s'han de conservar com a
  informació històrica o retirar de la publicació;
- la procedència, els drets d'ús i l'accessibilitat dels logotips i les imatges.

**Dependències:** inventari actual contrastat i validació de la junta o de la
persona responsable de les relacions amb els col·laboradors.

**Seguiment:** pendent de triatge.

### Separar La Presentació Del Contacte I Simplificar Les Validacions

**Estat:** Incorporada (entrega en curs).

**Problema:** el contingut de contacte desa informació pròpia del render HTML,
com els protocols `mailto:` i `tel:`, en lloc de representar només les dades
editorials. Això barreja el model de contingut amb la responsabilitat de la
interfície. A més, el model actual aplica més validacions de les necessàries en
alguns camps, cosa que pot fer que el catàleg estigui sobrevalidat i sigui més
difícil d'editar sense aportar una garantia real per a la sortida publicada.

**Resultat esperat:** modificar el model i el render del contacte perquè les
dades emmagatzemin valors semàntics i el component construeixi els atributs i
protocols HTML necessaris. Revisar les validacions del contingut i conservar
només les que siguin necessàries per al contracte editorial, la seguretat o la
correctesa de la sortida. Documentar aquesta regla com a convenció de codi:
validar a la frontera corresponent, sense duplicar ni anticipar al model de
dades restriccions que pertanyen al render.

**Abans de planificar-ho cal definir:**

- la representació canònica de correus i telèfons al contingut i la forma
  segura de convertir-la en `href` i text visible;
- quines validacions del contacte i dels primitives de contingut són garanties
  necessàries i quines només repliquen decisions de presentació;
- la compatibilitat amb les dades publicades, les traduccions i els selectors o
  contractes de proves existents;
- l'actualització de `docs/code-conventions.md` i, si escau, de les instruccions
  resumides a `AGENTS.md`;
- les proves de model, render i seguretat que demostrin que es manté la sortida
  correcta sense conservar validacions redundants.

**Dependències:** revisió del model de contingut de contacte i dels components
que el renderitzen; no cal canviar cap frontera arquitectònica acceptada si la
separació es manté dins del model i la capa de presentació existents.

**Seguiment:** entrega en curs a la branca `refactor/contact-semantic-values`;
PR pendent de revisió.

### Regressió Visual De Les Pantalles Principals

**Estat:** Capturada.

**Problema:** els canvis de components, estils o contingut poden introduir
regressions visuals que les proves funcionals i d'accessibilitat no detectin.

**Resultat esperat:** utilitzar Playwright per generar i comparar captures de
referència de les pantalles principals en els viewports acordats, i mostrar les
diferències com a artefactes de la CI.

**Abans de planificar-ho cal definir:**

- les rutes principals i els viewports que formaran la cobertura mínima;
- com estabilitzar fonts, imatges, animacions, dates i altres dades variables;
- on es versionen les captures de referència i com se n'aproven els canvis;
- els llindars de diferència acceptables i el comportament de la CI;
- com s'amplia la cobertura quan s'afegeixen noves plantilles.

**Dependències:** complertes. El shell i Playwright ja estan implementats; la
fase 4 només va fer una comparació puntual i encara no hi ha baselines
versionades ni regressió visual a CI.

**Seguiment:** pendent de triatge.

### Auditoria Manual D'Accessibilitat

**Estat:** Capturada.

**Problema:** les comprovacions automatitzades poden detectar una part dels
problemes d'accessibilitat, però no poden validar completament l'experiència amb
teclat, lector de pantalla, zoom ni tecnologies d'assistència.

**Resultat esperat:** revisar manualment recorreguts representatius de la web per
identificar barreres que no cobreixen Lighthouse, axe ni les proves end-to-end,
i documentar els resultats i les correccions necessàries.

**Abans de planificar-ho cal definir:**

- les pàgines, recorreguts i estats que formaran la mostra;
- els navegadors, sistemes operatius i tecnologies d'assistència que es provaran;
- les comprovacions mínimes de teclat, ordre i visibilitat del focus, lector de
  pantalla, zoom i reflow;
- com es registren, prioritzen i tornen a validar les incidències;
- quan convé repetir l'auditoria a mesura que creixi la cobertura pública.

**Dependències:** recorreguts públics representatius implementats i validacions
automatitzades d'accessibilitat disponibles.

**Seguiment:** la revisió manual de llançament s'ha incorporat a T5.5; una
cobertura recurrent posterior continua pendent de triatge.

### Avaluació De TypeScript 7

**Estat:** Capturada.

**Problema:** el projecte ja està inicialitzat i fixa TypeScript 6.0.3. Quan
TypeScript 7 sigui estable caldrà comprovar si l'ecosistema actual permet
actualitzar-lo sense degradar el typecheck, l'editor ni les proves.

**Resultat esperat:** decidir si es pot actualitzar de TypeScript 6 a 7 amb una
prova reproduïble i un canvi de dependències acotat, o documentar per què es
manté temporalment la versió actual.

**Abans de planificar-ho cal definir:**

- l'estat i la disponibilitat estable de TypeScript 7 en el moment d'avaluar
  l'actualització;
- la compatibilitat amb Astro, `astro check`, ESLint, Vitest i l'editor;
- les diferències de comportament o funcionalitats encara no disponibles;
- l'impacte sobre la CI, els temps de compilació i l'experiència de
  desenvolupament;
- una prova mínima que validi la configuració estricta i els fluxos previstos.

**Dependències:** release estable de TypeScript 7 i versions compatibles d'Astro,
`astro check`, ESLint, Vitest i les eines d'editor.

**Seguiment:** pendent de triatge.

### Esdeveniments Recurrents Només Al Calendari

**Estat:** Capturada.

**Problema:** el calendari del hub d'esdeveniments només pot mostrar edicions
amb dates explícites de la col·lecció `events`. Les activitats que es repeteixen
amb regularitat —com les sessions de les escoles o les trobades periòdiques— no
tenen cap representació pròpia i, si es volguessin mostrar al calendari,
apareixerien també als llistats del hub (properes, actives sense data i
passades), que és exactament el que no es vol per a aquestes activitats.

**Resultat esperat:** disposar d'un nivell de contingut recurrent (per exemple,
horaris o esdeveniments recurrents) que generi les seves ocurrències al
calendari en les dates corresponents i que quedi exclòs dels llistats
d'esdeveniments. Cal poder expressar pautes com ara setmanals, quinzenals o
mensuals, amb excepcions, i un horitzó de generació delimitat.

**Abans de planificar-ho cal definir:**

- el model de contingut de la recurrència: pauta, data d'inici i final,
  excepcions (festius, vacances) i si viu en una col·lecció pròpia, com a camp
  d'un esdeveniment o vinculada a una escola o entitat;
- si les entrades recurrents tenen fitxa pròpia, enllacen a una fitxa existent
  (per exemple, la de l'escola) o només tenen presència al calendari;
- la validació editorial (YAML restringit i esquemes Zod) i la publicació per
  idioma, coherents amb el model de contingut actual;
- l'expansió de les ocurrències: horitzó màxim de generació i comportament als
  límits de mes, evitant generar un nombre il·limitat de dates;
- la integració amb el calendari actual: com es combinen els títols de diverses
  ocurrències i esdeveniments en un mateix dia sense alterar la sortida visual
  dels esdeveniments existents;
- els missatges d'interfície i l'accessibilitat del calendari quan un dia conté
  tant esdeveniments com ocurrències recurrents;
- les proves de les funcions de presentació pures i dels casos límit: inici i
  final de pauta, excepcions, anys de traspàs i canvis de mes.

**Dependències:** calendari del hub d'esdeveniments (T4.4) integrat a `main` i
decisió sobre el model de contingut de la recurrència.

**Seguiment:** pendent de triatge.

### Revisió Del Prop Drilling Del Locale Entre Components

**Estat:** Capturada.

> **Nota d'auditoria (15 d'agost de 2026):** el problema continua sent vàlid i
> l'inventari actual de consumidors de la prop `locale` afegeix els components
> d'escoles de la fase 4 (`SchoolDetail`, `SchoolHub`, `SchoolPreview*`,
> `SchoolGallery`, `SchoolRegistration`, `SchoolVideo`), a més de la cadena
> d'esdeveniments (`EventDetail`, `EventPracticalInfo`, `EventResources`,
> `EventHistory`, `EventEntities`, `EventStatus`) i de `ContactDataList`,
> `SiteFooter` i `PreFooter`. Les pàgines ja llegeixen `Astro.currentLocale`;
> els components fulla encara reben el locale com a prop. Cal mantenir aquest
> inventari quan es converteixi l'entrada en una especificació.

**Problema:** el locale es transmet com a prop per tota l'arbre de components:
cada pàgina el passa als templates de detall, cada template a les seves seccions
i les seccions als components fulla. Per exemple, `EventDetail` el reenvia a
`EventPracticalInfo`, `EventResources`, `EventHistory`, `EventEntities`,
`EventStatus` i `ExternalLink`, i `SiteFooter` a `ContactDataList`. Això obliga
a declarar `locale: Locale` a les props de gairebé tots els components, encara
que la majoria només el facin servir per cridar els missatges de Paraglide, i
fa cada component més sorollós i més acoblat al routing d'i18n.

**Resultat esperat:** revisar com es transmet el locale entre components i
trobar el mecanisme menys sorollós perquè qualsevol component pugui accedir al
locale vigent —per exemple, `Astro.currentLocale` directament als components,
el locale exposat des del middleware, o limitar les props a les fronteres de
l'arbre— sense perdre la tipificació ni la puresa de la capa de presentació.

**Abans de planificar-ho cal definir:**

- quins components necessiten realment el locale i per a què (missatges de
  Paraglide, dades localitzades de contingut, URLs), per saber on es pot
  substituir la prop;
- si `Astro.currentLocale` està disponible als components renderitzats dins
  d'una pàgina amb la configuració actual (Paraglide i Astro) i com es
  comporta a la pàgina 404 i a rutes sense segment d'idioma;
- les alternatives: `Astro.currentLocale` directe, middleware que exposi el
  locale a `Astro.locals`, o mantenir les props només a les fronteres
  (pàgina → template → secció);
- l'impacte sobre `docs/code-conventions.md` i les instruccions als agents,
  que avui assumeixen el pas del locale com a prop;
- com es valida el canvi: proves existents, totes les pàgines i variants
  publicades, i el comportament del selector d'idioma.

**Dependències:** revisió de les convencions i de les instruccions als agents
(comparteix àmbit amb la revisió dels estils globals) i una fase que toqui la
capa de presentació de l'aplicació.

**Seguiment:** pendent de triatge.

### Declaració De Rutes Per Idioma

**Estat:** Capturada.

> **Nota d'auditoria (10 d'agost de 2026):** els dominis d'escoles i
> esdeveniments ja estan centralitzats a `src/lib/content/routes.ts`. El triatge
> s'ha de limitar a la duplicació de fitxers de pàgines fixes i al seu contracte
> de completesa per idioma, no reobrir la T2.3.

**Problema:** cal determinar si l'estructura actual obliga a declarar
explícitament totes les rutes per a cada idioma, o si Astro i la configuració
d'i18n permeten gestionar-les d'una manera més neta, centralitzada i menys
repetitiva.

**Resultat esperat:** disposar d'una decisió documentada sobre l'estratègia de
routing multilingüe, incloent-hi l'impacte en les rutes estàtiques, els slugs,
les URLs canòniques, `hreflang`, la pàgina 404 i el selector d'idioma.

**Abans de planificar-ho cal definir:**

- quines parts de les rutes s'han de declarar per idioma i quines es poden
  derivar de la configuració o de les dades de contingut;
- quines capacitats ofereixen Astro i la integració d'i18n actual per evitar
  duplicació sense perdre control sobre les rutes publicades;
- com es comporten les rutes amb slugs localitzats, les variants inexistents i
  les URLs canòniques;
- les implicacions per a `getStaticPaths`, la generació de `hreflang`, el
  selector d'idioma i les proves de rutes;
- si la solució manté la tipificació, la traçabilitat editorial i l'absència de
  col·lisions amb rutes fixes o tècniques.

**Dependències:** revisió de l'estratègia actual d'i18n i de les rutes
localitzades, inclosa l'entrada de segments de ruta localitzats.

**Seguiment:** pendent de triatge.
