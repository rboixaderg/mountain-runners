# Política De Seguretat

## Comunicar Una Vulnerabilitat

No comuniquis possibles vulnerabilitats en issues, discussions o pull requests
públiques. Utilitza el canal privat de comunicació de vulnerabilitats del
proveïdor del repositori (**Private Vulnerability Reporting** de GitHub, a la
pestanya **Security** del repositori).

Abans d'anunciar públicament el repositori, una persona mantenidora ha d'activar
aquest canal privat i assumir-ne la responsabilitat. No es pot començar a
desplegar públicament fins que això estigui preparat.

Inclou una descripció concisa, els camins o versions afectades, passos per
reproduir-ho, impacte i una possible mitigació. No adjuntis credencials ni dades
de producció.

## Abast Admès

S'accepten informes de seguretat sobre el repositori, les dependències, la web
estàtica, el desplegament, les previews, l'agent privat de Telegram i els
canvis del futur xat públic.

## Requisits De Seguretat

- Els secrets només viuen en variables d'entorn aprovades o en magatzems de
  secrets de CI.
- L'accés a producció aplica el principi de mínim privilegi amb comptes o claus
  separats.
- Els desplegaments només s'executen des del flux CI/CD revisat. Hi ha dues
  excepcions al servidor: el servei de l'agent privat de la fase 8 i les eines
  de releases i previews. Totes dues s'instal·len manualment des d'un commit
  revisat de `main`, segons el
  [runbook d'operacions](docs/operations/README.md), i sempre amb
  l'aprovació explícita de la persona mantenidora. L'agent de Telegram no
  desplega ni s'actualitza mai a si mateix.
- Les actualitzacions de dependències i les correccions de seguretat han de
  preservar la integritat del lockfile i superar les comprovacions pertinents.
- Consulta els [límits dels assistents](docs/ai-assistant.md) per distingir el xat
  públic, el servei privat i els agents locals.
