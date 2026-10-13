import { api } from './api.js';
import { BADGES, getSettings, onSettingsChange } from './settings.js';

// Novedades de las cuentas que NO se están usando, para el punto de aviso sobre su foto.
// Qué cuenta como novedad lo eligen los ajustes (BADGES): por defecto, sólo los mensajes privados sin leer.
//
// Se entera sin estar preguntando: cada cuenta mantiene abierto su websocket de MeWe (el mismo del chat), que
// avisa cuando llega un mensaje o una notificación. Recién ahí se pide el estado de esa cuenta. Con el
// websocket conectado sólo queda un repaso cada tanto, por si se perdió un aviso.
// Mientras una cuenta no tiene websocket, se le pregunta a MeWe con este ritmo, que arranca de nuevo con cada
// novedad: cada 6 s durante el primer minuto, después cada 30 s y, tras 30 minutos sin novedades, cada 5 minutos.
// Con la ventana oculta no se pregunta nada: al volver se pone al día.
const FAST_MS = 6000;
const FAST_FOR_MS = 60 * 1000;
const NORMAL_MS = 30 * 1000;
const NORMAL_FOR_MS = 30 * 60 * 1000;
const SLOW_MS = 5 * 60 * 1000; // también el repaso con websocket, y el reintento después de un error
const EVENT_DEBOUNCE_MS = 1500; // varios avisos seguidos del websocket son una sola consulta
const STAGGER_MS = 700; // al arrancar, las cuentas se consultan de a una
const GROUP_EVENTS = new Set(['GroupChatMessage', 'EventChatMessage', 'DelGroupChatMessage', 'DelEventChatMessage']);

const NONE = Object.freeze({ dms: 0, groups: 0, mentions: 0 });
const total = (counts) => counts.dms + counts.groups + counts.mentions;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// "2 chats sin leer · 1 mención", o '' si no hay nada
export function describeActivity(counts = NONE) {
  return [
    counts.dms && plural(counts.dms, 'chat sin leer', 'chats sin leer'),
    counts.groups && plural(counts.groups, 'chat de grupo sin leer', 'chats de grupo sin leer'),
    counts.mentions && plural(counts.mentions, 'mención', 'menciones'),
  ]
    .filter(Boolean)
    .join(' · ');
}

// onChange(): cambió lo que hay que mostrar. Devuelve { setAccounts(lista), setActive(id), get(id) → { dms, groups, mentions }, has(id) }
export function createAccountActivity({ onChange }) {
  const states = new Map(); // accountId → estado de la cuenta
  let activeId = null;
  let wanted = badgeSettings();

  function badgeSettings() {
    const settings = getSettings();
    return Object.fromEntries(BADGES.map(([key]) => [key, settings[key]]));
  }

  const enabled = () => Object.values(wanted).some(Boolean);

  function nextDelay(state) {
    if (state.live || state.failed) return SLOW_MS;
    const quiet = Date.now() - state.newsAt;
    if (quiet < FAST_FOR_MS) return FAST_MS;
    return quiet < NORMAL_FOR_MS ? NORMAL_MS : SLOW_MS;
  }

  // Programa la próxima consulta de la cuenta (delay: en cuánto; si no, según el ritmo que le toca)
  function schedule(state, delay = nextDelay(state)) {
    clearTimeout(state.timer);
    state.timer = null;
    if (state.id === activeId || !enabled()) return;
    state.dueAt = Date.now() + delay;
    if (document.hidden) return; // se retoma al volver (ver visibilitychange)
    state.timer = setTimeout(() => check(state), delay);
  }

  function setCounts(state, counts) {
    const changed = Object.keys(NONE).some((key) => counts[key] !== state.counts[key]);
    state.counts = counts;
    if (changed) onChange();
    return changed;
  }

  const unread = (threads) => threads.filter((thread) => thread.unread).length;

  async function check(state) {
    if (states.get(state.id) !== state || state.id === activeId || !enabled()) return;
    if (document.hidden) {
      state.dueAt = Date.now(); // queda pendiente para cuando la ventana vuelva a verse
      return;
    }
    if (state.checking) {
      state.again = true; // llegó otro aviso mientras se consultaba
      return;
    }
    state.checking = true;
    clearTimeout(state.timer);
    state.timer = null;
    try {
      const counts = { ...NONE };
      if (wanted.badgeDms) counts.dms = unread(await api.getChatThreads(state.id, 'users'));
      if (wanted.badgeGroupChats) counts.groups = unread(await api.getChatThreads(state.id, 'groups'));
      if (wanted.badgeMentions) {
        // el contador es barato: la lista sólo se pide si hay notificaciones sin ver y la cantidad cambió
        const { unseenCount } = await api.getUnseenNotifications(state.id);
        if (!unseenCount) state.mentions = 0;
        else if (unseenCount !== state.unseen) {
          const { notifications } = await api.getNotifications(state.id);
          state.mentions = notifications.filter((n) => n.unread && n.type === 'mention').length;
        }
        state.unseen = unseenCount;
        counts.mentions = state.mentions;
      }
      state.failed = false;
      // la cuenta pasó a ser la activa mientras se consultaba: su aviso ya no se muestra
      if (states.get(state.id) === state && state.id !== activeId && setCounts(state, counts)) state.newsAt = Date.now();
    } catch (err) {
      state.failed = true; // p. ej. sesión vencida: se reintenta sin apuro
      console.warn('[avisos]', state.id, err);
    } finally {
      state.checking = false;
      if (states.get(state.id) === state) {
        if (state.again) schedule(state, EVENT_DEBOUNCE_MS);
        else schedule(state);
        state.again = false;
      }
    }
  }

  // El websocket avisó de algo en esa cuenta: se consulta enseguida y el ritmo vuelve a empezar
  function bump(accountId) {
    const state = states.get(accountId);
    if (!state || accountId === activeId) return;
    state.newsAt = Date.now();
    if (state.checking) state.again = true;
    else schedule(state, EVENT_DEBOUNCE_MS);
  }

  api.onChatEvent(({ accountId, type }) => {
    if (GROUP_EVENTS.has(type) ? wanted.badgeGroupChats : wanted.badgeDms || wanted.badgeGroupChats) bump(accountId);
  });
  api.onNotification(({ accountId }) => {
    if (!wanted.badgeMentions) return;
    const state = states.get(accountId);
    if (state) state.unseen = null; // la lista de notificaciones se vuelve a pedir
    bump(accountId);
  });
  api.onChatStatus(({ accountId, connected }) => {
    const state = states.get(accountId);
    if (!state || state.live === connected) return;
    state.live = connected;
    // recién conectado: una consulta, por lo que haya llegado mientras no había conexión
    schedule(state, connected ? EVENT_DEBOUNCE_MS : undefined);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    for (const state of states.values()) schedule(state, Math.max(0, (state.dueAt ?? 0) - Date.now()));
  });
  onSettingsChange(() => {
    const next = badgeSettings();
    if (BADGES.every(([key]) => next[key] === wanted[key])) return;
    wanted = next;
    let delay = 0;
    for (const state of states.values()) {
      state.unseen = null;
      if (!enabled()) setCounts(state, NONE);
      schedule(state, (delay += STAGGER_MS));
    }
  });

  return {
    setAccounts(list) {
      const ids = new Set(list.map((account) => account.id));
      for (const [id, state] of states) {
        if (ids.has(id)) continue;
        clearTimeout(state.timer);
        states.delete(id);
      }
      let delay = 0;
      for (const { id } of list) {
        if (states.has(id)) continue;
        const state = { id, counts: NONE, newsAt: Date.now(), live: false, failed: false, checking: false, again: false, timer: null, dueAt: 0, unseen: null, mentions: 0 };
        states.set(id, state);
        // el websocket de la cuenta: es por donde llegan los avisos (la conexión la mantiene src/core/realtime.js)
        api
          .startRealtime(id)
          .then(({ connected }) => {
            state.live = state.live || connected;
          })
          .catch((err) => console.warn('[avisos] tiempo real', id, err));
        schedule(state, (delay += STAGGER_MS));
      }
    },
    // La cuenta en uso no lleva aviso; la que se deja se consulta enseguida, para mostrar cómo quedó
    setActive(id) {
      if (id === activeId) return;
      const previous = states.get(activeId);
      activeId = id;
      const state = states.get(id);
      if (state) {
        clearTimeout(state.timer);
        state.timer = null;
        setCounts(state, NONE);
      }
      if (previous) {
        previous.unseen = null;
        schedule(previous, EVENT_DEBOUNCE_MS);
      }
    },
    get: (id) => states.get(id)?.counts ?? NONE,
    has: (id) => total(states.get(id)?.counts ?? NONE) > 0,
  };
}
