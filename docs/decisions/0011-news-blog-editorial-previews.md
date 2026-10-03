# ADR 0011: Esborranys de notícies i blog en previews editorials

## Estat

Acceptada per la persona mantenidora el 2 d'octubre de 2026. Implementació pendent
del flux de revisió i PR. Aquesta decisió no autoritza cap activació remota.

## Decisió

Afegir una col·lecció `posts` de YAML restringit amb dos tipus, `news` i `blog`.
Conservar `published: boolean` com a única font de veritat de publicació.
Producció només renderitza variants publicades i completes en el seu idioma.

El build explícit de preview pot renderitzar també variants completes de posts
amb `published: false`, amb l'estat visible al llistat i al detall i l'avís global
de preview. No cal publicar l'entrada ni duplicar-la per revisar-la. La selecció
de preview és explícita i no modifica la garantia del catàleg públic existent.
Escoles, esdeveniments, entitats, documents, accions externes i contacte mantenen
la seva política actual. No s'habilita una preview general de tot el contingut
despublicat.

L'excepció substitueix, només per als posts editorials, l'exclusió de
`published: false` dels builds ordinaris de preview de la fase 6. No canvia els
controls dels ADR 0009 i 0010, la separació d'artefactes, l'autorització humana,
l'origen, la caducitat ni el publicador de confiança.

Els esborranys han de ser segurs de compartir públicament. Git és públic i
`noindex` no és control d'accés. La petició d'activació d'una preview autoritza
l'exposició dels esborranys d'aquell commit. No s'hi admeten secrets, embargaments
confidencials o dades personals no publicables.

## Raonament

El filtratge actual impedeix revisar una notícia amb el seu estat real al
preview. Marcar-la com a publicada només per veure-la pot exposar-la per error
en el següent build públic. Duplicar-la crea dues fonts que poden divergir.
Una excepció de tipus, explícita i provada, permet revisar la mateixa entrada
sense alterar l'estat ni obrir altres col·leccions.

La col·lecció compartida evita duplicar esquemes i selecció de contingut que
comparteix identitat, idiomes, autoria i publicació. Dos hubs mantenen la
diferència entre notícies i articles de blog. No cal un CMS ni Markdown executable.

## Esmena del 2 d'octubre de 2026

La persona mantenidora confirma que totes les entrades se signen
`mountain runners`, amb autoria `organization`, també al blog. Això substitueix
el requisit inicial d'autoria personal del blog. Autoritza afegir `sharp` per a
les transformacions locals d'imatges durant el build, com a única excepció al
límit inicial de dependències noves. Aquesta autorització no canvia el filtratge
de recursos, la revisió editorial ni els permisos de publicació.

## Aclariment del 3 d'octubre de 2026

La persona mantenidora aclareix que `mountain runners` és l'autoria per defecte,
no una restricció: una autoria diferent explícita és vàlida amb el seu nom públic
i tipus `person` o `organization`. El YAML continua exigint `author`; no s'afegeix
un fallback al render. També autoritza imatges locals opcionals a les seccions,
amb la mateixa selecció de recursos i aïllament dels esborranys.

## Conseqüències

- Les comprovacions de producció han d'excloure també els textos i recursos
  exclusius d'esborranys, no només les rutes o els enllaços de navegació.
- Una marca `published: true` en una PR no demostra que aquella versió ja sigui
  pública. El preview la identifica com a "Marcat per publicar".
- Sitemap i altres sortides d'indexació continuen utilitzant contingut publicat.
- La persona mantenidora revisa els continguts. Una skill pot preparar-los, però
  no substitueix l'aprovació editorial ni el flux de Git.
- El comportament només existeix quan s'implementin i revisin les tasques de
  l'[especificació de notícies i blog](../specs/news-and-blog.md).
