import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { userName } from '../ui/userName.js';

// Pestaña raíz "Grupos": mis grupos (y las invitaciones pendientes), con un buscador por nombre.
export function createGroupsView({ navigate }) {
  const search = h('input', {
    type: 'search',
    className: 'input',
    placeholder: 'Filtrar grupos…',
    attrs: { 'aria-label': 'Filtrar grupos' },
    onInput: () => render(),
  });
  const errorEl = h('div');
  const listEl = h('ul', { className: 'people-list card' });
  const el = h('div', { className: 'view scroll page' }, errorEl, listEl);

  let account = null;
  let groups = [];
  let generation = 0;

  async function load() {
    const gen = ++generation;
    clearError(errorEl);
    listEl.replaceChildren(emptyState('Cargando…', 'li'));
    try {
      const list = await api.getGroups(account.id);
      if (gen !== generation) return;
      groups = list.sort((a, b) => Number(b.isInvited) - Number(a.isInvited) || a.name.localeCompare(b.name));
      render();
    } catch (err) {
      if (gen !== generation) return;
      listEl.replaceChildren();
      showError(errorEl, err, 'MeWe grupos');
    }
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const shown = query ? groups.filter((g) => g.name.toLowerCase().includes(query)) : groups;
    if (!shown.length) {
      listEl.replaceChildren(emptyState(groups.length ? 'Ningún grupo coincide.' : 'No estás en ningún grupo.', 'li'));
      return;
    }
    listEl.replaceChildren(
      ...shown.map((group) =>
        h(
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
        ),
      ),
    );
  }

  return {
    el,
    toolbar: search,
    show(newAccount) {
      account = newAccount;
      groups = [];
      if (account) load();
      else listEl.replaceChildren();
    },
    hide() {
      generation++;
    },
    reload: () => account && load(),
  };
}
