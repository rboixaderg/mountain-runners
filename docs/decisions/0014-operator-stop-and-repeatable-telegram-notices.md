# ADR 0014: Aturada per l'operador i avisos de Telegram repetibles al pilot de l'agent privat

## Estat

Acceptada per la persona mantenidora el 16 de novembre de 2026. Esmena dos punts
de [T8.1](../phase-8-t81-requisits-amenaces.md) i de l'[ADR 0013](0013-private-development-agent-boundary.md):
l'aturada de l'execució activa passa a ser de la persona operadora i un avís de
Telegram es pot repetir després d'un lliurament desconegut. La resta de requisits
de T8.1 i la resta de la frontera de l'ADR 0013 no canvien. Aquest ADR no activa
cap permís ni cap servei.

## Context

La revisió de seguretat de T8.6 ha contrastat el servei del pilot amb l'ADR 0013
i amb la matriu d'amenaces de T8.1. Dues troballes no són defectes puntuals, sinó
diferències entre el requisit i el que el pilot fa:

- **F4, aturada del membre.** T8.1 diu que qualsevol membre verificat pot
  demanar l'aturada de l'execució activa del tema, processada fora de la cua
  normal. El pont llegeix Telegram i executa la instrucció en el mateix bucle,
  així que una petició «atura» no es llegeix fins que la feina activa acaba, i
  després entra pel classificador i la cua ordinaris. Separar la recepció de
  Telegram del consumidor de feina i afegir-hi un camí d'aturada verificat és una
  feina gran que no canvia les garanties de seguretat del pilot.
- **F6, avisos repetits.** Quan un enviament a Telegram falla, el servei no pot
  distingir un refús d'un lliurament desconegut. L'avís de confirmació de preview
  i l'avís de reconciliació del merge es poden enviar dues vegades. El contracte
  de recuperació de l'ADR 0013 diu que un efecte amb resultat desconegut no es
  repeteix sense consultar abans l'estat real. Els efectes de GitHub ja compleixen
  aquest contracte.

## Decisió

1. **Aturada per l'operador.** Durant el pilot, l'única manera d'aturar una
   execució activa és que la persona operadora aturi el servei:

   ```sh
   systemctl stop mountain-agent
   ```

   Es mantenen les garanties existents: el servei conserva la feina, la branca i
   la PR, no tanca la PR ni elimina treball no fusionat, i un resultat desconegut
   es reconcilia amb l'ordre d'operador de la T8.5. El tema de Telegram no té cap
   comanda d'aturada i el servei no cancel·la cap execució per un missatge del
   grup. Un membre que vol aturar la feina ho demana a la persona mantenidora.

2. **Avisos de Telegram repetibles.** S'accepta que un avís de Telegram es pugui
   enviar dues vegades després d'un lliurament desconegut. Afecta només l'avís de
   confirmació de preview i l'avís de reconciliació del merge. És una excepció
   explícita i limitada al canal de Telegram: els efectes de GitHub no canvien i
   no es repeteixen mai, i el comentari `/preview` i el merge conserven les seves
   comprovacions i el seu registre previ.

## Conseqüències

Un membre no pot parar una execució des del tema: ho ha de demanar a la persona
mantenidora, que atura el servei amb `systemctl`. L'aturada conserva la feina i
deixa el pilot parat fins que la persona operadora el reprengui o reconcilia els
resultats desconeguts.

Una persona pot rebre dues vegades el mateix avís de preview o de reconciliació
després d'un error de xarxa. És una molèstia visible i no un canvi d'estat: el
text repetit no habilita cap acció, cap efecte de GitHub es duplica i l'estat
durador del servei continua sent l'única font de veritat.

La resta de controls de l'ADR 0013 es mantenen: identitat i pertinença
verificades, aïllament, credencials separades, camí únic del merge, preview amb
revalidació i reconciliació de resultats desconeguts per a les accions de GitHub.

## Quan revisar-ho

Cal revisar aquest ADR abans d'ampliar el pilot a persones menys controlades que
les del grup actual. Llavors l'aturada del membre i la deduplicació estricta dels
avisos tornen a ser requisits, no excepcions. També cal revisar-lo si un avís
duplicat provoca confusió, una acció repetida o una decisió equivocada al tema.
