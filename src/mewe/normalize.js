import { config } from '../config.js';

// Resuelve los href templated de MeWe ("/photo/{imageSize}/...") a URLs absolutas del host de imágenes
export function resolveImageUrl(href, size = config.mewe.imageSize) {
  if (!href) return null;
  let path = href
    .replace('{imageSize}', size)
    .replace('{static}', '0')
    .replace(/\{[^}]+\}/g, '');
  if (/^https?:\/\//.test(path)) return path;
  if (!path.startsWith('/api/v2')) path = `/api/v2${path.startsWith('/') ? '' : '/'}${path}`;
  return config.mewe.imgHost + path;
}

// Imagen lista para la UI: miniatura (`src`) + tamaño grande para el visor (`full`)
function image(href, size) {
  if (!href) return null;
  return {
    src: resolveImageUrl(href),
    full: resolveImageUrl(href, config.mewe.fullImageSize),
    width: size?.width ?? null,
    height: size?.height ?? null,
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
    text: post.text ?? post.textPlain ?? '',
    createdAt: toMillis(post.createdAt ?? post.created ?? post.updatedAt),
    author: normalizeUser(author),
    groupId,
    group: groups.get(groupId)?.name ?? post.group?.name ?? null,
    images,
    // el feed trae solo las primeras fotos de un multipost: imagesCount dice cuántas hay en total
    imagesCount: Math.max(images.length, post.photosCount ?? post.mediasCount ?? 0),
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
    text: c.text ?? c.textPlain ?? '',
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
      lastMessage: last.message ?? last.text ?? (last.attachments?.length ? '📷 Imagen' : ''),
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
  const images = uniqueImages([
    ...photos.map((a) => image(a._links?.self?.href ?? a._links?.img?.href ?? a.photo?._links?.img?.href, a.size)),
    image(m.photo?._links?.img?.href, m.photo?.size),
    ...(m.stickers ?? []).map((s) => image(s._links?.img?.href ?? s._links?.self?.href)),
  ]);
  const files = (m.attachments ?? [])
    .filter((a) => a.aType && a.aType !== 'photo')
    .map((a) => ({ name: a.fileName || a.aType, type: a.aType }));
  return {
    id: m.id ?? m._id,
    threadId: m.threadId ?? null,
    text: m.message ?? m.text ?? '',
    // los mensajes traen `date` (segundos); `createdAt` queda por compatibilidad
    createdAt: toMillis(m.createdAt ?? m.date),
    mine: Boolean(myUserId) && authorId === myUserId,
    authorId: authorId ?? null,
    author: displayName(author),
    authorAvatar: avatarOf(author),
    images,
    files,
    emojis: normalizeEmojis(m),
    replyTo: m.replyTo
      ? { id: m.replyTo.id, text: m.replyTo.text ?? m.replyTo.originalText ?? '', authorId: m.replyTo.authorId ?? null }
      : null,
    expiresIn: m.expiresIn ? Number(m.expiresIn) : null,
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
  return {
    ...normalizeUser(user),
    handle: user.publicLinkId ?? null,
    cover: resolveImageUrl(user._links?.cover?.href ?? user._links?.coverPhoto?.href),
    bio: profile.text ?? profile.description ?? user.description ?? '',
    info: PROFILE_FIELDS.map(([label, key]) => [label, profile[key] ?? user[key]]).filter(([, value]) => value),
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

// Solicitudes de seguimiento recibidas: [{ requestId, user }]
export function normalizeFollowRequests(data) {
  const list = data?.requests ?? data?.feed ?? data?.users ?? data?.list ?? (Array.isArray(data) ? data : []);
  return list.map((item) => {
    const user = item.user ?? item.follower ?? item.requester ?? item;
    return {
      requestId: item.requestId ?? user.followRequestReceived ?? item.id ?? null,
      user: { ...normalizeUser(user), handle: user.publicLinkId ?? null },
    };
  });
}

// Fotos de un perfil o grupo (…/mediastream): { images, nextPage }
export function normalizeMediaStream(data) {
  const list = data?.feed ?? data?.medias ?? data?.items ?? (Array.isArray(data) ? data : []);
  const images = list.flatMap((item) => {
    const found = extractImages(item);
    if (found.length) return found;
    const media = item.media ?? item;
    return [image(media._links?.img?.href ?? media._links?.self?.href, media.size)];
  });
  return { images: uniqueImages(images), nextPage: data?._links?.nextPage?.href ?? null };
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
  return {
    id: g.id ?? g._id ?? null,
    name: g.name ?? 'Grupo',
    avatar: groupAvatar(g),
    cover: resolveImageUrl(g._links?.coverPhoto?.href ?? g._links?.cover?.href),
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

// Contactos que se pueden invitar a un grupo: { members: [{ user, online }] }
export function normalizeContacts(data) {
  const list = data?.members ?? data?.contacts ?? data?.results ?? data?.users ?? (Array.isArray(data) ? data : []);
  return list.map((item) => {
    const user = item.user ?? item;
    return { ...normalizeUser(user), handle: user.publicLinkId ?? null };
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
    users: (n.actingUsers ?? []).map((u) => ({ ...normalizeUser(u), handle: u.publicLinkId ?? null })),
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
  if (!user) return null;
  const href = user._links?.avatar?.href;
  if (href) return resolveImageUrl(href, config.mewe.avatarSize);
  const id = user.id ?? user.userId;
  const fprint = user.fprint ?? user.fingerprint;
  return id && fprint ? resolveImageUrl(`/api/v2/photo/profile/{imageSize}/${id}?f=${fprint}`, config.mewe.avatarSize) : null;
}

function groupAvatar(group) {
  const href = group?._links?.groupAvatar?.href ?? group?._links?.avatar?.href;
  return href ? resolveImageUrl(href, config.mewe.avatarSize) : null;
}

function extractImages(post) {
  const list = [];
  for (const media of post.medias ?? []) {
    const photo = media.photo ?? media;
    list.push(image(photo._links?.img?.href ?? photo._links?.self?.href, photo.size));
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
