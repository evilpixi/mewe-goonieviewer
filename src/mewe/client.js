import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { MeweApiError } from './errors.js';
import {
  normalizeComment,
  normalizeComments,
  normalizeFeed,
  normalizeMedias,
  normalizeMessage,
  normalizeMessages,
  normalizePostDetails,
  normalizeProfile,
  normalizeReactors,
  normalizeThreads,
} from './normalize.js';

const { host, endpoints, userAgent, cookies: cookieNames, chat, comments } = config.mewe;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Los ids van dentro de rutas: sólo se aceptan [A-Za-z0-9_-]
function assertId(value, label = 'id') {
  if (!/^[\w-]+$/.test(value ?? '')) throw new MeweApiError({ message: `${label} inválido: ${value}` });
  return value;
}

function assertEmoji(emoji) {
  if (typeof emoji !== 'string' || !emoji || emoji.length > 32) {
    throw new MeweApiError({ message: `Emoji inválido: ${emoji}` });
  }
  return emoji;
}

// nextPage viene de la propia API (_links.nextPage.href); sólo se aceptan rutas relativas
function assertNextPage(nextPage) {
  if (nextPage && !String(nextPage).startsWith('/api/')) {
    throw new MeweApiError({ message: `nextPage inválido: ${nextPage}` });
  }
  return nextPage;
}

function postBase(postId, groupId) {
  return config.mewe.post(assertId(postId, 'postId'), groupId ? assertId(groupId, 'groupId') : null);
}

// Cliente de la API interna de MeWe para UNA cuenta.
// Las cookies viven en la sesión de Electron de esa cuenta (ver SessionCookies).
export class MeweClient {
  constructor(cookies) {
    this.cookies = cookies;
  }

  async headers(url, extra = {}) {
    const headers = {
      'user-agent': userAgent,
      accept: 'application/json, text/plain, */*',
      origin: host,
      referer: `${host}/`,
      cookie: await this.cookies.header(url),
      ...extra,
    };
    const csrf = await this.cookies.get(cookieNames.csrf);
    if (csrf) headers['x-csrf-token'] = csrf;
    return headers;
  }

  // json: cuerpo JSON · form: FormData (multipart, fetch pone el boundary)
  async request(path, { method = 'GET', query, json, form } = {}) {
    const url = new URL(path, host);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v != null) url.searchParams.set(k, v);
    }

    const extra = json !== undefined ? { 'content-type': 'application/json; charset=UTF-8' } : {};
    const response = await fetch(url, {
      method,
      headers: await this.headers(url, extra),
      body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
    });
    await this.cookies.storeFromResponse(url, response);

    const text = await response.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // respuesta no JSON: se deja como texto
    }

    if (config.debug) await dumpResponse(method, url, response.status, text);
    if (!response.ok) throw new MeweApiError({ status: response.status, url, body });
    return body;
  }

  // Descarga binaria (imágenes) con las cookies de la cuenta
  async fetchRaw(url) {
    const response = await fetch(url, { headers: await this.headers(url) });
    await this.cookies.storeFromResponse(url, response);
    return response;
  }

  async hasSessionCookie() {
    return Boolean(await this.cookies.get(cookieNames.session));
  }

  async getMe() {
    return normalizeProfile(await this.request(endpoints.me));
  }

  // --- Feed y posts ---

  async getFeed(type = config.mewe.defaultFeed, nextPage) {
    const path = config.mewe.feeds[type];
    if (!path) throw new MeweApiError({ message: `Tipo de feed desconocido: ${type}` });
    return normalizeFeed(await this.request(assertNextPage(nextPage) ?? path));
  }

  async getPost(postId, groupId) {
    return normalizePostDetails(await this.request(postBase(postId, groupId)));
  }

  // Todas las fotos de un multipost (el feed sólo trae las primeras)
  async getPostImages(postId, groupId) {
    return normalizeMedias(await this.request(`${postBase(postId, groupId)}/multipost/medias`));
  }

  setPostReaction(postId, groupId, emoji, on) {
    return this.#setReaction(`${postBase(postId, groupId)}/emojis`, emoji, on);
  }

  async getPostReactors(postId, groupId) {
    return normalizeReactors(await this.request(`${postBase(postId, groupId)}/emojis`));
  }

  // --- Comentarios ---

  async getComments(postId, groupId, { nextPage, afterId } = {}) {
    const data = nextPage
      ? await this.request(assertNextPage(nextPage))
      : await this.request(`${postBase(postId, groupId)}/comments`, {
          query: { maxResults: comments.pageSize, afterId: afterId ? assertId(afterId) : undefined },
        });
    return normalizeComments(data);
  }

  async addComment(postId, groupId, text) {
    const data = await this.request(`${postBase(postId, groupId)}/comments`, {
      method: 'POST',
      json: { text: requireText(text) },
    });
    return normalizeComment(data?.comment ?? data ?? {});
  }

  async getReplies(commentId) {
    return normalizeComments(await this.request(comments.replies(assertId(commentId))));
  }

  async addReply(commentId, text) {
    const data = await this.request(comments.reply(assertId(commentId)), {
      method: 'POST',
      json: { text: requireText(text) },
    });
    return normalizeComment(data?.comment ?? data ?? {});
  }

  setCommentReaction(commentId, emoji, on) {
    return this.#setReaction(comments.emojis(assertId(commentId)), emoji, on);
  }

  async getCommentReactors(commentId) {
    return normalizeReactors(await this.request(comments.emojis(assertId(commentId))));
  }

  // --- Chats ---

  async getChatThreads(myUserId, filter = 'users') {
    const chatType = chat.chatTypes[filter];
    if (!chatType) throw new MeweApiError({ message: `Filtro de chats desconocido: ${filter}` });
    const data = await this.request(chat.threads, {
      method: 'POST',
      json: { addRequests: false, chatType },
    });
    return normalizeThreads(data, myUserId);
  }

  async getMessages(threadId, myUserId, beforeId) {
    const data = await this.request(chat.messages(assertId(threadId, 'threadId')), {
      query: { limit: chat.pageSize, beforeId: beforeId ? assertId(beforeId) : undefined },
    });
    return normalizeMessages(data, myUserId);
  }

  // { text, replyTo, attachments: [id], expiresIn: segundos }
  async sendMessage(threadId, myUserId, { text, replyTo, attachments, expiresIn } = {}) {
    assertId(threadId, 'threadId');
    const message = String(text ?? '').trim();
    const ids = (attachments ?? []).map((id) => assertId(id, 'attachmentId'));
    if (!message && !ids.length) throw new MeweApiError({ message: 'El mensaje está vacío.' });

    const json = { setAsRead: true, message };
    if (ids.length) json.attachments = ids;
    if (replyTo) json.replyTo = assertId(replyTo, 'replyTo');
    // La web no envía mensajes temporales (sólo la app móvil): se manda expiresIn como el modelo
    // de mensaje lo expone. Si MeWe lo ignora, el mensaje vuelve sin expiresIn y la UI lo avisa.
    if (expiresIn) json.expiresIn = Number(expiresIn);

    const data = await this.request(chat.send(threadId), { method: 'POST', json });
    return normalizeMessage(data?.message ?? data ?? {}, myUserId);
  }

  // file = { name, type, data: Uint8Array } desde el renderer. Devuelve el id del adjunto.
  async uploadChatImage(isGroup, file) {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file?.type ?? '')) {
      throw new MeweApiError({ message: `Tipo de imagen no soportado: ${file?.type}` });
    }
    const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data ?? []);
    if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new MeweApiError({ message: 'La imagen está vacía o supera 20 MB.' });
    }
    const form = new FormData();
    form.append('files[]', new Blob([bytes], { type: file.type }), file.name || 'image');
    const data = await this.request(chat.upload(isGroup), { method: 'POST', form });
    const id = data?.id ?? data?.[0]?.id ?? data?.files?.[0]?.id;
    if (!id) throw new MeweApiError({ message: 'MeWe no devolvió el id de la imagen subida.', body: data });
    return id;
  }

  setMessageReaction(threadId, messageId, emoji, on) {
    return this.#setReaction(chat.emojis(assertId(threadId, 'threadId'), assertId(messageId)), emoji, on);
  }

  async getMessageReactors(threadId, messageId) {
    return normalizeReactors(await this.request(chat.emojis(assertId(threadId, 'threadId'), assertId(messageId))));
  }

  // --- Imágenes ---

  async downloadImage(url) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !(target.hostname === 'mewe.com' || target.hostname.endsWith('.mewe.com'))) {
      throw new MeweApiError({ message: 'Host de imagen no permitido.' });
    }
    const response = await this.fetchRaw(target);
    if (!response.ok) throw new MeweApiError({ status: response.status, url: target, message: 'No se pudo descargar la imagen.' });
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  // POST [emoji] agrega, DELETE ?emojis= quita (mismo formato en posts, comentarios y mensajes)
  async #setReaction(path, emoji, on) {
    assertEmoji(emoji);
    if (on) await this.request(path, { method: 'POST', json: [emoji] });
    else await this.request(path, { method: 'DELETE', query: { emojis: emoji } });
    return true;
  }
}

function requireText(text) {
  const value = String(text ?? '').trim();
  if (!value) throw new MeweApiError({ message: 'El texto está vacío.' });
  return value;
}

// Modo debug: consola + la última respuesta de cada endpoint en ./mewe-debug/
async function dumpResponse(method, url, status, text) {
  console.log(`[mewe] ${method} ${url} -> ${status}`, text.slice(0, 500));
  const dir = path.join(process.cwd(), 'mewe-debug');
  const file = `${url.pathname.replace(/^\/api\//, '').replace(/[^\w-]+/g, '_')}.json`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), text);
}
