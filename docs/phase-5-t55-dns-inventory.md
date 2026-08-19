# Inventari DNS Del Tall (T5.5)

## Estat

Consulta pública de `mountainrunners.cat` el 18 d'agost de 2026, abans del
tall web. Serveix per preservar el correu i la resta de serveis no migrats
mentre només es canvien l'apex i `www`. Hostinger continua sent el DNS
autoritatiu; els nameservers no es mouen.

Aquest document no substitueix l'export immediatament anterior al tall des
del hPanel i els `dig` del [runbook](runbook.md#9-tall-dns-i-primera-activació-pública).
Els valors d'allotjament web canviaran; els de correu no.

## Delegació

| Tipus | Nom                   | Valor                                        |
| ----- | --------------------- | -------------------------------------------- |
| NS    | `mountainrunners.cat` | `ns1.dns-parking.com`, `ns2.dns-parking.com` |
| SOA   | `mountainrunners.cat` | `ns1.dns-parking.com` / `dns.hostinger.com`  |

No hi ha registres DS: DNSSEC està desactivat i no s'activa en aquesta tasca.

## Registres Que Es Preserven

| Tipus | Nom            | Valor                                         | Funció                     |
| ----- | -------------- | --------------------------------------------- | -------------------------- |
| MX    | `@`            | `5 mx1.hostinger.com`, `10 mx2.hostinger.com` | Correu a Hostinger         |
| TXT   | `@`            | `v=spf1 include:_spf.mail.hostinger.com ~all` | SPF                        |
| TXT   | `_dmarc`       | `v=DMARC1; p=none`                            | DMARC (només observació)   |
| CNAME | `autodiscover` | `autodiscover.mail.hostinger.com`             | Autoconfiguració de correu |
| CNAME | `autoconfig`   | `autoconfig.mail.hostinger.com`               | Autoconfiguració de correu |
| A     | `ftp`          | `92.113.28.109`                               | FTP del hosting actual     |

`mail.mountainrunners.cat` no resolia el 18 d'agost de 2026 (ni A ni CNAME).
No s'ha de crear un registre `mail` al tall. Si en el moment de l'export
n'hi ha un, cal que es mantingui idèntic.

No s'han trobat selectors DKIM comuns (`default`, `hostinger`, `k1`, `s1`,
`s2`). Cal confirmar al hPanel si n'existeix un altre abans de concloure que
els missatges no se signen; el tall no hi toca.

## Registres Web Que Es Substitueixen

| Tipus | Nom   | Valor actual (Hostinger)                | Després del tall        |
| ----- | ----- | --------------------------------------- | ----------------------- |
| A     | `@`   | `147.79.116.31`, `77.37.50.58`          | una A a la IPv4 del VPS |
| AAAA  | `@`   | dues IPv6 de Hostinger                  | esborrar                |
| CNAME | `www` | `www.mountainrunners.cat.cdn.hstgr.net` | esborrar                |
| A     | `www` | (via CNAME, IPv4 de la CDN)             | una A a la IPv4 del VPS |
| AAAA  | `www` | (via CNAME)                             | esborrar                |

No es publica `AAAA` fins que IPv6 estigui validat al VPS (T5.1).

## Webmail

`https://mountainrunners.cat/webmail` ja respon 404 a l'allotjament actual
(WordPress a Hostinger, 19 d'agost de 2026): no hi ha cap drecera de correu a
l'apex. El webmail és [`https://mail.hostinger.com`](https://mail.hostinger.com)
(URL fixa de Hostinger). El tall de la web no el mou. Abans del tall, iniciar-hi
sessió amb l'adreça institucional completa i la contrasenya de la bústia, no
amb la del hPanel.

## Fora D'Abast

- Canvi de nameservers, Cloudflare, DNSSEC o CDN.
- Creació de registres de preview o wildcard (fase 6).
- Publicació d'IPv6 al tall inicial.
