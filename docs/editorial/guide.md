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
`docs/` conté documentació i notes de revisió, no còpies dels textos de la web.

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

Cada secció pot ometre `images` o incloure entre una i deu imatges locals amb
`resource`, `alt` i `attribution`. `caption` és opcional. Si una secció declara
imatges, els textos de totes han de ser complets en l'idioma de l'article;
si falta una traducció, aquella variant no es genera. No s'amaga una captura
necessària per entendre un tutorial ni es fa fallback al català.

En escriptori, la primera secció amb imatges mostra les imatges a l'esquerra i
el text a la dreta; la següent, a l'inrevés. Les seccions sense imatges no alteren
l'alternança i mantenen l'amplada de lectura. En mòbil, el text precedeix les
imatges, que es mostren sense retallar i amb càrrega diferida. Les imatges d'una
mateixa secció s'apilen en l'ordre del YAML.

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

No afegir una coberta si no hi ha fotografia aprovada. Confirmar drets, crèdit i
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
reserva per a canvis materials; una rectificació incorpora data i nota explícites.

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
