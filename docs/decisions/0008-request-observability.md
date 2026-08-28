# ADR 0008: Observabilitat de peticions a l'origen

## Estat

Acceptada.

## Decisió

Utilitzar el registre d'accés de Caddy com a font de totes les peticions HTTP que
arriben a l'origen de Mountain Runners. Plausible continua mesurant l'ús agregat
de la web per navegadors, però no es força a registrar crawlers ni se'n barregen
les dades amb els registres del servidor.

Caddy classifica transitòriament el `User-Agent` en una família tancada i afegeix
només aquesta categoria al registre d'accés. No conserva el `User-Agent` complet,
el referent, la query string, cookies, capçaleres d'autorització ni altres
capçaleres de la petició. La categoria descriu com s'identifica el client, no
prova que sigui humà o automatitzat.

El registre individual manté l'accés restringit i la retenció màxima de set dies
aprovats a la T5.1. Un procés local genera resums sense IP ni identificadors a
partir dels fitxers complets ja rotats. Aquests resums només contenen recomptes
per data, ruta pública o classe de ruta, classe d'estat i família de client. Les
combinacions amb menys de cinc peticions s'afegeixen a un únic total acumulat
sense data ni altres dimensions. El resultat no conté registres de petició ni
identificadors i es conserva sense un termini màxim.

No s'instal·la cap servei d'observabilitat extern ni es publica cap tauler. La
consulta inicial es fa amb una ordre administrativa local. Qualsevol exposició
web, integració amb un tercer o encreuament amb altres fonts requereix una decisió
posterior.

## Raonament

Plausible depèn de JavaScript i filtra trànsit automatitzat conegut. Per això no
pot respondre quines peticions rep realment el servidor. Caddy ja observa totes
les peticions que arriben a l'origen, inclosos recursos, errors i clients sense
JavaScript, sense introduir una nova frontera de xarxa.

Conservar el `User-Agent` complet o altres capçaleres crearia un registre de text
controlat pel client i augmentaria el risc de retenir dades personals o secrets.
La classificació transitòria permet comptar crawlers autodeclarats sense afirmar
una separació inexistent entre persones i agents. L'agrupació dels recomptes
escassos evita conservar-ne la data, la ruta i la família. La retenció indefinida
només s'aplica al resultat agregat sense identificadors; els registres amb IP
continuen caducant al cap de set dies.

Aquesta decisió amplia el contracte de logs de la T5.1 només amb el camp derivat
`actor_family` i l'arxiu de mètriques sense identificadors. No modifica els
registres d'error ni de releases.
