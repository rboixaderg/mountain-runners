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

## Necessitats Obertes

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

**Dependències:** shell visual i primeres pantalles públiques implementades, i
entorn Playwright reproduïble localment i a CI.

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

**Seguiment:** pendent de triatge.

### Avaluació De TypeScript 7

**Estat:** Capturada.

**Problema:** abans de fixar la versió de TypeScript del projecte cal comprovar
si TypeScript 7 és prou estable i compatible amb Astro i la resta d'eines
previstes.

**Resultat esperat:** determinar si el projecte pot adoptar TypeScript 7 des de
l'inici o si convé mantenir temporalment una versió anterior, amb una decisió
justificada i reproduïble.

**Abans de planificar-ho cal definir:**

- l'estat i la disponibilitat de TypeScript 7 en el moment d'inicialitzar el
  projecte;
- la compatibilitat amb Astro, `astro check`, ESLint, Vitest i l'editor;
- les diferències de comportament o funcionalitats encara no disponibles;
- l'impacte sobre la CI, els temps de compilació i l'experiència de
  desenvolupament;
- una prova mínima que validi la configuració estricta i els fluxos previstos.

**Dependències:** inici de la fase d'inicialització de l'aplicació i versions
compatibles de l'ecosistema disponibles.

**Seguiment:** pendent de triatge.
