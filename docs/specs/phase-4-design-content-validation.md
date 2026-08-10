# Especificació De La Fase 4: Validació Integral De Disseny I Contingut

## Estat

Preparada per desglossar-se en entregues de validació i correcció quan la fase 3
estigui fusionada a `main`.

## Objectiu

Validar de manera traçable, abans de la fase de publicació, que la web completa
implementada té el disseny, l'estructura, el contingut i els recursos visuals
correctes a cada ruta pública i als seus estats representatius.

La validació contrasta la implementació amb `DESIGN.md`, les especificacions de
les fases 2 i 3, el contingut publicat i els límits dels ADR vigents. Les
discrepàncies es resolen en canvis petits i revisables; la fase no dona per bona
una pàgina només perquè el build o les proves automatitzades passin.

La fase incorpora també la traducció al castellà i a l'anglès del contingut
final aprovat, de manera que totes les variants d'idioma publicades siguin
completes i revisades abans de la fase 5.

## Límits I Decisions Confirmades

- La fase comença només amb les fases 1, 2 i 3 tancades, validades i fusionades.
- `DESIGN.md` continua sent l'única font de direcció visual. La validació no
  introdueix un sistema visual, una biblioteca de components ni pantalles Stitch
  paral·leles.
- La revisió cobreix només allò publicable: les rutes generades, la navegació, el
  peu, els estats disponibles i les variants d'idioma realment publicades.
- El contingut de domini es conserva en YAML restringit i els textos de pàgines
  fixes en recursos de traducció, segons els ADR 0004 i 0005. La validació no
  crea un constructor genèric de pàgines ni un inventari de contingut alternatiu.
- Una imatge, document, logo o vídeo només es valida si té procedència,
  autorització, llicència, atribució i alternativa textual quan correspongui.
  Els recursos no aprovats continuen fora del repositori i del build públic.
- Les correccions no poden ampliar funcionalitats, afegir serveis de tercers,
  formularis, analítica, cookies ni mecanismes de publicació.
- La traducció al castellà i a l'anglès del contingut aprovat és una tasca pròpia
  de la fase (T4.5), sempre sobre el contingut català revisat i corregit. Una
  variant incompleta no genera ruta pública ni fa fallback al català.

## Resultats Esperats

- Matriu de validació que relaciona cada ruta pública i estat representatiu amb
  la comprovació de disseny, estructura, contingut i recurs visual aplicable.
- Revisió visual en mòbil i escriptori de la composició, lectura, jerarquia,
  navegació, imatges i estats d'interacció.
- Revisió editorial de textos, dades pràctiques, enllaços, documents, imatges,
  atribucions i alternatives textuals visibles.
- Discrepàncies classificades, corregides mitjançant pull requests acotades i
  verificades sense deixar defectes publicables pendents.
- Evidència final que separa explícitament la validació manual de les proves
  automatitzades ja existents.
- Variants completes i publicades en castellà i anglès de totes les rutes amb
  contingut català aprovat, oferides pel selector d'idioma.

## Dependències I Ordre D'Inici

La fase requereix a `main` totes les entregues de les fases 1, 2 i 3, incloses
les seves rutes, metadades, controls de qualitat i contingut aprovat.

La validació es prepara a partir del build local o d'una preview de pull request
que contingui el mateix artefacte revisable. Qualsevol canvi descobert es torna a
validar en una branca i pull request pròpies abans d'actualitzar l'evidència. La
fase 5 no comença fins que les discrepàncies publicables d'aquesta fase estiguin
tancades.

## Tasques, Entregues I Seguiment

| Unitat                    | Estat   | Dependències | Resultat verificable | PR  |
| ------------------------- | ------- | ------------ | -------------------- | --- |
| T4.1 Matriu               | Pendent | Fases 1 a 3  | Matriu de cobertura  | -   |
| T4.2 Disseny i estructura | Pendent | T4.1         | Revisió registrada   | -   |
| T4.3 Editorial i recursos | Pendent | T4.1         | Recursos validats    | -   |
| T4.4 Correccions          | Pendent | T4.2 i T4.3  | Correccions tancades | -   |
| T4.5 Traducció            | Pendent | T4.4         | Traducció publicada  | -   |

Els estats permesos són `Pendent`, `En curs`, `Bloquejada` i `Completada`. Una
unitat només passa a `Completada` després de tenir una PR revisada, validada i
fusionada. Cada draft PR enllaça aquesta especificació, identifica les rutes i
els criteris coberts, registra comprovacions i adjunta l'evidència visual o
editorial mínima necessària.

### T4.1: Matriu I Abast De Validació

**Abast:** inventari de rutes, estats, idiomes publicats, vistes mòbil i
escriptori i criteris aplicables. **Exclusió:** no modifica components ni
contingut. **Depèn de:** fases 1 a 3. **Resultat:** cobertura explícita de tota
la superfície pública implementada. **Comprovació:** cap ruta, estat o variant
publicada queda fora de la matriu. **PR:** pròpia; no inclou correccions.

### T4.2: Revisió De Disseny I Estructura

**Abast:** contrast manual de cada ruta amb `DESIGN.md`, la semàntica, la
navegació, el peu, la jerarquia, l'ordre de lectura, responsive i estats visibles.
**Exclusió:** no redefineix la marca ni afegeix funcionalitats. **Depèn de:**
T4.1. **Resultat:** discrepàncies de disseny o estructura documentades amb
evidència reproduïble. **Comprovació:** revisió en mòbil i escriptori, navegació
amb teclat i controls automatitzats pertinents. **PR:** pròpia; les correccions
es desglossen a T4.4.

### T4.3: Revisió Editorial I De Recursos

**Abast:** verificació pàgina a pàgina dels textos, dades pràctiques, estats,
enllaços, documents, imatges, alternatives textuals, atribucions i adequació del
recurs al context. **Exclusió:** no aprova material sense procedència ni exposa
dades personals no autoritzades. **Depèn de:** T4.1. **Resultat:** cada element
visible queda confirmat o registrat com a discrepància. **Comprovació:**
contrast amb el contingut aprovat i validació de destinacions, disponibilitat i
metadades locals. **PR:** pròpia; les correccions es desglossen a T4.4.

### T4.4: Correccions I Tancament

**Abast:** implementar i verificar les correccions sorgides de T4.2 i T4.3,
actualitzant la matriu fins que no hi hagi discrepàncies publicables obertes.
**Exclusió:** no incorpora peticions noves fora del defecte validat; aquestes
tornen al backlog o a una especificació nova. **Depèn de:** T4.2 i T4.3.
**Resultat:** disseny, estructura, contingut i recursos visuals validats abans de
publicar. **Comprovació:** proves afectades, `pnpm validate`, revisió manual de
la regressió i comprovacions d'accessibilitat pertinents. **PR:** una o més PR
petites, una per correcció cohesionada; el tancament només arriba després que
totes estiguin fusionades.

### T4.5: Traducció A Castellà I Anglès

**Abast:** traduir al castellà i a l'anglès els textos de pàgines fixes
(recursos de traducció, ADR 0005) i el contingut de domini publicat (YAML
restringit, ADR 0004), a partir del contingut català revisat i corregit a T4.4.
**Exclusió:** no tradueix contingut no aprovat, ni afegeix fallbacks,
estructures, rutes o funcionalitats noves. **Depèn de:** T4.4. **Resultat:**
totes les rutes públiques amb contingut aprovat tenen variants completes en
castellà i anglès, revisades i oferides pel selector d'idioma. **Comprovació:**
`pnpm validate`, comprovacions de completesa transitiva de la fase 1, revisió
editorial de cada traducció i verificació que cap variant incompleta es publica
ni fa fallback al català. **PR:** pròpia; les correccions de traducció
detectades en la revisió es tanquen en PRs petites dins d'aquesta unitat.

## Cobertura De Validació

La matriu cobreix, per a cada ruta pública implementada i per a cada estat
representatiu disponible:

- rutes, redireccions, navegació principal i secundària, selector d'idioma, peu,
  pàgina 404 i absència d'enllaços a destinacions no publicades;
- estructura semàntica, landmarks, títols, ordre de lectura, accions, estats de
  disponibilitat, focus i navegació amb teclat;
- composició, espaiat, tipografia, color, contrast, ús mesurat del motiu de
  pinzell, imatges i comportament responsive, d'acord amb `DESIGN.md`;
- titulars, textos, dates, preus, inscripcions, dades de contacte, noms,
  documents, enllaços i metadades visibles;
- correspondència de cada imatge, logo, document o vídeo amb el seu context,
  text alternatiu, atribució, disponibilitat i procedència aprovada;
- rutes i estats de contingut de domini, incloent-hi esdeveniments, escoles,
  documents, col·laboradors i recursos absents o temporalment no disponibles.
- completesa i correcció de les traduccions en castellà i anglès: textos de
  pàgines fixes i contingut de domini, sense fallback al català ni variants
  incompletes publicades.

La matriu identifica el dispositiu, navegador quan sigui rellevant, evidència,
resultat, discrepància, PR correctora i estat de resolució. No copia contingut
sensible ni recursos no aprovats: només registra la referència pública o
l'identificador necessari per reproduir la revisió.

## Estratègia De Tests I Qualitat

La validació manual complementa, però no substitueix, les ordres de qualitat de
les fases 1 a 3. Cada correcció executa les proves unitàries, E2E, axe, SEO,
rendiment o build afectats, així com `pnpm validate` quan la modificació ho
requereixi.

La revisió manual es fa com a mínim en vista mòbil i escriptori, amb navegació
per teclat. Comprova rutes representatives i estats de contingut que les proves
automatitzades no poden determinar: fidelitat a la direcció visual, exactitud
editorial, adequació de la imatge i claredat de l'estructura. L'evidència no es
presenta com una declaració completa de conformitat WCAG 2.2 AA.

## Seguretat I Privacitat

- La revisió no introdueix secrets, dades de contacte no confirmades, dades
  personals de tercers ni fitxers d'origen privats al repositori o a les proves.
- Les imatges, documents i recursos externs mantenen les validacions de ruta,
  URL, publicació i llicència definides a les fases anteriors.
- Les discrepàncies es documenten sense publicar material descartat, captures
  amb dades privades ni enllaços que continguin credencials.
- No s'afegeixen integracions remotes, telemetria, cookies, formularis ni scripts
  de tercers per facilitar la validació.

## Fora D'Abast

- Dissenyar o implementar funcionalitats, rutes o models de contingut nous que
  no siguin necessaris per corregir una discrepància validada.
- Aprovació editorial inicial de contingut no inventariat o de recursos sense
  drets, procedència o autorització suficient.
- Traduccions de contingut que no hagi estat revisat ni aprovat en català.
- Una auditoria legal, de llicències o d'accessibilitat completa, o una
  certificació de conformitat WCAG.
- Previews permanents, configuració de Caddy, VPS, desplegament, xat públic o
  assistència editorial.

## Criteris D'Acceptació

La fase es considera completada quan:

1. Les fases 1, 2 i 3 estan fusionades i les cinc unitats tenen les seves PR
   revisades, validades i fusionades.
2. La matriu inclou totes les rutes públiques, estats representatius, variants
   d'idioma publicades, navegació, peu i pàgina 404 implementats.
3. Cada ruta ha estat revisada manualment en mòbil i escriptori respecte a
   `DESIGN.md`, la seva estructura i el seu ordre de lectura.
4. Els textos, dades pràctiques, enllaços, documents, imatges, vídeos i
   atribucions visibles són correctes, disponibles quan es declaren disponibles
   i adequats al seu context públic.
5. Totes les imatges informatives tenen alternativa textual adequada i cap
   recurs sense procedència, llicència o autorització requerida arriba al build.
6. No resten discrepàncies obertes de disseny, estructura, contingut o recursos
   dins de l'abast publicable acordat; les peticions noves s'han tornat al
   backlog o s'han especificat separadament.
7. Les correccions mantenen els límits dels ADR 0004 i 0005, l'accessibilitat,
   la seguretat, la privacitat i les comprovacions de qualitat de les fases
   anteriors.
8. La documentació de validació identifica què s'ha revisat, quina evidència
   manual existeix, quines correccions s'han fusionat i els seus resultats.
9. Totes les rutes públiques amb contingut aprovat tenen variants completes,
   revisades i publicades en castellà i anglès, sense fallback al català ni
   variants incompletes.
