# Inventari Editorial De La Fase 2

## Propòsit

Aquest inventari cobreix la T2.1 del vertical slice públic. La web actual és una
font candidata i no una autoritat editorial. Els elements d'aquest document no
són contingut publicable fins que una persona responsable n'hagi confirmat la
vigència, exactitud, relació amb el club i drets.

La revisió inicial es va fer el 17 de juliol de 2026. Només es conserven les
metadades, les URL de font i observacions que es poden publicar. No es copien
textos, imatges ni dades personals heretades als fitxers editorials.

## Referències Visuals

`DESIGN.md` és la font de veritat visual. La pantalla Stitch aprovada per a la
portada és:

| Pantalla                                                                                                         | Dispositiu | Estat    | Ús previst                     |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | -------- | ------------------------------ |
| [Mountain Runners - Inici (Red Kit Energy)](https://stitch.withgoogle.com/) (`366fda639a204009842619490b119fc1`) | Escriptori | Aprovada | Referència adaptable de `/ca/` |

Projecte Stitch: `6497516597197145737`. Sistema visual aplicable:
`assets/15875972618739072807`, _Associacio Esportiva Mountain Runners_.

Les quatre referències necessàries abans d'implementar T2.6 s'han generat a
Stitch i han estat aprovades explícitament el 17 de juliol de 2026:

| Pantalla              | Dispositiu | Referència Stitch                  | Estat    |
| --------------------- | ---------- | ---------------------------------- | -------- |
| Hub d'esdeveniments   | Escriptori | `977c182181d249eca8b2910db984d728` | Aprovada |
| Hub d'esdeveniments   | Mòbil      | `7bee765f9af44a8db566640abbcc6c4a` | Aprovada |
| Detall d'esdeveniment | Escriptori | `9cdace22335d400bb32f59ab26df0937` | Aprovada |
| Detall d'esdeveniment | Mòbil      | `01212091f0cd4008b902189823d5feab` | Aprovada |

Les pantalles adopten el sistema visual aprovat i cobreixen els estats
d'inscripció oberta, tancada, recurs no disponible i esdeveniment vigent sense
pròxima data anunciada. Són referències adaptables; l'aprovació no valida les
dades de mostra que puguin mostrar.

## Casos D'Esdeveniment Revisats

| Cas                        | Estat editorial | Fets confirmats                                                                                                                                                                                                                                                     | Pendent abans de publicar   |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Berga Trail                | Revisat         | Mountain Runners en va ser l'organitzador. És històric: l'última edició va ser el 2022 a Berga, amb distàncies de 12 km, 27 km i 42 km i inscripcions tancades. Descripció editorial provisional disponible més avall.                                              | Cap dada editorial pendent. |
| Ultra Pirineu / Pirineu XS | Revisat         | Mountain Runners hi col·labora. L'edició de 2026 és el 2, 3 i 4 d'octubre a Bagà, amb les modalitats KV vertical, 100 km, 42 km i 21 km; les inscripcions estan tancades. Descripció: "És una cursa de muntanya que recorre part de la serralada del Cadí-Moixeró." | Cap dada editorial pendent. |
| Escalada Popular a Queralt | Revisat         | Mountain Runners n'és l'organitzador. És activa i acumula tres edicions inclosa la de 2026. L'edició de 2026 va ser el 17 de març; les inscripcions estan tancades. Descripció: "Escalada popular de Berga a Queralt en bicicleta."                                 | Cap dada editorial pendent. |

Fonts d'informació:

- Berga Trail: <https://mountainrunners.cat/berga-trail/>.
- Ultra Pirineu: <https://ultrapirineu.com/>.
- Escalada Popular a Queralt: <https://escaladesbergueda.cat/escalades/queralt>.

No hi ha ara cap cas real revisat amb inscripció oberta. Aquest comportament
s'ha de cobrir amb una fixture sintètica no publicada fins que hi hagi un cas
real aprovat.

### Descripció Editorial Provisional De Berga Trail

El 2004 va néixer la Marató de Muntanya de Berga, fruit de l’esforç d’un grup
d’amics que aquell mateix any van crear l’Associació Esportiva Mountain Runners
del Berguedà, organitzador de l’esdeveniment. La cursa transcorre per les zones
de Queralt, els Rasos de Peguera i la Serra d’Ensija i des d’un bon començament
va agafar solatge a nivell nacional i internacional, essent prova de la Copa del
Món en les seves quarta i cinquena edició.

Atletes destacats com Tòfol Castanyer, Núria Picas, Corinne Favre, Pau Bartoló o
Jessed Hernández han pres la sortida a aquesta dura prova del calendari, que posa
a prova als atletes amb els més de 42 quilòmetres de recorregut i 3.000 metres de
desnivell.

Després de l’èxit de les darreres edicions, a partir del 2021 la cursa es
reinventa i sota el paraigües de la Berga Trail hi ha 4 curses, essent la Ultra
Ensija el seu plat fort, amb un total de 60 km, una cursa de 23 km, una de 14km
i com no, un any més, amb la Berga Trail Kids, amb la qual els més petits també
tindran la seva pròpia cursa per passar-ho bé i gaudir d’aquest esport i sentir-se
partíceps de l’esdeveniment.

La Berga Trail no vol ser només un esdeveniment esportiu, sinó que la intenció és
potenciar una de les grans meravelles que tenim al Berguedà, l’entorn. Sempre
però des del respecte i la sostenibilitat, dos principis bàsics per
l’organització.

La font de la Marató de TV3, <https://mountainrunners.cat/marato-de-tv3/>, queda
**descartada** per a aquest slice: la pàgina anuncia explícitament l'edició de
2021 i no és una base suficient per publicar informació vigent.

## Recursos

| Recurs                              | Font                                                                                    | Estat    | Observació                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Coberta de Berga Trail              | `apps/web/src/assets/berga-trail-placeholder.svg`                                       | Aprovada | Placeholder local temporal creat per al projecte el 17 de juliol de 2026; no substitueix una fotografia autèntica. |
| Logotip d'Ultra Pirineu             | <https://ultrapirineu.com/wp-content/uploads/2022/10/SUP_22_logo_black_transparent.svg> | Aprovada | Autorització d'ús confirmada el 17 de juliol de 2026.                                                              |
| Imatge d'Escalada Popular a Queralt | <https://escaladesbergueda.cat/images/climbs/queralt.avif>                              | Aprovada | Autorització d'ús confirmada el 17 de juliol de 2026.                                                              |

No es farà hotlinking. Qualsevol recurs aprovat es descarregarà, optimitzarà i
versionarà localment amb dimensions, origen, autoria, llicència i atribució.

## Criteri Per Aprovar

Abans d'entrar a `apps/web/src/content/` amb `published: true`, cada cas ha de
tenir confirmació editorial explícita de:

- vigència de la data, ubicació, modalitats i estat d'inscripció;
- relació actual de Mountain Runners amb l'esdeveniment;
- URL externa vigent i validable;
- text català revisat;
- origen, autoria, llicència, consentiment i atribució de cada recurs;
- absència de dades personals o informació interna innecessària.

Si cap cas real no cobreix un estat requerit, aquest estat s'implementarà amb una
fixture sintètica no publicada, mai amb una dada inventada com a contingut real.
