# Direcció De Desplegament

## Estat Actual

El repositori disposa de CI de qualitat i seguretat, però no de desplegament.
La fase 5 ha d'implementar la publicació a producció d'aquest document segons
[`docs/specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md).
Els previews de pull request i la decisió sobre Cloudflare corresponen a la
[`fase 6`](specs/phase-6-pull-request-previews.md) i no bloquegen producció.

## Destí

El projecte s'adreça a un VPS modest, amb Caddy com a proxy invers públic i
terminador TLS. La web estàtica i la futura API de xat es mantenen com a unitats
de desplegament separades.

## Controls

- La branca principal està protegida i els desplegaments de producció només
  s'originen des d'execucions CI/CD revisades i correctes.
- Les credencials del servidor, claus d'API i configuració de serveis es desen
  fora del repositori, en magatzems de secrets aprovats.
- L'accés a producció aplica el principi de mínim privilegi i es limita a
  persones mantenidores identificades.
- Cal definir la reversió, els logs i les comprovacions de salut abans del
  primer desplegament a producció.
- Cap agent, sessió local de shell ni flux editorial pot desplegar directament.

## Contracte De Build Actual

- `pnpm build` genera una sortida Astro estàtica a `apps/web/dist/`.
- `PUBLIC_SITE_ORIGIN` és obligatori per generar canonical, `hreflang`, sitemap
  i `robots.txt`; producció ha d'utilitzar `https://mountainrunners.cat`.
- `BUILD_TODAY` permet fixar la data editorial del build. Les proves i la CI la
  fixen per obtenir resultats deterministes; un build sense aquesta variable
  utilitza la data actual de Madrid.
- `dist/` és un artefacte generat i no una font de veritat. Producció no pot
  reutilitzar una sortida local existent: ha de desplegar un artefacte net creat
  per CI des del commit aprovat.

## CI Implementada

GitHub Actions executa qualitat, E2E, Conventional Commits, detecció de secrets,
revisió de dependències i CodeQL. `pnpm validate` no executa Lighthouse;
`pnpm lighthouse` és una auditoria manual separada.

## No Implementat

Encara no hi ha workflow de desplegament, configuració Caddy, provisió de
servidor, releases atòmiques, reversió, comprovacions de salut, runbook
d'incidències ni previews. La fase 5 implementa producció i la fase 6 avalua i
implementa els previews de manera separada. Només cal un ADR nou quan la
implementació introdueixi o canviï una decisió arquitectònica; els detalls que
apliquin la direcció acceptada continuen requerint una pull request revisada.
