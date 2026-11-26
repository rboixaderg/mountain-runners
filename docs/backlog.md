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
3. **Incorporada:** es converteix en una especificació o pull request pròpia,
   surt de «Necessitats Obertes» i es redueix a una fila d'enllaç a
   «Necessitats Incorporades», sense duplicar el contingut del document
   propietari.
4. **Descartada:** es retira del backlog i el motiu queda registrat a la pull
   request o a l'historial de Git.

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

Cada entrada oberta ha d'indicar:

- quin problema o oportunitat s'ha detectat;
- quin resultat s'espera, sense prescriure encara tota la implementació;
- estat de triatge;
- dependències, riscos o decisions pendents rellevants;
- enllaç a l'issue si en té.

## Necessitats Obertes

### Lectura De PDF Per L'Agent Privat

**Estat:** Capturada.

**Problema:** l'agent privat de Telegram no pot interpretar documents PDF
adjunts al xat ni llegir PDF accessibles a través d'una URL.

**Resultat esperat:** permetre que l'agent consulti el contingut de PDF rebuts
al xat o disponibles a internet per respondre preguntes i preparar tasques
autoritzades.

**Abans de planificar-ho cal definir:**

- el tractament de PDF amb text i de documents escanejats;
- els límits de mida, pàgines i recursos, i el tractament de fitxers no fiables;
- la privacitat dels documents i les restriccions d'accés a URLs;
- les dependències, les proves i els canvis necessaris a les fronteres existents.

**Dependències:** revisió de seguretat i definició de la ingesta d'adjunts i
de l'accés extern.

**Seguiment:** pendent de triatge.

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

### Enllaços Directes A Les Seccions De La Web

**Estat:** Capturada.

**Problema:** no totes les seccions de contingut de la web es poden compartir o
obrir directament amb un enllaç propi. Per exemple, cal poder enllaçar la secció
de col·laboradors de la pàgina de socis.

**Resultat esperat:** poder obrir i compartir una URL que porti directament a
cadascuna de les seccions de contingut de les pàgines públiques, per exemple
`/ca/socis/#collaboradors`.

**Abans de planificar-ho cal definir:**

- quines seccions i rutes públiques entren a l'abast;
- el contracte dels identificadors de fragment i si es mantenen coherents entre
  idiomes;
- com es descobreixen i es copien els enllaços, inclosa l'accessibilitat dels
  controls;
- com es comproven els fragments, les destinacions i el desplaçament a la secció
  objectiu en totes les variants publicades.

**Dependències:** inventari de les seccions de contingut i decisió sobre el
comportament dels enllaços directes.

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

### Butlletí I Analítica Del Club

**Estat:** Capturada.

**Problema:** el club no té cap canal propi per enviar el butlletí.

**Resultat esperat:** allotjar listmonk al VPS de Mountain Runners sota
`newsletter.mountainrunners.cat`, fer sortir el correu per un relé SMTP extern en
lloc de des del servidor, deixar el formulari d'alta a càrrec de listmonk i
decidir si cal una segona instància de Plausible o n'hi ha prou amb el lloc nou a
la instància existent. Abans d'activar res cal especificar privacitat, accessos,
còpies, actualitzacions i reversió.

**Seguiment:** pendent de triatge.

## Necessitats Incorporades

Les entrades ja especificades o fusionades no dupliquen el detall aquí; el
seguiment i l'acceptació viuen al document propietari o a la pull request.

| Necessitat                                                            | Seguiment                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Segments de ruta localitzats                                          | [Especificació de la fase 2](specs/phase-2/phase-2-public-vertical-slice.md), T2.3                                              |
| Revisar la informació de Berga Trail i la Marató de Muntanya de Berga | [PR #65](https://github.com/rboixaderg/mountain-runners/pull/65), pendent de validació històrica formal del club                |
| Revisió dels estils globals i de les instruccions d'ús de Tailwind    | [Especificació de la fase 4](specs/phase-4/phase-4-design-content-validation.md) i [`code-conventions.md`](code-conventions.md) |
| Separar la presentació del contacte i simplificar les validacions     | [PR #70](https://github.com/rboixaderg/mountain-runners/pull/70) i [`code-conventions.md`](code-conventions.md)                 |
| Analítica web respectuosa amb la privacitat                           | [`specs/plausible-analytics.md`](specs/plausible-analytics.md) i [ADR 0007](decisions/0007-self-hosted-plausible-analytics.md)  |
| Entrada sense idioma més ràpida                                       | [PR #95](https://github.com/rboixaderg/mountain-runners/pull/95)                                                                |
| Esdeveniments d'acció i temps d'estada                                | [`specs/plausible-analytics.md`](specs/plausible-analytics.md), T2                                                              |
| Avaluar notícies, blog i estructures editorials reutilitzables        | [`specs/news-and-blog.md`](specs/news-and-blog.md) i [ADR 0011](decisions/0011-news-blog-editorial-previews.md)                 |
| Desactivar l'analítica en mode preview                                | [`specs/plausible-analytics.md`](specs/plausible-analytics.md), T3                                                              |
| Redirigir les URLs de llegat amb trànsit                              | [`specs/legacy-url-redirects.md`](specs/legacy-url-redirects.md)                                                                |
| Revisar els enllaços per a agents i el disseny de la pàgina 404       | [PR #161](https://github.com/rboixaderg/mountain-runners/pull/161) i [`architecture.md`](architecture.md)                       |
| Entrenaments funcionals per a socis                                   | [`specs/member-services.md`](specs/member-services.md)                                                                          |
| Observabilitat de totes les peticions a l'origen                      | [`specs/request-observability.md`](specs/request-observability.md) i [ADR 0008](decisions/0008-request-observability.md)        |
| Demanar la preview amb una etiqueta de la PR                          | [`specs/preview-label.md`](specs/preview-label.md)                                                                              |
| Retirar la petició de preview amb `/preview`                          | [`specs/retire-preview-command.md`](specs/retire-preview-command.md)                                                            |
| Govern de la documentació i de les skills                             | [`specs/docs-governance.md`](specs/docs-governance.md)                                                                          |
| Fusionar quan la persona dona la feina per validada                   | [`specs/preview-merge-confirmation.md`](specs/preview-merge-confirmation.md)                                                    |
| Sincronitzar la branca abans del merge                                | [`specs/agent-sync-before-merge.md`](specs/agent-sync-before-merge.md)                                                          |
