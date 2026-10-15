// Configuración central. Los endpoints salen del bundle web de mewe.com
// (API interna, no oficial): pueden cambiar sin aviso.
export const config = {
  // process sólo existe en Electron: en Android (WebView) este módulo se carga sin él
  debug: typeof process !== 'undefined' && (process.env.MEWE_DEBUG === '1' || process.argv.includes('--mewe-debug')),

  mewe: {
    host: 'https://mewe.com',
    imgHost: 'https://img.mewe.com',
    loginUrl: 'https://mewe.com/login',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',

    endpoints: {
      login: '/api/v3/auth/login', // POST form-urlencoded, exige captcha (session_token + challenge_provider)
      identify: '/api/v3/auth/identify', // GET, valida la sesión
      me: '/api/v2/me/info', // GET, perfil del usuario
    },

    // Feeds de la pestaña "Siguiendo" (paginados con _links.nextPage)
    feeds: {
      following: '/api/v2/home/allfeed', // Todo
      groups: '/api/v3/groups/postsfeed', // Grupos
      contacts: '/api/v2/home/following/feed', // Perfiles
    },
    defaultFeed: 'following',

    chat: {
      threads: '/api/v2/chat/threads', // POST { addRequests, chatType }
      messages: (threadId) => `/api/v2/chat/thread/${threadId}/messages`, // GET ?limit=&beforeId= | afterId= | aroundId=
      send: (threadId) => `/api/v2/chat/thread/${threadId}/message`, // POST { message, setAsRead, replyTo, attachments }
      edit: (threadId, messageId) => `/api/v2/chat/thread/${threadId}/message/${messageId}`, // PUT { text }
      remove: (messageId) => `/api/v2/messages/message/${messageId}`, // DELETE: borra un mensaje propio, para todos
      create: '/api/v2/chat/thread', // POST { receivers: [userId] } → el chat (nuevo o el que ya había); con varios, un chat grupal
      // Chats grupales (de personas, no de un grupo). Quien lo creó (startedBy) es el único que puede sacar gente.
      addParticipants: (threadId) => `/api/v2/chat/thread/${threadId}/participants/add`, // POST { receivers: [userId] }
      participant: (threadId, userId) => `/api/v2/chat/thread/${threadId}/participants/${userId}`, // DELETE: lo saca
      rename: (threadId) => `/api/v2/chat/thread/${threadId}/name`, // POST { name }
      leave: (threadId) => `/api/v2/chat/thread/${threadId}/leave`, // DELETE
      maxParticipants: 100, // chatMaxUsers de la web
      markRead: (threadId) => `/api/v2/messages/thread/${threadId}/unread`, // DELETE: marca el chat como leído
      seen: (messageId) => `/api/v2/messages/message/${messageId}/seen`, // POST: marca visto un mensaje temporal
      disappearingImageSize: '400x400', // tamaño con el que la web pide las imágenes temporales
      // POST ["😀"] agrega · DELETE ?emojis= quita · GET lista quién reaccionó
      emojis: (threadId, messageId) => `/api/v2/chat/thread/${threadId}/message/${messageId}/emojis`,
      // multipart files[] -> { id }; 'pm' = chat con personas, 'gc' = chat de grupo
      upload: (isGroup) => `/api/v2/attachment/upload/${isGroup ? 'gc' : 'pm'}`,
      // Videos: GET ?length=bytes → los datos para subirlo al S3 de MeWe; después se manda a procesar
      videoAuthorize: '/api/v2/video/upload/authorize-request',
      videoProcess: '/api/v2/video/upload/process', // POST { threadId, uploadFolder, mime, fileName, replyTo } → { jobId }
      chatTypes: { all: 'AllChat', users: 'UserChat', groups: 'GroupChat', events: 'EventChat' },
      pageSize: 25,
    },

    // Base de un post: los de grupo van por /api/v3/group/..., el resto por /api/v2/home/...
    // Sobre la base: '' (detalle; con DELETE lo borra), /comments, /emojis, /multipost/medias
    post: (postId, groupId) =>
      groupId ? `/api/v3/group/${groupId}/post/${postId}` : `/api/v2/home/post/${postId}`,
    // Crear y editar posts. Las fotos se suben antes (multipart, campo `file` → { id }) y van en imageIds.
    posts: {
      create: (groupId) => (groupId ? `/api/v3/group/${groupId}/post` : '/api/v2/home/post'), // POST { text, imageIds, everyone? }
      // editar: PUT {base del post}/edit { text, mediaIds, existingFileIds, stickers } (mediaIds = fotos que se conservan)
      upload: '/api/v2/photo/pt',
      maxImages: 20,
    },
    comments: {
      replies: (commentId) => `/api/v2/comments/${commentId}/replies`, // GET
      reply: (commentId) => `/api/v2/comments/${commentId}/reply`, // POST { text }
      emojis: (commentId) => `/api/v2/comments/${commentId}/emojis`, // como chat.emojis
      pageSize: 10,
    },

    // Perfiles y seguimiento
    profile: {
      details: (userId) => `/api/v2/following/${userId}`, // GET ?details=true
      feed: (userId) => `/api/v2/home/user/${userId}/postsfeed`, // GET, paginado
      media: (userId) => `/api/v2/home/user/${userId}/mediastream`, // GET, paginado
      albums: (userId) => `/api/v2/home/user/${userId}/albums`, // GET, paginado → { feed: [{ name, count, image }] }
      albumMedia: (userId, album) => `/api/v2/home/user/${userId}/album/${encodeURIComponent(album)}/mediastream`, // GET, paginado
      follow: (userId) => `/api/v2/following/${userId}/follow`, // POST sigue · DELETE deja de seguir
      requestsReceived: '/api/v2/following/requests/received', // GET
      search: '/api/v3/desktop/search/users', // GET ?query=&limit=&offset=&nm=1 → { results: [{ user }], hasMoreResults }
      acceptRequest: (requestId) => `/api/v2/following/request/${requestId}/accept`, // POST
      removeRequest: (requestId) => `/api/v2/following/request/${requestId}/remove`, // DELETE (rechazar o cancelar)
      // Listas de personas, paginadas: { list: [{ user, following, follower }], _links.nextPage }
      followers: '/api/v2/following/followers', // GET ?maxResults=
      followed: '/api/v2/following/followed', // GET ?maxResults=
      blocked: '/api/v2/following/blocked', // GET
      block: '/api/v2/mycontacts/contact/block/user', // POST ?userId=
      unblock: '/api/v2/mycontacts/contact/unblock', // POST ?userId=
      listPageSize: 50,
      // Perfil propio. Las fotos se suben antes (multipart, campo `file` → { id }) y se recortan en el servidor
      // con croppX / croppY / croppW / croppH (sic), en píxeles de la imagen original.
      uploadAvatar: '/api/v2/photo/up',
      uploadCover: '/api/v2/photo/uc',
      avatar: '/api/v2/profile', // PUT { picture: { id, croppX, croppY, croppW, croppH } }
      cover: '/api/v2/profile/cover', // PUT { id, croppX, croppY, croppW, croppH }
      publicProfile: '/api/v2/profile/public', // PUT { text, currentCity, job, …, status } (van todos los campos)
      account: '/api/v2/account', // POST { firstName, lastName }
    },

    groups: {
      mine: '/api/v2/groups', // GET
      // GET · PUT cambia datos del grupo: { name, description, groupThematicType } · { fileId, crop? } (portada) ·
      // { permissions: { members: { roles: [{ userId, role }] }, group: { contributor, limited, viewer } }, publicRole,
      //   addAdminIds, removeAdminIds } (roles y permisos)
      details: (groupId) => `/api/v2/group/${groupId}`,
      general: (groupId) => `/api/v2/group/${groupId}/general`, // PUT { profilePhotoId } (la foto del grupo)
      // Crear: primero una foto predefinida (POST { system: 'group', picId: '1' } → { ui }), después el grupo:
      // POST { name, description, groupThematicType, uploadedImageId, mandatoryQuestions, modelType, discoveryOptIn? }
      predefinedPhoto: '/api/v2/photo/predefined',
      create: '/api/v2/groups/add',
      categories: '/api/v2/groups/public/categories/all', // GET → { categories: [{ id, name }] }
      uploadPhoto: '/api/v2/photo/gp', // multipart, campo `file` → { id } (foto y portada)
      // modelType: abierto, selectivo (hay que pedir entrar) o privado (sólo con invitación)
      modelTypes: ['Public', 'PublicApply', 'Private'],
      roles: ['Admin', 'Contributor', 'Limited', 'Viewer'], // los que se pueden asignar ('Owner' y 'Custom' no)
      permissions: ['post', 'comment', 'invite'],
      // Baneo: lo saca del grupo y no lo deja volver. PUT
      ban: (groupId, userId) => `/api/v2/group-blocking/${groupId}/block/${userId}`,
      unban: (groupId, userId) => `/api/v2/group-blocking/${groupId}/unblock/${userId}`,
      banned: (groupId) => `/api/v2/group-blocking/${groupId}/list`, // GET ?offset=&maxResults= → { users }
      feed: (groupId) => `/api/v3/group/${groupId}/postsfeed`, // GET, paginado
      members: (groupId) => `/api/v2/group/${groupId}/members`, // GET ?offset=&maxResults=&onlyOwnerAdmins= · POST invita
      member: (groupId, userId) => `/api/v2/group/${groupId}/member/${userId}/remove`, // DELETE (con mi id: salir)
      apply: (publicUrlId) => `/api/v2/group/public/${encodeURIComponent(publicUrlId)}/apply`, // POST {}
      confirmInvite: (groupId) => `/api/v2/group/${groupId}/invite/confirm`, // POST {}
      // GET ?search=&maxResults=&offset=&markGroupMembersOf={groupId} → { list: [{ user, inGroup, invited }] }
      // (el buscador del diálogo de invitar de la web; sin search lista todos los contactos)
      toInvite: '/api/v2/following/followers/to-invite',
      invitePageSize: 20,
      // when: 'upcoming' | 'past'
      events: (groupId, when) => `/api/v2/events2/group/${groupId}/${when}`, // GET ?v=2&maxResults=
      membersPageSize: 30,
      eventsPageSize: 20,
    },

    // Historias (API v3). Sacado del bundle web; MeWe llama "storyteller" a quien publica.
    stories: {
      feed: '/api/v3/stories/feed', // GET → { storytellersInOrder: [{ storytellerId, storytellerType, userStoryteller, stories, hasNewStories }] }
      // GET → { stories: [{ storyId, scope, media, isNew, createdAt, totalUniqueViews }] }
      byTeller: (tellerId, isPage) => (isPage ? `/api/v3/page/${tellerId}/stories` : `/api/v3/stories/${tellerId}`),
      markSeen: '/api/v3/stories/mark-seen', // POST { views: [{ storyId, storytellerId, storytellerType, viewedAt }] }
      reply: (tellerId, storyId) => `/api/v3/stories/${tellerId}/${storyId}/reply`, // POST { message }: llega como mensaje de chat
      upload: '/api/v2/photo/st', // multipart, campo `files` → { id }
      create: (scope) => `/api/v3/story/${scope}`, // POST { userMediaId, location }
      remove: (scope, storyId) => `/api/v3/story/${scope}/${storyId}`, // DELETE (scope en minúsculas)
      scopes: ['followers', 'public', 'favorites'], // quién la ve: seguidores, todos, amigos cercanos
      imageSize: '1200x1200', // el que pide la web
      videoResolutions: ['original', '720p', '480p'], // se prueban en orden
    },

    // "Nuevas publicaciones de la comunidad": grupos con publicaciones sin ver (MeWe los llama wrappers).
    // El id de cada uno es el del grupo.
    communities: {
      groups: '/api/v2/communities/wrappers/groups', // GET → { wrappers: [{ id, type, postsCount, lastActivity, group? }], groups? }
      dismiss: '/api/v2/communities/wrappers/dismiss', // POST { groupIds: [id] }
      dismissAll: '/api/v2/myworld/wrappers/dismiss', // POST { all: true } (todos los de grupos)
    },

    notifications: {
      feed: '/api/v2/notifications/feed', // GET ?maxResults=, paginado
      unseen: '/api/v2/notifications/unseen', // GET { unseenCount }
      markSeen: '/api/v2/notifications/markSeen', // POST (pone el contador en 0)
      markVisited: '/api/v2/notifications/markVisited', // POST form: notificationId=… | all=true
      pageSize: 30,
    },

    // Tiempo real: wss://ws.mewe.com/indexWS?userId=… con las cookies de la sesión.
    // Mensajes { msgType, data, msgNo? }; se responde { ack: msgNo } o { message: 'pong' }
    websocket: 'wss://ws.mewe.com/indexWS',

    // Cookies de sesión que setea la web al loguear
    cookies: {
      session: 'session-id',
      csrf: 'csrf-token',
    },

    imageSize: '800x800',
    fullImageSize: '1600x1600', // visor de imágenes
    avatarSize: '150x150',
  },

  // Esquema propio para servir imágenes de MeWe con las cookies de cada cuenta
  imageScheme: 'mewe-img',
};
