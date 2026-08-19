# ADR 0007: Analítica Autoallotjada Amb Plausible

## Estat

Acceptada.

## Decisió

Mesurar l'ús agregat de la web pública amb Plausible Community Edition
autoallotjat a `https://analytics.rogerbg.cat`, com un lloc independent
`mountainrunners.cat`. L'script públic i les peticions d'esdeveniment s'originen
en aquest host, que queda com a origen de JavaScript de confiança explícit.

La CSP de Caddy permet només aquest origen addicional a `script-src` i
`connect-src`. No s'introdueix `unsafe-eval` ni `unsafe-inline` a `script-src`:
la cua i `plausible.init()` viuen a `/js/plausible-init.js`. L'script remot
es carrega de manera asíncrona; si l'analítica no està disponible, la web
continua renderitzant i navegant.

No s'instal·len cookies ni identificadors persistents, no hi ha banner de
consentiment i el primer abast es limita a visites de pàgina i referències
agregades. El build estàtic no conté tokens d'administració ni de l'API.

## Raonament

Després de publicar l'apex cal entendre quines pàgines són útils sense analítica
publicitària. Reutilitzar la instància Plausible existent evita una segona pila
al VPS de la web i manté una fallada de l'analítica desacoblada del servei
públic. Ampliar la CSP amb un origen concret preserva el contracte de la T5.1
(sense comodins ni `unsafe-eval`) i fa audible la frontera de confiança: qui
opera `analytics.rogerbg.cat` pot executar JavaScript a `mountainrunners.cat`.
