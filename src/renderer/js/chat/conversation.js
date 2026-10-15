import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { getSettings } from '../settings.js';
import { avatar } from '../ui/avatar.js';
import { tintWithAvatarColor } from '../ui/avatarColor.js';
import { confirmDialog } from '../ui/confirm.js';
import { dayKey, formatDay, formatFull, formatTime } from '../ui/dates.js';
import { emptyState, h } from '../ui/dom.js';
import { quickReactions } from '../ui/emojiPicker.js';
import { icon } from '../ui/icon.js';
import { closeLightbox, openLightbox } from '../ui/lightbox.js';
import { EDGE_SWIPE_PX, isMobile } from '../ui/mobile.js';
import { confirmBlock } from '../ui/people.js';
import { closePopover, openPopover } from '../ui/popover.js';
import { createReactions } from '../ui/reactions.js';
import { emojiOnlyCount, plainText, richText } from '../ui/richText.js';
import { userName } from '../ui/userName.js';
import { createComposer } from './composer.js';
import { canForward, openForwardDialog } from './forward.js';
import { openChatMembers } from './groupChat.js';

const PAGE_SIZE = 25; // igual que config.mewe.chat.pageSize
const RUN_GAP_MS = 5 * 60 * 1000; // mensajes del mismo autor más juntos que esto se agrupan
const POLL_FAST_MS = 5000; // sin tiempo real
const POLL_SLOW_MS = 30000; // con websocket conectado (sólo como red de seguridad)
const MAX_PAGES_TO_FIND_REPLY = 20;
const OLDER_PAGES_PER_CLICK = 5; // "Cargar más antiguos" en búsqueda y galería
const QUICK_REACTIONS = 15; // emojis del menú de un mensaje: dos filas, con el último lugar para "más emojis"
// Gestos táctiles sobre un mensaje
const LONG_PRESS_MS = 450; // apretado este tiempo sin moverse, abre su menú
const PRESS_MOVE_PX = 10; // moverse más que esto ya no es mantener apretado
const SWIPE_START_PX = 14; // a partir de acá el mensaje sigue al dedo
const SWIPE_REPLY_PX = 64; // soltarlo más lejos que esto lo responde
const SWIPE_MAX_PX = 88;

// A quiénes se ofrece mencionar primero en un chat: la otra persona, las del chat grupal o, en uno de grupo,
// sus miembros (la primera página, que se pide una sola vez por chat abierto)
function mentionable(accountId, thread) {
  if (thread.isMultiUser) return () => thread.participants;
  if (!thread.isGroup) return () => (thread.userId ? [{ id: thread.userId, name: thread.name, avatar: thread.avatar }] : []);
  let members = null;
  return () => (members ??= api.getGroupMembers(accountId, thread.id).then((page) => page.members));
}

// Para comparar texto sin distinguir mayúsculas ni acentos
const fold =(text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Una conversación (mensajes + caja de redacción) para cualquier threadId:
// chats con personas, de grupo y (más adelante) de eventos.
// navigate: el del router; con él, los nombres y las fotos llevan al perfil.
// onUnreadChange(threadId, unread): el chat pasó a leído o volvió a tener mensajes sin leer.
// Un chat se marca como leído cuando lo abre la persona (open con read), al hacer click en los mensajes, al
// escribir, al enviar o con el botón de la barra (que sólo se ve mientras hay algo sin leer). Lo que llega
// después, con el chat ya abierto, lo deja otra vez sin leer hasta alguna de esas acciones.
// onBlocked(thread): se bloqueó a la persona del chat (botón de la barra, sólo en chats de a dos).
// onBack(): se tocó la flecha de la barra, que sólo se ve en mobile (vuelve a la lista de chats).
// onThreadChange(thread): en un chat grupal cambió el nombre o los miembros · onLeft(thread): se salió de él.
export function createConversation({ onSent, onUnreadChange, onBlocked, onBack, onThreadChange, onLeft, navigate } = {}) {
  const messagesEl = h('div', { className: 'chat-messages scroll', attrs: { role: 'log', 'aria-label': 'Mensajes' } });
  const errorEl = h('div');
  const composer = createComposer({ onSend: send });
  composer.el.hidden = true;
  // Barra del chat: con quién se habla + buscar en el chat + galería de imágenes
  const titleEl = h('div', { className: 'chat-tools-title' });
  const toolButton = (icon, label, kind) =>
    h('button', { className: 'btn icon-btn chat-panel-btn', title: label, attrs: { 'aria-label': label, 'aria-pressed': 'false' }, onClick: () => togglePanel(kind) }, icon);
  const panelButtons = {
    search: toolButton('🔍', 'Buscar en este chat', 'search'),
    gallery: toolButton('🖼', 'Imágenes de este chat', 'gallery'),
  };
  const readIcon = icon('check-check');
  readIcon.classList.add('label-icon');
  const readBtn = h(
    'button',
    { className: 'btn mark-read', title: 'Marcar como leído', hidden: true, onClick: () => markRead() },
    readIcon,
    h('span', { className: 'label-text' }, '✓ Marcar como leído'),
  );
  // Menú ⋮ del chat: información de la persona, el grupo o el chat grupal y, en mobile, buscar y galería
  // (ahí los dos botones sueltos se ocultan, ver styles.css)
  const moreBtn = h(
    'button',
    {
      className: 'btn icon-btn chat-more',
      title: 'Más opciones del chat',
      attrs: { 'aria-label': 'Más opciones del chat', 'aria-haspopup': 'menu' },
      onClick: () => {
        if (moreMenu?.el.isConnected) {
          closePopover();
          return;
        }
        const item = (name, label, run) =>
          h(
            'button',
            {
              className: 'menu-item account-item',
              attrs: { role: 'menuitem' },
              onClick: () => {
                closePopover();
                run();
              },
            },
            h('span', { className: 'account-item-icon' }, icon(name)),
            label,
          );
        const info = infoTarget();
        const menu = h(
          'div',
          { className: 'menu', attrs: { role: 'menu' } },
          info && item(info.icon, info.label, info.open),
          isMobile() && item('search', 'Buscar en este chat', () => togglePanel('search')),
          isMobile() && item('image', 'Imágenes de este chat', () => togglePanel('gallery')),
        );
        moreMenu = openPopover(moreBtn, menu, { className: 'menu-popover', label: 'Más opciones del chat' });
        menu.querySelector('button')?.focus();
      },
    },
    icon('ellipsis-vertical'),
  );
  let moreMenu = null;
  const backBtn = h(
    'button',
    { className: 'btn icon-btn chat-back', title: 'Volver a la lista de chats', attrs: { 'aria-label': 'Volver a la lista de chats' }, onClick: () => onBack?.() },
    icon('arrow-left'),
  );
  const blockBtn = h(
    'button',
    { className: 'btn icon-btn danger', title: 'Bloquear a esta persona', attrs: { 'aria-label': 'Bloquear a esta persona' }, hidden: true, onClick: () => block() },
    icon('ban'),
  );
  const toolsEl = h('div', { className: 'chat-tools', hidden: true }, backBtn, titleEl, readBtn, panelButtons.search, panelButtons.gallery, moreBtn, blockBtn);
  // Panel (búsqueda o galería) que tapa los mensajes mientras está abierto
  const panelEl = h('div', { className: 'chat-panel scroll', hidden: true });
  // Al subir a leer mensajes viejos aparece el botón para volver al final, sobre un degradado
  // que da a entender que queda chat más abajo (ver renderPin)
  const pinBtn = h('button', { className: 'chat-pin', hidden: true, onClick: () => scrollToBottom() });
  const fadeEl = h('div', { className: 'chat-fade', attrs: { 'aria-hidden': 'true' } });
  const bodyEl = h('div', { className: 'chat-body' }, messagesEl, fadeEl, pinBtn, panelEl);
  const el = h('section', { className: 'chat-conversation' }, toolsEl, bodyEl, errorEl, composer.el);
  composer.acceptDrop(el);
  panelEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanel();
  });

  let account = null;
  let thread = null;
  let messages = [];
  let hasOlder = false;
  let loadingOlder = false;
  let generation = 0; // invalida respuestas de una conversación anterior
  let pollTimer = null;
  let pollMs = POLL_FAST_MS;
  let panel = null; // 'search' | 'gallery' | null
  let unread = false; // el chat abierto tiene mensajes sin leer
  let pinned = true; // anclado al final: lo nuevo se sigue solo. Se suelta al subir a leer mensajes viejos
  let missed = false; // llegaron mensajes mientras no estaba anclado
  const videoBoxes = new Map(); // "idMensaje:n" → nodo del video (ver renderVideo)
  const menus = new Map(); // idMensaje → { open(ancla), reply() } de los mensajes dibujados (ver renderMessage)
  let messageMenu = null; // menú de un mensaje abierto, con su ancla
  let touch = null; // gesto táctil en curso sobre un mensaje: { el, actions, x, y, swiping, timer }
  let touching = false; // lo último que tocó los mensajes fue un dedo (o un lápiz), no el mouse
  let skipClick = false; // ver "Gestos táctiles"

  // --- Leído / sin leer ---

  function setUnread(value) {
    if (!thread || unread === value) return;
    unread = value;
    readBtn.hidden = !unread;
    onUnreadChange?.(thread.id, unread);
  }

  async function markRead() {
    if (!thread || !unread) return;
    const gen = generation;
    setUnread(false);
    try {
      await api.markChatRead(account.id, thread.id);
    } catch (err) {
      if (gen !== generation) return;
      setUnread(true); // no se marcó: el botón vuelve para reintentar
      showError(errorEl, err, 'MeWe chat');
    }
  }

  // --- Bloquear (chats de a dos) ---

  async function block() {
    if (!thread?.userId) return;
    const gen = generation;
    const blocked = thread;
    blockBtn.disabled = true;
    clearError(errorEl);
    try {
      if ((await confirmBlock(account, { id: blocked.userId, name: blocked.name })) && gen === generation) onBlocked?.(blocked);
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe bloqueo');
    } finally {
      blockBtn.disabled = false;
    }
  }

  // "Información" del menú ⋮: el perfil de la persona, el grupo (en uno de evento, sus eventos) o, en un chat
  // grupal, sus miembros. → { icon, label, open } o null si no hay nada que mostrar
  function infoTarget() {
    if (!thread) return null;
    if (thread.isMultiUser) return { icon: 'users', label: 'Información del chat', open: openMembers };
    if (!navigate) return null;
    const isEvent = thread.chatType === 'EventChat';
    const groupId = thread.isGroup ? (isEvent ? thread.groupId : (thread.groupId ?? thread.id)) : null;
    if (groupId) {
      return { icon: 'layout-grid', label: 'Información del grupo', open: () => navigate('group', isEvent ? { groupId, tab: 'events' } : { groupId }) };
    }
    if (thread.userId) return { icon: 'user', label: 'Información de la persona', open: () => navigate('profile', { userId: thread.userId }) };
    return null;
  }

  // --- Chat grupal: miembros ---

  function openMembers() {
    if (!thread?.isMultiUser) return;
    const opened = thread;
    openChatMembers({
      account,
      thread: opened,
      onChanged: (changes) => {
        Object.assign(opened, changes);
        if (thread !== opened) return;
        if (changes.name) renderTitle();
        if (changes.participants) composer.setPeople(mentionable(account.id, thread));
        onThreadChange?.(thread);
      },
      onLeft: () => onLeft?.(opened),
    });
  }

  // click en el fondo o en los mensajes, y click o tecla en la caja de texto
  // (no el foco: al abrir un chat la caja se enfoca sola)
  bodyEl.addEventListener('click', () => markRead());
  composer.el.addEventListener('pointerdown', () => markRead());
  composer.el.addEventListener('keydown', () => markRead());

  // --- Carga ---

  // Trae la última página y la fusiona (carga inicial, polling y eventos en tiempo real)
  async function loadLatest({ scroll } = {}) {
    if (!thread) return;
    const gen = generation;
    try {
      const page = await api.getMessages(account.id, thread.id);
      if (gen !== generation) return;
      if (!messages.length) hasOlder = page.length >= PAGE_SIZE;
      // un mensaje nuevo de otra persona (después de la carga inicial) deja el chat sin leer
      const known = new Set(messages.map((m) => m.id));
      const incoming = messages.length > 0 && page.some((m) => m.id && !m.mine && !known.has(m.id));
      const { added, changed } = merge(page);
      if (incoming) setUnread(true);
      if (added && !pinned && scroll !== 'bottom') missed = true;
      if (added || changed || !messagesEl.querySelector('.msg')) render();
      if (scroll === 'bottom') scrollToBottom();
      else renderPin();
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe chat');
    }
  }

  async function loadOlder() {
    if (!thread || !messages.length || loadingOlder) return false;
    const gen = generation;
    loadingOlder = true;
    const prevHeight = messagesEl.scrollHeight;
    const prevTop = messagesEl.scrollTop;
    try {
      const page = await api.getMessages(account.id, thread.id, messages[0].id);
      if (gen !== generation) return false;
      hasOlder = page.length >= PAGE_SIZE;
      merge(page);
      render();
      messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight + prevTop; // mantiene la posición visible
      return true;
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe chat');
      return false;
    } finally {
      loadingOlder = false;
    }
  }

  // Agrega los nuevos y reemplaza los que cambiaron (reacciones, ediciones, borrados)
  function merge(page) {
    const byId = new Map(messages.map((m) => [m.id, m]));
    let added = 0;
    let changed = 0;
    for (const m of page) {
      if (!m.id) continue;
      const prev = byId.get(m.id);
      if (!prev) added++;
      else if (JSON.stringify(prev) !== JSON.stringify(m)) changed++;
      else continue;
      byId.set(m.id, m);
    }
    if (added || changed) messages = [...byId.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    return { added, changed };
  }

  // --- Render ---

  function render() {
    if (!messages.length) {
      messagesEl.replaceChildren(emptyState('No hay mensajes.'));
      return;
    }
    const names = authorNames();
    const allImages = messages.flatMap((m) => (m.expiresIn ? [] : m.images)); // las temporales se abren aparte
    const nodes = [];
    menus.clear();
    if (hasOlder) nodes.push(h('button', { className: 'btn load-older', onClick: loadOlder }, 'Cargar anteriores'));

    let prev = null;
    for (const m of messages) {
      const day = m.createdAt ? dayKey(m.createdAt) : null;
      const newDay = day && (!prev?.createdAt || dayKey(prev.createdAt) !== day);
      if (newDay) {
        nodes.push(h('div', { className: 'day-separator', attrs: { role: 'separator' } }, h('span', {}, formatDay(m.createdAt))));
      }
      const continues =
        !newDay && prev && prev.authorId === m.authorId && (m.createdAt ?? 0) - (prev.createdAt ?? 0) < RUN_GAP_MS;
      nodes.push(renderMessage(m, { continues, names, allImages }));
      prev = m;
    }
    const stick = pinned; // redibujar puede mover el scroll: si estaba anclado, sigue anclado
    // sacar un <video> del documento lo pausa: los que estaban sonando siguen después de redibujar
    const playing = [...messagesEl.querySelectorAll('video')].filter((player) => !player.paused && !player.ended);
    messagesEl.replaceChildren(...nodes);
    for (const player of playing) if (player.isConnected) player.play().catch(() => {});
    if (stick) scrollToBottom();
  }

  // Foto y nombre se muestran siempre, también en los chats de a dos
  function renderMessage(m, { continues, names, allImages }) {
    const others = !m.mine;
    // sólo emojis: se muestran grandes (más grandes cuantos menos son)
    const emojiCount = emojiOnlyCount(m.text);
    const emojiClass = emojiCount ? (emojiCount <= 3 ? ' emoji-only emoji-xl' : ' emoji-only') : '';
    const bubble = h(
      'div',
      { className: 'bubble' },
      m.replyTo && renderQuote(m.replyTo, names),
      m.story && renderStoryReply(m),
      m.deleted && h('p', { className: 'msg-text deleted' }, 'Mensaje eliminado'),
      m.text && h('p', { className: `msg-text${emojiClass}`, attrs: { dir: 'auto' } }, emojiCount ? m.text : richText(m.text, { accountId: account.id, navigate })),
      m.images.length > 0 && m.expiresIn && renderTimedImage(m),
      m.images.length > 0 &&
        !m.expiresIn &&
        h(
          'div',
          { className: `msg-images count-${Math.min(m.images.length, 4)}` },
          m.images.map((img) =>
            h(
              'button',
              {
                className: 'msg-image',
                title: 'Ver imagen',
                attrs: { 'aria-label': 'Ver imagen' },
                onClick: () => openLightbox({ accountId: account.id, images: allImages, index: allImages.indexOf(img) }),
              },
              h('img', { src: imageUrl(account.id, img.src), alt: '', loading: 'lazy' }),
              img.animated && h('span', { className: 'gif-badge', attrs: { 'aria-hidden': 'true' } }, 'GIF'),
            ),
          ),
        ),
      m.videos.map((video, i) => (m.expiresIn ? renderTimedVideo(m, video, `${m.id}:${i}`) : renderVideo(video, `${m.id}:${i}`))),
      m.files.map((f) => h('p', { className: 'msg-file' }, `📎 ${f.name}`)),
      h(
        'span',
        { className: 'msg-time', title: m.createdAt ? formatFull(m.createdAt) : '' },
        m.expiresIn ? `⏱ ${formatSeconds(m.expiresIn)} · ` : '',
        m.edited && !m.deleted && h('span', { className: 'msg-edited' }, 'editado · '),
        m.createdAt ? formatTime(m.createdAt) : '',
      ),
    );

    // el borde izquierdo del globo toma el color predominante de la foto de quien habla
    if (!m.mine) tintWithAvatarColor(bubble, account.id, m.authorAvatar);

    const reactions = createReactions({
      accountId: account.id,
      emojis: m.emojis,
      compact: true,
      onToggle: async (emoji, on) => {
        await api.reactMessage(account.id, thread.id, m.id, emoji, on);
        loadLatest();
      },
      loadReactors: () => api.getMessageReactors(account.id, thread.id, m.id),
    });

    // Como en la web, sólo se editan los mensajes propios de puro texto
    const canEdit = m.mine && !m.deleted && Boolean(m.text) && !m.images.length && !m.videos.length && !m.files.length && !m.expiresIn;
    const reply = () => composer.setReplyTo(m, names.get(m.authorId));
    const openMenu = (anchor) => openMessageMenu(anchor, m, { reactions, reply, canEdit });
    menus.set(m.id, { open: openMenu, reply });
    // Los tres puntitos al costado del globo: aparecen con el mouse encima o, en una pantalla táctil, al tocar
    // el mensaje; ahí el menú también se abre manteniéndolo apretado (ver "Gestos táctiles")
    const actions = h(
      'div',
      { className: 'msg-actions' },
      h(
        'button',
        {
          className: 'icon-btn',
          title: 'Acciones',
          attrs: { 'aria-label': 'Acciones del mensaje', 'aria-haspopup': 'menu' },
          onClick: (event) => openMenu(event.currentTarget),
        },
        icon('ellipsis'),
      ),
    );

    // Foto de quien habla, arriba y al lado del nombre: a la izquierda la de los demás, a la derecha la propia.
    // En los mensajes seguidos del mismo autor sólo queda el hueco.
    const face = (name, url, userId) =>
      continues
        ? h('span', { className: 'msg-avatar-space' })
        : profileLink(avatar(account.id, url, { name, size: 'sm' }), userId, { className: 'msg-avatar', label: `Perfil de ${name}` });

    return h(
      'div',
      {
        className: `msg${m.mine ? ' mine' : ''}${continues ? ' continues' : ''}`,
        dataset: { messageId: m.id },
        attrs: { tabindex: '-1' },
      },
      others && face(m.author, m.authorAvatar, m.authorId),
      h(
        'div',
        { className: 'msg-body' },
        others &&
          !continues &&
          profileLink([userName(m.author), m.authorHandle && h('span', { className: 'msg-handle' }, `@${m.authorHandle}`)], m.authorId, { className: 'msg-author' }),
        h('div', { className: 'msg-line' }, bubble, actions),
        reactions.el,
      ),
      m.mine && face(account.name, account.avatar, account.userId),
    );
  }

  // --- Menú de un mensaje ---

  // Reaccionar (con los emojis a la vista, sin abrir el selector), responder, reenviar, editar, copiar y,
  // en los propios, eliminar.
  // Lo abren los tres puntitos del mensaje o, en una pantalla táctil, mantenerlo apretado.
  function openMessageMenu(anchor, m, { reactions, reply, canEdit }) {
    if (messageMenu?.el.isConnected && messageMenu.anchor === anchor) {
      closePopover();
      return;
    }
    const item = (name, label, run, className = '') =>
      h(
        'button',
        {
          className: `menu-item account-item ${className}`.trim(),
          attrs: { role: 'menuitem' },
          onClick: () => {
            closePopover();
            run();
          },
        },
        h('span', { className: 'account-item-icon' }, icon(name)),
        label,
      );
    const emojis = quickReactions((emoji) => {
      closePopover();
      reactions.react(emoji);
    }, QUICK_REACTIONS);
    // el último lugar de la grilla abre el selector completo
    emojis.append(
      h(
        'button',
        { type: 'button', className: 'emoji-option', title: 'Más emojis', attrs: { 'aria-label': 'Más emojis', 'aria-haspopup': 'dialog' }, onClick: () => reactions.pick(anchor) },
        icon('smile-plus'),
      ),
    );
    const menu = h(
      'div',
      { className: 'menu', attrs: { role: 'menu' } },
      emojis,
      h('hr', { className: 'menu-sep' }),
      item('reply', 'Responder', reply),
      canForward(m) && item('forward', 'Reenviar', () => forward(m)),
      canEdit && item('pencil', 'Editar', () => composer.setEditing(m)),
      // en una pantalla táctil el texto de los mensajes no se puede seleccionar (ver styles.css)
      m.text && !m.deleted && item('copy', 'Copiar texto', () => api.copyText(plainText(m.text)).catch((err) => showError(errorEl, err, 'MeWe chat'))),
      m.mine && !m.deleted && item('trash-2', 'Eliminar', () => remove(m), 'danger'),
    );
    messageMenu = { ...openPopover(anchor, menu, { className: 'menu-popover msg-menu', label: 'Acciones del mensaje' }), anchor };
  }

  // Reenviar: se elige el chat en un diálogo. Si es éste mismo, el mensaje nuevo aparece al final.
  async function forward(m) {
    const gen = generation;
    const target = await openForwardDialog({ account, message: m });
    if (!target || gen !== generation) return;
    if (target.id === thread.id) loadLatest({ scroll: 'bottom' });
    onSent?.();
  }

  // Elimina un mensaje propio, para todos. Como en la web, queda en su lugar como "Mensaje eliminado".
  async function remove(m) {
    const gen = generation;
    const confirmed = await confirmDialog({
      title: '¿Eliminar este mensaje?',
      text: 'Dejará de verse para todos en el chat. No se puede deshacer.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!confirmed || gen !== generation) return;
    clearError(errorEl);
    try {
      await api.deleteMessage(account.id, m.id);
      if (gen !== generation) return;
      messages = messages.map((other) =>
        other.id === m.id ? { ...other, deleted: true, text: '', images: [], videos: [], files: [], story: null } : other,
      );
      render();
      onSent?.(); // la lista de chats muestra el último mensaje
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe chat');
    }
  }

  // --- Gestos táctiles sobre un mensaje ---

  // Mantenerlo apretado abre su menú; arrastrarlo hacia un costado lo responde.
  // (.chat-messages tiene touch-action: pan-y: si el dedo va en vertical es scroll y llega pointercancel)
  function endTouch() {
    if (!touch) return;
    clearTimeout(touch.timer);
    touch.el.classList.remove('swiping', 'swipe-ready');
    touch.el.style.removeProperty('transform');
    touch = null;
  }

  messagesEl.addEventListener('pointerdown', (event) => {
    endTouch();
    skipClick = false;
    touching = event.pointerType !== 'mouse';
    if (!touching || !event.isPrimary) return;
    const msgEl = event.target.closest('.msg');
    const actions = menus.get(msgEl?.dataset.messageId);
    // el borde izquierdo es para la lista de chats (ver chatView.js), y arrastrar sobre un video mueve su barra
    if (!actions || event.clientX - messagesEl.getBoundingClientRect().left < EDGE_SWIPE_PX || event.target.closest('video')) return;
    touch = { el: msgEl, actions, x: event.clientX, y: event.clientY, swiping: false, timer: null };
    const bubble = event.target.closest('.bubble');
    if (!bubble) return;
    touch.timer = setTimeout(() => {
      endTouch();
      skipClick = true;
      navigator.vibrate?.(10);
      actions.open(bubble);
    }, LONG_PRESS_MS);
  });
  messagesEl.addEventListener('pointermove', (event) => {
    if (!touch) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    if (!touch.swiping) {
      if (Math.hypot(dx, dy) > PRESS_MOVE_PX) clearTimeout(touch.timer);
      if (Math.abs(dx) < SWIPE_START_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      touch.swiping = true;
      touch.el.classList.add('swiping');
    }
    touch.el.style.transform = `translateX(${Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx))}px)`;
    touch.el.classList.toggle('swipe-ready', Math.abs(dx) >= SWIPE_REPLY_PX);
  });
  messagesEl.addEventListener('pointerup', (event) => {
    if (!touch) return;
    const { swiping, actions, x } = touch;
    endTouch();
    if (!swiping) return;
    skipClick = true;
    if (Math.abs(event.clientX - x) >= SWIPE_REPLY_PX) actions.reply();
  });
  messagesEl.addEventListener('pointercancel', endTouch);
  // el toque que terminó en un gesto no cuenta además como click (no abre la imagen que tenía debajo)
  messagesEl.addEventListener(
    'click',
    (event) => {
      if (!skipClick) return;
      skipClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
  // Sin mouse no hay hover: tocar un mensaje le muestra los tres puntitos (y se los saca al que los tenía)
  messagesEl.addEventListener('click', (event) => {
    if (!touching) return;
    const msgEl = event.target.closest('.msg');
    for (const other of messagesEl.querySelectorAll('.msg.show-actions')) if (other !== msgEl) other.classList.remove('show-actions');
    msgEl?.classList.add('show-actions');
  });
  // el menú del sistema que sale al mantener apretado: acá ese gesto abre el menú del mensaje
  messagesEl.addEventListener('contextmenu', (event) => touching && event.preventDefault());

  // Imagen con temporizador: no se muestra hasta tocarla. Como la web, una ajena queda abierta `expiresIn`
  // segundos (o hasta cerrarla) y recién ahí se avisa a MeWe que fue vista: en ese momento MeWe la borra,
  // así que avisar antes dejaba el visor en negro.
  function renderTimedImage(m) {
    const label = m.mine ? 'Ver la imagen temporal que enviaste' : `Ver imagen temporal (dura ${formatSeconds(m.expiresIn)} desde que la abres)`;
    return h(
      'button',
      {
        className: 'msg-timed',
        title: label,
        attrs: { 'aria-label': label },
        onClick: () => {
          const gen = generation;
          const accountId = account.id;
          let timer = null;
          openLightbox({
            accountId,
            images: m.images,
            index: 0,
            caption: m.mine ? 'Imagen temporal' : `Imagen temporal: se cierra en ${formatSeconds(m.expiresIn)} y desaparece`,
            onClose: () => {
              clearTimeout(timer);
              if (m.mine) return;
              api
                .markMessageSeen(accountId, m.id)
                .catch((err) => console.warn('[chat] marcar visto', err))
                .finally(() => gen === generation && loadLatest());
            },
          });
          if (!m.mine) timer = setTimeout(closeLightbox, m.expiresIn * 1000);
        },
      },
      h('span', { className: 'msg-timed-icon', attrs: { 'aria-hidden': 'true' } }, '⏱'),
      h('span', {}, m.images.length > 1 ? `${m.images.length} imágenes temporales` : 'Imagen temporal', h('span', { className: 'msg-timed-hint' }, 'Toca para ver')),
    );
  }

  // Video adjunto: se ve la miniatura con el botón de play y, al tocarla, se reproduce ahí mismo.
  // Se prueban las URLs de `sources` en orden hasta que una reproduzca. onEnded: al terminar de verse.
  // key identifica al video dentro del chat: su nodo se reutiliza al redibujar los mensajes (ver render).
  function renderVideo(video, key, { autoplay = false, onEnded } = {}) {
    if (videoBoxes.has(key)) return videoBoxes.get(key);
    const accountId = account.id;
    const box = h('div', { className: 'msg-video' });
    videoBoxes.set(key, box);
    const play = () => {
      let index = 0;
      const player = h('video', { controls: true, autoplay: true, preload: 'metadata', poster: imageUrl(accountId, video.poster) ?? '' });
      player.addEventListener('error', () => {
        console.warn('[video]', player.currentSrc, player.error?.code, player.error?.message);
        index++;
        if (index < video.sources.length) player.src = imageUrl(accountId, video.sources[index]);
        else box.replaceChildren(h('p', { className: 'msg-file' }, `🎬 No se pudo reproducir el video${video.name ? ` (${video.name})` : ''}.`));
      });
      if (onEnded) player.addEventListener('ended', onEnded, { once: true });
      player.src = imageUrl(accountId, video.sources[0]);
      box.replaceChildren(player);
    };
    if (autoplay) {
      play();
      return box;
    }
    box.append(
      h(
        'button',
        { className: 'msg-video-play', title: 'Reproducir video', attrs: { 'aria-label': 'Reproducir video' }, onClick: play },
        video.poster && h('img', { src: imageUrl(accountId, video.poster), alt: '', loading: 'lazy' }),
        h('span', { className: 'msg-video-icon' }, icon('play')),
        video.duration && h('span', { className: 'gif-badge' }, formatDuration(video.duration)),
      ),
    );
    return box;
  }

  // Video con temporizador: como las imágenes temporales, no se muestra hasta tocarlo. Uno ajeno se da por visto
  // cuando termina de reproducirse (ahí MeWe lo borra).
  function renderTimedVideo(m, video, key) {
    if (videoBoxes.has(key)) return videoBoxes.get(key); // ya se abrió: sigue el reproductor
    const label = m.mine ? 'Ver el video temporal que enviaste' : 'Ver video temporal (desaparece después de verlo)';
    const button = h(
      'button',
      {
        className: 'msg-timed',
        title: label,
        attrs: { 'aria-label': label },
        onClick: () => {
          const gen = generation;
          const accountId = account.id;
          const onEnded = () => {
            if (m.mine) return;
            api
              .markMessageSeen(accountId, m.id)
              .catch((err) => console.warn('[chat] marcar visto', err))
              .finally(() => gen === generation && loadLatest());
          };
          button.replaceWith(renderVideo(video, key, { autoplay: true, onEnded }));
        },
      },
      h('span', { className: 'msg-timed-icon', attrs: { 'aria-hidden': 'true' } }, '⏱'),
      h('span', {}, 'Video temporal', h('span', { className: 'msg-timed-hint' }, 'Toca para ver')),
    );
    return button;
  }

  // Envuelve un nombre o una foto en un botón que abre el perfil (si se conoce el usuario)
  function profileLink(child, userId, { className, label } = {}) {
    if (!userId || !navigate) return h('span', { className }, child);
    return h(
      'button',
      { className: `link-btn ${className}`, attrs: { 'aria-label': label }, onClick: () => navigate('profile', { userId }) },
      child,
    );
  }

  function renderQuote(reply, names) {
    return h(
      'button',
      {
        className: 'msg-quote',
        title: 'Ir al mensaje original',
        onClick: () => scrollToMessage(reply.id),
      },
      names.get(reply.authorId) && userName(names.get(reply.authorId), { className: 'msg-quote-author' }),
      h('span', { className: 'msg-quote-text', attrs: { dir: 'auto' } }, plainText(reply.text) || '📷 Imagen'),
    );
  }

  // El mensaje responde a una historia: va su miniatura (se abre en el visor) y de quién era.
  // MeWe borra las historias al día: si la imagen ya no existe queda sólo el texto.
  function renderStoryReply(m) {
    const { story } = m;
    const own = story.tellerId === account.userId;
    const label = own ? (m.mine ? 'Tu historia' : 'Respondió a tu historia') : m.mine ? 'Respondiste a su historia' : 'Respuesta a una historia';
    const text = h('span', { className: 'msg-story-text' }, h('span', { className: 'msg-quote-author' }, label));
    if (!story.image) return h('div', { className: 'msg-story' }, text);
    const img = h('img', { src: imageUrl(account.id, story.image.src), alt: '', loading: 'lazy' });
    const box = h(
      'button',
      {
        className: 'msg-story',
        title: 'Ver la historia',
        attrs: { 'aria-label': `${label}: ver la historia` },
        onClick: () => openLightbox({ accountId: account.id, images: [story.image], index: 0, caption: label }),
      },
      h('span', { className: 'msg-story-thumb' }, img, story.isVideo && h('span', { className: 'msg-video-icon' }, icon('play'))),
      text,
    );
    img.addEventListener(
      'error',
      () => {
        box.disabled = true;
        box.title = '';
        img.parentElement.remove();
        text.append(h('span', { className: 'msg-quote-text' }, 'La historia ya no está disponible.'));
      },
      { once: true },
    );
    return box;
  }

  // --- Barra del chat: título, portada de fondo, búsqueda y galería ---

  function renderTitle() {
    const name = userName(thread.name, { fallback: 'Chat' });
    const groupId = thread.chatType === 'EventChat' ? null : thread.isGroup ? (thread.groupId ?? thread.id) : null;
    const target = groupId ? ['group', { groupId }] : thread.userId ? ['profile', { userId: thread.userId }] : null;
    titleEl.replaceChildren(
      target && navigate ? h('button', { className: 'link-btn', title: 'Ver perfil', onClick: () => navigate(...target) }, name) : name,
    );
  }

  // Ajuste "Portada como fondo del chat": la de la persona o la del grupo (styles.css la atenúa)
  async function loadCover() {
    el.style.removeProperty('--chat-cover');
    if (!getSettings().chatCover) return;
    const gen = generation;
    const accountId = account.id;
    try {
      const groupId = thread.chatType === 'EventChat' ? null : thread.isGroup ? (thread.groupId ?? thread.id) : null;
      const source = groupId
        ? await api.getGroup(accountId, groupId)
        : thread.userId
          ? await api.getProfile(accountId, thread.userId)
          : null;
      if (gen === generation && source?.cover) el.style.setProperty('--chat-cover', `url("${imageUrl(accountId, source.cover)}")`);
    } catch (err) {
      console.warn('[chat] portada', err); // sin portada el chat queda con el fondo normal
    }
  }

  function closePanel() {
    panel = null;
    panelEl.hidden = true;
    panelEl.replaceChildren();
    for (const btn of Object.values(panelButtons)) btn.setAttribute('aria-pressed', 'false');
  }

  function togglePanel(kind) {
    const reopen = panel !== kind;
    closePanel();
    if (!reopen || !thread) return;
    panel = kind;
    panelEl.hidden = false;
    panelButtons[kind].setAttribute('aria-pressed', 'true');
    if (kind === 'gallery') renderGalleryPanel();
    else renderSearchPanel();
  }

  function panelHead(title) {
    return h(
      'div',
      { className: 'chat-panel-head' },
      h('strong', {}, title),
      h('button', { className: 'icon-btn', title: 'Cerrar (Esc)', attrs: { 'aria-label': 'Cerrar' }, onClick: closePanel }, '✕'),
    );
  }

  // MeWe entrega el chat de a páginas: búsqueda y galería trabajan sobre lo ya cargado,
  // y este pie permite ir trayendo mensajes más viejos.
  function panelFoot(rerender) {
    const since = messages[0]?.createdAt ? `Mensajes cargados desde ${formatDay(messages[0].createdAt).toLowerCase()}.` : '';
    if (!hasOlder) return h('p', { className: 'status chat-panel-foot' }, since, ' Es todo el chat.');
    const btn = h('button', { className: 'btn' }, 'Cargar más antiguos');
    btn.addEventListener('click', async () => {
      const kind = panel;
      const gen = generation;
      btn.disabled = true;
      btn.textContent = 'Cargando…';
      for (let i = 0; i < OLDER_PAGES_PER_CLICK && hasOlder; i++) {
        if (!(await loadOlder()) || gen !== generation) break;
      }
      if (gen === generation && panel === kind) rerender();
    });
    return h('p', { className: 'status chat-panel-foot' }, since, ' ', btn);
  }

  // Todas las imágenes del chat, las más nuevas primero
  function renderGalleryPanel() {
    const images = messages.flatMap((m) => (m.expiresIn ? [] : m.images)).reverse();
    panelEl.replaceChildren(
      panelHead(`Imágenes del chat (${images.length})`),
      images.length
        ? h(
            'div',
            { className: 'media-grid' },
            images.map((img, index) =>
              h(
                'button',
                {
                  className: 'media-tile',
                  title: 'Ver imagen',
                  attrs: { 'aria-label': 'Ver imagen' },
                  onClick: () => openLightbox({ accountId: account.id, images, index }),
                },
                h('img', { src: imageUrl(account.id, img.src), alt: '', loading: 'lazy' }),
                img.animated && h('span', { className: 'gif-badge', attrs: { 'aria-hidden': 'true' } }, 'GIF'),
              ),
            ),
          )
        : emptyState('No hay imágenes en los mensajes cargados.'),
      panelFoot(renderGalleryPanel),
    );
  }

  // Busca texto en los mensajes (sin distinguir mayúsculas ni acentos); cada resultado lleva al mensaje
  function renderSearchPanel() {
    const input = h('input', {
      type: 'search',
      className: 'input',
      placeholder: 'Buscar en este chat…',
      attrs: { 'aria-label': 'Buscar en este chat' },
    });
    const resultsEl = h('div', { className: 'chat-search-results', attrs: { 'aria-live': 'polite' } });
    const footEl = h('div');
    const update = () => {
      const query = fold(input.value.trim());
      footEl.replaceChildren(panelFoot(update));
      if (query.length < 2) {
        resultsEl.replaceChildren(emptyState('Escribe al menos 2 letras.'));
        return;
      }
      const names = authorNames();
      const found = messages.filter((m) => !m.deleted && fold(m.text).includes(query)).reverse();
      if (!found.length) {
        resultsEl.replaceChildren(emptyState('Sin resultados en los mensajes cargados.'));
        return;
      }
      resultsEl.replaceChildren(
        ...found.map((m) =>
          h(
            'button',
            {
              className: 'chat-search-result',
              onClick: () => {
                closePanel();
                scrollToMessage(m.id);
              },
            },
            h(
              'span',
              { className: 'chat-search-meta' },
              userName(names.get(m.authorId) ?? m.author),
              m.createdAt ? ` · ${formatDay(m.createdAt)} ${formatTime(m.createdAt)}` : '',
            ),
            h('span', { className: 'chat-search-text', attrs: { dir: 'auto' } }, plainText(m.text)),
          ),
        ),
      );
    };
    input.addEventListener('input', update);
    panelEl.replaceChildren(panelHead('Buscar en el chat'), input, resultsEl, footEl);
    update();
    input.focus();
  }

  // authorId → nombre, con lo que se ve en la conversación (para citas y respuestas)
  function authorNames() {
    const names = new Map();
    for (const m of messages) {
      if (m.authorId && m.author) names.set(m.authorId, m.mine ? 'Tú' : m.author);
    }
    return names;
  }

  // Click en una cita: va al original (cargando páginas anteriores si hace falta) y lo resalta
  async function scrollToMessage(id) {
    const gen = generation;
    let target = messagesEl.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    for (let i = 0; !target && hasOlder && i < MAX_PAGES_TO_FIND_REPLY; i++) {
      if (!(await loadOlder()) || gen !== generation) return;
      target = messagesEl.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    }
    if (!target) {
      showError(errorEl, { details: { message: 'No se encontró el mensaje original (puede haber sido eliminado).' } }, 'MeWe chat');
      return;
    }
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    pinned = false; // se va a otro mensaje: nada debe devolver el scroll al final
    renderPin();
    target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    target.classList.remove('highlight');
    void target.offsetWidth; // reinicia la animación
    target.classList.add('highlight');
    target.focus({ preventScroll: true });
  }

  // --- Envío ---

  async function send({ text, files, replyTo, expiresIn, editId }) {
    if (!thread) return;
    const gen = generation;
    const { id: accountId } = account;
    const threadId = thread.id;
    clearError(errorEl);
    if (editId) {
      try {
        await api.editMessage(accountId, threadId, editId, text);
      } catch (err) {
        if (gen === generation) showError(errorEl, err, 'MeWe chat');
        throw err;
      }
      if (gen === generation) {
        // se refleja ya; loadLatest trae la versión de MeWe si el mensaje está en la última página
        merge(messages.filter((m) => m.id === editId).map((m) => ({ ...m, text, edited: true })));
        render();
        loadLatest();
        onSent?.();
      }
      return;
    }
    const sent = [];
    const isVideo = (file) => file.type.startsWith('video/');
    let videos = 0; // enviados a procesar: MeWe los publica en el chat cuando termina de convertirlos
    try {
      if (text) sent.push(await api.sendMessage(accountId, threadId, { text, replyTo }));
      for (const [i, file] of files.entries()) {
        composer.setStatus(`Subiendo ${isVideo(file) ? 'video' : 'imagen'} ${i + 1} de ${files.length}…`);
        const data = new Uint8Array(await file.arrayBuffer());
        // el camino normal de los videos ignora el temporizador: con él, el video va como adjunto, igual que una imagen
        if (isVideo(file) && !expiresIn) {
          await api.sendChatVideo(accountId, threadId, { name: file.name, type: file.type, data }, { replyTo });
          videos++;
          continue;
        }
        const attachmentId = await api.uploadChatImage(accountId, thread.isGroup, { name: file.name, type: file.type, data });
        sent.push(await api.sendMessage(accountId, threadId, { attachments: [attachmentId], replyTo, expiresIn }));
      }
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe chat');
      throw err;
    } finally {
      if (gen === generation && sent.length) {
        merge(sent.filter((m) => m?.id).map((m) => ({ ...m, mine: true })));
        render();
        scrollToBottom();
        setUnread(false); // el envío va con setAsRead: MeWe ya lo marcó
        loadLatest();
        onSent?.();
      }
    }
    if (expiresIn && files.length && !sent.some((m) => m?.expiresIn)) {
      showError(
        errorEl,
        {
          details: {
            message: 'MeWe no aplicó el temporizador: lo adjunto se envió como un mensaje normal.',
            hint: 'La web de MeWe no permite mensajes temporales; sólo la app móvil.',
          },
        },
        'MeWe chat',
      );
    }
    if (!videos) return null;
    // el aviso queda en la caja de redacción (ver createComposer)
    const note = videos > 1 ? `${videos} videos subidos: aparecen en el chat` : 'Video subido: aparece en el chat';
    return `${note} cuando MeWe termine de procesarlo${videos > 1 ? 's' : ''}.`;
  }

  // --- Polling ---

  function restartPolling() {
    clearInterval(pollTimer);
    pollTimer = thread
      ? setInterval(() => {
          if (!document.hidden) loadLatest();
        }, pollMs)
      : null;
  }

  function isNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function scrollToBottom() {
    pinned = true;
    missed = false;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    renderPin();
  }

  // Anclado al final no se muestra nada: el botón (y el degradado detrás) sólo aparecen al subir
  function renderPin() {
    const away = Boolean(thread) && messages.length > 0 && !pinned;
    pinBtn.hidden = !away;
    bodyEl.classList.toggle('unpinned', away);
    pinBtn.classList.toggle('missed', missed && away);
    // en mobile queda sólo la flecha (ver styles.css)
    pinBtn.replaceChildren(icon('arrow-down'), h('span', { className: 'label-text' }, missed ? ' Mensajes nuevos' : ' Ir al final'));
    pinBtn.title = missed ? 'Mensajes nuevos: ir al final' : 'Ir al final y seguir los mensajes nuevos';
  }

  // Al llegar arriba de todo carga los anteriores solo. El anclaje sigue a la posición:
  // al fondo se ancla, más arriba se suelta.
  messagesEl.addEventListener('scroll', () => {
    if (messagesEl.scrollTop < 40 && hasOlder && !loadingOlder) loadOlder();
    const atBottom = isNearBottom();
    if (atBottom === pinned) return;
    pinned = atBottom;
    if (pinned) missed = false;
    renderPin();
  });

  // Anclado, el fondo se mantiene aunque el contenido crezca después (imágenes que terminan de cargar)
  // o cambie el alto disponible (la caja de texto, la ventana)
  messagesEl.addEventListener('load', () => pinned && scrollToBottom(), true);
  messagesEl.addEventListener('loadedmetadata', () => pinned && scrollToBottom(), true); // un video ya sabe su alto
  new ResizeObserver(() => pinned && thread && scrollToBottom()).observe(messagesEl);

  return {
    el,
    get threadId() {
      return thread?.id ?? null;
    },
    get unread() {
      return unread;
    },
    // read: marcarlo como leído apenas carga (cuando lo abre la persona; no cuando la app lo reabre sola)
    async open(newAccount, newThread, { read = false } = {}) {
      generation++;
      account = newAccount;
      thread = newThread;
      messages = [];
      videoBoxes.clear();
      hasOlder = false;
      // sin el dato (chat abierto desde un grupo o una notificación) se asume sin leer
      unread = thread.unread !== false;
      readBtn.hidden = !unread;
      blockBtn.hidden = !thread.userId; // sólo se bloquea desde un chat de a dos
      moreBtn.classList.toggle('mobile-only', !infoTarget()); // sin "Información", en escritorio quedaría vacío
      pinned = true; // todo chat se abre en el final
      missed = false;
      pinBtn.hidden = true;
      clearError(errorEl);
      composer.clear();
      composer.setAccount(account);
      composer.setPeople(mentionable(account.id, thread));
      composer.el.hidden = false;
      closePanel();
      toolsEl.hidden = false;
      renderTitle();
      loadCover();
      messagesEl.replaceChildren(emptyState('Cargando…'));
      const gen = generation;
      await loadLatest({ scroll: 'bottom' });
      if (gen !== generation) return; // mientras cargaba se abrió otro chat (o se cerró éste)
      if (read) markRead();
      composer.focus();
      restartPolling();
    },
    close(text = 'Elige un chat.') {
      generation++;
      thread = null;
      messages = [];
      videoBoxes.clear();
      unread = false;
      readBtn.hidden = true;
      pinBtn.hidden = true;
      bodyEl.classList.remove('unpinned');
      clearInterval(pollTimer);
      pollTimer = null;
      composer.el.hidden = true;
      closePanel();
      toolsEl.hidden = true;
      el.style.removeProperty('--chat-cover');
      clearError(errorEl);
      messagesEl.replaceChildren(emptyState(text));
    },
    refresh: () => loadLatest(),
    markRead,
    // Va a un mensaje y lo resalta (menciones desde las notificaciones)
    goTo: (messageId) => scrollToMessage(messageId),
    // Con websocket conectado el polling pasa a ser lento
    setRealtime(connected) {
      const next = connected ? POLL_SLOW_MS : POLL_FAST_MS;
      if (next === pollMs) return;
      pollMs = next;
      if (thread) restartPolling();
    },
  };
}

// Duración de un video: 75 → "1:15"
function formatDuration(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatSeconds(s) {
  if (s >= 3600) return `${Math.round(s / 3600)} h`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
}
