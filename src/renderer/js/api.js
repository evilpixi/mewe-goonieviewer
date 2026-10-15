// Envuelve window.mewe (preload): desempaqueta { ok, data, error } y lanza ApiError.
export class ApiError extends Error {
  constructor(details) {
    super(details?.message ?? 'Error desconocido');
    this.name = details?.name ?? 'ApiError';
    this.details = details;
  }
}

// Invoca cualquier canal de src/core/channels.js o, los 'ui:*', de src/main/ipc.js
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
  // file: { name, type, data: Uint8Array } → id de la foto, para imageIds
  uploadPostImage: (id, file) => invoke('post:upload', id, file),
  // post: { text, imageIds, groupId?, everyone? } → el post creado (o null si MeWe no lo devuelve)
  createPost: (id, post) => invoke('post:create', id, post),
  // changes: { text, mediaIds } (mediaIds: las fotos del post, que se conservan)
  editPost: (id, post, changes) => invoke('post:edit', id, post.id, post.groupId, changes),
  deletePost: (id, post) => invoke('post:delete', id, post.id, post.groupId),

  // filter: 'users' | 'groups' | 'all'
  getChatThreads: (id, filter) => invoke('chat:threads', id, filter),
  // options: { afterId } (los siguientes a un mensaje) · { aroundId } (los que lo rodean)
  getMessages: (id, threadId, beforeId, options) => invoke('chat:messages', id, threadId, beforeId, options),
  // message: { text, replyTo, attachments, expiresIn }
  sendMessage: (id, threadId, message) => invoke('chat:send', id, threadId, message),
  // message: { text, images: [url] } → el mensaje nuevo en ese chat (las imágenes se vuelven a subir)
  forwardMessage: (id, threadId, isGroup, message) => invoke('chat:forward', id, threadId, isGroup, message),
  editMessage: (id, threadId, messageId, text) => invoke('chat:edit', id, threadId, messageId, text),
  deleteMessage: (id, messageId) => invoke('chat:delete', id, messageId),
  uploadChatImage: (id, isGroup, file) => invoke('chat:upload', id, isGroup, file),
  // file: { name, type, data: Uint8Array } · options: { replyTo, expiresIn }. El mensaje aparece cuando MeWe procesa el video.
  sendChatVideo: (id, threadId, file, options) => invoke('chat:video', id, threadId, file, options),
  reactMessage: (id, threadId, messageId, emoji, on) => invoke('chat:react', id, threadId, messageId, emoji, on),
  getMessageReactors: (id, threadId, messageId) => invoke('chat:reactors', id, threadId, messageId),
  openChatWith: (id, userId) => invoke('chat:open', id, userId),
  // Chats grupales entre personas. → el chat creado
  createGroupChat: (id, userIds, name) => invoke('chat:createGroup', id, userIds, name),
  addChatParticipants: (id, threadId, userIds) => invoke('chat:addParticipants', id, threadId, userIds),
  removeChatParticipant: (id, threadId, userId) => invoke('chat:removeParticipant', id, threadId, userId),
  renameChat: (id, threadId, name) => invoke('chat:rename', id, threadId, name),
  leaveChat: (id, threadId) => invoke('chat:leave', id, threadId),
  markChatRead: (id, threadId) => invoke('chat:read', id, threadId),
  markMessageSeen: (id, messageId) => invoke('chat:seen', id, messageId),
  startRealtime: (id) => invoke('chat:realtime', id),
  onChatEvent: (callback) => on('chat:event', callback),
  onChatStatus: (callback) => on('chat:status', callback),

  getProfile: (id, userId) => invoke('profile:get', id, userId),
  getUserFeed: (id, userId, nextPage) => invoke('profile:feed', id, userId, nextPage),
  // album: nombre del álbum (sin él, todas las imágenes)
  getUserMedia: (id, userId, nextPage, album) => invoke('profile:media', id, userId, nextPage, album),
  getUserAlbums: (id, userId, nextPage) => invoke('profile:albums', id, userId, nextPage),
  // → { following, requestSent }
  setFollow: (id, userId, on) => invoke('profile:follow', id, userId, on),
  getFollowRequests: (id) => invoke('profile:requests', id),
  answerFollowRequest: (id, requestId, accept) => invoke('profile:answerRequest', id, requestId, accept),
  // kind: 'followers' | 'following' | 'blocked' → { users, nextPage }
  getPeople: (id, kind, nextPage) => invoke('profile:people', id, kind, nextPage),
  blockUser: (id, userId) => invoke('profile:block', id, userId),
  unblockUser: (id, userId) => invoke('profile:unblock', id, userId),
  // Perfil propio. changes: { firstName, lastName, fields: { text, currentCity, … } }
  updateProfile: (id, changes) => invoke('profile:update', id, changes),
  // file: { name, type, data } · crop: { x, y, width, height } en píxeles de la imagen
  setAvatar: (id, file, crop) => invoke('profile:setAvatar', id, file, crop),
  setCover: (id, file, crop) => invoke('profile:setCover', id, file, crop),

  searchUsers: (id, query) => invoke('profile:search', id, query),
  getGroups: (id) => invoke('group:list', id),
  getGroup: (id, groupId) => invoke('group:get', id, groupId),
  getGroupFeed: (id, groupId, nextPage) => invoke('group:feed', id, groupId, nextPage),
  // options: { offset, adminsOnly }
  getGroupMembers: (id, groupId, options) => invoke('group:members', id, groupId, options),
  // when: 'upcoming' | 'past'
  getGroupEvents: (id, groupId, when) => invoke('group:events', id, groupId, when),
  // answers: [{ question, answer }] si el grupo hace preguntas antes de entrar
  joinGroup: (id, groupId, answers) => invoke('group:join', id, groupId, answers),
  leaveGroup: (id, groupId) => invoke('group:leave', id, groupId),
  // → { contacts: [{ …, inGroup, invited }], hasMore }
  searchGroupContacts: (id, groupId, query, offset) => invoke('group:contacts', id, groupId, query, offset),
  inviteToGroup: (id, groupId, userIds) => invoke('group:invite', id, groupId, userIds),
  // Crear y administrar grupos
  getGroupCategories: (id) => invoke('group:categories', id),
  // group: { name, description, categoryId, modelType: 'Public' | 'PublicApply' | 'Private' } → el grupo creado
  createGroup: (id, group) => invoke('group:create', id, group),
  // changes: { name, description, categoryId } → el grupo actualizado
  updateGroup: (id, groupId, changes) => invoke('group:update', id, groupId, changes),
  // kind: 'avatar' | 'cover' · file: { name, type, data }
  setGroupPhoto: (id, groupId, kind, file) => invoke('group:setPhoto', id, groupId, kind, file),
  // settings: { permissions: { Contributor: […], Limited: […], Viewer: […] }, publicRole } → el grupo actualizado
  setGroupPermissions: (id, groupId, settings) => invoke('group:setPermissions', id, groupId, settings),
  setGroupMemberRole: (id, groupId, userId, role, wasAdmin) => invoke('group:setRole', id, groupId, userId, role, wasAdmin),
  removeGroupMember: (id, groupId, userId) => invoke('group:removeMember', id, groupId, userId),
  setGroupBan: (id, groupId, userId, on) => invoke('group:ban', id, groupId, userId, on),
  // → { users, hasMore }
  getGroupBanned: (id, groupId, offset) => invoke('group:banned', id, groupId, offset),
  // → [{ id, name, avatar, count, updatedAt }] grupos con publicaciones sin ver
  getCommunities: (id) => invoke('group:communities', id),
  // sin groupId: todos
  dismissCommunity: (id, groupId) => invoke('group:dismissCommunity', id, groupId),

  // Historias. → [{ id, type, isPage, name, avatar, handle, hasNew, isMine, stories }]
  getStorytellers: (id) => invoke('story:tellers', id),
  getStories: (id, tellerId, isPage) => invoke('story:list', id, tellerId, isPage),
  // views: [{ storyId, tellerId, tellerType, viewedAt }]
  markStoriesSeen: (id, views) => invoke('story:seen', id, views),
  replyToStory: (id, tellerId, storyId, text) => invoke('story:reply', id, tellerId, storyId, text),
  // file: { name, type, data } · scope: 'followers' | 'public' | 'favorites'
  createStory: (id, file, scope) => invoke('story:create', id, file, scope),
  deleteStory: (id, storyId, scope) => invoke('story:delete', id, storyId, scope),

  getNotifications: (id, nextPage) => invoke('notif:list', id, nextPage),
  getUnseenNotifications: (id) => invoke('notif:unseen', id),
  markNotificationsSeen: (id) => invoke('notif:markSeen', id),
  // sin notificationId: todas
  markNotificationVisited: (id, notificationId) => invoke('notif:markVisited', id, notificationId),
  onNotification: (callback) => on('notif:event', callback),

  setZoom: (factor) => invoke('ui:zoom', factor),
  downloadImage: (id, url, name) => invoke('ui:download', id, url, name),
  // → { copied }: false si el formato no se pudo decodificar (ver copyImageAt)
  copyImage: (id, url) => invoke('ui:copyImage', id, url),
  // copia la imagen que se ve en ese punto de la ventana (px de CSS)
  copyImageAt: (x, y) => invoke('ui:copyImageAt', x, y),
  copyText: (text) => invoke('ui:copyText', text),
  // abre un link http(s) en el navegador del sistema
  openExternal: (url) => invoke('ui:openExternal', url),
  getAvatarColor: (id, url) => invoke('ui:avatarColor', id, url),

  onLoginError: (callback) => on('login:error', callback),
  onLoginStatus: (callback) => on('login:status', callback),
};

// URL que sirve una imagen de MeWe con las cookies de la cuenta: el protocolo propio de Electron,
// o la que dé la plataforma (Android: src/android/bridge.js)
export function imageUrl(accountId, url) {
  if (!url) return null;
  return window.mewe.imageUrl?.(accountId, url) ?? `mewe-img://${accountId}/?u=${encodeURIComponent(url)}`;
}
