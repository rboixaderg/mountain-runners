# ADR 0007: Contracte Del Locale Als Helpers De Presentació

## Estat

Acceptada.

## Relació Amb ADR 0006

L'ADR 0006 no es modifica: conserva el seu valor històric i continua governant
la separació de capes, les pàgines primes i les regles de manteniment de la
presentació. Aquest ADR substitueix únicament la clàusula de la regla 3 que
exigeix que tots els helpers de presentació rebin el `locale`.

Quan aquesta decisió i una regla de l'ADR 0006 difereixin sobre el contracte
dels helpers de presentació, preval l'ADR 0007. Per a la resta de casos, preval
l'ADR 0006.

## Context

L'ADR 0006 estableix que els helpers de presentació «reben el locale i retornen
dades o claus de missatge». Durant el tancament de la fase 4 es va registrar que
diversos helpers deriven claus de missatge o dades estrictament independents de
l'idioma: la clau apunta a una constant tipada compartida per tots els idiomes i
el text es resol a la capa de component amb el seu propi `locale`; altres
construeixen URLs o extreuen identificadors sense cap sortida localitzada.

Exigir-los el `locale` els hi afegeix un paràmetre que mai no utilitzen
(`void locale`), que confon la revisió i no aporta cap garantia: no evita
duplicació, no comprova res en temps de compilació i no canvia el resultat.
L'alternativa correcta és acotar el contracte al que la sortida requereix.

## Decisió

Un helper de presentació rep el `locale` només quan la seva sortida depèn de
l'idioma: format de dates i rangs, selecció de dades localitzades (noms, URLs o
textos per idioma) o qualsevol derivació que pugui produir resultats diferents
segons l'idioma.

Un helper que deriva dades o claus de missatge estrictament independents de
l'idioma —estats i disponibilitats que apunten a constants tipades, construcció
d'URLs o `href` a partir de valors semàntics, extracció d'identificadors,
ordenació per tipus o parseig de markdown— no rep el `locale`, i no se li afegeix
cap paràmetre inert.

La resolució de text es manté sempre a la capa de component, amb
`messages[clau]({}, { locale })`, i cap helper no importa Astro ni Paraglide.

## Conseqüències

- Els helpers de clau d'estat, registre, disponibilitat de documents i xarxes
  socials del peu no reben paràmetres que no utilitzen.
- Un helper que en el futur passi a produir sortida localitzada rep el `locale`
  en aquell mateix canvi; la revisió de la PR ho comprova.
- `AGENTS.md` i `docs/code-conventions.md` descriuen aquest contracte com a
  regla de revisió, no com a excepció.
