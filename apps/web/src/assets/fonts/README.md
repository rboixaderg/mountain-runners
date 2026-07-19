# Tipografies Locals

La web serveix variants variables WOFF2 llatines d'Inter i Oswald des d'aquest
directori. No es carreguen tipografies des de Google Fonts ni cap altre CDN en
temps d'execució.

| Família | Fitxer               | Pesos    | Origen              | Llicència                                    |
| ------- | -------------------- | -------- | ------------------- | -------------------------------------------- |
| Inter   | `inter-latin.woff2`  | 400, 700 | Google Fonts, `v20` | SIL Open Font License 1.1 (`OFL-Inter.txt`)  |
| Oswald  | `oswald-latin.woff2` | 400, 700 | Google Fonts, `v57` | SIL Open Font License 1.1 (`OFL-Oswald.txt`) |

Les variants llatines cobreixen el contingut actual en català, castellà i
anglès. Només Oswald es precarrega perquè és la tipografia dels títols i de la
identitat visible a l'inici de la càrrega; Inter usa `font-display: swap`.
