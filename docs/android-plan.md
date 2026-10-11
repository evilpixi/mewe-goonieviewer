# Plan: build de Android

Cómo adaptar la app (hoy Electron) para generar un APK con Capacitor 8, sin romper la versión de escritorio.

## Punto de partida

- La UI ([src/renderer/](../src/renderer/)) solo habla con `window.mewe` (`invoke` / `on`), que hoy provee el preload de Electron.
- Toda la lógica (API de MeWe, cookies por cuenta, login, imágenes, tiempo real) corre en el proceso principal de Electron ([src/main/](../src/main/)), que en Android no existe.
- Capacitor (`@capacitor/core`, `cli`, `android` 8.5.3) está instalado pero sin configurar: no hay `capacitor.config.json` ni carpeta `android/`.

### Entorno

| Requisito | Estado |
|---|---|
| Node 22+ | Node 24 |
| JDK 21 | Instalado y en el PATH |
| Android Studio | Instalado |
| `ANDROID_HOME` | Definida (`%LOCALAPPDATA%\Android\Sdk`) |
| Build-Tools 36.0.0 | Instalado |
| Plataforma API 36 | **Falta** (solo está `android-37.0`); Capacitor 8.5.3 compila con `compileSdkVersion = 36`. Instalar desde SDK Manager, o dejar que Gradle la descargue en el primer build |

## Arquitectura

La UI queda intacta. En Android, `window.mewe` lo provee un shim JS que corre la misma lógica de [src/mewe/](../src/mewe/) dentro del WebView, apoyado en un único plugin nativo para lo que el WebView no puede hacer.

```
UI (src/renderer, sin cambios)
        │ window.mewe.invoke / on
        ├── Electron: preload → ipcMain → canales compartidos
        └── Android:  shim JS → canales compartidos
                                   │
                    MeweClient + normalize (compartido)
                                   │ fetch inyectado
              Electron: fetch de Node │ Android: plugin MeweNative
```

El plugin `MeweNative` (Java, dentro de `android/app`) tiene cuatro funciones: HTTP con cookies por cuenta, login, imágenes/video y WebSocket. Las cookies de cada cuenta viven en nativo, porque también las necesitan las imágenes y el WebSocket.

### Qué reemplaza a cada pieza de Electron

| Pieza en Electron | Problema en Android | Reemplazo |
|---|---|---|
| Puente `window.mewe` ([preload.cjs](../src/preload/preload.cjs)) | No existe | Shim JS con el mismo contrato |
| `fetch` con `cookie`, `origin`, `referer` ([client.js](../src/mewe/client.js)) | El WebView prohíbe esos headers y MeWe bloquea por CORS | HTTP nativo (OkHttp) |
| Una `partition` por cuenta ([accountManager.js](../src/main/accountManager.js)) | El WebView tiene un solo almacén de cookies | Almacén de cookies por cuenta en el plugin |
| Ventana de login con captcha ([loginWindow.js](../src/main/loginWindow.js)) | No hay `BrowserWindow`; `session-id` es httpOnly | WebView nativo que lee las cookies y las pasa a la cuenta |
| Protocolo `mewe-img://` ([imageProtocol.js](../src/main/imageProtocol.js)) | No hay esquemas propios | Interceptar una ruta del mismo origen en nativo |
| WebSocket con cookies ([realtime.js](../src/main/realtime.js)) | El `WebSocket` del navegador no acepta headers | WebSocket nativo (OkHttp) |
| `fs`, `Buffer`, `process.env` | No hay Node | Almacenamiento nativo, `Uint8Array`, hooks inyectados |
| Guardar, copiar, zoom, color de avatar ([ipc.js](../src/main/ipc.js)) | Usan `dialog`, `clipboard`, `nativeImage` | Descargas nativas, `navigator.clipboard`, CSS, canvas |

## Fases

### Fase 0 — Prueba del login

Va primero por ser el mayor riesgo: si falla, hay que replantear el enfoque antes de tocar el resto.

- [x] Crear `capacitor.config.json` (`appId: com.evilpixi.meweviewer`, `webDir: www`) y correr `npx cap add android`.
- [x] Plugin mínimo ([MeweNativePlugin.java](../android/app/src/main/java/com/evilpixi/meweviewer/MeweNativePlugin.java)) que abre un WebView con `mewe.com/login` y lee las cookies, incluida `session-id`.
- [x] Página de prueba provisoria en `www/` (se reemplaza en la fase 4) con el mismo CSP de la app.
- [x] Probar en un dispositivo (`npm run android:run`): que el login termine y que el `GET /api/v2/me/info` nativo devuelva el perfil.
- [x] Comprobar en el dispositivo que el puente de Capacitor carga con el CSP actual (`script-src 'self'`).

Resultado (emulador, API 37): el puente carga, el login termina y el perfil vuelve con HTTP 200 tanto al loguear como después de borrar las cookies del WebView. Las cookies copiadas incluyen las de sesión (`session-id`, `refresh-token`, `access-token`, `csrf-token`) y las del CDN de imágenes (`CloudFront-*`). Falta repetirlo en un teléfono real.

**Se da por buena si:** el captcha de MeWe funciona dentro del WebView y la sesión sirve fuera de él.

### Fase 1 — Separar lo compartido de Electron

Sin cambio de comportamiento en escritorio.

- [x] [config.js](../src/config.js): proteger el uso de `process` para que cargue en un navegador.
- [x] [client.js](../src/mewe/client.js): recibir `fetch` por constructor, cambiar `Buffer` por `Uint8Array` y sacar el volcado de debug (`fs` / `path`) a un hook que inyecta Electron.
- [x] [emoji.js](../src/mewe/emoji.js): que [build-emoji.js](../scripts/build-emoji.js) genere un módulo `.js` en vez de importar JSON (un WebView antiguo no soporta `with { type: 'json' }`).
- [x] [ipc.js](../src/main/ipc.js): mover la tabla de canales (`feed:*`, `post:*`, `chat:*`…) a [src/core/channels.js](../src/core/channels.js); en Electron quedan el envoltorio `ipcMain.handle` y los canales `ui:*`.
- [x] [accountManager.js](../src/core/accountManager.js) y [accountStore.js](../src/core/accountStore.js): pasan a `src/core/` y reciben lo específico de la plataforma (crear cookies, login, borrar sesión, leer y escribir la lista de cuentas).
- [x] [realtime.js](../src/core/realtime.js): pasa a `src/core/` y recibe la fábrica del WebSocket; la lógica de ack, pong y reconexión queda compartida.

Lo que Electron aporta al código compartido está en [src/main/platform.js](../src/main/platform.js): es la referencia de lo que tiene que implementar el shim de Android.

**Se da por buena si:** la app de escritorio funciona igual que antes (login, feed, chat, imágenes, tiempo real). Probado a mano: funciona.

### Fase 2 — Plugin nativo completo

El código está en `android/app/src/main/java/com/evilpixi/meweviewer/`. Las cookies nunca pasan por el WebView: las agrega y las guarda nativo.

- [x] `request` ([MeweNativePlugin.java](../android/app/src/main/java/com/evilpixi/meweviewer/MeweNativePlugin.java)): HTTP con OkHttp y un almacén de cookies por cuenta, persistido ([CookieStore.java](../android/app/src/main/java/com/evilpixi/meweviewer/CookieStore.java)); devuelve estado, headers y cuerpo en base64. Solo acepta URLs de MeWe.
- [x] `loginOpen` / `loginClose` ([LoginWindow.java](../android/app/src/main/java/com/evilpixi/meweviewer/LoginWindow.java)): lo validado en la fase 0; copia las cookies a la cuenta y avisa con el evento `loginSession`. Acepta el script de relleno del formulario (el de [loginWindow.js](../src/main/loginWindow.js) se comparte en la fase 3).
- [x] Imágenes y video ([MediaServer.java](../android/app/src/main/java/com/evilpixi/meweviewer/MediaServer.java)): intercepta `/_mewe-img/<cuenta>?u=…` y la sirve con las cookies de la cuenta, con los rangos y la caché de imágenes temporales de [imageProtocol.js](../src/main/imageProtocol.js).
- [x] `wsOpen` / `wsSend` / `wsClose`: WebSocket por cuenta con cookies, con eventos `ws` hacia JS.
- [x] `saveMedia`: guarda una imagen o video en la galería (`Pictures/Goonie Mewe` o `Movies/Goonie Mewe`). Requiere Android 10 o posterior.
- [x] `clearAccount`: borra las cookies de una cuenta.
- [x] `getCookie`, `storageGet` y `storageSet`: el `csrf-token` para las cabeceras y la lista de cuentas.
- [x] `setTextZoom`: el "zoom" de los ajustes de UI (tamaño del texto del WebView).
- [x] Probado en el emulador con una página provisoria: sesión que sobrevive a reabrir la app, imagen, tiempo real, guardado y cierre de sesión.

La captura de errores de `/auth/login` por DevTools no tiene equivalente: el usuario verá el error en la propia página de MeWe. El resultado del relleno automático tampoco vuelve a la app.

### Fase 3 — Shim de Android (JS)

El shim está en [src/android/](../src/android/).

- [x] `window.mewe` con el mismo contrato `invoke` / `on`, sobre los canales compartidos ([bridge.js](../src/android/bridge.js)).
- [x] Adaptador de `fetch` nativo que devuelve un `Response` real; los `FormData` de subida se serializan antes de cruzar el puente ([platform.js](../src/android/platform.js)).
- [x] Adaptadores de cookies, lista de cuentas (almacenamiento nativo), login y WebSocket. El script de relleno del login pasó a [src/core/loginPrefill.js](../src/core/loginPrefill.js).
- [x] Canales `ui:*` ([ui.js](../src/android/ui.js)): color de avatar con canvas, copiar texto con `navigator.clipboard`, zoom como tamaño de texto, descarga vía `saveMedia`. Copiar imagen se intenta con el portapapeles web; si el WebView no deja, avisa que no se pudo.
- [x] [api.js](../src/renderer/js/api.js): `imageUrl()` usa la ruta interceptada en Android.
- [x] [index.html](../src/renderer/index.html): `media-src` admite `'self'` para los videos servidos por nativo.
- [ ] Probar en un dispositivo.

**Se da por buena si:** en Android se puede agregar una cuenta, ver el feed con imágenes, chatear y recibir mensajes en tiempo real.

### Fase 4 — Empaquetado web

- [x] [scripts/build-android.js](../scripts/build-android.js): arma `www/` con la UI (`src/renderer`) y, en `www/_app/`, la lógica compartida y el shim; inserta el `<script>` del shim antes de `app.js`. Sin bundler, como el resto del proyecto. El runtime de Capacitor no hace falta: el puente lo inyecta la app.
- [x] Scripts npm `android:www`, `android:sync` y `android:run` (los dos últimos arman `www/` antes).
- [x] Mover los paquetes `@capacitor/*` a `devDependencies`, para que no entren en el paquete de escritorio.
- [x] Añadir `www/` a [.gitignore](../.gitignore) (los artefactos de build de `android/` ya los ignora `android/.gitignore`).

### Fase 5 — Ajustes de UI móvil

- [x] Botón "atrás" de Android: el plugin avisa con el evento `back`, [bridge.js](../src/android/bridge.js) lo pasa a la UI como `mewe:back` y [app.js](../src/renderer/js/app.js) cierra, en este orden, un menú, un diálogo o visor, la conversación abierta (vuelve a la lista) o la vista actual. Si no hay nada que cerrar, la app se va al fondo.
- [x] Áreas seguras y teclado: en la vista principal ya los resuelve Capacitor 8 (plugin `SystemBars`) junto con los `env(safe-area-inset-*)` del CSS. Se agregaron a los visores a pantalla completa (imágenes, historias y editor de historias).
- [x] Iconos de las barras del sistema según el tema de la app ([systemBars.js](../src/android/systemBars.js)).
- [x] Hover, clic derecho y atajos de teclado: revisado. Lo que aparece con hover (acciones de los mensajes, reacciones) ya tiene su regla en el CSS mobile; los atajos solo son accesos rápidos.
- [ ] Probar en un dispositivo.

### Fase 6 — Build

- [x] Íconos y splash desde [build/icon.png](../build/icon.png), en `android/app/src/main/res/` (`mipmap-*` y `drawable*/splash.png`). Se generaron una vez, a mano: `@capacitor/assets` no corre en Node 24.
- [x] `versionCode` y `versionName`: salen de la versión de `package.json` (`1.2.3` → `10203`), en [android/app/build.gradle](../android/app/build.gradle).
- [x] APK de debug: `npm run android:run` lo compila e instala; queda en `android/app/build/outputs/apk/debug/app-debug.apk`.
- [x] Release: `npm run android:apk` ([scripts/build-apk.js](../scripts/build-apk.js)) deja el APK firmado en `dist/`. Para Play Store, en `android/`: `.\gradlew bundleRelease` (AAB).
- [ ] Probar el APK de release en un teléfono.

**Firma.** La clave está en `android/meweviewer-release.jks` y sus contraseñas en `android/keystore.properties`. Ninguno de los dos va al repo. Hay que guardar una copia de ambos: Android solo acepta actualizar la app con un APK firmado con la misma clave; si se pierde, hay que desinstalar y volver a instalar (y a loguear las cuentas).

**Instalar en un teléfono.** Con depuración USB activada y el teléfono conectado: `adb install -r dist\Goonie-Mewe-Viewer-<versión>.apk`. Sin cable, copiar el APK al teléfono y abrirlo (pide permitir "instalar apps desconocidas").

## Riesgos conocidos

- **Captcha en WebView**: MeWe podría no mostrarlo o rechazarlo dentro de un WebView. Lo despeja la fase 0.
- **CSP y el puente de Capacitor**: `script-src 'self'` podría bloquear la inyección del puente en WebViews antiguos. Se comprueba en la fase 0.
- **Segundo plano**: el tiempo real se corta al salir de la app y no habrá notificaciones push.
- **API interna de MeWe**: igual que en escritorio, los endpoints pueden cambiar sin aviso.
