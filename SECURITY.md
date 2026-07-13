# Política De Seguretat

## Comunicar Una Vulnerabilitat

No comuniquis possibles vulnerabilitats en issues, discussions o pull requests
públiques. Utilitza el canal privat de comunicació de vulnerabilitats del
proveïdor del repositori.

Abans d'anunciar públicament el repositori, una persona mantenidora ha d'activar
aquest canal privat i assumir-ne la responsabilitat. No es pot començar a
desplegar públicament fins que això estigui preparat.

Inclou una descripció concisa, els camins o versions afectades, passos per
reproduir-ho, impacte i una possible mitigació. No adjuntis credencials ni dades
de producció.

## Abast Admès

S'accepten informes de seguretat sobre la configuració del repositori, les
dependències, la configuració de desplegament, la futura web estàtica, l'API de
xat públic i el flux editorial privat.

## Requisits De Seguretat

- Els secrets només viuen en variables d'entorn aprovades o en magatzems de
  secrets de CI.
- L'accés a producció aplica el principi de mínim privilegi amb comptes o claus
  separats.
- Els desplegaments només s'executen des del flux CI/CD revisat.
- Les actualitzacions de dependències i les correccions de seguretat han de
  preservar la integritat del lockfile i superar les comprovacions pertinents.
- El xat públic és de només lectura. L'assistent editorial utilitza scripts
  controlats i pull requests, mai publicació directa a producció.
