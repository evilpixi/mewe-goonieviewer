import { api } from './api.js';
import { createConversation } from './chat/conversation.js';
import { clearError, showError } from './errorView.js';
import { avatar } from './ui/avatar.js';
import { emptyState, h } from './ui/dom.js';
import { plainText } from './ui/richText.js';
import { createTabs } from './ui/tabs.js';
import { userName } from './ui/userName.js';

const THREADS_POLL_MS = 30000;
const THREADS_REFRESH_DEBOUNCE_MS = 800;
const FILTER_KEY = 'chatFilter';
const FILTERS = [
  ['users', 'Personas'],
  ['groups', 'Grupos'],
  ['all', 'Todos'],
];

// Ancho de la lista de chats, elegido arrastrando su borde: { width: px | null, compact: bool }
const SIDEBAR_KEY = 'chatSidebar';
const SIDEBAR_MIN_PX = 150; // más angosta que esto pasa a compacta (sólo fotos)
const SIDEBAR_KEY_STEP_PX = 24;
const CONVERSATION_MIN_PX = 260;

function savedSidebar() {
  try {
    const { width, compact } = JSON.parse(localStorage.getItem(SIDEBAR_KEY)) ?? {};
    return { width: Number(width) > 0 ? Number(width) : null, compact: Boolean(compact) };
  } catch {
    return { width: null, compact: false };
  }
}

function savedFilter() {
  try {
    const value = localStorage.getItem(FILTER_KEY);
    return FILTERS.some(([f]) => f === value) ? value : 'users';
  } catch {
    return 'users';
  }
}

// Chats de la cuenta activa: lista de conversaciones (personas / grupos) + conversación abierta.
// Mensajes nuevos: websocket de MeWe desde main ('chat:event'); el polling queda como respaldo.
export function createChatView({ navigate } = {}) {
  const filterTabs = createTabs({ label: 'Tipo de chat', tabs: FILTERS, onChange: changeFilter });
  const filterEl = filterTabs.el;
  const liveEl = h('span', { className: 'live-status', attrs: { 'aria-live': 'polite' } });
  const toolbar = h('div', { className: 'view-toolbar-group' }, filterEl, liveEl);
  const threadsEl = h('ul', { className: 'chat-threads scroll', attrs: { 'aria-label': 'Conversaciones' } });
  const errorEl = h('div');
  const conversation = createConversation({ navigate, onSent: () => scheduleThreadsRefresh() });
  const sidebarEl = h('div', { className: 'chat-sidebar' }, errorEl, threadsEl);
  const resizerEl = h('div', {
    className: 'chat-resizer',
    title: 'Arrastra para cambiar el ancho de la lista de chats (doble click: ancho original)',
    attrs: { role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Ancho de la lista de chats' },
  });
  const el = h('div', { className: 'view chat' }, sidebarEl, resizerEl, conversation.el);

  // --- Ancho de la lista (arrastrando el borde, o con ← → teniendo el foco en él) ---

  let sidebar = savedSidebar();

  function applySidebar() {
    // si la ventana se achica y el ancho elegido ya no deja lugar a la conversación, también se compacta
    const narrow = Boolean(sidebar.width) && el.clientWidth > 0 && el.clientWidth - sidebar.width < CONVERSATION_MIN_PX;
    const compact = sidebar.compact || narrow;
    el.classList.toggle('compact-threads', compact);
    if (sidebar.width && !compact) el.style.setProperty('--threads-width', `${sidebar.width}px`);
    else el.style.removeProperty('--threads-width');
  }

  function saveSidebar() {
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar));
    } catch {
      // sin storage: el ancho no se recuerda
    }
  }

  // Por debajo del umbral la lista se compacta; al volver a ensancharla recupera los nombres
  function resizeSidebar(width) {
    const max = Math.max(SIDEBAR_MIN_PX, el.clientWidth - CONVERSATION_MIN_PX);
    sidebar = width < SIDEBAR_MIN_PX ? { width: sidebar.width, compact: true } : { width: Math.round(Math.min(width, max)), compact: false };
    applySidebar();
  }

  resizerEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizerEl.setPointerCapture(event.pointerId);
    resizerEl.classList.add('dragging');
    const left = sidebarEl.getBoundingClientRect().left;
    const move = (e) => resizeSidebar(e.clientX - left);
    const end = () => {
      resizerEl.classList.remove('dragging');
      resizerEl.removeEventListener('pointermove', move);
      resizerEl.removeEventListener('pointerup', end);
      resizerEl.removeEventListener('pointercancel', end);
      saveSidebar();
    };
    resizerEl.addEventListener('pointermove', move);
    resizerEl.addEventListener('pointerup', end);
    resizerEl.addEventListener('pointercancel', end);
  });
  resizerEl.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const grow = event.key === 'ArrowRight';
    // compacta + → vuelve al ancho mínimo con nombres
    const current = sidebar.compact ? SIDEBAR_MIN_PX - SIDEBAR_KEY_STEP_PX : sidebarEl.getBoundingClientRect().width;
    resizeSidebar(current + (grow ? SIDEBAR_KEY_STEP_PX : -SIDEBAR_KEY_STEP_PX));
    saveSidebar();
  });
  resizerEl.addEventListener('dblclick', () => {
    sidebar = { width: null, compact: false };
    applySidebar();
    saveSidebar();
  });
  new ResizeObserver(applySidebar).observe(el);
  applySidebar();

  let account = null;
  let filter = savedFilter();
  let threads = [];
  let activeId = null;
  let lastThread = null; // último chat abierto: se reabre al volver (p. ej. desde un perfil)
  let generation = 0; // invalida respuestas de una cuenta anterior
  let threadsTimer = null;
  let refreshTimer = null;
  let visible = false;
  const realtime = new Map(); // accountId → conectado

  // --- Tiempo real (una sola suscripción para toda la vida de la vista) ---

  api.onChatEvent(({ accountId, threadId }) => {
    if (!visible || accountId !== account?.id) return;
    if (!threadId || threadId === conversation.threadId) conversation.refresh();
    scheduleThreadsRefresh();
  });

  api.onChatStatus(({ accountId, connected }) => {
    realtime.set(accountId, connected);
    if (accountId === account?.id) renderLive();
  });

  function renderLive() {
    const connected = realtime.get(account?.id) ?? false;
    liveEl.textContent = connected ? '● En vivo' : '○ Cada 5 s';
    liveEl.title = connected
      ? 'Conectado al tiempo real de MeWe'
      : 'Sin conexión en tiempo real: se buscan mensajes nuevos cada 5 segundos';
    liveEl.classList.toggle('on', connected);
    conversation.setRealtime(connected);
  }

  // --- Lista de conversaciones ---

  function renderFilter() {
    filterTabs.select(filter);
  }

  function changeFilter(value) {
    filter = value;
    try {
      localStorage.setItem(FILTER_KEY, value);
    } catch {
      // sin storage: el filtro no se recuerda
    }
    threads = [];
    threadsEl.replaceChildren(emptyState('Cargando…', 'li'));
    loadThreads();
  }

  async function loadThreads() {
    if (!account) return;
    const gen = generation;
    const requested = filter;
    try {
      const list = await api.getChatThreads(account.id, requested);
      if (gen !== generation || requested !== filter) return;
      threads = list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      clearError(errorEl);
      // al entrar a una cuenta se abre el chat más reciente, sin tener que elegirlo
      if (!activeId && threads.length) openThread(threads[0]);
      else renderThreads();
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe chat');
    }
  }

  function scheduleThreadsRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadThreads, THREADS_REFRESH_DEBOUNCE_MS);
  }

  function renderThreads() {
    if (!threads.length) {
      threadsEl.replaceChildren(emptyState('Sin chats.', 'li'));
      return;
    }
    threadsEl.replaceChildren(
      ...threads.map((t) => {
        const active = t.id === activeId;
        const btn = h(
          'button',
          {
            className: `chat-thread-item${active ? ' active' : ''}${t.unread && !active ? ' unread' : ''}`,
            title: t.name,
            attrs: { 'aria-current': active ? 'true' : null },
            onClick: () => openThread(t),
          },
          avatar(account.id, t.avatar, { name: t.name }),
          h(
            'span',
            { className: 'chat-thread-info' },
            h(
              'span',
              { className: 'chat-thread-title' },
              t.isGroup && h('span', { className: 'chat-thread-kind', title: 'Chat de grupo' }, '👥'),
              userName(t.name, { className: 'chat-thread-name', fallback: 'Chat' }),
            ),
            h('span', { className: 'chat-thread-last', attrs: { dir: 'auto' } }, plainText(t.lastMessage)),
          ),
          t.unread && !active && h('span', { className: 'unread-dot', attrs: { 'aria-label': 'Sin leer' } }),
        );
        return h('li', {}, btn);
      }),
    );
  }

  function openThread(t) {
    activeId = t.id;
    lastThread = t;
    t.unread = false;
    renderThreads();
    conversation.open(account, t);
  }

  function stop() {
    clearInterval(threadsTimer);
    clearTimeout(refreshTimer);
    threadsTimer = refreshTimer = null;
  }

  return {
    el,
    toolbar,
    show(newAccount) {
      stop();
      generation++;
      visible = true;
      // misma cuenta que antes (se vuelve de otra vista): se conserva la lista y se reabre el chat
      const reopen = newAccount && account?.id === newAccount.id ? lastThread : null;
      account = newAccount;
      if (!reopen) {
        threads = [];
        lastThread = null;
      }
      activeId = null;
      clearError(errorEl);
      renderFilter();
      conversation.close();
      if (!account) {
        threadsEl.replaceChildren();
        return;
      }
      renderLive();
      if (reopen) openThread(reopen);
      else threadsEl.replaceChildren(emptyState('Cargando…', 'li'));
      loadThreads();
      threadsTimer = setInterval(() => {
        if (!document.hidden) loadThreads();
      }, THREADS_POLL_MS);
      api
        .startRealtime(account.id)
        .then(({ connected }) => {
          realtime.set(newAccount.id, connected || realtime.get(newAccount.id) || false);
          if (account?.id === newAccount.id) renderLive();
        })
        .catch((err) => console.warn('[realtime]', err));
    },
    hide() {
      visible = false;
      stop();
      generation++;
      conversation.close();
    },
    reload() {
      loadThreads();
      conversation.refresh();
    },
  };
}
