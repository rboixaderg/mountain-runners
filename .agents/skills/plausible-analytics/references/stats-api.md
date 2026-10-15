# Referència de l'API Stats v2

Font: [Plausible Stats API](https://plausible.io/docs/stats-api).
La versió autoallotjada pot no admetre totes les opcions de la documentació
actual. No pressuposis que una mètrica o dimensió nova està disponible.

## Contracte

El script envia un objecte JSON directament a
`${PLAUSIBLE_BASE_URL}/api/v2/query`. No embolcallis l'objecte amb `query`.
L'autenticació és `Authorization: Bearer` amb la clau heretada de l'entorn.
No incloguis cap credencial en exemples ni arguments de shell.

| Camp         | Ús                                                            |
| ------------ | ------------------------------------------------------------- |
| `site_id`    | Fixat pel script a `mountainrunners.cat`                      |
| `metrics`    | Llista no buida de mètriques                                  |
| `date_range` | Rang relatiu o array de dues dates ISO, no un string amb coma |
| `dimensions` | Camps d'agrupació; omet-los per obtenir totals                |
| `filters`    | Array de filtres, combinats amb AND                           |
| `order_by`   | Parelles `[mètrica_o_dimensió, "asc" o "desc"]`               |
| `pagination` | `{ "limit": 1000, "offset": 0 }` per llistar rutes            |
| `include`    | Opcions com `imports`, `time_labels` o `total_rows`           |

Rangs habituals: `day`, `7d`, `30d`, `month`, `12mo`, `year`, `all` o
`["2026-09-01", "2026-09-30"]`. Les dates retornades segueixen la zona horària
del lloc. Per comparar períodes, executa dues consultes amb els mateixos
filtres i mètriques. Calcula la diferència de B respecte d'A. Si A és zero,
no donis un percentatge de canvi finit.

Mètriques habituals: `visitors`, `visits`, `pageviews`, `events`,
`bounce_rate`, `visit_duration`, `views_per_visit`, `conversion_rate`,
`group_conversion_rate`, `scroll_depth` i `time_on_page`.

- `events` inclou pageviews i esdeveniments personalitzats.
- `conversion_rate` i `group_conversion_rate` necessiten un filtre o dimensió
  `event:goal`. No calculis conversions sumant pageviews.
- `scroll_depth` i `time_on_page` necessiten un filtre o dimensió `event:page`.
- No barregis mètriques de sessió amb dimensions d'esdeveniment arbitràries.
  Consulta les restriccions de compatibilitat a la font oficial.

Dimensions habituals: `event:hostname`, `event:page`, `event:goal`,
`visit:source`, `visit:channel`, `visit:entry_page`, `visit:device`,
`visit:country_name`, `time:day`, `time:week`, `time:month` i
`event:props:<nom>` per propietats personalitzades existents.

Un filtre té la forma `[operador, dimensió, [valors]]`. Operadors habituals:
`is`, `is_not`, `contains` i `contains_not`. Els valors d'un filtre es combinen
amb OR; els filtres diferents, amb AND. Per `event:goal`, utilitza `is` o
`contains`. No traslladis els paràmetres específics del MCP al JSON de l'API.

## Exemples de consultes

Passa qualsevol d'aquests objectes a l'entrada estàndard de `scripts/query.mjs`.

### Dominis i rutes de tot l'històric

```json
{
  "metrics": ["pageviews"],
  "date_range": "all",
  "dimensions": ["event:hostname", "event:page"],
  "order_by": [
    ["event:hostname", "asc"],
    ["event:page", "asc"]
  ],
  "pagination": { "limit": 1000, "offset": 0 }
}
```

### Sèrie diària d'una pàgina de producció

```json
{
  "metrics": ["visitors", "pageviews"],
  "date_range": "30d",
  "dimensions": ["time:day"],
  "filters": [
    ["is", "event:hostname", ["mountainrunners.cat"]],
    ["is", "event:page", ["/ca/socis/"]]
  ],
  "include": { "time_labels": true }
}
```

L'API pot ometre dies sense dades. Si cal completar-los, utilitza
`meta.time_labels`; no interpretis les files absents com un error.

### Origen del trànsit

```json
{
  "metrics": ["visitors", "visits"],
  "date_range": "30d",
  "dimensions": ["visit:source"],
  "pagination": { "limit": 1000, "offset": 0 }
}
```

### Objectius registrats

```json
{
  "metrics": ["visitors", "events", "conversion_rate"],
  "date_range": "30d",
  "dimensions": ["event:goal"],
  "pagination": { "limit": 1000, "offset": 0 }
}
```

Per limitar les conversions a un objectiu, afegeix
`["is", "event:goal", ["nom exacte de l'objectiu"]]` a `filters`.
No inventis noms ni propietats. El projecte emet esdeveniments `UI Action`,
`Engaged Time` i `Scroll Depth`; l'API depèn dels objectius configurats al lloc.

## Paginació i límits

El script retorna una sola pàgina. En inventaris exhaustius:

1. Fixa el període i un ordre estable per dimensions. Conserva mètriques,
   filtres i ordre entre pàgines.
2. Comença amb `pagination: { "limit": 1000, "offset": 0 }`.
3. Si reps 1000 files, repeteix amb offset 1000, després 2000, etc.
4. Atura't quan reps menys de 1000 files. Si la instància admet
   `include: { "total_rows": true }`, també pots utilitzar `meta.total_rows`.
5. Indica que les dades poden canviar entre peticions. No sumis visitants únics
   de diferents pàgines, períodes o grups com si fossin persones diferents.

Les importacions queden excloses per defecte. Si les demanes amb
`include.imports`, revisa `meta.imports_included` i els avisos: algunes
combinacions de filtres i dimensions no les poden incloure.

## Errors

- Configuració absent: exporta les dues variables abans d'iniciar l'agent.
- HTTP 400: revisa la consulta i els requisits de les mètriques.
- HTTP 401 o 403: revisa la validesa de la clau i el seu accés al lloc.
- HTTP 429: espera abans de consultar de nou. No facis bucles de reintents.
- Error de xarxa, TLS, redirecció o timeout: comprova l'accés a l'origen
  configurat; no desactivis TLS ni imprimeixis headers o credencials.

El script no mostra els cossos d'error remots, perquè poden reproduir entrada
sensible. No els recuperis ni els imprimeixis per evitar aquesta protecció.
