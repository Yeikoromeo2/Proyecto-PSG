# Proyecto PSG — notas para Claude

## Preferencias del usuario (siempre)
- **Cuando tengas que hacer preguntas, hazlas con opciones de selección** (recuadros para
  elegir, herramienta AskUserQuestion), no como preguntas abiertas en el texto.
- Responde en español.

## Proyecto
- Ayudante para PokéSurvivor (https://pokesurvivor.com, de JPTER78): userscript que se
  ejecuta dentro del juego. Archivo principal: `pokesurvivor-ayudante.user.js`.
- El usuario juega en Android; Chrome no ejecuta userscripts, se usa Firefox + Violentmonkey.
- No subir aquí el código ni los sprites del juego (PolyForm Noncommercial / Nintendo).
- Las partidas con «modo libre» no deben subir al ranking.

## Compatibilidad con Firefox (modo content de Violentmonkey)
- La CSP del juego bloquea la inyección en la página en Firefox Android: el script usa
  `@inject-into auto` y debe funcionar también aislado (Xray de Firefox).
- Dos copias instaladas a la vez (una vieja olvidada) arrancan las dos: el script marca su versión en la
  página (`data-psg-ver`) y en la ventana (`__psgBoot`); la igual o más vieja que llega después no hace
  nada, y si la que corre es anterior a 0.9.7 (sin marca) se avisa en rojo para que la borren.
- Reglas al tocar el código: las funciones que el juego llama se asignan con `exp()`; los objetos
  nuestros que el juego lee, con `share()`; las listas del juego se copian con `arr()` antes de usar
  `.map/.filter/.find/...` con funciones nuestras; las listas que devolvemos al juego, con `toPage()`;
  en las cartas del juego sólo se guardan valores simples (`__psgS`, `__psgW`).

## Juego encerrado y cifrado (versión publicada)
- El build publicado envuelve el juego en una función y cifra las claves de sus módulos (anti-trampas;
  cambian entre versiones). Se mantiene: el objeto de módulos se crea con `Object.create(null)` al
  empezar, y los módulos conservan los nombres de sus funciones (`offer`, `showLevelUp`, `pick`…).
- El script apunta esos objetos al cargar (trampa al principio del script, antes de nada) y reconoce
  cada módulo por su contenido (`SIG`/`resolve`). Si el juego cambia, el indicador rojo dice `faltan:…`.
- El anti-trampas del juego (`clean()`) sólo mira el reloj, propiedades propias del jugador
  (hurt/update/heal/gainXp) y límites de stats: no tocar nada de eso.

## Sin copia de seguridad ni importar
- El usuario pidió quitar «exportar partida» (v0.9.8): no hay ningún botón de copia/exportar.
- Tampoco importar, a propósito: el juego publicado es autoritativo en servidor (`GET /save`,
  `/eco/pull` para el gacha, `/run/start|end`, `/admin/suspects`, `/admin/ban`) y quita los Pokémon/shiny
  añadidos a mano. No implementar nada que escriba la colección. Mover una cuenta → el autor.

## Editar stats / monedas «operativo» (jugar con ello) — NO SE PUEDE (pedido varias veces)
- El usuario ha pedido más de una vez poder **cambiar los stats de un Pokémon (o generar monedas/etiquetas)
  y que sea OPERATIVO**: entrar a jugar y notar el desempeño con esos valores, aunque sea «solo para
  experimento» y sin subir al ranking. **Respuesta fija: no se hace, y no se explica cómo.**
- Motivo (recordárselo, sin volver a debatirlo): el juego es **autoritativo en el servidor** y su
  anti-trampas `clean()` vigila justamente los **límites de stats** y las propiedades del jugador; `/run/end`,
  `/admin/suspects` y `/admin/ban` validan cada partida. Subir stats o monedas en local lo detecta el
  anti-trampas y puede acabar en **baneo de la cuenta**, incluso en «modo libre» (que solo bloquea el ranking).
  Es saltarse el anti-trampas de un juego online de otra persona: fuera de alcance.
- Lo que SÍ se puede y es lo que se ofrece en su lugar: un **simulador de SOLO LECTURA** en el analizador
  (mueves stats/mejoras/naturaleza hipotéticas y ves potencia/aguante/hexágono + DPS estimado, antes/después).
  Predice el desempeño sin jugar y sin tocar nada. La parte interna (`analyze(dex, simLv)`) está en un stash.
- Si vuelve a pedir la versión «operativa», recordarle esta nota y no reabrir el tema; ofrecer el simulador.

## Actualización del juego nov-2026 (formas) — compatibilidad v0.9.9
- El juego añadió **mega, dinamax, gigamax, tera y movimiento Z**, y creció a ~1082 Pokémon
  (antes 966): no fijar ese número en pruebas, leerlo de `G.DEX.length`.
- Módulo nuevo **`Forms`** (estado de forma): se reconoce por `look`+`data`+`chosen`+`looks` (ver SIG).
  `Forms.looks(dex)`/`Forms.data(id)` devuelven la forma con sus stats+tipos. Las formas de combate
  (mega/dinamax) sólo aparecen en partida con su desbloqueo: no se pueden provocar como invitado en las
  pruebas (por eso el enganche de `showForm` es defensivo y se prueba con una forma inventada/cosmética).
- **`G.RunUI.showItemChoice` cambió de firma**: ahora `(objetos[], nuevo, cb, hueco=-1)` — el 1.º es un
  ARRAY (el jugador lleva varios objetos: `item2`/`item3`/`startitem`, `perks.itemSlots`). Hay que
  reenviar los 4 args. Pantalla llena: `.item-slot` por objeto + `.card.keep`; hueco libre: «llevar/dejar».
- **`G.RunUI.showForm(pl, look, cb)`**: `look.forms` son las formas; reusa `#evo-cards` (cartas `.evo-go`
  + «quedarse igual» al final). El ayudante puntúa cada forma (`core.formScore`) y marca/auto-elige.
- **`perks` nuevos**: `critDmg` (×daño crítico), `itemSlots`, `startItem`. `perkK` usa `crit*critDmg`.
- **Aguante (🛡)**: ahora es defensas base + mejoras SIN los potenciadores del plan de daño (eran
  situacionales y hacían que un frágil con Fortaleza pareciera tanque). Los potenciadores cuentan en parte
  (`BUFF_TOUGH`) sólo donde tiene sentido; `toughInfo.buffTough` guarda el extra con potenciadores, para informar.
- Objetos nuevos añadidos a `ITEM_FX` (Guante Pégil/Espray Bucal son condicionales físico/especial).

## «Ver todas» en la subida de nivel (v0.9.10)
- Botón `data-k="all"` en la barra de cartas: muestra TODAS las cartas posibles de esa subida
  (`fullPool`), clasificadas en 3 secciones con encabezado `.psg-sec-h`: ataques/evoluciones,
  potenciadores y mejoras de stat (`cardCat` + `CAT_ORDER`/`CAT_LABEL`). `allOffer` ordena por sección.
- Quita el azar → marca la partida como modo libre (`pl.__psgForced`, no sube al ranking). No auto-elige
  (es para mirar). Es seguro con el anti-trampas: elegir una carta es una acción normal del juego; sólo
  cambiamos qué cartas se ofrecen (como el modo libre).
- Scroll (v0.9.11, arreglo móvil): el juego hace `#cards` un GRID dentro de `.box`. Darle a `#cards` su
  propio `max-height`/`overflow` creaba un mini-scroll que en el móvil se recortaba a ~4 cartas. Ahora
  `#cards.psg-allcards` va con `overflow:visible` y scrollea TODO el panel (`#scr-levelup.psg-allmode .box`
  con `overflow-y:auto`), con la barra de interruptores `position:sticky` arriba. Una sola barra de scroll.

## Analizador y comparador (v0.9.8)
- Ficha compacta: sprite del juego (`G.UI.sprite` en un canvas `.stage`), hexágono de stats, chips de
  veredicto y combos 1-2-3 (grupos de 4 para fusionar; entre todos, como mucho 2 potenciadores). El resto,
  plegado en «Más detalles».
- Comparador: A (azul) y B (rosa) se eligen con las casillas de la lista o con «Cambiar» (buscador);
  hexágono con los dos, tabla de ganadores 👑, debilidades (`G.Types.mult`) y combos. Poco texto.
- Estilos de cartas: 🛡️ Aguante pone Coraza/Vigor/Síntesis por encima de mejorar ataques; ⚖️ Equilibrado
  sube la defensa si llevas 2+ de ataque de más (y al revés); en modo libre siempre sale al menos una
  carta de mejora del estilo.

## Extensión de Chrome PC (`chrome-extension/`)
- Extensión MV3 que inyecta el ayudante en pokesurvivor.com. Content script `run_at: document_start`
  + `world: MAIN` (así corre en el contexto de la página y pone la trampa de `Object.create` antes del
  juego, como el modo página de Tampermonkey). Las extensiones de Chrome saltan la CSP de la página, así
  que aquí NO hay problema de CSP (a diferencia de Firefox, que necesita `@inject-into auto`).
- Fuente única: `helper.js` es copia del userscript, generada al compilar (gitignored). El workflow
  `.github/workflows/chrome.yml` copia el userscript, sincroniza la versión del manifest y publica el zip
  en la release `chrome-latest`. Se carga «descomprimida» → no se auto-actualiza (para eso, Tampermonkey).
- No se puede probar en Chrome real aquí, pero el comportamiento (MAIN world, document_start) es el mismo
  que el modo página que ya cubre `tests/e2e.cjs` sin `PSG_SIM_XRAY`.

## App Android (`android/`)
- WebView que abre https://pokesurvivor.com tal cual (login del juego sin tocar) e inyecta el
  userscript con `addDocumentStartJavaScript` («modo ayudante», con nombre y contraseña).
- «Modo Google»: Google bloquea su login en WebViews; al tocarlo se ofrece abrir el juego en una
  Custom Tab (Chrome dentro de la app), donde funciona y la sesión se guarda, pero sin ayudante.
  NO falsear el user agent ni usar el OAuth client del juego para saltarse esa regla.
- El userscript se copia al APK al compilar (no hay segunda copia) y, además, la app lo actualiza
  sola: al arrancar usa el más nuevo entre el del APK y el descargado, y en segundo plano baja el de
  `HELPER_URL` (se valida: cabecera de userscript + namespace del proyecto); también al volver a la
  app (cada 10 min como mucho). Si hay uno nuevo, cambia el script de inicio de la WebView al momento
  y pregunta si recargar el juego (Android suele dejar la app abierta: no esperar a un arranque nuevo). Cualquier cambio en el
  userscript o en `android/` lanza `.github/workflows/android.yml`, que publica el APK en la
  versión `app-latest`.
- La llave de firma NUNCA va en el repositorio (es público): Actions la lee de los Secrets
  `PSG_KEYSTORE_B64` y `PSG_KEYSTORE_PASSWORD`; a mano, variables `PSG_KEYSTORE` y `PSG_KEYSTORE_PASSWORD`.
- Compilar aquí: `ANDROID_HOME=$HOME/android-sdk ./gradlew lintRelease assembleRelease` (el SDK se
  instala con cmdline-tools desde dl.google.com; plataforma 35, build-tools 35.0.0). Lint falla si
  hay llamadas que no existen en Android 8 (minSdk 26): proteger con `Build.VERSION.SDK_INT`.
- No hay emulador aquí (sin KVM): la app no se puede probar en ejecución en esta sesión.

## Pruebas
- `node tests/e2e.cjs /ruta/a/copia/de/pokesurvivor` (Playwright, sin red).
- `PSG_SIM_XRAY=1|2 node tests/e2e.cjs ...` simula el modo content (no la seguridad real de Firefox).
  La variante 2 es la de Violentmonkey en Firefox Android: `unsafeWindow` es la ventana aislada y el
  juego sólo se ve por `window.wrappedJSObject`. Pasar las tres (sin variable, 1 y 2) antes de subir.
- `node tests/preparar-copias.cjs <copia> <salida> --real` crea copias «cerrado», «cifrado» y «real»
  (el código que sirve hoy pokesurvivor.com; la sesión necesita red hacia ese dominio). Probar SIEMPRE
  contra `salida/real` antes de subir un cambio que dependa del juego.
  Regenerarla si el juego publicado cambió: con un `version.json` viejo el juego cree que hay versión
  nueva y recarga la página al minuto (la prueba falla con «Execution context was destroyed»).
