import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { createFollowRequests } from '../ui/followRequests.js';
import { openLightbox } from '../ui/lightbox.js';
import { createPostList } from '../ui/postList.js';
import { createTabs } from '../ui/tabs.js';
import { userName } from '../ui/userName.js';

// Ruta 'profile': { userId } → cabecera con la info, botón de seguimiento y pestañas Publicaciones / Imágenes.
// Si la cuenta es privada y no la seguimos, se muestra el aviso en lugar del contenido.
export function createProfileView({ navigate }) {
  const errorEl = h('div');
  const headerEl = h('section', { className: 'card profile-head' });
  const requests = createFollowRequests({ navigate });
  const tabs = createTabs({
    label: 'Contenido del perfil',
    tabs: [
      ['posts', 'Publicaciones'],
      ['images', 'Imágenes'],
    ],
    onChange: showTab,
  });
  const privateEl = h(
    'section',
    { className: 'card private-notice', hidden: true },
    h('strong', {}, '🔒 Esta cuenta es privada'),
    h('p', {}, 'Sólo quienes la siguen pueden ver sus publicaciones e imágenes.'),
  );
  const posts = createPostList({
    navigate,
    fetchPage: (account, nextPage) => api.getUserFeed(account.id, profile.id, nextPage),
    emptyText: 'Todavía no publicó nada.',
    onError: (err) => isForbidden(err) && showPrivate(),
  });
  const imagesGrid = h('div', { className: 'media-grid' });
  const imagesMore = h('button', { className: 'btn load-more', hidden: true, onClick: () => loadImages(true) }, 'Cargar más');
  const imagesError = h('div');
  const imagesEl = h('div', { className: 'profile-images', hidden: true }, imagesError, imagesGrid, imagesMore);
  const contentEl = h('div', { className: 'profile-content', hidden: true }, h('div', { className: 'tabs-bar' }, tabs.el), posts.el, imagesEl);
  const el = h('div', { className: 'view scroll page' }, errorEl, headerEl, requests.el, privateEl, contentEl);

  let account = null;
  let profile = null;
  let images = [];
  let imagesNext = null;
  let imagesLoaded = false;
  let generation = 0; // descarta respuestas de otro perfil u otra cuenta
  let last = null;

  async function show(newAccount, params = {}) {
    const gen = ++generation;
    last = params;
    account = newAccount;
    profile = null;
    images = [];
    imagesLoaded = false;
    clearError(errorEl);
    posts.reset();
    requests.load(null);
    privateEl.hidden = true;
    contentEl.hidden = true;
    headerEl.replaceChildren(emptyState('Cargando…'));
    if (!account || !params.userId) {
      headerEl.replaceChildren(emptyState('Perfil no encontrado.'));
      return;
    }
    try {
      const data = await api.getProfile(account.id, params.userId);
      if (gen !== generation) return;
      profile = { ...data, id: data.id ?? params.userId };
      renderHeader();
      if (profile.isMe) requests.load(account);
      if (!profile.canSeeContent) {
        showPrivate();
        return;
      }
      contentEl.hidden = false;
      tabs.select(params.tab ?? 'posts');
      showTab(tabs.value);
    } catch (err) {
      if (gen !== generation) return;
      headerEl.replaceChildren();
      showError(errorEl, err, 'MeWe perfil');
    }
  }

  function showPrivate() {
    contentEl.hidden = true;
    privateEl.hidden = false;
    return true;
  }

  function isForbidden(err) {
    return err?.details?.status === 403;
  }

  // --- Cabecera ---

  function renderHeader() {
    const p = profile;
    const counters = [
      ['publicaciones', p.counters.posts],
      ['seguidores', p.counters.followers],
      ['siguiendo', p.counters.following],
    ].filter(([, value]) => value != null);
    const parts = [
      p.cover && h('img', { className: 'cover', src: imageUrl(account.id, p.cover), alt: '' }),
      h(
        'div',
        { className: 'profile-main' },
        avatar(account.id, p.avatar, { name: p.name, size: 'xl' }),
        h(
          'div',
          { className: 'profile-id' },
          userName(p.name, { tag: 'h2', className: 'profile-name' }),
          p.handle && h('span', { className: 'person-meta' }, `@${p.handle}`),
          h(
            'div',
            { className: 'badges' },
            !p.isPublic && h('span', { className: 'badge' }, '🔒 Privada'),
            p.follower && h('span', { className: 'badge' }, 'Te sigue'),
            p.isMe && h('span', { className: 'badge' }, 'Tu perfil'),
          ),
        ),
        h('div', { className: 'profile-actions' }, followButtons()),
      ),
      counters.length > 0 &&
        h('p', { className: 'profile-counters' }, counters.map(([label, value]) => h('span', {}, h('strong', {}, value), ` ${label}`))),
      p.bio && h('p', { className: 'profile-bio', attrs: { dir: 'auto' } }, p.bio),
      p.info.length > 0 &&
        h('dl', { className: 'profile-info' }, p.info.map(([label, value]) => [h('dt', {}, label), h('dd', { attrs: { dir: 'auto' } }, String(value))])),
    ];
    headerEl.replaceChildren(...parts.filter(Boolean));
  }

  function followButtons() {
    const p = profile;
    if (p.isMe) return [];
    const action = (label, run, className = 'btn') => h('button', { className, onClick: (event) => runAction(event.currentTarget, run) }, label);
    const buttons = [];
    if (p.requestReceived) {
      const id = typeof p.requestReceived === 'string' ? p.requestReceived : null;
      buttons.push(
        h('span', { className: 'status' }, 'Quiere seguirte:'),
        h('button', { className: 'btn primary', disabled: !id, onClick: (event) => runAction(event.currentTarget, () => api.answerFollowRequest(account.id, id, true)) }, 'Aceptar'),
        h('button', { className: 'btn', disabled: !id, onClick: (event) => runAction(event.currentTarget, () => api.answerFollowRequest(account.id, id, false)) }, 'Rechazar'),
      );
    }
    if (p.following) {
      buttons.push(action('Dejar de seguir', () => api.setFollow(account.id, p.id, false)));
    } else if (p.requestSent) {
      const id = typeof p.requestSent === 'string' ? p.requestSent : null;
      buttons.push(
        h('span', { className: 'status' }, 'Solicitud enviada'),
        action('Cancelar solicitud', () => (id ? api.answerFollowRequest(account.id, id, false) : api.setFollow(account.id, p.id, false))),
      );
    } else {
      buttons.push(action(p.isPublic ? 'Seguir' : 'Solicitar seguir', () => api.setFollow(account.id, p.id, true), 'btn primary'));
    }
    return buttons;
  }

  // Ejecuta una acción de seguimiento y recarga el perfil para reflejar el estado real
  async function runAction(button, run) {
    const gen = generation;
    button.disabled = true;
    clearError(errorEl);
    try {
      await run();
      if (gen === generation) await show(account, last); // si cambió la cuenta o el perfil, no se pisa la vista nueva
    } catch (err) {
      if (gen !== generation) return;
      button.disabled = false;
      showError(errorEl, err, 'MeWe seguimiento');
    }
  }

  // --- Pestañas ---

  function showTab(tab) {
    posts.el.hidden = tab !== 'posts';
    imagesEl.hidden = tab !== 'images';
    if (tab === 'posts') posts.load(account);
    else if (!imagesLoaded) loadImages();
  }

  async function loadImages(append = false) {
    const gen = generation;
    imagesMore.disabled = true;
    clearError(imagesError);
    if (!append) imagesGrid.replaceChildren(emptyState('Cargando…'));
    try {
      const page = await api.getUserMedia(account.id, profile.id, append ? imagesNext : undefined);
      if (gen !== generation) return;
      const known = new Set(images.map((img) => img.src));
      images = append ? [...images, ...page.images.filter((img) => !known.has(img.src))] : page.images;
      imagesNext = page.nextPage;
      imagesLoaded = true;
      renderImages();
    } catch (err) {
      if (gen !== generation) return;
      if (!append) imagesGrid.replaceChildren();
      if (isForbidden(err)) showPrivate();
      else showError(imagesError, err, 'MeWe imágenes');
    } finally {
      imagesMore.disabled = false;
    }
  }

  function renderImages() {
    imagesMore.hidden = !imagesNext;
    if (!images.length) {
      imagesGrid.replaceChildren(emptyState('No hay imágenes.'));
      return;
    }
    imagesGrid.replaceChildren(
      ...images.map((img, index) =>
        h(
          'button',
          {
            className: 'media-tile',
            title: 'Ver imagen',
            attrs: { 'aria-label': `Ver imagen ${index + 1} de ${images.length}` },
            onClick: () => openLightbox({ accountId: account.id, images, index }),
          },
          h('img', { src: imageUrl(account.id, img.src), alt: '', loading: 'lazy' }),
        ),
      ),
    );
  }

  return {
    el,
    show,
    hide() {
      generation++;
      posts.reset();
    },
    reload() {
      if (last) show(account, last);
    },
  };
}
