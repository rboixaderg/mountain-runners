# Límits Dels Assistents IA

## Xat Públic

El xat públic serà un servei Hono futur i separat. Només respon a partir del
contingut publicat de la web i no té permís d'escriptura al repositori, a la font
de contingut, a l'entorn de desplegament ni a les eines editorials.

El seu índex de recuperació ha d'excloure esborranys, secrets, notes privades i
documentació interna. L'entrada no és fiable i no pot modificar les instruccions
del sistema ni activar eines.

## Assistent Editorial Privat

L'assistent editorial privat podrà funcionar en el futur a través de Telegram o
Discord. El seu flux permès es limita a crear una branca, editar contingut
autoritzat, executar scripts de validació aprovats, obrir una pull request i
retornar una previsualització.

No pot fusionar pull requests, publicar contingut, desplegar serveis, accedir a
camins del sistema de fitxers no relacionats ni rebre accés de shell o de
producció sense restriccions.

## Traçabilitat

Cada canvi editorial ha de ser revisable com a diff de Git i atribuïble a una
branca i una pull request. La revisió humana continua sent el punt de control de
la publicació.
