# Inventari DNS I Migració A Cloudflare

## Estat

Resultat de la consulta dels registres DNS públics de `mountainrunners.cat`
(agost de 2026), que serveix de llista de verificació per a la importació de la
zona a Cloudflare. El canvi de nameservers no es fa aquí: correspon a la T5.4,
després de la ratificació de la
[`nota de preparació de la T5.1`](phase-5-t51-preparacio.md) i amb l'aprovació
explícita de la persona mantenidora.

## Inventari De Registres Actuals

Registres publicats al DNS de Hostinger el dia de la consulta:

| Tipus | Nom | Valor | Funció |
| ----- | --- | ----- | ------ |
| A | `mountainrunners.cat` | `147.79.119.99`, `77.37.50.3` | Hosting de Hostinger (la web actual) |
| CNAME | `www` | `www.mountainrunners.cat.cdn.hstgr.net` | CDN de Hostinger |
| A | `mail` | `34.120.251.119` | Webmail (preservar tal qual) |
| CNAME | `autodiscover` | `autodiscover.mail.hostinger.com` | Configuració automàtica de correu |
| CNAME | `autoconfig` | `autoconfig.mail.hostinger.com` | Configuració automàtica de correu |
| A | `ftp` | `92.113.28.109` | FTP del hosting actual |
| MX | `mountainrunners.cat` | `5 mx1.hostinger.com`, `10 mx2.hostinger.com` | Correu a Hostinger |
| TXT | `mountainrunners.cat` | `v=spf1 include:_spf.mail.hostinger.com ~all` | SPF |
| TXT | `_dmarc` | `v=DMARC1; p=none` | DMARC (només monitoratge) |

Observacions de la consulta:

- **No hi ha cap registre DKIM publicat** (comprovats els selectors comuns:
  `default`, `k1`, `google`, `hostinger`, `dkim`, `titan`, `email`, `s1`, `s2`).
  El correu s'envia amb SPF però sense signatura DKIM; no bloqueja la migració
  i és millorable després.
- **El DMARC està en `p=none`** (només observa, no rebutja res).
- No existeixen registres `webmail`, `smtp`, `imap`, `pop` ni SRV
  d'`autodiscover`.

## On Està Gestionat El Correu `info@`

Els MX apunten a `mx1`/`mx2.hostinger.com` i l'SPF inclou
`_spf.mail.hostinger.com`: el correu està a la **plataforma de correu de
Hostinger**. Si el hPanel d'una persona no mostra cap secció de Correus, el
servei està vinculat a un altre compte de Hostinger, probablement el de
l'associació o el de qui va muntar la web antiga.

Per localitzar-lo:

1. hPanel → apartat Correus (Emails).
2. Webmail a `https://mountainrunners.cat/webmail` amb les credencials de la
   bústia.
3. Preguntar a qui administra el correu de l'associació.
4. Suport de Hostinger identificant-se com a propietari del domini.

No cal moure ni cancel·lar res: el correu continuarà funcionant mentre els
registres MX i SPF resolguin correctament després de la migració.

## Estat De DNSSEC

No hi ha registres DS publicats al registre de `.cat`: el DNSSEC està
desactivat i no cal desactivar res a Hostinger. Després de la delegació es pot
activar opcionalment des de Cloudflare i publicar els DS a Hostinger.

## Passos Per Afegir La Zona A Cloudflare

1. Entrar a `dash.cloudflare.com` i prémer **Add a site**.
2. Introduir `mountainrunners.cat` i continuar.
3. Triar el pla **Free** i continuar.
4. Cloudflare executa un **Quick scan** automàtic i llista els registres
   trobats; comparar-los amb l'inventari d'aquest document.
5. Afegir manualment els registres que faltin (**Add record**), amb els valors
   exactes de la taula; els MX amb prioritat 5 i 10.
6. Deixar **tots** els registres amb el núvol **gris (DNS-only)**, especialment
   els de correu (`mail`, `autodiscover`, `autoconfig`, MX i TXT). El núvol
   taronja (proxied) sobre el correu el trencaria.
7. Continuar: Cloudflare mostra els **dos nameservers** assignats (tipus
   `xxx.ns.cloudflare.com` i `yyy.ns.cloudflare.com`).
8. **Aturar-se aquí**: copiar-los i guardar-los, però **no canviar-los encara
   a Hostinger**. La zona queda en estat *Pending Nameserver Update* i no
   afecta res: el DNS continua servint-se des de Hostinger fins al canvi.

El canvi de nameservers es fa a Hostinger (hPanel → Dominis → Servidors de
noms) només a la T5.4, un cop verificat que la zona de Cloudflare conté tots
els registres de l'inventari, i requereix l'aprovació explícita de la persona
mantenidora.

## Nota Sobre El Registrador

Al registre de `.cat`, el domini consta registrat amb **Openprovider**, que és
l'empresa registradora del mateix grup que Hostinger. El domini es va comprar
via Hostinger i el canvi de nameservers es continua fent des del hPanel.

## Fonts

- [`phase-5-t51-preparacio.md`](phase-5-t51-preparacio.md): decisions
  preliminars de desplegament.
- [`specs/phase-5-publication-operation.md`](specs/phase-5-publication-operation.md):
  T5.4 (canvis de DNS) i T5.5 (tall de DNS).
