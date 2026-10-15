import { api } from '../api.js';
import { showError } from '../errorView.js';
import { avatar } from './avatar.js';
import { createComments } from './comments.js';
import { confirmDialog } from './confirm.js';
import { formatDateTime, formatFull } from './dates.js';
import { emptyState, h } from './dom.js';
import { renderGallery } from './gallery.js';
import { icon } from './icon.js';
import { openPostComposer } from './postComposer.js';
import { createReactions } from './reactions.js';
import { richText } from './richText.js';
import { userName } from './userName.js';

// Un post (feed, perfil, grupo o vista individual): cabecera, texto, fotos, reacciones y comentarios.
// expanded: muestra los comentarios abiertos (vista de post individual)
// gallery: false omite las fotos (el visor de imágenes ya las está mostrando)
// Los posts propios de texto y fotos llevan un lápiz para editar el texto (ver ui/postComposer.js);
// todos los propios, un tacho para eliminarlos.
export function renderPost(post, options) {
  const { account, navigate, expanded = false, gallery = true } = options;
  const accountId = account.id;
  const ref = { id: post.id, groupId: post.groupId };
  const isMine = Boolean(post.id) && Boolean(post.author.id) && post.author.id === account.userId;
  const canEdit = post.editable && isMine;

  // Al guardar se vuelve a pedir el post y se redibuja en su lugar
  function edit() {
    openPostComposer({
      account,
      post,
      onDone: async (saved) => {
        let fresh = saved;
        try {
          fresh = await api.getPost(accountId, post.id, post.groupId);
        } catch (err) {
          console.warn('[post] recargar después de editar', err); // queda lo que devolvió la edición
        }
        if (!fresh) return;
        const updated = { ...fresh, groupId: fresh.groupId ?? post.groupId, group: fresh.group ?? post.group };
        article.replaceWith(renderPost(updated, options).el);
      },
    });
  }

  // En una lista el post desaparece; en la vista individual (y en el visor) queda el aviso en su lugar
  async function remove() {
    const confirmed = await confirmDialog({
      title: '¿Eliminar esta publicación?',
      text: 'Se borrará con sus comentarios y reacciones. No se puede deshacer.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!confirmed) return;
    deleteBtn.disabled = true;
    try {
      await api.deletePost(accountId, ref);
      if (expanded) article.replaceWith(emptyState('Publicación eliminada.'));
      else article.remove();
    } catch (err) {
      deleteBtn.disabled = false;
      head.after(errorEl);
      showError(errorEl, err, 'MeWe post');
    }
  }

  const errorEl = h('div');
  const deleteBtn =
    isMine &&
    h('button', { className: 'icon-btn post-delete', title: 'Eliminar publicación', attrs: { 'aria-label': 'Eliminar publicación' }, onClick: remove }, icon('trash-2'));

  const head = renderHead(post, {
    accountId,
    navigate,
    openPost: !expanded,
    extra: [
      canEdit &&
        h('button', { className: 'icon-btn post-edit', title: 'Editar publicación', attrs: { 'aria-label': 'Editar publicación' }, onClick: edit }, icon('pencil')),
      deleteBtn,
    ],
  });

  const reactions = createReactions({
    accountId,
    emojis: post.emojis,
    canReact: post.canReact,
    onToggle: (emoji, on) => api.reactPost(accountId, ref, emoji, on),
    loadReactors: () => api.getPostReactors(accountId, ref),
  });

  let comments = null;
  const commentsSlot = h('div', { className: 'post-comments', hidden: true });
  const commentsBtn = h('button', {
    className: 'btn link-btn post-comments-toggle',
    attrs: { 'aria-expanded': 'false' },
    onClick: () => toggleComments(),
  });
  const setCount = (n) => {
    commentsBtn.textContent = `💬 ${n === 1 ? '1 comentario' : `${n} comentarios`}`;
  };
  setCount(post.commentsCount);

  function toggleComments(open = commentsSlot.hidden) {
    if (open && !comments) {
      comments = createComments({ account, post, navigate, onCountChange: setCount });
      commentsSlot.append(comments.el);
    }
    commentsSlot.hidden = !open;
    commentsBtn.setAttribute('aria-expanded', String(open));
    if (open) comments.open();
  }

  const article = h(
    'article',
    { className: 'post', dataset: { postId: post.id ?? '' } },
    head,
    post.text && h('p', { className: 'post-text', attrs: { dir: 'auto' } }, richText(post.text, { accountId, navigate })),
    gallery &&
      renderGallery({
        accountId,
        images: post.images,
        total: post.imagesCount,
        loadAll: () => api.getPostImages(accountId, ref),
      }),
    post.shared && renderShared(post.shared, { accountId, navigate, gallery }),
    h('div', { className: 'post-footer' }, reactions.el, (post.commentsCount > 0 || post.canComment) && commentsBtn),
    commentsSlot,
  );

  if (expanded) toggleComments(true);
  return { el: article, comments: () => comments };
}

// El post original de uno compartido, citado dentro del que lo comparte: la fecha lleva al original
function renderShared(shared, { accountId, navigate, gallery }) {
  const ref = { id: shared.id, groupId: shared.groupId };
  return h(
    'div',
    { className: 'post-shared' },
    renderHead(shared, { accountId, navigate, openPost: Boolean(shared.id) }),
    shared.text && h('p', { className: 'post-text', attrs: { dir: 'auto' } }, richText(shared.text, { accountId, navigate })),
    gallery &&
      renderGallery({
        accountId,
        images: shared.images,
        total: shared.imagesCount,
        loadAll: () => api.getPostImages(accountId, ref),
      }),
  );
}

// Cabecera de un post: la foto y, al lado, una cosa por línea: quién publicó, en qué grupo (si es de uno) y la
// fecha, más chica. openPost: la fecha lleva al post. extra: lo que vaya al final de la fila (editar y eliminar).
function renderHead(post, { accountId, navigate, openPost, extra }) {
  return h(
    'div',
    { className: 'post-head' },
    avatar(accountId, post.author.avatar, { name: post.author.name, size: 'sm' }),
    h(
      'div',
      { className: 'post-head-info' },
      link(userName(post.author.name, { className: 'post-author' }), post.author.id && (() => navigate('profile', { userId: post.author.id }))),
      post.group &&
        h(
          'span',
          { className: 'post-group' },
          '› ',
          link(userName(post.group, { fallback: '' }), post.groupId && (() => navigate('group', { groupId: post.groupId }))),
        ),
      post.createdAt &&
        link(
          h('time', { className: 'post-date', dateTime: new Date(post.createdAt).toISOString(), title: formatFull(post.createdAt) }, formatDateTime(post.createdAt)),
          openPost && (() => navigate('post', { postId: post.id, groupId: post.groupId })),
        ),
    ),
    extra,
  );
}

// Envuelve un nodo en un botón-enlace si hay acción; si no, lo deja como está
function link(node, onClick, className = '') {
  if (!onClick) return node;
  return h('button', { className: `link-btn ${className}`.trim(), onClick }, node);
}
