# Notes de revisió de la guia de socis

El contingut de l'article viu únicament a
[`com-fer-te-soci.yaml`](../../../apps/web/src/content/posts/com-fer-te-soci.yaml),
amb `published: false`. Aquest document només conserva les notes de revisió.

Les fonts són les quatre captures de Playoff facilitades per la persona
mantenidora el 4 d'octubre de 2026, la seva confirmació que el pagament és
únicament per domiciliació bancària i l'acció d'alta registrada a
[`member-signup.yaml`](../../../apps/web/src/content/external-actions/member-signup.yaml).
La guia descriu les quatre pantalles de les captures en ordre: dades personals,
mètode de pagament, condicions legals i resum. Els accessos des de la capçalera,
el menú mòbil, la portada i la secció Socis s'han contrastat amb el codi del web.
No s'ha completat el formulari extern ni s'han introduït dades personals o de
pagament per validar-lo. Les quatre captures s'han incorporat com a recursos
locals de les seccions, amb alt, crèdit i peu en català. S'han conservat senceres,
sense retallar, i s'han eliminat les metadades. A la captura del resum s'han
substituït les dades abreujades per "Dades fictícies de prova"; els originals de
Downloads no s'han modificat.

## Revisió pendent

- Revisar amb la persona mantenidora el text basat en les captures i comprovar
  que el formulari vigent mantingui els mateixos camps i botons.
- Confirmar el crèdit i els drets d'ús de les captures. La persona mantenidora
  n'ha demanat la incorporació per a revisió, no la publicació de l'article.
- Revisar la llegibilitat de les captures en mòbil i escriptori.
- Confirmar què significa completar el formulari: sol·licitud enviada, alta
  efectiva o pagament completat. El text no promet cap d'aquests resultats.
- No afirmar quotes, terminis, enviament de carnet o equivalència entre alta de
  soci i federació sense confirmació.
- Aprovar el text i decidir la data de publicació abans de publicar.
- Mantenir l'enllaç d'alta i les condicions vigents a les fonts autoritatives de
  la web, sense duplicar-les en aquest article.

## Comprovacions locals del 4 d'octubre de 2026

- Format dels tres fitxers de text modificats, lint del YAML i `git diff --check`
  correctes.
- 66 proves de model de contingut, posts i imatges de secció superades.
- Builds de preview i públic correctes, amb verificació i18n. El preview inclou
  les quatre captures, amb alt i càrrega diferida, i conserva `noindex, nofollow`.
  La guia no apareix al sitemap.
- Després de construir el preview, el build públic exclou la ruta de la guia,
  els seus recursos d'imatge i el text distintiu comprovat.
- Revisió amb Chromium a 1280 × 720 i 320 × 720: les quatre imatges es carreguen
  i no hi ha desbordament horitzontal. Les captures senceres són una referència
  visual; el text del pas explica els camps sense exigir llegir la captura petita.
- WebP de 1200 píxels generats pel build entre 22.148 i 42.594 bytes per imatge.
  No s'han afegit dependències ni scripts al navegador.
- No s'ha executat el gate complet `pnpm validate`, Lighthouse ni una auditoria
  manual d'accessibilitat. Aquesta revisió no és aprovació editorial ni de drets.
