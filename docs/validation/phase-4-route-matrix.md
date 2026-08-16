# Matriu De Rutes De La Fase 4

## Estat

Matriu exhaustiva de la superfície pública (T4.1), generada el 16 d'agost de
2026 a partir del build determinista
(`PUBLIC_SITE_ORIGIN=https://mountainrunners.cat`, `BUILD_TODAY=2026-08-04`).
Cobreix les 66 rutes canòniques (22 per idioma), el document arrel, la pàgina
404 i els estats de contingut representatius, en mòbil i escriptori.

La revisió visual i editorial pàgina a pàgina continua registrada a
[`phase-4-design-review.md`](phase-4-design-review.md); aquesta matriu n'és el
complement exhaustiu per ruta, estat i idioma.

## Fonts

- `apps/web/dist/sitemap.xml` del build determinista: inventari de les rutes
  publicades (66).
- `apps/web/e2e/route-matrix.spec.ts`: escombrat automatitzat en Chromium a
  `320×720` i `1280×720` sobre cada ruta del sitemap, més els estats
  representatius, el document arrel i la 404.
- `apps/web/e2e/shell.spec.ts`: recorreguts funcionals en Chromium, Firefox i
  WebKit sobre les plantilles representatives.
- Revisió manual registrada a `phase-4-design-review.md` (Playwright a 320,
  390, 768, 1280 i 1440 píxels, navegació per teclat inclosa).

## Inventari De Rutes

22 plantilles de ruta × 3 idiomes publicats = 66 rutes canòniques.

| #   | Plantilla                 | `ca`                                         | `es`                                   | `en`                                     |
| --- | ------------------------- | -------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| 1   | Portada                   | `/ca/`                                       | `/es/`                                 | `/en/`                                   |
| 2   | Qui som                   | `/ca/qui-som/`                               | `/es/quienes-somos/`                   | `/en/about/`                             |
| 3   | Socis                     | `/ca/socis/`                                 | `/es/socios/`                          | `/en/members/`                           |
| 4   | Hub d'escoles             | `/ca/escoles/`                               | `/es/escuelas/`                        | `/en/schools/`                           |
| 5   | Escola BTT                | `/ca/escoles/escola-btt/`                    | `/es/escuelas/escuela-btt/`            | `/en/schools/mtb-school/`                |
| 6   | Escola Esquí de muntanya  | `/ca/escoles/escola-skimo/`                  | `/es/escuelas/escuela-esqui-montana/`  | `/en/schools/ski-mountaineering-school/` |
| 7   | Escola Trail              | `/ca/escoles/escola-trail/`                  | `/es/escuelas/escuela-trail/`          | `/en/schools/trail-school/`              |
| 8   | Hub d'esdeveniments       | `/ca/esdeveniments/`                         | `/es/eventos/`                         | `/en/events/`                            |
| 9   | Anella Verda              | `/ca/esdeveniments/anella-verda/`            | `/es/eventos/anella-verde/`            | `/en/events/green-ring/`                 |
| 10  | Berga Trail               | `/ca/esdeveniments/berga-trail/`             | `/es/eventos/berga-trail/`             | `/en/events/berga-trail/`                |
| 11  | Cros de Queralt           | `/ca/esdeveniments/cros-de-queralt/`         | `/es/eventos/cros-de-queralt/`         | `/en/events/cros-de-queralt/`            |
| 12  | Escalada Castell Areny    | `/ca/esdeveniments/escalada-castell-areny/`  | `/es/eventos/escalada-castell-areny/`  | `/en/events/escalada-castell-areny/`     |
| 13  | Escalada Queralt          | `/ca/esdeveniments/escalada-queralt/`        | `/es/eventos/escalada-queralt/`        | `/en/events/escalada-queralt/`           |
| 14  | Les Clàssiques de Berga   | `/ca/esdeveniments/les-classiques-de-berga/` | `/es/eventos/les-classiques-de-berga/` | `/en/events/les-classiques-de-berga/`    |
| 15  | Llobregat per la Diabetis | `/ca/esdeveniments/llobregat-x-la-diabetis/` | `/es/eventos/llobregat-x-la-diabetis/` | `/en/events/llobregat-x-la-diabetis/`    |
| 16  | Minivolta a la Maria      | `/ca/esdeveniments/minivolta-a-la-maria/`    | `/es/eventos/minivolta-a-la-maria/`    | `/en/events/minivolta-a-la-maria/`       |
| 17  | Quina Berguedana          | `/ca/esdeveniments/quina-berguedana/`        | `/es/eventos/quina-berguedana/`        | `/en/events/quina-berguedana/`           |
| 18  | Ultra Pirineu             | `/ca/esdeveniments/ultra-pirineu/`           | `/es/eventos/ultra-pirineu/`           | `/en/events/ultra-pirineu/`              |
| 19  | Documents                 | `/ca/documents/`                             | `/es/documentos/`                      | `/en/documents/`                         |
| 20  | Avís legal                | `/ca/avis-legal/`                            | `/es/aviso-legal/`                     | `/en/legal-notice/`                      |
| 21  | Política de privacitat    | `/ca/privacitat/`                            | `/es/privacidad/`                      | `/en/privacy/`                           |
| 22  | Política de cookies       | `/ca/cookies/`                               | `/es/cookies/`                         | `/en/cookies/`                           |

Documents arrel i tècnics: `/` (document de redirecció a `/ca/` amb canonical),
`/404.html` i recursos tècnics (`sitemap.xml`, `robots.txt`, assets).

## Estats Representatius

| Estat                                 | Rutes publicades que el mostren                                                                                                  | Cobertura automatitzada                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Esdeveniment actiu amb pròxima edició | Ultra Pirineu, Cros de Queralt, Escalada Castell Areny, Escalada Queralt, Les Clàssiques, Minivolta a la Maria, Quina Berguedana | `matrix state` (badge «Actiu», dates, inscripció)                |
| Esdeveniment històric                 | Anella Verda, Berga Trail                                                                                                        | `matrix state` (badge «Històric», sense acció d'inscripció)      |
| Inscripció tancada                    | Tots els esdeveniments publicats excepte Llobregat                                                                               | `matrix state` (Ultra Pirineu)                                   |
| Inscripció properament                | Llobregat per la Diabetis                                                                                                        | `matrix state`                                                   |
| Inscripció oberta                     | Cap ruta publicada (`mountain-day` té `published: false`)                                                                        | Proves unitàries de `getRegistrationPresentation`                |
| Escola amb galeria                    | Les tres escoles                                                                                                                 | `shell.spec.ts` (atribucions Skimo) + escombrat per ruta         |
| Escola sense galeria                  | Cap ruta publicada                                                                                                               | Guarda de visibilitat de `SchoolGallery`                         |
| Escola amb vídeo                      | Escola Trail, Escola Esquí de muntanya                                                                                           | `matrix state` (iframe `youtube-nocookie`)                       |
| Escola sense vídeo                    | Escola BTT                                                                                                                       | `matrix state` (cap iframe)                                      |
| Butlletí no disponible                | Estat publicat actual (totes les rutes, prepeu)                                                                                  | `matrix state` (avís + entrada i botó desactivats, sense `form`) |
| Butlletí disponible                   | Cap ruta publicada                                                                                                               | Proves unitàries de `getNewsletterPresentation`                  |
| Document temporalment no disponible   | Documents (Guia del club)                                                                                                        | `shell.spec.ts` (avís, cap enllaç fals)                          |
| Pàgina 404                            | `/404.html` i rutes inexistents                                                                                                  | `matrix` (estat 404, un únic `h1`) + axe                         |
| Redirecció arrel                      | `/`                                                                                                                              | `matrix` (canonical `/ca/` i enllaç de continuació)              |

Els estats no publicats queden coberts per proves unitàries i per les guardes
de visibilitat dels components; es tornaran a verificar contra la matriu quan
el contingut que els mostra es publiqui.

## Comprovacions Per Ruta

L'escombrat automatitzat verifica, per a cada ruta del sitemap i en cada
viewport:

- resposta HTTP 200 i absència d'excepcions de pàgina;
- atribut `lang` de l'HTML coherent amb el prefix de ruta;
- un únic `h1` no buit i el landmark `main` visible;
- `canonical` i `hreflang` del propi idioma amb l'origen canònic;
- selector d'idioma present a la capçalera i al menú mòbil;
- enllaç de salt al contingut enfocable;
- absència d'overflow horitzontal.

La revisió manual registrada a `phase-4-design-review.md` afegeix el contrast
amb `DESIGN.md`, l'ordre de lectura, la navegació per teclat completa i la
revisió editorial pàgina a pàgina.

## Discrepàncies Detectades I Corregides

L'escombrat va detectar que els hubs d'escoles i esdeveniments no emetien
`link[rel="alternate"][hreflang]` per al seu propi idioma (els detalls i les
pàgines fixes sí). S'ha corregit a la mateixa PR: els hubs publiquen ara les
alternatives `hreflang` dels idiomes amb hub publicat.

## Resultat

- 66 rutes canòniques × 2 viewports (Chromium) = 132 comprovacions d'escombrat
  passades.
- 8 tests d'estat representatiu × 2 viewports passats, més document arrel i 404.
- Suite E2E completa: 286 passats, 302 omesos (escombrat Chromium-only i axe
  fora de Chromium). Unitats, lint, tipus i format: passats.

## Límits

L'escombrat no equival a una auditoria manual completa WCAG 2.2 AA ni a la
revisió editorial: la primera continua sent una necessitat separada del backlog
i la segona viu a `phase-4-design-review.md`.
