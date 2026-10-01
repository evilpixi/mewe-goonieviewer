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
      chatTypes: { all: 'AllChat', users: 'UserChat', groups: 'GroupChat' },
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
