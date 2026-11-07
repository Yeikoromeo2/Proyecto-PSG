# Proyecto PSG · Ayudante para PokéSurvivor

Script que se ejecuta **dentro de [PokéSurvivor](https://pokesurvivor.com)** y te
ayuda con las cartas que salen al subir de nivel:

- **Selector de cartas:** marca la mejor de las 3 con una ★ y explica por qué
  (evolución lista, desbloquea una evolución, ataque de tu lado fuerte, vida baja…).
- **Interruptor 👆 Selección / 🤖 Automático:** en *Selección* sólo te recomienda;
  en *Automático* elige la recomendada sola, un instante después de abrirse las cartas.
- **Interruptor 🔓 Modo libre (ON/OFF):** en lugar del sorteo te ofrece las 3 mejores
  cartas posibles en ese momento («Cambiar opciones» pasa a las siguientes).
  **La partida en la que lo uses no se sube al ranking**: así no compites con ventaja
  contra quien juega limpio. En cooperativo no se puede activar.

Los dos interruptores aparecen encima de las cartas y se recuerdan en tu navegador.

> Las cartas **no se pueden saber antes**: el juego las sortea con `Math.random()` en
> el momento exacto de subir de nivel. Lo que sí se conoce son todas las cartas
> posibles y sus probabilidades, que es lo que usa el modo libre.

## Joystick que no se mueve por toda la pantalla (no necesita el script)

El juego ya lo trae: **Ajustes → Controles → Colocar los botones**, y arriba elige:

| Modo | Qué hace |
|---|---|
| **Anclado** | Aparece donde pones el dedo y **se queda ahí** hasta que lo levantas, aunque alejes el dedo. |
| **Fijo** | Siempre en el mismo sitio de la pantalla (arrástralo a donde quieras). Sólo se coge tocando cerca. |
| Flotante | (el de por defecto) aparece donde tocas y la base sigue a tu dedo. |

En la misma pestaña puedes ponerlo *Pequeño / Normal / Grande*.

## Instalación en Android

**Chrome para Android no puede ejecutar este script**: no admite extensiones y la
página del juego bloquea los «marcadores con JavaScript» (su política de seguridad,
CSP, sólo deja ejecutar scripts del propio juego). Hace falta **Firefox para Android**:

1. En Chrome, entra al juego y pulsa **Guardar** para subir tu partida a la nube.
2. Instala **Firefox** desde Google Play.
3. En Firefox: menú ⋮ → **Extensiones** → instala **Violentmonkey** (o Tampermonkey).
4. Abre en Firefox la dirección «raw» del script (`pokesurvivor-ayudante.user.js` de
   este repositorio; en GitHub, botón *Raw*). Violentmonkey ofrecerá **Instalar**.
   *Alternativa:* Violentmonkey → **+** (nuevo script) → pega el contenido del archivo → guardar.
5. Entra a <https://pokesurvivor.com> en Firefox e **inicia sesión con tu misma cuenta**.
   Al cargar verás el aviso «Ayudante PSG 0.1.0 activo».

Si no aparece ese aviso: en Violentmonkey, abre el script y comprueba que el modo de
inyección es **page** (el script ya lo pide con `@inject-into page`).

También funciona en el ordenador (Chrome, Firefox, Edge) con Tampermonkey o Violentmonkey.

## Cómo puntúa las cartas (versión 0.1)

Heurística sencilla, pensada para ajustarla con la experiencia:

| Carta | Puntos | Motivo |
|---|---|---|
| Evolución lista (dorada) | 1000 | El mayor salto de daño |
| Baya Zidra con < 35 % de vida | 900 | Te queda poca vida |
| Mejora que desbloquea una evolución | 850 | Su movimiento ya está al máximo |
| Mejorar un ataque con evolución | 580–700 | Cuanto más cerca del máximo, más |
| Mejorar un ataque sin evolución | 420 | |
| Ataque nuevo | 360 × rendimiento | Penaliza los de tu lado flojo (físico/especial); +150 si tienes menos de 2 ataques; +50 si puede evolucionar |
| Potencia / Reflejos | 300 / 280 | Daño y recarga para todos tus ataques |
| Vigor / Coraza / Síntesis | 170 / 170 / 150 | +160 si tienes menos de la mitad de vida |
| Aprendizaje | 230 hasta nivel 10, luego 80 | |
| Potenciadores (Danza Espada…) | 120–230 | No hacen daño por sí solos |

## Cómo funciona por dentro

El juego deja sus módulos en `window.G`. El script espera a que existan y envuelve
sólo tres funciones: `G.LevelUp.offer` (las cartas), `G.RunUI.showLevelUp` (la
pantalla de cartas) y `G.Ranking.submitSolo/submitGroup` (para no subir al ranking
las partidas en modo libre). No toca tu partida guardada ni los servidores.
Si una actualización del juego cambia esas funciones, el script no se instala y el
juego sigue funcionando normal.

## Pruebas

`tests/e2e.cjs` abre una copia local del juego en un navegador sin ventana (Playwright),
carga el script y comprueba el selector, el modo automático, el modo libre y el bloqueo
del ranking:

```
node tests/e2e.cjs /ruta/a/una/copia/de/pokesurvivor [carpeta-para-capturas]
```

La copia del juego no va en este repositorio.

## Respeto al juego

PokéSurvivor es de JPTER78 (código bajo PolyForm Noncommercial 1.0.0 desde el
14-10-2026). Este ayudante es de uso personal y gratuito: nada de venderlo ni ponerle
anuncios. Pokémon y sus sprites son marcas de Nintendo / Creatures / GAME FREAK.
