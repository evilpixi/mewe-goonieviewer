import { serializeError } from '../mewe/errors.js';

// Canales que la UI invoca con window.mewe.invoke(canal, ...args). Son los mismos en todas las plataformas:
// cada una los engancha a su puente (Electron: ipcMain, ver src/main/ipc.js) y agrega los suyos ('ui:*').

// Todas las respuestas son { ok, data } | { ok: false, error }: los errores cruzan el puente como objetos
// planos (ipcMain.handle pierde sus propiedades —status, body…— si se lanzan).
export function wrapHandler(channel, fn) {
  return async (...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      const error = serializeError(err);
      console.error(`[ipc:${channel}]`, error);
      return { ok: false, error };
    }
  };
}

// Canal que opera sobre una cuenta: la UI manda (accountId, ...args)
// y fn recibe (client, me, ...args), con me = { id, userId } de esa cuenta.
export function accountChannels(handle, accountManager) {
  return (channel, fn) =>
    handle(channel, (accountId, ...args) => accountManager.withClient(accountId, (client, me) => fn(client, me, ...args)));
}

// Para 'ui:openExternal': la dirección a abrir fuera de la app, o un error si no es un link http(s)
export function externalUrl(url) {
  let target = null;
  try {
    target = new URL(url);
  } catch {
    // no es una dirección
  }
  if (!['http:', 'https:'].includes(target?.protocol)) throw new Error('Link no válido.');
  return target.href;
}

// handle(canal, fn) registra un canal en el puente de la plataforma.
// Agregar un endpoint = un método en MeweClient + una línea acá (el preload ya acepta el prefijo).
export function registerChannels({ handle, accountManager, realtime }) {
  handle('accounts:list', () => accountManager.list());
  handle('accounts:add', (credentials) => accountManager.add(credentials));
  handle('accounts:relogin', (id) => accountManager.relogin(id));
  handle('accounts:remove', async (id) => {
    realtime.stop(id);
    return accountManager.remove(id);
  });

  const account = accountChannels(handle, accountManager);

  account('feed:get', (client, _me, type, nextPage) => client.getFeed(type, nextPage));

  account('post:get', (client, _me, postId, groupId) => client.getPost(postId, groupId));
  account('post:images', (client, _me, postId, groupId) => client.getPostImages(postId, groupId));
  account('post:react', (client, _me, postId, groupId, emoji, on) => client.setPostReaction(postId, groupId, emoji, on));
  account('post:reactors', (client, _me, postId, groupId) => client.getPostReactors(postId, groupId));
  account('post:comments', (client, _me, postId, groupId, page) => client.getComments(postId, groupId, page));
  account('post:comment', (client, _me, postId, groupId, text) => client.addComment(postId, groupId, text));
  account('post:replies', (client, _me, commentId) => client.getReplies(commentId));
  account('post:reply', (client, _me, commentId, text) => client.addReply(commentId, text));
  account('post:commentReact', (client, _me, commentId, emoji, on) => client.setCommentReaction(commentId, emoji, on));
  account('post:commentReactors', (client, _me, commentId) => client.getCommentReactors(commentId));
  account('post:upload', (client, _me, file) => client.uploadPostImage(file));
  account('post:create', (client, _me, post) => client.createPost(post));
  account('post:edit', (client, _me, postId, groupId, changes) => client.editPost(postId, groupId, changes));

  account('chat:threads', (client, me, filter) => client.getChatThreads(me.userId, filter));
  account('chat:messages', (client, me, threadId, beforeId) => client.getMessages(threadId, me.userId, beforeId));
  account('chat:send', (client, me, threadId, message) => client.sendMessage(threadId, me.userId, message));
  account('chat:forward', (client, me, threadId, isGroup, message) => client.forwardMessage(threadId, me.userId, isGroup, message));
  account('chat:edit',(client, _me, threadId, messageId, text) => client.editMessage(threadId, messageId, text));
  account('chat:upload', (client, _me, isGroup, file) => client.uploadChatImage(isGroup, file));
  account('chat:video', (client, _me, threadId, file, options) => client.sendChatVideo(threadId, file, options));
  account('chat:react', (client, _me, threadId, messageId, emoji, on) =>
    client.setMessageReaction(threadId, messageId, emoji, on),
  );
  account('chat:reactors', (client, _me, threadId, messageId) => client.getMessageReactors(threadId, messageId));
  account('chat:open', (client, me, userId) => client.openChatWith(userId, me.userId));
  account('chat:read', (client, _me, threadId) => client.markChatRead(threadId));
  account('chat:seen', (client, _me, messageId) => client.markMessageSeen(messageId));
  handle('chat:realtime', (accountId) => realtime.start(accountId));

  account('profile:get', (client, me, userId) => client.getProfile(userId, me.userId));
  account('profile:search', (client, _me, query) => client.searchUsers(query));
  account('profile:feed', (client, _me, userId, nextPage) => client.getUserFeed(userId, nextPage));
  account('profile:media', (client, _me, userId, nextPage, album) => client.getUserMedia(userId, nextPage, album));
  account('profile:albums', (client, _me, userId, nextPage) => client.getUserAlbums(userId, nextPage));
  account('profile:follow', (client, _me, userId, on) => client.setFollow(userId, on));
  account('profile:requests', (client) => client.getFollowRequests());
  account('profile:answerRequest', (client, _me, requestId, accept) => client.answerFollowRequest(requestId, accept));
  account('profile:people', (client, _me, kind, nextPage) => client.getPeople(kind, nextPage));
  account('profile:block', (client, _me, userId) => client.blockUser(userId));
  account('profile:unblock', (client, _me, userId) => client.unblockUser(userId));
  account('profile:update', (client, me, changes) => client.updateProfile(me.userId, changes));
  account('profile:setAvatar', (client, _me, file, crop) => client.setAvatar(file, crop));
  account('profile:setCover', (client, _me, file, crop) => client.setCover(file, crop));

  account('group:list', (client) => client.getGroups());
  account('group:get', (client, _me, groupId) => client.getGroup(groupId));
  account('group:feed', (client, _me, groupId, nextPage) => client.getGroupFeed(groupId, nextPage));
  account('group:members', (client, _me, groupId, options) => client.getGroupMembers(groupId, options));
  account('group:events', (client, _me, groupId, when) => client.getGroupEvents(groupId, when));
  account('group:join', (client, _me, groupId, answers) => client.joinGroup(groupId, answers));
  account('group:leave', (client, me, groupId) => client.leaveGroup(groupId, me.userId));
  account('group:contacts', (client, _me, groupId, query, offset) => client.searchGroupContacts(groupId, query, offset));
  account('group:invite', (client, _me, groupId, userIds) => client.inviteToGroup(groupId, userIds));

  account('story:tellers', (client, me) => client.getStorytellers(me.userId));
  account('story:list', (client, _me, tellerId, isPage) => client.getStories(tellerId, isPage));
  account('story:seen', (client, _me, views) => client.markStoriesSeen(views));
  account('story:reply', (client, _me, tellerId, storyId, text) => client.replyToStory(tellerId, storyId, text));
  account('story:create', (client, _me, file, scope) => client.createStory(file, scope));
  account('story:delete', (client, _me, storyId, scope) => client.deleteStory(storyId, scope));

  account('notif:list', (client, _me, nextPage) => client.getNotifications(nextPage));
  account('notif:unseen', (client) => client.getUnseenNotifications());
  account('notif:markSeen', (client) => client.markNotificationsSeen());
  account('notif:markVisited', (client, _me, notificationId) => client.markNotificationVisited(notificationId));
}
