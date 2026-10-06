import { api, imageUrl } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { createFollowRequests } from '../ui/followRequests.js';
import { closeLightbox, openLightbox } from '../ui/lightbox.js';
import { renderPost } from '../ui/post.js';
import { createPostList } from '../ui/postList.js';
import { createTabs } from '../ui/tabs.js';
import { userName } from '../ui/userName.js';

// Ruta 'profile': { userId } → cabecera con la info, botón de seguimiento y pestañas Publicaciones / Imágenes / Álbumes.
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
      ['albums', 'Álbumes'],
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
  // Imágenes: todas las del perfil
  const allImages = createMediaGrid((nextPage) => api.getUserMedia(account.id, profile.id, nextPage));
  allImages.el.hidden = true;

  // Álbumes: la lista y, al abrir uno, sus imágenes
  const albumsGrid = h('div', { className: 'media-grid album-grid' });
  const albumsMore = h('button', { className: 'btn load-more', hidden: true, onClick: () => loadAlbums(true) }, 'Cargar más');
  const albumsError = h('div');
  const albumsListEl = h('div', {}, albumsError, albumsGrid, albumsMore);
  const albumTitle = h('strong', { className: 'album-title', attrs: { dir: 'auto' } });
  const albumImages = createMediaGrid((nextPage) => api.getUserMedia(account.id, profile.id, nextPage, openedAlbum));
  const albumEl = h(
    'div',
    { hidden: true },
    h('div', { className: 'album-head' }, h('button', { className: 'btn', onClick: () => closeAlbum() }, '← Álbumes'), albumTitle),
    albumImages.el,
  );
  const albumsEl = h('div', { hidden: true }, albumsListEl, albumEl);

  const contentEl = h(
    'div',
    { className: 'profile-content', hidden: true },
    h('div', { className: 'tabs-bar' }, tabs.el),
    posts.el,
    allImages.el,
    albumsEl,
  );
  const el = h('div', { className: 'view scroll page' }, errorEl, headerEl, requests.el, privateEl, contentEl);

  let account = null;
  let profile = null;
  let albums = [];
  let albumsNext = null;
  let openedAlbum = null; // nombre del álbum abierto
  let generation = 0; // descarta respuestas de otro perfil u otra cuenta
  let last = null;
  const loaded = new Set(); // pestañas ya cargadas para este perfil

  async function show(newAccount, params = {}) {
    const gen = ++generation;
    last = params;
    account = newAccount;
    profile = null;
    albums = [];
    albumsNext = null;
    loaded.clear();
    allImages.reset();
    closeAlbum();
    closeLightbox();
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
    const view = (image, caption) => openLightbox({ accountId: account.id, images: [image], caption });
    const photo = avatar(account.id, p.avatar, { name: p.name, size: 'xl' });
    const parts = [
      p.coverImage &&
        h(
          'button',
          { className: 'cover-btn', title: 'Ver portada', attrs: { 'aria-label': 'Ver portada' }, onClick: () => view(p.coverImage, `Portada de ${p.name}`) },
          h('img', { className: 'cover', src: imageUrl(account.id, p.cover), alt: '' }),
        ),
      h(
        'div',
        { className: 'profile-main' },
        p.avatarImage
          ? h(
              'button',
              { className: 'avatar-btn', title: 'Ver foto de perfil', attrs: { 'aria-label': 'Ver foto de perfil' }, onClick: () => view(p.avatarImage, p.name) },
              photo,
            )
          : photo,
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
    headerEl.classList.toggle('has-cover', Boolean(p.coverImage));
    headerEl.replaceChildren(...parts.filter(Boolean));
  }

  function followButtons() {
    const p = profile;
    if (p.isMe) return [];
    const action = (label, run, className = 'btn') => h('button', { className, onClick: (event) => runAction(event.currentTarget, run) }, label);
    const buttons = [h('button', { className: 'btn', onClick: (event) => openChat(event.currentTarget) }, '💬 Mensaje')];
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

  // Abre el chat con esta persona (el que ya existe o uno nuevo)
  async function openChat(button) {
    const gen = generation;
    const p = profile;
    button.disabled = true;
    clearError(errorEl);
    try {
      const thread = await api.openChatWith(account.id, p.id);
      if (gen !== generation) return;
      navigate('thread', { thread: { ...thread, name: p.name, avatar: p.avatar, userId: p.id } });
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe chat');
    } finally {
      button.disabled = false;
    }
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
    allImages.el.hidden = tab !== 'images';
    albumsEl.hidden = tab !== 'albums';
    if (loaded.has(tab)) return;
    loaded.add(tab);
    if (tab === 'posts') posts.load(account);
    else if (tab === 'images') allImages.load();
    else loadAlbums();
  }

  // Grilla paginada de imágenes (todas las del perfil o las de un álbum). fetchPage(nextPage) → { images, nextPage }
  // Al abrir una imagen, el visor muestra al lado su publicación con los comentarios.
  function createMediaGrid(fetchPage) {
    const grid = h('div', { className: 'media-grid' });
    const more = h('button', { className: 'btn load-more', hidden: true, onClick: () => load(true) }, 'Cargar más');
    const error = h('div');
    let images = [];
    let next = null;
    let token = 0; // descarta respuestas de antes de un reset (otro álbum)

    function reset() {
      token++;
      images = [];
      next = null;
      more.hidden = true;
      clearError(error);
      grid.replaceChildren();
    }

    async function load(append = false) {
      const gen = generation;
      const current = token;
      more.disabled = true;
      clearError(error);
      if (!append) grid.replaceChildren(emptyState('Cargando…'));
      try {
        const page = await fetchPage(append ? next : undefined);
        if (gen !== generation || current !== token) return;
        const known = new Set(images.map((img) => img.src));
        images = append ? [...images, ...page.images.filter((img) => !known.has(img.src))] : page.images;
        next = page.nextPage;
        render();
      } catch (err) {
        if (gen !== generation || current !== token) return;
        if (!append) grid.replaceChildren();
        if (isForbidden(err)) showPrivate();
        else showError(error, err, 'MeWe imágenes');
      } finally {
        more.disabled = false;
      }
    }

    function render() {
      more.hidden = !next;
      if (!images.length) {
        grid.replaceChildren(emptyState('No hay imágenes.'));
        return;
      }
      grid.replaceChildren(
        ...images.map((img, index) =>
          h(
            'button',
            {
              className: 'media-tile',
              title: 'Ver imagen',
              attrs: { 'aria-label': `Ver imagen ${index + 1} de ${images.length}` },
              onClick: () => openLightbox({ accountId: account.id, images, index, loadPost }),
            },
            h('img', { src: imageUrl(account.id, img.src), alt: '', loading: 'lazy' }),
          ),
        ),
      );
    }

    return { el: h('div', { className: 'profile-images' }, error, grid, more), load, reset };
  }

  // La publicación de una imagen, para el panel del visor. Sus enlaces cierran el visor antes de navegar.
  async function loadPost(img) {
    const acc = account;
    const post = await api.getPost(acc.id, img.postId);
    const go = (...args) => {
      closeLightbox();
      navigate(...args);
    };
    return renderPost(post, { account: acc, navigate: go, expanded: true, gallery: false }).el;
  }

  // --- Álbumes ---

  async function loadAlbums(append = false) {
    const gen = generation;
    albumsMore.disabled = true;
    clearError(albumsError);
    if (!append) albumsGrid.replaceChildren(emptyState('Cargando…'));
    try {
      const page = await api.getUserAlbums(account.id, profile.id, append ? albumsNext : undefined);
      if (gen !== generation) return;
      const known = new Set(albums.map((album) => album.name));
      albums = append ? [...albums, ...page.albums.filter((album) => !known.has(album.name))] : page.albums;
      albumsNext = page.nextPage;
      renderAlbums();
    } catch (err) {
      if (gen !== generation) return;
      if (!append) albumsGrid.replaceChildren();
      if (isForbidden(err)) showPrivate();
      else showError(albumsError, err, 'MeWe álbumes');
    } finally {
      albumsMore.disabled = false;
    }
  }

  function renderAlbums() {
    albumsMore.hidden = !albumsNext;
    if (!albums.length) {
      albumsGrid.replaceChildren(emptyState('No hay álbumes.'));
      return;
    }
    albumsGrid.replaceChildren(
      ...albums.map((album) =>
        h(
          'button',
          { className: 'media-tile album-tile', title: `Abrir el álbum ${album.name}`, onClick: () => openAlbum(album) },
          album.cover && h('img', { src: imageUrl(account.id, album.cover), alt: '', loading: 'lazy' }),
          h(
            'span',
            { className: 'album-caption' },
            h('span', { className: 'album-name', attrs: { dir: 'auto' } }, album.name),
            album.count != null && h('span', { className: 'album-count' }, album.count === 1 ? '1 imagen' : `${album.count} imágenes`),
          ),
        ),
      ),
    );
  }

  function openAlbum(album) {
    openedAlbum = album.name;
    albumTitle.textContent = album.name;
    albumsListEl.hidden = true;
    albumEl.hidden = false;
    albumImages.reset();
    albumImages.load();
  }

  function closeAlbum() {
    openedAlbum = null;
    albumImages.reset();
    albumEl.hidden = true;
    albumsListEl.hidden = false;
  }

  return {
    el,
    show,
    hide() {
      generation++;
      posts.reset();
      closeLightbox();
    },
    reload() {
      if (last) show(account, last);
    },
  };
}
