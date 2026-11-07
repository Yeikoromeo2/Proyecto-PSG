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

## Pruebas
- `node tests/e2e.cjs /ruta/a/copia/de/pokesurvivor` (Playwright, sin red).
- `PSG_SIM_XRAY=1|2 node tests/e2e.cjs ...` simula el modo content (no la seguridad real de Firefox).
  La variante 2 es la de Violentmonkey en Firefox Android: `unsafeWindow` es la ventana aislada y el
  juego sólo se ve por `window.wrappedJSObject`. Pasar las tres (sin variable, 1 y 2) antes de subir.
- `node tests/preparar-copias.cjs <copia> <salida> --real` crea copias «cerrado», «cifrado» y «real»
  (el código que sirve hoy pokesurvivor.com; la sesión necesita red hacia ese dominio). Probar SIEMPRE
  contra `salida/real` antes de subir un cambio que dependa del juego.
