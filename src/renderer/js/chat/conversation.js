import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { getSettings } from '../settings.js';
import { avatar } from '../ui/avatar.js';
import { tintWithAvatarColor } from '../ui/avatarColor.js';
import { dayKey, formatDay, formatFull, formatTime } from '../ui/dates.js';
import { emptyState, h } from '../ui/dom.js';
import { icon } from '../ui/icon.js';
import { closeLightbox, openLightbox } from '../ui/lightbox.js';
import { createReactions } from '../ui/reactions.js';
import { emojiOnlyCount, plainText, richText } from '../ui/richText.js';
import { userName } from '../ui/userName.js';
import { createComposer } from './composer.js';

const PAGE_SIZE = 25; // igual que config.mewe.chat.pageSize
const RUN_GAP_MS = 5 * 60 * 1000; // mensajes del mismo autor más juntos que esto se agrupan
const POLL_FAST_MS = 5000; // sin tiempo real
const POLL_SLOW_MS = 30000; // con websocket conectado (sólo como red de seguridad)
const MAX_PAGES_TO_FIND_REPLY = 20;
const OLDER_PAGES_PER_CLICK = 5; // "Cargar más antiguos" en búsqueda y galería

// Para comparar texto sin distinguir mayúsculas ni acentos
const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Una conversación (mensajes + caja de redacción) para cualquier threadId:
// chats con personas, de grupo y (más adelante) de eventos.
// navigate: el del router; con él, los nombres y las fotos llevan al perfil.
export function createConversation({ onSent, navigate } = {}) {
  const messagesEl = h('div', { className: 'chat-messages scroll', attrs: { role: 'log', 'aria-label': 'Mensajes' } });
  const errorEl = h('div');
  const composer = createComposer({ onSend: send });
  composer.el.hidden = true;
  // Barra del chat: con quién se habla + buscar en el chat + galería de imágenes
  const titleEl = h('div', { className: 'chat-tools-title' });
  const toolButton = (icon, label, kind) =>
    h('button', { className: 'btn icon-btn', title: label, attrs: { 'aria-label': label, 'aria-pressed': 'false' }, onClick: () => togglePanel(kind) }, icon);
  const panelButtons = {
    search: toolButton('🔍', 'Buscar en este chat', 'search'),
    gallery: toolButton('🖼', 'Imágenes de este chat', 'gallery'),
  };
  const toolsEl = h('div', { className: 'chat-tools', hidden: true }, titleEl, panelButtons.search, panelButtons.gallery);
  // Panel (búsqueda o galería) que tapa los mensajes mientras está abierto
  const panelEl = h('div', { className: 'chat-panel scroll', hidden: true });
  const bodyEl = h('div', { className: 'chat-body' }, messagesEl, panelEl);
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

  // --- Carga ---

  // Trae la última página y la fusiona (carga inicial, polling y eventos en tiempo real)
  async function loadLatest({ scroll } = {}) {
    if (!thread) return;
    const gen = generation;
    try {
      const page = await api.getMessages(account.id, thread.id);
      if (gen !== generation) return;
      if (!messages.length) hasOlder = page.length >= PAGE_SIZE;
      const nearBottom = isNearBottom();
      const { added, changed } = merge(page);
      if (added || changed || !messagesEl.querySelector('.msg')) render();
      if (scroll === 'bottom' || (added && nearBottom)) scrollToBottom();
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
    messagesEl.replaceChildren(...nodes);
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
    const canEdit = m.mine && !m.deleted && Boolean(m.text) && !m.images.length && !m.files.length && !m.expiresIn;
    const actions = h(
      'div',
      { className: 'msg-actions' },
      h(
        'button',
        {
          className: 'icon-btn',
          title: 'Responder',
          attrs: { 'aria-label': 'Responder' },
          onClick: () => composer.setReplyTo(m, names.get(m.authorId)),
        },
        icon('reply'),
      ),
      h(
        'button',
        {
          className: 'icon-btn',
          title: 'Reaccionar',
          attrs: { 'aria-label': 'Reaccionar', 'aria-haspopup': 'dialog' },
          onClick: (event) => reactions.pick(event.currentTarget),
        },
        icon('smile-plus'),
      ),
      canEdit &&
        h(
          'button',
          { className: 'icon-btn', title: 'Editar', attrs: { 'aria-label': 'Editar mensaje' }, onClick: () => composer.setEditing(m) },
          icon('pencil'),
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
        others && !continues && profileLink(userName(m.author), m.authorId, { className: 'msg-author' }),
        h('div', { className: 'msg-line' }, bubble, actions),
        reactions.el,
      ),
      m.mine && face(account.name, account.avatar, account.userId),
    );
  }

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
    try {
      if (text) sent.push(await api.sendMessage(accountId, threadId, { text, replyTo }));
      for (const [i, file] of files.entries()) {
        composer.setStatus(`Subiendo imagen ${i + 1} de ${files.length}…`);
        const data = new Uint8Array(await file.arrayBuffer());
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
        loadLatest();
        onSent?.();
      }
    }
    if (expiresIn && files.length && !sent.some((m) => m?.expiresIn)) {
      showError(
        errorEl,
        {
          details: {
            message: 'MeWe no aplicó el temporizador: la imagen se envió como una normal.',
            hint: 'La web de MeWe no permite mensajes temporales; sólo la app móvil.',
          },
        },
        'MeWe chat',
      );
    }
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
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Al llegar arriba de todo carga los anteriores solo
  messagesEl.addEventListener('scroll', () => {
    if (messagesEl.scrollTop < 40 && hasOlder && !loadingOlder) loadOlder();
  });

  return {
    el,
    get threadId() {
      return thread?.id ?? null;
    },
    async open(newAccount, newThread) {
      generation++;
      account = newAccount;
      thread = newThread;
      messages = [];
      hasOlder = false;
      clearError(errorEl);
      composer.clear();
      composer.setAccount(account);
      composer.el.hidden = false;
      closePanel();
      toolsEl.hidden = false;
      renderTitle();
      loadCover();
      messagesEl.replaceChildren(emptyState('Cargando…'));
      await loadLatest({ scroll: 'bottom' });
      composer.focus();
      restartPolling();
    },
    close(text = 'Elige un chat.') {
      generation++;
      thread = null;
      messages = [];
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

function formatSeconds(s) {
  if (s >= 3600) return `${Math.round(s / 3600)} h`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
}
