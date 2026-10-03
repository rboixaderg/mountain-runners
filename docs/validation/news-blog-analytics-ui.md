# Revisió d'analítica i UI editorial

Revisió i correccions del 3 d'octubre de 2026 a la PR #140, autoritzades per la
persona mantenidora. No es publiquen els pilots ni es canvia cap servei remot
d'analítica, CSP, cookie o política de publicació.

## Analítica

S'ha corregit la classificació de les rutes: notícies i blog ja no s'etiqueten
com a escoles. Els quatre tipus són `news_hub`, `news_detail`, `blog_hub` i
`blog_detail`, en els tres idiomes. Temps actiu i scroll hereten aquestes
etiquetes del layout.

Els enllaços del menú, dels llistats, de retorn al hub i de recursos relacionats
reutilitzen `UI Action` i `navigate`. Àrees i destinacions estan documentades a
[l'especificació d'analítica](../specs/plausible-analytics.md#notícies-i-blog).
La destinació d'un article és el seu identificador públic estable; no s'envien
titulars, autories, dades personals ni un referrer nou. El context identifica la
pàgina d'origen del clic, no la pàgina de destinació.

Les entrades a la web per un article es consulten amb pàgines d'entrada i fonts
d'adquisició de Plausible. `Direct/None` no acredita que s'hagi escrit l'URL.
Visites menys clics no és una mesura d'entrades directes. No s'afegeix persistència
al navegador ni UTM internes. El preview continua sense analítica.

Les proves de menú substitueixen el tracker carregat per un receptor local i
comproven l'esdeveniment real emès durant la navegació. La primera prova que
esperava interceptar el beacon després de navegar no era estable a WebKit;
no s'ha canviat el transport de producció per adaptar-lo al test. Les proves
unitàries existents mantenen la cobertura del beacon amb el tracker lent.

La integració amb articles sintètics comprova clics de llistat en català i
castellà, identitat estable de destinació, tipus del detall, CTA de Socis activada
amb Enter i absència d'un `UI Action` fictici en obrir directament el detall.
Les peticions externes s'intercepten: no s'ha generat trànsit real d'analítica ni
verificat la recepció al tauler remot.

## Revisió visual en navegador

Playwright MCP ja estava configurat amb `@playwright/mcp` 0.0.78 al paquet
aïllat `tools/playwright-mcp`, però no instal·lat. S'ha instal·lat amb el lockfile
congelat i reconnectat al projecte. `opencode mcp list` confirma `connected`.
No s'ha substituït per `npx latest` ni modificat el lockfile de la web.

Amb el MCP s'han capturat i revisat:

- Hub de notícies amb esborrany, a 320 píxels.
- Hub anglès sense publicacions, a 1024 píxels; menú i CTA sense solapament.
- Guia de socis real a 1280 píxels, abans i després de corregir espaiats.
- Notícia real a 640 píxels, per comprovar reflow. Aquesta comprovació no és una
  prova de zoom natiu del navegador al 200%.
- Fixture temporal il·lustrada, a 1280 i 320 píxels, amb llistes numerades,
  vinyetes, enllaç, peus d'imatge, secció de text sol i alternança esquerra/dreta.
  Utilitza el logotip existent com a imatge de prova, no una captura real de
  formulari. La fixture s'ha retirat abans del commit i no arribarà al preview.
- Tab al hub mòbil: skip link amb focus visible i contorn vermell de 3 píxels.

Correccions aplicades:

- Separació explícita de titular, autoria, data i avís editorial.
- Ritme entre títol, resum i metadades dels llistats.
- Eliminació del doble espai vertical entre introducció del hub i llistat.
- Títol del hub amb la tipografia i tracking del sistema visual.
- Llistes Markdown amb numeració/vinyetes i sagnat; enllaços de text subratllats.
- CSS del Markdown limitat als seus contenidors, sense alterar els peus d'imatge.

Les captures locals són a `artifacts/ui-review/`, excloses de Git. La barra
flotant que hi apareix és la d'Astro en desenvolupament; no forma part del build
estàtic públic ni s'ha ocultat cap avís de preview. El servidor de desenvolupament
creat per aquesta revisió i la pàgina MCP s'han tancat; el preview preexistent no
s'ha aturat.

## Validació

- `pnpm validate`: 391 tests unitaris, 116 de servidor/integració i 344 E2E
  correctes; 352 omesos pels filtres existents.
- Integració de quatre builds, comparació de paths/SHA-256 públics i aïllament
  dels recursos d'esborrany. Geometria i estils reals als tres navegadors i dos
  viewports. Llistes amb `decimal`/`disc` i enllaços subratllats comprovats per
  estil calculat; axe correcte a Chromium.
- Builds públic i preview amb les comprovacions existents de sitemap, canonical,
  alternatives, robots, JSON-LD i absència d'analítica al preview.
- E2E de posts i preview sobre el build preview: 38 correctes, deu omesos.
  Sis omissions corresponen a analítica desactivada al preview i quatre a axe
  reservat per a Chromium.
- Lighthouse públic: rendiment 99 a portada, hub i detall d'esdeveniments i 100
  als dos hubs editorials; accessibilitat, bones pràctiques i SEO 100 a totes.
  Pressupostos configurats correctes, sense rebaixar llindars.

La revisió cobreix els templates editorials i els casos descrits, no declara que
tota la web sigui perfecta ni conformitat WCAG completa. Continuen pendents
l'aprovació editorial, la comprovació del formulari i la llegibilitat/pes de
captures reals. La petició `/preview` després del push està autoritzada per la
persona mantenidora; no autoritza merge ni desplegament manual.
