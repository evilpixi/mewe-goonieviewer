import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { formatDateTime, formatFull } from '../ui/dates.js';
import { emptyState, h } from '../ui/dom.js';
import { icon } from '../ui/icon.js';
import { followButton } from '../ui/followRequests.js';
import { plainText } from '../ui/richText.js';
import { createTabs } from '../ui/tabs.js';
import { userName } from '../ui/userName.js';

// Tipos de notificación de MeWe (notificationType) agrupados por a dónde llevan
const FOLLOW_TYPES = new Set([
  'new_follower',
  'new_follow_request',
  'follow_request_accepted',
  'invitation_accepted',
  'contact_auto_added',
  'contactSuggestion',
  'group_invitee_registered',
  'contact_birthday',
]);
const GROUP_TYPES = new Set([
  'group_invitation',
  'group_application_invitation',
  'group_application_approved',
  'group_application_request',
  'group_ownership_transferred',
  'group_admin_rights_granted',
  'group_public_directory_removed',
  'added_to_group',
]);
const EVENT_TYPES = new Set(['event_invitation', 'event_reminder', 'event_updated', 'event_attendance', 'event_deleted']);
// Avisos del sistema: no los protagoniza una persona
const SYSTEM_TYPES = new Set([
  'group_admin_rights_granted',
  'group_public_directory_removed',
  'event_reminder',
  'event_updated',
  'event_deleted',
]);

// Qué hizo la persona, sin el nombre (que se muestra aparte)
function actionText(n) {
  const group = n.group?.name;
  const event = n.event?.name;
  switch (n.type) {
    case 'new_follower':
      return 'empezó a seguirte';
    case 'new_follow_request':
      return 'quiere seguirte';
    case 'follow_request_accepted':
      return 'aceptó tu solicitud de seguimiento';
    case 'invitation_accepted':
    case 'contact_auto_added':
      return 'aceptó tu invitación';
    case 'contactSuggestion':
      return 'es una persona que quizás conozcas';
    case 'group_invitee_registered':
      return 'ya está en MeWe';
    case 'contact_birthday':
      return 'cumple años';
    case 'emojis':
      return `reaccionó ${n.emojis.join(' ')} a ${n.threadId ? 'tu mensaje' : n.commentId ? 'tu comentario' : 'tu publicación'}`.replace('  ', ' ');
    case 'comment':
    case 'limited_comment':
      return n.usersCount > 1 ? 'comentaron tu publicación' : 'comentó tu publicación';
    case 'mention': {
      const who = n.everyone ? 'mencionó a @todos' : 'te mencionó';
      if (n.commentId) return `${who} en un comentario`;
      if (n.threadId) return n.inGroup ? `${who} en el chat de ${group}` : `${who} en un chat`;
      return `${who} en una publicación`;
    }
    case 'post':
    case 'limited_post':
    case 'limited_post_edit':
      return `publicó en ${event ?? group ?? 'un grupo'}`;
    case 'poll_vote':
      return 'respondió tu encuesta';
    case 'poll_ended':
      return 'terminó una encuesta: mira los resultados';
    case 'group_invitation':
      return `te invitó al grupo ${group ?? ''}`;
    case 'group_application_invitation':
      return `te invitó a pedir el ingreso al grupo ${group ?? ''}`;
    case 'group_application_approved':
      return `aprobó tu ingreso al grupo ${group ?? ''}`;
    case 'group_application_request':
      return `pidió entrar al grupo ${group ?? ''}`;
    case 'group_ownership_transferred':
      return `te transfirió el grupo ${group ?? ''}`;
    case 'group_admin_rights_granted':
      return `Ahora eres admin de ${group ?? 'un grupo'}`;
    case 'group_public_directory_removed':
      return `El grupo ${group ?? ''} se quitó del directorio por falta de actividad`;
    case 'added_to_group':
      return `te agregó al grupo ${group ?? ''}`;
    case 'event_invitation':
      return `te invitó al evento ${event ?? ''}`;
    case 'event_reminder':
      return `El evento ${event ?? ''} está por empezar`;
    case 'event_updated':
      return `Se actualizó el evento ${event ?? ''}`;
    case 'event_deleted':
      return `Se canceló el evento ${event ?? ''}`;
    case 'event_attendance':
      return `va a tu evento ${event ?? ''}`;
    default:
      if (n.title) return n.title;
      return n.users.length ? 'generó una notificación' : 'Notificación de MeWe';
  }
}

// A qué vista lleva una notificación: [vista, params] o null si no hay a dónde ir
function target(n) {
  const user = n.users[0];
  if (FOLLOW_TYPES.has(n.type)) return user?.id ? ['profile', { userId: user.id }] : null;
  // menciones y reacciones dentro de un chat: al mensaje
  if (n.threadId && (n.type === 'mention' || n.type === 'emojis')) {
    const thread = { id: n.threadId, name: n.inGroup ? n.group.name : (user?.name ?? 'Chat'), isGroup: n.inGroup };
    return ['thread', { thread, messageId: n.messageId }];
  }
  if (GROUP_TYPES.has(n.type)) {
    if (!n.group?.id) return null;
    return ['group', { groupId: n.group.id, tab: n.type === 'group_application_request' ? 'members' : undefined }];
  }
  if (EVENT_TYPES.has(n.type)) {
    const groupId = n.event?.groupId ?? n.group?.id;
    return groupId ? ['group', { groupId, tab: 'events' }] : null;
  }
  // reacciones, comentarios, menciones y publicaciones: al post (con el comentario resaltado si lo hay)
  if (n.postId) return ['post', { postId: n.postId, groupId: n.inGroup ? n.group.id : undefined, commentId: n.commentId ?? undefined }];
  if (n.group?.id) return ['group', { groupId: n.group.id }];
  return user?.id ? ['profile', { userId: user.id }] : null;
}

// MeWe a veces manda la misma notificación más de una vez, con ids distintos: misma persona, mismo tipo
// y mismo destino. Se muestran como una sola (la más nueva) y se marcan leídas todas juntas.
function groupKey(n) {
  return [n.type, n.users[0]?.id, n.postId, n.commentId, n.threadId, n.messageId, n.group?.id, n.event?.id].map((part) => part ?? '').join('|');
}

// Ruta 'notifications': lista separada en Generales y Grupos. Las solicitudes de seguimiento se responden
// desde su notificación (la lista completa está en el perfil propio, pestaña Solicitudes).
// onUnseenChange(count) avisa a la cabecera para actualizar el contador de la campana.
export function createNotificationsView({ navigate, onUnseenChange }) {
  const tabs = createTabs({
    label: 'Tipo de notificación',
    tabs: [
      ['general', 'Generales', 'bell'],
      ['groups', 'Grupos', 'users-round'],
    ],
    onChange: () => render(),
  });
  const markAllIcon = icon('check-check');
  markAllIcon.classList.add('label-icon');
  const markAllBtn = h(
    'button',
    { className: 'btn', title: 'Marcar todas como leídas', onClick: markAll },
    markAllIcon,
    h('span', { className: 'label-text' }, 'Marcar todas como leídas'),
  );
  const errorEl = h('div');
  const listEl = h('ul', { className: 'notif-list card', attrs: { 'aria-label': 'Notificaciones' } });
  const moreBtn = h('button', { className: 'btn load-more', hidden: true, onClick: () => load(true) }, 'Cargar más');
  const el = h('div', { className: 'view scroll page' }, errorEl, listEl, moreBtn);

  let account = null;
  let items = []; // una por grupo de duplicadas; `ids` son los ids de todas las del grupo
  let nextPage = null;
  let generation = 0;
  let pending = new Map(); // userId → id de su solicitud de seguimiento sin responder
  const rejected = new Set(); // userId de las solicitudes rechazadas desde acá
  const followResults = new Map(); // userId → resultado de "Seguir" (ver followButton)
  // Las notificaciones no dicen si ya seguimos a quien nos sigue: se pregunta su perfil (ver loadRelations)
  const relations = new Map(); // userId → { following, requestSent, isPublic } · null mientras se pide
  let waiting = new Map(); // userId → funciones que completan las filas dibujadas antes de saberlo
  // ids ya marcados como leídos desde acá: una recarga (llega un evento en tiempo real) puede traer la lista
  // de antes de que MeWe los registre, y no tiene que volver a mostrarlos sin leer
  const visited = new Set();

  // Junta las duplicadas y aplica lo que ya se marcó como leído
  function merge(list) {
    const byKey = new Map();
    for (const n of list) {
      const key = groupKey(n);
      const ids = n.ids ?? [n.id];
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...n, ids: [...ids] });
        continue;
      }
      const newest = (n.createdAt ?? 0) > (prev.createdAt ?? 0) ? n : prev;
      byKey.set(key, { ...newest, ids: [...new Set([...prev.ids, ...ids])], unread: prev.unread || n.unread });
    }
    return [...byKey.values()]
      .map((n) => ({ ...n, unread: n.unread && !n.ids.every((id) => visited.has(id)) }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  async function load(append = false) {
    const gen = append ? generation : ++generation;
    moreBtn.disabled = true;
    clearError(errorEl);
    if (!append) listEl.replaceChildren(emptyState('Cargando…', 'li'));
    try {
      const page = await api.getNotifications(account.id, append ? nextPage : undefined);
      if (gen !== generation) return;
      items = merge(append ? [...items, ...page.notifications] : page.notifications);
      nextPage = page.nextPage;
      render();
      loadRelations();
      if (!append) {
        // abrir la lista cuenta como "vistas": el contador de la campana vuelve a 0
        api.markNotificationsSeen(account.id).then(() => onUnseenChange?.(0), (err) => console.warn('[notificaciones]', err));
      }
    } catch (err) {
      if (gen !== generation) return;
      if (!append) listEl.replaceChildren();
      showError(errorEl, err, 'MeWe notificaciones');
    } finally {
      moreBtn.disabled = false;
    }
  }

  function render() {
    const inGroups = tabs.value === 'groups';
    const shown = items.filter((n) => n.inGroup === inGroups);
    const unread = (group) => items.filter((n) => n.inGroup === group && n.unread).length;
    tabs.setCount('general', unread(false));
    tabs.setCount('groups', unread(true));
    markAllBtn.disabled = !items.some((n) => n.unread);
    moreBtn.hidden = !nextPage;
    waiting = new Map(); // las filas se dibujan de nuevo
    if (!shown.length) {
      listEl.replaceChildren(emptyState(inGroups ? 'No hay notificaciones de grupos.' : 'No hay notificaciones.', 'li'));
      return;
    }
    listEl.replaceChildren(...shown.map(renderItem));
  }

  function renderItem(n) {
    const user = n.users[0];
    const others = n.usersCount - 1;
    const destination = target(n);
    const systemText = !user || Boolean(n.title) || SYSTEM_TYPES.has(n.type); // el texto ya es una frase completa
    const btn = h(
      'button',
      {
        className: `notif${n.unread ? ' unread' : ''}`,
        disabled: !destination && !n.unread,
        onClick: () => open(n, destination),
      },
      avatar(account.id, user?.avatar, { name: user?.name ?? 'MeWe', size: 'md' }),
      h(
        'span',
        { className: 'notif-body' },
        h(
          'span',
          { className: 'notif-text' },
          !systemText && userName(user.name, { className: 'notif-user' }),
          !systemText && others > 0 && ` y ${others} más`,
          ' ',
          actionText(n),
        ),
        n.snippet && h('span', { className: 'notif-snippet', attrs: { dir: 'auto' } }, plainText(n.snippet)),
        h(
          'span',
          { className: 'notif-meta' },
          n.inGroup && h('span', {}, `👥 ${n.group.name} · `),
          n.createdAt && h('time', { title: formatFull(n.createdAt) }, formatDateTime(n.createdAt)),
        ),
      ),
      n.unread && h('span', { className: 'unread-dot', attrs: { 'aria-label': 'Sin leer' } }),
    );
    const actions = user?.id && !others ? followActions(n, user) : [];
    return h('li', { className: 'notif-row' }, btn, actions.length > 0 && h('div', { className: 'notif-actions' }, actions));
  }

  // Acciones de seguimiento sin salir de la lista: aceptar / rechazar la solicitud y seguir a quien nos sigue
  function followActions(n, user) {
    const acc = account;
    const onError = (err) => showError(errorEl, err, 'MeWe seguimiento');
    // Seguir desde la notificación también la deja leída. No se redibuja la lista (el botón está trabajando):
    // sólo se le quita la marca a la fila.
    const follow = () => {
      const relation = relations.get(user.id);
      if (!followResults.has(user.id)) {
        if (!relation) {
          // todavía no se sabe si ya lo seguimos: queda un hueco que se completa al saberlo
          const slot = h('span', { hidden: true });
          if (!waiting.has(user.id)) waiting.set(user.id, []);
          waiting.get(user.id).push(() => {
            const box = slot.parentElement;
            slot.replaceWith(...[follow()].filter(Boolean));
            if (box && !box.childElementCount) box.remove();
          });
          return slot;
        }
        if (relation.following) return null; // ya lo seguimos: no hay nada que ofrecer
        if (relation.requestSent) return h('span', { className: 'status' }, 'Solicitud enviada');
      }
      const button = followButton({ account: acc, user: { ...user, isPublic: relation?.isPublic ?? user.isPublic }, results: followResults, onError });
      if (button.tagName !== 'BUTTON') return button; // ya se lo sigue: es sólo el texto
      button.addEventListener('click', () => {
        markVisited(n);
        const row = button.closest('.notif-row');
        row?.querySelector('.notif')?.classList.remove('unread');
        row?.querySelector('.unread-dot')?.remove();
      });
      return button;
    };
    if (n.type === 'new_follower') return [follow()].filter(Boolean);
    if (n.type !== 'new_follow_request' || rejected.has(user.id)) return [];
    const requestId = pending.get(user.id);
    if (!requestId) return [follow()].filter(Boolean); // ya respondida: queda seguirlo también
    const answer = async (accept, button) => {
      const buttons = [...button.parentElement.querySelectorAll('.btn')];
      for (const btn of buttons) btn.disabled = true;
      clearError(errorEl);
      try {
        await api.answerFollowRequest(acc.id, requestId, accept);
        if (acc !== account) return;
        pending.delete(user.id);
        if (!accept) rejected.add(user.id);
        await markVisited(n); // responderla es haberla leído
        render();
      } catch (err) {
        for (const btn of buttons) btn.disabled = false;
        onError(err);
      }
    };
    return [
      h('button', { className: 'btn primary', onClick: (event) => answer(true, event.currentTarget) }, 'Aceptar'),
      h('button', { className: 'btn', onClick: (event) => answer(false, event.currentTarget) }, 'Rechazar'),
    ];
  }

  // Pregunta, de a pocas a la vez, si ya seguimos a cada persona de las notificaciones de seguimiento.
  // Si un perfil no se puede pedir se ofrece "Seguir" igual (el botón vuelve a consultarlo al usarlo).
  async function loadRelations() {
    const acc = account;
    const ids = items
      .filter((n) => (n.type === 'new_follower' || n.type === 'new_follow_request') && n.usersCount <= 1 && n.users[0]?.id)
      .map((n) => n.users[0].id)
      .filter((id) => !relations.has(id));
    const queue = [...new Set(ids)];
    for (const id of queue) relations.set(id, null);
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        let relation = { following: false, requestSent: null, isPublic: undefined };
        try {
          const profile = await api.getProfile(acc.id, id);
          relation = { following: profile.following, requestSent: profile.requestSent, isPublic: profile.isPublic };
        } catch (err) {
          console.warn('[notificaciones] perfil', err);
        }
        if (acc !== account) return;
        relations.set(id, relation);
        const fills = waiting.get(id) ?? [];
        waiting.delete(id);
        for (const fill of fills) fill();
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }

  // Las notificaciones no traen el id de la solicitud: sale de la lista de solicitudes recibidas
  async function loadRequests() {
    const acc = account;
    if (!acc) return;
    try {
      const list = await api.getFollowRequests(acc.id);
      if (acc !== account) return;
      pending = new Map(list.filter((r) => r.requestId && r.user.id).map((r) => [r.user.id, r.requestId]));
      if (items.length) render();
    } catch (err) {
      console.warn('[solicitudes]', err); // sin ellas las notificaciones se ven igual, sin Aceptar / Rechazar
    }
  }

  // Marca leída una notificación (con sus duplicadas). Si MeWe falla vuelve a quedar sin leer y se muestra el error.
  async function markVisited(n) {
    if (!n.unread) return;
    const acc = account;
    const ids = n.ids.filter((id) => !visited.has(id));
    n.unread = false;
    for (const id of ids) visited.add(id);
    try {
      await Promise.all(ids.map((id) => api.markNotificationVisited(acc.id, id)));
    } catch (err) {
      for (const id of ids) visited.delete(id);
      if (acc !== account) return;
      n.unread = true;
      showError(errorEl, err, 'MeWe notificaciones');
      render();
    }
  }

  function open(n, destination) {
    markVisited(n);
    render();
    if (destination) navigate(...destination);
  }

  async function markAll() {
    markAllBtn.disabled = true;
    try {
      await api.markNotificationVisited(account.id);
      for (const n of items) {
        n.unread = false;
        for (const id of n.ids) visited.add(id);
      }
      onUnseenChange?.(0);
    } catch (err) {
      showError(errorEl, err, 'MeWe notificaciones');
    }
    render();
  }

  return {
    el,
    toolbar: { center: tabs.el, right: markAllBtn },
    show(newAccount) {
      if (newAccount?.id !== account?.id) visited.clear();
      account = newAccount;
      items = [];
      nextPage = null;
      pending = new Map();
      rejected.clear();
      followResults.clear();
      relations.clear();
      loadRequests();
      if (account) load();
      else listEl.replaceChildren();
    },
    hide() {
      generation++;
    },
    reload() {
      if (!account) return;
      loadRequests();
      load();
    },
  };
}
