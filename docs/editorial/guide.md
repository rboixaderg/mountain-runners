# Guia editorial de notícies i blog

## Preparar una entrada

Les notícies expliquen fets del club amb la informació principal al començament.
El blog respon una pregunta del lector o desenvolupa una opinió identificada com
a tal. La signatura per defecte és `Mountain Runners`, amb autoria
`organization`. Si s'indica una altra autoria, s'escriu el seu nom públic i el
tipus `person` o `organization`. El YAML sempre declara l'autoria explícitament;
el valor per defecte és un criteri editorial, no un nom afegit pel render.

Els noms propis conserven les majúscules al YAML; no s'aplica `capitalize` ni
una conversió automàtica a altres autories. El detall agrupa la signatura i les
dates sota el titular. Els esborranys mostren «Preparat el», els articles publicats
«Publicat el» i, si consta una actualització, «Actualitzat el» en una línia pròpia.
La data de l'esdeveniment no substitueix la data editorial. No s'inventen hores.

1. Recollir els fets confirmats, les fonts i els dubtes abans de redactar.
2. Utilitzar la [plantilla de notícia](templates/news.md) o la
   [plantilla de blog](templates/blog.md).
3. Escriure en català. Afegir castellà o anglès només amb tota la variant
   requerida traduïda. No copiar el català com a traducció.
4. Aplicar `unslop`: frases concretes, sense publicitat ni èmfasi buit.
5. Guardar l'entrada amb `published: false`. Preparar-la no equival a aprovar-la.

El format executable és YAML restringit a
`apps/web/src/content/posts/<id>.yaml`. El contracte és a
[l'especificació](../specs/news-and-blog.md#model-de-contingut) i
[el model](../content-model.md). Les plantilles són fitxes de treball, no fitxers
per copiar directament a la col·lecció.

Els articles, publicats o en esborrany, viuen només a la col·lecció `posts`.
`docs/` conté la documentació del flux, no còpies dels textos de la web ni
documents complementaris de cada entrada. Les notes de revisió, les aprovacions
pendents i les evidències de validació es registren a la PR i a CI.

## Exactitud i fonts

- Separar fets, opinions i instruccions provisionals.
- Atribuir declaracions i dades a una font identificable. No inventar quotes,
  resultats, assistència, testimonis ni terminis.
- Si dues fonts es contradiuen, registrar la discrepància i preguntar a la
  persona mantenidora. No triar la versió més convenient.
- Si falten dades, fer preguntes concretes. Ometre un detall prescindible és
  preferible a inventar-lo; un dubte que altera el sentit impedeix publicar.
- Enllaçar les condicions vigents del club en lloc de duplicar quotes o passos
  que poden canviar. No provar formularis amb dades personals o pagaments reals.

## Imatges i privacitat

### Portada de notícies i blog

La mateixa imatge del camp `cover` es fa servir al detall i com a miniatura al
llistat de Notícies o Blog. No cal una segona fotografia per al llistat. Sense
portada, l'entrada es mostra només amb text, sense un espai d'imatge buit.

Quan es demani preparar o afegir una portada, l'agent ha d'indicar aquestes
mides abans de demanar o triar el fitxer:

- Format recomanat horitzontal **16:9**.
- Mida recomanada **1600 × 900 píxels**; preferiblement no menys de
  **1200 × 675 píxels** per a una fotografia.
- Al detall, la imatge ocupa un marc horitzontal amb preferència 16:9 i una
  altura màxima de **320 píxels**, o 20rem amb la mida de lletra base.
- Al llistat, la miniatura ocupa **192 × 108 píxels**, o 12rem × 6,75rem.

Són recomanacions editorials, no requisits rígids del YAML. L'agent ha de
comprovar les dimensions reals del fitxer, informar si difereixen del format
recomanat i explicar-ne el resultat. La imatge es mostra sencera i centrada,
sense deformar ni retallar. Una fotografia 16:9 aprofita millor el marc; un
logotip quadrat deixa espai als costats. No s'ha de generar ni ampliar un logo
només per arribar a la resolució recomanada.

El build genera WebP de fins a 480 i 1200 píxels d'amplada, sense ampliar els
originals. Cal comprovar el pes resultant contra el pressupost de 300 KiB per
imatge, no exigir que l'original tingui aquell pes. Els crèdits i l'alt han de
ser complets en cada idioma on es mostri la portada.

### Imatges de les seccions

Cada secció pot ometre `images` o incloure entre una i deu imatges locals amb
`resource`, `alt` i `attribution`. `caption` és opcional. Si una secció declara
imatges, els textos de totes han de ser complets en l'idioma de l'article;
si falta una traducció, aquella variant no es genera. No s'amaga una captura
necessària per entendre un tutorial ni es fa fallback al català.

En escriptori, la primera secció amb imatges mostra les imatges a l'esquerra i
el text a la dreta; la següent, a l'inrevés. Les seccions sense imatges no alteren
l'alternança i mantenen l'amplada de lectura. En mòbil, el text precedeix les
imatges, que es mostren sense retallar i amb càrrega diferida. L'altura màxima
és de 30rem, 480 píxels amb la mida de lletra base, i l'amplada s'ajusta a la
columna sense deformar la imatge. Les imatges queden centrades. Les imatges
d'una mateixa secció s'apilen en l'ordre del YAML. En clicar una imatge de
secció s'obre un visor ampliat amb desplaçament per veure-la sencera. Es pot
tancar amb el botó, amb Escape o clicant fora del visor. El focus torna a
l'enllaç de la imatge. Sense JavaScript, l'enllaç obre la imatge directament.

Exemple d'una secció il·lustrada. El fitxer ha d'existir i estar aprovat abans
d'incorporar la referència al contingut:

```yaml
sections:
  - heading:
      ca: Revisa les dades
    body:
      ca: Comprova les dades abans de continuar amb el pas següent.
    images:
      - resource:
          kind: local
          path: src/content-assets/posts/com-fer-te-soci/revisio.png
        alt:
          ca: Pantalla de revisió del formulari amb les dades de prova.
        attribution:
          ca: Mountain Runners
        caption:
          ca: Revisa les dades abans de continuar.
```

Desa els fitxers a `apps/web/src/content-assets/posts/<id>/`. Prepara captures
amb dades fictícies i elimina dades personals, bancàries i identificadors abans
d'afegir-les a Git. El text de la captura no substitueix l'explicació del pas.

No afegir una coberta si no hi ha una imatge aprovada, fotografia o logotip.
Confirmar drets, crèdit i
permís de publicació, especialment si hi apareixen menors. Escriure l'alt després
de veure la imatge. Els consentiments i les proves de drets es custodien fora del
repositori. Els recursos locals viuen a `src/content-assets/`, mai a `public/`
si són exclusius d'un esborrany.

Git i les previews són públics. No incloure informació de salut, secrets,
embargaments privats ni dades personals no publicables. `noindex` no restringeix
l'accés.

## Revisió i publicació

La persona mantenidora aprova fets, signatura, traduccions, drets i data de
publicació. La data de l'acte no és `publishedAt`: aquest camp és l'instant de
publicació, amb offset. `createdAt` identifica la preparació. `updatedAt` es
reserva per a canvis materials. Les correccions s'apliquen directament al text;
no hi ha un camp ni una secció separada de rectificacions.

El preview permet llegir l'esborrany sense canviar `published`. Una petició de
publicar sense revisió no autoritza l'agent a marcar-lo com a publicat, fer merge
o desplegar. La publicació segueix una PR revisada i el flux protegit del projecte.

## Comprovacions de la guia i la skill

| Cas                    | Resultat esperat                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Inauguració del local  | Preservar data i ubicació confirmades; no inventar assistència ni fotografia.                         |
| Guia de socis          | Identificar els passos del formulari com a provisionals fins a revisió; no prometre alta o cobrament. |
| Fonts contradictòries  | Preguntar i deixar la discrepància pendent, sense publicar.                                           |
| Dades insuficients     | Preguntar pels fets necessaris; no omplir-los amb text versemblant.                                   |
| Publicar sense revisió | Mantenir `published: false` i demanar aprovació humana.                                               |

Aquesta matriu comprova el contracte escrit. No acredita una avaluació automàtica
del comportament d'un model ni la revisió editorial dels pilots.
