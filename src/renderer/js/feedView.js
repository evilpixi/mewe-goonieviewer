import { api } from './api.js';
import { clearError, showError } from './errorView.js';
import { emptyState, h } from './ui/dom.js';
import { renderPost } from './ui/post.js';

const FEED_TYPE_KEY = 'feedType';
const FEED_TYPES = [
  ['following', 'Todo'],
  ['groups', 'Grupos'],
  ['contacts', 'Perfiles'],
];

function savedFeedType() {
  try {
    return localStorage.getItem(FEED_TYPE_KEY) ?? 'following';
  } catch {
    return 'following';
  }
}

// Feed de la cuenta activa (Siguiendo: Todo / Grupos / Perfiles), con paginación "Cargar más".
export function createFeedView({ navigate }) {
  const filterEl = h(
    'div',
    { className: 'segmented', attrs: { role: 'tablist', 'aria-label': 'Tipo de feed' } },
    FEED_TYPES.map(([type, label]) => h('button', { dataset: { feed: type }, attrs: { role: 'tab' } }, label)),
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
    filterEl.hidden = !account;
    for (const btn of filterEl.querySelectorAll('[data-feed]')) {
      btn.classList.toggle('active', btn.dataset.feed === feedType);
      btn.setAttribute('aria-selected', String(btn.dataset.feed === feedType));
    }
  }

  filterEl.addEventListener('click', (event) => {
    const type = event.target.closest('[data-feed]')?.dataset.feed;
    if (!type || type === feedType) return;
    feedType = type;
    try {
      localStorage.setItem(FEED_TYPE_KEY, type);
    } catch {
      // sin storage: el filtro no se recuerda
    }
    renderFilter();
    nextPage = null;
    loading = false;
    load();
  });

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
    toolbar: filterEl,
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
