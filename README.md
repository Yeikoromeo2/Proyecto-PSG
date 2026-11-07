# Proyecto PSG · Ayudante para PokéSurvivor

Script que se ejecuta **dentro de [PokéSurvivor](https://pokesurvivor.com)** con dos partes:
un **analizador de tu colección** y una **ayuda con las cartas** que salen al subir de nivel.

## Analizador de colección

En el menú principal aparece el botón **Analizador PSG** (debajo de *Pokémon*). Abre una
lista con todos tus Pokémon, ordenable por *Más potentes*, *Naturaleza o habilidad a revisar*,
*Más usados* o *Nº de Pokédex*, y con buscador. Tocando uno ves:

- **Naturaleza** (✅ ideal/buena · ➖ normal/neutra · ⚠️ floja · ❌ mala): se juzga según el
  lado con el que pega su mejor plan (físico o especial). Si no es la ideal, te dice qué
  **Menta** comprar (Firme / Modesta, o Huraña / Afable si su plan mezcla los dos lados).
- **Habilidad**: qué hace, y cómo rinde cada una de sus opciones (también la oculta) sobre
  su plan. Si otra le da claramente más daño, te dice qué **Cápsula** usar.
- **Plan de 4 ataques**: los que más daño le darían ya evolucionados, con su **combo de
  evolución** (ataque al máximo + la mejora de stat que pide → «Ataque +») y las mejoras de
  stat que conviene coger en la partida.
- **Fijar tu propio plan**: en *Todos sus ataques* toca 📌 junto a los ataques que quieras
  (hasta 4, también potenciadores). Van primero en el plan y los huecos que dejes se rellenan
  con los mejores calculados. *↺ Volver al calculado* lo deshace. Se guarda en este navegador,
  por cuenta y por Pokémon, y **las cartas de nivel siguen ese plan**.
- **Movimiento inicial**: si el que tiene está en su plan o cuál le iría mejor.
- **MT** que entrarían en su plan, y la tabla con todos sus ataques posibles.

La «Potencia» es un índice aproximado (daño × proyectiles ÷ recarga, con extra para los
ataques de área, su naturaleza, su habilidad y el bonus de Pokémon de un solo tipo),
comparado con el mejor de tu colección. Sirve para comparar, no es el daño exacto.

## Ayuda con las cartas de nivel

- **Selector de cartas:** marca la mejor de las 3 con una ★ y explica por qué
  (evolución lista, desbloquea una evolución, ataque de tu lado fuerte, vida baja…).
- **Interruptor 👆 Selección / 🤖 Automático:** en *Selección* sólo te recomienda;
  en *Automático* elige la recomendada sola, un instante después de abrirse las cartas.
- **Interruptor de estilo ⚖️ Equilibrado / 🛡️ Aguante / ⚔️ Daño** (cada toque pasa al siguiente):
  - *Aguante*: más prioridad a Vigor, Coraza y Síntesis (y algo a Carrera), menos a Potencia y
    Reflejos; la Baya Zidra se recomienda antes (por debajo del 50 % de vida).
  - *Daño*: más prioridad a Potencia, Reflejos y a mejorar tus ataques, menos a las defensas;
    la Baya Zidra sólo con muy poca vida (por debajo del 25 %).
  - *Equilibrado*: los valores de la tabla de abajo.
- **Interruptor 📋 Plan (ON/OFF, encendido de serie):** el selector sigue el *plan de 4
  ataques* que el analizador calcula para el Pokémon con el que juegas. Encima de las cartas
  verás el plan (✔ los que ya tienes) y las mejoras de stat que piden sus evoluciones. Con el
  plan encendido:
  - los ataques del plan y sus mejoras suben mucho de prioridad;
  - la mejora de stat que pide la evolución de un ataque del plan sube (hasta cogerla una vez);
  - un ataque de fuera del plan baja si ya no te sobran huecos, más cuanto peor sea que el
    ataque del plan al que le quitaría el sitio (y la mitad si aún tienes menos de 2 ataques).
- **Interruptor 🔓 Modo libre (ON/OFF):** en lugar del sorteo te ofrece las 3 mejores
  cartas posibles en ese momento («Cambiar opciones» pasa a las siguientes).
  **La partida en la que lo uses no se sube al ranking**: así no compites con ventaja
  contra quien juega limpio. En cooperativo no se puede activar.

Los cuatro interruptores aparecen encima de las cartas y se recuerdan en tu navegador.

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
   Al cargar verás el aviso «Ayudante PSG 0.4.0 activo».

Si no aparece ese aviso: en Violentmonkey, abre el script y comprueba que el modo de
inyección es **page** (el script ya lo pide con `@inject-into page`).

También funciona en el ordenador (Chrome, Firefox, Edge) con Tampermonkey o Violentmonkey.

## Cómo puntúa las cartas

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
| **🛡️ Aguante** | Vigor/Coraza +130, Síntesis +120, Carrera +40, Potencia −40, Reflejos −20, mejorar ataque −20 | Baya Zidra: 900 con < 50 % de vida, 260 con < 80 % |
| **⚔️ Daño** | Potencia +120, Reflejos +100, mejorar ataque +60, Vigor/Coraza −70, Síntesis −60 | Baya Zidra: 900 con < 25 %, 260 con < 45 % |
| **Con Plan ON:** ataque nuevo del plan | +250 | (potenciador fijado en el plan: 480) |
| **Con Plan ON:** mejorar un ataque del plan | +100 | |
| **Con Plan ON:** mejora de stat que pide una evolución del plan | +120 | Sólo hasta cogerla una vez |
| **Con Plan ON:** ataque o potenciador de fuera que quita hueco al plan | hasta −200 | Según lo peor que sea; la mitad con menos de 2 ataques |

## Cómo funciona por dentro

El juego deja sus módulos en `window.G`. El analizador sólo lee (con las funciones del
propio juego: `G.Mons`, `G.Moves`, `G.AbilityFX`, `G.Stats`), así que la naturaleza y la
habilidad que te tocaron salen igual que en el juego. Para las cartas, envuelve
sólo tres funciones: `G.LevelUp.offer` (las cartas), `G.RunUI.showLevelUp` (la
pantalla de cartas) y `G.Ranking.submitSolo/submitGroup` (para no subir al ranking
las partidas en modo libre). No toca tu partida guardada ni los servidores.
Si una actualización del juego cambia esas funciones, el script no se instala y el
juego sigue funcionando normal.

## Pruebas

`tests/e2e.cjs` abre una copia local del juego en un navegador sin ventana (Playwright),
carga el script y comprueba el analizador, el selector, el modo automático, el modo libre
y el bloqueo del ranking:

```
node tests/e2e.cjs /ruta/a/una/copia/de/pokesurvivor [carpeta-para-capturas]
```

La copia del juego no va en este repositorio.

## Respeto al juego

PokéSurvivor es de JPTER78 (código bajo PolyForm Noncommercial 1.0.0 desde el
14-10-2026). Este ayudante es de uso personal y gratuito: nada de venderlo ni ponerle
anuncios. Pokémon y sus sprites son marcas de Nintendo / Creatures / GAME FREAK.
