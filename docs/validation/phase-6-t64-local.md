# T6.4: verificació local del cicle de vida dels previews

## Estat

Implementació local al worktree de la T6.4, pendent de revisió i d'aprovació
separada per a qualsevol acció al VPS. **Cap preview no està publicada.**

## Evidència local (27 de setembre de 2026)

- `pnpm validate`: format, lint, tipus i tests correctes; 97 tests de servidor
  i 306 recorreguts Playwright correctes (els 12 casos reservats als builds de
  preview queden omesos al build de producció). La primera execució va tenir
  una fallada intermitent en un test preexistent del calendari mòbil; la
  reexecució del test i del gate complet va passar.
- Build amb `PUBLIC_PREVIEW=true` i origen
  `https://pr-99.preview.mountainrunners.cat`: correcte. Marca visible,
  canonical propi, `noindex` i cap script d'analítica a `ca`, `es` i `en`;
  `robots.txt` bloqueja el rastreig. Els 12 tests específics del build de
  preview passen en Chromium, Firefox i WebKit (desktop i mòbil).
- Configuració de Caddy adaptada i validada localment amb Caddy 2.11.4 per
  un origen de preview, inclòs el fragment buit. La prova amb Docker local
  no emet certificats ni canvia la configuració del VPS.
- Tests locals cobreixen orígens numèrics simultanis, límit de cinc
  namespaces, bloqueig de la sisena preview, autorització registrada,
  actualització i neteja de releases, revocació, tancament, expiració,
  SHA obsolet, reexecució i restauració després d'un reinici Caddy o smoke
  fallit.

## Pendent abans de l'activació

- Revisar el codi i validar el flux complet contra el VPS amb aprovació de la
  persona mantenidora, sense reexecutar el bootstrap existent.
- Executar VR-01 (emissió TLS contra l'staging de Let's Encrypt), comprovar
  DNS, quota, espai de disc, memòria i permisos de Caddy i del socket.
- Provar dos orígens reals simultanis, capçaleres i caché inclosos els 404,
  navegació i canonical dels tres idiomes, logs i retenció, revocació i
  recuperació després d'una fallada de reinici. Verificar producció abans i
  després de cada canvi de configuració.
- Completar la validació operativa de la T6.5 abans d'obrir els previews a
  la revisió ordinària. La marca visual dins del build no és una garantia
  contra una PR maliciosa (esmena de l'ADR 0009).
