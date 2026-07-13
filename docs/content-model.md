# Direcció Del Model De Contingut

## Principis

- Git és el magatzem autoritatiu del contingut publicat.
- El contingut ha d'estar estructurat i validat; no pot existir només dins del
  codi de les pàgines.
- L'estat de publicació ha de ser explícit perquè les previsualitzacions i el
  futur índex del xat no exposin material no publicat.
- El futur model de contingut ha de donar prioritat al català i deixar espai per
  a altres idiomes sense duplicar implementació prematurament.

## Dominis Planificats

S'espera que els primers esquemes cobreixin pàgines, esdeveniments i les seves
edicions, escoles o programes, informació de socis, col·laboradors, documents i
configuració del lloc.

Els esdeveniments necessiten un estat de visibilitat editorial i una indicació
separada de si continuen actius. Les edicions pertanyen al seu esdeveniment pare

## Validació Futura

Les Astro Content Collections i Zod validaran el frontmatter i les dades
estructurades. Els camps exactes, els noms de fitxers i els scripts es definiran
juntament amb la implementació d'Astro; encara no existeixen.
