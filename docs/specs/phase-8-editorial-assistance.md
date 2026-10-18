# Especificació De La Fase 8: Assistència Editorial Delegada

## Estat

En preparació. La persona mantenidora autoritza la planificació el 18 d'octubre
de 2026 i confirma aquestes decisions:

- Canal Telegram amb un supergrup privat on el bot escolta diverses persones
  autoritzades.
- Totes les col·leccions editorials dins de l'allowlist inicial.
- El servei s'executa al VPS com a servei separat.
- La fase 8 s'avança per davant de la fase 7 (xat públic), que no n'és
  dependència tècnica ([ADR 0002](../decisions/0002-public-chat-and-private-editor.md)).

La revisió del mateix dia incorpora aquestes decisions:

- La persona que llança una tasca delega en un agent amb permisos d'escriptura,
  creació de pull requests i comentaris. La delegació és l'autorització de la
  tasca; l'agent no pot fusionar, desplegar ni publicar.
- La validació és la CI de la pull request i, per a la revisió visual, la
  preview. No hi ha una validació local prèvia obligatòria.
- Les imatges s'incorporen des del xat per actualitzar qualsevol part de la web
  que ja mostri una imatge.
- Les traduccions són completes en `ca`, `es` i `en`.
- El model surt de la subscripció OpenCode Go. La subscripció és el límit
  d'ús; no es configura cap pressupost addicional.
- El harness és pi; T8.2 fixa el runtime concret, amb `@earendil-works/pi-durable`
  com a candidat preferit.
- Les imatges s'accepten fins a 10 MB d'entrada i 4.000 píxels de costat llarg.
- Es crea un compte de GitHub dedicat de `mountain-runners`, col·laborador del
  repositori, per a les accions del pont. La persona mantenidora revisa i
  aprova les seves pull requests.

Aquesta especificació encara no autoritza cap implementació: cap unitat passa a
`En curs` fins que la PR de l'especificació es revisi i fusioni.

## Objectiu

Oferir assistència conversacional privada per preparar canvis de contingut de la
web —des del canal autoritzat fins a la pull request revisable i la preview—,
amb un agent delegat que treballa en un entorn aïllat, amb traça d'auditoria i
revocació immediata de l'accés.

## Límits I Decisions Confirmades

- L'assistència editorial i el xat públic resten sistemes separats
  ([ADR 0002](../decisions/0002-public-chat-and-private-editor.md)): no
  comparteixen servei, índex ni credencials.
- El flux permès és el de [`docs/ai-assistant.md`](../ai-assistant.md): crear una
  branca, editar contingut autoritzat, obrir una pull request i retornar una
  preview. Mai fusionar, desplegar, publicar ni accedir a secrets
  ([ADR 0003](../decisions/0003-agent-workflow-and-security.md)).
- Canal: supergrup privat de Telegram amb el bot com a membre. La pertinença al
  grup no és autorització: les identitats s'autoritzen amb una llista explícita
  d'IDs d'usuari de Telegram i la revocació en retira l'accés de manera
  immediata.
- Delegació: llançar una tasca des del canal és l'acte d'autorització de la
  persona delegant. El compte dedicat de `mountain-runners` és col·laborador del
  repositori i pot comentar `/preview`, cosa que el flux de la fase 6 accepta.
  La delegació no inclou fusionar, desplegar ni publicar.
- Atribució: les pull requests queden signades pel compte dedicat de
  `mountain-runners`; la persona mantenidora les pot revisar i aprovar, i cap
  autor pot aprovar la seva pròpia pull request. La provinença de la tasca la
  registra el pont i un identificador de tasca a la descripció de la pull
  request, sense IDs de Telegram ni dades personals. Cada missatge de Telegram
  conserva l'autor real a l'auditoria del pont; el compte de GitHub només
  identifica l'agent.
- El pont (el procés del host) és l'únic component amb credencials de GitHub i
  l'únic que fa push, obre la pull request i comenta `/preview` amb la clau de
  desplegament d'escriptura del compte dedicat i el seu PAT. El model i les
  eines que se li ofereixen no reben cap credencial de GitHub ni de producció.
- Cap credencial del pont no ha de permetre fusionar. Com que un PAT amb
  `contents: write` pot fusionar per API, el compte dedicat fa servir una clau
  de desplegament d'escriptura per al push i un PAT sense `contents: write` per
  obrir les pull requests i comentar. La protecció de branca continua sent la
  barrera final.
- El harness s'executa aïllat, amb un usuari o contenidor propi i només el
  worktree de la tasca com a escriptura. No té accés a releases, configuració de
  Caddy, estat ACME, logs de producció ni secrets de producció.
- La validació és la CI de la pull request (`pnpm check` i `pnpm test:e2e`). El
  preview serveix per validar l'aspecte. Una CI vermella no activa cap preview.
- Allowlist de contingut inicial: el YAML de les col·leccions editorials de
  `apps/web/src/content/` (`schools`, `events`, `entities`, `documents`,
  `external-actions`, `contact` i `posts`) i els recursos d'imatge i PDF que
  aquestes referencien o que el build importa. En queda exclosa tota la resta:
  components, estils, rutes, configuració d'Astro, catàlegs de missatges,
  esquemes, scripts, navegació i tipografies.
- El nou contingut es prepara amb `published: false` seguint la
  [guia editorial](../editorial/guide.md); cap petició conversacional autoritza
  marcar contingut com a publicat.
- Les traduccions es lliuren completes en `ca`, `es` i `en`; no s'accepta cap
  variant parcial ni un fallback al català.
- Les imatges entren només com a adjunts de Telegram, amb validació de tipus,
  mida i dimensions, eliminació de metadades EXIF i respecte al pressupost de
  build. No s'ingereixen URLs remotes.
- L'entrada del canal és no fiable: cap missatge pot ampliar l'allowlist,
  executar res fora del sandbox, obtenir credencials de GitHub ni sortir del
  worktree.
- Cada canvi és atribuïble a una tasca, una branca, un diff i una pull request;
  Git i el registre d'auditoria en conserven la traça.

## Resultats Esperats

- Una persona autoritzada pot llançar una tasca editorial en conversa i rebre la
  branca, la pull request, el resultat de la CI i l'URL de la preview activada.
- Una identitat no autoritzada no rep cap acció útil del servei.
- Les edicions i les imatges queden restringides als camins autoritzats;
  qualsevol altre camí o ordre es rebutja abans de fer push i amb una explicació.
- Una CI vermella no activa cap preview; l'assistència comunica el job que falla
  i pot continuar treballant a la mateixa branca.
- Totes les accions queden registrades amb identitat, tasca, model, branca,
  pull request i resultat, i l'accés d'una identitat es pot revocar de manera
  efectiva.
- El servei es pot aturar sense afectar la web, la producció ni el sistema de
  previews.

## Dependències I Ordre D'Inici

La fase 8 s'avança per davant de la fase 7 per decisió de la persona
mantenidora; el xat públic no és dependència tècnica. La fase depèn de:

- La fase 5 completada: VPS operatiu amb les convencions de `tools/server/`.
- La fase 6 completada: previews operatives amb petició explícita i publicador
  de confiança des de `main`.
- El flux editorial de notícies i blog fusionat ([PR
  #140](https://github.com/rboixaderg/mountain-runners/pull/140)): col·lecció
  `posts`, guia, plantilles i skill.

T8.1 fixa requisits, identitats, delegació i model d'amenaces. T8.2 decideix el
pont, la configuració i el pin de pi i del runtime durador, les credencials,
l'aïllament i el model, i escriu l'ADR si canvia una frontera acceptada. T8.3 implementa el pont, el perfil editorial,
l'allowlist i la ingesta d'imatges. T8.4 afegeix el push, la pull request, la CI
i la petició de preview. T8.5 afegeix l'auditoria, la revocació i l'aturada
d'emergència. T8.6 valida el conjunt i tanca el runbook.

Cada tasca s'implementa en un worktree i una branca propis des de l'últim
`main`. L'alta del bot, el supergrup, la clau de desplegament, el PAT, la clau
del model o qualsevol secret requereix aprovació explícita de la persona
mantenidora.

## Tasques, Entregues I Seguiment

| Unitat                                           | Estat   | Dependències | Resultat verificable                         | PR  |
| ------------------------------------------------ | ------- | ------------ | -------------------------------------------- | --- |
| T8.1 Requisits, identitats, delegació i amenaces | Pendent | Fases 5 i 6  | Requisits i riscs aprovats                   | -   |
| T8.2 Decisió de pont, runtime, credencials i ADR | Pendent | T8.1         | Arquitectura mínima i model decidits         | -   |
| T8.3 Pont, perfil editorial, allowlist i imatges | Pendent | T8.2         | Tasca delegada amb diff restringit i validat | -   |
| T8.4 Push, pull request, CI i preview            | Pendent | T8.3         | PR oberta, CI verda i preview retornada      | -   |
| T8.5 Auditoria, revocació i aturada              | Pendent | T8.3         | Traça completa i revocació efectiva          | -   |
| T8.6 Validació integral i runbook                | Pendent | T8.4, T8.5   | Sistema operable amb responsables            | -   |

### T8.1: Requisits, Identitats, Delegació I Amenaces

**Abast:** definir qui pot llançar tasques i amb quin volum; l'estructura del
supergrup privat i el paper del bot; l'autorització d'identitats, la delegació i
el cicle de revocació; el model d'amenaces complet (compromís del bot, del
compte de Telegram, del pont, del harness, del PAT, de la clau del model i de
la subscripció; prompt injection des del canal i des del contingut; abús);
què ha de registrar l'auditoria i qui la consulta; la política d'imatges
(drets, metadades, límits); i els límits d'ús que la subscripció no cobreix
(concurrència, tasques per identitat i per dia).
**Exclusió:** no crea el bot, el supergrup ni cap compte o clau. **Depèn de:**
fases 5 i 6. **Resultat:** requisits observables, alternatives i riscs sense
decisions implícites. **Comprovació:** revisió de seguretat, privacitat,
operació i abús. **PR:** pròpia.

### T8.2: Decisió De Pont, Runtime, Credencials I ADR

**Abast:** triar la mínima solució que compleix T8.1: forma del pont (Telegram
per long polling, estat de tasques i auditoria, accés a GitHub), configuració i
pin de pi (perfil versionat, skills del repositori,
allowlist d'eines sense shell ni xarxa, guard d'edició, sessió per tasca i
esdeveniments observables), mètode d'aïllament (contenidor o unitat systemd
endurida), runtime pinjat, credencials necessàries i el seu emmagatzematge i
rotació (inclosa la separació entre el push i les operacions d'API perquè cap
credencial pugui fusionar), ubicació de la llista d'identitats i del registre
d'auditoria, i el model triat amb una avaluació reproduïble. Escriure l'ADR,
com a mínim, per a la delegació d'edició i per a la petició de preview amb la
identitat de l'agent, i actualitzar `docs/ai-assistant.md` amb el flux de
delegació i el gate de CI.
**Exclusió:** no implementa el pont ni el perfil de pi ni crea credencials.
**Depèn de:** T8.1. **Resultat:** decisió aprovada, amb cost, privacitat,
reversió i model justificats, i ADR. **Comprovació:** revisió de permisos mínims
del PAT i de la clau de desplegament, separació de credencials entre pont i
harness, proves de rotació i revocació, i cap dependència no justificada. **PR:** pròpia.

T8.2 inclou una avaluació acotada de construir contra reutilitzar, amb prova
real de les eines candidates que ja cobreixen el transport, les sessions, el
provider i l'aïllament. El primer candidat és el runtime durador oficial del
mateix pi, `@earendil-works/pi-durable`, amb el gateway de tercers
`pi-durable-telegram` (`smixs/pi-durable-telegram`, v0.1.x) com a base o bé amb
un canal propi sobre les seves llibreries exportades: sessions duradores,
represa després d'una caiguda, una conversa per tasca amb `cwd` propi, guard de
crides d'eina i progrés observable. El gateway
fa una conversa per xat; la correspondència tema de Telegram → conversa és una
extensió petita i localitzada, que es proposa a l'upstream i, si no, es manté
com un fork mínim. Com que l'API de pi-durable és experimental, la versió es
fixa i la integració s'aïlla darrere d'un adaptador propi. Els altres candidats són Hermes Agent amb el seu gateway de
Telegram, topics per sessió, allowlist d'usuaris i el provider OpenCode Go;
OpenClaw amb el backend ACP i Pi ACP; i les alternatives pi-natives
`pi-gateway` i `pi-agent-telegram`. La comparació manté pi com a harness; si cap
opció que el conserva és viable, l'ADR pot proposar un altre harness, i llavors
les alternatives madures són `opencode-telegram-bot` i
`opencode-telegram-bridge`. L'ADR registra la decisió,
el pin, la llicència, l'abast dels permisos, la configuració de memòria i
aprenentatge autònom, i les proves de seguretat. La part editorial (worktree,
guard, format, push, pull request, CI, preview i auditoria) és responsabilitat
del projecte encara que el transport es reutilitzi.

L'avaluació de models és un conjunt fix de tasques representatives (redactar una
notícia amb fets donats i traduccions completes, actualitzar un camp sense tocar
la resta, incorporar una imatge amb text alternatiu en tres idiomes, rebutjar
una edició fora de l'allowlist, preguntar quan falten fets i produir YAML
conforme). Es puntua per superació o fallada; s'escull el model que superi totes
les tasques amb menys reintents i menys consum dins la subscripció, i es
registra el resultat.

### T8.3: Pont, Perfil Editorial, Allowlist I Imatges

**Abast:** implementar el pont que escolta el supergrup, verifica la identitat,
deduplica els missatges i crea una tasca amb sessió i worktree propis des de
l'últim `main`; el perfil editorial versionat que carrega la guia, les
plantilles i les skills; el guard que bloqueja edicions fora de l'allowlist i el
guard de diff que valida el conjunt del canvi abans de lliurar-lo a T8.4; la
ingesta d'imatges de Telegram amb validació i eliminació de metadades; la
formació del YAML canviat abans del guard; i el rebuig explicat de camins,
ordres i sol·licituds fora del contracte. **Exclusió:** no fa push, no obre pull requests ni demana
previews (T8.4); el harness no rep cap credencial de GitHub, fusió,
desplegament o producció. **Depèn de:** T8.2. **Resultat:** una tasca delegada
produeix un diff restringit i local, sense branca remota. **Comprovació:** proves
unitàries d'identitats, allowlist i imatges; intents d'edició fora de
l'allowlist bloquejats pel guard i pel diff; `pnpm check` verd. **PR:** pròpia.

### T8.4: Push, Pull Request, CI I Preview

**Abast:** fer push de la branca validada pel guard, obrir la pull request amb
títol de Conventional Commits i descripció en català, esperar la CI, retornar el
resultat a la conversa i, només amb CI verda, comentar `/preview` amb la
identitat delegada; després llegir el comentari del publicador de confiança i
retornar l'URL i el SHA. **Exclusió:** no fusiona, no desplega, no publica i no
pot autoritzar res més enllà de la delegació rebuda; l'activació de la preview
continua passant pel publicador de confiança de la fase 6. **Depèn de:** T8.3.
**Resultat:** la persona autoritzada rep la pull request, el resultat de la CI i
la preview verificables des de la conversa. **Comprovació:** cap preview amb CI
vermella; cap URL construïda per l'assistència; URL i SHA del comentari del
publicador; idempotència en reexecucions i missatges duplicats. **PR:** pròpia.

### T8.5: Auditoria, Revocació I Aturada

**Abast:** registrar cada tasca (identitat, ordre, model, sessió, branca,
commits, pull request, resultat de la CI, preview, resultat i moment) al
registre d'auditoria; implementar la consulta de la traça per identitat, tasca i
període; netejar worktrees i adjunts en tancar la tasca; la revocació
d'identitats (retirada de la llista, del supergrup i, si escau, del PAT i de la
clau de desplegament) com a efectiva i immediata; i l'aturada d'emergència del
servei i del bot. **Exclusió:** el registre només desa metadades i el text de
la tasca truncat, i no esborra les sessions duradores de pi; no amplia la llista
d'identitats des del canal. **Depèn de:** T8.3. **Resultat:** traça completa de
l'activitat i revocació i aturada provades en directe. **Comprovació:** prova de
revocació i aturada en temps real, revisió de minimització del registre i
neteja de worktrees. **PR:** pròpia.

### T8.6: Validació Integral I Runbook

**Abast:** provar el recorregut complet de la conversa a la pull request amb CI
verda i preview activada, inclosa una imatge; els casos negatius de T8.3 a
T8.5; l'aturada, el reinici i la degradació del servei; i actualitzar el runbook
i la documentació de desplegament i de `tools/server/` amb operació, aturada,
rotació de credencials, revocació, còpia i restauració del registre i
responsabilitats. **Exclusió:** no converteix l'assistència en via de
desplegament ni en staging de producció. **Depèn de:** T8.4 i T8.5.
**Resultat:** sistema operable amb responsables acceptats. **Comprovació:**
suite de proves del servei, smoke de la conversa real, `pnpm validate` sobre el
canvi i revisió de seguretat final. **PR:** pròpia i darrera de la fase.

## Requisits Específics

### Canal, Identitats I Delegació

- Supergrup privat de Telegram, d'invitació, amb el bot com a membre i el
  privacy mode desactivat. El pont fa long polling: no exposa cap port, webhook
  ni domini nou.
- Només es processen els missatges adreçats al bot de manera explícita
  (resposta, menció o una ordre de tasca). La resta de missatges del grup
  s'ignoren sense enviar-se al model ni al registre.
- No hi ha cap confirmació intermèdia: llançar la tasca és l'autorització;
  l'agent treballa i obre la pull request directament.
- Si el bot ha de crear els temes, és administrador del grup amb
  `can_manage_topics`; si no, els crea una persona autoritzada.
- Autorització per llista explícita d'IDs d'usuari de Telegram. La pertinença al
  grup no autoritza cap acció.
- Cada tasca registra la identitat delegant. Les respostes posteriors sobre la
  mateixa tasca continuen la mateixa sessió, branca i pull request.
- Cada tasca té un fil propi al supergrup: un tema del fòrum o una cadena de
  respostes. Un tema nou crea una tasca nova; una resposta dins del tema
  continua la mateixa tasca. El pont persisteix la correspondència entre el fil
  de Telegram, la tasca, la conversa duradora de pi, la branca i la pull
  request, i la recupera després d'un reinici. Cada conversa té el seu propi
  worktree, branca, toolset i guard.
- Límit per identitat: una tasca activa alhora i un nombre màxim diari, encara
  que la subscripció no facturi per petició. Tasques de temes diferents poden
  córrer en paral·lel; els missatges d'una mateixa conversa se serialitzen.
- Revocació: retirar una identitat de la llista i del supergrup impedeix de
  manera immediata qualsevol acció posterior. Si hi ha compromís, també es
  revoquen el token del bot i les credencials de GitHub.
- Cap canal alternatiu (Discord, correu, webhook genèric) en aquesta fase.

### Contingut, Camins I Imatges

- L'allowlist d'escriptura inclou exactament el YAML de les col·leccions
  editorials d'`apps/web/src/content/` i els recursos d'imatge i PDF amb les
  extensions aprovades a
  [`resources.ts`](../../apps/web/src/lib/content/resources.ts) sota:
  - `apps/web/src/content-assets/`, per a contingut nou.
  - Els directoris d'`apps/web/src/assets/` que el contingut referencia o que
    el build importa (`schools`, `events`, `entities`, `collaborators`,
    `sponsors`, `members`, `about`, `home`) i els fitxers d'imatge existents a
    l'arrel d'`apps/web/src/assets/`, només per substituir un fitxer existent
    amb el mateix camí i extensió.
- Afegir un fitxer nou només és permès sota `content-assets/` o si el mateix
  canvi afegeix la referència al YAML d'una col·lecció autoritzada. No es
  renombren ni s'esborren fitxers sense actualitzar totes les referències i
  sense build verd.
- El pont descarrega l'adjunt de Telegram i el deixa al worktree; l'agent
  l'incorpora al contingut i n'escriu els textos alternatius. Incorporar una
  imatge no la publica: la publicació continua requerint el merge de la pull
  request.
- `apps/web/src/assets/fonts/` i qualsevol fitxer que no sigui imatge o PDF
  queden fora de l'allowlist.
- Tota edició fora d'aquests camins es rebutja amb l'explicació del motiu, abans
  del push.
- El nou contingut es crea amb `published: false` i seguint la
  [guia editorial](../editorial/guide.md) i les seves plantilles; l'assistència
  no marca res com a publicat. Pot corregir entrades ja publicades sense canviar
  l'estat de publicació.
- Cada idioma afectat es lliura complet en `ca`, `es` i `en`. Si falta un fet o
  una traducció, la tasca queda incompleta i l'agent ho pregunta en lloc
  d'inventar-ho o fer fallback.

### Imatges Des Del Xat

- Només s'accepten adjunts de Telegram; no es descarreguen URLs remotes. Els
  originals s'envien com a fitxer: una foto comprimida no serveix per a una
  portada.
- Es validen extensió, tipus real, mida màxima d'entrada i dimensions, i es
  reescriuen sense EXIF ni geolocalització abans d'entrar al worktree.
- Es comprova el pes de les variants generades contra el pressupost de 300 KiB
  per imatge abans de donar la tasca per completa.
- La persona que envia la imatge n'afirma els drets. La pull request registra
  l'origen i la data; els consentiments es conserven fora del repositori.
- No s'accepten captures amb dades personals, bancàries o identificadors sense
  sanititzar.

### Pont, Harness I Aïllament

- El pont pot ser codi propi o una eina existent reutilitzada (per exemple el
  runtime `@earendil-works/pi-durable` amb el gateway `pi-durable-telegram`, o
  un gateway de canals amb suport ACP i Pi ACP). Sigui quin sigui, s'executa
  amb usuari i unitat propis, gestiona Telegram, l'estat de les tasques, el
  registre d'auditoria i l'accés a GitHub, i no exposa cap port a Internet.
- El harness de l'agent s'executa en un contenidor o unitat endurida amb un
  worktree com a únic camí d'escriptura, sense credencials de GitHub i sense
  accés a `/var/lib/mountain-runners`, `/etc/caddy`, l'estat ACME, els logs de
  producció ni cap secret de producció.
- El perfil editorial viu al repositori i es revisa com la resta de codi. Carrega
  la guia, les plantilles i les skills `editorial-posts`, `unslop` i
  `project-context`; no manté una còpia divergent de les regles editorials. La
  configuració fixa la confiança del projecte perquè les skills versionades es
  carreguin sense cap prompt interactiu.
- El pont manté una conversa duradora per tasca i tradueix el seu progrés a
  missatges curts. Si la base és el CLI de pi, cada missatge reprèn la mateixa
  sessió (`--session-id`) amb un directori de sessions propi. Les preguntes de
  l'agent són text final; la resposta de la persona reprèn la mateixa conversa.
- El harness té una allowlist d'eines i un guard que bloqueja `edit` i `write`
  fora de l'allowlist. El perfil no habilita `bash`, MCP ni eines de xarxa:
  només lectura, cerca, llistat i edició. Les imatges, la seva validació i la
  formació del YAML les fa el pont. El pont torna a comprovar el diff abans del
  push i la CI ho torna a comprovar a la pull request.
- La credencial del model és de la subscripció OpenCode Go i viu només a
  l'entorn del harness. El model triat i la seva versió es registren a
  l'auditoria i a la descripció de la pull request.
- El model i el runtime es fixen a les versions que superin l'avaluació i es
  documenten al runbook. El harness no necessita `pnpm` ni les dependències de
  la web: la CI és qui valida.
- Del runtime durador no cal implementar res: aporta les converses, la represa,
  el `cwd` per conversa, els hooks d'eines, el progrés i el graf de tasques. El
  projecte implementa el canal amb topics (fork del gateway o canal propi), el
  perfil i el guard editorials, el publicador durador, la ingesta d'imatges
  validada i l'auditoria.

### Pull Requests, CI I Previews

- La branca parteix de l'últim `main`, té un nom estable per tasca i només
  conté canvis de l'allowlist.
- El títol i els commits segueixen Conventional Commits amb els tipus permesos
  pel projecte; la descripció és en català i identifica el contingut, els
  idiomes, les imatges, la validació executada per la CI i un identificador de
  tasca, sense IDs de Telegram ni dades personals.
- El pont formata el YAML canviat amb el Prettier del repositori abans del
  guard de diff, perquè la CI no falli només per format.
- El push es fa només després que el guard de diff accepti el canvi. La pull
  request s'obre tot seguit i la CI n'és el gate.
- Si la CI falla, el pont comunica el job i el motiu, no demana cap preview i
  permet continuar a la mateixa branca.
- Amb CI verda, el pont comenta exactament `/preview` amb la identitat delegada
  i espera el comentari idempotent del publicador de confiança. Retorna l'URL i
  el SHA d'aquell comentari; mai construeix l'URL.
- Reexecucions, missatges duplicats i respostes posteriors no creen branques,
  pull requests ni comentaris duplicats.
- L'assistència no fusiona, no desplega, no publica i no pot autoritzar
  l'activació d'una preview fora del flux de la fase 6.

### Auditoria, Revocació I Aturada

- Cada tasca registra identitat delegant, ordre, model, sessió, branca, commits,
  pull request, resultat de la CI, URL i SHA de la preview, resultat i moment.
- El registre guarda només metadades (identitat, model, branca, pull request,
  CI, preview i moment) i el text de la tasca truncat; mai la conversa completa.
  L'accés i la consulta es fixen a T8.1.
- Les sessions duradores de pi es conserven: és el disseny de pi-durable i no
  ofereix cap API d'esborrat. La política d'esborrat o caducitat queda fora
  d'aquesta fase i es registra com a decisió pendent, amb les opcions conegudes
  (API d'upstream, poda SQL o rotació de fitxers).
- Els worktrees i els adjunts es netegen en tancar la tasca per higiene
  operativa. Es recomana activar l'auto-esborrat de missatges al supergrup per
  limitar la còpia de Telegram.
- La traça es pot consultar per identitat, tasca i període.
- La llista d'identitats autoritzades no es modifica des del canal.
- L'aturada d'emergència és `systemctl stop` del pont i del harness, més la
  revocació del token del bot. No requereix tocar la web, la producció ni les
  previews.
- El servei no té accés d'escriptura als releases, la configuració de Caddy,
  l'estat ACME ni els secrets de producció.

## Estratègia De Tests I Qualitat

- Proves unitàries de la verificació d'identitats, la deduplicació de missatges,
  l'aplicació de l'allowlist de camins i recursos, el guard d'edició, el guard de
  diff, la ingesta d'imatges i el rebuig d'ordres no reconegudes.
- Casos de path traversal, symlinks, camins absoluts, extensions no aprovades,
  fitxers buits i imatges amb EXIF.
- Proves d'integració amb un repositori temporal, un Telegram simulat i un
  GitHub simulat: missatge → tasca → branca → edició → guard → push → pull
  request → CI verda → preview. Cap prova depèn de la xarxa real.
- Proves de fil: un tema nou crea una tasca, una resposta el reprèn, un
  reinici conserva la correspondència i un update duplicat no crea res.
- Casos negatius: identitat desconeguda o revocada, missatge duplicat, camí
  prohibit, YAML invàlid, imatge no permesa, CI vermella sense preview, PAT
  caducat, GitHub no disponible, harness aturat i dues tasques simultànies.
- Prova determinista del harness amb un model stub: el guard ha de bloquejar
  una edició fora de l'allowlist abans que existeixi el diff.
- Smoke de la conversa real amb una imatge, CI verda i preview activada abans
  del tancament (T8.6).
- Prova de neteja del worktree i els adjunts en tancar la tasca, sense afectar
  les tasques obertes.
- Revisió de seguretat independent abans d'activar cap credencial amb permís
  d'escriptura.
- Les proves noves s'incorporen a `pnpm check` perquè la CI les executi.

## Seguretat I Privacitat

- Separació de credencials: el pont té el token de Telegram, la clau de
  desplegament i el PAT; el model i les eines que se li ofereixen només tenen la
  clau del model. Cap credencial de GitHub arriba mai al context del model: les
  operacions que en necessiten les executa el host.
- El pont fa servir una clau de desplegament d'escriptura per al push i un PAT
  de gra fi sense `contents: write` per a pull requests, comentaris i lectura de
  la CI. Així cap credencial d'API del compte dedicat no pot fusionar.
- El PAT i la clau de desplegament tenen expiració curta i rotació documentada,
  sense administració ni workflows.
- La protecció de branca i la revisió humana són la barrera final: cap
  credencial de l'assistència pot fusionar, i cap fusió arriba a producció fora
  del flux de desplegament continu des de `main`.
- Els missatges, el contingut citat i les imatges són entrada no fiable: no
  amplien permisos, no executen res fora del sandbox i no obtenen credencials.
- Els IDs d'usuari de Telegram es tracten com a identificadors personals: no es
  publiquen al repositori ni als logs de la CI.
- El model rep només la tasca i els fitxers necessaris. El contingut editorial
  és públic; els missatges poden contenir dades personals i es minimitzen. La
  retenció del proveïdor es documenta a T8.1.
- Les imatges s'envien sense EXIF ni geolocalització i sense dades personals o
  financeres visibles.
- El registre d'auditoria és minimitzat i no conserva el contingut íntegre dels
  missatges. Les sessions duradores de pi es conserven tal com les desa el
  runtime.
- La rotació de credencials, la revocació d'identitats i l'aturada d'emergència
  queden provades i documentades al runbook.

## Fora D'Abast

- Qualsevol canvi de codi a `apps/web`: components, estils, rutes, configuració
  d'Astro, catàlegs de missatges, esquemes, scripts i navegació. El codi del
  repositori es limita al pont o a la configuració pinjada de l'eina
  reutilitzada, les eines de `tools/server/`, el perfil editorial, la seva
  documentació i les seves proves, i el wiring necessari a `package.json` per
  executar-les a la CI.
- Afegir imatges que requereixin un canvi de codi (nous imports o referències a
  components). Substituir una imatge existent al mateix camí sí que és a
  l'abast.
- El xat públic (fase 7) i qualsevol índex o servei de lectura compartit.
- Fusionar, desplegar, publicar contingut o autoritzar l'activació de previews
  fora del flux de la fase 6.
- CMS complet, interfície web d'edició o comptes d'usuari de la web.
- Shell remot, execució arbitrària fora del sandbox o accés al VPS més enllà del
  servei.
- Ingesta d'imatges per URL, canals addicionals o bots multicanal.
- Pressupostos, facturació o límits per token: la subscripció OpenCode Go és el
  límit econòmic. Els límits de concurrència i d'ús per identitat es mantenen
  per evitar abús operatiu.
- La política d'esborrat o caducitat de les sessions duradores de pi i del
  registre d'auditoria. Les sessions es conserven tal com les desa el runtime.

## Criteris D'Acceptació

La fase es considera completada quan:

1. Les sis unitats tenen PR pròpia revisada, validada i fusionada en ordre de
   dependències.
2. Només les identitats autoritzades poden llançar tasques; la revocació d'una
   identitat és efectiva de manera immediata i provada en directe.
3. Cap edició ni cap imatge fora de l'allowlist es materialitza: el guard, el
   diff i la CI la rebutgen, i el servei ho explica a la conversa.
4. Una CI vermella no activa cap preview, i la causa es comunica a la conversa;
   la mateixa tasca pot continuar a la mateixa branca.
5. Cada tasca queda registrada amb identitat, model, branca, pull request,
   resultat de la CI i preview, i la traça es pot consultar.
6. El model i les seves eines no tenen cap credencial de GitHub; el pont no
   exposa cap operació de fusió, desplegament ni accés a secrets de producció.
   Cap credencial del pont no pot fusionar, i la protecció de branca ho
   verifica.
7. La preview només es demana amb CI verda i la identitat delegada; l'URL i el
   SHA retornats provenen del publicador de confiança, i cap preview s'activa
   fora del flux de la fase 6.
8. Les imatges s'incorporen des del xat amb tipus, mida, dimensions i metadades
   validats, i el build respecta el pressupost.
9. L'aturada del servei no afecta la web, la producció ni el sistema de
   previews.
10. El runbook descriu operació, aturada d'emergència, rotació de credencials,
    revocació, còpia i restauració del registre, i responsabilitats verificades.
