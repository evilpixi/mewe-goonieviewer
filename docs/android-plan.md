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

- [ ] Crear `capacitor.config.json` (`appId: com.evilpixi.meweviewer`, `webDir: www`) y correr `npx cap add android`.
- [ ] Plugin mínimo que abra un WebView con `mewe.com/login` y lea las cookies, incluida `session-id`.
- [ ] Hacer un `GET /api/v2/me/info` nativo con esas cookies y comprobar que devuelve el perfil.
- [ ] Comprobar que el puente de Capacitor carga con el CSP actual (`script-src 'self'`).

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

- [ ] `request`: HTTP con OkHttp y un almacén de cookies por cuenta, persistido; devuelve estado, headers y cuerpo (texto o base64).
- [ ] `login`: lo validado en la fase 0, más el relleno automático del formulario reutilizando el script de [loginWindow.js](../src/main/loginWindow.js).
- [ ] Imágenes y video: interceptar `/_mewe-img/<cuenta>?u=…` y servirla con las cookies de la cuenta, portando los rangos y la caché de imágenes temporales de [imageProtocol.js](../src/main/imageProtocol.js).
- [ ] WebSocket por cuenta con cookies, con eventos hacia JS.
- [ ] `saveMedia`: guardar una imagen o video directo en Descargas.
- [ ] `clearAccount`: borrar las cookies de una cuenta.

La captura de errores de `/auth/login` por DevTools no tiene equivalente: el usuario verá el error en la propia página de MeWe.

### Fase 3 — Shim de Android (JS)

- [ ] `window.mewe` con el mismo contrato `invoke` / `on`, sobre los canales compartidos.
- [ ] Adaptador de `fetch` nativo que devuelve un `Response` real; los `FormData` de subida se serializan antes de cruzar el puente.
- [ ] Adaptadores de cookies, lista de cuentas (almacenamiento nativo) y WebSocket.
- [ ] Canales `ui:*`: color de avatar con canvas, copiar texto con `navigator.clipboard`, zoom por CSS, descarga vía `saveMedia`. Copiar imagen queda oculto en Android.
- [ ] [api.js](../src/renderer/js/api.js): que `imageUrl()` use la ruta interceptada en Android.
- [ ] [index.html](../src/renderer/index.html): ajustar el CSP (`img-src` y `media-src`).

**Se da por buena si:** en Android se puede agregar una cuenta, ver el feed con imágenes, chatear y recibir mensajes en tiempo real.

### Fase 4 — Empaquetado web

- [ ] `scripts/build-android.js`: arma `www/` con la UI, la lógica compartida, el shim y el runtime de Capacitor, e inserta el `<script>` del shim antes de `app.js`. Sin bundler, como el resto del proyecto.
- [ ] Scripts npm `android:sync` y `android:run`.
- [ ] Mover `@capacitor/cli` a `devDependencies`.
- [ ] Añadir `www/` y los artefactos de build de `android/` a [.gitignore](../.gitignore).

### Fase 5 — Ajustes de UI móvil

- [ ] Botón "atrás" de Android: cerrar diálogo o visor, o volver de la conversación a la lista.
- [ ] Áreas seguras (barra de estado y de navegación) y redimensionado con el teclado.
- [ ] Revisar lo que hoy depende de hover, clic derecho o atajos de teclado.

### Fase 6 — Build

- [ ] Íconos y splash desde [build/icon.png](../build/icon.png).
- [ ] `versionCode` y `versionName`.
- [ ] APK de debug: en `android/`, `.\gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`.
- [ ] Release: keystore con `keytool`, firma en `android/app/build.gradle`, y `.\gradlew assembleRelease` (APK) o `bundleRelease` (AAB para Play Store).

## Riesgos conocidos

- **Captcha en WebView**: MeWe podría no mostrarlo o rechazarlo dentro de un WebView. Lo despeja la fase 0.
- **CSP y el puente de Capacitor**: `script-src 'self'` podría bloquear la inyección del puente en WebViews antiguos. Se comprueba en la fase 0.
- **Segundo plano**: el tiempo real se corta al salir de la app y no habrá notificaciones push.
- **API interna de MeWe**: igual que en escritorio, los endpoints pueden cambiar sin aviso.
