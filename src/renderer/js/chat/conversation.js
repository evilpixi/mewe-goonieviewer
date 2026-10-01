import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { dayKey, formatDay, formatFull, formatTime } from '../ui/dates.js';
import { emptyState, h } from '../ui/dom.js';
import { openLightbox } from '../ui/lightbox.js';
import { createReactions } from '../ui/reactions.js';
import { userName } from '../ui/userName.js';
import { createComposer } from './composer.js';

const PAGE_SIZE = 25; // igual que config.mewe.chat.pageSize
const RUN_GAP_MS = 5 * 60 * 1000; // mensajes del mismo autor más juntos que esto se agrupan
const POLL_FAST_MS = 5000; // sin tiempo real
const POLL_SLOW_MS = 30000; // con websocket conectado (sólo como red de seguridad)
const MAX_PAGES_TO_FIND_REPLY = 20;

// Una conversación (mensajes + caja de redacción) para cualquier threadId:
// chats con personas, de grupo y (más adelante) de eventos.
export function createConversation({ onSent } = {}) {
  const messagesEl = h('div', { className: 'chat-messages scroll', attrs: { role: 'log', 'aria-label': 'Mensajes' } });
  const errorEl = h('div');
  const composer = createComposer({ onSend: send });
  composer.el.hidden = true;
  const el = h('section', { className: 'chat-conversation' }, messagesEl, errorEl, composer.el);
  composer.acceptDrop(el);

  let account = null;
  let thread = null;
  let messages = [];
  let hasOlder = false;
  let loadingOlder = false;
  let generation = 0; // invalida respuestas de una conversación anterior
  let pollTimer = null;
  let pollMs = POLL_FAST_MS;

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
    const allImages = messages.flatMap((m) => m.images);
    const showAuthors = thread.isGroup || thread.participantsCount > 1;
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
      nodes.push(renderMessage(m, { continues, showAuthors, names, allImages }));
      prev = m;
    }
    messagesEl.replaceChildren(...nodes);
  }

  function renderMessage(m, { continues, showAuthors, names, allImages }) {
    const others = !m.mine && showAuthors;
    const bubble = h(
      'div',
      { className: 'bubble' },
      m.replyTo && renderQuote(m.replyTo, names),
      m.deleted && h('p', { className: 'msg-text deleted' }, 'Mensaje eliminado'),
      m.text && h('p', { className: 'msg-text', attrs: { dir: 'auto' } }, m.text),
      m.images.length > 0 &&
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
            ),
          ),
        ),
      m.files.map((f) => h('p', { className: 'msg-file' }, `📎 ${f.name}`)),
      h(
        'span',
        { className: 'msg-time', title: m.createdAt ? formatFull(m.createdAt) : '' },
        m.expiresIn ? `⏱ ${formatSeconds(m.expiresIn)} · ` : '',
        m.createdAt ? formatTime(m.createdAt) : '',
      ),
    );

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
        '↩',
      ),
      h(
        'button',
        {
          className: 'icon-btn',
          title: 'Reaccionar',
          attrs: { 'aria-label': 'Reaccionar', 'aria-haspopup': 'dialog' },
          onClick: (event) => reactions.pick(event.currentTarget),
        },
        '☺',
      ),
    );

    return h(
      'div',
      {
        className: `msg${m.mine ? ' mine' : ''}${continues ? ' continues' : ''}`,
        dataset: { messageId: m.id },
        attrs: { tabindex: '-1' },
      },
      others && (continues ? h('span', { className: 'msg-avatar-space' }) : avatar(account.id, m.authorAvatar, { name: m.author, size: 'sm', className: 'msg-avatar' })),
      h(
        'div',
        { className: 'msg-body' },
        others && !continues && userName(m.author, { className: 'msg-author' }),
        h('div', { className: 'msg-line' }, bubble, actions),
        reactions.el,
      ),
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
      h('span', { className: 'msg-quote-text', attrs: { dir: 'auto' } }, reply.text || '📷 Imagen'),
    );
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

  async function send({ text, files, replyTo, expiresIn }) {
    if (!thread) return;
    const gen = generation;
    const { id: accountId } = account;
    const threadId = thread.id;
    clearError(errorEl);
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
      composer.el.hidden = false;
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
