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

## Contracte D'Artefacte (T5.2)

`tools/release/build-artifact.mjs` és el contracte reutilitzable de la T5.2:
construeix la web, verifica la superfície canònica de sortida, registra un
manifest immutable i empaqueta només fitxers regulars amb paths relatius. No
desplega res: la transferència i l'activació són de la T5.3/T5.4.

Ordre d'execució (a CI o manualment):

1. `pnpm build` amb `PUBLIC_SITE_ORIGIN` i `BUILD_TODAY` explícits, que ja
   executa la verificació de sortida existent (`verify-i18n-output.mjs`:
   rutes, `/`, 404, sitemap, robots, recursos i exclusió d'esborranys).
2. `tools/release/verify-internal-links.mjs`: els enllaços interns (href, src,
   srcset i `url()` de CSS) i fitxers locals són bloquejants i han de resoldre
   dins del build. Els absoluts (inclosos els same-origin que apunten fora del
   build, com el web anterior de l'Anella Verda) es validen només
   estructuralment i es revisen remotament al gate de llançament.
3. Generació del manifest `artifacts/release/manifest.json` amb schema,
   commit, origen, `BUILD_TODAY`, workflow, límits, totals i la llista de
   fitxers amb mida i SHA-256.
4. Empaquetat `artifacts/release/mountain-runners-<commit>.tar.gz` només amb
   fitxers regulars i paths relatius; el contingut del paquet es verifica
   contra la llista del manifest.

Límits aprovats de l'artefacte (fitxers regulars, mida expandida):

| Límit              | Valor   | Justificació                                |
| ------------------ | ------- | ------------------------------------------- |
| Mida expandida màx | 128 MiB | Build actual ≈ 21 MB (PDF d'estatuts 12 MB) |
| Nombre de fitxers  | 5.000   | Build actual: 149 fitxers                   |

Scripts associats: `pnpm artifact` (contracte complet) i
`pnpm artifact:reproducibility` (dos builds nets amb les mateixes entrades han
de produir la mateixa llista de fitxers i els mateixos digests SHA-256). Els
scripts resolen `BUILD_TODAY` a la data de Madrid quan no es defineix, i es pot
sobreescriure amb qualsevol `YYYY-MM-DD` per reproduir un manifest anterior;
`PUBLIC_SITE_ORIGIN` es fixa a `https://mountainrunners.cat`.

El workflow `Artifact` (`.github/workflows/artifact.yml`) executa el contracte
a cada push a `main` i de forma manual, amb `BUILD_TODAY` resolt a la data de
Madrid, i puja el paquet i el manifest com a artefacte del run (retenció de 30
dies) sense accedir a cap secret. El job de reproductibilitat valida la
determinisme del build.

Límits coneguts del contracte (no bloquejants a la T5.2): l'arxiu es verifica
per llista de noms, no re-digestint el contingut extret (la verificació de
digests després de transferir és del job de desplegament de la T5.4); la
reproductibilitat s'executa sobre dos builds calents del mateix runner (el
store de pnpm persisteix); els enllaços absoluts es validen només
estructuralment, amb qualsevol protocol, i es revisen remotament al gate de
llançament; i la cobertura d'enllaços és `href`, `src`, `srcset` i `url()` de
CSS, no atributs JS dinàmics.

## CI Implementada

GitHub Actions executa qualitat, E2E, Conventional Commits, detecció de secrets,
revisió de dependències, CodeQL i el contracte d'artefacte de la T5.2. `pnpm
validate` no executa Lighthouse; `pnpm lighthouse` és una auditoria manual
separada.

## No Implementat

Encara no hi ha workflow de desplegament, configuració Caddy, provisió de
servidor, releases atòmiques, reversió, comprovacions de salut, runbook
d'incidències ni previews. La fase 5 implementa producció i la fase 6 avalua i
implementa els previews de manera separada. Només cal un ADR nou quan la
implementació introdueixi o canviï una decisió arquitectònica; els detalls que
apliquin la direcció acceptada continuen requerint una pull request revisada.
