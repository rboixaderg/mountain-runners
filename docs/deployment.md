# Direcció De Desplegament

## Estat Actual

El repositori disposa de CI de qualitat, seguretat, contracte d'artefacte i
desplegament continu protegit des de `main`. El VPS i l'entorn GitHub
`production` encara no s'han activat; el tall de l'apex és la T5.5. Els
previews de pull request i la decisió sobre Cloudflare corresponen a la
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
manifest immutable i empaqueta només fitxers regulars amb paths relatius. El
job de desplegament de la T5.4 transfereix aquest paquet; no es reconstrueix
al servidor.

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
dies). El job de build no accedeix a cap secret. El job `Deploy to production`
del mateix workflow, darrere de l'entorn GitHub `production` restringit a
`main`, descarrega aquest artefacte, en verifica manifest i digests, el
transfereix amb `mountain-release receive`, l'instal·la i l'activa, i executa
els smoke tests. El workflow `Rollback production` reverteix sense reconstruir.
Tots dos comparteixen el grup de concurrència `production-release` amb
`cancel-in-progress: false`. L'operació completa és a
[`docs/runbook.md`](runbook.md).

Límits coneguts del contracte (no bloquejants a la T5.2): l'arxiu es verifica
per llista de noms al build; el job de desplegament re-verifica el digest de
l'arxiu després de `receive` i el daemon re-verifica cada fitxer extret contra
el manifest. La reproductibilitat s'executa sobre dos builds calents del
mateix runner (el store de pnpm persisteix); els enllaços absoluts es validen
només estructuralment, amb qualsevol protocol, i es revisen remotament al gate
de llançament; i la cobertura d'enllaços és `href`, `src`, `srcset` i `url()`
de CSS, no atributs JS dinàmics.

## Servidor I Releases (T5.3)

Les eines de la T5.3 viuen a `tools/server/` i l'operació completa al
[`docs/runbook.md`](runbook.md). El diagrama Mermaid de la configuració del
servidor (identitats, Caddy, gate, daemon i layout) és a
[`docs/runbook.md`](runbook.md#arquitectura-del-servidor); s'actualitza amb
cada canvi d'aquesta arquitectura.

- **Bootstrap reproduïble** (`tools/server/bootstrap/bootstrap.sh`): provisiona
  el VPS de Hetzner amb Caddy 2.11.4 pinjat (checksum SHA-512 del
  `checksums.txt` oficial de Caddy),
  identitats separades de desplegament i Caddy, el layout de releases, els
  directoris de logs, la configuració de Caddy validada i el daemon de releases
  (systemd, root). Cap acció remota s'executa sense l'aprovació de la persona
  mantenidora.
- **Configuració Caddy** (`tools/server/caddy/`): host de validació amb
  `X-Robots-Tag: noindex, nofollow, noarchive`, headers mínims i CSP aprovades a
  T5.1, 404 global, rutes amb barra final preservades, caché immutable per a
  `/_astro/*` i curta per a `/content-resources/*`, i logs minimitzats amb els
  camps aprovats (la query string mai no es registra). El host de producció
  s'activa al tall (T5.5) important `Caddyfile.production`.
- **CLI de releases** (`tools/server/release/`): `install` (extracció segura:
  rebutja paths absoluts, `..`, symlinks, hardlinks, dispositius, duplicats i
  límits de mida/fitxers, i verifica tots els digests contra el manifest),
  `activate` (symlink `current` atòmic), `rollback` (release anterior elegible,
  codi 3 quan no n'hi ha cap), `revoke` i `health`. La persona mantenidora les
  executa amb `sudo`; la identitat de desplegament només pot arribar-hi a
  través del forced command `ssh-gate.mjs` (tokenitza sense shell i valida tots
  els arguments) i el daemon root (`mountain-release.service`), que revalida
  cada petició per `/run/mountain-release.sock` i és l'únic escriptor de les
  releases, del registre i del symlink actiu.
- **Registre de releases** (`/var/lib/mountain-runners/releases.json`):
  permanent, amb commit, digests, dates i estat (`eligible`/`active`/`revoked`);
  les releases revocades mai no es reactiven.
- **Polítiques públiques**: la política de privacitat descriu l'allotjament a
  Hetzner i els registres del servidor (7 dies d'accés, 30 d'error).

La reversió rutinària és interna (canvia el punter atòmic sense tocar DNS); la
restauració dels registres web anteriors de Hostinger queda com a via
extraordinària amb aprovació explícita, i la resposta d'emergència del runbook
s'aplica quan no queda cap release elegible.

## Desplegament Continu (T5.4)

`tools/deploy/` orquestra el pas de l'artefacte de CI al VPS:

- `deploy.mjs` verifica manifest i digests, rebutja un commit que ja no és el
  HEAD de `main`, transfereix amb `receive`, instal·la, activa i executa smoke
  tests. Una fallada després d'activar executa `rollback`.
- `rollback.mjs` és l'única via automatitzada per activar una release anterior
  elegible, sense reconstruir.
- L'entorn GitHub `production` (restringit a `main`, amb aprovació humana fins
  a la T5.5) és l'únic lloc on viuen `DEPLOY_SSH_PRIVATE_KEY` i
  `DEPLOY_KNOWN_HOSTS`. El job de build no els llegeix i no es comparteixen amb
  la futura infraestructura de previews.

L'operació, els noms de secrets i el procediment d'aprovació són a
[`docs/runbook.md`](runbook.md).

## CI Implementada

GitHub Actions executa qualitat, E2E, Conventional Commits, detecció de secrets,
revisió de dependències, CodeQL, el contracte d'artefacte de la T5.2, el
desplegament continu i el rollback de la T5.4, i els tests de les eines del
servidor (`pnpm test:server`). `pnpm validate` no executa Lighthouse;
`pnpm lighthouse` és una auditoria manual separada.

## No Implementat

El VPS i el host de validació encara no s'han posat en servei (accions remotes
de la T5.3 pendents d'aprovació) i l'entorn GitHub `production` encara no està
creat. El tall de l'apex és la T5.5. Tampoc hi ha previews, que la fase 6
avalua i implementa de manera separada. Només cal un ADR nou quan la
implementació introdueixi o canviï una decisió arquitectònica; els detalls que
apliquin la direcció acceptada continuen requerint una pull request revisada.
