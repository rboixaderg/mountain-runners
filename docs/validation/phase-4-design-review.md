# Revisió Visual De La Fase 4

## Estat

Revisió T4.4 en curs sobre la branca de validació del disseny. Aquesta nota
registra la primera entrega de correccions visuals; no tanca la fase 4 ni
substitueix la revisió editorial T4.3 o les traduccions T4.5.

## Fonts I Criteris

- `DESIGN.md` continua sent la font de veritat de la direcció visual.
- Les sis pantalles Stitch visibles i aprovades de
  [`docs/design-references.md`](../design-references.md) s'han utilitzat com a
  referència de composició.
- La portada fixa la jerarquia del menú, el prepeu i el peu compartits. El menú
  manté les àrees Qui som, Escoles, Esdeveniments, Socis i Contacte, amb la
  portada i la crida a Socis resoltes mitjançant el logotip i l'acció destacada.
- No s'ha modificat `DESIGN.md`: les correccions concreten la direcció ja
  aprovada i no introdueixen un sistema visual paral·lel.

## Matriu De Cobertura Visual

| Àrea                  | Ruta representativa              | Referència Stitch                   | Escriptori | Mòbil    | Resultat                                                                      |
| --------------------- | -------------------------------- | ----------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------- |
| Portada               | `/ca/`                           | Inici — Updated Footer              | Revisada   | Revisada | Shell vermell, transició negra, agenda, blocs de territori i prepeu compartit |
| Hub d'esdeveniments   | `/ca/esdeveniments/`             | Esdeveniments — Hero Unificat       | Revisada   | Revisada | Hero unificat, files d'agenda i estats visibles                               |
| Detall d'esdeveniment | `/ca/esdeveniments/berga-trail/` | Detall d'esdeveniment — Berga Trail | Revisada   | Revisada | Hero, badge de relació, informació pràctica i acció                           |
| Qui som               | `/ca/qui-som/`                   | Qui som — Hero Unificat             | Revisada   | Revisada | Hero, missatge amb fotografia, junta, història i estatuts                     |
| Socis                 | `/ca/socis/`                     | Socis — Red Kit Energy              | Revisada   | Revisada | Hero lleuger, accions, bloc fosc d'avantatges i directori                     |
| Hub d'escoles         | `/ca/escoles/`                   | Adaptació del sistema aprovat       | Revisada   | Revisada | Hero compartit i graella de programes                                         |
| Detall d'escola       | `/ca/escoles/escola-trail/`      | Detall d'Escola — Trail             | Revisada   | Revisada | Hero d'imatge, informació pràctica, galeria/absència i inscripció             |
| Pàgines fixes         | Documents, Contacte i legals     | Sistema compartit                   | Revisada   | Revisada | Intro editorial, seccions i shell coherent                                    |
| 404                   | `/404.html`                      | Sistema compartit                   | Revisada   | Revisada | Document útil, sense enllaços falsos                                          |

La revisió s'ha fet amb Playwright a `320×720`, `390×844`, `768×900`,
`1280×720` i `1440×900`. S'han recorregut individualment totes les rutes
publicades a 320 i 390 píxels i no s'hi ha detectat overflow horitzontal.

## Correccions Aplicades

- S'ha convertit el menú en un shell editorial amb estat actiu, CTA de Socis,
  menú mòbil i selector d'idioma; el logotip continua sent l'enllaç a l'inici.
- El menú mòbil manté el patró compacte fins als 1024 píxels, ofereix un control
  de 44 píxels amb indicador d'obertura, enllaços amb estat actiu i navegació
  completa amb teclat sense sortir del viewport.
- S'ha creat el prepeu compartit amb contacte i butlletí, respectant l'estat de
  disponibilitat de l'acció externa i sense inventar cap formulari.
- S'ha refet el peu com a bloc fosc de marca amb navegació, contacte i enllaços
  legals reals.
- S'han apropat els herois, separadors, files d'agenda, blocs pràctics, CTA,
  galeries i directoris a la composició de Stitch sense repetir targetes
  comercials ni introduir gradients.
- S'ha unificat el marge lateral fluid entre capçalera, herois, contingut,
  prepeu i peu; les pàgines pràctiques i legals utilitzen una entrada editorial
  clara i més curta en lloc de repetir un hero fotogràfic.
- Els herois de portada i esdeveniments carreguen una derivació lleugera en
  mòbil i la imatge de més resolució en pantalles grans.
- S'ha substituït la pila de dos fulls globals per una arquitectura Tailwind
  first: `global.css` conserva només els tokens i fonaments globals, les
  utilitats viuen al markup al costat de les classes BEM/E2E estables i el CSS
  específic queda en fulls cohesionats importats pel component o la plantilla
  que n'és propietària. `phase4-design.css` s'ha eliminat; els 3.800 rengles
  inicials han quedat en 2.207 rengles de CSS font, amb 123 a `global.css` i 298
  al full específic més llarg.
- S'han retirat els selectors morts sense cap classe corresponent al codi font:
  `about-board__photo`, `editorial-grid`, `event-date`, `event-meta`,
  `event-status`, `events-detail__modalities-label`,
  `events-detail__registration-label`, `events-detail__state`,
  `schools-detail__back-link` i `schools-detail__intro-grid`.
- També s'han eliminat pseudo-elements anul·lats amb `display: none`, propietats
  de graella aplicades a elements `display: block`, tokens sense consumidors i
  colors de vores laterals amb amplada zero.
- S'ha afegit una derivació optimitzada de la fotografia aprovada per als herois
  de càrrega prioritària, documentada a `apps/web/src/assets/README.md`.
- S'ha mantingut el contingut editorial existent, les rutes, els estats de
  disponibilitat i els selectors E2E.

## Segona Passada Sobre La Portada

Comparació directa amb la maqueta de portada aprovada per la persona
mantenidora:

- L'heroi separa el nom del club i el territori en dos colors, i la crida a
  l'acció passa a un botó compacte amb fletxa i interlletratge ampli.
- Les files de l'agenda passen a tres columnes (data, contingut i acció), amb
  la data destacada només a la pròxima activitat, l'estat com a etiqueta fosca,
  la localitat en vermell i separadors fins.
- La secció d'escoles centra el títol i la introducció, i les targetes mostren
  la fotografia de l'escola, el resum i l'acció alineada a la base.
- El bloc de socis passa a ser una caixa vermella dins del marc de pàgina amb
  el botó fosc, en lloc d'una franja a tota amplada.
- La capçalera, el prepeu i el peu redueixen els pesos tipogràfics
  desproporcionats i eliminen les ombres dures que la maqueta no recull.
- Les escoles deixen d'utilitzar el logotip com a portada i passen a tenir la
  seva fotografia, també al hub i al detall.
- S'ha corregit un `padding` de les targetes d'escola que referenciava un token
  d'espaiat inexistent i, per tant, no s'aplicava.

## Verificació Executada

- `pnpm check`: passat — 252 tests unitaris, typecheck i lint sense errors.
- `pnpm test:e2e`: passat — 122 proves, 4 omeses pels navegadors no coberts per
  l'escenari axe.
- `pnpm test:a11y`: passat — comprovacions axe de Chromium en escriptori i
  mòbil.
- `pnpm lighthouse`: passat — puntuacions de rendiment, accessibilitat, bones
  pràctiques i SEO dins dels llindars i pressupostos configurats; rendiment 98,
  98 i 99 a portada, hub i detall representatius, i 100 a la resta de
  categories.
- Revisió responsive manual: totes les rutes publicades revisades a 320 i 390
  píxels; shell i rutes representatives comprovats també a 768, 1280 i 1440
  píxels.
- Menú mòbil: obertura amb `Enter`, focus seqüencial al primer enllaç, estat
  `aria-current`, objectius tàctils de 44 píxels i panell contingut dins del
  viewport comprovats a 320, 390 i 768 píxels. En orientació horitzontal
  (`568×320`), el panell limita l'alçada i desplaça internament l'enllaç que rep
  el focus.
- Refactor d'estils: `pnpm format`, `pnpm check` (252 tests) i el build
  determinista amb `PUBLIC_SITE_ORIGIN=https://mountainrunners.cat` i
  `BUILD_TODAY=2026-08-04` passats. S'han comparat captures de pantalla completa
  de la base `08df668` i del refactor amb Playwright 1.61.1/Chromium, després de
  `networkidle` i `document.fonts.ready`, amb les animacions desactivades. Les 13
  rutes a `1280×720` i `320×720` conserven exactament les mateixes dimensions;
  25 de les 26 captures són idèntiques píxel a píxel. L'única diferència queda
  limitada al rectangle de la fotografia mandrosa d'història de Qui som, que la
  captura base va registrar abans de carregar.
- `pnpm validate` ha passat amb 122 proves E2E i 4 proves axe no aplicables fora
  de Chromium; `pnpm test:a11y` ha passat les dues vistes Chromium. La repetició
  local de `pnpm lighthouse` manté 100 en accessibilitat, bones pràctiques i SEO,
  i rendiment 96/98/99, però la portada registra un LCP de 2,705 s i no supera el
  límit de 2,5 s. La mateixa execució sobre la branca base registra 2,780 s, de
  manera que no és una regressió del refactor, però la comprovació no es declara
  passada.
- La correcció d'ownership de `:global(...)` manté les mateixes declaracions
  compilades per a About i Members: les regles compartides viuen als fulls de
  plantilla i el markdown del directori queda ancorat al seu component. `pnpm
check` i el build determinista han passat; les captures d'About i Members a
  `1280×720` i `320×720` són idèntiques píxel a píxel abans i després del canvi.

La validació automatitzada no equival a una auditoria manual completa WCAG 2.2
AA. Encara cal completar la revisió editorial de recursos, textos i traduccions
segons T4.3 i T4.5.
