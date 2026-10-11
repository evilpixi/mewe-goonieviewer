<div align="center">

<img src="build/icon.png" alt="Ícono de Goonie Mewe Viewer: un gato naranja sonriendo" width="160" />

# Goonie Mewe Viewer

**Cliente de escritorio compacto y multi-cuenta para [MeWe](https://mewe.com).**

[![Última versión](https://img.shields.io/github/v/release/evilpixi/mewe-goonieviewer?label=versi%C3%B3n)](https://github.com/evilpixi/mewe-goonieviewer/releases/latest)
[![Licencia MIT](https://img.shields.io/github/license/evilpixi/mewe-goonieviewer?label=licencia)](LICENSE)
![Plataforma](https://img.shields.io/badge/plataforma-Windows-blue)

[**Descargar para Windows**](https://github.com/evilpixi/mewe-goonieviewer/releases/latest)

</div>

Goonie Mewe Viewer es una aplicación de escritorio hecha con Electron para usar MeWe con varias cuentas a la vez, en una
interfaz compacta que se puede adaptar a gusto: temas, colores, tamaño de texto, espaciado e iconos. Incluye feed,
chats, historias, perfiles, grupos y notificaciones.

> [!IMPORTANT]
> Proyecto **no oficial**: no está afiliado ni respaldado por MeWe. Usa la API interna de la web de MeWe, que no está
> documentada y puede cambiar sin aviso, así que alguna función puede dejar de andar de un día para otro.
> Usalo bajo tu propia responsabilidad y respetando los términos de servicio de MeWe.

## Características

### Cuentas
- Varias cuentas abiertas a la vez, en una columna lateral para cambiar de una a otra con un click.
- Cada cuenta tiene su sesión aislada (cookies propias) y puede tener su propio tema y colores.
- El login se hace en la ventana oficial de MeWe, captcha incluido. **La contraseña no se guarda.**

### Feed
- Tres vistas: todo, personas y grupos.
- Crear publicaciones con texto e imágenes, en tu feed o en un grupo, con borrador automático; editar el texto de las propias.
- Reacciones con emojis, y quién reaccionó con cada uno.
- Comentarios y respuestas a comentarios.
- Galería con todas las imágenes de una publicación y visor a pantalla completa con zoom, guardar y copiar al portapapeles.

### Chats
- Chats con personas, de grupos y de eventos, con filtro por tipo.
- Mensajes nuevos en tiempo real (websocket), agrupados por día.
- Responder a un mensaje; al hacer click en una respuesta se salta al mensaje original.
- Reacciones con emojis, y quién las puso.
- Edición de mensajes propios.
- Envío de imágenes y GIFs con el botón 📎, pegando con `Ctrl+V` o arrastrándolas a la conversación.
- Temporizador para las imágenes enviadas (de 5 segundos a 24 horas).
- Videos que se reproducen dentro de la conversación.
- Las respuestas a una historia muestran una vista previa de esa historia.
- Visor de imágenes a pantalla completa, con guardar y copiar.
- Bloquear a una persona desde su chat.

### Historias
- Grilla, sobre fondo negro, con quienes tienen historias; las que todavía no viste quedan resaltadas.
- Visor a pantalla completa para fotos y videos: pasan solas, se pausan manteniendo apretado y se adapta a pantallas angostas.
- Desde el visor: guardar la historia, responderle a su autor (le llega como mensaje de chat) o ir a su perfil.
- En las tuyas: cuántas personas las vieron, y borrarlas.
- Editor para crear una: imagen de fondo (entera o recortada a 9:16) con textos y emojis encima. Cada uno se mueve, se
  gira y se agranda; el texto tiene 10 fuentes, color y un fondo opcional para que se lea.
- Se publica para tus seguidores, para todos o para tus amigos cercanos.

### Perfiles
- Información del perfil, sus publicaciones y pestañas con sus imágenes y sus álbumes.
- Al abrir una imagen del perfil, el visor muestra al lado su publicación, con el texto y los comentarios.
- Foto de perfil y portada a pantalla completa al hacer click.
- Seguir y dejar de seguir; aceptar o rechazar solicitudes de seguimiento, y seguir también a quien se acepta.
- Manejo de cuentas privadas.
- Búsqueda de personas y acceso directo para abrir un chat.
- Bloquear y copiar el link de un perfil.
- En tu perfil: editar la foto, la portada y tus datos, y las listas de solicitudes de seguimiento y de bloqueados.

### Listas y grupos
- Lista de tus grupos e invitaciones pendientes, y de las personas que seguís y que te siguen, con filtro por nombre.
- Desde una persona: ver su perfil, enviarle un mensaje, copiar su link o bloquearla.
- Publicaciones, miembros (con filtro de administradores), eventos próximos y pasados, y chat del grupo.
- El chat de un grupo se abre desde la lista o desde el grupo, dentro de la sección Chats.
- Unirse, salir e invitar contactos.

### Notificaciones
- Contador de pendientes en la cabecera.
- Las de grupos van en una pestaña aparte.
- Aceptar o rechazar solicitudes de seguimiento y seguir a quien te sigue (si todavía no lo seguís), desde la misma lista.
- Al hacer click llevan al lugar correspondiente: perfil, publicación, comentario o mensaje.

### Interfaz y accesibilidad
- 14 temas: automático, claro, oscuro, minimal, glass, retro, alto contraste, medianoche, nórdico, bosque, ámbar, sepia,
  océano y rosa.
- Colores personalizables (acento, fondo, paneles, texto y columna de cuentas) con indicador de contraste.
- Escalas independientes de zoom, tamaño de fuente, texto de los chats, interlineado, espaciado e iconos.
- Ajustes rápidos «Escritorio» y «TV a distancia».
- Navegación por teclado y etiquetas para lectores de pantalla.
- Fuentes de respaldo para que se lean bien los nombres con símbolos «raros».

## Instalación (Windows)

1. Entrá a la [última versión](https://github.com/evilpixi/mewe-goonieviewer/releases/latest).
2. Descargá una de las dos variantes:
   - `Goonie-Mewe-Viewer-Setup-x.y.z.exe`: instalador. Crea accesos directos y se desinstala desde Windows.
   - `Goonie-Mewe-Viewer-x.y.z-portable.exe`: portable. Se ejecuta directo, sin instalar.
3. Abrí el archivo.

> [!NOTE]
> El ejecutable todavía **no está firmado digitalmente**, así que Windows SmartScreen va a mostrar
> «Windows protegió su PC». Para continuar: **Más información → Ejecutar de todas formas**.
> Descargalo siempre desde la página de Releases de este repositorio y, si querés, verificá su integridad.

### Verificar la descarga

Cada versión incluye un archivo `SHA256SUMS.txt`. En PowerShell:

```powershell
Get-FileHash .\Goonie-Mewe-Viewer-Setup-0.1.0.exe -Algorithm SHA256
```

El hash que aparece tiene que coincidir con el de `SHA256SUMS.txt`.

## Instalación (macOS)

1. Entrá a la [última versión](https://github.com/evilpixi/mewe-goonieviewer/releases/latest).
2. Descargá el `.dmg` que corresponda a tu Mac:
   - `Goonie-Mewe-Viewer-x.y.z-mac-arm64.dmg`: Apple Silicon (M1 en adelante).
   - `Goonie-Mewe-Viewer-x.y.z-mac-x64.dmg`: Intel.
3. Abrí el `.dmg` y arrastrá la app a **Aplicaciones**.

> [!NOTE]
> La app **no está firmada ni notarizada por Apple**, así que la primera vez macOS se niega a abrirla.
> Para continuar: **Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente**.
> Descargala siempre desde la página de Releases de este repositorio y, si querés, verificá su integridad:
>
> ```bash
> shasum -a 256 Goonie-Mewe-Viewer-0.1.0-mac-arm64.dmg
> ```

## Cómo se usa

1. **Agregar una cuenta:** click en el botón **+** de la columna izquierda. Escribí tu email o teléfono (la contraseña
   es opcional: sólo sirve para rellenar el formulario) y pulsá **Iniciar sesión**. Se abre la ventana de MeWe: resolvé
   el captcha ahí y la cuenta queda agregada.
2. **Cambiar de cuenta:** click en su avatar en la columna izquierda.
3. **Moverte por la app:** en el centro de la cabecera están los iconos de **Feed**, **Chats**, **Listas** (tus grupos y
   personas) e **Historias**. A la izquierda, tu foto abre tu perfil. A la derecha están la búsqueda de personas, las
   notificaciones y el menú de opciones (⋮). Debajo, un segundo panel tiene los controles de cada sección
   (filtros, **Crear post**, **Actualizar**). No hay botón para volver: de un perfil, un grupo o una publicación se
   vuelve con `Alt+←`, o se va a otra sección con sus iconos.
4. **Historias:** cada tarjeta abre las historias de esa persona a pantalla completa. Pasan solas; tocá a la derecha o
   a la izquierda para cambiar y mantené apretado para pausar. Desde ahí podés guardarla, responderle a su autor o ir
   a su perfil. **Crear historia** abre el editor: elegís una imagen y le sumás textos (10 fuentes, color y fondo) y
   emojis, que se mueven arrastrándolos y se giran y agrandan con la manija de su esquina.
5. **Personalizar:** en ⋮ → **Ajustes de la interfaz** elegís el tema, los colores y los tamaños. Cada cambio se aplica
   y se guarda al instante.
6. **Si la sesión vence:** ⋮ → **Reconectar** vuelve a iniciarla. ⋮ → **Quitar cuenta** la elimina de la app.

### Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` / `Ctrl+4` | Feed / Chats / Listas / Historias |
| `Alt+←` | Volver a la vista anterior |
| `F5` | Actualizar la vista |
| `Enter` | Enviar mensaje o comentario (`Shift+Enter`: salto de línea) |
| `Esc` | Cancelar la respuesta o la edición; cerrar paneles y el visor |
| `←` / `→` | Imagen anterior / siguiente en el visor |
| `Z` / `G` / `C` | Zoom / guardar / copiar la imagen en el visor |
| `Ctrl+Enter` | Publicar desde el diálogo de crear post |
| `←` / `→` / `Espacio` / `G` | En una historia: anterior / siguiente / pausar / guardar |
| Flechas / `Supr` | En el editor de historias, con la vista previa enfocada: mover / quitar el elemento elegido |

## Privacidad

- La app habla únicamente con los servidores de MeWe (`mewe.com`, `img.mewe.com`, `ws.mewe.com`). No hay telemetría ni
  servidores propios.
- Las contraseñas no se guardan. Las cookies de sesión quedan en tu equipo, dentro de la carpeta de datos de la app
  (`%APPDATA%\meweviewer` en Windows).
- **Quitar** una cuenta borra su sesión de tu equipo.

## Desarrollo

Requisitos: [Node.js](https://nodejs.org/) 20 o superior.

```bash
git clone https://github.com/evilpixi/mewe-goonieviewer.git
cd mewe-goonieviewer
npm install
npm start
```

| Comando | Qué hace |
|---|---|
| `npm start` | Abre la app en modo desarrollo. |
| `npm run debug` | Igual, pero guarda la última respuesta de cada endpoint en `mewe-debug/` (contiene datos personales: no la subas). |
| `npm run dist:win` | Genera el instalador y el portable de Windows en `dist/`. |
| `npm run dist:mac` | Genera `.dmg` y `.zip` para macOS (arm64 y x64), sin firmar. Hay que correrlo en una Mac. |
| `npm run dist:linux` | Genera AppImage y `.tar.gz` para Linux (sin probar todavía). |
| `npm run pack` | Empaqueta sin generar instalador, para probar rápido. |
| `npm run emoji:update` | Regenera los shortcodes de emojis. |
| `npm run icons:update` | Copia los íconos de Lucide que usa la app. |

### Estructura

```
src/
  main/      Proceso principal de Electron: cuentas, login, IPC, websocket, imágenes
  mewe/      Cliente de la API de MeWe y normalización de sus respuestas
  preload/   Puente seguro entre el proceso principal y la interfaz
  renderer/  Interfaz: HTML, CSS y JavaScript sin frameworks
docs/
  endpoints.md  Endpoints de MeWe que usa la app
```

El renderer corre con `contextIsolation`, `sandbox` y una Content Security Policy estricta.

### Ramas

- `main`: versiones publicadas.
- `develop`: trabajo en curso. Los pull requests van contra esta rama.

## Contribuir

Los issues y pull requests son bienvenidos. Si MeWe cambió algo y una función dejó de andar, abrí un
[issue](https://github.com/evilpixi/mewe-goonieviewer/issues) contando qué hiciste y qué error apareció (sin pegar
datos personales ni cookies).

## Licencia

[MIT](LICENSE) © evilpixi. Los componentes de terceros están listados en
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MeWe es una marca de sus respectivos dueños.
