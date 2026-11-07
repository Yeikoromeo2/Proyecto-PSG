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

## Pruebas
- `node tests/e2e.cjs /ruta/a/copia/de/pokesurvivor` (Playwright, sin red).
