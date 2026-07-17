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

## Col·leccions

Les quatre Astro Content Collections registrades són:

- `schools`: programes amb informació pràctica, recursos i estat d'inscripció.
- `events`: esdeveniments amb entitats relacionades i edicions embegudes.
- `entities`: organitzacions reutilitzables i avantatges opcionals per a socis.
- `documents`: recursos locals o externs amb tipus, idioma i disponibilitat.

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

Cada fitxer de `apps/web/src/content/` passa pel loader YAML restringit abans de
la validació de l'esquema de la col·lecció. L'identificador declarat ha de
coincidir amb el nom del fitxer. Els recursos locals també s'han de resoldre com
a fitxers regulars dins de `src/assets/` o `src/content-assets/`, sense enllaços
simbòlics ni escapaments de directori.

## Publicació

`apps/web/src/lib/content/publication.ts` és la capa de domini autoritativa per
decidir les variants publicables. Comprova la unicitat dels slugs per idioma,
l'existència de referències i la completesa transitiva dels camps renderitzats,
entitats i documents.

Les rutes públiques no consulten directament les col·leccions. Utilitzen el
repositori central, que exclou `published: false` i només retorna variants amb
una traducció completa. `active` no altera la visibilitat editorial d'un
esdeveniment. Els camps opcionals sense traducció s'ometen i no fan fallback al
català.

El codi centralitza els dominis editorials localitzats: escoles són
`/{locale}/escoles/{slug}/`, `/{locale}/escuelas/{slug}/` o
`/{locale}/schools/{slug}/`; els esdeveniments són
`/{locale}/esdeveniments/{slug}/`, `/{locale}/eventos/{slug}/` o
`/{locale}/events/{slug}/`. Els segments reservats, tècnics i les col·lisions de
domini es rebutgen abans de generar rutes. Les variants canòniques, `hreflang` i
el sitemap només inclouen idiomes realment publicats i utilitzen l'origen públic
fixat `https://mountainrunners.cat`.

El build verifica tant les rutes esperades com l'absència de marcadors i recursos
exclusius d'entrades despublicades a `dist/`.
