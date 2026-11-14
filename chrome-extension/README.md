# Ayudante PSG — extensión para Chrome (PC)

Extensión de Chrome (Manifest V3) que mete el **ayudante PSG** dentro de PokéSurvivor,
sin necesidad de Tampermonkey/Violentmonkey. Es el mismo ayudante que el userscript
y la app Android (mismo archivo).

## Instalar (Chrome / Edge / Brave / Opera en PC)

1. Descarga el zip: **PokeSurvivor-PSG-chrome.zip**
   (enlace fijo: https://github.com/Yeikoromeo2/Proyecto-PSG/releases/download/chrome-latest/PokeSurvivor-PSG-chrome.zip)
2. **Descomprímelo** en una carpeta (no lo dejes dentro del zip).
3. Abre `chrome://extensions` (en Edge `edge://extensions`, en Brave `brave://extensions`).
4. Activa arriba a la derecha el **Modo de desarrollador**.
5. Pulsa **Cargar descomprimida** (o «Load unpacked») y elige la carpeta descomprimida.
6. Entra en https://pokesurvivor.com y recarga. Arriba debe salir **«PSG ✓ funcionando»**.

> No la quites de la carpeta: Chrome la carga desde ahí. Si la borras o la mueves, deja de funcionar.

## Actualizar

Las extensiones cargadas «descomprimidas» **no se actualizan solas**. Cuando haya una versión
nueva: descarga otra vez el zip, reemplaza los archivos de la carpeta y pulsa el botón de
recargar ↻ de la extensión en `chrome://extensions`.

Si prefieres que se actualice sola, usa el **userscript** con Tampermonkey (ese sí se actualiza solo).

## Requisitos

- Chrome/Edge/Brave/Opera 111 o más nuevo (usa `world: MAIN` en el content script).
- Es un ayudante **no oficial**; solo lee la partida y te orienta, no cambia nada del juego.
