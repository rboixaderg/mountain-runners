# Inventari Editorial De La Fase 3

## Propòsit

Aquest inventari cobreix la T3.2 de la fase 3 de cobertura de contingut. La web
actual és una font candidata i no una autoritat editorial: cap element d'aquest
document és contingut publicable fins que una persona responsable n'hagi
confirmat la vigència, l'exactitud, la relació amb el club, els drets i el
consentiment de publicació.

La classificació inicial es va fer el 6 d'agost de 2026. El mateix dia, la
persona mantenidora del projecte va resoldre els punts pendents següents, que
queden incorporats a aquest document: nova seu a la plaça Sant Joan, 15 baixos;
reutilització del missatge de presidència amb només el canvi de signatura;
confirmació de la fotografia de junta i de la identitat legal; reutilització
del text d'història actual; estatuts pendents de pujar, sense enllaç buit; URL
d'alta en HTTPS; manteniment de l'URL de llicències del 2025; redacció de les
pàgines legals a partir de les pàgines de referència d'Escalades Berguedà; i
Guia del club sense arxiu, pendent de revisió posterior; i reutilització del
mateix llistat d'avantatges i col·laboradors de la web actual.

Només es conserven metadades, URL de font i observacions que ja són
publicables. No es copien textos complets, imatges ni dades personals no
aprovades als fitxers editorials, d'acord amb l'ADR 0004 i la convenció de la
fase 2.

Els estats permesos són `Candidat`, `Revisat`, `Aprovat` i `Descartat`. Només
el material `Aprovat` pot passar a YAML publicat o a recursos versionats.
L'estat `Absent` indica que no existeix cap font a la web actual ni a les webs
de referència: la ruta o funció es crearà de nou amb contingut aprovat quan la
fase la publiqui, mai copiant res inexistent.

## Qui Som

Fonts: <https://mountainrunners.cat/el-club/> i
<https://mountainrunners.cat/politica-de-privadesa-2/>.

| Element                       | Estat    | Observació i pendents                                                                                                                                                                                                                                                                                    |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missatge de presidència       | Aprovat  | Decisió de la persona mantenidora del 6 d'agost de 2026: es reutilitza el mateix text que ja hi ha de l'anterior presidència, amb l'únic canvi que ara el signa el president (Ernest Garrido). En redactar la pàgina (T3.4) cal revisar la frase sobre la composició de la junta, que contradiu la junta actual. |
| Junta directiva               | Revisat  | Presidència confirmada el 6 d'agost de 2026: Ernest Garrido. La resta de rols publicats (vicepresident, secretari, tresorer i vocals sense nom) queda pendent de confirmar-ne la vigència i el consentiment de publicació (nom, cognoms i rol; cap dada de contacte).                                      |
| Fotografia de la junta        | Aprovat  | Imatge actual de la junta confirmada com a correcta i apta per a publicació el 6 d'agost de 2026. Pendent de descarregar-la, optimitzar-la i versionar-la localment quan es construeixi la pàgina (T3.4).                                                                                                  |
| Història de l'entitat         | Aprovat  | Decisió de la persona mantenidora del 6 d'agost de 2026: es reutilitza el text d'història actual (fundació l'any 2004, oficialització a finals de 2005, aprovació el juliol de 2006 amb el número 12637 del Registre d'entitats esportives, ingrés a la FEEC i a la FEDME, i inclusió l'any 2011 en el Cens d'Organitzadors amb el número C177). Pendent només de la revisió de redacció en crear la pàgina. |
| Fotografies històriques       | Candidat | Imatges de les seccions d'història i estatuts allotjades al domini antic (`mountainrunners.eu`). Pendent de revisar origen, autoria, consentiment i atribució.                                                                                                                                            |
| Estatuts (PDF)                | Pendent  | Decisió de la persona mantenidora del 6 d'agost de 2026: el PDF es pujarà més endavant; per ara la secció es mostrarà sense enllaç, amb l'estat de disponibilitat expressat amb text útil (mai un enllaç buit), d'acord amb les regles de la fase.                                                          |
| Identitat legal               | Aprovat  | CIF G63999817, número 12637 del Registre d'entitats esportives i C177 del Cens d'Organitzadors confirmats com a correctes per la persona mantenidora el 6 d'agost de 2026.                                                                                                                                |

## Socis

Fonts: <https://mountainrunners.cat/socis/> i
<https://mountainrunners.cat/avantatge-per-a-socis-i-socies/>.

| Element                     | Estat    | Observació i pendents                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Alta de socis               | Revisat  | Acció externa a `mountainrunners.playoffinformatica.com`. La persona mantenidora va decidir el 6 d'agost de 2026 usar l'URL en HTTPS, verificada i responent: <https://mountainrunners.playoffinformatica.com/Preinscripcio.php>. El servei extern s'aprovarà formalment abans de publicar (T3.5).           |
| Llicència federativa        | Revisat  | Acció externa al mateix servei de PlayOff Informàtica. La persona mantenidora va decidir el 6 d'agost de 2026 mantenir l'URL actual amb l'any 2025: <https://mountainrunners.playoffinformatica.com/activitat/30/Llicencies-Federatives-2025/>. Verificada i responent; caldrà revisar-ne la vigència més endavant. |
| Federació (accés directe)   | Candidat | Enllaç `Federa't!` al panell d'activitats del mateix servei extern. Pendent de confirmar vigència i aprovació del servei.                                                                                                                                                                                     |
| Samarrera tècnica           | Candidat | Text de la secció «Vesteix-te de MRB»: la samarreta es regala en fer-se soci. Pendent de revisar el text i confirmar-ne la vigència.                                                                                                                                                                         |
| Formulari de mitjons        | Descartat | Formulari extern de Google Forms per reservar mitjons. Fora de l'abast de la fase: no s'afegeixen formularis ni accions no previstes, i el servei no està entre les accions externes aprovades (alta, federació, contacte i butlletí).                                                                       |
| Fotografies de la secció    | Candidat | Imatges de la pàgina de Socis allotjades al domini antic. Pendent de revisar origen, autoria, consentiment i atribució.                                                                                                                                                                                      |

### Avantatges I Col·laboradors

Decisió de la persona mantenidora del 6 d'agost de 2026: per ara es
reutilitzarà el mateix llistat i les mateixes dades de col·laboradors que
publica la web actual. Les entitats de la taula queden `Aprovades` per a la
fase. El treball pendent és d'extracció i de revisió final abans de publicar:
modelar cada entitat amb el seu avantatge de soci (T3.5), descarregar i
versionar els logotips amb origen, autoria i atribució, i revisar la privacitat
i el consentiment de les dades de contacte personals (telèfons mòbils i correus
d'autònoms) quan s'incorporin.

Font: <https://mountainrunners.cat/avantatge-per-a-socis-i-socies/>.

| Col·laborador                          | Avantatge publicat                                        | Estat    |
| -------------------------------------- | --------------------------------------------------------- | -------- |
| Visites al Berguedà                    | Avantatge cultural; enllaça a una pàgina pròpia           | Aprovat  |
| ELIT                                   | 10% en massatge esportiu                                  | Aprovat  |
| SNOWLOCKERS                            | Codis de descompte en lloguer de material d'hivern        | Aprovat  |
| CIMETIR                                | 10% en proves d'esforç                                    | Aprovat  |
| Podologia Ingrid Soca                  | Descomptes de podologia i plantilles                      | Aprovat  |
| Clínica Jessica Genescà                | 15% en podologia                                          | Aprovat  |
| Aina Vila                              | 15% en massatge esportiu i de descàrrega                  | Aprovat  |
| Alexandra Bruy                         | 10% en psicologia esportiva                               | Aprovat  |
| Farmàcia Cosp                          | 6% en articles de la farmàcia                             | Aprovat  |
| Estètica Adela                         | 10-15% en depilació i massatge esportiu                   | Aprovat  |
| Ortopèdia Álvarez Saz Cabra            | 10% en ortesis esportives                                 | Aprovat  |
| Veloberga                              | 10% en articles i accessoris                              | Aprovat  |
| Bicixtrem                              | 10% en productes                                          | Aprovat  |
| 4 Riders Bike Park                     | 20% per a sòcies i socis                                  | Aprovat  |
| Intersport Serra Martí                 | 10% en imports superiors a 20 €                           | Aprovat  |
| Serrasports                            | 15% en tèxtil i calçat                                    | Aprovat  |
| Ríos Running Berga                     | 15% en productes (excepte electrònica)                    | Aprovat  |
| Ramir's Sabaters                       | 10% en resolatge de vambes                                | Aprovat  |
| Joieria Climent                        | 15% de descompte                                          | Aprovat  |
| Centre Òptic                           | 15% de descompte                                          | Aprovat  |
| Pedratour                              | 5% en packs d'experiències                                | Aprovat  |
| Peu de Via                             | Condicions de quota amb preus publicats                   | Aprovat  |

L'avantatge de Visites al Berguedà s'inclou com a la web actual. La pàgina de
destinació viu al domini antic
(<https://mountainrunners.eu/mountainrunners/visites-al-bergueda/>) i no s'ha
inventariat; si la fase l'enllaça com a destinació externa, caldrà aprovar-ne
l'URL i revisar-ne el contingut abans.

## Escoles

Font: <https://mountainrunners.cat/escoles/>.

| Element                        | Estat    | Observació i pendents                                                                                                                                                                                              |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Escola Trail                   | Aprovat  | Escola històrica de Trail (la primera escola de trail del territori). Contingut de la web antiga ja publicat al repositori i confirmat a la fase 2 (inventari editorial de la fase 2).                             |
| Escola Skimo                   | Aprovat  | Contingut ja publicat al repositori i confirmat a la fase 2 (inventari editorial de la fase 2).                                                                                                                     |
| Escola BTT                     | Aprovat  | Contingut ja publicat al repositori i confirmat a la fase 2 (inventari editorial de la fase 2).                                                                                                                     |
| Textos del hub d'escoles       | Candidat | Textos de presentació i valors (muntanya, respecte, club). Pendent de revisar i aprovar.                                                                                                                           |
| Fotografies de les escoles     | Candidat | Imatges de les tres escoles allotjades al domini antic. Pendent de revisar origen, autoria, consentiment i atribució.                                                                                              |
| Escola Trial                   | Absent   | No existeix cap escola «Trial»: l'especificació enumera Trail, Skimo, BTT i Trial, però «Trial» no correspon a cap escola real ni a cap font. La fase només publicaria una escola nova amb contingut aprovat.      |
| Galeries i vídeo               | Absent   | No hi ha galeries ni vídeo inventariables a la web actual. La composició es podrà exercir amb un o dos placeholders locals propis quan les plantilles ho requereixin, segons les regles de la fase.                |

## Documents

No hi ha cap directori de documents a la web actual. L'únic document
institucional trobat és el PDF dels estatuts (vegeu l'apartat Qui Som).

| Document            | Estat    | Observació i pendents                                                                                                                                                                                                                                          |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estatuts (PDF)      | Pendent  | Vegeu l'apartat Qui Som: el PDF es pujarà més endavant i per ara la secció es mostra sense enllaç, amb l'estat de disponibilitat textual. Primer candidat del futur directori de Documents. |
| Guia del club (PDF) | Pendent  | Decisió de la persona mantenidora del 6 d'agost de 2026: l'entrada es manté sense arxiu per ara i es revisarà més endavant. El recurs local `club-guide.pdf` és una fixture sintètica de validació («public fixture document»), no un document real, i no pot presentar-se com a Guia del club publicada. |

## Contacte, Peu I Pàgines Legals

Fonts: <https://mountainrunners.cat/contacteu/>, el peu de totes les pàgines,
<https://mountainrunners.cat/politica-de-privadesa-2/> i les pàgines de
referència de la mateixa entitat a
<https://escaladesbergueda.cat/avis-legal> i
<https://escaladesbergueda.cat/politica-de-privacitat>.

| Element                      | Estat    | Observació i pendents                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correu electrònic            | Candidat | `info@mountainrunners.cat` publicat a la pàgina de contacte i a la política de privadesa. Pendent de confirmar-ne la vigència.                                                                                                                                                                                                     |
| Telèfons                     | Candidat | Telèfon fix i mòbil publicats a la pàgina de contacte. Pendent de confirmar-ne la vigència i el consentiment de publicació.                                                                                                                                                                                                        |
| Seu                          | Aprovat  | Dada definitiva proporcionada per la persona mantenidora el 6 d'agost de 2026: plaça Sant Joan, 15 baixos, 08600 Berga. Substituirà la incoherència anterior entre peu (carrer Major 27) i contacte i legal (carrer Ciutat 27).                                                                                                    |
| Horari                       | Candidat | De dilluns a divendres, de 18 h a 20 h, publicat al peu. Pendent de confirmar-ne la vigència.                                                                                                                                                                                                                                      |
| CIF                          | Candidat | G63999817, publicat al peu i a la política de privadesa. Pendent de confirmació.                                                                                                                                                                                                                                                   |
| Formulari de contacte        | Descartat | El formulari de la web actual queda fora de l'abast de la fase: no s'afegeixen formularis propis. La ruta de Contacte publicarà les dades institucionals aprovades.                                                                                                                                                                 |
| Política de privadesa actual | Descartat | El text actual no es reutilitza: és obsolet (cita la LOPD 15/1999), conté una referència errònia a un altre domini i dades inconsistents. Decisió de la persona mantenidora del 6 d'agost de 2026: es crearan les dues pàgines legals (avís legal i política de privacitat) amb l'estructura i el contingut de les pàgines de referència d'Escalades Berguedà (RGPD: responsable, finalitats, base jurídica, destinataris, drets i reclamacions) i les dades institucionals aprovades, descrivint els serveis reals de la nova web. |
| Avís legal                  | Revisat  | No existeix a la web actual. Decisió de la persona mantenidora del 6 d'agost de 2026: es crearà juntament amb la política de privacitat, a partir de la pàgina de referència d'Escalades Berguedà (mateixa entitat; titularitat, registres, condicions d'ús, propietat intel·lectual, responsabilitat, enllaços externs, protecció de dades i legislació aplicable), adaptada a la nova seu i al correu institucional aprovats. Redacció i aprovació del text pendents (T3.8). |
| Política de cookies         | Absent   | No existeix a la web actual ni a les webs de referència (verificat: cap ruta de cookies a escaladesbergueda.cat). El text descriurà l'estat real de la nova web (sense cookies no tècniques, sense banner, segons la fase).                                                                                                         |
| Butlletí                    | Absent   | La web actual no té cap servei de butlletí. La web germana d'Escalades Berguedà en té un de la mateixa entitat (via Listmonk) que pot servir de referència futura, però la fase només publicarà una acció de butlletí amb un servei extern aprovat i URL HTTPS; mentre no n'hi hagi, es mostrarà la indisponibilitat amb text útil. |

## Recursos

| Recurs                                  | Font                                                                                                          | Estat    | Observació                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Logotip de Mountain Runners             | `apps/web/src/assets/logo_mountain_runners.png`                                                               | Aprovat  | Autoritzat i versionat a la fase 2; el README d'assets registra propietat i aprovació de publicació.                                    |
| Placeholder de Berga Trail              | `apps/web/src/assets/berga-trail-placeholder.svg`                                                             | Aprovat  | Placeholder local creat a la fase 2.                                                                                                   |
| Estatuts (PDF)                          | <http://mountainrunners.eu/mountainrunners/wp-content/uploads/2021/06/ESTATUTS-MRB.pdf>                       | Pendent  | Vegeu l'apartat Qui Som: es pujarà més endavant; per ara, sense enllaç, amb estat textual.                                            |
| Fotografies de junta i història         | <https://mountainrunners.cat/el-club/>                                                                        | Candidat | Origen, autoria, consentiment i atribució pendents.                                                                                    |
| Fotografies de les escoles              | Domini antic (`mountainrunners.eu`) a través del hub d'escoles                                                | Candidat | Origen, autoria, consentiment i atribució pendents.                                                                                    |
| Logotips i imatges dels col·laboradors  | Instagram i webs dels establiments, enllaçades des de la pàgina d'avantatges                                   | Candidat | Drets i atribució pendents per a cada entitat que la fase incorpori.                                                                    |
| Guia del club (PDF)                     | `apps/web/src/content-assets/documents/club-guide.pdf`                                                        | Pendent  | Fixture sintètica; l'entrada es manté sense arxiu per ara (vegeu Documents).                                                                                                                            |
| Placeholders de galeria i vídeo         | No creats                                                                                                     | Pendent  | La fase pot crear un o dos placeholders locals propis i genèrics quan les plantilles de detall ho requereixin, amb text alternatiu honest. |

La portada actual conté contingut injectat per tercers aliè a l'associació
(enllaços comercials de casino). Aquest contingut queda exclòs de l'inventari i
mai no pot ser font editorial.

## Criteri Per Aprovar

Abans que un element passi a YAML publicat o a recursos versionats, una persona
responsable n'ha de confirmar:

- la vigència de textos, dades, preus, horaris, composició de la junta i estats
  d'inscripció o acció;
- la relació actual de Mountain Runners amb cada entitat, servei o document;
- l'URL externa vigent i validable, amb HTTPS per a qualsevol acció
  `available`;
- el text català revisat (ortografia, to i claredat);
- l'origen, l'autoria, la llicència, el consentiment i l'atribució de cada
  recurs o fotografia;
- el consentiment de publicació de nom, cognoms i rol de la junta (mai dades de
  contacte personals) i de les dades de contacte institucionals;
- l'absència de dades personals, informació interna o material injectat
  innecessari.

Si una àrea no té cap candidat real aprovat, la fase documenta la mancança i no
inventa contingut: una ruta no es publica, un estat es mostra com a no
disponible amb text útil, i els comportaments que calgui cobrir s'exerciten amb
fixtures sintètiques no publicades, mai amb dades reals falsificades.
