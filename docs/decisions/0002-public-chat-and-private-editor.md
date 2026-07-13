# ADR 0002: Xat Públic I Assistent Editorial Privat Separats

## Estat

Acceptada.

## Decisió

Mantenir el xat públic i l'assistent editorial com a sistemes separats. El xat
públic és un servei Hono de només lectura sobre contingut publicat. L'assistent
editorial utilitza un flux privat i restringit de branques i pull requests.

## Raonament

Separar l'accés de lectura de la modificació de contingut limita l'abast dels
errors, protegeix el contingut no publicat i preserva la revisió humana abans de
publicar.
