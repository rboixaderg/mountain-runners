# Inventari Editorial De La Fase 3

## Propòsit

Aquest inventari cobreix la T3.2 de la fase 3 de cobertura de contingut. La web
actual és una font candidata i no una autoritat editorial: cap element d'aquest
document és contingut publicable fins que una persona responsable n'hagi
confirmat la vigència, l'exactitud, la relació amb el club, els drets i el
consentiment de publicació.

La classificació inicial es va fer el 6 d'agost de 2026. Només es conserven
metadades, URL de font i observacions que ja són publicables. No es copien
textos complets, imatges ni dades personals no aprovades als fitxers
editorials, d'acord amb l'ADR 0004 i la convenció de la fase 2.

Els estats permesos són `Candidat`, `Revisat`, `Aprovat` i `Descartat`. Només
el material `Aprovat` pot passar a YAML publicat o a recursos versionats.

## Qui Som

Fonts: <https://mountainrunners.cat/el-club/> i
<https://mountainrunners.cat/politica-de-privadesa-2/>.

| Element                       | Estat    | Observació i pendents                                                                                                                                                                                                                                                                                    |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missatge de presidència       | Candidat | Text publicat a la web actual, signat per la presidenta. Conté errades i contradiccions amb la secció de junta: el text diu que la junta està formada únicament per dones, mentre que la secció de junta directiva en publica una altra composició. Cal revisar el text, resoldre la contradicció i aprovar la versió final i la persona que la signa. |
| Junta directiva               | Candidat | Noms i rols publicats: president, vicepresident, secretari i tresorer, amb vocals sense nom. Dades personals de membres de la junta: pendent de confirmar la vigència de la composició i el consentiment de publicació (nom, cognoms i rol; cap dada de contacte).                                        |
| Fotografia de la junta        | Candidat | Imatge de la secció de junta. Pendent de revisar origen, autoria, consentiment de les persones retratades i atribució abans de versionar-la.                                                                                                                                                              |
| Història de l'entitat         | Candidat | Fundació l'any 2004, oficialització a finals de 2005 i aprovació el juliol de 2006 per part del Consell Català de l'Esport amb el número 12637 del Registre d'entitats esportives; ingrés a la FEEC i a la FEDME; inclusió l'any 2011 en el Cens d'Organitzadors amb el número C177. Pendent de revisar el text i confirmar les dades. |
| Fotografies històriques       | Candidat | Imatges de les seccions d'història i estatuts allotjades al domini antic (`mountainrunners.eu`). Pendent de revisar origen, autoria, consentiment i atribució.                                                                                                                                            |
| Estatuts (PDF)                | Candidat | Únic document institucional trobat a la web actual. Allotjat al domini antic (`mountainrunners.eu`); es va verificar que és descarregable el 6 d'agost de 2026. Pendent de descarregar, revisar-ne la vigència i els drets, i versionar-lo localment abans de publicar-lo.                                  |
| Identitat legal               | Candidat | CIF G63999817, número 12637 del Registre d'entitats esportives i C177 del Cens d'Organitzadors, publicats a la política de privadesa i al peu. Pendent de confirmació abans d'usar-los a les pàgines legals noves.                                                                                        |

## Socis

Fonts: <https://mountainrunners.cat/socis/> i
<https://mountainrunners.cat/avantatge-per-a-socis-i-socies/>.

| Element                     | Estat    | Observació i pendents                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Alta de socis               | Candidat | Acció externa a `mountainrunners.playoffinformatica.com`. L'URL publicada és HTTP, no HTTPS; la fase requereix URL HTTPS validada per a una acció `available`. Pendent de confirmar l'URL vigent i el servei extern aprovat. Es va verificar que respon el 6 d'agost de 2026.                                  |
| Llicència federativa        | Candidat | Acció externa al mateix servei de PlayOff Informàtica. L'URL conté l'any 2025; pendent de confirmar la vigència i l'URL definitiva (HTTPS). Es va verificar que respon el 6 d'agost de 2026.                                                                                                                  |
| Federació (accés directe)   | Candidat | Enllaç `Federa't!` al panell d'activitats del mateix servei extern. Pendent de confirmar vigència i aprovació del servei.                                                                                                                                                                                     |
| Samarrera tècnica           | Candidat | Text de la secció «Vesteix-te de MRB»: la samarreta es regala en fer-se soci. Pendent de revisar el text i confirmar-ne la vigència.                                                                                                                                                                         |
| Formulari de mitjons        | Descartat | Formulari extern de Google Forms per reservar mitjons. Fora de l'abast de la fase: no s'afegeixen formularis ni accions no previstes, i el servei no està entre les accions externes aprovades (alta, federació, contacte i butlletí).                                                                       |
| Fotografies de la secció    | Candidat | Imatges de la pàgina de Socis allotjades al domini antic. Pendent de revisar origen, autoria, consentiment i atribució.                                                                                                                                                                                      |

### Avantatges I Col·laboradors

La llista de col·laboradors de la web actual és la font candidata de les
entitats amb avantatge de soci. Cada entitat pendent de: confirmar la vigència
del descompte i de les dades, obtenir el consentiment per republicar-ne les
dades de contacte, revisar la privacitat dels telèfons mòbils i correus
personals, i revisar els drets dels logotips (majoritàriament provinents
d'Instagram o de les webs de cada establiment).

Font: <https://mountainrunners.cat/avantatge-per-a-socis-i-socies/>.

| Col·laborador                          | Avantatge publicat                                        | Estat    |
| -------------------------------------- | --------------------------------------------------------- | -------- |
| Visites al Berguedà                    | Avantatge cultural; enllaça a una pàgina pròpia           | Candidat |
| ELIT                                   | 10% en massatge esportiu                                  | Candidat |
| SNOWLOCKERS                            | Codis de descompte en lloguer de material d'hivern        | Candidat |
| CIMETIR                                | 10% en proves d'esforç                                    | Candidat |
| Podologia Ingrid Soca                  | Descomptes de podologia i plantilles                      | Candidat |
| Clínica Jessica Genescà                | 15% en podologia                                          | Candidat |
| Aina Vila                              | 15% en massatge esportiu i de descàrrega                  | Candidat |
| Alexandra Bruy                         | 10% en psicologia esportiva                               | Candidat |
| Farmàcia Cosp                          | 6% en articles de la farmàcia                             | Candidat |
| Estètica Adela                         | 10-15% en depilació i massatge esportiu                   | Candidat |
| Ortopèdia Álvarez Saz Cabra            | 10% en ortesis esportives                                 | Candidat |
| Veloberga                              | 10% en articles i accessoris                              | Candidat |
| Bicixtrem                              | 10% en productes                                          | Candidat |
| 4 Riders Bike Park                     | 20% per a sòcies i socis                                  | Candidat |
| Intersport Serra Martí                 | 10% en imports superiors a 20 €                           | Candidat |
| Serrasports                            | 15% en tèxtil i calçat                                    | Candidat |
| Ríos Running Berga                     | 15% en productes (excepte electrònica)                    | Candidat |
| Ramir's Sabaters                       | 10% en resolatge de vambes                                | Candidat |
| Joieria Climent                        | 15% de descompte                                          | Candidat |
| Centre Òptic                           | 15% de descompte                                          | Candidat |
| Pedratour                              | 5% en packs d'experiències                                | Candidat |
| Peu de Via                             | Condicions de quota amb preus publicats                   | Candidat |

La pàgina pròpia de Visites al Berguedà
(<https://mountainrunners.eu/mountainrunners/visites-al-bergueda/>) viu al
domini antic i no s'ha inventariat: només s'hi ha verificat que respon el 6
d'agost de 2026 i queda pendent de revisió si la fase decideix incorporar-la.

## Escoles

Font: <https://mountainrunners.cat/escoles/>.

| Element                        | Estat    | Observació i pendents                                                                                                                                                                                              |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Escola Trail                   | Aprovat  | Contingut ja publicat al repositori i confirmat a la fase 2 (inventari editorial de la fase 2).                                                                                                                     |
| Escola Skimo                   | Aprovat  | Contingut ja publicat al repositori i confirmat a la fase 2 (inventari editorial de la fase 2).                                                                                                                     |
| Escola BTT                     | Aprovat  | Contingut ja publicat al repositori i confirmat a la fase 2 (inventari editorial de la fase 2).                                                                                                                     |
| Textos del hub d'escoles       | Candidat | Textos de presentació i valors (muntanya, respecte, club). Pendent de revisar i aprovar.                                                                                                                           |
| Fotografies de les escoles     | Candidat | Imatges de les tres escoles allotjades al domini antic. Pendent de revisar origen, autoria, consentiment i atribució.                                                                                              |
| Escola Trial                   | Absent   | No hi ha cap font a la web actual. La fase només publica la ruta quan existeixi contingut aprovat per a l'escola de Trial.                                                                                          |
| Galeries i vídeo               | Absent   | No hi ha galeries ni vídeo inventariables a la web actual. La composició es podrà exercir amb un o dos placeholders locals propis quan les plantilles ho requereixin, segons les regles de la fase.                |

## Documents

No hi ha cap directori de documents a la web actual. L'únic document
institucional trobat és el PDF dels estatuts (vegeu l'apartat Qui Som).

| Document            | Estat    | Observació i pendents                                                                                                                                                                                                                                          |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estatuts (PDF)      | Candidat | Vegeu l'apartat Qui Som. Primer candidat del futur directori de Documents.                                                                                                                                                                                     |
| Guia del club (PDF) | Descartat | El recurs local `club-guide.pdf` versionat al repositori és una fixture sintètica de validació («public fixture document»), no un document real. No pot presentar-se com a Guia del club publicada: cal substituir-lo per un document real aprovat o despublicar l'entrada abans de la fase de Documents. |

## Contacte, Peu I Pàgines Legals

Fonts: <https://mountainrunners.cat/contacteu/>, el peu de totes les pàgines i
<https://mountainrunners.cat/politica-de-privadesa-2/>.

| Element                      | Estat    | Observació i pendents                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correu electrònic            | Candidat | `info@mountainrunners.cat` publicat a la pàgina de contacte i a la política de privadesa. Pendent de confirmar-ne la vigència.                                                                                                                                                                                                     |
| Telèfons                     | Candidat | Telèfon fix i mòbil publicats a la pàgina de contacte. Pendent de confirmar-ne la vigència i el consentiment de publicació.                                                                                                                                                                                                        |
| Seu                          | Candidat | Dada inconsistent entre fonts: la pàgina de contacte i la política de privadesa publiquen «C/ Ciutat, 27, baixos», mentre que el peu publica «Carrer Major 27». Pendent de confirmar la seu definitiva abans de publicar.                                                                                                          |
| Horari                       | Candidat | De dilluns a divendres, de 18 h a 20 h, publicat al peu. Pendent de confirmar-ne la vigència.                                                                                                                                                                                                                                      |
| CIF                          | Candidat | G63999817, publicat al peu i a la política de privadesa. Pendent de confirmació.                                                                                                                                                                                                                                                   |
| Formulari de contacte        | Descartat | El formulari de la web actual queda fora de l'abast de la fase: no s'afegeixen formularis propis. La ruta de Contacte publicarà les dades institucionals aprovades.                                                                                                                                                                 |
| Política de privadesa actual | Descartat | Text obsolet: cita la LOPD 15/1999, conté una referència errònia a un altre domini i mostra dades inconsistents amb la resta del lloc. No es reutilitza com a font; la fase redacta pàgines legals noves amb text revisat (ADR 0005) i dades institucionals aprovades.                                                           |
| Avís legal                  | Absent   | No existeix a la web actual. Es redactarà de nou amb la identitat i les dades institucionals aprovades.                                                                                                                                                                                                                            |
| Política de cookies         | Absent   | No existeix a la web actual. El text descriurà l'estat real de la nova web (sense cookies no tècniques, sense banner, segons la fase).                                                                                                                                                                                              |
| Butlletí                    | Absent   | No hi ha cap servei de butlletí a la web actual. L'acció externa de butlletí només es publicarà amb un servei extern aprovat i URL HTTPS; mentre no n'hi hagi, es mostrarà la indisponibilitat amb text útil.                                                                                                                      |

## Recursos

| Recurs                                  | Font                                                                                                          | Estat    | Observació                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Logotip de Mountain Runners             | `apps/web/src/assets/logo_mountain_runners.png`                                                               | Aprovat  | Autoritzat i versionat a la fase 2; el README d'assets registra propietat i aprovació de publicació.                                    |
| Placeholder de Berga Trail              | `apps/web/src/assets/berga-trail-placeholder.svg`                                                             | Aprovat  | Placeholder local creat a la fase 2.                                                                                                   |
| Estatuts (PDF)                          | <http://mountainrunners.eu/mountainrunners/wp-content/uploads/2021/06/ESTATUTS-MRB.pdf>                       | Candidat | Vegeu l'apartat Qui Som.                                                                                                               |
| Fotografies de junta i història         | <https://mountainrunners.cat/el-club/>                                                                        | Candidat | Origen, autoria, consentiment i atribució pendents.                                                                                    |
| Fotografies de les escoles              | Domini antic (`mountainrunners.eu`) a través del hub d'escoles                                                | Candidat | Origen, autoria, consentiment i atribució pendents.                                                                                    |
| Logotips i imatges dels col·laboradors  | Instagram i webs dels establiments, enllaçades des de la pàgina d'avantatges                                   | Candidat | Drets i atribució pendents per a cada entitat que la fase incorpori.                                                                    |
| Guia del club (PDF)                     | `apps/web/src/content-assets/documents/club-guide.pdf`                                                        | Descartat | Fixture sintètica; no es pot presentar com a document real (vegeu Documents).                                                          |
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
