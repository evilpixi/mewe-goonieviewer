// Configuración central. Los endpoints salen del bundle web de mewe.com
// (API interna, no oficial): pueden cambiar sin aviso.
export const config = {
  debug: process.env.MEWE_DEBUG === '1' || process.argv.includes('--mewe-debug'),

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
      messages: (threadId) => `/api/v2/chat/thread/${threadId}/messages`, // GET ?limit=&beforeId=
      send: (threadId) => `/api/v2/chat/thread/${threadId}/message`, // POST { message, setAsRead, replyTo, attachments }
      // POST ["😀"] agrega · DELETE ?emojis= quita · GET lista quién reaccionó
      emojis: (threadId, messageId) => `/api/v2/chat/thread/${threadId}/message/${messageId}/emojis`,
      // multipart files[] -> { id }; 'pm' = chat con personas, 'gc' = chat de grupo
      upload: (isGroup) => `/api/v2/attachment/upload/${isGroup ? 'gc' : 'pm'}`,
      chatTypes: { all: 'AllChat', users: 'UserChat', groups: 'GroupChat', events: 'EventChat' },
      pageSize: 25,
    },

    // Base de un post: los de grupo van por /api/v3/group/..., el resto por /api/v2/home/...
    // Sobre la base: '' (detalle), /comments, /emojis, /multipost/medias
    post: (postId, groupId) =>
      groupId ? `/api/v3/group/${groupId}/post/${postId}` : `/api/v2/home/post/${postId}`,
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
      follow: (userId) => `/api/v2/following/${userId}/follow`, // POST sigue · DELETE deja de seguir
      requestsReceived: '/api/v2/following/requests/received', // GET
      acceptRequest: (requestId) => `/api/v2/following/request/${requestId}/accept`, // POST
      removeRequest: (requestId) => `/api/v2/following/request/${requestId}/remove`, // DELETE (rechazar o cancelar)
    },

    groups: {
      mine: '/api/v2/groups', // GET
      details: (groupId) => `/api/v2/group/${groupId}`, // GET
      feed: (groupId) => `/api/v3/group/${groupId}/postsfeed`, // GET, paginado
      members: (groupId) => `/api/v2/group/${groupId}/members`, // GET ?offset=&maxResults=&onlyOwnerAdmins= · POST invita
      member: (groupId, userId) => `/api/v2/group/${groupId}/member/${userId}/remove`, // DELETE (con mi id: salir)
      apply: (publicUrlId) => `/api/v2/group/public/${encodeURIComponent(publicUrlId)}/apply`, // POST {}
      confirmInvite: (groupId) => `/api/v2/group/${groupId}/invite/confirm`, // POST {}
      contacts: (groupId) => `/api/v2/group/${groupId}/contacts/search`, // GET ?searchStr=
      // when: 'upcoming' | 'past'
      events: (groupId, when) => `/api/v2/events2/group/${groupId}/${when}`, // GET ?v=2&maxResults=
      membersPageSize: 30,
      eventsPageSize: 20,
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
