# T8.1: Requisits operatius i model d'amenaces

## Estat i abast

Esborrany de treball per a [T8.1 de la fase 8](specs/phase-8-editorial-assistance.md).
Distingeix els requisits de l'especificació fusionada de les propostes pendents
de revisió. No autoritza desplegaments, comptes, credencials ni canvis remots.
T8.2 ha de verificar la viabilitat i obtenir l'aprovació dels ADR abans d'activar
els permisos ampliats. Les fronteres vigents d'[assistents](ai-assistant.md) i
els ADR [0002](decisions/0002-public-chat-and-private-editor.md),
[0003](decisions/0003-agent-workflow-and-security.md) i
[0009](decisions/0009-pr-previews-same-domain-and-own-branches.md) continuen
aplicant-se fins que s'esmenin.

## Contracte de sessió i identitat

- El servei només accepta instruccions atribuïbles a una persona membre del
  grup privat configurat. Un altre grup, un missatge privat, una autoria
  anònima o no verificable i un error de verificació no concedeixen accés.
  Els noms visibles, les cites i els missatges reenviats no proven la identitat.
- La sessió es relaciona amb el grup i el tema. Dues persones del mateix tema
  comparteixen context i poden continuar una feina; cada instrucció conserva
  l'autoria privada. Les instruccions s'ordenen per sessió i els lliuraments
  duplicats no s'executen dues vegades.
- Una consulta no crea branca ni autoritza escriptures. Una implementació clara
  autoritza el flux fins a PR dins l'abast demanat. Davant d'una contradicció
  funcional o un abast ambigu, el servei pregunta abans d'actuar.
- Un cop validat el resultat, un membre verificat pot demanar-ne el merge amb la
  comanda determinista `/merge <PR>`. El servei no fusiona per iniciativa
  pròpia ni interpreta prosa com a autorització, i no desplega mai.
- Una persona que deixa el grup no pot donar instruccions noves. La seva
  sortida no cancel·la automàticament la feina compartida ja autoritzada, ni
  les seves instruccions ja acceptades a la cua. Les altres persones membres
  poden continuar-la o aturar-la. T8.2 ha de definir la comprovació de
  pertinença, la caducitat i invalidació de qualsevol memòria cau, i provar la
  revocació i les fallades de Telegram.
- Les persones creen els temes a Telegram i activen el bot amb una menció o
  una resposta a un missatge seu. Només els missatges que compleixen aquesta
  regla, el context necessari de la conversa amb el bot i les cites, reenviaments
  o fitxers adjuntats o referenciats expressament poden enviar-se al model. La
  resta de conversa del grup no s'envia automàticament. T8.2 ha de verificar la
  compatibilitat amb la configuració de privacitat de Telegram.

## Feines, concurrència i aturada

- Una sessió pot encadenar feines. Una implementació nova parteix de l'últim
  `main` en una branca i un worktree propis. Una continuació consulta la branca,
  la PR, el diff, els comentaris, la CI i les especificacions i ADR relacionats;
  pregunta si li falta context rellevant.
- El servei avisa al tema actual dels fitxers que se solapen amb feines actives
  conegudes i de la PR relacionada si existeix. L'absència d'avís no garanteix
  que no hi hagi altres conflictes. El solapament no bloqueja per si sol.
- Dues sessions no poden escriure simultàniament sense control sobre el mateix
  worktree o branca. T8.2 ha de triar i provar la coordinació o l'aïllament,
  inclosos els canvis externs a la branca; mai no s'ha de sobreescriure treball
  aliè. Un conflicte funcional requereix aclariment.
- Només hi ha una execució activa global; les altres peticions esperen. Les
  sessions obertes no consumeixen una plaça d'execució. La cua admet fins a deu
  instruccions pendents. En arribar al límit, el servei rebutja la instrucció i
  ho comunica; no la perd silenciosament. L'execució té límits de temps, CPU,
  memòria i disc. Si s'assoleix un límit, s'atura, conserva la feina i ho
  comunica. T8.2 fixa els valors després d'avaluar el runtime i el VPS.
- El servei prova com a màxim dues reparacions automàtiques consecutives per
  una mateixa fallada de comprovació o CI. En assolir el límit, informa del
  resultat i espera una nova instrucció. No repara errors aliens a l'abast ni
  tracta una fallada com a èxit.
- Qualsevol membre verificat pot demanar l'aturada de l'execució activa del
  tema. La petició d'aturada es processa fora de la cua normal, també quan és
  plena o hi ha una execució activa. El servei deixa d'iniciar accions noves,
  intenta aturar els processos associats i informa si l'aturada no es pot
  confirmar. Conserva canvis, branca i PR; no tanca la PR ni elimina feina no
  fusionada automàticament.
- Una acció externa ja enviada pot haver acabat tot i l'aturada o un reinici.
  Abans de repetir-la, el servei consulta l'estat real de Git o GitHub. Si no
  pot determinar el resultat, ho comunica i no declara que s'ha completat.

## Auditoria i privacitat

- La traça privada relaciona autor verificat, sessió, acció, moment i model amb
  branca, commits, PR, CI i preview quan existeixin. Registra també denegacions
  i resultats desconeguts sense incloure secrets. No duplica la conversa sencera.
- Si la traça es desa al VPS, inicialment només la persona amb accés root al
  VPS la pot consultar per investigar incidències. Això no exigeix executar el
  servei com a root; T8.2 ha de definir i verificar els permisos d'escriptura i
  lectura, inclosos els logs i les còpies que continguin la traça. Els membres
  reben al seu tema el resultat final de les seves operacions, sense sortides
  internes d'eines ni passos intermedis. El bot pot demanar aclariments i avisar
  de cua plena, errors o aturada no confirmada. La consulta no publica IDs de
  Telegram ni dades personals a GitHub o a la CI.
- Historial de sessió i auditoria tenen finalitats diferents. T8.2 ha de definir
  què es desa, qui hi accedeix, la retenció, l'esborrat i les còpies de tots dos.
  No es pressuposa una retenció indefinida ni que un esborrat de l'original
  elimini automàticament les còpies.
- Les instruccions, fragments de codi, sortides d'eines i adjunts necessaris per
  a una petició poden arribar al proveïdor del model. Cal minimitzar-los i
  revisar les condicions efectives de tractament i retenció abans de l'activació.
  Secrets i dades de producció no han d'entrar al model ni ser llegibles per
  proves, dependències o scripts no fiables. T8.2 ha d'inventariar dades,
  destinataris, retenció i telemetria de Telegram, model, GitHub, CI, logs i
  còpies abans de l'activació.
- L'entorn que executa codi no fiable no accedeix a converses ni credencials;
  la xarxa es limita al necessari. T8.2 ha de provar intents d'exfiltració,
  també a través de sortides de proves, PR i logs de CI. Cal revisar les dades
  abans de publicar-les i mantenir la revisió humana; no es pressuposa que un
  filtre automàtic detecti tota informació privada.

## Amenaces i controls a verificar

| Amenaça                                                  | Conseqüència                                                        | Requisit o resposta                                                                   | Verificació pendent                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Compromís d'un compte de Telegram o invitació indeguda   | Una persona no autoritzada encarrega canvis                         | Administració restringida del grup, atribució, revocació i revisió humana de PR       | Provar expulsió i denegació; documentar resposta a compte compromès                                            |
| Suplantació d'autor, altre grup o fallada de pertinença  | Instrucció acceptada fora de la frontera                            | Verificar grup, autor i pertinença; denegar si no es poden verificar                  | Provar autoria anònima, reenviaments, errors i revocació amb la solució triada                                 |
| Compromís del bot, runtime o credencial del model        | Accés a converses, ús abusiu o accions amb els permisos disponibles | Separar credencials, mínim privilegi, límits d'ús, revocació i aturada                | Provar rotació i determinar l'abast real de cada component a T8.2                                              |
| Prompt injection en missatges, PR, contingut o resultats | Intent d'ampliar permisos o filtrar informació                      | Tractar contingut com a no fiable; controls de permisos independents del model        | Provar instruccions adversàries sense confiar en el rebuig del model                                           |
| Scripts, hooks o dependències malicioses                 | Execució arbitrària, fuga de secrets o accés al host                | Executar dins l'aïllament, sense secrets ni socket del host; limitar xarxa i recursos | Provar escapada, lectura de secrets i accés lateral amb l'entorn escollit                                      |
| Credencial de GitHub abusada                             | Canvi de proteccions, push a `main` o merge fora del camí previst   | Separar permisos i impedir aquestes accions tècnicament                               | Fer proves negatives reals amb comptes de prova autoritzats a T8.2                                             |
| Merge no autoritzat o prematur                           | Codi no validat o no demanat arriba a producció                     | Comanda verificada amb el commit informat, comprovacions obligatòries i auditoria     | Provar merge sense comanda, amb commits posteriors a l'informe, CI vermella o pendent i bypass d'administrador |
| Petició de preview falsificada o CI no vàlida            | Publicació no autoritzada de codi de PR                             | Verificar membre, petició explícita, CI verda i SHA; revisar ADR 0009                 | Provar delegació i revalidacions; el gate actual veu el compte GitHub, no l'autor de Telegram                  |
| Reinici o resultat extern desconegut                     | Commits, PR o comentaris duplicats                                  | Deduplicar i reconciliar amb l'estat extern abans de repetir                          | Interrompre abans i després d'accions externes i verificar-ne el resultat                                      |
| Esgotament de recursos o cua                             | Afectació del VPS i de la web                                       | Límits configurables, cua acotada i servei separat                                    | Mesurar CPU, memòria, disc, temps i càrrega; provar aturada sense afectar producció                            |
| Adjunts maliciosos o dades personals                     | Exfiltració, fitxers insegurs o publicació indeguda                 | Validar tipus real, mida i destinació; eliminar metadades; revisar drets              | Provar tipus fals, traversal i límits d'imatge de l'especificació                                              |

## Punts pendents abans de tancar T8.1

1. Revisar la matriu d'amenaces i el tractament de dades des dels punts de vista
   de seguretat, privacitat, col·laboració i operació.
2. T8.2 ha de verificar els recursos i el temps màxim, l'activació del bot i els
   permisos d'auditoria. Ha de resoldre i provar els mecanismes concrets, no
   interpretar la matriu com una implementació.
