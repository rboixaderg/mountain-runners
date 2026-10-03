# Validació integrada de notícies i blog

Continuació local de la PR #140, executada el 2 i 3 d'octubre de 2026 a
`mountain_runners-news-blog-artifacts`, branca `feat/news-blog-artifacts`.
No acredita un desplegament remot ni substitueix revisió humana.

Aquest document conserva els resultats d'aquella etapa, no l'estat actual de la
PR. La [revisió d'analítica i UI](news-blog-analytics-ui.md) i el
[seguiment arquitectònic](news-blog-architecture-closure.md) registren les
correccions, la revisió visual, les previews autoritzades i l'auditoria posterior.

## Implementació i revisió de la PR

La PR inicial contenia NB-01, NB-03 i part de NB-04. Aquesta continuació afegeix
NB-02, completa les transformacions de NB-04 i implementa NB-05, NB-06 i la
part tècnica de NB-07, amb commits separats per tasca.

La persona mantenidora ha confirmat la signatura `mountain runners` per a
notícies i blog i ha autoritzat `sharp` com a única dependència nova. L'ADR 0011,
la spec i el model reflecteixen aquesta esmena. Els dos pilots són YAML reals
amb `published: false`, sense coberta ni data de publicació inventades. La guia
de socis identifica explícitament el formulari com a pendent de comprovació.

El build públic té 72 rutes canòniques, 24 per idioma. El preview afegeix només
els dos detalls catalans dels pilots. Els sis hubs existeixen també quan no hi ha
publicacions. No hi ha fallback ni detalls en idiomes incomplets.

## Comprovacions executades

- `pnpm validate`: correcte, amb 369 tests unitaris, 116 de servidor/integració
  i 338 E2E correctes; 352 E2E omesos pels filtres existents de navegador,
  accessibilitat i mode preview.
- Build públic amb origen de producció i `BUILD_TODAY=2026-08-04`: correcte.
- Build preview amb `PUBLIC_PREVIEW=true`, origen de PR i
  `BUILD_TODAY=2026-10-02`: correcte.
- E2E de posts i preview sobre aquest build: 38 correctes i quatre omesos.
  Cobreixen els tres navegadors, mòbil/escriptori, descoberta, teclat,
  autoria, absència de coberta, estats, avís global i enllaç localitzat a Socis.
- Axe sobre hubs i pilots al preview: cap infracció detectada als dos viewports
  de Chromium. Sense desbordament horitzontal. Això no acredita conformitat
  WCAG completa ni revisió visual manual.
- Integració de quatre builds nets/reutilitzats: correcta després d'afegir
  fixtures amb píxels diferents, notícia publicada trilingüe, blog publicat,
  variants incompletes i cobertes exclusives/compartides.
- Paths i SHA-256 públics idèntics entre builds nets i després d'un preview.
  Cap digest d'original o derivada exclusiva de l'esborrany, ni marcador textual
  exclusiu, a cap fitxer públic. Els originals dels posts no es copien perquè
  el render només consumeix WebP; els recursos de les altres col·leccions
  conserven la selecció existent.
- Canonical, alternatives, Open Graph d'article i JSON-LD comprovats amb
  fixtures. Sitemap i JSON-LD exclouen esborranys. La serialització segura
  impedeix tancar el script des del text editorial. `/llms.txt` només descobreix
  hubs i remet al sitemap per a les pàgines publicades.

El verificador de sortida deriva les rutes editorials esperades del YAML font,
no de les rutes observades al build. La llista fixa de rutes anteriors es manté.
Una inspecció dels 157 fitxers del build públic tampoc troba paths dels pilots
ni els seus marcadors exclusius. Els links locals nous resolen. El mapa de
documentació conserva un enllaç preexistent a `diari-de-treball.md`, que no
existeix en aquesta branca; no s'ha corregit fora de l'abast d'aquesta entrega.

## Lighthouse i pressupostos

L'auditoria té un servidor propi al port 4323. Utilitza l'API programàtica
d'Astro perquè el lock del CLI impedia arrencar mentre un preview de la persona
mantenidora ja era actiu al port 4321. Aquest procés preexistent no s'ha aturat.

Resultat públic, sense rebaixar cap llindar:

| Ruta                              | Rendiment | Accessibilitat | Bones pràctiques | SEO |
| --------------------------------- | --------- | -------------- | ---------------- | --- |
| `/ca/`                            | 99        | 100            | 100              | 100 |
| `/ca/esdeveniments/`              | 99        | 100            | 100              | 100 |
| `/ca/esdeveniments/anella-verda/` | 99        | 100            | 100              | 100 |
| `/ca/noticies/`                   | 100       | 100            | 100              | 100 |
| `/ca/blog/`                       | 100       | 100            | 100              | 100 |

Tots els pressupostos configurats passen. Als pilots de preview:

| Pilot   | Rendiment | Accessibilitat | Bones pràctiques | SEO | LCP    | CLS   | TBT  |
| ------- | --------- | -------------- | ---------------- | --- | ------ | ----- | ---- |
| Notícia | 100       | 100            | 100              | 69  | 1,58 s | 0     | 0 ms |
| Blog    | 100       | 100            | 100              | 69  | 1,58 s | 0,003 | 0 ms |

El runner de preview surt amb error pel llindar SEO de 100. L'única auditoria
SEO amb score zero és `is-crawlable`, pel `noindex` obligatori. No s'ha retirat
aquesta protecció ni canviat els llindars per fer passar la prova. Els altres
scores i tots els pressupostos passen. Els reports locals són a
`artifacts/lighthouse/`, exclosos de Git.

## Seguretat, dependències i drets

Sharp 0.35.5 està fixat al lockfile. És una dependència de build amb llicència
Apache-2.0; libvips té llicència LGPL-2.1-or-later. No hi ha nou servei, script
de tercers al navegador, telemetria, canvi de CSP ni canvi de permisos.
Les transformacions només processen paths locals validats i seleccionats,
corregeixen l'orientació, no amplien originals petits i no conserven EXIF.

`pnpm audit --prod` informa de dos avisos a la cadena
`@inlang/paraglide-js > vite > postcss`: nanoid, severitat alta,
`GHSA-2v37-7h3g-55p8`, i PostCSS, moderada, `GHSA-fxqj-rqcc-2cmp`.
No corresponen a Sharp. Aquesta entrega no modifica aquestes dependències
alienes al seu abast ni declara l'audit correcte.

No s'han inventat imatges ni incorporat consentiments o dades privades. La
fotografia i els drets dels pilots continuen pendents. Git i previews són
públics; `noindex` no controla l'accés.

## Revisions pendents

- Revisió visual manual de mòbil/escriptori, focus, zoom, espaiat i jerarquia.
  Playwright MCP no està habilitat en aquesta sessió. Les proves automatitzades
  no substitueixen aquesta revisió.
- Aprovació editorial de la persona mantenidora i comprovació del formulari de
  socis, sense dades personals o pagaments reals. No s'ha publicat cap pilot.
- Revisió de la PR i merge humà. NB-07 no es declara completada mentre aquestes
  revisions estiguin pendents.
- Tractar els dos avisos de dependències en una tasca separada.

No hi ha push d'aquesta continuació, activació de preview remota, merge,
auto-merge, canvi DNS ni desplegament.
