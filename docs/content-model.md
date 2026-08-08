# Direcció Del Model De Contingut

## Principis

- Git és el magatzem autoritatiu del contingut publicat.
- Les dades de domini o operatives que puguin canviar han d'estar estructurades i
  validades.
- L'estat de publicació ha de ser explícit perquè les previsualitzacions i el
  futur índex del xat no exposin material no publicat.
- El català és l'únic idioma publicat inicialment. Els camps textuals d'objectes
  de domini es modelen com un objecte per idioma, no com camps separats per
  llengua.
- Totes les rutes HTML públiques tenen prefix d'idioma, inclòs el català; els
  recursos tècnics globals en queden exceptuats.
- Una variant d'idioma només es publica quan la traducció requerida és completa;
  no es mostra contingut català sota una ruta castellana o anglesa.
- Les entrades editorials utilitzen YAML 1.2 restringit, sense àncores, aliases,
  tags personalitzats ni claus duplicades, i es validen estrictament amb Zod.
- Els recursos de traducció gestionen els missatges d'interfície i els textos de
  pàgines fixes; no formen part de les col·leccions editorials.

## Límit Entre Codi I Contingut

- Els ADR 0004 i 0005 governen aquest límit. L'ADR 0005 preval només per a
  pàgines fixes i defineix la classificació d'estructura, textos, recursos i
  dades operatives; aquest document no la duplica.
- El codi defineix l'estructura estable. El YAML valida objectes de domini i els
  recursos de traducció aporten els textos de pàgines fixes.
- Que una dada visqui en codi no impedeix que el xat públic la indexi: el seu
  índex es genera a partir del contingut publicat renderitzat.

## Col·leccions

Les col·leccions de contingut registrades són:

- `schools`: programes amb informació pràctica, recursos, estat d'inscripció i
  un ordre editorial explícit (`hubOrder`) per al hub.
- `events`: esdeveniments amb entitats relacionades i edicions embegudes.
- `entities`: organitzacions reutilitzables i avantatges opcionals per a socis.
- `documents`: recursos locals o externs amb tipus, idioma i disponibilitat.
- `external-actions`: accions externes d'alta, federació i butlletí amb estat
  explícit i URL externa opcional.
- `contact`: dades institucionals de contacte (correu, telèfons, seu, horaris i
  CIF) amb URL `mailto:` i `tel:` validades.

La col·lecció `contact` conté exactament una entrada institucional. El catàleg
falla si en falta o n'hi ha més d'una, i només exposa les dades si l'entrada està
publicada i completa en català.

Les accions externes tenen un identificador estable fix (per exemple
`member-signup`, `federation` i `newsletter`) que el codi i les pàgines fixes
reutilitzen. Una acció `available` requereix una URL HTTPS traduïble; una acció
no disponible (`coming-soon`, `temporarily-unavailable` o `unavailable`) no
porta URL i s'explica amb text útil, mai amb un control desactivat ni un enllaç
buit.

Els esdeveniments necessiten un estat de visibilitat editorial i una indicació
separada de si continuen actius. Les edicions pertanyen al seu esdeveniment pare
i no formen un recurs de primer nivell sense relació. La llista d'edicions pot
estar buida quan encara no hi ha cap data anunciada. Quan una edició té la
inscripció oberta, pot utilitzar la seva URL pròpia o la URL d'inscripció de
l'esdeveniment pare.

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
Els documents referenciats per una edició només generen un enllaç quan la seva
disponibilitat és `available`; els documents arxivats o temporalment no
disponibles es mostren com a recurs no disponible.

Les pàgines fixes poden referenciar documents de la col·lecció publicada per
identificador estable. La pàgina Qui som referència l'`estatuts` (PDF local
versionat a `src/content-assets/documents/estatuts-mrb.pdf`); una referència
mancant o despublicada fa fallar la validació editorial.

La pàgina Socis renderitza les accions externes d'alta i federació pels seus
identificadors estables (`member-signup` i `federation`) i en mostra l'estat: una
acció disponible enllaça a la URL traduïble i una acció no disponible s'explica
amb text útil, mai amb un control fals. El directori de col·laboradors es deriva
exclusivament de les entitats publicades amb avantatge de soci
(`membershipBenefit`), ordenades alfabèticament pel nom en català; no es
duplica cap llista editorial en els recursos de traducció.

El directori de Documents agrupa per tipus els documents publicats: només els
documents amb disponibilitat `available` mostren enllaç i només els seus
recursos locals entren a la sortida pública. Un document publicat però no
disponible (`temporarily-unavailable` o `archived`) s'explica amb text útil i
no genera cap enllaç ni recurs a `dist/`.

Les pàgines fixes de Contacte i les legals (avís legal, privacitat i cookies)
resolen les dades institucionals (CIF, seu, correu i telèfons) des de la
col·lecció `contact`, i el butlletí des de l'acció externa `newsletter`. Si una
dada no està aprovada, la secció corresponent s'omet o mostra la
indisponibilitat; mai no es simula un formulari ni una subscripció activa.

Una variant editorial publicable no habilita automàticament una fitxa pública.
Els tipus de detall disponibles es defineixen centralment en codi segons les
plantilles completades a cada fase: esdeveniments des de la fase 2 i escoles des
de la fase 3 (T3.6). La portada reutilitza contingut publicat i enllaça al hub
d'escoles.

El hub d'escoles llista les escoles publicades en un ordre editorial explícit i
estable: el camp `hubOrder` de cada entrada (`apps/web/src/lib/content/schools.ts`),
amb l'identificador com a desempat. L'ordre mai depèn de l'ordre dels fitxers.

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
