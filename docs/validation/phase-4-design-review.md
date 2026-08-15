# Revisió Visual De La Fase 4

## Estat

Registre de la revisió i les correccions fusionades a la PR #49 (`9c86b2b`).
L'entrega ja és a `main`, però aquesta nota no tanca la fase 4: la matriu és
representativa i encara falten el tancament editorial de T4.3 i la revisió
semàntica de T4.5.

## Fonts I Criteris

- `DESIGN.md` continua sent la font de veritat de la direcció visual.
- Les sis pantalles Stitch aprovades i llavors vigents a
  [`docs/design-references.md`](../design-references.md) es van utilitzar com a
  referència de composició. Aquest document ja no és una referència activa: el
  disseny s'itera sobre la implementació actual i `DESIGN.md`.
- La portada fixa la jerarquia del menú, el prepeu i el peu compartits. El menú
  manté les àrees Qui som, Escoles, Esdeveniments i Socis, amb la portada i la
  crida a Socis resoltes mitjançant el logotip i l'acció destacada; les dades
  de contacte viuen al prepeu compartit.
- Durant la PR #49 no es va modificar `DESIGN.md`. L'auditoria documental
  posterior n'ha aclarit l'ús admès d'overlays i targetes d'escola perquè el text
  descrigui la implementació aprovada sense introduir un sistema paral·lel.

## Matriu De Cobertura Visual

| Àrea                  | Ruta representativa              | Referència Stitch                   | Escriptori | Mòbil    | Resultat                                                                        |
| --------------------- | -------------------------------- | ----------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------- |
| Portada               | `/ca/`                           | Inici — Updated Footer              | Revisada   | Revisada | Shell vermell, transició negra, agenda, blocs de territori i prepeu compartit   |
| Hub d'esdeveniments   | `/ca/esdeveniments/`             | Esdeveniments — Hero Unificat       | Revisada   | Revisada | Hero unificat, calendari mensual amb popovers, llista activa i taula d'històric |
| Detall d'esdeveniment | `/ca/esdeveniments/berga-trail/` | Detall d'esdeveniment — Berga Trail | Revisada   | Revisada | Hero, badge de relació, informació pràctica i acció                             |
| Qui som               | `/ca/qui-som/`                   | Qui som — Hero Unificat             | Revisada   | Revisada | Hero, missatge amb fotografia, junta completa, història i estatuts              |
| Socis                 | `/ca/socis/`                     | Socis — Red Kit Energy              | Revisada   | Revisada | Hero lleuger, accions, bloc fosc d'avantatges i directori                       |
| Hub d'escoles         | `/ca/escoles/`                   | Adaptació del sistema aprovat       | Revisada   | Revisada | Hero compartit i graella de programes amb fotografia real                       |
| Detall d'escola       | `/ca/escoles/escola-trail/`      | Detall d'Escola — Trail             | Revisada   | Revisada | Hero d'imatge, informació pràctica, galeria/absència i inscripció               |
| Pàgines fixes         | Documents i legals               | Sistema compartit                   | Revisada   | Revisada | Intro editorial, seccions i shell coherent                                      |
| 404                   | `/404.html`                      | Sistema compartit                   | Revisada   | Revisada | Document útil, sense enllaços falsos                                            |

La revisió s'ha fet amb Playwright a `320×720`, `390×844`, `768×900`,
`1280×720` i `1440×900`. S'han recorregut individualment totes les rutes
publicades a 320 i 390 píxels i no s'hi ha detectat overflow horitzontal.

La sortida actual conté 48 rutes canòniques (16 per idioma). La taula anterior
només conserva evidència visual representativa en català i, per tant, no és la
matriu exhaustiva de rutes, estats i idiomes exigida per T4.1.

## Correccions Aplicades

- S'ha convertit el menú en un shell editorial amb estat actiu, CTA de Socis,
  menú mòbil i selector d'idioma; el logotip continua sent l'enllaç a l'inici.
- El menú mòbil manté el patró compacte fins als 1024 píxels, ofereix un control
  de 44 píxels amb indicador d'obertura, enllaços amb estat actiu i navegació
  completa amb teclat sense sortir del viewport.
- S'ha creat el prepeu compartit amb contacte i butlletí, respectant l'estat de
  disponibilitat de l'acció externa: quan el butlletí no està disponible es
  mostra una previsualització desactivada, mai un formulari que reculli dades.
- S'ha refet el peu com a bloc fosc de marca amb navegació, xarxes socials i
  enllaços legals reals; el contacte viu al prepeu.
- S'han apropat els herois, separadors, files d'agenda, blocs pràctics, CTA,
  galeries i directoris a la composició de Stitch sense repetir targetes
  comercials ni introduir gradients decoratius aliens a la marca. Es mantenen
  overlays i textures controlats per a llegibilitat i transicions editorials.
- S'ha unificat el marge lateral fluid entre capçalera, herois, contingut,
  prepeu i peu; les pàgines pràctiques i legals utilitzen una entrada editorial
  clara i més curta en lloc de repetir un hero fotogràfic.
- Els herois de portada i esdeveniments carreguen una derivació lleugera en
  mòbil i la imatge de més resolució en pantalles grans.
- S'ha substituït la pila de dos fulls globals per una arquitectura Tailwind
  first: `global.css` conserva només els tokens i fonaments globals, les
  utilitats viuen al markup al costat de les classes BEM/E2E estables i el CSS
  específic queda en fulls cohesionats importats pel component o la plantilla
  que n'és propietària. `phase4-design.css` s'ha eliminat. L'arbre final conté
  3.894 rengles als fulls de `src/styles/`, amb 123 a `global.css` i 668 al full
  específic més llarg (`school-detail-preview.css`); la xifra és descriptiva i
  no un criteri de qualitat per si sola.
- S'han retirat els selectors morts sense cap classe corresponent al codi font:
  `editorial-grid`, `event-date`, `event-meta`, `event-status`,
  `events-detail__modalities-label`, `events-detail__registration-label`,
  `events-detail__state`, `schools-detail__back-link` i
  `schools-detail__intro-grid`. (`about-board__photo` es manté viu: es va
  reubicar de `global.css` a `about.css` i es va reestilitzar.)
- També s'han eliminat pseudo-elements anul·lats amb `display: none`, propietats
  de graella aplicades a elements `display: block`, tokens sense consumidors i
  colors de vores laterals amb amplada zero.
- S'ha afegit una derivació optimitzada de la fotografia aprovada per als herois
  de càrrega prioritària, documentada a `apps/web/src/assets/README.md`.
- S'ha retirat la pàgina de contacte: les seves dades passen al prepeu compartit
  i no queda cap enllaç a la ruta retirada (menú, peu, sitemap, proves i pàgina
  404). La resta de rutes publicades, el contingut editorial existent i els
  estats de disponibilitat es mantenen; els selectors E2E s'han actualitzat allà
  on el redisseny ho requeria i les noves estructures tenen selectors estables
  propis.

## Confirmacions De La Persona Mantenidora

El 10 d'agost de 2026 la persona mantenidora va confirmar que tot el que
aquesta entrega afegeix o modifica és consentit i controlat:

- **Junta directiva**: consentiment de publicació de noms, cognoms i rols de
  la junta completa (Albert Penyaranda Riu, Joel Brià Cabestany i David Torres
  Altarriba, amb Ernest Garrido a la presidència); cap dada de contacte. Es
  registra també a `docs/phase-3-editorial-inventory.md`.
- **Contingut i rutes noves**: l'esdeveniment `anella-verda` (ruta i imatge
  pròpies), el contingut afegit o corregit a esdeveniments, escoles i entitats,
  i les extensions del model (`summary` a esdeveniments, `coverCard` i
  `requirements` a escoles) són decisions volgudes d'aquesta fase, no peticions
  fora de l'abast.
- **Recursos externs**: els vídeos incrustats de YouTube (Socis i escoles,
  domini `youtube-nocookie`) i l'enllaç d'Instagram del peu
  (`instagram.com/infomountain`) són aprovats i es consideren part del disseny
  de la T4.4.
- **Recursos editorials**: la fotografia del hub d'esdeveniments prové del web
  oficial, queda aprovada per a reutilització local i substitueix la fotografia
  de Socis que s'hi havia reutilitzat fora de context. Com que el fotògraf no
  està identificat, mostra temporalment el crèdit d'arxiu de Mountain Runners del
  Berguedà. L'autoria de les quatre fotografies de la galeria Skimo correspon al
  mateix club.
- **Prepeu**: el bloc de butlletí mostra una previsualització desactivada
  (input i botó `disabled`, sense recollida ni enviament de dades) quan l'acció
  externa `newsletter` no està disponible; no és un formulari.

Aquestes confirmacions resolen les discrepàncies pendents de consentiment o
procedència que la revisió editorial (T4.3) hagués d'haver registrat abans de
tancar la fase.

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
  desproporcionats i les ombres que la maqueta no recull. La capçalera conserva
  ombres d'offset controlades en controls i panells com a decisió visual final.
- Les escoles deixen d'utilitzar el logotip com a portada i passen a tenir la
  seva fotografia, també al hub i al detall.
- S'ha corregit un `padding` de les targetes d'escola que referenciava un token
  d'espaiat inexistent i, per tant, no s'aplicava.

## Verificació Executada

- `pnpm check`: passat — 213 casos `it`/`test` directes i 11 taules
  parametritzades (`it.each`), typecheck i lint sense errors.
- `pnpm test:e2e`: passat — 122 proves, 4 omeses pels navegadors no coberts per
  l'escenari axe.
- `pnpm test:a11y`: passat — comprovacions axe de Chromium en escriptori i
  mòbil.
- `pnpm lighthouse`: la repetició final consta de cinc execucions sobre el mateix
  commit i entorn, i utilitza la mediana d'acord amb la quality gate. Portada,
  hub d'esdeveniments i detall d'Anella Verda obtenen respectivament rendiment
  98/99/99 i LCP de 2,333 s, 1,954 s i 1,810 s; accessibilitat, bones pràctiques
  i SEO obtenen 100 a totes les mostres i no se supera cap pressupost.
- Revisió responsive manual: totes les rutes publicades revisades a 320 i 390
  píxels; shell i rutes representatives comprovats també a 768, 1280 i 1440
  píxels.
- Menú mòbil: obertura amb `Enter`, focus seqüencial al primer enllaç, estat
  `aria-current`, objectius tàctils de 44 píxels i panell contingut dins del
  viewport comprovats a 320, 390 i 768 píxels. En orientació horitzontal
  (`568×320`), el panell limita l'alçada i desplaça internament l'enllaç que rep
  el focus.
- Refactor d'estils: `pnpm format`, `pnpm check` (213 casos directes i 11 taules
  `it.each`) i el build determinista amb `PUBLIC_SITE_ORIGIN=https://mountainrunners.cat` i
  `BUILD_TODAY=2026-08-04` passats. S'han comparat captures de pantalla completa
  de la base `08df668` i del refactor amb Playwright 1.61.1/Chromium, després de
  `networkidle` i `document.fonts.ready`, amb les animacions desactivades. Les 13
  rutes a `1280×720` i `320×720` conserven exactament les mateixes dimensions;
  25 de les 26 captures són idèntiques píxel a píxel. L'única diferència queda
  limitada al rectangle de la fotografia mandrosa d'història de Qui som, que la
  captura base va registrar abans de carregar.
- `pnpm validate` ha passat amb 122 proves E2E i 4 proves axe no aplicables fora
  de Chromium; `pnpm test:a11y` ha passat les dues vistes Chromium. Una primera
  sèrie controlada de cinc execucions Lighthouse va confirmar que la portada ja
  complia amb una mediana de 2,330 s, però va detectar que el detall d'Anella
  Verda transferia una coberta PNG de 983 KiB, superava el pressupost d'imatge i
  registrava una mediana LCP de 6,606 s. La derivació WebP conserva les dimensions
  `819×1024`, redueix el fitxer font a 53 KiB i resol el pressupost en les cinc
  repeticions finals.
- La correcció d'ownership de `:global(...)` manté les mateixes declaracions
  compilades per a About i Members: les regles compartides viuen als fulls de
  plantilla i el markdown del directori queda ancorat al seu component. `pnpm
check` i el build determinista han passat; les captures d'About i Members a
  `1280×720` i `320×720` són idèntiques píxel a píxel abans i després del canvi.

## Punts Pendents De Tancament

- Completar la matriu de les 48 rutes canòniques, els estats representatius, la
  redirecció arrel i la 404, amb cobertura de `ca`, `es` i `en`.
- Revisar semànticament les traduccions i conservar totes les dades pràctiques i
  atribucions exigibles en cada idioma.
- Tancar o acceptar explícitament el pressupost Lighthouse: l'última execució
  registrada té un LCP de portada de 2,705 s davant del límit de 2,5 s.
- Corregir o especificar separadament les desviacions dels ADR 0004, 0005 i 0006
  recollides a `docs/content-model.md` i `docs/code-conventions.md`.

L'11 d'agost de 2026 la persona mantenidora va decidir ajornar la resolució dels
embeds de YouTube i avançar amb la resta de punts. La discrepància queda
documentada com a context de la revisió. Posteriorment, el mateix dia, va aprovar
mantenir per ara els reproductors existents en mode de privacitat millorada i
actualitzar-ne els textos legals. Les polítiques de cookies i privacitat
descriuen ara que els iframes de `youtube-nocookie.com` es carreguen de manera
diferida segons els criteris del navegador, que la connexió es pot establir abans
de prémer el botó de reproducció i que Google o YouTube poden rebre dades
tècniques. Aquesta actualització resol la contradicció de fase 4; una càrrega
estrictament iniciada per clic queda fora d'aquesta correcció.

La validació automatitzada no equival a una auditoria manual completa WCAG 2.2
AA. La fase 5 continua bloquejada fins que els punts publicables anteriors
tinguin una resolució traçable.
