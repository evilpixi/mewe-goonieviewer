import fs from 'node:fs/promises';
import { clipboard, dialog, ipcMain, nativeImage } from 'electron';
import { serializeError } from '../mewe/errors.js';
import { avatarColor } from './avatarColor.js';

// Todas las respuestas IPC son { ok, data } | { ok: false, error }:
// ipcMain.handle pierde las propiedades de los errores (status, body...) si se lanzan.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      const error = serializeError(err);
      console.error(`[ipc:${channel}]`, error);
      return { ok: false, error };
    }
  });
}

// Canal que opera sobre una cuenta: el renderer manda (accountId, ...args)
// y fn recibe (client, me, ...args), con me = { id, userId } de esa cuenta.
// Agregar un endpoint = un método en MeweClient + una línea acá (el preload ya acepta el prefijo).
function handleAccount(accountManager, channel, fn) {
  handle(channel, (accountId, ...args) => accountManager.withClient(accountId, (client, me) => fn(client, me, ...args)));
}

export function registerIpc({ accountManager, realtime, getWindow }) {
  handle('accounts:list', () => accountManager.list());
  handle('accounts:add', (credentials) => accountManager.add(credentials));
  handle('accounts:relogin', (id) => accountManager.relogin(id));
  handle('accounts:remove', async (id) => {
    realtime.stop(id);
    return accountManager.remove(id);
  });

  const account = (channel, fn) => handleAccount(accountManager, channel, fn);

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
  account('chat:edit', (client, _me, threadId, messageId, text) => client.editMessage(threadId, messageId, text));
  account('chat:upload', (client, _me, isGroup, file) => client.uploadChatImage(isGroup, file));
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

  account('notif:list',(client, _me, nextPage) => client.getNotifications(nextPage));
  account('notif:unseen', (client) => client.getUnseenNotifications());
  account('notif:markSeen', (client) => client.markNotificationsSeen());
  account('notif:markVisited', (client, _me, notificationId) => client.markNotificationVisited(notificationId));

  // Zoom de toda la ventana (ajustes de UI)
  handle('ui:zoom', (factor) => {
    const zoom = Math.min(Math.max(Number(factor) || 1, 0.5), 2.5);
    getWindow()?.webContents.setZoomFactor(zoom);
    return zoom;
  });

  // Color predominante de una foto de perfil (borde de los globos del chat)
  account('ui:avatarColor', (client, _me, url) => avatarColor(client, url));

  // Descarga una imagen de MeWe (con las cookies de la cuenta) y la guarda donde elija el usuario
  account('ui:download', async (client, _me, url, suggestedName) => {
    const { data, contentType } = await client.downloadImage(url);
    const type = contentType.split(';')[0].trim();
    // video/mp4: los videos de las historias se guardan por el mismo camino
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4' }[type] ?? 'jpg';
    const base = String(suggestedName || 'mewe-imagen').replace(/[^\w.-]+/g, '_').replace(/\.\w+$/, '');
    const options = { defaultPath: `${base}.${ext}`, filters: [{ name: ext === 'mp4' ? 'Video' : 'Imagen', extensions: [ext] }] };
    const win = getWindow();
    const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (canceled || !filePath) return { saved: false };
    await fs.writeFile(filePath, data);
    return { saved: true, filePath };
  });

  // Copia una imagen de MeWe al portapapeles. nativeImage sólo decodifica PNG y JPEG: con otro formato
  // devuelve { copied: false } y la UI recurre a ui:copyImageAt.
  account('ui:copyImage', async (client, _me, url) => {
    const { data } = await client.downloadImage(url);
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) return { copied: false };
    clipboard.writeImage(image);
    return { copied: true };
  });

  // Copia la imagen que se ve en ese punto de la ventana (x, y en px de CSS): sirve para WebP y GIF
  handle('ui:copyImageAt', (x, y) => {
    const contents = getWindow()?.webContents;
    if (!contents) return { copied: false };
    const zoom = contents.getZoomFactor();
    contents.copyImageAt(Math.round(Number(x) * zoom), Math.round(Number(y) * zoom));
    return { copied: true };
  });

  handle('ui:copyText', (text) => {
    clipboard.writeText(String(text ?? '').slice(0, 2000));
    return true;
  });
}
