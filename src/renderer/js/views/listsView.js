import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { icon } from '../ui/icon.js';
import { confirmBlock, copyLinkButton, openChatWith, personRow } from '../ui/people.js';
import { createTabs } from '../ui/tabs.js';
import { userName } from '../ui/userName.js';

const LIST_KEY = 'listsTab';
const LISTS = [
  ['groups', 'Grupos', 'users-round'],
  ['following', 'Siguiendo', 'user-check'],
  ['followers', 'Seguidores', 'heart'],
];
const MAX_PAGES_PER_SEARCH = 40; // tope de páginas que se traen solas al filtrar una lista de personas

// Para comparar texto sin distinguir mayúsculas ni acentos
const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function savedList() {
  try {
    const value = localStorage.getItem(LIST_KEY);
    return LISTS.some(([id]) => id === value) ? value : 'groups';
  } catch {
    return 'groups';
  }
}

// Pestaña raíz "Listas": mis grupos (y las invitaciones pendientes), las personas que sigo y las que me siguen,
// con un filtro por nombre. Desde una persona: ver su perfil, mandarle un mensaje, copiar su link o bloquearla.
export function createListsView({ navigate }) {
  const tabs = createTabs({ label: 'Lista', tabs: LISTS, onChange: changeList });
  const search = h('input', {
    type: 'search',
    className: 'input',
    attrs: { 'aria-label': 'Filtrar la lista' },
    onInput: () => onSearch(),
  });
  const errorEl = h('div');
  const listEl = h('ul', { className: 'people-list card' });
  const moreBtn = h('button', { className: 'btn load-more', hidden: true, onClick: () => loadPeople(true) }, 'Cargar más');
  const el = h('div', { className: 'view scroll page' }, errorEl, listEl, moreBtn);

  let account = null;
  let list = savedList();
  let groups = [];
  let people = [];
  let nextPage = null;
  let loading = false;
  let generation = 0; // descarta respuestas de otra cuenta u otra lista

  function changeList(value) {
    list = value;
    try {
      localStorage.setItem(LIST_KEY, value);
    } catch {
      // sin storage: la lista no se recuerda
    }
    load();
  }

  function load() {
    generation++;
    loading = false;
    groups = [];
    people = [];
    nextPage = null;
    moreBtn.hidden = true;
    search.placeholder = list === 'groups' ? 'Filtrar grupos…' : 'Filtrar personas…';
    clearError(errorEl);
    listEl.replaceChildren(emptyState('Cargando…', 'li'));
    if (list === 'groups') loadGroups();
    else loadPeople();
  }

  // --- Grupos ---

  async function loadGroups() {
    const gen = generation;
    try {
      const result = await api.getGroups(account.id);
      if (gen !== generation) return;
      groups = result.sort((a, b) => Number(b.isInvited) - Number(a.isInvited) || a.name.localeCompare(b.name));
      render();
    } catch (err) {
      if (gen !== generation) return;
      listEl.replaceChildren();
      showError(errorEl, err, 'MeWe grupos');
    }
  }

  function renderGroup(group) {
    return h(
      'li',
      { className: 'person' },
      h(
        'button',
        { className: 'person-main link-btn', onClick: () => navigate('group', { groupId: group.id }) },
        avatar(account.id, group.avatar, { name: group.name }),
        h(
          'span',
          { className: 'person-info' },
          userName(group.name, { className: 'person-name', fallback: 'Grupo' }),
          group.membersCount != null && h('span', { className: 'person-meta' }, `${group.membersCount} miembros`),
        ),
      ),
      group.isInvited && h('span', { className: 'badge accent' }, 'Invitación'),
      group.newPosts > 0 && h('span', { className: 'badge accent', title: 'Publicaciones nuevas' }, group.newPosts),
      // abre la sección Chats con el chat del grupo elegido (y la lista de chats al costado)
      group.isMember &&
        h(
          'button',
          {
            className: 'btn icon-btn',
            title: 'Chat del grupo',
            attrs: { 'aria-label': `Chat del grupo: ${group.name}` },
            onClick: () => navigate('chat', { thread: { id: group.id, name: group.name, avatar: group.avatar, isGroup: true } }),
          },
          icon('message-circle'),
        ),
    );
  }

  // --- Personas ---

  // MeWe entrega estas listas de a páginas y sin buscador: el filtro trabaja sobre lo ya cargado (ver onSearch)
  async function loadPeople(append = false) {
    if (loading) return false;
    const gen = generation;
    const kind = list;
    loading = true;
    moreBtn.disabled = true;
    clearError(errorEl);
    try {
      const page = await api.getPeople(account.id, kind, append ? nextPage : undefined);
      if (gen !== generation) return false;
      const known = new Set(people.map((user) => user.id));
      people = [...people, ...page.users.filter((user) => !known.has(user.id))];
      nextPage = page.nextPage;
      render();
      return true;
    } catch (err) {
      if (gen !== generation) return false;
      if (!append) listEl.replaceChildren();
      showError(errorEl, err, 'MeWe personas');
      return false;
    } finally {
      if (gen === generation) {
        loading = false;
        moreBtn.disabled = false;
      }
    }
  }

  function renderPerson(user) {
    const acc = account;
    const onError = (err) => showError(errorEl, err, 'MeWe personas');
    const action = (iconName, label, run, className = 'btn icon-btn') => {
      const button = h('button', { className, title: label, attrs: { 'aria-label': `${label}: ${user.name}` } }, icon(iconName));
      button.addEventListener('click', async () => {
        button.disabled = true;
        clearError(errorEl);
        try {
          await run();
        } catch (err) {
          onError(err);
        } finally {
          button.disabled = false;
        }
      });
      return button;
    };
    return personRow({
      account: acc,
      user,
      navigate,
      actions: [
        action('message-circle', 'Enviar mensaje', () => openChatWith({ account: acc, user, navigate })),
        copyLinkButton(user),
        action(
          'ban',
          'Bloquear',
          async () => {
            if (!(await confirmBlock(acc, user)) || acc !== account) return;
            people = people.filter((person) => person.id !== user.id);
            render();
          },
          'btn icon-btn danger',
        ),
      ],
    });
  }

  // --- Lista y filtro ---

  function render() {
    const query = fold(search.value.trim());
    const isGroups = list === 'groups';
    const all = isGroups ? groups : people;
    const shown = query ? all.filter((item) => fold(item.name).includes(query) || fold(item.handle).includes(query)) : all;
    moreBtn.hidden = isGroups || !nextPage;
    if (!shown.length) {
      const empty = isGroups
        ? groups.length
          ? 'Ningún grupo coincide.'
          : 'No estás en ningún grupo.'
        : nextPage
          ? 'Nadie coincide entre las personas cargadas.'
          : people.length
            ? 'Nadie coincide.'
            : list === 'following'
              ? 'Todavía no sigues a nadie.'
              : 'Todavía no te sigue nadie.';
      listEl.replaceChildren(emptyState(empty, 'li'));
      return;
    }
    listEl.replaceChildren(...shown.map(isGroups ? renderGroup : renderPerson));
  }

  // Al filtrar personas se van trayendo las páginas que faltan, para buscar en la lista entera
  async function onSearch() {
    render();
    if (list === 'groups' || !search.value.trim()) return;
    const gen = generation;
    for (let i = 0; i < MAX_PAGES_PER_SEARCH && nextPage && gen === generation && search.value.trim(); i++) {
      if (!(await loadPeople(true))) break;
    }
  }

  return {
    el,
    toolbar: { left: search, center: tabs.el },
    show(newAccount) {
      // otra cuenta: el filtro empieza de cero; al volver de un perfil se conserva
      if (newAccount?.id !== account?.id) search.value = '';
      account = newAccount;
      tabs.select(list);
      if (account) load();
      else listEl.replaceChildren();
    },
    hide() {
      generation++;
    },
    reload: () => account && load(),
  };
}
