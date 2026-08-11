# Referències De Disseny (Retirades)

## Estat

Les pantalles Stitch que van servir de referència de composició durant les
fases 2, 3 i 4 ja estan implementades a la web. El disseny no es torna a
derivar de Stitch: qualsevol iteració futura parteix de la implementació
existent i de `DESIGN.md`, que continua sent l'única font de direcció visual.

Aquest document es conserva com a registre històric, sense validesa com a
referència activa d'implementació.

## Registre

- Projecte Stitch utilitzat durant el desenvolupament inicial:
  [Redisseny Mountain Runners Berga](https://stitch.withgoogle.com/projects/6497516597197145737)
  (`6497516597197145737`), amb el sistema visual
  `assets/15875972618739072807`.
- Les sis pantalles aprovades (portada, hub i detall d'esdeveniment, Qui som,
  Socis i detall d'escola) es van registrar a les seves fases corresponents i es
  van incorporar al redisseny de la fase 4 (T4.4, PR #49). El grau de validació
  final es registra a `docs/validation/phase-4-design-review.md`.

## Regla A Partir D'Ara

- `DESIGN.md` és la font de veritat de la direcció visual i preval sobre
  qualsevol pantalla, maqueta o sistema extern.
- Una modificació de disseny s'especifica sobre la implementació actual (i la
  seva evidència visual), no sobre una maqueta externa.
- Una instància de Stitch amb una direcció visual diferent de `DESIGN.md` no
  pot substituir-lo sense una decisió explícita registrada.
