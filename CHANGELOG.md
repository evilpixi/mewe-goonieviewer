# Changelog

## Sin publicar

- Grupos: crear grupos y, para quien los administra, cambiar su foto, portada y datos, los permisos de cada rol, el rol de cada miembro, y quitar o banear gente (con la lista de baneados).
- Chats grupales entre personas: crearlos, cambiarles el nombre, sumar y sacar gente y salir. Su foto son tres burbujas superpuestas con fotos de sus miembros (siempre los mismos; si son menos de tres, un ícono de persona).
- Notificaciones: una sola lista, sin la pestaña de grupos. Arriba, una tira con los grupos que tienen publicaciones nuevas, que se pueden abrir o quitar, y **Ver más** para ir a la lista de grupos.
- Chats, en el teléfono: tocar un mensaje muestra sus tres puntitos, como el mouse en escritorio.
- Menciones: el menú aparece 1,1 segundos después de escribir `@` (antes, 1,5).
- Publicaciones y mensajes propios: eliminarlos.
- Chats: buscador de chats por nombre, arriba de la lista. En el teléfono se abre con el botón 🔍 del segundo panel.
- Chats: el menú ⋮ de la barra tiene **Información** (el perfil, el grupo o los miembros del chat grupal); reemplaza al botón de miembros. En los chats grupales también **Invitar personas** y, en el chat de un grupo, **Invitar al grupo**.
- Chats: **Enter envía** pasa a ser un ícono ⏎ al lado de **Enviar**.
- El botón **Actualizar** pasa a un menú ☰ en el segundo panel. En Chats también van ahí el estado **En vivo** y **Marcar como leídos**.
- Chats: **Nuevo chat grupal** (💬+) y la búsqueda van a la izquierda del segundo panel; las pestañas Todos / Personas / Grupos quedan centradas también en el teléfono.
- Listas → Grupos: cada grupo con publicaciones nuevas muestra una tira de hasta 10 tarjetas con ellas (imagen, comienzo del texto y autor) y **Ver más** para abrir el grupo.
- Listas: Siguiendo y Seguidores se juntan en **Personas**, con un submenú. El filtro se abre con el botón 🔍; a la izquierda, **Crear grupo** o, en Personas, **Nuevo chat grupal**.
- Corregido: abrir una mención de chat desde las notificaciones a veces no encontraba el mensaje, cuando era más viejo que los últimos ~500 del chat. Ahora salta a esa parte del chat; abajo se cargan los más recientes y **Ir al final** vuelve al último.
- Chats: con la ventana angosta en escritorio, Enter vuelve a respetar el botón ⏎; sólo en Android hace siempre un salto de línea.
- Íconos: **Todo** es una casa y **Grupos** son cuatro cuadrados, como en MeWe.

## 0.4.0 — 2026-10-13

- Chats: cada mensaje tiene un menú con los emojis para reaccionar a la vista, responder, reenviar, editar y copiar el texto. En escritorio se abre con los tres puntitos que aparecen al pasarle el mouse; en el teléfono, manteniendo apretado el mensaje. Reemplaza a los iconos del costado.
- Chats: reenviar un mensaje a otro chat, con su texto y sus imágenes. Los videos y archivos no se reenvían.
- Chats, en el teléfono: arrastrar un mensaje hacia un costado lo responde.
- Chats, en el teléfono: el agarrador de la lista compacta pasa a ser una lengüeta sobre el borde izquierdo de la conversación, que se toca o se tironea.
- Chats: el temporizador de imágenes y videos es un botón **Temporal** que se usa o no, siempre a 24 horas.
- Chats: los videos (hasta 200 MB) se envían por el mismo camino que usa la web de MeWe; aparecen en el chat cuando MeWe termina de procesarlos.
- Chats: los globos tienen los bordes menos redondeados y más relleno.
- Menciones: al escribir `@` y parte del nombre aparece un menú para elegir a quién mencionar, en chats, publicaciones y comentarios.
- Selector de emojis con buscador, categorías y los usados hace poco.
- Cuentas: un aviso sobre la foto de las cuentas que no se están usando cuando tienen algo nuevo. En los ajustes se elige qué lo enciende: mensajes privados, chats de grupo o menciones. En el teléfono, el menú de la cuenta muestra un contador por cuenta.
- Perfiles: los links de la descripción se abren en el navegador y se pueden copiar.
- Publicaciones: la cabecera muestra una cosa por línea (autor, grupo y fecha).
- Las imágenes de las publicaciones y las historias muestran un spinner mientras cargan.
- En el teléfono, la barra de navegación se oculta mientras se escribe.
- Corregido, en el teléfono: al responder una historia o comentar, tocar **Enviar** sólo cerraba el teclado.

## 0.3.1 — 2026-10-12

- Chats: la caja de escribir tiene dos filas, el texto arriba y los botones abajo. En escritorio, el botón **Enter envía** elige si Enter envía el mensaje o hace un salto de línea; `Ctrl+Enter` envía siempre. En el teléfono, Enter sólo hace un salto de línea.
- Agregar cuenta: botón **Iniciar sesión con Google** (escritorio), que abre la ventana de MeWe sin pedir email ni contraseña. La ventana de login ahora permite el popup de Google.
- Perfiles: se quitaron Trabajo, Empresa, Universidad y Secundaria, que MeWe ya no tiene.

## 0.3.0 — 2026-10-12

- Chats: tiradas de dados de rol. El botón de dados de la caja de escribir abre un panel para elegir los dados, un modificador y un mensaje; también se puede escribir `/roll 2d20+1d6-3 {mensaje}`. La tirada se envía como un mensaje común, así que se ve igual en la app oficial de MeWe. Hasta 20 dados de hasta 100 caras por tirada.
- Las líneas que empiezan con `> ` se muestran como cita en chats, publicaciones y comentarios.

## 0.2.1 — 2026-10-11

- Corregido: los posts compartidos se veían vacíos. Ahora citan el post original, con su autor, fecha, texto y fotos.
- Versión para Linux (AppImage y `.tar.gz`, 64 bits), experimental: todavía sin probar.

## 0.2.0 — 2026-10-11

- Versión para Android (APK): la misma interfaz en su formato de teléfono, con varias cuentas, login en la ventana de MeWe, tiempo real, envío de imágenes, videos y guardado en la galería. El botón atrás cierra lo que esté abierto.
- Cabecera nueva: la foto de la cuenta (abre su perfil), los iconos de Feed, Chats, Listas e Historias al centro, y a la derecha buscar, notificaciones y el menú de opciones, donde quedaron Ajustes, Reconectar y Quitar cuenta. Debajo, un segundo panel con los controles de cada vista y Actualizar.
- Publicaciones: crear un post con texto e imágenes en el feed propio o en un grupo (también desde la vista del grupo), con borrador automático por cuenta y botón para limpiarlo. Se puede editar el texto de los posts propios.
- Listas: junto a los grupos, las personas que se siguen y los seguidores, con filtro; desde cada una se ve el perfil, se le escribe, se copia su link o se la bloquea.
- Bloquear a una persona desde su perfil o desde su chat, con confirmación. En el perfil propio, pestañas con los bloqueados (para desbloquear) y con las solicitudes de seguimiento.
- Perfil propio: editar la foto, la portada, el nombre, la presentación y los demás campos. Copiar el link de cualquier perfil.
- Chats: los videos se reproducen dentro de la conversación.
- Chats: junto al nombre de quien escribe se ve su @usuario, y el nombre lleva sombra para leerse sobre la portada de fondo.
- Chats: el indicador "Siguiendo lo último" ya no se muestra; al subir aparece un botón más grande para ir al final, sobre un degradado.
- Visor de imágenes: copiar la imagen al portapapeles (C); "Descargar" pasa a llamarse Guardar (G).
- Historias: la sección muestra, sobre fondo negro, a quienes tienen historias. Se ven a pantalla completa (fotos y videos), pasan solas y desde ahí se guardan, se le responde a su autor o se va a su perfil. Las propias muestran cuántas personas las vieron y se pueden borrar.
- Historias: editor para crear una, con una imagen de fondo (entera o recortada) y textos y emojis encima; cada uno se mueve, se gira y se agranda, y el texto tiene 10 fuentes, color y un fondo opcional para que se lea.
- Chats: un mensaje que responde a una historia muestra su miniatura (se abre en el visor) y de quién era la historia.
- Grupos: el botón de chat (en la vista del grupo, en sus eventos y ahora también en la lista de grupos) abre la sección Chats con ese chat elegido y la lista al costado.
- Notificaciones: "Seguir" ya no aparece en las de seguimiento si ya se sigue a esa persona (o dice "Solicitud enviada" si está pendiente).
- Se quitó el botón Volver de la cabecera (`Alt+←` sigue funcionando).
- Corregido: "Mensaje" desde un perfil abría el chat sin la lista de chats al costado.
- Corregido: una imagen temporal no se podía volver a abrir después de verla (ahora queda en memoria mientras la app esté abierta).
- Corregido: una solicitud de seguimiento aparecía dos veces en las notificaciones, y las notificaciones repetidas ahora se muestran como una sola.
- Corregido: las notificaciones no siempre quedaban leídas (al aceptar, rechazar o seguir desde la lista, o si llegaba una nueva justo después de abrir otra).
- Notificaciones: aceptar o rechazar solicitudes de seguimiento y seguir (o pedir seguir) a la otra persona sin salir de la lista.
- Corregido: no se podían aceptar solicitudes de seguimiento (se tomaba mal el id de la solicitud).
- Perfiles: pestaña de álbumes; al abrir una imagen se ve su publicación con los comentarios.
- Perfiles y grupos: la portada se ve más grande, y la portada y la foto se abren a pantalla completa.
- Chats: abrir un chat ya no lo da por leído; se marca al hacer click en los mensajes, al escribir o con el botón "Marcar como leído".
- Chats: se abren en el final y quedan anclados ahí (los mensajes nuevos se siguen solos) hasta que se sube a leer; un indicador muestra si el chat está anclado o lleva al final.
- Los GIFs de Giphy se ven animados en chats, publicaciones y comentarios, en lugar de su link.
- Grupos: al unirse a un grupo que hace preguntas, se responden antes de enviar la solicitud.
- Corregido: el buscador para invitar contactos a un grupo mostraba "HTTP 400" al abrirse y no encontraba a todos los contactos. Ahora usa el mismo buscador que la web, lista los contactos sin tener que escribir y avisa quién ya está en el grupo.

## 0.1.0 — 2026-10-05

Primera versión pública.

- Varias cuentas de MeWe a la vez, cada una con su sesión aislada.
- Feed (todo, grupos, perfiles) con reacciones, comentarios y galería de imágenes.
- Chats con personas, grupos y eventos en tiempo real: respuestas, reacciones, edición, envío de imágenes y temporizador.
- Perfiles, búsqueda de personas, seguir / dejar de seguir y solicitudes de seguimiento.
- Grupos: publicaciones, miembros, eventos, chat, unirse, salir e invitar.
- Notificaciones separadas entre personales y de grupos.
- 14 temas, colores personalizables y escalas de zoom, fuente, espaciado e iconos.
- Instalador y versión portable para Windows.
