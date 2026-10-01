// Envuelve window.mewe (preload): desempaqueta { ok, data, error } y lanza ApiError.
export class ApiError extends Error {
  constructor(details) {
    super(details?.message ?? 'Error desconocido');
    this.name = details?.name ?? 'ApiError';
    this.details = details;
  }
}

// Invoca cualquier canal de src/main/ipc.js
export async function invoke(channel, ...args) {
  const result = await window.mewe.invoke(channel, ...args);
  if (!result.ok) throw new ApiError(result.error);
  return result.data;
}

// Suscribe a eventos empujados por main; devuelve la función para desuscribirse
export function on(channel, callback) {
  return window.mewe.on(channel, callback);
}

export const api = {
  listAccounts: () => invoke('accounts:list'),
  addAccount: (credentials) => invoke('accounts:add', credentials),
  reloginAccount: (id) => invoke('accounts:relogin', id),
  removeAccount: (id) => invoke('accounts:remove', id),
  getFeed: (id, type, nextPage) => invoke('feed:get', id, type, nextPage),

  // Posts: `post` es { id, groupId } (los de grupo usan otra ruta en MeWe)
  getPost: (id, postId, groupId) => invoke('post:get', id, postId, groupId),
  getPostImages: (id, post) => invoke('post:images', id, post.id, post.groupId),
  reactPost: (id, post, emoji, on) => invoke('post:react', id, post.id, post.groupId, emoji, on),
  getPostReactors: (id, post) => invoke('post:reactors', id, post.id, post.groupId),
  getComments: (id, post, page) => invoke('post:comments', id, post.id, post.groupId, page),
  addComment: (id, post, text) => invoke('post:comment', id, post.id, post.groupId, text),
  getReplies: (id, commentId) => invoke('post:replies', id, commentId),
  addReply: (id, commentId, text) => invoke('post:reply', id, commentId, text),
  reactComment: (id, commentId, emoji, on) => invoke('post:commentReact', id, commentId, emoji, on),
  getCommentReactors: (id, commentId) => invoke('post:commentReactors', id, commentId),

  // filter: 'users' | 'groups' | 'all'
  getChatThreads: (id, filter) => invoke('chat:threads', id, filter),
  getMessages: (id, threadId, beforeId) => invoke('chat:messages', id, threadId, beforeId),
  // message: { text, replyTo, attachments, expiresIn }
  sendMessage: (id, threadId, message) => invoke('chat:send', id, threadId, message),
  uploadChatImage: (id, isGroup, file) => invoke('chat:upload', id, isGroup, file),
  reactMessage: (id, threadId, messageId, emoji, on) => invoke('chat:react', id, threadId, messageId, emoji, on),
  getMessageReactors: (id, threadId, messageId) => invoke('chat:reactors', id, threadId, messageId),
  startRealtime: (id) => invoke('chat:realtime', id),
  onChatEvent: (callback) => on('chat:event', callback),
  onChatStatus: (callback) => on('chat:status', callback),

  downloadImage: (id, url, name) => invoke('ui:download', id, url, name),

  onLoginError: (callback) => on('login:error', callback),
  onLoginStatus: (callback) => on('login:status', callback),
};

// URL del protocolo propio que sirve imágenes con las cookies de la cuenta
export function imageUrl(accountId, url) {
  return url ? `mewe-img://${accountId}/?u=${encodeURIComponent(url)}` : null;
}
