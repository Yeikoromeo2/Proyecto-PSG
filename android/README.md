# App Android · PokéSurvivor PSG

Una **ventana** para jugar a [PokéSurvivor](https://pokesurvivor.com) en Android con el
**motor de Chrome del sistema** (Android System WebView) y el **ayudante PSG** dentro.

- Abre la web oficial tal cual: el mismo juego, el mismo inicio de sesión y tus partidas en la nube.
  La app no cambia nada del juego.
- No necesita Firefox, Violentmonkey ni ningún gestor de scripts: el ayudante va dentro y se
  carga antes que el juego en cada página.
- Pensada para jugar mejor: pantalla completa en horizontal, pantalla siempre encendida,
  prioridad alta para el proceso que dibuja el juego, sin menús de «copiar» al dejar el dedo
  quieto, y marcada como juego para el Modo juego de Android 12+.

## Instalar

1. En el móvil, descarga el APK:
   <https://github.com/Yeikoromeo2/Proyecto-PSG/releases/download/app-latest/PokeSurvivor-PSG.apk>
2. Ábrelo. Android pedirá permiso para **instalar apps de origen desconocido** desde el navegador
   (o el gestor de archivos): concédelo para esa app y vuelve atrás.
3. Pulsa **Instalar**. Play Protect puede avisar de que la app no es de la tienda: es normal en
   apps instaladas a mano. Elige *Instalar de todas formas*.
4. Abre **PokéSurvivor PSG** y entra con tu cuenta como siempre.

**Actualizar:** descarga el APK de nuevo e instálalo encima (si la versión dice «firma fija»; si
dice «firma temporal», desinstala antes la anterior y vuelve a entrar con tu cuenta: la partida está
en la nube). Ver «Firma» más abajo.

## Inicio de sesión: dos modos

La app recuerda el último modo que usaste.

- **Modo ayudante** (el normal): el juego con el ayudante PSG dentro. Se entra con **nombre y
  contraseña**, igual que en el navegador. El botón **de Google** no funciona aquí: Google no
  permite su inicio de sesión dentro de ventanas integradas (es una regla de seguridad de Google).
- **Modo Google**: si tocas «Iniciar con Google», la app te ofrece este modo. El juego se abre
  con **Chrome dentro de la app** (una «pestaña personalizada»): ahí el inicio con Google funciona
  y la sesión se queda guardada. Al abrir la app, va directo al juego. **En este modo no está el
  ayudante**: Chrome no deja meter scripts en sus pestañas. Al cerrar el juego (atrás o la ✕ de
  arriba) ves los botones «▶ Jugar» y «Cambiar a modo ayudante».

¿Por qué no se puede iniciar sesión con Google en Chrome y volver al modo ayudante ya conectado?
El juego guarda la sesión en el navegador donde se inicia, y Android no deja que otra app la lea.
Para que una app reciba el inicio de sesión de Google, el autor del juego tendría que registrarla
en su proyecto de Google. Hacerse pasar por un navegador para saltarse la regla de Google no es una
opción: es lo que hacen las apps de robo de cuentas y Google puede bloquear la cuenta.

**Google + ayudante a la vez:** un navegador que acepte extensiones y tenga Tampermonkey o
Violentmonkey. Comprobado: Firefox para Android. Sin comprobar (basados en Chrome, por eso
quizá más rápidos): Quetta o Lemur con Tampermonkey. La etiqueta verde «PSG ✓ funcionando» dice si va.

## Cómo está hecha

- `app/src/main/java/.../MainActivity.java`: la ventana (WebView) y sus ajustes.
- El ayudante es el mismo `pokesurvivor-ayudante.user.js` de la raíz del repositorio: se copia
  dentro del APK al compilar. Se inyecta con `WebViewCompat.addDocumentStartJavaScript`, el
  equivalente a «document-start» de Violentmonkey (y no le afecta la CSP del juego).
- Enlaces de fuera del juego (YouTube, Discord…) se abren en su app o en el navegador.

## Compilar

Lo hace GitHub Actions en cada cambio (`.github/workflows/android.yml`) y publica el APK en la
versión `app-latest`. A mano, con el SDK de Android (plataforma 35) y Java 17 o superior:

```
cd android
ANDROID_HOME=/ruta/al/sdk ./gradlew lintRelease assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

## Firma

La llave de firma **no está en el repositorio** (es público): GitHub Actions la lee de los
**Secrets** del repositorio (Settings → Secrets and variables → Actions):

| Secret | Contenido |
|---|---|
| `PSG_KEYSTORE_B64` | el archivo `.keystore` en base64 |
| `PSG_KEYSTORE_PASSWORD` | su contraseña |

Con esos dos secrets, todas las versiones llevan la misma firma y se instalan encima de la
anterior. Sin ellos, Actions firma con una llave temporal: la app funciona igual, pero para
actualizar hay que desinstalar antes (la partida está en la nube; sólo hay que volver a entrar).

Para compilar a mano con la llave: `PSG_KEYSTORE=/ruta/psg.keystore PSG_KEYSTORE_PASSWORD=… ./gradlew assembleRelease`.
