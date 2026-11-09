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
retornar una previsualització. La fase 8 amplia aquest perfil a consultes i
canvis de codi amb la mateixa atribució privada, segons
l'[ADR 0013](decisions/0013-private-development-agent-boundary.md); el xat
públic continua separat.

El contingut autoritzat es defineix amb una allowlist explícita per fase. Per
defecte només inclou els fitxers YAML de les col·leccions editorials aprovades i
els recursos que aquestes referencien. No inclou components, estils, rutes,
configuració d'Astro, catàlegs de missatges, esquemes, scripts ni la navegació.

No pot fusionar pull requests pel seu compte, publicar contingut, desplegar
serveis, accedir a camins del sistema de fitxers no relacionats ni rebre accés
de shell o de producció sense restriccions.

El merge continua sent una decisió humana. L'agent privat de desenvolupament de
la fase 8 el pot executar només amb la petició explícita d'un membre verificat
del grup, el commit que el servei ha informat al fil i les comprovacions
obligatòries en verd, segons
l'[ADR 0013](decisions/0013-private-development-agent-boundary.md), amb l'esmena
de merge aprovada (PR #183) i els controls verificats abans d'activar-lo.

## Agent De Desenvolupament

El projecte inclou l'agent principal `development` a
`.opencode/agent/development.md`. Pot delegar exploració, recerca, comprovacions
independents i revisions de seguretat a subagents per mantenir el context
principal acotat. L'agent principal conserva la responsabilitat de l'abast, les
decisions, la integració i la validació final.

La delegació no autoritza canvis de frontera: cap subagent no publica, desplega,
fusiona, gestiona secrets ni pren decisions finals. Les normes d'`AGENTS.md`,
els ADR i el flux de branques, worktrees i pull requests continuen prevalent.

## Traçabilitat

Cada canvi editorial ha de ser revisable com a diff de Git i atribuïble a una
branca i una pull request. La revisió humana continua sent el punt de control de
la publicació.
