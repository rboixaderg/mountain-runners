# Especificació: Servei D'entrenaments Funcionals Per A Socis

## Estat

Autoritzada per la persona mantenidora el 10 d'octubre de 2026. La definició de
la tasca és aprovada; la implementació continua pendent. No s'afegeix una fase al
roadmap ni s'amplia cap entrega activa.

## Objectiu

Afegir a la pàgina Socis una secció informativa sobre els entrenaments funcionals
del club, amb accés directe a Playoff perquè les persones sòcies consultin les
sessions disponibles i en facin la reserva.

## Límits i decisions confirmades

- La secció descriu l'activitat, indica que és exclusiva per a socis i sòcies,
  mostra l'adreça del local i enllaça a la reserva de Playoff.
- Els horaris posteriors a l'octubre encara no estan definits. La web no en
  publicarà cap com a horari fix ni recurrent; Playoff és la font per consultar
  disponibilitat i reservar.
- No es mostrarà l'abonament mensual anunciat com a possibilitat per al novembre
  fins que se n'hagin confirmat les condicions.
- Els missatges de la pàgina fixa es tradueixen als idiomes publicats (`ca`,
  `es` i `en`). L'estructura estable i l'ordre de la secció viuen en components,
  d'acord amb l'ADR 0005.
- L'enllaç aprovat per a les reserves és
  `https://mountainrunners.playoffinformatica.com/Reserva.php#`.
- L'adreça es resol des de la dada institucional publicada. La URL de reserva és
  una acció externa validada i identificada de manera estable, no una URL
  duplicada als missatges de traducció.
- La secció és veïna dels blocs d'alta i federació, abans del vídeo institucional;
  no substitueix «Avantatges per a socis i sòcies» ni el directori de
  col·laboradors.
- Es reutilitzen el model de contingut, les regles d'enllaç extern i els patrons
  visuals existents. No es requereix un model de sessions o calendari propi.

## Resultats esperats

- La pàgina Socis presenta una secció pròpia d'entrenaments funcionals en català,
  castellà i anglès.
- El contingut explica que les sessions treballen força i control corporal,
  incloent-hi estabilitat, mobilitat i core, i que s'adapten a diferents nivells.
- La secció fa explícita l'exclusivitat per a socis i sòcies i mostra l'adreça
  vigent del local de Mountain Runners.
- Un enllaç accessible porta directament a la reserva de Playoff, on es poden
  consultar les sessions disponibles.
- No es publiquen horaris futurs no confirmats ni condicions d'un abonament
  mensual encara no aprovat.

## Dependències i ordre d'inici

La tasca pot començar amb les dades ja disponibles: l'acció externa de reserva
de Playoff anunciada per l'associació i l'adreça institucional publicada. Abans
de fusionar la implementació, cal comprovar que la URL continua sent la destinació
aprovada per a les reserves. Aquesta comprovació és editorial i no requereix
consultar la disponibilitat remota del servei.

## Tasques, entregues i seguiment

| Unitat | Abast                                                        | Dependències                                    | Estat   | PR  |
| ------ | ------------------------------------------------------------ | ----------------------------------------------- | ------- | --- |
| MS-01  | Afegir la secció d'entrenaments funcionals a la pàgina Socis | URL de reserva i adreça institucional aprovades | Pendent |     |

### MS-01. Afegir El Servei D'entrenaments Funcionals A Socis

**Abast:** incorporar una secció localitzada a la composició existent de la
pàgina Socis; afegir una acció externa estable per a la reserva si el
identificador actual no cobreix aquest servei; reutilitzar el contacte
institucional per a l'adreça; presentar la descripció, l'exclusivitat per a
socis i sòcies i l'enllaç a Playoff.

**Fora d'aquesta tasca:** publicar horaris de novembre o posteriors, gestionar
reserves al web, mostrar preus o aforament, publicar l'abonament mensual,
introduir una col·lecció de serveis, canviar les rutes o la navegació principal,
afegir imatges noves o alterar els avantatges dels col·laboradors.

**Dependències:** cap canvi d'arquitectura; es reutilitzen el catàleg d'accions
externes, les dades de contacte publicades i els recursos de traducció existents.

**Resultat observable:** a cadascuna de les rutes idiomàtiques de Socis es pot
identificar el servei, entendre'n l'exclusivitat, consultar on es fa i obrir la
reserva de Playoff. La pàgina no presenta com a vigents dades de calendari o
abonament no confirmades.

**Comprovacions mínimes:** proves de render o de contracte de pàgina que cobreixin
els tres idiomes, la secció i la destinació exacta de la reserva; recorregut de
navegador existent de Socis ampliat només si cal protegir una interacció nova;
`pnpm check`, comprovacions E2E i axe aplicables, revisió visual manual en mòbil
i escriptori i `git diff --check`. Les proves comproven la URL configurada, no la
seva disponibilitat remota.

**PR:** una PR dedicada per a MS-01, amb enllaç a aquesta especificació, resultats
de les comprovacions i revisió del contingut en els tres idiomes.

## Requisits De Contingut I Presentació

- El text presenta l'activitat com a entrenament funcional al local del club,
  orientat a treballar força i control corporal i a complementar l'activitat
  esportiva i la condició física general.
- S'indica que els exercicis s'adapten als diferents nivells i poden ser útils
  tant per a la pràctica de muntanya com per al benestar i la forma física.
- La crida a l'acció explica que permet consultar sessions i reservar a Playoff.
  L'enllaç és identificable, usable amb teclat i exposa un nom accessible que
  n'explica el destí o l'acció.
- La secció segueix els patrons de `PageSection`, la jerarquia tipogràfica i
  l'escala visual de `DESIGN.md`. No es crea una pàgina comercial de gimnàs ni es
  repeteixen targetes promocionals genèriques.
- Les traduccions mantenen el mateix significat i els mateixos fets confirmats;
  cap variant no afegeix horaris, preus, aforament o condicions que no apareguin
  en la resta.

## Estratègia De Tests I Qualitat

- Cobrir el contracte del contingut i l'enllaç a nivell de render o build amb les
  tres variants publicades. No cal repetir una comprovació estàtica en tots els
  navegadors.
- Reutilitzar la cobertura E2E de la pàgina Socis; afegir o ampliar un recorregut
  només per verificar el resultat observable del nou enllaç o la navegació amb
  teclat que no quedi coberta per la prova de render.
- Executar les comprovacions aplicables de format, lint, tipus, proves, build,
  E2E i axe segons `docs/testing-strategy.md` i la quality gate vigent.
- Revisar manualment la lectura, el focus visible, el contrast i la composició en
  mòbil i escriptori. Les comprovacions automatitzades no equivalen a una
  declaració de conformitat WCAG completa.
- No cal afegir un pressupost Lighthouse específic: la tasca no afegeix imatges,
  JavaScript ni una ruta nova. Es conserven les comprovacions globals vigents.

## Seguretat I Privacitat

- La destinació de reserva és HTTPS i travessa la validació existent d'accions
  externes. No s'afegeixen formularis, recollida de dades personals, comptes,
  cookies, codi remot ni serveis nous.
- L'enllaç no incorpora dades personals ni paràmetres de seguiment propis.
- No es comprova l'estat remot de Playoff durant el build o les proves; una
  indisponibilitat externa no ha d'impedir generar la web.

## Fora D'abast

- Horaris, recurrència o calendari de sessions a partir del novembre.
- Import per sessió, límit de places i abonament mensual fins que el club en
  confirmi la vigència i les condicions.
- Reserva, pagament, llista d'espera, autenticació o gestió de places dins del
  lloc web.
- Nous models editorials, CMS, backend, aplicació mòbil o integració API amb
  Playoff.
- Canvis a les rutes, navegació general, pàgina d'avantatges o directori de
  col·laboradors.

## Criteris D'acceptació

1. Les tres rutes idiomàtiques de la pàgina Socis mostren la secció amb títol i
   text comprensibles en el seu idioma.
2. La secció descriu els entrenaments funcionals, indica que són exclusius per a
   socis i sòcies i mostra l'adreça vigent del local, sense duplicar-ne la font.
3. L'enllaç accessible de reserva apunta a l'URL HTTPS aprovada de Playoff i
   permet consultar-hi sessions disponibles.
4. No apareixen horaris futurs, preus, aforament ni l'abonament mensual mentre
   aquests detalls no estiguin confirmats.
5. «Avantatges per a socis i sòcies», el directori de col·laboradors, les rutes i
   la navegació actuals mantenen el seu comportament.
6. Les comprovacions acordades per MS-01 passen i la revisió manual no detecta
   problemes de lectura, focus visible, contrast o composició responsive.
