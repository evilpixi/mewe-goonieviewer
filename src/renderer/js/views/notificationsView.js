import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { formatDateTime, formatFull } from '../ui/dates.js';
import { emptyState, h } from '../ui/dom.js';
import { createFollowRequests } from '../ui/followRequests.js';
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

// Ruta 'notifications': lista separada en Generales y Grupos, con las solicitudes de seguimiento arriba.
// onUnseenChange(count) avisa a la cabecera para actualizar el contador de la campana.
export function createNotificationsView({ navigate, onUnseenChange }) {
  const tabs = createTabs({
    label: 'Tipo de notificación',
    tabs: [
      ['general', 'Generales'],
      ['groups', 'Grupos'],
    ],
    onChange: () => render(),
  });
  const markAllBtn = h('button', { className: 'btn', onClick: markAll }, 'Marcar todas como leídas');
  const toolbar = h('div', { className: 'view-toolbar-group' }, tabs.el, markAllBtn);
  const errorEl = h('div');
  const requests = createFollowRequests({ navigate });
  const listEl = h('ul', { className: 'notif-list card', attrs: { 'aria-label': 'Notificaciones' } });
  const moreBtn = h('button', { className: 'btn load-more', hidden: true, onClick: () => load(true) }, 'Cargar más');
  const el = h('div', { className: 'view scroll page' }, errorEl, requests.el, listEl, moreBtn);

  let account = null;
  let items = [];
  let nextPage = null;
  let generation = 0;

  async function load(append = false) {
    const gen = append ? generation : ++generation;
    moreBtn.disabled = true;
    clearError(errorEl);
    if (!append) listEl.replaceChildren(emptyState('Cargando…', 'li'));
    try {
      const page = await api.getNotifications(account.id, append ? nextPage : undefined);
      if (gen !== generation) return;
      const known = new Set(append ? items.map((n) => n.id) : []);
      items = append ? [...items, ...page.notifications.filter((n) => !known.has(n.id))] : page.notifications;
      nextPage = page.nextPage;
      render();
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
    tabs.setLabel('general', unread(false) ? `Generales (${unread(false)})` : 'Generales');
    tabs.setLabel('groups', unread(true) ? `Grupos (${unread(true)})` : 'Grupos');
    markAllBtn.disabled = !items.some((n) => n.unread);
    moreBtn.hidden = !nextPage;
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
        n.snippet && h('span', { className: 'notif-snippet', attrs: { dir: 'auto' } }, n.snippet),
        h(
          'span',
          { className: 'notif-meta' },
          n.inGroup && h('span', {}, `👥 ${n.group.name} · `),
          n.createdAt && h('time', { title: formatFull(n.createdAt) }, formatDateTime(n.createdAt)),
        ),
      ),
      n.unread && h('span', { className: 'unread-dot', attrs: { 'aria-label': 'Sin leer' } }),
    );
    return h('li', {}, btn);
  }

  function open(n, destination) {
    if (n.unread) {
      n.unread = false;
      api.markNotificationVisited(account.id, n.id).catch((err) => console.warn('[notificaciones]', err));
    }
    if (destination) navigate(...destination);
    else render();
  }

  async function markAll() {
    markAllBtn.disabled = true;
    try {
      await api.markNotificationVisited(account.id);
      for (const n of items) n.unread = false;
      onUnseenChange?.(0);
    } catch (err) {
      showError(errorEl, err, 'MeWe notificaciones');
    }
    render();
  }

  return {
    el,
    toolbar,
    show(newAccount) {
      account = newAccount;
      items = [];
      nextPage = null;
      requests.load(account);
      if (account) load();
      else listEl.replaceChildren();
    },
    hide() {
      generation++;
    },
    reload() {
      if (!account) return;
      requests.load(account);
      load();
    },
  };
}
