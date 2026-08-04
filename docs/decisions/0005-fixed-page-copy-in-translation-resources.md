# ADR 0005: Textos De Pàgines Fixes Als Recursos De Traducció

## Estat

Acceptada.

## Relació Amb ADR 0004

L'ADR 0004 no es modifica: conserva el seu valor històric i continua governant
l'estructura estable, la inexistència d'un constructor genèric de pàgines i els
objectes editorials de domini. Aquest ADR substitueix únicament la seva excepció
que permet afegir un esquema YAML específic a una pàgina fixa amb edició
recurrent.

Quan una regla de l'ADR 0004 i aquesta decisió difereixin sobre una pàgina fixa,
preval l'ADR 0005. Per a la resta de casos, preval l'ADR 0004.

## Context

L'ADR 0004 estableix que el codi conserva l'estructura estable i el YAML
restringit modela dades editorials o operatives. La seva excepció per a una
pàgina fixa amb edició recurrent pot induir a crear un esquema de contingut per
cada composició de pàgina. Això acobla canvis de text o de presentació amb el
model d'objectes editorials.

L'especificació de la fase 1 està tancada i no es modifica. Aquesta decisió
s'aplica a partir de la fase 2.

## Decisió

Una pàgina fixa té ruta, seccions i ordre estables; no conté blocs reordenables
ni dades amb identitat pròpia. La portada, Qui som, Socis i Comunitat en són
exemples. Si una necessitat no compleix aquesta definició, no s'hi afegeix YAML
per excepció: requereix una decisió arquitectònica nova.

| Element                                       | Pàgina fixa                                                                                           | Objecte de domini                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Estructura i composició                       | Component                                                                                             | Plantilla o component que en mostra el model    |
| Text informatiu                               | Recursos de traducció                                                                                 | Camp localitzat del model YAML                  |
| Recurs visual                                 | Import controlat del component                                                                        | Recurs YAML amb la seva procedència i atribució |
| Data, estat, preu, inscripció o URL operativa | No s'afegeix com a dada de pàgina; ha de pertànyer a un objecte de domini o requerir una decisió nova | Camp validat del model YAML                     |

Els recursos de traducció inclouen missatges d'interfície i textos informatius
de pàgines fixes. Cada idioma ha de proporcionar el mateix conjunt de claus. Els
objectes de domini només generen una ruta pública quan tenen les traduccions i
dependències editorials requerides.

## Conseqüències

- No es creen col·leccions ni esquemes YAML específics per a pàgines fixes.
- Un canvi de text de pàgina modifica el catàleg de traduccions, sense alterar
  un esquema editorial.
- Un canvi visual modifica el component corresponent, sense alterar un model de
  dades de pàgina.
- Les col·leccions de domini mantenen la validació estricta, la publicació i les
  regles de variants localitzades.
- La classificació d'aquesta decisió és l'única font normativa per decidir on viu
  un element de contingut de pàgina fixa.
