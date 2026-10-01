# Plan de implementación de AGENTS.md (secuencial)

Cada paso deja la app funcionando y se prueba con `npm run debug` antes de pasar al siguiente.
Los endpoints que falten se descubren **en el paso que los necesita** (bundle web de mewe.com + dumps en `mewe-debug/`)
y se anotan en `docs/endpoints.md`.

El orden pone primero lo que reutilizan los pasos siguientes (tokens, router, visor de imágenes, reacciones)
y deja para el final lo que depende de todo lo demás (notificaciones, pasada de accesibilidad).

---

## 1. Base ✅
Preparar el terreno sin cambiar el comportamiento.
(Hecho. De paso: los mensajes de chat traen la fecha en `date`, no en `createdAt`; ahora se lee bien.)
- **Tokens CSS:** pasar todos los colores, espaciados, tamaños de fuente, iconos y radios de `styles.css` a variables en `:root`.
  De acá en adelante nada se hardcodea (es lo que hace posibles los temas del paso 12).
- **Helper DOM** `ui/dom.js` (`h(tag, props, ...children)`) para no repetir `createElement`.
- **Router** `router.js`: `navigate(view, params)`, `back()`, y vistas que crean su propio DOM en un contenedor.
  Migrar feed y chats a este esquema. Lo usan perfiles, grupos, post individual, notificaciones y ajustes.
- **`ui/userName.js` y `ui/avatar.js`**: un único lugar donde se renderizan nombres y avatares.
- **Normalizar con ids**: agregar `userId` del autor a posts y mensajes, y `groupId` a los posts.
- **IPC más simple:** en el preload, `invoke(channel, ...args)` genérico con una allowlist de prefijos, para no tener que
  tocar el preload, `ipc.js` y `api.js` cada vez que se agrega un endpoint.

## 2. Visor de imágenes ✅
(De paso: las fotos del chat vienen en `attachments[]._links.self`, no en `_links.img`; por eso no se veían.)
- `ui/lightbox.js`: pantalla completa, flechas y teclado, Esc para cerrar, zoom básico, botón **Descargar**
  (IPC → `dialog.showSaveDialog` en main, descargando con las cookies de la cuenta).
- Usarlo en las imágenes del **chat** y del **feed**.
- Feed: galería con **todas** las imágenes del post (grilla 1/2/3/4+ con "+N") y el lightbox recorriéndolas todas.

Cubre: *Chat: ver y descargar imágenes, verlas en pantalla completa* · *Feed: ver imágenes en pantalla completa, ver todas las imágenes del post*.

## 3. Chat: orden y diseño compacto ✅
- Mensajes ordenados por fecha, los más recientes abajo, con **separadores por día** (Hoy / Ayer / fecha).
- Globos compactos: los mensajes seguidos del mismo autor se agrupan y no repiten el nombre; hora chica.
- Partir `chatView.js` en lista de chats / conversación / caja de redacción. La conversación tiene que servir para cualquier `threadId`
  (se reutiliza en grupos y eventos).

## 4. Reacciones (componente) + reacciones en el chat ✅
- `ui/reactions.js` + `ui/emojiPicker.js`: chips de emoji con contador, popover con **quién reaccionó**, selector para agregar o quitar.
  No sabe si se usa en un post o en un mensaje.
- Normalizar `emojis` / `emojiCounts` / `userEmojis` (ya vienen en los mensajes y en los posts).
- Endpoints: agregar y quitar reacción a un mensaje, listar quién reaccionó.

## 5. Chat: responder ✅
- Botón **Responder** al lado de cada globo; barra "respondiendo a…" en la caja de redacción.
- Cita del original dentro del globo (`replyTo` ya viene en los mensajes).
- **Click en la cita → scroll y resaltado** del original; si no está cargado, cargar anteriores hasta encontrarlo.

## 6. Chat: enviar imágenes ✅
- Adjuntar con botón, **Ctrl+V** con una imagen en el portapapeles, o **arrastrando**; vista previa con opción de quitarla.
- **Temporizador** (mensaje que desaparece). ⚠️ La web de MeWe no lo soporta; se manda `expiresIn` y la app avisa si MeWe lo ignora.
- Main: subida multipart en `MeweClient`.

## 7. Chat: grupos y tiempo real ✅
- Chats de grupo en la lista (filtro Personas / Grupos), con el nombre del autor en cada mensaje.
- Mensajes nuevos: websocket desde main si se puede reproducir; si no, mejorar el polling (pausarlo con la ventana oculta,
  actualizar los no leídos de la lista).

## 8. Feed: reacciones, comentarios y post individual ✅
- Reacciones en posts (componente del paso 4).
- Comentarios: listar (paginado), comentar, responder, reaccionar a comentarios.
- Vista **post individual** con sus comentarios (destino de las notificaciones).
- Click en un autor → perfil; click en un grupo → grupo (las vistas llegan en los pasos 9 y 10).
- Mover `renderPost` a `ui/post.js` para reutilizarlo en perfiles y grupos.

## 9. Perfiles ✅
(Implementado; seguir / dejar de seguir / aceptar solicitudes falta probarlo con una cuenta real.
El estado de seguimiento viene al lado de `user` en la respuesta, no adentro. Se llega al perfil propio con click en el nombre de la cuenta.)
- Cabecera con la info del perfil; pestañas **Publicaciones** e **Imágenes** (grilla → lightbox).
- Cuenta privada: mostrar el estado y ocultar el contenido.
- Seguir, dejar de seguir, solicitud pendiente; **aceptar o rechazar** solicitudes de seguimiento.

## 10. Grupos ✅
(Implementado; unirse, salir, invitar y el chat de un evento faltan probarse con una cuenta real.
Además del chat de cada evento, la cabecera del grupo abre el chat del grupo: ambos usan la vista `thread`.)
- Lista de mis grupos y vista de grupo con pestañas: **Publicaciones**, **Miembros** (filtro de admins), **Eventos**.
- Cada evento con su **chat** (reutiliza la conversación del paso 3).
- Unirse, salir e invitar (buscador de contactos).

## 11. Notificaciones ✅
(Implementado; los enlaces de cada tipo de notificación faltan probarse uno por uno, ver paso 13.
Arriba de la lista aparecen las solicitudes de seguimiento recibidas, con Aceptar / Rechazar.)
- Lista con contador de no leídas en el header; marcar como leídas; actualización periódica.
- Separadas en **Generales** y **Grupos** (publicaciones en grupos).
- Click: seguimiento → perfil; reacción o comentario → post; mención → donde ocurrió (post con el comentario resaltado, o el mensaje en el chat).

## 12. Ajustes de UI y temas ✅
(Implementado, falta verlo en pantalla. Fuentes empaquetadas en `src/renderer/fonts`: Noto Sans Math, Symbols y Symbols 2.
No se empaquetaron Noto Sans ni Noto Color Emoji (~10 MB): para eso se usa la fuente del sistema.)
- Vista de ajustes (guardada en `localStorage`): **zoom** (`webContents.setZoomFactor`), **tamaño de fuente**,
  **densidad** (padding/margin), **tamaño de iconos**, **tema** y colores.
- Temas con estilos distintos: Claro, Oscuro, **Minimal**, **Glass** (blur y transparencias), **Stale/retro**, **Alto contraste**.
  Cada tema solo redefine tokens, más algunos ajustes propios.
- **Fuentes para nombres raros:** empaquetarlas localmente (agregar `font-src 'self'` a la CSP): Noto Sans, Noto Sans Math (𝓐𝕭𝖈),
  Noto Sans Symbols 1 y 2, Noto Color Emoji, como cadena de respaldo.

## 13. Pasada final: compacto y accesible (en curso)
- Revisar todas las vistas: navegación con teclado, `aria-*`, foco visible, contraste en todos los temas, `prefers-reduced-motion`.
- Ajustar espaciados para que todo quede compacto con la densidad por defecto.
- Probar con dos cuentas a la vez (cada vista descarta las respuestas de la cuenta anterior).
- Probar todos los enlaces de las notificaciones.

Hecho en código (sin verificar en pantalla):
- Teclado: todas las pestañas usan `ui/tabs.js` (← → Inicio Fin), flechas en el selector de emojis,
  Ctrl+1…3 cambia de sección, Alt+← vuelve, F5 actualiza; al navegar el foco pasa a la vista nueva.
- Lectores de pantalla: errores con `role="alert"`, "Cargando…" con `role="status"`, etiquetas en los botones de icono.
- Foco visible también en miniaturas y segmentos (se dibuja por dentro para que no se recorte).
- Contraste: acento claro `#2f5fe8` (5:1), texto oscuro sobre el acento del tema oscuro, "En vivo" más oscuro,
  hora de los mensajes menos transparente; con un acento propio el color del texto se elige solo (negro o blanco).
- `prefers-reduced-motion` global.
- Dos cuentas: seguir / unirse / salir no recargan la vista si mientras tanto se cambió de cuenta.

Falta (necesita la app abierta): recorrer cada tema mirando contraste y espaciados, probar con dos cuentas
y probar los enlaces de cada tipo de notificación.
