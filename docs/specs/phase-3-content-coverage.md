# Especificació De La Fase 3: Cobertura De Contingut

## Estat

Preparada per desglossar-se en entregues implementables quan les fases 1 i 2
estiguin fusionades a `main`.

## Objectiu

Completar les àrees públiques de Mountain Runners que queden fora del vertical
slice: Qui som, Socis, Escoles, Documents i Contacte. Les pàgines han de ser
accessibles, coherents amb el shell i el sistema visual de la fase 2, i basades
en dades editorials validades quan aquestes puguin canviar sense modificar el
codi.

La fase publica només contingut català. Manté preparat el model multiidioma,
però no publica rutes castellanes o angleses fins que cada variant sigui
completa i revisada.

## Límits I Decisions Confirmades

- La fase comença només amb la fase 2 tancada, validada i fusionada.
- Tot contingut real passa per inventari, revisió i aprovació abans d'entrar a
  una col·lecció pública amb `published: true`.
- L'alta de socis, la federació, el contacte i el butlletí només dirigeixen a
  serveis externs aprovats. No s'afegeixen formularis, enviament de correu,
  cookies, analítica ni backend.
- Qui som i Socis tenen esquemes editorials específics i petits; no s'introdueix
  cap constructor genèric de pàgines o blocs.
- La junta pot publicar nom, cognoms, rol i foto opcional. La foto només es
  versiona si és apta per a publicació i té l'autorització necessària.
- `DESIGN.md` és l'única font de direcció visual. No calen pantalles Stitch
  noves per començar aquesta fase.
- Es poden publicar un o dos recursos placeholder locals per consolidar la
  composició de galeries i vídeo. Han de ser propis, genèrics, amb atribució si
  escau, i comunicar clarament que el contingut definitiu encara no està
  disponible. Un placeholder de vídeo no és un reproductor, no incorpora una
  URL fictícia i no simula que existeixi un vídeo publicat.

### Límits De Codi I Contingut

L'ADR 0004 continua governant la separació:

- El codi defineix rutes, plantilles, navegació, ordre de les seccions,
  agrupacions i comportament responsive.
- El YAML restringit conté les dades editorials o operatives que canviaran:
  missatges, noms i rols de junta, textos de pàgina, recursos, dades de
  contacte, estats, documents, preus, avantatges i URL externes.
- No es crea una configuració YAML global del lloc, un CMS, una base de dades ni
  una API.
- Els continguts no publicats, incomplets, no aprovats o les seves imatges no
  poden generar rutes, enllaços, metadades ni fitxers de sortida.

## Resultats Esperats

- Ruta Qui som amb missatge de presidència, junta, història i accés als estatuts
  disponibles.
- Ruta Socis amb alta, federació, avantatges i directori de col·laboradors.
- Hub d'Escoles i detalls funcionals per a les escoles publicades de Trail,
  Skimo, BTT i Trial, quan existeixi contingut aprovat per a cadascuna.
- Directori de Documents amb recursos locals i externs, data, idioma, tipus,
  atribució i disponibilitat expressats de manera útil.
- Galeries i vídeos amb imatges, atribucions i estats de disponibilitat
  accessibles; els placeholders aprovats permeten exercir la composició sense
  inventar contingut editorial.
- Ruta Contacte, dades pràctiques de peu, accions externes de butlletí i
  enllaços legals que només apareixen quan la destinació és real.
- Navegació principal actualitzada perquè Qui som, Socis i Escoles deixin de ser
  `Properament`; els enllaços secundaris es publiquen només si la ruta o recurs
  existeix.
- Cobertura automatitzada de les rutes i estats nous, integrada a les ordres de
  qualitat establertes a la fase 2.

## Dependències I Ordre D'Inici

La implementació requereix a `main`:

- les quatre entregues de la fase 1, incloent-hi les col·leccions `schools`,
  `events`, `entities` i `documents`, la publicació filtrada i el nucli de
  validació editorial;
- el contracte de segments de ruta localitzats, el shell, el selector d'idioma,
  les metadades i les comprovacions de qualitat de la fase 2.

Abans d'editar contingut publicat, cada candidat ha de tenir estat
`Candidat`, `Revisat`, `Aprovat` o `Descartat` en un inventari públic sanejat.
L'inventari no copia material heretat ni dades personals no aprovades. Només
`Aprovat` pot passar a YAML publicat o a recursos versionats.

Cada tasca d'implementació es desenvolupa en un worktree i branca de vida curta
des de l'últim `main`. El worktree principal només s'utilitza per mantenir aquest
seguiment i la documentació de planificació.

## Tasques, Entregues I Seguiment

No es fixa anticipadament un nombre de pull requests. Cada unitat s'implementa
en una PR cohesionada, revisable i validable de manera independent.

| Unitat                               | Estat   | Dependències                      | Resultat verificable                                          | PR  |
| ------------------------------------ | ------- | --------------------------------- | ------------------------------------------------------------- | --- |
| T3.1 Inventari i aprovació editorial | Pendent | Cap codi nou                      | Contingut i recursos candidats sanejats i classificats        | -   |
| T3.2 Contractes de contingut         | Pendent | Fases 1 i 2                       | Esquemes singulars, publicació i referències validades        | -   |
| T3.3 Qui som                         | Pendent | T3.2 i contingut aprovat          | Ruta institucional, junta i estatuts accessibles              | -   |
| T3.4 Socis                           | Pendent | T3.2 i entitats aprovades         | Alta, federació, avantatges i col·laboradors amb estats reals | -   |
| T3.5 Hub d'Escoles                   | Pendent | T3.1, shell i escoles aprovades   | Llistat estable d'escoles publicades                          | -   |
| T3.6 Detall d'Escola                 | Pendent | T3.5 i recursos aprovats          | Informació pràctica, galeria, vídeo i inscripció              | -   |
| T3.7 Documents, Contacte i peu       | Pendent | T3.2, documents i canals aprovats | Recursos, legals i canals externs amb disponibilitat clara    | -   |
| T3.8 Qualitat de cobertura           | Pendent | T3.3 a T3.7                       | Tests, a11y, SEO i rendiment integrats a CI                   | -   |

Els estats permesos són `Pendent`, `En curs`, `Bloquejada` i `Completada`.
Una unitat només passa a `Completada` després de tenir una PR revisada, validada i
fusionada. Cada draft PR inclou l'enllaç a aquesta especificació, l'abast,
criteris d'acceptació, comprovacions, evidència de contingut o visual quan
pertoqui, i l'impacte d'accessibilitat, SEO, rendiment, seguretat i llicències.

### T3.1: Inventari I Aprovació Editorial

**Abast:** classificar textos, dades, fotos, documents, logos i URLs. **Depèn de:**
cap codi. **Resultat:** només material `Aprovat` alimenta contingut publicat.
**Comprovació:** vigència, drets, atribució, consentiment i privacitat. **PR:**
pot agrupar-se amb T3.2 només sense dades reals no aprovades.

### T3.2: Contractes De Contingut

**Abast:** esquemes `about`, `membership` i `contact`, publicació i referències.
**Depèn de:** fases 1 i 2. **Resultat:** dades canviants validades sense
constructor genèric. **Comprovació:** Vitest de schemas, idiomes, URL, recursos i
referències. **PR:** pròpia; no implementa plantilles.

### T3.3: Qui Som

**Abast:** presidència, junta, història i estatuts. **Depèn de:** T3.2 i
contingut aprovat. **Resultat:** informació institucional accessible.
**Comprovació:** landmarks, ordre, documents disponibles i perfils publicats.
**PR:** pròpia; no incorpora Socis ni Contacte.

### T3.4: Socis

**Abast:** alta, federació, avantatges i col·laboradors. **Depèn de:** T3.2 i
entitats aprovades. **Resultat:** accions externes i estats clars.
**Comprovació:** URL requerida i exclusió d'entitats no publicades. **PR:**
pròpia; no afegeix formularis.

### T3.5: Hub D'Escoles

**Abast:** llistat publicat i ordre editorial estable. **Depèn de:** T3.1, shell
i escoles aprovades. **Resultat:** `/ca/escoles/` deriva de `schools`.
**Comprovació:** ordenació, enllaços i contingut absent. **PR:** pròpia; no
modifica el detall.

### T3.6: Detall D'Escola

**Abast:** seccions pràctiques, galeria, vídeo i inscripció. **Depèn de:** T3.5
i recursos aprovats. **Resultat:** detall usable des de 320 CSS px.
**Comprovació:** accions, estats, alternatives d'imatge i cap reproductor fals.
**PR:** pròpia; no introdueix carrusel ni JavaScript essencial.

### T3.7: Documents, Contacte I Peu

**Abast:** directori, contacte institucional, butlletí extern i legals.
**Depèn de:** T3.2, documents i canals aprovats. **Resultat:** recursos i canals
amb disponibilitat explícita. **Comprovació:** URL, tipus, idioma, atribució i
absència d'`href` buit. **PR:** pròpia; no crea serveis ni formularis.

### T3.8: Qualitat De Cobertura

**Abast:** E2E, axe, Lighthouse, SEO i pressupostos. **Depèn de:** T3.3 a T3.7.
**Resultat:** controls obligatoris a CI. **Comprovació:** `pnpm validate`,
navegadors acordats i rutes representatives. **PR:** pròpia; no substitueix
l'auditoria manual d'accessibilitat.

## Rutes I Navegació

Els segments canònics localitzats ja definits a la fase 2 governen aquestes
rutes. Per al català, la fase ha de publicar, quan el contingut és disponible:

| Ruta                  | Responsabilitat                                    |
| --------------------- | -------------------------------------------------- |
| `/ca/qui-som/`        | Identitat, presidència, junta, història i estatuts |
| `/ca/socis/`          | Alta, federació, avantatges i col·laboradors       |
| `/ca/escoles/`        | Hub de programes o escoles publicades              |
| `/ca/escoles/{slug}/` | Detall de cada escola publicada                    |
| `/ca/documents/`      | Directori de documents i recursos disponibles      |
| `/ca/contacte/`       | Contacte, seu, horaris, butlletí i enllaços legals |

El codi centralitza les rutes, canonical, `hreflang`, sitemap, navegació i peu.
Cap slug, URL ni segment es concatena directament en un component. Les futures
variants `es` i `en` utilitzaran el mateix contracte de rutes localitzades i
només existiran si totes les dades renderitzades de la variant estan completes.

La navegació principal continua plana: Qui som, Socis, Escoles i Esdeveniments.
El peu incorpora Contacte i Documents quan les rutes estiguin publicades. Els
enllaços legals només es renderitzen si apunten a un document disponible o a una
URL externa validada.

## Contractes Editorials

### Esquemes Específics

La fase afegeix tres entrades editorials singulars, cadascuna amb esquema Zod
estricte, loader YAML restringit, identificador estable fix i validació de
publicació. No són una col·lecció genèrica de pàgines:

| Entrada      | Identificador únic | Camps canviants principals                                                   |
| ------------ | ------------------ | ---------------------------------------------------------------------------- |
| `about`      | `association`      | Missatge de presidència, junta, història i identificadors de documents       |
| `membership` | `membership`       | Alta, federació, text pràctic i accions externes amb estat explícit          |
| `contact`    | `contact`          | Correu, telèfon, seu, horaris, butlletí i identificadors de documents legals |

Cada entrada inclou `published` i els seus camps traduïbles segueixen el
contracte existent: `ca` obligatori, `es` i `en` opcionals, sense fallback en
rutes públiques. Els esquemes reutilitzen les primitives segures de Markdown,
recursos locals, imatges, URL HTTPS i, exclusivament en les dades de contacte,
URL `mailto:` i `tel:` validades.

### Qui Som

L'entrada `about` conté:

- missatge de presidència en Markdown restringit i, opcionalment, el nom de la
  persona que el signa;
- llista ordenada de membres de la junta amb nom, cognoms, rol i imatge opcional;
- relat d'història en Markdown restringit;
- identificadors de documents publicats per als estatuts i altres documents
  institucionals que es vulguin destacar.

No s'hi modelen adreces, telèfons, correus, biografies, xarxes socials ni dades
de contacte personals de membres de la junta. Un perfil sense foto es presenta
com a text, sense un retrat fictici.

### Socis I Col·laboradors

L'entrada `membership` conté seccions fixes per a alta i federació, amb text,
estat d'acció i URL externa opcional. Els estats són explícits: `available`,
`coming-soon`, `temporarily-unavailable` o `unavailable`.

- Una acció `available` requereix URL HTTPS traduïble i mostra un enllaç
  descriptiu.
- Una acció no disponible mostra una explicació útil, però no un botó desactivat,
  `href` buit ni `#`.
- Els avantatges i col·laboradors es deriven de les `entities` publicades amb
  `membershipBenefit`; no es duplicen dins de l'entrada de Socis.
- El directori pot incloure la web de cada entitat només si està validada i
  publicada.

### Contacte, Butlletí I Peu

L'entrada `contact` conté exclusivament dades institucionals aprovades: correu,
telèfon, adreça o indicacions de seu, horaris, enllaç de butlletí i documents
legals. Correu i telèfon són opcionals i s'ometen si no hi ha dada definitiva.

El butlletí és una acció externa amb el mateix estat explícit que Socis. No es
recullen dades al web. Si falta el destí, s'explica la indisponibilitat sense
simular un camp de formulari ni una subscripció activa.

### Escoles

La fase reutilitza i no duplica el contracte `schools` de la fase 1:

- el hub deriva les entrades de les escoles publicades;
- el detall prioritza resum, descripció, adequació, calendari, lloc, preus,
  galeria, vídeo i inscripció;
- Trail, Skimo, BTT i Trial són contingut editorial, no quatre plantilles ni
  rutes escrites a mà;
- una escola sense URL d'inscripció o amb inscripció no disponible manté l'estat
  textual sense acció falsa;
- l'ordre del hub és editorialment explícit i estable, validat dins del model o
  derivat d'un criteri documentat, mai de l'ordre dels fitxers.

### Documents I Recursos

El directori reutilitza la col·lecció `documents` i només mostra documents
publicats. Els agrupa per tipus o ús pràctic des de codi, sense convertir el
YAML en una configuració de layout.

- `available` mostra l'enllaç al recurs local o extern validat.
- `temporarily-unavailable` i `archived` expliquen l'estat i no creen cap enllaç
  inservible.
- Es mostren data, idioma del recurs, atribució i font quan existeixen.
- Els estatuts de Qui som i els documents legals de Contacte només referencien
  documents publicats i disponibles; una referència invàlida fa fallar la
  validació editorial.

Les galeries reutilitzen les imatges validades de les escoles i altres entrades
que les incorporin. El vídeo es representa com a recurs extern HTTPS aprovat o
com a estat de disponibilitat. No s'incrusta un reproductor de tercers abans que
hi hagi un recurs revisat i una decisió explícita sobre el seu impacte.

## Recursos, Drets I Placeholders

Tota foto, logo, document, vídeo o placeholder entra a l'inventari abans de
versionar-se. Cal registrar-ne origen, autoria, llicència, atribució, revisió de
privacitat i finalitat pública quan correspongui.

Els placeholders publicats compleixen aquestes regles:

- són recursos locals, lleugers i referenciats des de contingut publicat;
- no representen persones, activitats, dates ni serveis inexistents com si fossin
  reals;
- tenen text alternatiu honest, com ara `Imatge de l'escola pendent d'actualitzar`;
- la targeta de vídeo comunica `Vídeo properament` amb text visible i accessible,
  sense control de reproducció;
- es poden substituir posteriorment amb un canvi editorial, sense alterar la
  plantilla;
- no es fan hotlinks, no s'utilitzen fitxers de mostra amb llicència incerta i
  no es copien originals voluminosos al repositori.

Totes les imatges informatives tenen alternativa textual traduïble, dimensions
explícites i variants optimitzades segons el pipeline de la fase 2.

## Disseny, Responsive I Accessibilitat

`DESIGN.md` i els fonaments de la fase 2 governen les noves pantalles. La fase
no afegeix un sistema visual paral·lel ni depèn d'HTML generat per eines de

- Les pàgines són light-first, editorials i llegibles; no es construeixen com una
  seqüència de targetes arrodonides.
- La junta i els col·laboradors tenen una jerarquia institucional i no adopten un
  patró de perfils socials.
- Les dades pràctiques d'Escoles, Socis, Documents i Contacte es poden escanejar
  amb claredat en 320 CSS px.
- Les galeries no requereixen carrusel, modal ni JavaScript per accedir a la
  informació essencial.
- Els estats de disponibilitat combinen text, estructura i, si cal, iconografia
  amb nom accessible; no depenen només del color.
- Els enllaços externs i els recursos descarregables indiquen el seu destí quan
  el context no sigui suficient.
- Teclat, focus visible, skip link, landmarks, ordre de títols, `lang` i
  `prefers-reduced-motion` es mantenen en totes les rutes noves.

## SEO I Indexació

Cada ruta indexable nova aporta títol, descripció, canonical, metadades socials,
`hreflang` de variants realment publicades i entrada al sitemap. Els documents
no creen una pàgina de detall només per generar SEO: el directori és indexable i
els recursos mantenen la seva URL canònica pròpia.

No s'inventen dades estructurades de persones, organitzacions, adreces, horaris,
preus o serveis. Qualsevol ampliació de JSON-LD respecte a la fase 2 requereix
dades públiques suficients, visibles a la pàgina i proves de serialització segura.

## Estratègia De Tests I Qualitat

La fase amplia les ordres de la fase 2, sense introduir eines redundants. Les
proves s'executen amb contingut sintètic o aprovat; no utilitzen cap servei
extern en temps d'execució.

Vitest ha de cobrir com a mínim:

- validació estricta de cada esquema singular, camps obligatoris, estats i
  identificadors fixos;
- exclusió de les entrades singulars no publicades, referències a documents no
  publicats i recursos locals exclusius de la sortida pública;
- completitud transitiva de la traducció, incloent-hi junta, accions, documents,
  imatges i referències;
- estats d'accions de Socis i Butlletí, especialment URL absent o present en
  combinacions invàlides;
- directori d'entitats amb avantatge de soci sense duplicar-les;
- ordre estable del hub d'Escoles;
- disponibilitat de documents, absència d'`href` buit i tractament dels recursos
  externs;
- generació coherent de rutes localitzades, canonical, `hreflang`, sitemap i
  metadades de les plantilles noves.

Playwright i axe han de cobrir en Chromium, Firefox i WebKit, en vista mòbil i
escriptori:

- navegació des del menú principal a Qui som, Socis, Escoles i Esdeveniments;
- accés al hub d'Escoles i a una escola publicada;
- lectura amb teclat de la junta, les accions disponibles i els estats no
  disponibles;
- enllaços de Documents i Contacte, inclosa l'absència de controls falsos;
- selectors d'idioma absents mentre només es publiqui català;
- galeria, imatge placeholder i targeta de vídeo placeholder sense regressions
  d'accessibilitat detectables.

Les rutes representatives de la fase han de mantenir els llindars de Lighthouse,
pressupostos de transferència i comprovacions SEO acordats a la fase 2. La
validació automatitzada no substitueix l'auditoria manual d'accessibilitat que
continua registrada al backlog.

## Seguretat I Privacitat

- No es publiquen dades personals de junta més enllà de nom, cognoms, rol i foto
  opcional explícitament apta per a publicació.
- No s'exposen correus, telèfons, adreces o horaris no confirmats, ni dades de
  contacte personals.
- Les URL, Markdown, imatges, recursos locals i documents reutilitzen els
  validadors de la fase 1.
- No s'incorporen iframes, scripts, reproductors, widgets de butlletí, formularis
  incrustats ni JavaScript de tercers.
- Els enllaços externs no es comproven remotament durant els tests; se'n valida
  l'estructura i se'n revisa la vigència durant l'aprovació editorial.
- Els recursos no publicats, incloent-hi fotografies de junta o documents,
  queden fora del build i dels artefactes de CI.
- No s'afegeixen secrets, serveis de servidor, autenticació ni mecanismes de
  preview.

## Fora D'Abast

- Publicació real en castellà o anglès.
- Formularis propis de contacte, alta, federació o butlletí; enviament de correu
  i integració amb serveis de captació.
- Comptes de soci, pagaments, inscripcions o autenticació.
- Migració automàtica o completa de la web anterior.
- Biografies, dades de contacte o xarxes socials personals de la junta.
- Reproductors de vídeo, iframes i integracions de plataformes de tercers.
- Cerca, filtres, paginació, carrusels, modal de galeria o JavaScript client no
  essencial.
- Analítica, cookies, consentiment o una auditoria manual completa
  d'accessibilitat.
- Previews, Caddy, VPS, desplegament, xat públic o assistent editorial.

## Criteris D'Acceptació

La fase es considera completada quan:

1. Les fases 1 i 2 estan fusionades i totes les unitats d'aquesta fase tenen PR
   revisada, validada i fusionada.
2. Qui som, Socis, Escoles, Documents i Contacte tenen rutes accessibles,
   indexables quan pertoqui i integrades a navegació o peu sense enllaços trencats.
3. El contingut canviant de les noves àrees viu en esquemes editorials específics
   o col·leccions existents, no codificat dins de les plantilles.
4. No s'ha creat un constructor genèric de pàgines, una configuració global YAML
   ni un servei nou.
5. Cada element publicat ha passat per inventari, revisió i aprovació editorial,
   de privacitat i de llicència quan correspongui.
6. La junta només publica nom, cognoms, rol i foto opcional autoritzada; les
   dades personals no aprovades no entren al repositori ni al build.
7. Les accions d'alta, federació i butlletí són externes, tenen estat explícit i
   mai simulen formularis o controls operatius absents.
8. El directori de col·laboradors deriva d'entitats publicades amb avantatge de
   soci i no duplica dades editorials.
9. El hub i detalls d'Escoles deriven exclusivament de la col·lecció `schools`,
   amb ordre estable, estats d'inscripció clars i dades pràctiques accessibles.
10. Els Documents i enllaços legals indiquen disponibilitat, tipus, idioma i
    atribució quan existeixen, sense `href` buit, `#` ni botons desactivats.
11. Les galeries i el vídeo funcionen sense carrusel ni reproductor de tercers;
    els placeholders locals són honestos, accessibles, substituïbles i tenen
    procedència registrada.
12. Només es publica català. Les proves demostren que les futures variants només
    es generaran amb contingut complet i revisat, i el selector roman amagat a
    les pàgines sense alternatives.
13. Les noves rutes mantenen `lang`, landmarks, jerarquia de títols, focus,
    contrast, responsive des de 320 CSS px i estats no dependents només del color.
14. Canonical, `hreflang`, sitemap, robots, metadades socials i qualsevol JSON-LD
    es generen només amb dades públiques vàlides.
15. Vitest, Playwright, axe, Lighthouse, `pnpm validate` i `pnpm build` passen
    localment i a CI amb les versions fixades.
16. No s'han introduït secrets, dades privades, analítica, cookies, formularis,
    scripts de tercers, serveis de servidor ni recursos despublicats a la sortida
    pública.
17. `README.md`, `docs/architecture.md`, `docs/content-model.md`, el roadmap i
    aquesta especificació reflecteixen fidelment l'estat implementat en tancar la
    fase.
