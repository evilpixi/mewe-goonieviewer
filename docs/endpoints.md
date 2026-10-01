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
| Marcar leído | `DELETE /api/v2/messages/thread/{id}/unread` | Todavía sin usar. |

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
- **Notificaciones:** `new-notification`

## Perfiles (para el paso 9)

- `GET /api/v2/following/profile/{userId}`
- `GET /api/v2/following/{userId}?details=true`
- `GET /api/v2/home/user/{userId}/postsfeed`
- `GET /api/v2/home/user/{userId}/mediastream`
- Solicitudes recibidas: `GET /api/v2/following/requests/received`
