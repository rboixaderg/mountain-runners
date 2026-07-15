# Direcció Del Model De Contingut

## Principis

- Git és el magatzem autoritatiu del contingut publicat.
- El contingut ha d'estar estructurat i validat; no pot existir només dins del
  codi de les pàgines.
- L'estat de publicació ha de ser explícit perquè les previsualitzacions i el
  futur índex del xat no exposin material no publicat.
- El català és l'únic idioma publicat inicialment, però tot text traduïble s'ha
  de modelar com un objecte per idioma, no com camps separats per llengua.
- Els enllaços, CTAs, formularis i blocs de pàgina també han de poder variar per
  idioma quan calgui.
- Totes les rutes HTML públiques tenen prefix d'idioma, inclòs el català; els
  recursos tècnics globals en queden exceptuats.
- Una variant d'idioma només es publica quan la traducció requerida és completa;
  no es mostra contingut català sota una ruta castellana o anglesa.
- Les entrades editorials utilitzen YAML 1.2 restringit, sense àncores, aliases,
  tags personalitzats ni claus duplicades, i es validen estrictament amb Zod.
- Els missatges curts d'interfície es gestionen separadament amb Paraglide JS 2;
  no formen part de les col·leccions editorials.

## Dominis Planificats

S'espera que els primers esquemes cobreixin pàgines, esdeveniments i les seves
edicions, escoles o programes, informació de socis, col·laboradors, documents i
configuració del lloc.

Els esdeveniments necessiten un estat de visibilitat editorial i una indicació
separada de si continuen actius. Les edicions pertanyen al seu esdeveniment pare
i no formen un recurs de primer nivell sense relació.

## Nucli De Validació

El projecte disposa de primitives compartides per validar YAML editorial
restringit, valors traduïbles, slugs, URL, recursos locals o externs i un
subconjunt segur de Markdown. El parser limita la mida i complexitat dels
documents i rebutja àncores, aliases, merges, tags personalitzats, claus
duplicades o perilloses abans d'aplicar esquemes Zod estrictes.

El Markdown editorial només admet paràgrafs, negreta, cursiva, llistes i enllaços
HTTPS validats. Es converteix a HTML des d'un arbre de sintaxi amb una llista
explícita de nodes permesos; no admet HTML cru, components ni codi executable.

Les sis Astro Content Collections, els seus camps de domini, les referències i
les regles de publicació es definiran en l'entrega següent. El nucli actual no
decideix per si sol si una entrada editorial concreta es publica.
