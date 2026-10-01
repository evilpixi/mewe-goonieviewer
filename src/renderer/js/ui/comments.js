import { api } from '../api.js';
import { showError } from '../errorView.js';
import { avatar } from './avatar.js';
import { formatDateTime, formatFull } from './dates.js';
import { emptyState, h } from './dom.js';
import { renderGallery } from './gallery.js';
import { createReactions } from './reactions.js';
import { userName } from './userName.js';

const PAGE_SIZE = 10; // igual que config.mewe.comments.pageSize

// Comentarios de un post: lista paginada, respuestas, reacciones y caja para comentar.
// post: { id, groupId, comments (vista previa del feed), commentsCount, canComment }
// me: { name, avatar } de la cuenta (para mostrar lo que uno comenta al instante)
export function createComments({ account, post, onCountChange, navigate }) {
  const accountId = account.id;
  const me = { id: null, name: account.name, avatar: account.avatar };
  const listEl = h('div', { className: 'comments-list' });
  const moreBtn = h('button', { className: 'btn link-btn', hidden: true, onClick: () => load({ append: true }) }, 'Cargar más comentarios');
  const errorEl = h('div');
  const el = h(
    'section',
    { className: 'comments', attrs: { 'aria-label': 'Comentarios' } },
    listEl,
    moreBtn,
    errorEl,
    post.canComment && createInput('Escribe un comentario…', async (text) => {
      const comment = await api.addComment(accountId, post, text);
      comments.push(withAuthor(comment));
      count++;
      onCountChange?.(count);
      render();
    }),
  );

  let comments = [...post.comments];
  let count = post.commentsCount;
  let nextPage = null;
  let loaded = false;
  let loading = false;
  let openPromise = null;

  async function load({ append = false } = {}) {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    if (!append && !comments.length) listEl.replaceChildren(emptyState('Cargando…'));
    try {
      const page = await api.getComments(
        accountId,
        post,
        append ? (nextPage ? { nextPage } : { afterId: comments.at(-1)?.id }) : undefined,
      );
      const known = new Set(append ? comments.map((c) => c.id) : []);
      const fresh = page.comments.filter((c) => !known.has(c.id));
      comments = append ? [...comments, ...fresh] : page.comments;
      nextPage = page.nextPage;
      moreBtn.hidden = !(nextPage || page.comments.length >= PAGE_SIZE) || !fresh.length;
      loaded = true;
      render();
    } catch (err) {
      showError(errorEl, err, 'MeWe comentarios');
      if (!comments.length) listEl.replaceChildren();
    } finally {
      loading = false;
      moreBtn.disabled = false;
    }
  }

  function render() {
    listEl.replaceChildren(...(comments.length ? comments.map((c) => renderComment(c)) : [emptyState('Sin comentarios todavía.')]));
  }

  function renderComment(c, { isReply = false } = {}) {
    const repliesEl = h('div', { className: 'comment-replies' }, c.replies.map((r) => renderComment(r, { isReply: true })));
    let repliesLoaded = false;
    const reactions = createReactions({
      accountId,
      emojis: c.emojis,
      canReact: c.canReact,
      compact: true,
      onToggle: (emoji, on) => api.reactComment(accountId, c.id, emoji, on),
      loadReactors: () => api.getCommentReactors(accountId, c.id),
    });

    async function showReplies() {
      if (repliesLoaded) return;
      repliesLoaded = true;
      repliesEl.replaceChildren(emptyState('Cargando…'));
      try {
        const { comments: replies } = await api.getReplies(accountId, c.id);
        c.replies = replies;
        repliesEl.replaceChildren(...replies.map((r) => renderComment(r, { isReply: true })));
      } catch (err) {
        repliesLoaded = false;
        repliesEl.replaceChildren();
        showError(errorEl, err, 'MeWe comentarios');
      }
    }

    const replyBox = h('div', { className: 'comment-reply-box', hidden: true });
    const actions = h(
      'div',
      { className: 'comment-actions' },
      reactions.el,
      !isReply &&
        c.canReply &&
        h(
          'button',
          {
            className: 'link-btn',
            onClick: async () => {
              if (!replyBox.childElementCount) {
                replyBox.append(
                  createInput('Escribe una respuesta…', async (text) => {
                    const reply = await api.addReply(accountId, c.id, text);
                    c.replies.push(withAuthor(reply));
                    c.repliesCount++;
                    repliesEl.append(renderComment(withAuthor(reply), { isReply: true }));
                  }),
                );
              }
              replyBox.hidden = false;
              replyBox.querySelector('textarea')?.focus();
              showReplies();
            },
          },
          'Responder',
        ),
      !isReply &&
        c.repliesCount > c.replies.length &&
        h(
          'button',
          {
            className: 'link-btn',
            onClick: (event) => {
              event.currentTarget.remove();
              showReplies();
            },
          },
          `Ver ${c.repliesCount === 1 ? '1 respuesta' : `${c.repliesCount} respuestas`}`,
        ),
    );

    return h(
      'article',
      { className: `comment${isReply ? ' reply' : ''}`, dataset: { commentId: c.id ?? '' } },
      avatar(accountId, c.author.avatar, { name: c.author.name, size: 'sm' }),
      h(
        'div',
        { className: 'comment-body' },
        h(
          'div',
          { className: 'comment-bubble' },
          h(
            'div',
            { className: 'comment-head' },
            authorLink(c.author),
            c.createdAt && h('time', { className: 'comment-date', title: formatFull(c.createdAt) }, formatDateTime(c.createdAt)),
          ),
          c.text && h('p', { className: 'comment-text', attrs: { dir: 'auto' } }, c.text),
          renderGallery({ accountId, images: c.images }),
        ),
        actions,
        repliesEl,
        replyBox,
      ),
    );
  }

  function authorLink(author) {
    const name = userName(author.name, { className: 'comment-author' });
    if (!author.id || !navigate) return name;
    return h('button', { className: 'link-btn', onClick: () => navigate('profile', { userId: author.id }) }, name);
  }

  // Lo que devuelve MeWe al comentar puede no traer el autor: se completa con la cuenta
  function withAuthor(comment) {
    return comment.author?.name ? comment : { ...comment, author: me };
  }

  function createInput(placeholder, submit) {
    const textarea = h('textarea', { rows: 1, placeholder, attrs: { 'aria-label': placeholder } });
    const button = h('button', { type: 'submit', className: 'btn primary' }, 'Enviar');
    const form = h('form', { className: 'comment-form' }, textarea, button);
    async function sendIt() {
      const text = textarea.value.trim();
      if (!text || button.disabled) return;
      button.disabled = true;
      try {
        await submit(text);
        textarea.value = '';
      } catch (err) {
        showError(errorEl, err, 'MeWe comentarios');
      } finally {
        button.disabled = false;
        textarea.focus();
      }
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sendIt();
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendIt();
      }
    });
    return form;
  }

  render();
  return {
    el,
    // Primera apertura: trae la lista completa (el feed sólo incluye una vista previa).
    // Devuelve una promesa que se resuelve cuando la lista está cargada.
    open() {
      openPromise ??= load().then(() => {
        if (!loaded) openPromise = null; // falló: se reintenta en la próxima apertura
      });
      return openPromise;
    },
    // Resalta un comentario (para enlaces desde notificaciones)
    highlight(commentId) {
      const target = listEl.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`);
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.classList.add('highlight');
      return true;
    },
  };
}
