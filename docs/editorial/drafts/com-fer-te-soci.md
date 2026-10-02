# Com fer-te soci o sòcia

## Fitxa de l'esborrany

- Tipus: blog, guia pràctica.
- Estat: esborrany provisional, pendent de revisió editorial de la persona
  mantenidora i de validar el formulari real.
- Fonts: informació facilitada per la persona mantenidora i acció d'alta
  registrada a `apps/web/src/content/external-actions/member-signup.yaml`.
- Idioma: català.
- Autoria: `mountain runners`, confirmada per la persona mantenidora.
- Data de publicació: pendent.

Aquest document conserva el pilot editorial inicial i les notes de revisió.
L'esborrany renderitzat viu a
[`com-fer-te-soci.yaml`](../../../apps/web/src/content/posts/com-fer-te-soci.yaml),
que explicita el caràcter provisional del formulari. El YAML és la font del render.
La descripció de les pantalles és provisional. No s'ha comprovat el formulari
extern ni s'han introduït dades personals o de pagament per validar-lo.
Només el text de l'apartat següent és una proposta de contingut per als lectors.

## Text proposat

### Titular

Com fer-te soci o sòcia de Mountain Runners

### Resum per al llistat

Una guia breu per començar l'alta al club, des de les dades personals fins a les
dades de pagament del formulari.

### Entradeta

Per fer-te soci o sòcia de Mountain Runners del Berguedà, accedeix al formulari
d'alta des de la pàgina de Socis de la web. El procés s'organitza en dues
pantalles: primer les dades personals i després les dades de pagament.

### 1. Omple les dades personals

A la primera pantalla, introdueix les dades personals que et demana el
formulari. Revisa que siguin correctes abans de continuar a la pantalla següent.

### 2. Completa les dades de pagament

A la segona pantalla, introdueix les dades de pagament sol·licitades i segueix
les indicacions del formulari.

### On començar l'alta

A la pàgina de Socis trobaràs l'accés al formulari d'alta i la informació del
club sobre federació i avantatges per a socis i sòcies.

Acció proposada: "Ves a la pàgina de Socis", amb destinació `/ca/socis/`.
En la implementació, aquest enllaç s'ha de construir amb el helper de rutes
localitzades; aquesta nota no forma part del text públic.

## Revisió pendent

- Validar que la primera pantalla sigui de dades personals i la segona de dades
  de pagament, i comprovar els passos que hi pugui haver després.
- Comprovar els camps obligatoris, el mitjà de pagament, els botons i els
  missatges reals abans d'afegir instruccions més concretes.
- Confirmar què significa completar el formulari: sol·licitud enviada, alta
  efectiva o pagament completat. El text no promet cap d'aquests resultats.
- No afirmar quotes, terminis, enviament de carnet o equivalència entre alta de
  soci i federació sense confirmació.
- Aprovar el text abans de publicar.
- Mantenir l'enllaç d'alta i les condicions vigents a les fonts autoritatives de
  la web, sense duplicar-les en aquest article.
