import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { userName } from '../ui/userName.js';

const DEBOUNCE_MS = 350;
const MIN_LENGTH = 2;

// Ruta 'search': buscador de personas de MeWe. Cada resultado lleva a su perfil.
export function createSearchView({ navigate }) {
  const input = h('input', {
    type: 'search',
    className: 'input search-input',
    placeholder: 'Buscar personas…',
    attrs: { 'aria-label': 'Buscar personas' },
    onInput: () => schedule(),
    onKeydown: (event) => {
      if (event.key === 'Enter') search();
    },
  });
  const errorEl = h('div');
  const listEl = h('ul', { className: 'people-list card', attrs: { 'aria-live': 'polite' } });
  const el = h('div', { className: 'view scroll page' }, errorEl, listEl);

  let account = null;
  let timer = null;
  let generation = 0; // invalida respuestas de una búsqueda anterior

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(search, DEBOUNCE_MS);
  }

  async function search() {
    clearTimeout(timer);
    const gen = ++generation;
    const query = input.value.trim();
    clearError(errorEl);
    if (!account || query.length < MIN_LENGTH) {
      listEl.replaceChildren(emptyState('Escribe un nombre para buscar.', 'li'));
      return;
    }
    listEl.replaceChildren(emptyState('Buscando…', 'li'));
    try {
      const users = await api.searchUsers(account.id, query);
      if (gen !== generation) return;
      render(users);
    } catch (err) {
      if (gen !== generation) return;
      listEl.replaceChildren();
      showError(errorEl, err, 'MeWe búsqueda');
    }
  }

  function render(users) {
    if (!users.length) {
      listEl.replaceChildren(emptyState('Nadie coincide con la búsqueda.', 'li'));
      return;
    }
    listEl.replaceChildren(
      ...users.map((user) =>
        h(
          'li',
          { className: 'person' },
          h(
            'button',
            { className: 'person-main link-btn', onClick: () => navigate('profile', { userId: user.id }) },
            avatar(account.id, user.avatar, { name: user.name }),
            h(
              'span',
              { className: 'person-info' },
              userName(user.name, { className: 'person-name' }),
              user.handle && h('span', { className: 'person-meta' }, `@${user.handle}`),
            ),
          ),
        ),
      ),
    );
  }

  return {
    el,
    toolbar: input,
    show(newAccount) {
      // otra cuenta: la búsqueda empieza de cero; al volver de un perfil se conserva
      if (newAccount?.id !== account?.id) input.value = '';
      account = newAccount;
      search();
      setTimeout(() => input.focus());
    },
    hide() {
      clearTimeout(timer);
      generation++;
    },
    reload: () => search(),
  };
}
