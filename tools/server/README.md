# Eines De Servidor

Aquest directori conté la provisió del VPS, les eines de releases i previews i
el servei privat de Telegram. Les identitats, els camins del servidor i els
procediments són a [Operació](../../docs/operations/README.md).

## Estructura

| Path                                  | Contingut                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `bootstrap/bootstrap.sh`              | Provisió reproduïble i idempotent del VPS (Caddy pinjat, identitats, layout, daemon)                          |
| `caddy/Caddyfile`                     | Configuració del host de validació (headers, caché, 404, logs mínims)                                         |
| `caddy/Caddyfile.production`          | Configuració dels hosts de producció                                                                          |
| `caddy/Caddyfile.redirects`           | Mapa de redireccions (llegat, spam, sondes i prefix d'idioma) importat per `Caddyfile`                        |
| `caddy/content-security-policy.mjs`   | CSP vigent compartida pel `Caddyfile` i `verify-site`                                                         |
| `verify/verify-site.mjs`              | Verificació del contracte del host: TLS, headers, 404, caché, noindex o indexable                             |
| `verify/site-contract.mjs`            | Comprovacions pures: indexable, HSTS T5.1 i redirect `www` → apex                                             |
| `release/`                            | CLI `mountain-release` i mòduls (instal·lació, activació, reversió)                                           |
| `release/daemon.mjs`                  | Daemon root (systemd) que executa les operacions per la identitat de desplegament                             |
| `release/ssh-gate.mjs`                | Forced command: tokenitza sense shell; `receive` escriu `incoming/`                                           |
| `release/receive.mjs`                 | Escriptura limitada i hashed de uploads a `incoming/`                                                         |
| `release/validate.mjs`                | Validació d'arguments compartida entre el gate i el daemon                                                    |
| `release/cli.test.mjs`                | Tests `node --test` amb arxius tar adversos i el daemon en marxa                                              |
| `preview/`                            | [Comanda i processos del publicador de previews](../../docs/operations/previews.md#noms-del-flux-de-previews) |
| `agent/`                              | [Agent privat de desenvolupament](agent/README.md)                                                            |
| `systemd/mountain-release.service`    | Unitat del daemon (root, socket `/run/mountain-release.sock`)                                                 |
| `systemd/mountain-agent.service`      | Unitat del servei privat de Telegram                                                                          |
| `systemd/var-lib-mountain*.mount`     | Volums de treball i estat de l'agent                                                                          |
| `systemd/caddy-mountain-runners.conf` | Drop-in de Caddy: `ReadWritePaths` de logs i releases                                                         |

## Verificació

```sh
node --test tools/server/release/
bash -n tools/server/bootstrap/bootstrap.sh
caddy validate --config <Caddyfile generat> --adapter caddyfile
```
