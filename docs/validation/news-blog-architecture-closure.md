# Seguiment arquitectònic de notícies i blog

Continuació de la PR #140 del 3 d'octubre de 2026, autoritzada per la persona
mantenidora. Actualitza l'estat tècnic; no aprova contingut ni autoritza merge.

## Sincronització amb main

`686f139` incorpora `origin/main` a `feat/news-blog-artifacts`, sense reescriure
l'historial. Els conflictes eren al hub localitzat compartit i al lockfile.
S'han conservat els hubs editorials i els d'escoles/esdeveniments, les
actualitzacions de dependències de `main` i Sharp 0.35.5 com a dependència
explícita de build. La instal·lació amb lockfile congelat és correcta.

El nou formatador d'Astro de `main` ha reformatat set components de posts.
La primera execució del gate va fallar només pel format; després de reformatar
aquests fitxers, el gate complet passa. No s'han barrejat altres refactors.

## Propietat de les seccions

`48e5998` substitueix `PostResources` per quatre components:

- `PostMembersLink`: enllaç localitzat a Socis i el seu esdeveniment d'analítica.
- `PostCorrection`: data i Markdown restringit de rectificació.
- `PostSources`: fonts amb nom traduït i atributs d'enllaç extern.
- `PostRelatedEvents`: referències publicades rebudes de la pàgina.

Cada component resol els seus missatges i la seva condició de visibilitat.
`PostDetail` mostra ara l'estructura completa de l'article. Es conserven ordre,
HTML semàntic, classes, rutes i etiquetes d'analítica. No s'introdueix un nou
catàleg, servei o abstracció de blocs.

La fixture construïda del blog inclou els quatre casos. Les proves comproven
la rectificació amb negreta i `datetime`, l'URL de la font, l'esdeveniment
relacionat i la destinació d'analítica. La notícia sense dades opcionals no
renderitza aquests blocs. Les comprovacions corren als tres navegadors i als
dos viewports; les proves existents comproven el clic de Socis amb Enter.

## Validació després de la integració

- `pnpm validate`: 391 tests unitaris, 116 de servidor/integració i 344 E2E
  correctes; 352 omesos segons la configuració existent.
- Quatre builds d'integració amb aïllament d'esborranys, recursos seleccionats i
  comparació de paths/SHA-256. Inclou les seccions extretes i axe a Chromium.
- Build preview i E2E de posts/preview: 38 correctes, deu omesos.
- Lighthouse públic: rendiment 99 a portada i rutes representatives
  d'esdeveniments, 100 als hubs editorials; accessibilitat, bones pràctiques i
  SEO 100. Pressupostos correctes, sense rebaixar llindars.
- Playwright MCP local: blog a 1280 píxels i notícia a 320, sense desbordament
  ni canvi visual atribuïble a l'extracció. Captures a `artifacts/ui-review/`,
  fora de Git. Navegador i servidor propi tancats.
- Les comprovacions existents de canonical, alternatives, sitemap, robots,
  JSON-LD i absència d'analítica al preview continuen passant.

## Auditoria de dependències

`pnpm audit --prod` retorna error amb un avís alt de `http-cache-semantics`,
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), a la
cadena `apps/web > astro > http-cache-semantics`. Aquest resultat substitueix
els avisos de nanoid/PostCSS dels informes anteriors per al lockfile actual.
No s'ha declarat l'audit correcte ni afegit cap override o excepció.

La web continua sent estàtica, però això no demostra que l'avís sigui innocu
durant el build o les eines locals. Cal revisar l'aplicabilitat i acordar una
correcció o tractament explícit abans de donar per tancada la revisió de seguretat.
No s'han afegit dependències alienes a la integració amb `main`, nous scripts
de tercers al navegador, canvis de CSP ni recursos amb nous drets d'imatge.

## Estat de la PR i pendents

Els workflows de preview fins a `02a5533` han acabat correctament amb publicació
autoritzada. Això no acredita que els commits posteriors d'aquest document ja
estiguin publicats; el comentari del workflow identifica el SHA servit.

La documentació vigent i la descripció de la PR han de distingir implementació,
validació, aprovació editorial i merge. NB-01 a NB-06 continuen en revisió i
NB-07 conserva pendent la revisió editorial humana. La revisió visual feta no
acredita zoom natiu al 200% ni conformitat WCAG completa.

Continuen pendents el tractament de l'avís de dependències, la revisió humana
de la PR, els textos dels pilots, el formulari real i les imatges/drets aprovats.
Els pilots mantenen `published: false`. No s'ha fet merge, auto-merge ni
desplegament manual.
