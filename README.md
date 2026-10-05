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
interfaz compacta que se puede adaptar a gusto: temas, colores, tamaño de texto, espaciado e iconos.

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
- Tres vistas: todo, grupos y perfiles.
- Reacciones con emojis, y quién reaccionó con cada uno.
- Comentarios y respuestas a comentarios.
- Galería con todas las imágenes de una publicación y visor a pantalla completa con zoom y descarga.

### Chats
- Chats con personas, de grupos y de eventos, con filtro por tipo.
- Mensajes nuevos en tiempo real (websocket), agrupados por día.
- Responder a un mensaje; al hacer click en una respuesta se salta al mensaje original.
- Reacciones con emojis, y quién las puso.
- Edición de mensajes propios.
- Envío de imágenes y GIFs con el botón 📎, pegando con `Ctrl+V` o arrastrándolas a la conversación.
- Temporizador para las imágenes enviadas (de 5 segundos a 24 horas).
- Visor de imágenes a pantalla completa y descarga.

### Perfiles
- Información del perfil, sus publicaciones y una pestaña con sus imágenes.
- Seguir y dejar de seguir; aceptar o rechazar solicitudes de seguimiento.
- Manejo de cuentas privadas.
- Búsqueda de personas y acceso directo para abrir un chat.

### Grupos
- Lista de tus grupos e invitaciones pendientes.
- Publicaciones, miembros (con filtro de administradores), eventos próximos y pasados, y chat del grupo.
- Unirse, salir e invitar contactos.

### Notificaciones
- Contador de pendientes en la cabecera.
- Las de grupos van en una pestaña aparte.
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

## Cómo se usa

1. **Agregar una cuenta:** click en el botón **+** de la columna izquierda. Escribí tu email o teléfono (la contraseña
   es opcional: sólo sirve para rellenar el formulario) y pulsá **Iniciar sesión**. Se abre la ventana de MeWe: resolvé
   el captcha ahí y la cuenta queda agregada.
2. **Cambiar de cuenta:** click en su avatar en la columna izquierda.
3. **Moverte por la app:** las pestañas **Feed**, **Chats** y **Grupos** de la cabecera. A la derecha están la búsqueda
   de personas (🔍), las notificaciones (🔔), actualizar (⟳) y los ajustes (⚙).
4. **Personalizar:** en ⚙ elegís el tema, los colores y los tamaños. Cada cambio se aplica y se guarda al instante.
5. **Si la sesión vence:** el botón **Reconectar** vuelve a iniciarla. **Quitar** elimina la cuenta de la app.

### Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` | Feed / Chats / Grupos |
| `Alt+←` | Volver |
| `F5` | Actualizar la vista |
| `Enter` | Enviar mensaje o comentario (`Shift+Enter`: salto de línea) |
| `Esc` | Cancelar la respuesta o la edición; cerrar paneles y el visor |
| `←` / `→` | Imagen anterior / siguiente en el visor |
| `Z` / `D` | Zoom / descargar en el visor |

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
