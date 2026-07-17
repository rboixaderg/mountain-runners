# Revisió De Skills Portables De La Fase 2

## Propòsit

Aquest document registra la revisió de cadena de subministrament de la T2.2 del
vertical slice públic. Només s'incorporen skills amb origen, revisió, hash,
llicència compatible i contingut revisat. El conjunt aprovat en aquesta revisió
que es conserven sense modificacions a `.agents/skills/` amb la llicència original al seu directori.

## Detecció Aïllada

La detecció es va executar el 17 de juliol de 2026 amb `autoskills` `0.3.6` en
un directori temporal d'un sol ús. Es va fer servir un `HOME` buit, sense
configuració Git o npm de l'usuari, amb els scripts de lifecycle desactivats i
amb `--dry-run`. No es va executar al worktree ni es va escriure cap fitxer al
repositori.

| Element                         | Valor                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Paquet                          | `autoskills@0.3.6`                                                                                                                 |
| Registre                        | `https://registry.npmjs.org/`                                                                                                      |
| Origen declarat                 | `https://github.com/midudev/autoskills`                                                                                            |
| Integritat npm                  | `sha512-yNcj7Y/USPyJINxCWDaVVu17UaFokWgGtpX57PQUOA4i3s3vIDezaGZ/64KyMGb5CsLTvMb/L8WOX6R/ozhWIg==`                                  |
| SHA-512 del tarball descarregat | `c8d723ed8fd448fc8920dc4258369556ed7b51a168916806b695f9ecf414380e22decdef2037b368667feb82b23066f90ac2d3bcc6ff2fc58e5fa47fa3385622` |
| Llicència declarada             | `CC-BY-NC-4.0`                                                                                                                     |

La llicència no comercial no és compatible amb una incorporació automàtica a
aquest repositori MIT. El paquet no s'afegeix a dependències, CI, hooks ni al
repositori. La seva única funció en aquesta revisió ha estat informar una
proposta no vinculant.

La detecció va reconèixer TypeScript, Astro, Tailwind CSS, Zod i Vitest, i va
proposar les vuit skills següents.

| Skill proposada             | Origen i revisió declarats                                                     | Hash del document principal                                        | Decisió                                                          |
| --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `typescript-advanced-types` | `wshobson/agents@87b81e9d642d7bb9602b33d1e2dadf1c2a619f2b`                     | `c142f64de35a7c7518e62d4a5c5b18800bbe4391be14ba45a5d049adfcf01c57` | Aprovada: MIT, hash verificat i contingut compatible.            |
| `astro`                     | `astrolicious/agent-skills@cb4839f3794189ebf35c55d3ba5d3876dff7acf0`           | `64b0cfb9774b1dae0c7c86cc186508822588f903e8d6165ddd4e699e1c2710a8` | Descartada: el repositori no declara llicència.                  |
| `tailwind-css-patterns`     | `giuseppe-trisciuoglio/developer-kit@618b176e027ac856389921662977d651bfcaf588` | `63984406824ef934b457d34db25a5892b5375a82e31845159e6e97179c5acf4c` | Descartada: instrueix a canviar l'stack i contradiu `DESIGN.md`. |
| `zod`                       | `pproenca/dot-skills@89c72d29a73de4ee62522114379bf574b8c3f68f`                 | `245fc4ab7341a8ac0864c9535e2a6d782aaf012ba6975a36cd51240bcf82e443` | Descartada: el contingut no coincideix amb el hash del registre. |
| `vitest`                    | `antfu/skills@c35a5588a5158b5b404a14fb10469b2b6dc1952b`                        | `87c8cf025987d1f1a0e9c0fd0b8605946a0ebd5478676471ce296d8f0adc0f07` | Aprovada: MIT, hashes verificats i contingut compatible.         |
| `frontend-design`           | `anthropics/skills@2c7ec5e78b8e5d43ea02e90bb8826f6b9f147b0c`                   | `b81e2ff87ed8fa4d6c377ccb127a7254c9e6a77e3ae94f21e6b514f7bb2945a0` | Descartada: contradiu explícitament `DESIGN.md`.                 |
| `accessibility`             | `addyosmani/web-quality-skills@fed9617111260e19f4f54b72a2874a3f3de8ff94`       | `65021e9ccab70165539db82070257d4e2e2c7d7b0f857825299da2e4a7a8704c` | Aprovada: MIT, hashes verificats i contingut compatible.         |
| `seo`                       | `addyosmani/web-quality-skills@fed9617111260e19f4f54b72a2874a3f3de8ff94`       | `f3e546112a3168515486c533d13156a1d4dcd9402f3d116730cef573a20e2804` | Aprovada: MIT, hashes verificats i contingut compatible.         |

La proposta no inclou Playwright perquè encara no forma part del manifest del
projecte. S'avaluarà quan la dependència s'introdueixi per a la T2.7.

## Criteri Aplicat

El manifest inclòs a `autoskills` fixa revisions i hashes de fitxer, però les
entrades seleccionades indiquen `review skipped (--no-review)`. Aquesta
declaració no substitueix una revisió pròpia. Les quatre aprovades s'han revisat
directament i tenen cada hash de fitxer del registre verificat. El manifest local
`.agents/skills/skills-manifest.json` en fixa l'origen, la revisió, els hashes
de l'entrada i la llicència.

Cada còpia externa aprovada conserva un `LICENSE` complet al seu directori. Les
instruccions locals, `AGENTS.md` i els ADR sempre prevalen: no s'executen
instal·lacions globals o no fixades, càrregues a serveis externs, desplegaments
ni reescriptures de snapshots sense revisió. Les skills existents del projecte
continuen sent locals i no formen part d'aquest conjunt extern.

Una revisió futura només pot incorporar una candidata després de verificar la
llicència al repositori canònic, descarregar la revisió exacta sense executar
scripts, validar tots els hashes, llegir-ne tot el contingut i conservar les
atribucions requerides. La T2.7 crearà el wrapper local quan existeixin les
ordres i els llindars definitius; no duplica ni modifica skills externes.
