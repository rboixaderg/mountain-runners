# Especificació T6.7: Contracte De Consulta I Escriptura De `mountain-preview`

## Estat

Pendent. Esmena de la T6.4: el codi existeix i està fusionat (PR #130, #135),
però no s'ha executat mai contra el VPS real. La T6.5 (`docs/phase-6-t65-activacio-vps.md`,
pendent d'execució) va detectar que tres ordres amb nom de consulta modifiquen
l'estat. Aquesta tasca ho corregeix abans de l'activació.

## Objectiu

Que el nom de cada ordre de `mountain-preview` descrigui el seu efecte real:
les ordres de consulta són pures (ni creen, ni bloquegen, ni esborren res) i
tota mutació té un verb explícit. Cap inventari ni comprovació de salut pot
produir canvis reals sense adonar-se'n.

## Límits I Decisions Confirmades

- Dins de l'[ADR 0009](../decisions/0009-pr-previews-same-domain-and-own-branches.md)
  i l'[ADR 0010](../decisions/0010-preview-caddy-acme-isolation.md): no canvia
  cap frontera arquitectònica, només el contracte CLI; per això no cal cap ADR
  nou.
- El sistema no s'ha activat mai en producció, de manera que `site-sync` es
  reanomena de forma dura a `site-reconcile`, sense àlies de compatibilitat.
- `list` i `health` conserven el nom per compatibilitat amb el runbook, però
  passen a ser purs.
- La neteja periòdica continua sent responsabilitat del workflow
  `Preview cleanup` (`.github/workflows/preview-cleanup.yml`), que crida
  `tools/preview/reconcile.mjs` amb codi de confiança des de `main`.

## Resultats Esperats

- `inventory`, `list <n>` i `health <n>` són de només lectura: no creen
  directoris, no prenen el bloqueig de capacitat i no esborren res.
- `cleanup-retired` neteja els directoris de retirades interrompudes.
- `site-reconcile` substitueix `site-sync` i declara l'efecte real: reconcilia
  els blocs Caddy i reinicia el servei.
- `tools/preview/reconcile.mjs` usa el nou contracte.
- `docs/deployment.md` i `docs/runbook.md` classifiquen cada ordre com a
  consulta o escriptura.

## Dependències I Ordre D'Inici

Depèn de la T6.4 (cicle de vida implementat) i precedeix la T6.5 (l'activació
instal·la el codi resultant al pas 8). No requereix aprovació de la persona
mantenidora fins a la PR, com qualsevol canvi de codi.

## Tasques, Entregues I Seguiment

| Unitat                                  | Estat   | Dependències | Resultat verificable              | PR  |
| --------------------------------------- | ------- | ------------ | --------------------------------- | --- |
| T6.7 Contracte de consulta i escriptura | Pendent | T6.4         | CLI amb consultes pures i verbs   | -   |
|                                         |         |              | explícits, reconciliació adaptada |     |

### T6.7: Contracte De Consulta I Escriptura

**Abast:** fer purs `inventory`, `list` i `health` (sense `mkdir`, sense
`withPreviewCapacity`, sense `cleanRetiredPreviews`); afegir `cleanup-retired`
(global, amb capacitat i bloqueig); reanomenar `site-sync` a `site-reconcile`
al gate, al procés `mountain-preview-site` i a `reconcile.mjs`; tolerar
`namespaces/` absent a l'inventari amb `[]`; actualitzar `deployment.md`,
`runbook.md` i els tests afectats. **Exclusió:** no canvia l'autenticació,
l'autorització, el format del registre ni la política de retenció.
**Depèn de:** T6.4. **Resultat:** el nom de cada ordre descriu el seu efecte i
la reconciliació horària usa el nou contracte. **Comprovació:** `pnpm
test:server`, `prettier --check` i `eslint` sobre els fitxers tocats.
**PR:** pròpia.

## Contracte CLI

### Consulta (pura)

| Ordre        | Efecte                                                     |
| ------------ | ---------------------------------------------------------- |
| `inventory`  | Llegeix `namespaces/` i cada registre; `[]` si no existeix |
| `list <n>`   | Llegeix el registre del namespace; no el crea              |
| `health <n>` | Llegeix registre i digests; namespace absent = `DEGRADED`  |

Cap ordre de consulta crea el fitxer `.capacity.lock`, pren
`withPreviewCapacity`, comprova límits de capacitat ni pot fallar amb
`Preview limit of ... reached`.

### Escriptura i manteniment (verbs explícits)

| Ordre                                | Efecte                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `receive/install/authorize/activate` | Publicació (com abans)                               |
| `retire <n>` / `prune <n>`           | Retirada i poda per PR (com abans)                   |
| `cleanup-retired`                    | Elimina directoris `.retired-pr-<n>-<uuid>`          |
| `site-enable/site-disable <n>`       | Activa o retira un origen a Caddy (com abans)        |
| `site-reconcile`                     | Elimina blocs Caddy sense `current` i reinicia Caddy |

El preludi comú de mutació (`assertNamespaceCapacity`, `mkdir
incoming/releases`, `withPreviewCapacity`) només s'aplica a
`receive/install/authorize/activate/prune`. `retire`, `cleanup-retired` i les
ordres `site-*` gestionen els seus propis bloquejos o socket, com abans.

La seqüència de `reconcile.mjs` passa a ser `cleanup-retired`,
`site-reconcile`, `inventory` i, per entrada, `retire/site-disable/prune`.

## Estratègia De Tests I Qualitat

- `tools/server/preview/gate.test.mjs`: l'inventari ja no neteja retirades
  interrompudes (ho fa `cleanup-retired`); `list/health` sobre un namespace
  inexistent no creen directoris; l'inventari amb `namespaces/` absent
  retorna `[]`.
- `tools/server/preview/site-manager.test.mjs`: el socket accepta
  `site-reconcile` i rebutja `site-sync`.
- `tools/preview/reconcile.test.mjs`: la seqüència esperada usa
  `cleanup-retired` i `site-reconcile`.
- `pnpm test:server` verd, `prettier --check` i `eslint` sobre els fitxers
  tocats.

## Seguretat I Privacitat

- Les consultes no escriuen cap path fora de la sortida estàndard; redueixen
  la superfície d'escriptura de la identitat `preview-deploy`.
- Cap secret ni credencial nova; el gate SSH continua tokenitzant sense shell
  i validant cada argument.
- `site-reconcile` continua restringit al procés `root` via socket Unix, que
  només accepta orígens derivats de números de PR.

## Fora D'Abast

- Canvis a l'autenticació, l'autorització signada, el sandbox systemd, el TLS
  o la política de retenció (14 dies / 24 hores).
- L'execució de la T6.5 al VPS real.
- L'actualització de `docs/phase-6-t65-activacio-vps.md`, document de treball
  de la T6.5 fora d'aquesta tasca.

## Criteris D'Acceptació

1. `inventory`, `list <n>` i `health <n>` no creen fitxers ni directoris, no
   prenen cap bloqueig i mai fallen per límit de capacitat.
2. `cleanup-retired` elimina els directoris `.retired-pr-<n>-<uuid>` i
   `inventory` els conserva.
3. `site-sync` és rebutjat com a ordre desconeguda; `site-reconcile`
   reconcilia els orígens Caddy.
4. `reconcile.mjs` executa `cleanup-retired`, `site-reconcile` i `inventory`
   en aquest ordre.
5. La documentació classifica cada ordre com a consulta o escriptura.
6. `pnpm test:server`, `prettier --check` i `eslint` passen sobre l'abast
   tocat.
