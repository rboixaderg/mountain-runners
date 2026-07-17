# Convenció D'Especificacions

## Propòsit

Cada fase, funcionalitat o tasca amb abast implementable té una especificació a
`docs/specs/`. L'especificació és la font de veritat del seu objectiu, límits,
entregues i acceptació; la checklist executiva i l'evidència de validació viuen
a la draft PR.

La skill portable [spec-authoring](../../.agents/skills/spec-authoring/SKILL.md)
aplica aquesta convenció en crear o revisar una especificació.

Les especificacions són documents públics i s'escriuen en català. No han de
contenir secrets, dades personals no publicables, textos heretats sense revisar
ni instruccions de desplegament no aprovades.

## Estructura Obligatòria

Tota especificació utilitza els mateixos apartats, en aquest ordre:

1. `Estat`
2. `Objectiu`
3. `Límits i decisions confirmades`
4. `Resultats esperats`
5. `Dependències i ordre d'inici`
6. `Tasques, entregues i seguiment`
7. Un o més apartats de requisits específics
8. `Estratègia de tests i qualitat`
9. `Seguretat i privacitat`
10. `Fora d'abast`
11. `Criteris d'acceptació`

Els apartats de requisits específics recullen rutes, models, disseny, contingut,
operació o altres regles pròpies de l'entrega. Poden tenir noms de domini, com
`Rutes i navegació` o `Models de contingut`, i es divideixen en subseccions només
quan calgui. No s'afegeix una secció obligatòria buida: si no aporta requisits
nous, ha d'incloure una frase curta que n'indiqui la no aplicabilitat.

## Especificacions Curtes

Una funcionalitat d'una sola tasca o PR conserva tota l'estructura, però pot ser
concisa: una única fila a `Entregues i seguiment`, un llistat curt de requisits
i només les comprovacions pertinents. També ha de declarar els límits, el fora
d'abast i l'acceptació; la mida no justifica ometre'ls.

## Definició De Tasques

Abans de començar la implementació, l'especificació desglossa tot el treball en
una o més tasques. Cada tasca inclou identificador, abast i exclusió immediata,
dependències, resultat observable, comprovacions mínimes i una PR dedicada o una
raó explícita per agrupar-la amb una altra.

La taula de seguiment mostra les tasques; una subsecció per tasca n'explica els
límits. La checklist detallada continua a la draft PR per evitar dues fonts de
veritat. Una necessitat nova es desglossa com a tasca nova o torna al backlog;
no amplia silenciosament una tasca activa.

## Seguiment I Actualització

- Els estats permesos són `Pendent`, `En curs`, `Bloquejada` i `Completada`.
- Una unitat només passa a `Completada` quan la seva PR està validada, revisada i
  fusionada.
- Cada draft PR enllaça l'especificació, identifica criteris coberts, registra
  comprovacions i evidencia els impactes aplicables.
- Una decisió que canviï una frontera acceptada requereix primer un ADR. Una
  necessitat no prevista s'afegeix al backlog o crea una especificació pròpia;
  no amplia silenciosament una PR activa.

Les especificacions existents es mantenen com a registre de les decisions ja
preses. S'adapten a aquesta convenció quan es revisin substancialment; les noves
especificacions l'han de seguir des de la seva primera versió.
