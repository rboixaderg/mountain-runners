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

## Necessitats Obertes

### Analítica Web Respectuosa Amb La Privacitat

**Estat:** Capturada.

**Problema:** després de publicar la nova web caldrà entendre quines pàgines i
continguts són útils, sense introduir analítica publicitària ni un seguiment
invasiu de les persones visitants.

**Resultat esperat:** disposar de mètriques mínimes i accionables de la web
pública mitjançant Plausible autoallotjat al VPS, mantenint-lo com un servei
operatiu separat de la compilació estàtica.

**Abans de planificar-ho cal definir:**

- les preguntes que han de respondre les mètriques i els esdeveniments realment
  necessaris;
- els requisits legals i de consentiment aplicables a la configuració escollida;
- el cost de CPU, memòria i disc al VPS compartit;
- actualitzacions, còpies de seguretat, restauració, salut i retenció de dades;
- l'aïllament, TLS i accés al tauler d'administració;
- si una fallada de l'analítica pot quedar completament desacoblada de la web;
- els criteris d'acceptació i la documentació operativa necessària.

**Dependències:** web pública funcional, destí de producció definit i operació
del VPS preparada.

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

**Seguiment:** la revisió manual de llançament s'ha incorporat a T5.6; una
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

### Revisió Dels Estils Globals I De Les Instruccions D'Ús De Tailwind

**Estat:** Capturada.

> **Nota d'auditoria (10 d'agost de 2026):** la premissa d'aquesta entrada va
> quedar superada per la PR #49: `global.css` té 123 rengles, el CSS està
> distribuït per propietari i `docs/code-conventions.md` ja fixa Tailwind com a
> primera opció. No s'ha de triar aquesta necessitat amb l'abast actual; només es
> conserva fins que la persona autora decideixi descartar-la o redefinir-la al
> voltant de duplicacions concretes encara existents.

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

**Seguiment:** pendent de triatge.

### Revisió Del Prop Drilling Del Locale Entre Components

**Estat:** Capturada.

> **Nota d'auditoria (10 d'agost de 2026):** el problema general continua sent
> vàlid, però alguns exemples de la cadena de props ja no coincideixen amb els
> components finals de la fase 4. Cal actualitzar l'inventari de consumidors
> abans de convertir l'entrada en una especificació.

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
