# Direcció Del Model De Contingut

## Principis

- Git és el magatzem autoritatiu del contingut publicat.
- El contingut editorial o operatiu que pugui canviar ha d'estar estructurat i
  validat; no pot existir només dins del codi de les pàgines.
- L'estat de publicació ha de ser explícit perquè les previsualitzacions i el
  futur índex del xat no exposin material no publicat.
- El català és l'únic idioma publicat inicialment, però tot text traduïble s'ha
  de modelar com un objecte per idioma, no com camps separats per llengua.
- Els enllaços, CTAs i formularis que canviïn editorialment també han de poder
  variar per idioma quan calgui.
- Totes les rutes HTML públiques tenen prefix d'idioma, inclòs el català; els
  recursos tècnics globals en queden exceptuats.
- Una variant d'idioma només es publica quan la traducció requerida és completa;
  no es mostra contingut català sota una ruta castellana o anglesa.
- Les entrades editorials utilitzen YAML 1.2 restringit, sense àncores, aliases,
  tags personalitzats ni claus duplicades, i es validen estrictament amb Zod.
- Els missatges curts d'interfície es gestionen separadament amb Paraglide JS 2;
  no formen part de les col·leccions editorials.

## Límit Entre Codi I Contingut

- El codi defineix l'estructura de navegació, les rutes, les locales conegudes,
  el shell global, les plantilles i l'ordre de les seccions estables.
- El YAML recull dades editorials o operatives que poden canviar sense modificar
  components: dates, estats, inscripcions, preus, textos editorials, recursos,
  entitats, documents i URL externes.
- No es crea un constructor genèric de pàgines ni una configuració YAML del lloc
  per anticipació. Una pàgina fixa només rep un esquema específic quan hi ha una
  necessitat editorial concreta i recurrent que el justifiqui.
- Que una dada visqui en codi no impedeix que el xat públic la indexi: el seu
  índex es genera a partir del contingut publicat renderitzat.

## Dominis Planificats

Les primeres col·leccions cobreixen esdeveniments i les seves edicions, escoles
o programes, entitats reutilitzables i documents. Les pàgines fixes, la
configuració del lloc i la navegació es defineixen en codi fins que una necessitat
editorial recurrent requereixi un esquema específic.

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
La longitud, la sintaxi, la profunditat i el nombre de nodes també estan limitats
abans de renderitzar-lo.

Les quatre Astro Content Collections, els seus camps de domini, les referències i
les regles de publicació es defineixen a l'entrega de models i publicació. El
nucli actual no decideix per si sol si una entrada editorial concreta es publica.
