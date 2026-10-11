import { api, imageUrl } from '../api.js';
import { emptyState, h } from './dom.js';
import { icon } from './icon.js';

// Visor de imágenes a pantalla completa (uno solo para toda la app).
// openLightbox({ accountId, images: [{ src, full, postId? }], index, loadAll?, loadPost?, caption?, onClose? })
// - loadAll: async () => [imágenes]; para posts cuyo feed trae sólo las primeras fotos
// - loadPost: async (imagen) => nodo con la publicación de esa imagen (las que traen postId);
//   se muestra en un panel al costado
// - caption: texto en la barra · onClose: se llama una vez al cerrarse (imágenes temporales del chat)
// Teclado: ← → navegan, Esc cierra, Z alterna zoom, G (o D) guarda, C copia, P muestra u oculta la publicación.
let viewer = null;

export function openLightbox(options) {
  viewer ??= createViewer();
  viewer.open(options);
}

export function closeLightbox() {
  viewer?.close();
}

function createViewer() {
  const img = h('img', { className: 'lightbox-img', alt: '' });
  const counter = h('span', { className: 'lightbox-counter', attrs: { 'aria-live': 'polite' } });
  const status = h('span', { className: 'lightbox-status', attrs: { 'aria-live': 'polite' } });
  const prevBtn = h('button', { className: 'lightbox-nav prev', title: 'Anterior (←)', attrs: { 'aria-label': 'Anterior' } }, '‹');
  const nextBtn = h('button', { className: 'lightbox-nav next', title: 'Siguiente (→)', attrs: { 'aria-label': 'Siguiente' } }, '›');
  const zoomBtn = h('button', { className: 'btn', title: 'Tamaño real (Z)' }, 'Zoom');
  const downloadBtn = h('button', { className: 'btn', title: 'Guardar la imagen en el equipo (G)' }, icon('download'), ' Guardar');
  const copyBtn = h('button', { className: 'btn', title: 'Copiar la imagen al portapapeles (C)' }, icon('copy'), ' Copiar');
  const postBtn = h('button', { className: 'btn', title: 'Mostrar u ocultar la publicación (P)', hidden: true }, 'Publicación');
  const closeBtn = h('button', { className: 'btn', title: 'Cerrar (Esc)' }, 'Cerrar');
  const stage = h('div', { className: 'lightbox-stage' }, img);
  const postPanel = h('aside', { className: 'lightbox-post', attrs: { 'aria-label': 'Publicación de la imagen' } });
  const dialog = h(
    'dialog',
    { className: 'lightbox', attrs: { 'aria-label': 'Visor de imágenes' } },
    h('div', { className: 'lightbox-bar' }, counter, status, h('span', { className: 'spacer' }), postBtn, zoomBtn, downloadBtn, copyBtn, closeBtn),
    stage,
    prevBtn,
    nextBtn,
    postPanel,
  );
  document.body.append(dialog);

  let accountId = null;
  let images = [];
  let index = 0;
  let session = 0; // invalida loadAll de una apertura anterior
  let caption = '';
  let onClose = null;
  let loadPost = null;
  let postOpen = true; // el panel de la publicación se recuerda abierto o cerrado entre imágenes
  let shownPost = null; // postId que muestra el panel
  const posts = new Map(); // postId → promesa del nodo (dura lo que la apertura)

  // Panel lateral con la publicación de la imagen actual (texto, reacciones y comentarios)
  function showPost() {
    const current = images[index];
    const postId = (loadPost && current?.postId) || null;
    const visible = Boolean(postId) && postOpen;
    postBtn.hidden = !postId;
    postBtn.setAttribute('aria-pressed', String(visible));
    dialog.classList.toggle('with-post', visible);
    if (!visible) {
      shownPost = null;
      postPanel.replaceChildren();
      return;
    }
    if (shownPost === postId) return;
    shownPost = postId;
    postPanel.replaceChildren(emptyState('Cargando publicación…'));
    if (!posts.has(postId)) posts.set(postId, Promise.resolve(loadPost(current)));
    posts.get(postId).then(
      (node) => {
        if (shownPost === postId) postPanel.replaceChildren(node ?? emptyState('Esta imagen no tiene publicación.'));
      },
      (err) => {
        posts.delete(postId);
        if (shownPost === postId) postPanel.replaceChildren(emptyState(`No se pudo cargar la publicación: ${err.message}`));
      },
    );
  }

  function togglePost() {
    if (postBtn.hidden) return;
    postOpen = !postOpen;
    showPost();
  }

  function show() {
    const current = images[index];
    if (!current) return;
    showPost();
    dialog.classList.remove('zoomed');
    status.textContent = caption;
    const failed = () => {
      img.onerror = null;
      status.textContent = 'No se pudo cargar la imagen.';
    };
    // primero la versión grande; si falla (no todas las rutas aceptan 1600x1600) la miniatura
    const full = current.full ?? current.src;
    img.onerror =
      full === current.src
        ? failed
        : () => {
            img.onerror = failed;
            img.src = imageUrl(accountId, current.src);
          };
    img.src = imageUrl(accountId, full);
    counter.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : '';
    prevBtn.hidden = nextBtn.hidden = images.length < 2;
  }

  function go(delta) {
    if (images.length < 2) return;
    index = (index + delta + images.length) % images.length;
    show();
  }

  async function download() {
    const current = images[index];
    if (!current) return;
    status.textContent = 'Guardando…';
    try {
      const result = await api.downloadImage(accountId, current.full ?? current.src, `mewe-${Date.now()}`);
      status.textContent = result.saved ? 'Guardada.' : '';
    } catch (err) {
      // la versión grande puede no existir: se reintenta con la miniatura
      if (current.full && current.full !== current.src) {
        try {
          const result = await api.downloadImage(accountId, current.src, `mewe-${Date.now()}`);
          status.textContent = result.saved ? 'Guardada.' : '';
          return;
        } catch {
          // cae al mensaje de error
        }
      }
      status.textContent = `No se pudo guardar: ${err.message}`;
    }
  }

  // Copia la imagen al portapapeles: la versión grande (o la miniatura si no existe). Si main no puede
  // decodificarla (WebP, GIF), copia la que está en pantalla.
  async function copy() {
    const current = images[index];
    if (!current) return;
    const opened = session;
    status.textContent = 'Copiando…';
    const urls = [...new Set([current.full ?? current.src, current.src])];
    let copied = false;
    for (const url of urls) {
      try {
        ({ copied } = await api.copyImage(accountId, url));
        break; // se descargó: si no se copió es por el formato, no por la URL
      } catch {
        // la versión grande puede no existir: se prueba la miniatura
      }
    }
    if (opened !== session || images[index] !== current) return; // se cerró o se pasó a otra imagen
    try {
      if (!copied && img.complete && img.naturalWidth) {
        const rect = img.getBoundingClientRect();
        const area = stage.getBoundingClientRect();
        // un punto de la imagen que esté a la vista (con zoom puede sobresalir del visor)
        const x = Math.min(Math.max(rect.left + rect.width / 2, area.left + 1), area.right - 1);
        const y = Math.min(Math.max(rect.top + rect.height / 2, area.top + 1), area.bottom - 1);
        ({ copied } = await api.copyImageAt(x, y));
      }
      status.textContent = copied ? 'Copiada.' : 'No se pudo copiar la imagen.';
    } catch (err) {
      status.textContent = `No se pudo copiar: ${err.message}`;
    }
  }

  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  zoomBtn.addEventListener('click', () => dialog.classList.toggle('zoomed'));
  img.addEventListener('click', () => dialog.classList.toggle('zoomed'));
  downloadBtn.addEventListener('click', download);
  copyBtn.addEventListener('click', copy);
  postBtn.addEventListener('click', togglePost);
  closeBtn.addEventListener('click', () => dialog.close());
  // click en el fondo (fuera de la imagen) cierra
  stage.addEventListener('click', (event) => {
    if (event.target === stage) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.target.closest('button') && (event.key === 'Enter' || event.key === ' ')) return;
    // escribiendo un comentario en el panel de la publicación: las teclas son texto, no atajos
    if (event.target.closest('input, textarea, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowLeft') go(-1);
    else if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'z' || event.key === 'Z') dialog.classList.toggle('zoomed');
    else if (/^[gd]$/i.test(event.key)) download();
    else if (event.key === 'c' || event.key === 'C') copy();
    else if (event.key === 'p' || event.key === 'P') togglePost();
    else return;
    event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    session++;
    img.onerror = null;
    img.removeAttribute('src');
    loadPost = null;
    posts.clear();
    showPost();
    const closed = onClose;
    onClose = null;
    closed?.();
  });

  return {
    close: () => dialog.close(),
    async open({ accountId: id, images: list, index: start = 0, loadAll, loadPost: postLoader = null, caption: text = '', onClose: closed = null }) {
      const current = ++session;
      caption = text;
      onClose = closed;
      loadPost = postLoader;
      posts.clear();
      shownPost = null;
      accountId = id;
      images = list;
      index = Math.min(Math.max(start, 0), list.length - 1);
      show();
      if (!dialog.open) dialog.showModal();
      closeBtn.focus();
      if (!loadAll) return;
      status.textContent = 'Cargando todas las imágenes…';
      try {
        const all = await loadAll();
        if (current !== session || !all?.length) return;
        const shown = images[index]?.src;
        images = all;
        index = Math.max(0, all.findIndex((i) => i.src === shown));
        show();
      } catch {
        if (current === session) status.textContent = '';
      }
    },
  };
}
