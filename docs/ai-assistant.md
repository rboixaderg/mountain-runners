# Límits Dels Assistents IA

## Xat Públic

El xat públic serà un servei Hono futur i separat. Només respon a partir del
contingut publicat de la web i no té permís d'escriptura al repositori, a la font
de contingut, a l'entorn de desplegament ni a les eines editorials.

El seu índex de recuperació ha d'excloure esborranys, secrets, notes privades i
documentació interna. L'entrada no és fiable i no pot modificar les instruccions
del sistema ni activar eines.

## Agent privat de Telegram

La fase 8 inclou l'assistència editorial dins de l'agent privat de
desenvolupament. Consulta el [README del servei](../tools/server/agent/README.md)
per al comportament implementat, la
[decisió vigent de l'ADR 0013](decisions/0013-private-development-agent-boundary.md#decisió-vigent)
per als permisos i la [guia editorial](editorial/guide.md) per a les entrades.

## Agents locals

[`AGENTS.md`](../AGENTS.md) governa les sessions locals. El perfil
[`development`](../.opencode/agent/development.md) defineix la delegació a
OpenCode. L'excepció de l'ADR 0013 no s'aplica a les sessions locals ni als
subagents.
