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

## Correccions de la revisió de la PR #130

- `pnpm check` i `pnpm validate`: correctes després de la revisió, amb 328
  tests de web, 104 de servidor i 306 recorreguts Playwright de producció.
- Build local amb `PUBLIC_SITE_ORIGIN=https://pr-130.preview.mountainrunners.cat`
  i `PUBLIC_PREVIEW=true`: correcte. Els 12 tests de preview passen en
  Chromium, Firefox i WebKit, tant a escriptori com a mòbil. El test ja no
  pressuposa que la PR sigui la #99.
- El test de `preview-ssh-gate` comprova que la clau SSH sola no pot autoritzar
  ni activar una release i que el procés `mountain-preview-site` rebutja una
  signatura falsa. La prova de publicació passa pel procés amb una parella de
  claus efímera generada al test; cap clau real no figura al repositori.
- La reconciliació retira un namespace amb el registre inconsistent i continua
  netejant les altres PR; marca l'execució com a fallida per exigir revisió i esborra
  directoris de retirades interrompudes. Es comproven també l'actualització
  dels 14 dies en reautoritzar el mateix SHA, la verificació dels altres
  orígens després de reiniciar Caddy i la recuperació horària d'una poda
  fallida.
- Continua pendent crear i instal·lar la clau pública de signatura al VPS,
  configurar la privada només al secret `PREVIEW_AUTH_PRIVATE_KEY` de l'entorn
  `previews` i comprovar els permisos reals del drop-in de Caddy. Requereix
  aprovació separada; cap preview no s'ha publicat.

## Verificació posterior (28 de setembre de 2026)

- Després de separar el codi de la comanda i dels processos i de limitar
  `ReadWritePaths` als directoris de previews, `pnpm validate` passa amb 328
  tests web, 105 de servidor i 306 recorreguts Playwright de producció.
- La prova d'instal·lació recorre la comanda i tots dos processos des de les
  rutes noves, fins a registrar una autorització signada. Un test comprova
  l'excepció d'escriptura de la unitat `systemd`, però la prova del sandbox real
  al VPS continua pendent de la T6.5.

## Corrections de la revisió de la PR #130 (28 de setembre de 2026)

- La poda esborra qualsevol directori de `releases/` que no sigui la versió
  activa, de manera que una instal·lació interrompuda no deixa una release
  òrfena quan la PR avança a un altre SHA.
- La reconciliació aïlla la fallada de cada entrada: continua amb les altres
  previews i acaba informant totes les incidències, en lloc d'abandonar el
  recorregut i deixar publicades les PR següents.
- El publicador només restaura el commit anterior quan l'activació s'ha
  completat, de manera que un error anterior a l'activació no queda emmascarat
  per una restauració impossible.
- El bootstrap no sobreescriu un `Caddyfile.previews` existent, així una
  reexecució ja no despublica els orígens actius.
- `pnpm check`: correcte amb 328 tests web, 109 de servidor i els nous casos
  de regressió.

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
