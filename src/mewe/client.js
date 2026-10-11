import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { MeweApiError } from './errors.js';
import {
  normalizeAlbums,
  normalizeComment,
  normalizeComments,
  normalizeContacts,
  normalizeEvents,
  normalizeFeed,
  normalizeFollowRequests,
  normalizeGroup,
  normalizeGroups,
  normalizeMedias,
  normalizeMediaStream,
  normalizeMembers,
  normalizeMessage,
  normalizeMessages,
  normalizeNotifications,
  normalizePostDetails,
  normalizeProfile,
  normalizeReactors,
  normalizeStories,
  normalizeStorytellers,
  normalizeThreads,
  normalizeUserProfile,
} from './normalize.js';

const { host, endpoints, userAgent, cookies: cookieNames, chat, comments, profile, groups, stories, notifications } = config.mewe;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const REFRESH_MIN_INTERVAL_MS = 30000; // no renovar la sesión más seguido que esto
const TEMPORAL_CACHE_ITEMS = 30; // imágenes temporales que se guardan en memoria
const TEMPORAL_CACHE_MAX_BYTES = 8 * 1024 * 1024; // las más pesadas no se guardan

// Campos del perfil público. PUT /profile/public los pisa todos: siempre van juntos (ver updateProfile).
const PROFILE_KEYS = ['text', 'currentCity', 'job', 'company', 'college', 'highSchool', 'relationshipStatus', 'interests', 'email', 'phone'];
const PEOPLE_LISTS = { followers: profile.followers, following: profile.followed, blocked: profile.blocked };

// file = { name, type, data: Uint8Array } desde el renderer → FormData con la imagen en `field`
function imageForm(file, field) {
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file?.type ?? '')) {
    throw new MeweApiError({ message: `Tipo de imagen no soportado: ${file?.type}` });
  }
  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data ?? []);
  if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new MeweApiError({ message: 'La imagen está vacía o supera 20 MB.' });
  }
  const form = new FormData();
  form.append(field, new Blob([bytes], { type: file.type }), file.name || 'image');
  return form;
}

// Recorte { x, y, width, height } en píxeles de la imagen original → los nombres que usa MeWe
function cropParams(crop) {
  const px = (value) => Math.max(0, Math.round(Number(value) || 0));
  if (!crop || px(crop.width) < 1 || px(crop.height) < 1) throw new MeweApiError({ message: 'Recorte de imagen inválido.' });
  return { croppX: px(crop.x), croppY: px(crop.y), croppW: px(crop.width), croppH: px(crop.height) };
}

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
  #temporal = new Map(); // url → { data, contentType } de las imágenes temporales ya vistas

  constructor(cookies) {
    this.cookies = cookies;
    this.refreshing = null; // renovación de sesión en curso (promesa compartida)
    this.refreshedAt = 0; // última renovación correcta
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

  // json: cuerpo JSON · form: FormData (multipart, fetch pone el boundary) · urlencoded: objeto → form-urlencoded
  async request(path, { method = 'GET', query, json, form, urlencoded } = {}) {
    const url = new URL(path, host);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v != null) url.searchParams.set(k, v);
    }

    let extra = {};
    if (json !== undefined) extra = { 'content-type': 'application/json; charset=UTF-8' };
    else if (urlencoded) extra = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    const send = async () =>
      fetch(url, {
        method,
        headers: await this.headers(url, extra),
        body:
          form ??
          (json !== undefined ? JSON.stringify(json) : urlencoded ? new URLSearchParams(urlencoded).toString() : undefined),
      });

    const startedAt = Date.now();
    let response = await send();
    await this.cookies.storeFromResponse(url, response);
    // 401/403 suele ser que faltan access-token / csrf-token (ver refreshSession): se renuevan y se reintenta una vez
    if ((response.status === 401 || response.status === 403) && (await this.refreshSession(startedAt))) {
      response = await send();
      await this.cookies.storeFromResponse(url, response);
    }

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

  // Renueva las cookies de corta vida con el refresh-token, como hace la web al cargar (GET /auth/identify).
  // access-token y csrf-token son cookies de sesión: Electron no las guarda entre arranques, y sin ellas
  // MeWe responde 403 aunque la sesión siga siendo válida. Devuelve true si la sesión quedó renovada.
  // Las peticiones simultáneas comparten una sola renovación.
  //   since: cuándo salió la petición que falló. Si la sesión ya se renovó después, alcanza con reintentar;
  //   si se renovó hace poco y aun así falla, el 403 es real (ej. una cuenta privada) y no se insiste.
  refreshSession(since = Date.now()) {
    if (this.refreshedAt > since) return Promise.resolve(true);
    if (Date.now() - this.refreshedAt < REFRESH_MIN_INTERVAL_MS) return Promise.resolve(false);
    this.refreshing ??= (async () => {
      try {
        const url = new URL(endpoints.identify, host);
        const response = await fetch(url, { headers: await this.headers(url) });
        await this.cookies.storeFromResponse(url, response);
        if (config.debug) console.log(`[mewe] renovar sesión (identify) -> ${response.status}`);
        if (response.ok) this.refreshedAt = Date.now();
        return response.ok;
      } catch (err) {
        console.warn('[mewe] no se pudo renovar la sesión:', err.message);
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // Descarga binaria (imágenes y videos) con las cookies de la cuenta. extra: headers de más (ej. range)
  async fetchRaw(url, extra = {}) {
    const startedAt = Date.now();
    let response = await fetch(url, { headers: await this.headers(url, extra) });
    await this.cookies.storeFromResponse(url, response);
    // las cookies del CDN de imágenes duran ~20 min: se renuevan igual que la sesión
    if ((response.status === 401 || response.status === 403) && (await this.refreshSession(startedAt))) {
      response = await fetch(url, { headers: await this.headers(url, extra) });
      await this.cookies.storeFromResponse(url, response);
    }
    return response;
  }

  // Las imágenes temporales del chat se piden a mewe.com con un tamaño fijo (ver normalize.js)
  isTemporalImage(url) {
    const target = new URL(url);
    return target.hostname === new URL(host).hostname && target.pathname.includes(`/${chat.disappearingImageSize}/`);
  }

  // Una imagen temporal se guarda en memoria la primera vez que se ve: así se puede volver a abrir (y guardar
  // o copiar) aunque MeWe ya no la entregue. Dura lo que la app abierta. → { status, data, contentType, cached }
  async fetchTemporalImage(url) {
    const key = String(url);
    const hit = this.#temporal.get(key);
    if (hit) return { status: 200, ...hit, cached: true };
    const response = await this.fetchRaw(url);
    const data = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    if (response.ok && data.length && data.length <= TEMPORAL_CACHE_MAX_BYTES) {
      this.#temporal.set(key, { data, contentType });
      // se descartan las más viejas (un Map conserva el orden de inserción)
      while (this.#temporal.size > TEMPORAL_CACHE_ITEMS) this.#temporal.delete(this.#temporal.keys().next().value);
    }
    return { status: response.status, data, contentType, cached: false };
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

  // Sube una foto para un post nuevo. Devuelve su id (va en imageIds al crear el post).
  uploadPostImage(file) {
    return this.#uploadPhoto(config.mewe.posts.upload, file);
  }

  // Publica en el feed propio o, con groupId, en un grupo. everyone: visible para todos, no sólo para quienes siguen.
  async createPost({ text, imageIds, groupId, everyone } = {}) {
    const body = String(text ?? '').trim();
    const ids = (imageIds ?? []).slice(0, config.mewe.posts.maxImages).map((id) => assertId(id, 'imageId'));
    if (!body && !ids.length) throw new MeweApiError({ message: 'La publicación está vacía.' });
    const json = { text: body };
    if (ids.length) json.imageIds = ids;
    if (everyone && !groupId) json.everyone = true;
    const data = await this.request(config.mewe.posts.create(groupId ? assertId(groupId, 'groupId') : null), { method: 'POST', json });
    return data?.post ? normalizePostDetails(data) : null;
  }

  // Cambia el texto de un post propio. mediaIds: las fotos que tiene y se conservan (MeWe quita las que no vayan).
  async editPost(postId, groupId, { text, mediaIds } = {}) {
    const json = {
      text: String(text ?? '').trim(),
      mediaIds: (mediaIds ?? []).map((id) => assertId(id, 'mediaId')),
      existingFileIds: [],
      stickers: [],
    };
    if (!json.text && !json.mediaIds.length) throw new MeweApiError({ message: 'La publicación está vacía.' });
    const data = await this.request(`${postBase(postId, groupId)}/edit`, { method: 'PUT', json });
    return data?.post ? normalizePostDetails(data) : null;
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
    // 'all': con el chatType AllChat de MeWe la lista no se veía; se juntan personas y grupos, que sí funcionan
    if (filter === 'all') {
      const lists = await Promise.all(['users', 'groups'].map((type) => this.getChatThreads(myUserId, type)));
      const byId = new Map(lists.flat().map((thread) => [thread.id, thread]));
      return [...byId.values()];
    }
    const chatType = chat.chatTypes[filter];
    if (!chatType) throw new MeweApiError({ message: `Filtro de chats desconocido: ${filter}` });
    const data = await this.request(chat.threads, {
      method: 'POST',
      json: { addRequests: false, chatType },
    });
    return normalizeThreads(data, myUserId);
  }

  // Chat de a dos con una persona: el que ya existe o, si no hay, uno nuevo
  async openChatWith(userId, myUserId) {
    assertId(userId, 'userId');
    const existing = (await this.getChatThreads(myUserId, 'users')).find((thread) => thread.userId === userId);
    if (existing) return existing;
    const data = await this.request(chat.create, { method: 'POST', json: { receivers: [userId] } });
    const [created] = normalizeThreads({ threads: [data?.thread ?? data ?? {}], users: data?.users }, myUserId);
    if (!created?.id) throw new MeweApiError({ message: 'MeWe no devolvió el chat creado.', body: data });
    return { ...created, userId };
  }

  // Marca un chat como leído (la web lo hace al enfocar la caja de texto)
  async markChatRead(threadId) {
    await this.request(chat.markRead(assertId(threadId, 'threadId')), { method: 'DELETE' });
    return true;
  }

  // Mensaje temporal visto: a partir de acá MeWe empieza a contar para borrarlo
  async markMessageSeen(messageId) {
    await this.request(chat.seen(assertId(messageId)), { method: 'POST' });
    return true;
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

  // Cambia el texto de un mensaje propio (igual que la web: PUT { text })
  async editMessage(threadId, messageId, text) {
    await this.request(chat.edit(assertId(threadId, 'threadId'), assertId(messageId, 'messageId')), {
      method: 'PUT',
      json: { text: requireText(text) },
    });
    return true;
  }

  // file = { name, type, data: Uint8Array } desde el renderer. Devuelve el id del adjunto.
  uploadChatImage(isGroup, file) {
    return this.#uploadPhoto(chat.upload(isGroup), file, 'files[]');
  }

  setMessageReaction(threadId, messageId, emoji, on) {
    return this.#setReaction(chat.emojis(assertId(threadId, 'threadId'), assertId(messageId)), emoji, on);
  }

  async getMessageReactors(threadId, messageId) {
    return normalizeReactors(await this.request(chat.emojis(assertId(threadId, 'threadId'), assertId(messageId))));
  }

  // --- Perfiles ---

  async getProfile(userId, myUserId) {
    const data = await this.request(profile.details(assertId(userId, 'userId')), { query: { details: true } });
    return normalizeUserProfile(data, myUserId);
  }

  // Buscador de personas de MeWe (el mismo de la web)
  async searchUsers(query) {
    const text = String(query ?? '').trim().slice(0, 100);
    if (text.length < 2) return [];
    const data = await this.request(profile.search, { query: { query: text, limit: 30, nm: 1 } });
    return normalizeContacts(data).filter((user) => user.id);
  }

  async getUserFeed(userId, nextPage) {
    return normalizeFeed(await this.request(assertNextPage(nextPage) ?? profile.feed(assertId(userId, 'userId'))));
  }

  // album: nombre del álbum (sin él, todas las imágenes del perfil)
  async getUserMedia(userId, nextPage, album) {
    assertId(userId, 'userId');
    if (album != null && (typeof album !== 'string' || !album || album.length > 200)) {
      throw new MeweApiError({ message: `Álbum inválido: ${album}` });
    }
    const path = album ? profile.albumMedia(userId, album) : profile.media(userId);
    return normalizeMediaStream(await this.request(assertNextPage(nextPage) ?? path));
  }

  async getUserAlbums(userId, nextPage) {
    return normalizeAlbums(await this.request(assertNextPage(nextPage) ?? profile.albums(assertId(userId, 'userId'))));
  }

  // on: seguir (o pedir seguir, si la cuenta es privada) · off: dejar de seguir
  // Devuelve cómo quedó: { following, requestSent } (requestSent = id de la solicitud pendiente)
  async setFollow(userId, on) {
    const data = await this.request(profile.follow(assertId(userId, 'userId')), { method: on ? 'POST' : 'DELETE' });
    const follow = data?.follow ?? data ?? {};
    return {
      following: Boolean(on && follow.following),
      requestSent: (on && (follow.followRequestId ?? follow.followRequestSent)) || null,
    };
  }

  async getFollowRequests() {
    return normalizeFollowRequests(await this.request(profile.requestsReceived));
  }

  // accept: aceptar una solicitud recibida · si no, rechazarla (o cancelar una enviada)
  async answerFollowRequest(requestId, accept) {
    assertId(requestId, 'requestId');
    if (accept) await this.request(profile.acceptRequest(requestId), { method: 'POST' });
    else await this.request(profile.removeRequest(requestId), { method: 'DELETE' });
    return true;
  }

  // kind: 'followers' | 'following' | 'blocked' → { users, nextPage }
  async getPeople(kind, nextPage) {
    const path = PEOPLE_LISTS[kind];
    if (!path) throw new MeweApiError({ message: `Lista de personas desconocida: ${kind}` });
    const data = nextPage
      ? await this.request(assertNextPage(nextPage))
      : await this.request(path, { query: { maxResults: profile.listPageSize } });
    return { users: normalizeContacts(data).filter((user) => user.id), nextPage: data?._links?.nextPage?.href ?? null };
  }

  async blockUser(userId) {
    await this.request(profile.block, { method: 'POST', query: { userId: assertId(userId, 'userId') } });
    return true;
  }

  async unblockUser(userId) {
    await this.request(profile.unblock, { method: 'POST', query: { userId: assertId(userId, 'userId') } });
    return true;
  }

  // --- Perfil propio ---

  // Foto de perfil: se sube y MeWe la recorta. crop = { x, y, width, height } en píxeles de la imagen.
  async setAvatar(file, crop) {
    const picture = cropParams(crop);
    picture.id = await this.#uploadPhoto(profile.uploadAvatar, file);
    await this.request(profile.avatar, { method: 'PUT', json: { picture } });
    return true;
  }

  async setCover(file, crop) {
    const json = cropParams(crop);
    json.id = await this.#uploadPhoto(profile.uploadCover, file);
    await this.request(profile.cover, { method: 'PUT', json });
    return true;
  }

  // { firstName, lastName, fields: { text, currentCity, job, … } }: sólo se toca lo que venga.
  // MeWe reemplaza el perfil público entero, así que los campos que no cambian se reenvían con su valor actual.
  async updateProfile(myUserId, { firstName, lastName, fields } = {}) {
    if (fields) {
      const data = await this.request(profile.details(assertId(myUserId, 'userId')), { query: { details: true } });
      const current = data?.profile ?? data?.user?.profile ?? {};
      const json = { status: current.status ?? {} };
      for (const key of PROFILE_KEYS) {
        const value = fields[key] ?? current[key];
        if (value != null) json[key] = String(value).trim().slice(0, key === 'text' ? 5000 : 500);
      }
      await this.request(profile.publicProfile, { method: 'PUT', json });
    }
    if (firstName != null || lastName != null) {
      const name = { firstName: String(firstName ?? '').trim().slice(0, 100), lastName: String(lastName ?? '').trim().slice(0, 100) };
      if (!name.firstName) throw new MeweApiError({ message: 'El nombre no puede quedar vacío.' });
      await this.request(profile.account, { method: 'POST', json: name });
    }
    return true;
  }

  // --- Grupos ---

  async getGroups() {
    return normalizeGroups(await this.request(groups.mine));
  }

  async getGroup(groupId) {
    return normalizeGroup(await this.request(groups.details(assertId(groupId, 'groupId'))));
  }

  async getGroupFeed(groupId, nextPage) {
    assertId(groupId, 'groupId');
    const page = normalizeFeed(await this.request(assertNextPage(nextPage) ?? groups.feed(groupId)));
    for (const post of page.posts) post.groupId ??= groupId; // el feed de un grupo puede no repetirlo en cada post
    return page;
  }

  async getGroupMembers(groupId, { offset = 0, adminsOnly = false } = {}) {
    const data = await this.request(groups.members(assertId(groupId, 'groupId')), {
      query: { offset: Number(offset) || 0, maxResults: groups.membersPageSize, onlyOwnerAdmins: adminsOnly ? true : undefined },
    });
    const members = normalizeMembers(data);
    return { members, hasMore: members.length >= groups.membersPageSize };
  }

  // when: 'upcoming' | 'past'
  async getGroupEvents(groupId, when = 'upcoming') {
    if (!['upcoming', 'past'].includes(when)) throw new MeweApiError({ message: `Filtro de eventos desconocido: ${when}` });
    const data = await this.request(groups.events(assertId(groupId, 'groupId'), when), {
      query: { v: 2, maxResults: groups.eventsPageSize },
    });
    return normalizeEvents(data);
  }

  // Invitación pendiente → se confirma; grupo público → se pide entrar (puede quedar pendiente de aprobación)
  // answers: [{ question, answer }] para los grupos que hacen preguntas antes de entrar
  async joinGroup(groupId, answers) {
    const group = await this.getGroup(groupId);
    // MeWe exige la respuesta en `text` (con `answer` responde 400: "Missing required field at 'answers[0].text'")
    const list = (Array.isArray(answers) ? answers : []).slice(0, 50).map((item) => ({
      question: String(item?.question ?? '').slice(0, 2000),
      text: String(item?.answer ?? '').trim().slice(0, 5000),
    }));
    if (group.mandatoryQuestions && group.questions.some((q, i) => !list[i]?.text)) {
      throw new MeweApiError({ message: 'Este grupo exige responder todas sus preguntas para entrar.' });
    }
    const json = list.length ? { answers: list } : {};
    if (group.isInvited) {
      await this.request(groups.confirmInvite(groupId), { method: 'POST', json });
    } else if (group.publicUrlId) {
      await this.request(groups.apply(group.publicUrlId), { method: 'POST', json });
    } else {
      throw new MeweApiError({ message: 'Este grupo es privado: sólo se puede entrar con una invitación.' });
    }
    return this.getGroup(groupId);
  }

  async leaveGroup(groupId, myUserId) {
    await this.request(groups.member(assertId(groupId, 'groupId'), assertId(myUserId, 'userId')), { method: 'DELETE' });
    return true;
  }

  // Contactos para invitar a un grupo (sin texto: todos). Cada uno dice si ya está en el grupo o ya fue invitado.
  async searchGroupContacts(groupId, query, offset = 0) {
    assertId(groupId, 'groupId');
    const search = String(query ?? '').trim().slice(0, 100);
    const data = await this.request(groups.toInvite, {
      query: {
        search: search || undefined,
        maxResults: groups.invitePageSize,
        offset: Math.max(0, Number(offset) || 0),
        markGroupMembersOf: groupId,
      },
    });
    const contacts = normalizeContacts(data).filter((user) => user.id);
    return { contacts, hasMore: contacts.length >= groups.invitePageSize };
  }

  async inviteToGroup(groupId, userIds) {
    assertId(groupId, 'groupId');
    const userInvitees = (userIds ?? []).map((id) => ({ userId: assertId(id, 'userId') }));
    if (!userInvitees.length) throw new MeweApiError({ message: 'Elige al menos una persona para invitar.' });
    await this.request(groups.members(groupId), { method: 'POST', json: { groupId, userInvitees } });
    return true;
  }

  // --- Historias ---

  // Quienes tienen historias para ver (las propias no siempre vienen acá: ver getStories)
  async getStorytellers(myUserId) {
    return normalizeStorytellers(await this.request(stories.feed), myUserId);
  }

  // Todas las historias de una persona (o de una página, con isPage)
  async getStories(tellerId, isPage = false) {
    return normalizeStories(await this.request(stories.byTeller(assertId(tellerId, 'tellerId'), Boolean(isPage))));
  }

  // views: [{ storyId, tellerId, tellerType }] de las historias que se acaban de ver
  async markStoriesSeen(views) {
    const list = (Array.isArray(views) ? views : []).slice(0, 200).map((view) => ({
      storyId: assertId(view?.storyId, 'storyId'),
      storytellerId: assertId(view?.tellerId, 'tellerId'),
      storytellerType: view?.tellerType === 'Page' ? 'Page' : 'User',
      viewedAt: Number(view?.viewedAt) || Date.now(),
    }));
    if (list.length) await this.request(stories.markSeen, { method: 'POST', json: { views: list } });
    return true;
  }

  // La respuesta le llega a su autor como un mensaje de chat
  async replyToStory(tellerId, storyId, text) {
    await this.request(stories.reply(assertId(tellerId, 'tellerId'), assertId(storyId, 'storyId')), {
      method: 'POST',
      json: { message: requireText(text).slice(0, 2000) },
    });
    return true;
  }

  // Publica una imagen como historia. scope: 'followers' | 'public' | 'favorites'
  async createStory(file, scope = 'followers') {
    if (!stories.scopes.includes(scope)) throw new MeweApiError({ message: `Audiencia de historia desconocida: ${scope}` });
    const userMediaId = await this.#uploadPhoto(stories.upload, file, 'files');
    // la web manda siempre esta ubicación fija
    await this.request(stories.create(scope), { method: 'POST', json: { userMediaId, location: { latitude: 0.1, longitude: 0.1 } } });
    return true;
  }

  async deleteStory(storyId, scope) {
    const where = String(scope ?? '').toLowerCase();
    // el alcance va en la ruta: se usa el que trae la historia (visto en el bundle: public, followers, favorites)
    if (!/^[a-z]+$/.test(where)) throw new MeweApiError({ message: `No se puede borrar esta historia (alcance: ${scope}).` });
    await this.request(stories.remove(where, assertId(storyId, 'storyId')), { method: 'DELETE' });
    return true;
  }

  // --- Notificaciones ---

  async getNotifications(nextPage) {
    const data = nextPage
      ? await this.request(assertNextPage(nextPage))
      : await this.request(notifications.feed, { query: { maxResults: notifications.pageSize } });
    return normalizeNotifications(data);
  }

  async getUnseenNotifications() {
    const data = await this.request(notifications.unseen);
    return { unseenCount: Number(data?.unseenCount ?? data?.count ?? data) || 0 };
  }

  // Pone en 0 el contador de no vistas (como abrir la campana en la web)
  async markNotificationsSeen() {
    await this.request(notifications.markSeen, { method: 'POST' });
    return true;
  }

  // Sin id: marca todas como leídas
  async markNotificationVisited(notificationId) {
    await this.request(notifications.markVisited, {
      method: 'POST',
      urlencoded: notificationId ? { notificationId: assertId(notificationId, 'notificationId') } : { all: true },
    });
    return true;
  }

  // --- Imágenes ---

  async downloadImage(url) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !(target.hostname === 'mewe.com' || target.hostname.endsWith('.mewe.com'))) {
      throw new MeweApiError({ message: 'Host de imagen no permitido.' });
    }
    if (this.isTemporalImage(target)) {
      const image = await this.fetchTemporalImage(target);
      if (image.status >= 400) throw new MeweApiError({ status: image.status, url: target, message: 'No se pudo descargar la imagen.' });
      return { data: image.data, contentType: image.contentType };
    }
    const response = await this.fetchRaw(target);
    if (!response.ok) throw new MeweApiError({ status: response.status, url: target, message: 'No se pudo descargar la imagen.' });
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  // Sube una imagen (multipart) y devuelve su id
  async #uploadPhoto(path, file, field = 'file') {
    const data = await this.request(path, { method: 'POST', form: imageForm(file, field) });
    const id = data?.id ?? data?.[0]?.id ?? data?.files?.[0]?.id;
    if (!id) throw new MeweApiError({ message: 'MeWe no devolvió el id de la imagen subida.', body: data });
    return id;
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
// (la app empaquetada define MEWE_DEBUG_DIR: su carpeta de instalación no es escribible)
async function dumpResponse(method, url, status, text) {
  console.log(`[mewe] ${method} ${url} -> ${status}`, text.slice(0, 500));
  const dir = process.env.MEWE_DEBUG_DIR ?? path.join(process.cwd(), 'mewe-debug');
  const file = `${url.pathname.replace(/^\/api\//, '').replace(/[^\w-]+/g, '_')}.json`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), text);
}
