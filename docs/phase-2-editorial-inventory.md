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

Falten les quatre referències necessàries abans d'implementar T2.6:

| Pantalla              | Dispositiu | Estat      | Criteris que ha de mostrar                                   |
| --------------------- | ---------- | ---------- | ------------------------------------------------------------ |
| Hub d'esdeveniments   | Escriptori | Bloquejada | Agenda agrupada, sense filtres ni targetes repetides         |
| Hub d'esdeveniments   | Mòbil      | Bloquejada | Lectura des de 320 CSS px i navegació operable               |
| Detall d'esdeveniment | Escriptori | Bloquejada | Data, ubicació, modalitats, accions i atribució              |
| Detall d'esdeveniment | Mòbil      | Bloquejada | Estats d'inscripció i recursos absents sense controls falsos |

El 17 de juliol de 2026 es van sol·licitar les quatre pantalles amb el sistema
visual aprovat. Stitch va excedir el temps de resposta i no va crear cap pantalla
que es pogués revisar. Cal tornar-les a generar quan el servei estigui disponible
i aprovar-les explícitament abans de T2.6. Els prompts exigeixen els estats
d'inscripció oberta, tancada, recurs no disponible i l'esdeveniment vigent sense
pròxima data anunciada.

## Casos D'Esdeveniment Candidats

| Cas                        | Font                                                      | Estat    | Cobertura potencial                                                                         | Revisió pendent                                                                                        |
| -------------------------- | --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Berga Trail                | <https://mountainrunners.cat/berga-trail/>                | Candidat | Esdeveniment del club amb pròxima edició i inscripció oberta, si es confirmen dades actuals | Edició, data, ubicació, modalitats, URL d'inscripció, drets de fotografies i atribucions               |
| Ultra Pirineu / Pirineu XS | <https://mountainrunners.cat/ultra-pirineu/>              | Candidat | Esdeveniment vigent sense pròxima data anunciada, si es confirma la col·laboració actual    | Relació actual del club, existència i data de l'edició, estat d'inscripció, drets del logotip i imatge |
| Escalada Popular a Queralt | <https://mountainrunners.cat/escalada-popular-a-queralt/> | Candidat | Esdeveniment passat amb inscripció tancada i recurs no disponible                           | Si hi ha una nova edició, data i organització; si no, confirmació d'històric; drets del logotip        |

La font de la Marató de TV3, <https://mountainrunners.cat/marato-de-tv3/>, queda
**descartada** per a aquest slice: la pàgina anuncia explícitament l'edició de
2021 i no és una base suficient per publicar informació vigent.

## Recursos Candidats

| Recurs                               | Font                                | Estat    | Observació                                                                                                                                                          |
| ------------------------------------ | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fotografies de Berga Trail           | Pàgina de Berga Trail               | Candidat | La font acredita Pablo Sala, Albert Codina, Marc Elias, Paula Gonfaus, Gabri Amorós i Anna E. Puig; cal confirmar llicència, consentiment i permís de reutilització |
| Logotip d'Ultra Pirineu              | Pàgina d'Ultra Pirineu              | Candidat | Cap llicència o permís de reutilització demostrat                                                                                                                   |
| Logotip d'Escalada Popular a Queralt | Pàgina d'Escalada Popular a Queralt | Candidat | Cap autoria, llicència o permís de reutilització demostrat                                                                                                          |

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
