import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { formatDateTime, formatDay, formatFull } from '../ui/dates.js';
import { emptyState, h } from '../ui/dom.js';
import { closePopover, openPopover } from '../ui/popover.js';
import { createPostList } from '../ui/postList.js';
import { createTabs } from '../ui/tabs.js';
import { userName } from '../ui/userName.js';

const SEARCH_DEBOUNCE_MS = 300;

// Ruta 'group': { groupId, tab? } → cabecera (unirse / salir / invitar / chat) y pestañas
// Publicaciones, Miembros (con filtro de admins) y Eventos (cada uno con su chat).
export function createGroupView({ navigate }) {
  const errorEl = h('div');
  const headerEl = h('section', { className: 'card profile-head' });
  const tabs = createTabs({
    label: 'Contenido del grupo',
    tabs: [
      ['posts', 'Publicaciones'],
      ['members', 'Miembros'],
      ['events', 'Eventos'],
    ],
    onChange: showTab,
  });
  const noticeEl = h('section', { className: 'card private-notice', hidden: true });
  const posts = createPostList({
    navigate,
    fetchPage: (account, nextPage) => api.getGroupFeed(account.id, group.id, nextPage),
    emptyText: 'Este grupo todavía no tiene publicaciones.',
    onError: (err) => err?.details?.status === 403 && showNotice(),
  });

  // Miembros
  const memberFilter = createTabs({
    label: 'Filtro de miembros',
    tabs: [
      ['all', 'Todos'],
      ['admins', 'Admins'],
    ],
    onChange: () => loadMembers(),
  });
  const membersList = h('ul', { className: 'people-list card' });
  const membersMore = h('button', { className: 'btn load-more', hidden: true, onClick: () => loadMembers(true) }, 'Cargar más');
  const membersError = h('div');
  const membersEl = h('div', { hidden: true }, h('div', { className: 'tabs-bar' }, memberFilter.el), membersError, membersList, membersMore);

  // Eventos
  const eventFilter = createTabs({
    label: 'Filtro de eventos',
    tabs: [
      ['upcoming', 'Próximos'],
      ['past', 'Pasados'],
    ],
    onChange: () => loadEvents(),
  });
  const eventsList = h('div', { className: 'feed' });
  const eventsError = h('div');
  const eventsEl = h('div', { hidden: true }, h('div', { className: 'tabs-bar' }, eventFilter.el), eventsError, eventsList);

  const contentEl = h('div', { hidden: true }, h('div', { className: 'tabs-bar' }, tabs.el), posts.el, membersEl, eventsEl);
  const el = h('div', { className: 'view scroll page' }, errorEl, headerEl, noticeEl, contentEl);

  let account = null;
  let group = null;
  let members = [];
  let generation = 0; // descarta respuestas de otro grupo u otra cuenta
  let last = null;
  const loaded = new Set(); // pestañas ya cargadas para este grupo

  async function show(newAccount, params = {}) {
    const gen = ++generation;
    last = params;
    account = newAccount;
    group = null;
    members = [];
    loaded.clear();
    closePopover();
    clearError(errorEl);
    posts.reset();
    noticeEl.hidden = true;
    contentEl.hidden = true;
    headerEl.replaceChildren(emptyState('Cargando…'));
    if (!account || !params.groupId) {
      headerEl.replaceChildren(emptyState('Grupo no encontrado.'));
      return;
    }
    try {
      const data = await api.getGroup(account.id, params.groupId);
      if (gen !== generation) return;
      group = { ...data, id: data.id ?? params.groupId };
      renderHeader();
      contentEl.hidden = false;
      tabs.select(params.tab ?? 'posts');
      showTab(tabs.value);
    } catch (err) {
      if (gen !== generation) return;
      headerEl.replaceChildren();
      showError(errorEl, err, 'MeWe grupo');
    }
  }

  // El contenido de un grupo sólo lo ven sus miembros
  function showNotice() {
    contentEl.hidden = true;
    noticeEl.hidden = false;
    noticeEl.replaceChildren(
      h('strong', {}, '🔒 Contenido sólo para miembros'),
      h('p', {}, group.isInvited ? 'Tienes una invitación: acéptala con el botón "Unirse".' : 'Únete al grupo para ver sus publicaciones, miembros y eventos.'),
    );
    return true;
  }

  // --- Cabecera ---

  function renderHeader() {
    const g = group;
    const actions = [];
    if (g.isMember) {
      actions.push(
        h('button', { className: 'btn', onClick: () => navigate('thread', { thread: { id: g.id, name: g.name, isGroup: true } }) }, '💬 Chat'),
        h('button', { className: 'btn', attrs: { 'aria-haspopup': 'dialog' }, onClick: (event) => openInvite(event.currentTarget) }, 'Invitar'),
        h('button', { className: 'btn danger', onClick: (event) => leave(event.currentTarget) }, 'Salir'),
      );
    } else if (g.alreadyApplied) {
      actions.push(h('span', { className: 'status' }, 'Solicitud pendiente de aprobación'));
    } else {
      actions.push(h('button', { className: 'btn primary', onClick: (event) => join(event.currentTarget) }, g.isInvited ? 'Aceptar invitación' : 'Unirse'));
    }
    const parts = [
      g.cover && h('img', { className: 'cover', src: imageUrl(account.id, g.cover), alt: '' }),
      h(
        'div',
        { className: 'profile-main' },
        avatar(account.id, g.avatar, { name: g.name, size: 'xl' }),
        h(
          'div',
          { className: 'profile-id' },
          userName(g.name, { tag: 'h2', className: 'profile-name', fallback: 'Grupo' }),
          g.membersCount != null && h('span', { className: 'person-meta' }, `${g.membersCount} miembros`),
          h(
            'div',
            { className: 'badges' },
            h('span', { className: 'badge' }, g.isPublic ? 'Público' : '🔒 Privado'),
            g.role && h('span', { className: 'badge' }, roleLabel(g.role)),
            g.isInvited && h('span', { className: 'badge accent' }, 'Te invitaron'),
          ),
        ),
        h('div', { className: 'profile-actions' }, actions),
      ),
      g.description && h('p', { className: 'profile-bio', attrs: { dir: 'auto' } }, g.description),
    ];
    headerEl.replaceChildren(...parts.filter(Boolean));
  }

  function join(button) {
    return membership(button, () => api.joinGroup(account.id, group.id));
  }

  function leave(button) {
    if (!confirm(`¿Salir del grupo ${group.name}?`)) return;
    membership(button, () => api.leaveGroup(account.id, group.id));
  }

  // Ejecuta unirse / salir y recarga el grupo para reflejar el estado real
  async function membership(button, run) {
    const gen = generation;
    button.disabled = true;
    clearError(errorEl);
    try {
      await run();
      if (gen === generation) await show(account, last); // si cambió la cuenta o el grupo, no se pisa la vista nueva
    } catch (err) {
      if (gen !== generation) return;
      button.disabled = false;
      showError(errorEl, err, 'MeWe grupo');
    }
  }

  // --- Invitar: buscador de contactos en un popover ---

  function openInvite(anchor) {
    const groupId = group.id;
    const selected = new Map(); // userId → nombre
    const input = h('input', { type: 'search', className: 'input', placeholder: 'Buscar contactos…', attrs: { 'aria-label': 'Buscar contactos' } });
    const results = h('ul', { className: 'people-list invite-results' });
    const status = h('p', { className: 'status', attrs: { 'aria-live': 'polite' } });
    const sendBtn = h('button', { className: 'btn primary', disabled: true }, 'Invitar');
    const content = h('div', { className: 'invite-box' }, h('strong', {}, `Invitar a ${group.name}`), input, results, status, sendBtn);
    openPopover(anchor, content, { className: 'invite-popover', label: 'Invitar al grupo' });
    let timer = null;
    let searchId = 0;

    const updateSend = () => {
      sendBtn.disabled = !selected.size;
      sendBtn.textContent = selected.size ? `Invitar (${selected.size})` : 'Invitar';
    };

    async function search() {
      const current = ++searchId;
      status.textContent = 'Buscando…';
      try {
        const contacts = await api.searchGroupContacts(account.id, groupId, input.value.trim());
        if (current !== searchId) return;
        status.textContent = contacts.length ? '' : 'Sin resultados.';
        results.replaceChildren(
          ...contacts.map((user) => {
            const checkbox = h('input', {
              type: 'checkbox',
              checked: selected.has(user.id),
              onChange: () => {
                if (checkbox.checked) selected.set(user.id, user.name);
                else selected.delete(user.id);
                updateSend();
              },
            });
            return h(
              'li',
              {},
              h('label', { className: 'person' }, checkbox, avatar(account.id, user.avatar, { name: user.name, size: 'sm' }), userName(user.name, { className: 'person-name' })),
            );
          }),
        );
      } catch (err) {
        if (current === searchId) status.textContent = `No se pudo buscar: ${err.message}`;
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, SEARCH_DEBOUNCE_MS);
    });
    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      status.textContent = 'Enviando invitaciones…';
      try {
        await api.inviteToGroup(account.id, groupId, [...selected.keys()]);
        status.textContent = `Invitación enviada a ${[...selected.values()].join(', ')}.`;
        selected.clear();
        for (const box of results.querySelectorAll('input[type=checkbox]')) box.checked = false;
        updateSend();
      } catch (err) {
        status.textContent = `No se pudo invitar: ${err.message}`;
        updateSend();
      }
    });
    input.focus();
    search();
  }

  // --- Pestañas ---

  function showTab(tab) {
    posts.el.hidden = tab !== 'posts';
    membersEl.hidden = tab !== 'members';
    eventsEl.hidden = tab !== 'events';
    if (loaded.has(tab)) return;
    loaded.add(tab);
    if (tab === 'posts') posts.load(account);
    else if (tab === 'members') loadMembers();
    else loadEvents();
  }

  async function loadMembers(append = false) {
    const gen = generation;
    const adminsOnly = memberFilter.value === 'admins';
    membersMore.disabled = true;
    clearError(membersError);
    if (!append) {
      members = [];
      membersMore.hidden = true;
      membersList.replaceChildren(emptyState('Cargando…', 'li'));
    }
    try {
      const page = await api.getGroupMembers(account.id, group.id, { offset: members.length, adminsOnly });
      if (gen !== generation || adminsOnly !== (memberFilter.value === 'admins')) return;
      const known = new Set(members.map((m) => m.id));
      // el grupo dice quiénes son dueño y admins: vale aunque la lista de miembros no traiga el rol
      const staff = new Set([group.ownerId, ...group.adminIds]);
      const withRoles = page.members.map((m) => ({
        ...m,
        isAdmin: m.isAdmin || staff.has(m.id),
        role: m.id === group.ownerId ? 'owner' : m.role || (staff.has(m.id) ? 'admin' : null),
      }));
      // por si MeWe ignora el filtro del servidor, se filtra también acá
      const fresh = withRoles.filter((m) => !known.has(m.id) && (!adminsOnly || m.isAdmin));
      members = [...members, ...fresh];
      membersMore.hidden = !page.hasMore || !fresh.length;
      renderMembers();
    } catch (err) {
      if (gen !== generation) return;
      if (!append) membersList.replaceChildren();
      if (err?.details?.status === 403) showNotice();
      else showError(membersError, err, 'MeWe miembros');
    } finally {
      membersMore.disabled = false;
    }
  }

  function renderMembers() {
    if (!members.length) {
      membersList.replaceChildren(emptyState('No hay miembros para mostrar.', 'li'));
      return;
    }
    membersList.replaceChildren(
      ...members.map((member) =>
        h(
          'li',
          { className: 'person' },
          h(
            'button',
            { className: 'person-main link-btn', onClick: () => navigate('profile', { userId: member.id }) },
            avatar(account.id, member.avatar, { name: member.name, size: 'sm' }),
            h(
              'span',
              { className: 'person-info' },
              userName(member.name, { className: 'person-name' }),
              member.handle && h('span', { className: 'person-meta' }, `@${member.handle}`),
            ),
          ),
          member.isAdmin && h('span', { className: 'badge accent' }, roleLabel(member.role)),
          member.pending && h('span', { className: 'badge' }, 'Invitado'),
        ),
      ),
    );
  }

  async function loadEvents() {
    const gen = generation;
    const when = eventFilter.value;
    clearError(eventsError);
    eventsList.replaceChildren(emptyState('Cargando…'));
    try {
      const events = await api.getGroupEvents(account.id, group.id, when);
      if (gen !== generation || when !== eventFilter.value) return;
      eventsList.replaceChildren(
        ...(events.length ? events.map(renderEvent) : [emptyState(when === 'past' ? 'No hay eventos pasados.' : 'No hay eventos próximos.')]),
      );
    } catch (err) {
      if (gen !== generation) return;
      eventsList.replaceChildren();
      if (err?.details?.status === 403) showNotice();
      else showError(eventsError, err, 'MeWe eventos');
    }
  }

  function renderEvent(event) {
    const date = event.startsAt ? (event.allDay ? formatDay(event.startsAt) : formatDateTime(event.startsAt)) : 'Sin fecha';
    return h(
      'article',
      { className: 'post event' },
      h(
        'div',
        { className: 'post-head' },
        h('span', { className: 'event-icon', attrs: { 'aria-hidden': 'true' } }, '📅'),
        userName(event.name, { className: 'post-author', fallback: 'Evento' }),
        h('time', { className: 'post-date', title: event.startsAt ? formatFull(event.startsAt) : '' }, date),
      ),
      event.location && h('p', { className: 'person-meta', attrs: { dir: 'auto' } }, `📍 ${event.location}`),
      event.description && h('p', { className: 'post-text', attrs: { dir: 'auto' } }, event.description),
      h(
        'div',
        { className: 'post-footer' },
        event.hasChat &&
          h(
            'button',
            { className: 'btn', onClick: () => navigate('thread', { thread: { id: event.id, name: event.name, isGroup: true, chatType: 'EventChat' } }) },
            '💬 Chat del evento',
          ),
      ),
    );
  }

  return {
    el,
    show,
    hide() {
      generation++;
      posts.reset();
      closePopover();
    },
    reload() {
      if (last) show(account, last);
    },
  };
}

function roleLabel(role) {
  if (/owner/i.test(role)) return 'Dueño';
  if (/admin/i.test(role)) return 'Admin';
  if (/moderator/i.test(role)) return 'Moderador';
  return role;
}
