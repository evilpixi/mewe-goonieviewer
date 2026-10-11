import { api } from './api.js';
import { clearError, showError } from './errorView.js';
import { emptyState, h } from './ui/dom.js';
import { icon } from './ui/icon.js';
import { renderPost } from './ui/post.js';
import { openPostComposer } from './ui/postComposer.js';
import { createTabs } from './ui/tabs.js';

const FEED_TYPE_KEY = 'feedType';
const FEED_TYPES = [
  ['following', 'Todo', 'layout-grid'],
  ['contacts', 'Personas', 'user'],
  ['groups', 'Grupos', 'users-round'],
];

function savedFeedType() {
  try {
    return localStorage.getItem(FEED_TYPE_KEY) ?? 'following';
  } catch {
    return 'following';
  }
}

// Feed de la cuenta activa (Todo / Personas / Grupos), con paginación "Cargar más".
// En el segundo panel: "Crear post" a la izquierda y el filtro al centro (Actualizar lo pone la app a la derecha).
export function createFeedView({ navigate }) {
  const filter = createTabs({ label: 'Tipo de feed', tabs: FEED_TYPES, onChange: changeType });
  const filterEl = filter.el;
  const createBtn = h(
    'button',
    { className: 'btn primary', title: 'Crear post', hidden: true, onClick: () => openPostComposer({ account, onDone: () => load() }) },
    icon('plus'),
    h('span', { className: 'label-text' }, ' Crear post'),
  );
  const errorEl = h('div');
  const feedEl = h('section', { className: 'feed' });
  const loadMoreBtn = h('button', { className: 'btn load-more', hidden: true, onClick: () => load({ append: true }) }, 'Cargar más');
  const el = h('div', { className: 'view scroll' }, errorEl, feedEl, loadMoreBtn);

  let account = null;
  let feedType = savedFeedType();
  let nextPage = null;
  let loading = false;
  let requestId = 0; // descarta respuestas de una cuenta que ya no está activa

  function renderFilter() {
    filterEl.hidden = createBtn.hidden = !account;
    filter.select(feedType);
  }

  function changeType(type) {
    feedType = type;
    try {
      localStorage.setItem(FEED_TYPE_KEY, type);
    } catch {
      // sin storage: el filtro no se recuerda
    }
    nextPage = null;
    loading = false;
    load();
  }

  async function load({ append = false } = {}) {
    if (!account || loading) return;
    const current = ++requestId;
    loading = true;
    loadMoreBtn.disabled = true;
    clearError(errorEl);
    if (!append) feedEl.replaceChildren(emptyState('Cargando…'));

    try {
      const page = await api.getFeed(account.id, feedType, append ? nextPage : undefined);
      if (current !== requestId) return;
      nextPage = page.nextPage;
      const posts = page.posts.map((post) => renderPost(post, { account, navigate }).el);
      if (append) feedEl.append(...posts);
      else feedEl.replaceChildren(...(posts.length ? posts : [emptyState('El feed está vacío.')]));
      loadMoreBtn.hidden = !nextPage;
    } catch (err) {
      if (current !== requestId) return;
      if (!append) feedEl.replaceChildren();
      showError(errorEl, err, 'MeWe feed');
    } finally {
      if (current === requestId) {
        loading = false;
        loadMoreBtn.disabled = false;
      }
    }
  }

  return {
    el,
    toolbar: { left: createBtn, center: filterEl },
    show(newAccount) {
      account = newAccount;
      requestId++;
      nextPage = null;
      loading = false;
      loadMoreBtn.hidden = true;
      clearError(errorEl);
      renderFilter();
      if (account) load();
      else feedEl.replaceChildren(emptyState('Agrega una cuenta con el botón + de la izquierda.'));
    },
    hide() {
      requestId++;
    },
    reload: () => load(),
  };
}
