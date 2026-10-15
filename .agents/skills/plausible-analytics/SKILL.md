---
name: plausible-analytics
description: Query Mountain Runners analytics through the read-only Plausible Stats API. Use for pageviews, visitors, traffic sources, conversions, period comparisons or unexpected URLs on mountainrunners.cat. Uses existing environment variables, not MCP.
compatibility: Node.js 24.11 or newer with network access to the configured Plausible instance.
---

# Analítica de Mountain Runners

## Abast i credencials

- Aquesta skill pertany només a aquest projecte. El lloc és
  `mountainrunners.cat`, encara que els esdeveniments tinguin altres hostnames.
- Llegeix [la referència](references/stats-api.md) abans de preparar consultes.
- Utilitza el script `scripts/query.mjs` d'aquesta skill. Llegeix les variables
  `PLAUSIBLE_BASE_URL` i `PLAUSIBLE_API_KEY` heretades del procés de l'agent.
  No carrega `.env` ni necessita dependències npm o un servidor MCP.
- Executa Node amb `--use-system-ca` per utilitzar també els certificats de
  confiança del sistema. No desactivis la verificació TLS.
- No imprimeixis, demanis ni desis la clau. No facis `env`, `printenv`,
  `set -x` ni consultes que incorporin la clau al text de l'ordre.
- Només s'utilitza `POST /api/v2/query`, que és de lectura. No enviïs
  esdeveniments ni modifiquis llocs, objectius o configuració remota.
- La skill no intervé en el build ni en el tracker públic de la web.

## Executar una consulta

Resol el path del script respecte del directori d'aquesta skill, no respecte
del directori de treball. Des de l'arrel del repositori:

```sh
node --use-system-ca .agents/skills/plausible-analytics/scripts/query.mjs <<'JSON'
{
  "metrics": ["visitors", "pageviews"],
  "date_range": "30d"
}
JSON
```

El script afegeix `site_id: "mountainrunners.cat"` i rebutja qualsevol altre
lloc. Retorna el JSON de l'API per stdout. Els errors surten per stderr amb
codi de sortida 1, sense el cos remot ni la clau. Exigeix un origen HTTPS i no
segueix redireccions. Cada execució fa una sola petició, amb límit de 30 segons.

## Interpretar i presentar

1. Indica el període retornat a `query.date_range`, no només el rang relatiu
   demanat. `all` significa tot l'històric disponible, no tota la vida de la web.
2. Interpreta les posicions de `results[].metrics` i `results[].dimensions`
   segons `query.metrics` i `query.dimensions`. Conserva els avisos de `meta`.
3. Per llistar totes les rutes, pagina fins a completar els resultats segons la
   referència. No presentis una pàgina parcial com si fos exhaustiva.
4. Distingueix `pageviews` de `events`. Les files amb zero pageviews no són
   visites de pàgina, encara que hi hagi altres esdeveniments.
5. Per detectar URL alienes, consulta `event:hostname` i `event:page`.
   Compara-les amb el sitemap públic actual, permet la redirecció `/` i separa
   rutes antigues, endpoints tècnics, altres hostnames i contingut aparentment
   aliè. L'absència del sitemap no demostra una resposta 404 ni un atac.
6. Plausible dona dades agregades, no un registre complet de peticions HTTP.
   No atribueixis una visita a una persona ni afirmis que detecta tots els bots.
7. Si falta accés, informa de l'error i demana revisar les variables sense
   compartir-ne els valors. No canviïs la configuració remota ni l'autenticació.

## Comprovar el script

Les proves no contacten amb Plausible ni utilitzen credencials reals:

```sh
pnpm test:analytics
```
