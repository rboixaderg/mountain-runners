# ADR 0010: Frontera de Caddy i emmagatzematge ACME dels previews

## Estat

Acceptada per la persona mantenidora a la T6.4: simplicitat i cost zero per
damunt de separar el magatzem ACME. Esmena la T6.2, però **no autoritza** cap
canvi al VPS ni l'activació de previews. S'obre perquè la topologia aprovada a
[`docs/phase-6-t62-decisions.md`](../phase-6-t62-decisions.md) no es pot
implementar literalment amb el Caddyfile actual.

## Problema

La T6.2 exigeix un sol procés Caddy per a producció i previews, amb
emmagatzematge ACME separat per als previews, i diu que cap recàrrega dels
previews no toca els blocs de producció. En el Caddyfile de Caddy 2,
[`storage`](https://caddyserver.com/docs/caddyfile/options#storage) és una
opció global: no permet assignar un magatzem diferent a cada bloc de lloc.
El procés actual també té `admin off`, per tant aplicar un canvi de
configuració implica reiniciar Caddy i afecta el procés compartit.

La separació de directoris de logs i releases sí que és possible dins del
mateix procés; no equival a la separació de l'estat ACME ni de les fallades
d'un reinici.

## Decisió

Es conserva **un sol procés Caddy**, amb la mateixa IP i el wildcard DNS
existent. Els certificats de producció i previews comparteixen el magatzem
ACME del procés, on Caddy desa l'estat dels certificats TLS, però
`preview-deploy` no pot llegir-lo ni escriure-hi. Caddy només configura TLS per
als subdominis de PR habilitats explícitament, no per a qualsevol subdomini que
rebi una petició. Els registres d'accés, els directoris de cada PR i els
usuaris de desplegament continuen separats.

La configuració de previews només la pot modificar `root`, no l'artefacte ni
la identitat de publicació. El procés `mountain-preview-site` s'executa al VPS
com a `root`, rep peticions pel socket del grup de previews i només configura
orígens derivats d'un número de PR. L'autorització requereix una signatura
Ed25519 recent del job de publicació de GitHub sobre PR, SHA, actor i hora. La
clau privada només és accessible al job `publish` de GitHub; la clau pública
s'instal·la al VPS. La clau SSH de `preview-deploy` no pot fabricar
autoritzacions. El procés comprova la signatura
abans de registrar l'autorització, comprova que la versió instal·lada de la PR
està autoritzada i genera únicament el fragment de configuració de Caddy per
als subdominis permesos: no accepta directives Caddy arbitràries. Cada canvi
requereix validar el Caddyfile complet, el fitxer de configuració de Caddy,
**abans** de reiniciar. Si la validació falla, es conserva la configuració
anterior. Després del reinici es comproven tant producció com els orígens
actius. El reinici afecta Caddy, compartit amb producció. La validació redueix
el risc, però no garanteix que una fallada en temps
d'execució no interrompi producció. No s'ha de presentar la separació de
blocs com a independència operativa completa.

## Alternativa descartada i reversió

Dos processos amb IP diferenciades separarien ACME, configuració i reinicis,
però exigirien una IP addicional i un canvi del wildcard DNS. La T6.2
registra la Floating IPv4 com a possible escalada, no com a despesa aprovada.
Si la T6.5 detecta una interrupció de producció causada pels previews,
s'atura la seva activació i es revisa aquesta decisió abans de reprendre-la.
Per desactivar previews sense tocar el DNS ni els certificats de producció,
es retiren els blocs de preview després de validar la configuració resultant;
la persona mantenidora aplica qualsevol canvi remot amb aprovació explícita.

El risc residual acceptat és que una fallada de Caddy, del magatzem ACME
compartit o d'un reinici pot afectar tots dos serveis. La T6.5 ha de provar
el camí d'error, el procediment de restauració i l'estat de producció; cap
preview no es publica abans de completar el cicle de vida i aquestes proves.
