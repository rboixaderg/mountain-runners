# Validació local del model de notícies i blog

## Estat i abast

Validació del 2 d'octubre de 2026 al worktree `mountain_runners-news-blog-model`,
branca `feat/news-blog-model`, basada en `fab6fd9` després de consultar
`origin/main`. Correspon a NB-03, encara en curs i sense PR fusionada.

S'han implementat l'esquema i el registre de `posts`, la validació de dates,
autoria, Markdown, referències i recursos, i les seleccions explícites de variants
publicades i de preview. La col·lecció editorial encara és buida; la fixture
fictícia només viu als tests.

Les rutes, la còpia d'assets de posts, els pilots i els nous estats visuals
encara no estan implementats. Cap comprovació d'aquest document acredita
l'entrega completa o un desplegament remot.

## Comprovacions executades

| Comprovació                                                          | Resultat                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Tests dirigits de posts, models i publicació                         | 79 tests correctes                                                          |
| `pnpm check`                                                         | Correcte: format, lint, typecheck, 358 tests de web i 115 tests de servidor |
| Build públic amb origen de producció i `BUILD_TODAY=2026-10-02`      | Correcte, inclòs `verify-i18n-output.mjs`; sense rutes editorials noves     |
| Build amb `PUBLIC_PREVIEW=true`, origen de preview i la mateixa data | Correcte, inclosa la verificació de sortida existent                        |
| E2E existents de preview amb `CI=true`                               | 18 tests correctes en Chromium, Firefox i WebKit, mòbil i escriptori        |
| `git diff --check`                                                   | Correcte                                                                    |

Els builds emeten un avís sobre el conflicte de la ruta arrel `/`. La verificació
de rutes passa i aquesta entrega no modifica el routing arrel. Els tests també
emeten un avís de sourcemap de la dependència Paraglide. No s'han ocultat avisos
ni relaxat comprovacions per fer passar la validació.

### Ordres representatives

```sh
pnpm --filter @mountain-runners/web exec vitest run \
  src/test/content-posts.test.ts \
  src/test/content-models.test.ts \
  src/test/content-publication.test.ts
pnpm check
PUBLIC_SITE_ORIGIN=https://mountainrunners.cat BUILD_TODAY=2026-10-02 pnpm build
PUBLIC_PREVIEW=true PUBLIC_SITE_ORIGIN=https://pr-999.preview.mountainrunners.cat BUILD_TODAY=2026-10-02 pnpm build
CI=true PUBLIC_PREVIEW=true PUBLIC_SITE_ORIGIN=https://pr-999.preview.mountainrunners.cat pnpm exec playwright test apps/web/e2e/preview.spec.ts
git diff --check
```

L'origen `pr-999` només s'utilitza com a valor de prova local; no s'ha activat
cap preview amb aquest número.

## Garanties comprovades i límits

- Una mateixa entrada `published: false` només és seleccionada per la funció
  explícita de preview i no se'n modifica l'estat.
- La completesa d'idioma es comprova independentment de l'estat, inclosos els
  encapçalaments opcionals existents de les seccions.
- Duplicats d'identitat o de slug per tipus/idioma, referències inexistents i
  publicacions futures es rebutgen en totes dues seleccions.
- Les comparacions de publicació i actualització respecten l'instant i l'offset;
  les dates editorials utilitzen el calendari de Madrid.
- Les cobertes han de ser locals i tenir alt i crèdit. La validació de paths
  i resolució de recursos reutilitza el contracte existent.
- Els tests de publicació anteriors passen. El catàleg públic existent no
  consulta esborranys ni canvia la visibilitat de les altres col·leccions.

La política de modes als entry points d'artefacte i les negatives sobre recursos
exclusius de posts són NB-04. No s'han executat `pnpm validate` complet,
Lighthouse o una revisió visual de pàgines noves, perquè aquestes pàgines no
formen part de NB-03.

## Preparació de la revisió

L'especificació `docs/specs/news-and-blog.md`, l'ADR 0011, l'esmena de fase 6 i
els canvis del model s'han consolidat a `mountain_runners-news-blog-artifacts`
per petició de la persona mantenidora. Documentació i implementació es revisaran
en una única PR, encara no creada. Aquest document conserva l'evidència dels
checks executats originalment a NB-03. No es promociona aquesta validació local
a aprovació de merge.
