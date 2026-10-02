# Validació local de recursos i modes editorials

## Estat

NB-04 en curs a `feat/news-blog-artifacts`, worktree
`mountain_runners-news-blog-artifacts`, creat des de `origin/main` (`fab6fd9`).
Inclou una còpia explícita dels dotze fitxers de dependència NB-03, encara no
comesos; el worktree original de NB-03 no s'ha modificat. No hi ha commit, PR,
publicació o desplegament.

La persona mantenidora ha autoritzat consolidar la funcionalitat en aquest
worktree i lliurar documentació i implementació en una única PR. L'especificació,
l'ADR, l'esmena de fase 6 i els pilots ja no viuen com a canvis pendents a `main`.
La còpia de NB-03 es conserva al seu worktree anterior, però no és la font activa.

## Implementat

- `getPostCover` valida la completesa d'alt i crèdit en l'idioma renderitzat.
- `getPostLocalResources` selecciona i deduplica cobertes de variants visibles.
- La ruta `content-resources` uneix aquests recursos amb els recursos públics
  existents, sense habilitar esborranys de les altres col·leccions.
- `getBuildPostVariants` només habilita esborranys amb `PUBLIC_PREVIEW=true`.
- Configuració Astro rebutja valors de flag desconeguts. Els entry points
  d'artefacte i de reproductibilitat fixen el flag corresponent al subprocess
  perquè un `.env` local no n'inverteixi el mode. Producció requereix l'origen
  de producció; preview conserva la comprovació exacta de PR i origen existent.
- No canvien workflows, secrets, servidors, límits o format de manifest.

## Evidència

`pnpm check` ha passat amb 364 tests de web i 116 tests de servidor/integració,
a més de format, lint i typecheck sense errors. La prova
`tools/preview/editorial-resources.test.mjs` utilitza una còpia temporal de
l'aplicació, sense `.env`, assets generats o instal·lacions de dependències.
Hi afegeix quatre fixtures i tres imatges de prova, no contingut real.

La prova executa generació Paraglide, el CLI Astro instal·lat i el verificador
de sortida existent. Compara paths i SHA-256 de tota la sortida:

1. Build públic: coberta publicada i compartida presents; coberta exclusiva
   d'esborrany absent.
2. Un segon build públic amb `dist` eliminat reprodueix la mateixa sortida.
3. Build preview: la coberta exclusiva d'esborrany és present.
4. Build públic sobre la sortida anterior de preview torna exactament a la
   sortida pública, sense residus.

Les unitàries comproven modes contradictoris, flags invàlids, origen públic
incorrecte, recursos compartits, variants sense coberta i crèdit incomplet.
La prova de recursos també s'ha executat separadament. El verificador de rutes
no s'ha relaxat ni s'hi han afegit pàgines editorials fictícies permanents.

## Descobertes i comprovació pendent

Una prova exploratòria amb una pàgina temporal i `getImage` per generar WebP ha
fallat amb `MissingSharp`: el projecte no té `sharp` instal·lat. L'especificació
no autoritza dependències noves. No s'ha instal·lat, activat ni substituït un
servei d'imatges per fer passar la prova.

Una segona prova amb `import.meta.glob` **lazy** de totes les cobertes ha emès
l'original de l'esborrany sota `_astro` encara que el render només demanés
variants publicades. Per tant, no és una solució segura per al render editorial.
Aquestes pàgines exploratòries eren temporals i s'han retirat; no hi ha imports
editorials glob a l'aplicació.

La prova estable valida recursos originals, no imatges transformades. La
comprovació de transformacions continua pendent: cal decidir si els articles
utilitzaran originals seleccionats, com les seccions existents, o aprovar un
servei de transformació i tornar a provar-ne l'aïllament. NB-04 no es declara
completa. Les negatives de textos, routes i metadades dels articles s'ampliaran
quan NB-05 i NB-06 n'implementin les sortides.

Els avisos existents de ruta arrel i sourcemaps de Paraglide no s'han ocultat.
La col·lecció buida de posts provoca un avís Astro en consultar-la; desapareixerà
quan s'hi integrin els pilots, sense necessitat d'afegir contingut fictici real.
