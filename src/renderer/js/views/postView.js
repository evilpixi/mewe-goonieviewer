import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { emptyState, h } from '../ui/dom.js';
import { renderPost } from '../ui/post.js';

// Ruta 'post': { postId, groupId?, commentId? } → el post con sus comentarios abiertos.
// commentId (desde notificaciones) resalta ese comentario.
export function createPostView({ navigate }) {
  const errorEl = h('div');
  const content = h('div', { className: 'feed single-post' });
  const el = h('div', { className: 'view scroll' }, errorEl, content);
  let requestId = 0;
  let last = null; // { account, params } para "Actualizar"

  async function show(account, params = {}) {
    const { postId, groupId, commentId } = params;
    const current = ++requestId;
    last = { account, params };
    clearError(errorEl);
    content.replaceChildren(emptyState('Cargando…'));
    if (!account || !postId) {
      content.replaceChildren(emptyState('Post no encontrado.'));
      return;
    }
    try {
      const post = await api.getPost(account.id, postId, groupId);
      if (current !== requestId) return;
      const rendered = renderPost(post, { account, navigate, expanded: true });
      content.replaceChildren(rendered.el);
      if (commentId) {
        await rendered.comments()?.open();
        if (current === requestId) rendered.comments()?.highlight(commentId);
      }
    } catch (err) {
      if (current !== requestId) return;
      content.replaceChildren();
      showError(errorEl, err, 'MeWe post');
    }
  }

  return {
    el,
    show,
    hide() {
      requestId++;
    },
    reload() {
      if (last) show(last.account, last.params);
    },
  };
}
