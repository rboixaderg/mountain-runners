# Imatges opcionals de secció i autoria editorial

Ampliació de la PR #140 del 3 d'octubre de 2026, autoritzada per la persona
mantenidora. No canvia l'estat de publicació ni el text dels pilots.

## Contracte implementat

- `sections[].images` és opcional. Quan existeix, té entre una i deu imatges
  locals amb alt i crèdit traduïbles i peu opcional. Sense imatges, el render
  conserva el text i l'amplada de lectura sense reservar cap columna buida.
- A partir de `lg`, la primera secció il·lustrada té imatges a l'esquerra i text
  a la dreta. La següent il·lustrada inverteix la disposició. Les seccions sense
  imatges no consumeixen torn. Les imatges de la mateixa secció s'apilen.
- En mòbil i a l'ordre de lectura del DOM, text abans d'imatges. Les imatges no
  es retallen, tenen dimensions explícites i càrrega diferida al cos. La coberta
  comparteix el component d'imatge però conserva càrrega immediata.
- Els textos obligatoris i el peu declarat de cada imatge formen part de la
  completesa de la variant. Cap fallback ni ocultació de captures incompletes.
- La selecció de recursos incorpora les imatges del cos només després de
  seleccionar les variants. Mateixes derivades WebP de 480/1200, qualitat 80,
  correcció d'orientació i absència de metadades; cap import Vite ni original nou
  exposat. No hi ha nou format, dependència, servei, telemetria o JavaScript.
- L'autoria per defecte editorial és `mountain runners`, tipus `organization`.
  Una autoria diferent explícita és vàlida, amb el seu nom públic i tipus. El
  YAML continua declarant `author`: no hi ha un fallback ocult al render.

## Comprovacions

- `pnpm validate`: correcte, 379 tests unitaris, 116 de servidor/integració i
  338 E2E; 352 omesos pels filtres existents.
- La integració fa quatre builds i compara paths i SHA-256 públics, inclòs
  públic després de preview. Fixtures diferenciades per píxels comproven les
  imatges exclusives de secció d'esborrany, les publicades i les compartides.
  Les derivades d'esborrany només existeixen al preview.
- La fixture de blog té textos traduïts però alt de secció només català. No es
  genera detall castellà ni alternativa, i el verificador de sitemap també
  deriva la completesa dels camps de les imatges.
- Proves de l'HTML i CSS real construït en Chromium, Firefox i WebKit, a
  1280 i 320 píxels: posicions esquerra/dreta, ordre vertical mòbil, absència
  d'imatges a la secció de text sol i absència de desbordament horitzontal.
  Axe sobre la fixture il·lustrada a Chromium en els dos viewports: cap
  infracció detectada. El contingut sintètic no s'afegeix als posts reals.
- Lighthouse públic: rendiment 99 a les tres rutes representatives existents
  i 100 als hubs editorials; accessibilitat, bones pràctiques i SEO 100 a totes.
  Pressupostos configurats correctes. No és una mesura d'un tutorial real amb
  captures; els pilots encara no tenen imatges aprovades.

## Revisió pendent

La revisió visual manual i la llegibilitat/pes de captures reals continuen
pendents. Cal comprovar la compressió amb imatges aprovades abans de publicar un
tutorial; la qualitat actual no acredita que qualsevol captura sigui llegible.
No es declara conformitat WCAG completa. Cal eliminar dades personals, bancàries
i identificadors de les captures abans de Git, no només abans de publicar.

Les metadades de l'article continuen utilitzant la coberta opcional, no una
captura de secció arbitrària. Sitemap, JSON-LD i permisos de publicació mantenen
el contracte anterior i les comprovacions existents. Cap publicació o merge.
