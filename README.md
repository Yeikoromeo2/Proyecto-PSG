# Proyecto PSG · Ayudante para PokéSurvivor

Script que se ejecuta **dentro de [PokéSurvivor](https://pokesurvivor.com)** con dos partes:
un **analizador de tu colección** y una **ayuda con las cartas** que salen al subir de nivel.

## Analizador de colección

En el menú principal aparece el botón **⭐ Analizador** (junto a *Pokémon*). Abre una
lista con todos tus Pokémon, cada uno con dos barras (⚔ potencia y 🛡 aguante, de 0 a 100
respecto al mejor de tu colección), ordenable por *Más potentes*, *Más aguante*,
*Potencia + aguante*, *Naturaleza o habilidad a revisar*, *Más usados* o *Nº de Pokédex*,
y con buscador. Tocando uno ves:

- **Naturaleza** (✅ ideal/buena · ➖ normal/neutra · ⚠️ floja · ❌ mala): se juzga según el
  lado con el que pega su mejor plan (físico o especial). Si no es la ideal, te dice qué
  **Menta** comprar (Firme / Modesta, o Huraña / Afable si su plan mezcla los dos lados).
- **Habilidad**: qué hace, y cómo rinde cada una de sus opciones (también la oculta) sobre
  su plan. Si otra le da claramente más daño, te dice qué **Cápsula** usar.
- **Aguante**: su vida (con la de tus mejoras), cuánto más o menos daño físico y especial
  recibe según su Defensa y Defensa Especial (el juego lo deja entre −22 % y +25 %), su
  velocidad respecto a la media y lo que suman tus mejoras compradas (Coraza, regeneración…).
- **Plan de 4 ataques**: los que más daño le darían ya evolucionados, con su **combo de
  evolución** (ataque al máximo + la mejora de stat que pide → «Ataque +») y las mejoras de
  stat que conviene coger en la partida.
- **Copia de seguridad · mover la partida a otra cuenta** (botón **⇄ Copia de partida** del menú principal, o **⇄ Copia** arriba en el Analizador): exporta **tu
  progreso** (Pokémon, mejoras, naturalezas, MT…) a un archivo o texto, e impórtalo en otra cuenta.
  **No borra nada**: sólo añade lo que falte. Sirve para pasar tu partida a una cuenta de **nombre y
  contraseña** (así entras en la app con el ayudante, sin depender de Google). Mueve datos del juego,
  no el inicio de sesión. Después, pulsa **Guardar** en el juego para subir la partida a la nube.
- **Fijar tu propio plan**: en *Todos sus ataques* toca 📌 junto a los ataques que quieras
  (hasta 4, también potenciadores). Van primero en el plan y los huecos que dejes se rellenan
  con los mejores calculados. *↺ Volver al calculado* lo deshace. Se guarda en este navegador,
  por cuenta y por Pokémon, y **las cartas de nivel siguen ese plan**.
- **Movimiento inicial**: si el que tiene está en su plan o cuál le iría mejor.
- **MT** que entrarían en su plan, y la tabla con todos sus ataques posibles.

La **potencia** es un índice aproximado (daño × proyectiles ÷ recarga, con extra para los
ataques de área, su naturaleza, su habilidad, el bonus de Pokémon de un solo tipo y tus
mejoras compradas de ataque, recarga y crítico). El **aguante** es su vida entre el daño
medio que recibe (mitad físico, mitad especial), más la regeneración de tus mejoras, ajustado
por su velocidad (raíz de su velocidad entre la media) y +8 % si su habilidad es defensiva.
Los dos sirven para comparar tus Pokémon, no son números exactos de la partida.

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

## App Android (recomendada en el móvil)

La forma más cómoda y rápida en Android: la app **PokéSurvivor PSG** abre la web oficial del juego
con el motor de Chrome del sistema y el ayudante ya dentro (sin Firefox ni gestores de scripts).
Descarga: <https://github.com/Yeikoromeo2/Proyecto-PSG/releases/download/app-latest/PokeSurvivor-PSG.apk>
· instrucciones en [`android/README.md`](android/README.md).
Con **nombre y contraseña** se juega con el ayudante. Con una **cuenta de Google**, la app tiene un
«modo Google» que abre el juego con Chrome dentro de la app (Google funciona y la sesión se guarda),
pero sin el ayudante: Google no permite su inicio de sesión dentro de ventanas integradas.

> El ayudante no le quita rendimiento al juego: medido con el código publicado y la CPU frenada
> como en un móvil, el juego va igual con y sin él (59,6 fotogramas por segundo en ambos casos).
> Si notas el juego lento en Firefox, es el navegador: la app usa el motor de Chrome.

### ¿Se actualiza solo?

- **Firefox / Tampermonkey:** sí. El script lleva `@updateURL`, así que el gestor busca versiones
  nuevas por su cuenta (también puedes forzarlo con «Buscar actualizaciones» en Violentmonkey).
- **App Android:** el **ayudante** sí: la app descarga la versión nueva en segundo plano y la usa al
  volver a abrirla. La **app en sí** no: sólo hay que reinstalar el APK cuando cambie la app
  (pantallas, modos, permisos), no cuando cambie el ayudante.

## Instalación en Android con Firefox

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
   Al cargar verás la etiqueta verde «PSG ✓ funcionando» arriba en el centro (ver abajo).

**¿Cómo sé si funciona?** Nada más cargar el juego sale arriba, en el centro, una etiqueta
**PSG** (tocarla la cierra):

- gris «buscando el juego…»: el script está corriendo y esperando a que cargue el juego;
- verde «✓ funcionando» (o «✓ funcionando (modo compatible)» en Firefox Android): todo bien,
  y en el menú aparece **⭐ Analizador**; se oculta sola a los pocos segundos;
- naranja «⚠ modo limitado»: sólo funciona el analizador (las cartas no se tocan);
- roja «✗ …» con letras entre corchetes (`uw:… wj:… dv:… xn:… xf:…`): no encuentra el juego
  (sale a los 15 s). Una captura de esa etiqueta basta para saber qué falla.

**Si no sale ninguna etiqueta**, el gestor no está ejecutando el script: abre Violentmonkey
estando en pokesurvivor.com y mira que el script aparezca **sin tachar** y activado, y que su
versión sea la última (si no, vuelve a abrir el enlace del script y pulsa *Actualizar*).

El juego tiene una regla de seguridad (CSP) que bloquea los scripts metidos en la página y, en
Firefox para Android, el gestor llega tarde: desde la 0.6.0 el script se ejecuta entonces en el
espacio aislado del gestor y busca el juego por todas las vías que da Firefox.

Además, la versión publicada del juego va **encerrada en una función** y con los nombres de
sus módulos **cifrados** (es el anti-trampas del autor: `G` no existe desde fuera y sus claves
cambian de una versión a otra). Desde la 0.8.0 el script apunta los objetos que el juego crea al
cargar y reconoce cada módulo por lo que contiene (el de las cartas tiene `offer` y `STATS`, etc.),
no por su nombre; por eso tiene que arrancar antes que el juego. Si la etiqueta roja dice «el
script llegó tarde», recarga la página; si dice `faltan:…`, el juego ha cambiado y hay que
actualizar el script. Respeta la intención del autor: lo que se juegue con el modo libre no sube
al ranking (las partidas normales sí cuentan: el ayudante no toca nada de lo que revisa el
anti-trampas del juego).

En los ajustes del script en Violentmonkey, el modo de inyección debe ser **auto**.

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
PSG_SIM_XRAY=1 node tests/e2e.cjs ...   # simula el modo aislado de Firefox (variantes 1 y 2)
```

`tests/preparar-copias.cjs` prepara, a partir de una copia con el código abierto, una copia
«encerrada», otra «cifrada» como la publicada y, con `--real`, otra con el código que sirve hoy
pokesurvivor.com (necesita red hacia esa web):

```
node tests/preparar-copias.cjs /ruta/a/copia /ruta/de/salida --real
node tests/e2e.cjs /ruta/de/salida/real
```

La copia del juego no va en este repositorio.

## Respeto al juego

PokéSurvivor es de JPTER78 (código bajo PolyForm Noncommercial 1.0.0 desde el
14-10-2026). Este ayudante es de uso personal y gratuito: nada de venderlo ni ponerle
anuncios. Pokémon y sus sprites son marcas de Nintendo / Creatures / GAME FREAK.
