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
