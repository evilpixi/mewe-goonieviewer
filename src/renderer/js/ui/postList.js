import { clearError, showError } from '../errorView.js';
import { emptyState, h } from './dom.js';
import { renderPost } from './post.js';

// Lista de posts paginada ("Cargar más") para perfiles y grupos.
//   fetchPage(account, nextPage) → { posts, nextPage }
//   onError(err) → true si la vista ya se hizo cargo (ej. cuenta privada)
export function createPostList({ navigate, fetchPage, emptyText = 'No hay publicaciones.', onError }) {
  const errorEl = h('div');
  const listEl = h('section', { className: 'feed' });
  const moreBtn = h('button', { className: 'btn load-more', hidden: true, onClick: () => load(true) }, 'Cargar más');
  const el = h('div', { className: 'post-list' }, errorEl, listEl, moreBtn);

  let account = null;
  let nextPage = null;
  let loading = false;
  let requestId = 0; // descarta respuestas de una carga anterior

  async function load(append = false) {
    if (!account || (append && loading)) return;
    const current = ++requestId;
    loading = true;
    moreBtn.disabled = true;
    clearError(errorEl);
    if (!append) {
      moreBtn.hidden = true;
      listEl.replaceChildren(emptyState('Cargando…'));
    }
    try {
      const page = await fetchPage(account, append ? nextPage : undefined);
      if (current !== requestId) return;
      nextPage = page.nextPage;
      const posts = page.posts.map((post) => renderPost(post, { account, navigate }).el);
      if (append) listEl.append(...posts);
      else listEl.replaceChildren(...(posts.length ? posts : [emptyState(emptyText)]));
      moreBtn.hidden = !nextPage;
    } catch (err) {
      if (current !== requestId) return;
      if (!append) listEl.replaceChildren();
      if (!onError?.(err)) showError(errorEl, err, 'MeWe feed');
    } finally {
      if (current === requestId) {
        loading = false;
        moreBtn.disabled = false;
      }
    }
  }

  return {
    el,
    load(newAccount) {
      account = newAccount;
      nextPage = null;
      return load();
    },
    // Invalida lo que esté en vuelo y vacía la lista
    reset() {
      requestId++;
      loading = false;
      nextPage = null;
      moreBtn.hidden = true;
      clearError(errorEl);
      listEl.replaceChildren();
    },
  };
}
