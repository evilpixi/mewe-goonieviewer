import { api } from '../api.js';
import { avatar } from './avatar.js';
import { createComments } from './comments.js';
import { formatDateTime, formatFull } from './dates.js';
import { h } from './dom.js';
import { renderGallery } from './gallery.js';
import { icon } from './icon.js';
import { openPostComposer } from './postComposer.js';
import { createReactions } from './reactions.js';
import { richText } from './richText.js';
import { userName } from './userName.js';

// Un post (feed, perfil, grupo o vista individual): cabecera, texto, fotos, reacciones y comentarios.
// expanded: muestra los comentarios abiertos (vista de post individual)
// gallery: false omite las fotos (el visor de imágenes ya las está mostrando)
// Los posts propios de texto y fotos llevan un lápiz para editar el texto (ver ui/postComposer.js).
export function renderPost(post, options) {
  const { account, navigate, expanded = false, gallery = true } = options;
  const accountId = account.id;
  const ref = { id: post.id, groupId: post.groupId };
  const canEdit = post.editable && Boolean(post.author.id) && post.author.id === account.userId;

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

  const head = h(
    'div',
    { className: 'post-head' },
    avatar(accountId, post.author.avatar, { name: post.author.name, size: 'sm' }),
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
        !expanded && (() => navigate('post', { postId: post.id, groupId: post.groupId })),
        'post-date-link',
      ),
    canEdit &&
      h('button', { className: 'icon-btn post-edit', title: 'Editar publicación', attrs: { 'aria-label': 'Editar publicación' }, onClick: edit }, icon('pencil')),
  );

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
    h('div', { className: 'post-footer' }, reactions.el, (post.commentsCount > 0 || post.canComment) && commentsBtn),
    commentsSlot,
  );

  if (expanded) toggleComments(true);
  return { el: article, comments: () => comments };
}

// Envuelve un nodo en un botón-enlace si hay acción; si no, lo deja como está
function link(node, onClick, className = '') {
  if (!onClick) return node;
  return h('button', { className: `link-btn ${className}`.trim(), onClick }, node);
}
