import fs from 'node:fs/promises';
import { dialog, ipcMain } from 'electron';
import { serializeError } from '../mewe/errors.js';

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

  account('chat:threads', (client, me, filter) => client.getChatThreads(me.userId, filter));
  account('chat:messages', (client, me, threadId, beforeId) => client.getMessages(threadId, me.userId, beforeId));
  account('chat:send', (client, me, threadId, message) => client.sendMessage(threadId, me.userId, message));
  account('chat:upload', (client, _me, isGroup, file) => client.uploadChatImage(isGroup, file));
  account('chat:react', (client, _me, threadId, messageId, emoji, on) =>
    client.setMessageReaction(threadId, messageId, emoji, on),
  );
  account('chat:reactors', (client, _me, threadId, messageId) => client.getMessageReactors(threadId, messageId));
  handle('chat:realtime', (accountId) => realtime.start(accountId));

  // Descarga una imagen de MeWe (con las cookies de la cuenta) y la guarda donde elija el usuario
  account('ui:download', async (client, _me, url, suggestedName) => {
    const { data, contentType } = await client.downloadImage(url);
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[contentType] ?? 'jpg';
    const base = String(suggestedName || 'mewe-imagen').replace(/[^\w.-]+/g, '_').replace(/\.\w+$/, '');
    const options = { defaultPath: `${base}.${ext}`, filters: [{ name: 'Imagen', extensions: [ext] }] };
    const win = getWindow();
    const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (canceled || !filePath) return { saved: false };
    await fs.writeFile(filePath, data);
    return { saved: true, filePath };
  });
}
