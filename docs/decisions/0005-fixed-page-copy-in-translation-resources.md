# ADR 0005: Textos De Pàgines Fixes Als Recursos De Traducció

## Estat

Acceptada.

## Context

L'ADR 0004 estableix que el codi conserva l'estructura estable i el YAML
restringit modela dades editorials o operatives. La seva excepció per a una
pàgina fixa amb edició recurrent pot induir a crear un esquema de contingut per
cada composició de pàgina. Això acobla canvis de text o de presentació amb el
model d'objectes editorials.

L'especificació de la fase 1 està tancada i no es modifica. Aquesta decisió
s'aplica a partir de la fase 2.

## Decisió

Les pàgines informatives fixes, com la portada, Qui som, Socis o Comunitat, no
es modelen com a entrades YAML ni com a objectes editorials. La seva estructura,
composició i recursos visuals controlats viuen en components. Els seus textos
viuen en recursos de traducció per idioma.

El YAML restringit queda reservat a objectes de domini amb identitat pròpia que
es representarien en una base de dades convencional: esdeveniments, escoles,
entitats, documents i les seves relacions, dates, estats, recursos i URL
associades. Els camps textuals d'aquests objectes continuen localitzats dins del
model.

Els recursos de traducció inclouen missatges d'interfície i textos informatius
de pàgines fixes. Cada idioma ha de proporcionar el mateix conjunt de claus;
una ruta pública només es genera quan les seves dependències editorials tenen la
traducció necessària.

## Conseqüències

- No es creen col·leccions ni esquemes YAML específics per a pàgines fixes.
- Un canvi de text de pàgina modifica el catàleg de traduccions, sense alterar
  un esquema editorial.
- Un canvi visual modifica el component corresponent, sense alterar un model de
  dades de pàgina.
- Les col·leccions de domini mantenen la validació estricta, la publicació i les
  regles de variants localitzades.
- Aquesta decisió concreta i substitueix l'excepció de l'ADR 0004 sobre esquemes
  específics de pàgines fixes.
