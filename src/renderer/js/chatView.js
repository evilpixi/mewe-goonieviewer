import { api } from './api.js';
import { createConversation } from './chat/conversation.js';
import { clearError, showError } from './errorView.js';
import { avatar } from './ui/avatar.js';
import { emptyState, h } from './ui/dom.js';
import { icon } from './ui/icon.js';
import { EDGE_SWIPE_PX, isMobile } from './ui/mobile.js';
import { plainText } from './ui/richText.js';
import { createTabs } from './ui/tabs.js';
import { userName } from './ui/userName.js';

const THREADS_POLL_MS = 30000;
const THREADS_REFRESH_DEBOUNCE_MS = 800;
const FILTER_KEY = 'chatFilter';
const FILTERS = [
  ['all', 'Todos', 'layout-grid'],
  ['users', 'Personas', 'user'],
  ['groups', 'Grupos', 'users-round'],
];

// Ancho de la lista de chats, elegido arrastrando su borde: { width: px | null, compact: bool }
const SIDEBAR_KEY = 'chatSidebar';
const SIDEBAR_MIN_PX = 150; // más angosta que esto pasa a compacta (sólo fotos)
const SIDEBAR_KEY_STEP_PX = 24;
const CONVERSATION_MIN_PX = 260;

// Tirón del agarrador de la lista (mobile): cuánto hay que arrastrarlo para cada cosa
const PULL_START_PX = 8; // menos que esto es un toque
const PULL_SHOW_PX = 20; // muestra (a la derecha) u oculta (a la izquierda) la lista compacta

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
  const liveIcon = icon('radio');
  liveIcon.classList.add('label-icon');
  const liveText = h('span', { className: 'label-text' });
  const liveEl = h('span', { className: 'live-status', attrs: { 'aria-live': 'polite' } }, liveIcon, liveText);
  // Sólo se ve mientras la lista tiene chats sin leer (ver renderThreads)
  const readAllBtn = h('button', { className: 'btn icon-btn', hidden: true, onClick: () => markAllRead() }, icon('check-check'));
  const toolbarRight = h('div', { className: 'toolbar-slot' }, readAllBtn, liveEl);
  const threadsEl = h('ul', { className: 'chat-threads scroll', attrs: { 'aria-label': 'Conversaciones' } });
  const errorEl = h('div');
  const conversation = createConversation({
    navigate,
    onSent: () => scheduleThreadsRefresh(),
    // se bloqueó a la persona del chat abierto: el chat se cierra y la lista se vuelve a pedir
    onBlocked: () => {
      extraThread = null;
      closeThread();
      loadThreads();
    },
    // mobile: la flecha de la barra del chat vuelve a la lista
    onBack: () => {
      closeThread();
      renderThreads();
    },
    // el chat abierto sabe si quedó leído (click, escribir, botón) o si le llegó algo nuevo
    onUnreadChange: (threadId, unread) => {
      const t = threads.find((item) => item.id === threadId);
      if (lastThread?.id === threadId) lastThread.unread = unread;
      if (!t) return;
      t.unread = unread;
      renderThreads();
    },
  });
  const sidebarEl = h('div', { className: 'chat-sidebar' }, errorEl, threadsEl);
  const resizerEl = h('div', {
    className: 'chat-resizer',
    title: 'Arrastra para cambiar el ancho de la lista de chats (doble click: ancho original)',
    attrs: { role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Ancho de la lista de chats' },
  });
  // Agarrador (mobile): flota sobre el borde izquierdo de la conversación abierta. Tocarlo o tironearlo hacia
  // la derecha muestra la lista compacta (sólo fotos), y queda en el borde de esa lista; hacia la izquierda
  // la oculta. El mismo gesto vale arrancando del borde izquierdo de la conversación.
  const grabberEl = h('button', {
    className: 'chat-grabber',
    title: 'Mostrar u ocultar la lista de chats',
    attrs: { 'aria-label': 'Lista de chats', 'aria-expanded': 'false' },
    onClick: () => {
      if (pulled) pulled = false; // el click que cierra un tirón: ya se resolvió al soltar
      else showThreads(!el.classList.contains('threads-shown'));
    },
  });
  const el = h('div', { className: 'view chat' }, sidebarEl, grabberEl, resizerEl, conversation.el);

  function showThreads(shown) {
    el.classList.toggle('threads-shown', shown);
    grabberEl.setAttribute('aria-expanded', String(shown));
  }

  let pulled = false; // el agarrador se acaba de tironear (ver su onClick)

  // Sigue un tirón horizontal que empieza en `event` (pointerdown)
  function trackPull(event) {
    const target = event.currentTarget;
    const onGrabber = target === grabberEl;
    const startX = event.clientX;
    const wasShown = el.classList.contains('threads-shown');
    // la lista aparece (o se va) mientras se tironea, sin esperar a soltar
    const move = (e) => {
      const dx = e.clientX - startX;
      if (Math.abs(dx) >= PULL_START_PX) pulled = onGrabber;
      showThreads(wasShown ? dx > -PULL_SHOW_PX : dx >= PULL_SHOW_PX);
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    // (un dedo ya manda sus eventos a donde empezó; capturarlo en la conversación le sacaría el click a sus botones)
    if (onGrabber) target.setPointerCapture(event.pointerId);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  grabberEl.addEventListener('pointerdown', (event) => {
    pulled = false;
    if (event.isPrimary && event.button === 0) trackPull(event);
  });
  conversation.el.addEventListener('pointerdown', (event) => {
    // sólo sobre los mensajes: la barra de arriba y la caja de escribir tienen botones en ese borde
    const fromEdge = event.clientX - conversation.el.getBoundingClientRect().left < EDGE_SWIPE_PX && event.target.closest('.chat-messages');
    if (isMobile() && activeId && event.isPrimary && event.pointerType !== 'mouse' && fromEdge) trackPull(event);
  });

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
  let extraThread = null; // chat pedido desde afuera ("Mensaje" en un perfil): se suma a la lista si MeWe no lo trae
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
    liveText.textContent = connected ? '● En vivo' : '○ Cada 5 s';
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
    readAllBtn.hidden = true;
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
      // un chat recién creado, todavía sin mensajes, no viene en la lista: va arriba para que quede seleccionado
      const showExtra = extraThread && (requested === 'all' || (requested === 'groups') === Boolean(extraThread.isGroup));
      if (showExtra && !threads.some((t) => t.id === extraThread.id)) threads.unshift(extraThread);
      // para el chat abierto vale lo que sabe la conversación (la lista puede llegar atrasada)
      const open = threads.find((t) => t.id === conversation.threadId);
      if (open) open.unread = conversation.unread;
      clearError(errorEl);
      // al entrar a una cuenta se abre el chat más reciente, sin tener que elegirlo
      // (en mobile no: ahí se ve la lista o la conversación, y se empieza por la lista)
      if (!activeId && threads.length && !isMobile()) openThread(threads[0]);
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
    const unreadCount = threads.filter((t) => t.unread).length;
    const scope = { all: 'todos los chats', users: 'los chats con personas', groups: 'los chats de grupo' }[filter];
    readAllBtn.hidden = !unreadCount;
    readAllBtn.title = `Marcar como leídos ${scope} (${unreadCount} sin leer)`;
    readAllBtn.setAttribute('aria-label', readAllBtn.title);
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
            className: `chat-thread-item${active ? ' active' : ''}${t.unread ? ' unread' : ''}`,
            title: t.name,
            attrs: { 'aria-current': active ? 'true' : null },
            onClick: () => openThread(t, { read: true }),
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
          t.unread && h('span', { className: 'unread-dot', attrs: { 'aria-label': 'Sin leer' } }),
        );
        return h('li', {}, btn);
      }),
    );
  }

  // En mobile la clase thread-open cambia la lista por la conversación (ver styles.css)
  function setActive(id) {
    activeId = id;
    el.classList.toggle('thread-open', Boolean(id));
    if (!id) showThreads(false); // la lista compacta es de la conversación que se cierra
  }

  // read: lo abrió la persona (tocándolo, o con "Mensaje" desde un perfil), así que queda leído. Cuando lo abre
  // la app sola (el más reciente al entrar, o el que estaba abierto al volver de otra vista) no se marca.
  function openThread(t, { read = false } = {}) {
    setActive(t.id);
    lastThread = t;
    renderThreads(); // el punto de "sin leer" lo saca la conversación cuando MeWe lo marca (onUnreadChange)
    conversation.open(account, t, { read });
  }

  // Marca como leídos todos los chats de la lista que se está viendo (todos, personas o grupos, según el filtro).
  // MeWe no tiene un pedido para todos juntos: se marcan de a uno.
  async function markAllRead() {
    const pending = threads.filter((t) => t.unread);
    if (!pending.length || readAllBtn.disabled) return;
    const gen = generation;
    const accountId = account.id;
    readAllBtn.disabled = true;
    clearError(errorEl);
    try {
      for (const t of pending) {
        // el chat abierto lo marca la conversación, que es la que sabe su estado
        if (t.id === conversation.threadId) await conversation.markRead();
        else await api.markChatRead(accountId, t.id);
        if (gen !== generation) return; // cambió la cuenta o se salió de los chats
        t.unread = t.id === conversation.threadId && conversation.unread; // (si falló, la conversación ya mostró el error)
        renderThreads();
      }
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe chat');
    } finally {
      readAllBtn.disabled = false;
      renderThreads();
    }
  }

  function closeThread() {
    setActive(null);
    lastThread = null;
    conversation.close();
  }

  function stop() {
    clearInterval(threadsTimer);
    clearTimeout(refreshTimer);
    threadsTimer = refreshTimer = null;
  }

  return {
    el,
    toolbar: { center: filterEl, right: toolbarRight },
    // params.thread: chat a abrir (botón "Mensaje" de un perfil o de una lista de personas)
    show(newAccount, params = {}) {
      stop();
      generation++;
      visible = true;
      const sameAccount = Boolean(newAccount) && account?.id === newAccount.id;
      const wanted = newAccount && params.thread?.id ? params.thread : null;
      // misma cuenta que antes (se vuelve de otra vista): se conserva la lista y se reabre el chat
      const reopen = wanted ?? (sameAccount ? lastThread : null);
      account = newAccount;
      extraThread = wanted;
      if (!sameAccount || !reopen) {
        threads = [];
        lastThread = null;
      }
      // el chat pedido tiene que entrar en el filtro activo
      if (wanted && filter !== 'all' && (filter === 'groups') !== Boolean(wanted.isGroup)) filter = wanted.isGroup ? 'groups' : 'users';
      setActive(null);
      readAllBtn.hidden = !threads.some((t) => t.unread);
      clearError(errorEl);
      renderFilter();
      conversation.close();
      if (!account) {
        threadsEl.replaceChildren();
        return;
      }
      renderLive();
      if (reopen) openThread(reopen, { read: Boolean(wanted) });
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
    // "Atrás" del sistema: en mobile, de la conversación se vuelve a la lista de chats
    back() {
      if (!isMobile() || !activeId) return false;
      closeThread();
      return true;
    },
  };
}
