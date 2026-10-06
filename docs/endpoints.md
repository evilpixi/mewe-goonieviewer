# Endpoints de MeWe

API interna y no oficial, sacada del bundle web (`https://mewe.com/assets/main-*.js`) en octubre de 2026. Puede cambiar sin aviso.
Todas las rutas son relativas a `https://mewe.com` y se autentican con las cookies de la sesión más el header `x-csrf-token`.
Con `npm run debug`, la última respuesta de cada endpoint se guarda en `mewe-debug/`.

## Chats

| Qué | Request | Notas |
|---|---|---|
| Lista de chats | `POST /api/v2/chat/threads` `{ addRequests: false, chatType }` | `chatType`: `UserChat`, `GroupChat`, `EventChat`, `AllChat`. Un `GroupChat` tiene como id el id del grupo. |
| Mensajes | `GET /api/v2/chat/thread/{id}/messages?limit=&beforeId=` | `{ messages: [...] }`. La fecha viene en `date` (segundos). |
| Enviar | `POST /api/v2/chat/thread/{id}/message` | `{ message, setAsRead: true, replyTo?: messageId, attachments?: [attachmentId] }`. La web envía cada imagen como un mensaje aparte. |
| Subir imagen | `POST /api/v2/attachment/upload/pm` (chat con personas) o `/gc` (chat de grupo) | multipart, campo `files[]`. Responde `{ id }`, que se usa en `attachments`. |
| Reaccionar | `POST /api/v2/chat/thread/{t}/message/{m}/emojis` con body `["😀"]` | Quitar: `DELETE …/emojis?emojis=😀`. |
| Quién reaccionó | `GET /api/v2/chat/thread/{t}/message/{m}/emojis` | `{ usersWithEmojis: [{ user, emojis }], _links.nextPage }`. De un solo emoji: `GET …/emoji?emoji=😀` devuelve `{ users }`. |
| Abrir / crear chat | `POST /api/v2/chat/thread` `{ receivers: [userId] }` | Devuelve el chat. Sacado del bundle web. **Sin probar.** |
| Editar mensaje | `PUT /api/v2/chat/thread/{threadId}/message/{id}` | `{ text }`. Sólo mensajes propios de texto; el mensaje vuelve con `editedAt`. **Sin probar.** |
| Mensaje temporal visto | `POST /api/v2/messages/message/{id}/seen` | La web lo llama al **terminar** de mostrar un mensaje con `expiresIn` (ahí MeWe lo borra), no al abrirlo. La imagen se pide a `mewe.com` (no a `img.mewe.com`) en `400x400`. **Sin probar.** |
| Marcar leído | `DELETE /api/v2/messages/thread/{id}/unread` | La web lo llama al enfocar la caja de texto. La app, al hacer click en los mensajes, al escribir o con el botón "Marcar como leído". **Sin probar.** |

Forma de un mensaje:
- Fotos en `attachments[]`, con `aType: 'photo'` y `_links.self.href`, una plantilla con `{imageSize}`.
- Respuestas en `replyTo: { id, text, authorId }`.
- Reacciones en `emojis: { userEmojis, emojiCounts, counts }`.
- Mensajes temporales: `expiresIn` (segundos) y `dissapearingType` (sic, así lo escribe MeWe).

**Mensajes temporales:** la web de MeWe no permite enviarlos, solo la app móvil. La app manda `expiresIn` en el body del envío. Si la respuesta vuelve sin `expiresIn`, avisa que MeWe no lo aplicó. Falta confirmarlo con una cuenta real.

## Posts y comentarios

La base de un post depende de dónde está publicado:
- **Home / contactos:** `/api/v2/home/post/{postId}`
- **Grupo:** `/api/v3/group/{groupId}/post/{postId}` (los posts de grupo usan la API v3)

| Qué | Request | Notas |
|---|---|---|
| Detalle | `GET {base}` | `{ post, users, groups }` |
| Todas las fotos | `GET {base}/multipost/medias` | El feed solo trae las primeras 4 (`photosCount` dice cuántas hay). |
| Reaccionar | `POST {base}/emojis` `["😀"]` / `DELETE {base}/emojis?emojis=😀` | |
| Quién reaccionó | `GET {base}/emojis` | Misma forma que en chats. |
| Comentarios | `GET {base}/comments?maxResults=10&afterId=` | `{ feed: [...], users }` |
| Comentar | `POST {base}/comments` `{ text }` | |
| Respuestas | `GET /api/v2/comments/{id}/replies` · `POST /api/v2/comments/{id}/reply` `{ text }` | |
| Reaccionar a comentario | `POST/DELETE/GET /api/v2/comments/{id}/emojis` | Igual que en posts. |
| Contexto de comentario | `GET /api/v2/home/comment/{id}/context` (grupo: `/api/v3/group/{g}/comment/{id}/context`) | Para ir a un comentario desde una notificación (paso 11). |

## Tiempo real (websocket)

- **Conexión:** `wss://ws.mewe.com/indexWS?userId={miUserId}`, autenticada con las cookies de la sesión.
- **Mensajes del servidor:** `{ msgType, data, msgNo? }`.
- **Respuesta del cliente:**
  - si el mensaje trae `msgNo`: `{ "ack": msgNo }`
  - si no (salvo `chat-isOnline`): `{ "message": "pong" }`

Tipos de evento:
- **Chat:**
  - mensaje nuevo: `newChatMessage`, `chat-newMessage`, `GroupChatMessage`, `EventChatMessage`
  - reacciones: `chat-message-emoji-added`, `chat-message-emoji-removed`
  - borrado y edición: `chat-delMessage`, `chat-editMessage`, `DelGroupChatMessage`
- **Posts:** `post-new-model`, `post-emojis-add`, `comment-new`, `comment-emojis-add`, …
- **Notificaciones:** `new-notification` (la app reenvía cualquier `msgType` que contenga `notification` y vuelve a pedir el contador)

## Perfiles y seguimiento

| Qué | Request | Notas |
|---|---|---|
| Perfil | `GET /api/v2/following/{userId}?details=true` | `{ user, profile: { text }, counters: { followers, following, posts }, following, follower }`. `user.public === false` es cuenta privada. |
| Publicaciones | `GET /api/v2/home/user/{userId}/postsfeed` | Misma forma que el feed. 403 si la cuenta es privada y no la seguimos. |
| Imágenes | `GET /api/v2/home/user/{userId}/mediastream` | `{ feed: [{ mediaId, postItemId, photo }], _links.nextPage }` |
| Imágenes de un álbum | `GET /api/v2/home/user/{userId}/album/{nombre}/mediastream` | Misma forma que las imágenes. Sacado del bundle web. **Sin probar.** |
| Álbumes | `GET /api/v2/home/user/{userId}/albums` | `{ feed: [{ name, count, image: { _links.img } }], _links.nextPage }`. La web descarta los de `count` 0. Sacado del bundle web. **Sin probar.** |
| Seguir / dejar de seguir | `POST` / `DELETE /api/v2/following/{userId}/follow` | Responde `{ follow: { user, following, follower, followRequestId? } }`: con `followRequestId` quedó una solicitud pendiente (cuenta privada). |
| Solicitudes recibidas | `GET /api/v2/following/requests/received` | `{ list: [...] }`. Según el bundle web, cada elemento trae el usuario (en `user` o plano) y `followRequestId`, que es el id para aceptar o rechazar. Sólo se vio vacía. |
| Buscar personas | `GET /api/v3/desktop/search/users?query=&limit=&offset=&nm=1` | `{ results: [{ user }], hasMoreResults }`. Sacado del bundle web. **Sin probar.** Hermanos: `/desktop/search` (todo), `/groups`, `/chats`, `/posts`. |
| Aceptar solicitud | `POST /api/v2/following/request/{requestId}/accept` | **Sin probar.** |
| Rechazar o cancelar | `DELETE /api/v2/following/request/{requestId}/remove` | **Sin probar.** |

## Grupos

| Qué | Request | Notas |
|---|---|---|
| Mis grupos | `GET /api/v2/groups` | `{ confirmedGroups, unconfirmedGroups }` (las segundas son invitaciones). |
| Detalle | `GET /api/v2/group/{groupId}` | Trae `role`, `ownerId`, `adminIds`, `membersCount`, `isPublic`, `publicUrlId`. |
| Publicaciones | `GET /api/v3/group/{groupId}/postsfeed` | API v3, como los posts de grupo. |
| Miembros | `GET /api/v2/group/{groupId}/members?offset=&maxResults=&onlyOwnerAdmins=true` | `{ members: [{ user, role }] }`. Roles vistos: `Owner`, `Admin`, `Contributor`, `Limited`, `Viewer`. |
| Eventos | `GET /api/v2/events2/group/{groupId}/upcoming?v=2&maxResults=` (o `/past`) | Sólo se vio vacío: la forma de un evento sale del modelo del bundle. |
| Chat de grupo / de evento | Los endpoints de **Chats** con `threadId` = id del grupo o del evento | El de evento está **sin probar**. |
| Unirse (grupo público) | `POST /api/v2/group/public/{publicUrlId}/apply` `{}` | Puede quedar pendiente de aprobación. **Sin probar.** |
| Aceptar invitación | `POST /api/v2/group/{groupId}/invite/confirm` `{}` | **Sin probar.** |
| Salir | `DELETE /api/v2/group/{groupId}/member/{miUserId}/remove` | **Sin probar.** |
| Buscar contactos para invitar | `GET /api/v2/following/followers/to-invite?search=&maxResults=&offset=&markGroupMembersOf={groupId}` | El que usa el diálogo de invitar de la web: `{ list: [{ user, inGroup, invited }] }`. Sin `search` lista todos. **Sin probar.** `/group/{id}/contacts/search?searchStr=` existe pero la web no lo usa y devolvía resultados incompletos. |
| Preguntas para entrar | Vienen en el detalle del grupo: `applyQuestions: [texto]` y `mandatoryQuestions` | Las respuestas van en el body de unirse o de aceptar la invitación: `{ answers: [{ question, text }] }`. `text` es obligatorio en cada respuesta (confirmado por el 400 de MeWe); que acepte `question` al lado falta confirmarlo. |
| Invitar | `POST /api/v2/group/{groupId}/members` `{ groupId, userInvitees: [{ userId }] }` | La forma de `userInvitees` está deducida del bundle. **Sin probar.** |

## Notificaciones

| Qué | Request | Notas |
|---|---|---|
| Lista | `GET /api/v2/notifications/feed?maxResults=30` | `{ unseenCount, feed, _links.nextPage }` |
| Contador | `GET /api/v2/notifications/unseen` | `{ unseenCount }` |
| Marcar vistas | `POST /api/v2/notifications/markSeen` | Sin cuerpo; pone el contador en 0 (responde 204). |
| Marcar leída(s) | `POST /api/v2/notifications/markVisited` | form-urlencoded: `notificationId=…` o `all=true`. **Sin probar.** |

Forma de una notificación:
- `notificationType`: `emojis`, `comment`, `mention`, `new_follower`, `new_follow_request`, `follow_request_accepted`,
  `poll_ended`, `group_invitation`, `event_invitation`, `generic`, … (la lista completa está en `notificationsView.js`).
- `system`: `contacts`, `group`, `pending`… Con `group` presente y `system` `group` o `pending`, va a la pestaña **Grupos**.
- `actingUsers` / `actingUsersCount`: quién la generó.
- `postData.postItemId`, `commentData.id`, `threadId` + `messageId`, `group`, `event`, `pollData.sharedPostId`: a dónde lleva.
- `visited: false`: sin leer. Fecha en `updatedAt` (segundos).
- Las `generic` son avisos de MeWe: traen `title` y `subtitle` en lugar de usuarios.
