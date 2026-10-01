import { api } from '../api.js';
import { avatar } from './avatar.js';
import { createComments } from './comments.js';
import { formatDateTime, formatFull } from './dates.js';
import { h } from './dom.js';
import { renderGallery } from './gallery.js';
import { createReactions } from './reactions.js';
import { userName } from './userName.js';

// Un post (feed, perfil, grupo o vista individual): cabecera, texto, fotos, reacciones y comentarios.
// expanded: muestra los comentarios abiertos (vista de post individual)
export function renderPost(post, { account, navigate, expanded = false }) {
  const accountId = account.id;
  const ref = { id: post.id, groupId: post.groupId };

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
    post.text && h('p', { className: 'post-text', attrs: { dir: 'auto' } }, post.text),
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
