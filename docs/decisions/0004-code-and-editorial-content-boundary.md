# ADR 0004: Límit Entre Codi I Contingut Editorial

## Estat

Acceptada.

## Decisió

Mantenir en codi l'estructura estable de l'aplicació: navegació, rutes, locales,
shell, plantilles i ordre de seccions. Desar en YAML restringit només les dades
editorials o operatives que puguin canviar sense modificar components, com
esdeveniments, escoles, entitats, documents, dates, estats, recursos,
inscripcions, preus i URL externes.

No es crearà un constructor genèric de pàgines ni una col·lecció de configuració
global per anticipació. Quan una pàgina fixa requereixi edició recurrent, se li
afegirà un esquema específic, petit i justificat.

## Raonament

El lloc és estàtic: tant un canvi de YAML com un canvi de TypeScript passa per
una branca, validació, revisió, merge i build. El límit no és el desplegament,
sinó separar dades que l'associació pot modificar editorialment de l'estructura
del producte. Això redueix el model, evita duplicar la configuració d'Astro i
manté l'assistent editorial restringit a dades validades.

El xat públic indexarà contingut publicat renderitzat, de manera que no requereix
que tota la informació d'origen visqui en YAML.
