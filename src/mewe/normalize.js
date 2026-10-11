import { config } from '../config.js';
import { emojify } from './emoji.js';

// Resuelve los href templated de MeWe ("/photo/{imageSize}/...") a URLs absolutas del host de imágenes
export function resolveImageUrl(href, size = config.mewe.imageSize, base = config.mewe.imgHost) {
  if (!href) return null;
  let path = href
    .replace('{imageSize}', size)
    .replace('{static}', '0')
    .replace(/\{[^}]+\}/g, '');
  if (/^https?:\/\//.test(path)) return path;
  if (!path.startsWith('/api/v2')) path = `/api/v2${path.startsWith('/') ? '' : '/'}${path}`;
  return base + path;
}

// Imagen lista para la UI: miniatura (`src`) + tamaño grande para el visor (`full`)
// animated: es un GIF (resolveImageUrl pide static=0, que es la versión con movimiento)
// fixedSize: único tamaño a pedir (las imágenes temporales del chat). La web las pide a mewe.com,
// no al host de imágenes, así que se hace igual.
function image(href, size, animated = false, fixedSize = null) {
  if (!href) return null;
  const temporal = fixedSize ? resolveImageUrl(href, fixedSize, config.mewe.host) : null;
  return {
    src: temporal ?? resolveImageUrl(href),
    full: temporal ?? resolveImageUrl(href, config.mewe.fullImageSize),
    width: size?.width ?? null,
    height: size?.height ?? null,
    animated: Boolean(animated),
  };
}

// Video adjunto de un mensaje: { sources, poster, name, duration }. `sources` son URLs mp4 a probar en orden
// (la web arma lo mismo: linkTemplate con cada resolución disponible, los links fijos y, en el chat, self).
// HLS queda afuera: <video> no lo reproduce sin una librería.
function video(attachment) {
  const media = attachment.video ?? attachment;
  const links = { ...attachment._links, ...media._links };
  const url = (href, resolution = 'original') =>
    href ? resolveImageUrl(href.replace('{resolution}', resolution), undefined, config.mewe.host) : null;
  const resolutions = (media.availableResolutions ?? [])
    .filter((r) => r !== 'original' && !/hls/i.test(r))
    .sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0)); // primero la de más calidad
  const sources = [
    ...resolutions.map((r) => url(links.linkTemplate?.href, r)),
    url(links.res720pMp4?.href),
    url(links.res480pMp4?.href),
    url(links.self?.href),
    url(links.original?.href),
    url(links.linkTemplate?.href, '480p'),
  ].filter(Boolean);
  if (!sources.length) return null;
  return {
    sources: [...new Set(sources)],
    poster: resolveImageUrl(links.thumbnail?.href ?? links.img?.href ?? links.poster?.href),
    name: attachment.fileName ?? media.name ?? '',
    duration: Number(media.duration ?? attachment.duration) || null,
  };
}

function uniqueImages(list) {
  const seen = new Set();
  return list.filter((img) => img && !seen.has(img.src) && seen.add(img.src));
}

export function normalizeProfile(data) {
  const user = data?.user ?? data ?? {};
  return {
    userId: user.id ?? user.userId ?? null,
    name: user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Sin nombre',
    avatar: resolveImageUrl(user._links?.avatar?.href, config.mewe.avatarSize),
  };
}

// --- Reacciones ---

// MeWe manda { userEmojis: ['❤'], emojiCounts: [{ '❤': 1 }], counts: { '❤': 1 } }
// (a veces emojiCounts/userEmojis vienen sueltos en el objeto). Resultado: [{ emoji, count, mine }]
export function normalizeEmojis(source) {
  const data = source?.emojis ?? source ?? {};
  const counts = new Map();
  const add = (obj) => {
    for (const [emoji, count] of Object.entries(obj ?? {})) counts.set(emoji, Number(count) || 0);
  };
  if (data.counts) add(data.counts);
  else if (Array.isArray(data.emojiCounts)) data.emojiCounts.forEach(add);
  else add(data.emojiCounts ?? source?.emojiCounts);
  const mine = new Set(data.userEmojis ?? source?.userEmojis ?? []);
  for (const emoji of mine) if (!counts.has(emoji)) counts.set(emoji, 1);
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([emoji, count]) => ({ emoji, count, mine: mine.has(emoji) }));
}

// Lista de quién reaccionó: { usersWithEmojis: [{ user, emojis }] } o { users: [user] } (de un solo emoji)
export function normalizeReactors(data, emoji) {
  const list = data?.usersWithEmojis ?? data?.users ?? data?.feed ?? [];
  return {
    reactors: list.map((item) => {
      const user = item.user ?? item;
      return { user: normalizeUser(user), emojis: item.emojis ?? user.emojis ?? (emoji ? [emoji] : []) };
    }),
    nextPage: data?._links?.nextPage?.href ?? null,
  };
}

// --- Feed / posts ---

// La forma exacta del feed no está documentada: se aceptan varias variantes.
// Con `npm run debug` se imprime la respuesta cruda para ajustar esto.
export function normalizeFeed(data) {
  const users = usersMap(data);
  const groups = new Map((data?.groups ?? []).map((g) => [g.id ?? g._id, g]));
  const items = data?.feed ?? data?.posts ?? data?.items ?? [];
  const posts = items.map((item) => normalizePost(item.post ?? item, users, groups));
  return { posts, nextPage: data?._links?.nextPage?.href ?? null };
}

// Un post suelto (GET .../post/{id}): { post, users, groups }
export function normalizePostDetails(data) {
  return normalizeFeed({ ...data, feed: [data?.post ?? data] }).posts[0];
}

function normalizePost(post, users, groups) {
  const author = users.get(post.userId) ?? post.user ?? post.owner ?? { id: post.userId };
  const groupId = post.groupId ?? post.group?.id ?? null;
  const images = extractImages(post);
  return {
    id: post.postItemId ?? post.id ?? post._id,
    text: emojify(post.text ?? post.textPlain),
    createdAt: toMillis(post.createdAt ?? post.created ?? post.updatedAt),
    author: normalizeUser(author),
    groupId,
    group: groups.get(groupId)?.name ?? post.group?.name ?? null,
    images,
    // el feed trae solo las primeras fotos de un multipost: imagesCount dice cuántas hay en total
    imagesCount: Math.max(images.length, post.photosCount ?? post.mediasCount ?? 0),
    // Para editar el texto: las fotos que se conservan van por id. Sólo se editan los posts de texto y fotos
    // que llegaron enteros (editar otra cosa le quitaría el link, la encuesta, los archivos o las fotos que faltan).
    mediaIds: (post.medias ?? []).map((media) => media.mediaId).filter(Boolean),
    editable:
      !(post.link || post.poll || post.files?.length || post.sticker || post.stickers?.length || post.audio || post.refPost) &&
      (post.medias ?? []).every((media) => media.mediaId && media.photo && !media.video) &&
      (post.mediasCount ?? post.photosCount ?? 0) <= (post.medias ?? []).length,
    emojis: normalizeEmojis(post),
    canReact: post.permissions?.canEmojify ?? post.permissions?.canAddEmoji ?? true,
    canComment: (post.permissions?.comment ?? true) && !post.commentsDisabled,
    commentsCount: post.commentsCount ?? post.comments?.total ?? 0,
    comments: (post.comments?.feed ?? []).map((c) => normalizeComment(c, users)),
  };
}

export function normalizeMedias(data) {
  const medias = data?.medias ?? data?.feed ?? data?.items ?? (Array.isArray(data) ? data : []);
  return extractImages({ medias });
}

// --- Comentarios ---

export function normalizeComments(data) {
  const users = usersMap(data);
  const list = data?.feed ?? data?.comments ?? data?.replies ?? (Array.isArray(data) ? data : []);
  return {
    comments: list.map((c) => normalizeComment(c, users)).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    nextPage: data?._links?.nextPage?.href ?? null,
  };
}

export function normalizeComment(c, users = new Map()) {
  const owner = c.owner ?? c.user ?? users.get(c.userId) ?? { id: c.userId };
  return {
    id: c.id,
    text: emojify(c.text ?? c.textPlain),
    createdAt: toMillis(c.createdAt),
    author: normalizeUser(users.get(owner.id) ?? owner),
    replyTo: c.replyTo ?? null,
    repliesCount: c.repliesCount ?? 0,
    replies: (c.replies ?? []).map((r) => normalizeComment(r, users)),
    emojis: normalizeEmojis(c),
    canReact: c.canEmojify ?? c.canAddEmoji ?? true,
    canReply: c.canReply ?? true,
    images: extractImages(c),
  };
}

// --- Chats ---

// La forma de los chats tampoco está documentada: `npm run debug` guarda las respuestas en mewe-debug/
export function normalizeThreads(data, myUserId) {
  const users = usersMap(data);
  const groups = new Map((data?.groups ?? []).map((g) => [g.id ?? g._id, g]));
  return (data?.threads ?? []).map((thread) => {
    const participants = (thread.participants ?? thread.receivers ?? [])
      .map((p) => (typeof p === 'string' ? users.get(p) : (users.get(p.id ?? p.userId) ?? p)))
      .filter(Boolean);
    const others = participants.filter((p) => (p.id ?? p.userId) !== myUserId);
    const last = thread.lastMessage ?? {};
    const chatType = thread.chatType ?? 'UserChat';
    const group = thread.group ?? groups.get(thread.groupId ?? thread.id);
    const isGroup = chatType === 'GroupChat' || chatType === 'EventChat';
    return {
      id: thread.id,
      chatType,
      isGroup,
      groupId: thread.groupId ?? (chatType === 'GroupChat' ? thread.id : (thread.event?.groupId ?? null)),
      name:
        thread.name ||
        (chatType === 'EventChat' ? thread.event?.name : null) ||
        (isGroup ? group?.name : null) ||
        others.map(displayName).filter(Boolean).join(', ') ||
        'Chat',
      avatar: isGroup ? groupAvatar(group ?? thread) : avatarOf(others[0]),
      participantsCount: others.length,
      // con quién se habla en un chat de a dos (para su perfil y su portada)
      userId: !isGroup && others.length === 1 ? (others[0].id ?? others[0].userId ?? null) : null,
      lastMessage:
        emojify(last.message ?? last.text) ||
        (last.attachments?.length ? (last.attachments.some((a) => a.aType === 'video') ? '🎬 Video' : '📷 Imagen') : ''),
      updatedAt: toMillis(last.createdAt ?? last.date ?? thread.updatedAt ?? thread.lastActivity),
      unread: Boolean(thread.unread ?? thread.unreadCount ?? thread.unreadMessages),
    };
  });
}

export function normalizeMessages(data, myUserId) {
  const users = usersMap(data);
  const list = data?.messages ?? data?.items ?? (Array.isArray(data) ? data : []);
  return list
    .map((m) => normalizeMessage(m, myUserId, users))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function normalizeMessage(m, myUserId, users = new Map()) {
  const owner = m.owner ?? m.author ?? m.user;
  const authorId = m.authorId ?? (typeof owner === 'string' ? owner : owner?.id) ?? m.userId ?? m.ownerId;
  const author = users.get(authorId) ?? (owner && typeof owner === 'object' ? owner : {});
  // las fotos de chat vienen en attachments[]._links.self (aType 'photo')
  const photos = (m.attachments ?? []).filter((a) => !a.aType || a.aType === 'photo');
  // los mensajes temporales se piden con el mismo tamaño que usa la web
  const fixedSize = m.expiresIn ? config.mewe.chat.disappearingImageSize : null;
  const images = uniqueImages([
    ...photos.map((a) =>
      image(a._links?.self?.href ?? a._links?.img?.href ?? a.photo?._links?.img?.href, a.size, a.animated, fixedSize),
    ),
    image(m.photo?._links?.img?.href, m.photo?.size),
    ...(m.stickers ?? []).map((s) => image(s._links?.img?.href ?? s._links?.self?.href)),
  ]);
  // los videos que no traen una URL reproducible quedan como archivo, con su nombre
  const videos = new Map((m.attachments ?? []).filter((a) => a.aType === 'video').map((a) => [a, video(a)]));
  const files = (m.attachments ?? [])
    .filter((a) => a.aType && a.aType !== 'photo' && !videos.get(a))
    .map((a) => ({ name: a.fileName || a.aType, type: a.aType }));
  return {
    id: m.id ?? m._id,
    threadId: m.threadId ?? null,
    text: emojify(m.message ?? m.text),
    // los mensajes traen `date` (segundos); `createdAt` queda por compatibilidad
    createdAt: toMillis(m.createdAt ?? m.date),
    mine: Boolean(myUserId) && authorId === myUserId,
    authorId: authorId ?? null,
    author: displayName(author),
    authorHandle: author.publicLinkId ?? null,
    authorAvatar: avatarOf(author),
    images,
    videos: [...videos.values()].filter(Boolean),
    files,
    emojis: normalizeEmojis(m),
    replyTo: m.replyTo
      ? { id: m.replyTo.id, text: emojify(m.replyTo.text ?? m.replyTo.originalText), authorId: m.replyTo.authorId ?? null }
      : null,
    // respuesta a una historia: { id, tellerId, image: { src, full }, isVideo } (en las de video, image es la miniatura)
    story: m.story?.storyId ? storyReply(m.story) : null,
    expiresIn: m.expiresIn ? Number(m.expiresIn) : null,
    edited: Boolean(m.editedAt),
    deleted: Boolean(m.deleted),
  };
}

// --- Perfiles ---

const PROFILE_FIELDS = [
  ['Ciudad', 'currentCity'],
  ['Trabajo', 'job'],
  ['Empresa', 'company'],
  ['Universidad', 'college'],
  ['Secundaria', 'highSchool'],
  ['Relación', 'relationshipStatus'],
  ['Intereses', 'interests'],
];

// GET /following/{id}?details=true →
//   { user, profile: { text, … }, counters, following, follower, followRequestSent?, followRequestReceived? }
// El estado de seguimiento viene al lado de `user`, no adentro (se aceptan las dos formas).
export function normalizeUserProfile(data, myUserId) {
  const user = { ...(data?.user ?? data ?? {}) };
  for (const key of ['following', 'follower', 'followRequestSent', 'followRequestReceived']) user[key] ??= data?.[key];
  const profile = user.profile ?? data?.profile ?? {};
  const id = user.id ?? user.userId ?? null;
  const counters = user.counters ?? data?.counters ?? {};
  const isMe = Boolean(id) && id === myUserId;
  const following = Boolean(user.following ?? user.isFollowing);
  const isPublic = (user.public ?? user.isPublic ?? profile.public) !== false;
  const coverHref = user._links?.cover?.href ?? user._links?.coverPhoto?.href;
  return {
    ...normalizeUser(user),
    handle: user.publicLinkId ?? null,
    cover: resolveImageUrl(coverHref),
    // foto de perfil y portada para el visor: { src, full }
    avatarImage: image(avatarHref(user)),
    coverImage: image(coverHref),
    bio: profile.text ?? profile.description ?? user.description ?? '',
    info: PROFILE_FIELDS.map(([label, key]) => [label, profile[key] ?? user[key]]).filter(([, value]) => value),
    // lo mismo, sin filtrar, para el formulario de "Editar perfil": [{ key, label, value }]
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    fields: PROFILE_FIELDS.map(([label, key]) => ({ key, label, value: String(profile[key] ?? user[key] ?? '') })),
    counters: {
      followers: counters.followers ?? null,
      following: counters.following ?? counters.followed ?? null,
      posts: counters.posts ?? null,
    },
    isMe,
    isPublic,
    following,
    follower: Boolean(user.follower ?? user.isFollower),
    // ids de solicitud pendiente (o true si MeWe sólo manda un booleano)
    requestSent: user.followRequestSent || null,
    requestReceived: user.followRequestReceived || null,
    canSeeContent: isMe || isPublic || following,
  };
}

// Solicitudes de seguimiento recibidas: { list: [{ user, followRequestId }] } → [{ requestId, user }]
// (a veces el usuario viene plano, con followRequestId al lado de su id: por eso nunca se usa item.id)
export function normalizeFollowRequests(data) {
  const list = data?.list ?? data?.requests ?? data?.feed ?? data?.users ?? (Array.isArray(data) ? data : []);
  return list.map((item) => {
    const user = item.user ?? item.follower ?? item.requester ?? item;
    return {
      requestId:
        item.followRequestId ?? user.followRequestId ?? item.requestId ?? item.followRequestReceived ?? user.followRequestReceived ?? null,
      user: {
        ...normalizeUser(user),
        handle: user.publicLinkId ?? null,
        isPublic: user.public !== false,
        following: Boolean(item.following ?? user.following),
      },
    };
  });
}

// Fotos de un perfil, grupo o álbum (…/mediastream): { images, nextPage }
// Cada imagen lleva el postId de su publicación (para mostrarla con sus comentarios en el visor)
export function normalizeMediaStream(data) {
  const list = data?.feed ?? data?.medias ?? data?.media ?? data?.items ?? (Array.isArray(data) ? data : []);
  const images = list.flatMap((item) => {
    const media = item.media ?? item;
    const found = extractImages(item);
    if (!found.length) found.push(image(media._links?.img?.href ?? media._links?.self?.href, media.size));
    return found.filter(Boolean).map((img) => ({ ...img, postId: item.postItemId ?? null }));
  });
  return { images: uniqueImages(images), nextPage: data?._links?.nextPage?.href ?? null };
}

// Álbumes de un perfil (…/albums): { feed: [{ name, count, image }] } → { albums: [{ name, count, cover }], nextPage }
export function normalizeAlbums(data) {
  const list = data?.feed ?? data?.albums ?? (Array.isArray(data) ? data : []);
  return {
    albums: list
      .filter((a) => a?.name && a.count !== 0)
      .map((a) => ({
        name: String(a.name),
        count: a.count ?? null,
        cover: resolveImageUrl(a.image?._links?.img?.href ?? a.photo?._links?.img?.href ?? a._links?.img?.href),
      })),
    nextPage: data?._links?.nextPage?.href ?? null,
  };
}

// --- Historias ---

// Los href de las historias ya traen su prefijo de API: la web los pega tal cual al host
function storyUrl(href, base) {
  if (!href) return null;
  const path = href.replace('{static}', '0').replace(/\{[^}]+\}/g, '');
  if (/^https?:\/\//.test(path)) return path;
  return base + (path.startsWith('/api/') ? path : `/api/v2${path.startsWith('/') ? '' : '/'}${path}`);
}

// Una historia: { id, scope, createdAt, isNew, views, image: { src, full }, video: { sources, poster } | null }
// En las de video, `image` es su miniatura.
function normalizeStory(story) {
  const media = story.media ?? {};
  const links = media._links ?? {};
  const { imageSize, videoResolutions } = config.mewe.stories;
  const isVideo = /video/i.test(media.mediaType ?? '');
  const photo = (href) => {
    if (!href) return null;
    return {
      src: storyUrl(href.replace('{imageSize}', config.mewe.imageSize), config.mewe.imgHost),
      full: storyUrl(href.replace('{imageSize}', imageSize), config.mewe.imgHost),
    };
  };
  const sources = isVideo
    ? videoResolutions.map((r) => storyUrl(links.media?.href?.replace('{resolution}', r), config.mewe.host)).filter(Boolean)
    : [];
  const image = photo(isVideo ? links.thumbnail?.href : (links.media?.href ?? links.img?.href));
  return {
    id: story.storyId ?? story.id ?? null,
    scope: story.scope ?? null,
    createdAt: toMillis(story.createdAt),
    isNew: Boolean(story.isNew),
    views: story.totalUniqueViews ?? null,
    image,
    video: sources.length ? { sources: [...new Set(sources)], poster: image?.full ?? null } : null,
  };
}

// La historia a la que responde un mensaje de chat: { storyId, storytellerId, storytellerType, media, isLive }
function storyReply(story) {
  const { image, video } = normalizeStory(story);
  return { id: story.storyId, tellerId: story.storytellerId ?? null, image, isVideo: Boolean(video) };
}

export function normalizeStories(data) {
  const list = data?.stories ?? data?.journalEntries ?? (Array.isArray(data) ? data : []);
  return list
    .map(normalizeStory)
    .filter((story) => story.id && (story.image || story.video))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

// Quienes tienen historias (GET /stories/feed): [{ id, type, isPage, name, avatar, handle, hasNew, isMine, stories }]
// `stories` puede venir incompleta: el visor pide todas las de cada persona al abrirla.
export function normalizeStorytellers(data, myUserId) {
  const list = data?.storytellersInOrder ?? data?.storytellers ?? data?.tellers ?? [];
  return list
    .map((teller) => {
      const type = teller.storytellerType ?? 'User';
      const isPage = type === 'Page';
      const who = (isPage ? teller.pageStoryteller : teller.userStoryteller) ?? {};
      const id = teller.storytellerId ?? teller.id ?? who.id ?? null;
      const pageAvatar = who._links?.avatar?.href ?? (typeof who.avatar === 'string' ? who.avatar : null);
      return {
        id,
        type,
        isPage,
        name: (isPage ? who.name : displayName(who)) || 'Desconocido',
        avatar: isPage ? resolveImageUrl(pageAvatar, config.mewe.avatarSize) : avatarOf(who),
        handle: isPage ? null : (who.publicLinkId ?? null),
        hasNew: Boolean(teller.hasNewStories),
        isMine: Boolean(id) && id === myUserId,
        stories: normalizeStories(teller),
      };
    })
    .filter((teller) => teller.id && teller.type !== 'Ad');
}

// --- Grupos ---

// GET /groups: los confirmados y, aparte, las invitaciones sin aceptar
export function normalizeGroups(data) {
  const confirmed = data?.confirmedGroups ?? data?.groups ?? (Array.isArray(data) ? data : []);
  const invited = data?.unconfirmedGroups ?? data?.invitedGroups ?? [];
  return [
    ...confirmed.map((g) => normalizeGroup({ isMember: g.isConfirmed ?? true, ...g })),
    ...invited.map((g) => normalizeGroup({ isMember: false, isInvited: true, ...g })),
  ];
}

export function normalizeGroup(data) {
  const g = data?.group ?? data ?? {};
  const isMember = Boolean(g.isMember ?? g.isConfirmed ?? g.role);
  const isInvited = !isMember && Boolean(g.isInvited ?? g.invitedBy ?? g._links?.inviteConfirm);
  const coverHref = g._links?.coverPhoto?.href ?? g._links?.cover?.href;
  return {
    id: g.id ?? g._id ?? null,
    name: g.name ?? 'Grupo',
    avatar: groupAvatar(g),
    cover: resolveImageUrl(coverHref),
    // foto y portada para el visor: { src, full }
    avatarImage: image(groupAvatarHref(g)),
    coverImage: image(coverHref),
    description: g.descriptionPlain || g.description || '',
    membersCount: g.membersCount ?? null,
    isPublic: Boolean(g.isPublic),
    publicUrlId: g.publicUrlId ?? null,
    role: roleName(g.role),
    ownerId: g.ownerId ?? null,
    adminIds: g.adminIds ?? [],
    isMember,
    isInvited,
    alreadyApplied: Boolean(g.alreadyApplied),
    // preguntas que el grupo hace antes de entrar (y si es obligatorio responderlas)
    questions: (g.applyQuestions ?? []).map((q) => (typeof q === 'string' ? q : q?.question)).filter(Boolean),
    mandatoryQuestions: Boolean(g.mandatoryQuestions),
    newPosts: g.newPosts ?? 0,
  };
}

// GET /group/{id}/members: { members: [{ user?, role, confirmed }] }
export function normalizeMembers(data) {
  const list = data?.members ?? data?.results ?? (Array.isArray(data) ? data : []);
  return list.map((m) => {
    const user = m.user ?? m;
    const role = roleName(m.role ?? m.groupRole ?? user.groupRole ?? user.role);
    return {
      ...normalizeUser(user),
      handle: user.publicLinkId ?? null,
      role,
      isAdmin: /owner|admin/i.test(role ?? ''),
      pending: m.confirmed === false || Boolean(m.invitation),
    };
  });
}

// Listas de personas: resultados de búsqueda ({ results: [{ user }] }) y contactos para invitar a un grupo
// ({ list: [{ user, inGroup, invited }] }: inGroup = ya es miembro, invited = ya tiene una invitación)
export function normalizeContacts(data) {
  const list =
    data?.list ?? data?.members ?? data?.contacts ?? data?.results ?? data?.users ?? data?.blocked ?? (Array.isArray(data) ? data : []);
  return list.map((item) => {
    const user = item.user ?? item;
    return {
      ...normalizeUser(user),
      handle: user.publicLinkId ?? null,
      isPublic: user.public !== false,
      inGroup: Boolean(item.inGroup ?? item.isGroupMember),
      invited: Boolean(item.invited),
    };
  });
}

export function normalizeEvents(data) {
  const list = data?.events ?? data?.feed ?? data?.items ?? (Array.isArray(data) ? data : []);
  return list.map((item) => {
    const e = item.event ?? item;
    return {
      id: e.id ?? e._id ?? null,
      name: e.name ?? 'Evento',
      description: e.description ?? '',
      location: e.location ?? '',
      startsAt: toMillis(e.nextOccurrenceDate ?? e.startDate),
      endsAt: toMillis(e.endDate),
      allDay: Boolean(e.allDay),
      groupId: e.groupId ?? null,
      participation: e.participationType ?? null,
      hasChat: e.chatMode !== 'off' && e.chatMode !== 'disabled',
    };
  });
}

function roleName(role) {
  if (!role) return null;
  return typeof role === 'string' ? role : (role.name ?? null);
}

// --- Notificaciones ---

// Feed de notificaciones. El texto se arma en la UI a partir de `type` (ver notificationsView.js).
export function normalizeNotifications(data) {
  return {
    notifications: (data?.feed ?? []).map(normalizeNotification),
    unseenCount: data?.unseenCount ?? 0,
    nextPage: data?._links?.nextPage?.href ?? null,
  };
}

function normalizeNotification(n) {
  const subject = n.commentData ?? n.chatMessageData ?? n.postData ?? {};
  const inGroup = Boolean(n.group) && (n.system === 'group' || n.system === 'pending');
  return {
    id: n.id,
    type: n.notificationType ?? 'generic',
    system: n.system ?? null,
    unread: n.visited === false,
    createdAt: toMillis(n.updatedAt ?? n.createdAt ?? n.occuredAt ?? n.date),
    users: (n.actingUsers ?? []).map((u) => ({ ...normalizeUser(u), handle: u.publicLinkId ?? null, isPublic: u.public !== false })),
    usersCount: n.actingUsersCount ?? n.actingUsers?.length ?? 0,
    inGroup,
    group: n.group ? { id: n.group.id, name: n.group.name ?? 'Grupo' } : null,
    event: n.event ? { id: n.event.id, name: n.event.name ?? 'Evento', groupId: n.event.groupId ?? null } : null,
    postId: n.postData?.postItemId ?? n.pollData?.sharedPostId ?? null,
    commentId: n.commentData?.id ?? null,
    threadId: n.threadId ?? null,
    messageId: n.messageId ?? null,
    title: n.title ?? '', // avisos de MeWe ('generic'): título + subtítulo
    snippet: subject.snippet ?? n.pollData?.question ?? n.subtitle ?? '',
    emojis: normalizeEmojis(subject).map((e) => e.emoji),
    everyone: n.mentionType === 'everyone',
  };
}

// --- Usuarios ---

// Forma común de un usuario en toda la app: { id, name, avatar }
export function normalizeUser(user) {
  return {
    id: user?.id ?? user?.userId ?? user?._id ?? null,
    name: displayName(user),
    avatar: avatarOf(user),
  };
}

function usersMap(data) {
  return new Map((data?.users ?? []).map((u) => [u.id, u]));
}

function displayName(user) {
  if (!user) return '';
  return user.name || [user.firstName, user.lastName].filter(Boolean).join(' ');
}

// Avatar desde _links o, si falta, con el patrón que usa la web: /photo/profile/{size}/{userId}?f={fprint}
function avatarOf(user) {
  return resolveImageUrl(avatarHref(user), config.mewe.avatarSize);
}

function avatarHref(user) {
  if (!user) return null;
  const href = user._links?.avatar?.href;
  if (href) return href;
  const id = user.id ?? user.userId;
  const fprint = user.fprint ?? user.fingerprint;
  return id && fprint ? `/api/v2/photo/profile/{imageSize}/${id}?f=${fprint}` : null;
}

function groupAvatarHref(group) {
  return group?._links?.groupAvatar?.href ?? group?._links?.avatar?.href ?? null;
}

function groupAvatar(group) {
  return resolveImageUrl(groupAvatarHref(group), config.mewe.avatarSize);
}

function extractImages(post) {
  const list = [];
  for (const media of post.medias ?? []) {
    const photo = media.photo ?? media;
    list.push(image(photo._links?.img?.href ?? photo._links?.self?.href, photo.size, photo.animated));
  }
  list.push(image(post.photo?._links?.img?.href, post.photo?.size));
  return uniqueImages(list);
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
