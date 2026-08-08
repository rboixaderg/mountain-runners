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
- S'ha separat la capa visual de fase 4 a
  `apps/web/src/styles/phase4-design.css`; `global.css` conserva els fonaments i
  els selectors existents per evitar regressions de les proves E2E.
- S'ha afegit una derivació optimitzada de la fotografia aprovada per als herois
  de càrrega prioritària, documentada a `apps/web/src/assets/README.md`.
- S'ha mantingut el contingut editorial existent, les rutes, els estats de
  disponibilitat i els selectors E2E.

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

La validació automatitzada no equival a una auditoria manual completa WCAG 2.2
AA. Encara cal completar la revisió editorial de recursos, textos i traduccions
segons T4.3 i T4.5.
