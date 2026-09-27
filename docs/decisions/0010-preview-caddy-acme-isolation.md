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
ACME del procés, però `preview-deploy` no pot llegir-lo ni escriure-hi. Els
orígens de preview es configuren explícitament: no s'activa TLS on-demand
sense allowlist. Els logs, els namespaces i les identitats de desplegament
continuen separats.

La configuració de previews és root-owned i no la pot editar l'artefacte ni
la identitat de publicació. Un broker root-owned accepta només un número de PR
pel socket del grup de previews, comprova l'autorització registrada en una
release elegible i genera únicament el fragment de hosts permesos: no accepta
directives Caddy arbitràries. Cada canvi de configuració requereix validació
del Caddyfile complet **abans** de reiniciar; si la validació falla, es
conserva la configuració anterior. Després del reinici es comproven tant
producció com els orígens actius. El reinici afecta el procés compartit:
la validació redueix el risc, però no garanteix que una fallada en temps
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

El risc residual acceptat és que una fallada del procés, del magatzem ACME
compartit o d'un reinici pot afectar tots dos serveis. La T6.5 ha de provar
el camí d'error, el procediment de restauració i l'estat de producció; cap
preview no es publica abans de completar el cicle de vida i aquestes proves.
