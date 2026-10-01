import { api } from './api.js';
import { createConversation } from './chat/conversation.js';
import { clearError, showError } from './errorView.js';
import { avatar } from './ui/avatar.js';
import { emptyState, h } from './ui/dom.js';
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
export function createChatView() {
  const filterTabs = createTabs({ label: 'Tipo de chat', tabs: FILTERS, onChange: changeFilter });
  const filterEl = filterTabs.el;
  const liveEl = h('span', { className: 'live-status', attrs: { 'aria-live': 'polite' } });
  const toolbar = h('div', { className: 'view-toolbar-group' }, filterEl, liveEl);
  const threadsEl = h('ul', { className: 'chat-threads scroll', attrs: { 'aria-label': 'Conversaciones' } });
  const errorEl = h('div');
  const conversation = createConversation({ onSent: () => scheduleThreadsRefresh() });
  const el = h('div', { className: 'view chat' }, h('div', { className: 'chat-sidebar' }, errorEl, threadsEl), conversation.el);

  let account = null;
  let filter = savedFilter();
  let threads = [];
  let activeId = null;
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
      renderThreads();
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
            h('span', { className: 'chat-thread-last', attrs: { dir: 'auto' } }, t.lastMessage),
          ),
          t.unread && !active && h('span', { className: 'unread-dot', attrs: { 'aria-label': 'Sin leer' } }),
        );
        return h('li', {}, btn);
      }),
    );
  }

  function openThread(t) {
    activeId = t.id;
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
      account = newAccount;
      threads = [];
      activeId = null;
      clearError(errorEl);
      renderFilter();
      conversation.close();
      if (!account) {
        threadsEl.replaceChildren();
        return;
      }
      renderLive();
      threadsEl.replaceChildren(emptyState('Cargando…', 'li'));
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
