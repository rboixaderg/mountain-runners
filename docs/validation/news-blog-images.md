# Validació d'imatges editorials, NB-04

El 2 d'octubre de 2026 s'ha afegit `sharp` 0.35.5, amb autorització explícita de
la persona mantenidora i pin al lockfile. La transformació és local al build,
sense servei extern, telemetria ni canvis al servidor. La dependència té llicència
Apache-2.0 i utilitza libvips. Els originals continuen subjectes als seus drets.

`node --test tools/preview/editorial-resources.test.mjs` passa. La prova executa
quatre builds reals i compara paths i SHA-256. Verifica originals i WebP de 480
i 1200 píxels, exclusió d'imatges d'esborrany en públic, preservació de recursos
compartits i absència de residus quan un build públic segueix un preview.

Les transformacions només es programen després de seleccionar variants
completes. No hi ha glob d'assets ni imports Vite de cobertes editorials. Els
paths passen per la validació local existent, inclòs el rebuig de symlinks.
Sharp corregeix l'orientació, evita ampliar i elimina metadades per defecte.

La prova anterior a aquesta entrega que documentava l'absència de `sharp` és
històrica. El render i els enllaços a derivades es validen amb NB-05 i NB-07.
