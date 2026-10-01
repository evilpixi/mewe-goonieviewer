import { api, imageUrl } from '../api.js';
import { h } from './dom.js';

// Visor de imágenes a pantalla completa (uno solo para toda la app).
// openLightbox({ accountId, images: [{ src, full }], index, loadAll? })
// - loadAll: async () => [imágenes]; para posts cuyo feed trae sólo las primeras fotos
// Teclado: ← → navegan, Esc cierra, Z alterna zoom, D descarga.
let viewer = null;

export function openLightbox(options) {
  viewer ??= createViewer();
  viewer.open(options);
}

function createViewer() {
  const img = h('img', { className: 'lightbox-img', alt: '' });
  const counter = h('span', { className: 'lightbox-counter', attrs: { 'aria-live': 'polite' } });
  const status = h('span', { className: 'lightbox-status', attrs: { 'aria-live': 'polite' } });
  const prevBtn = h('button', { className: 'lightbox-nav prev', title: 'Anterior (←)', attrs: { 'aria-label': 'Anterior' } }, '‹');
  const nextBtn = h('button', { className: 'lightbox-nav next', title: 'Siguiente (→)', attrs: { 'aria-label': 'Siguiente' } }, '›');
  const zoomBtn = h('button', { className: 'btn', title: 'Tamaño real (Z)' }, 'Zoom');
  const downloadBtn = h('button', { className: 'btn', title: 'Descargar (D)' }, 'Descargar');
  const closeBtn = h('button', { className: 'btn', title: 'Cerrar (Esc)' }, 'Cerrar');
  const stage = h('div', { className: 'lightbox-stage' }, img);
  const dialog = h(
    'dialog',
    { className: 'lightbox', attrs: { 'aria-label': 'Visor de imágenes' } },
    h('div', { className: 'lightbox-bar' }, counter, status, h('span', { className: 'spacer' }), zoomBtn, downloadBtn, closeBtn),
    stage,
    prevBtn,
    nextBtn,
  );
  document.body.append(dialog);

  let accountId = null;
  let images = [];
  let index = 0;
  let session = 0; // invalida loadAll de una apertura anterior

  function show() {
    const current = images[index];
    if (!current) return;
    dialog.classList.remove('zoomed');
    status.textContent = '';
    // primero la versión grande; si falla (no todas las rutas aceptan 1600x1600) la miniatura
    img.onerror = () => {
      img.onerror = null;
      img.src = imageUrl(accountId, current.src);
    };
    img.src = imageUrl(accountId, current.full ?? current.src);
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
    status.textContent = 'Descargando…';
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
      status.textContent = `No se pudo descargar: ${err.message}`;
    }
  }

  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  zoomBtn.addEventListener('click', () => dialog.classList.toggle('zoomed'));
  img.addEventListener('click', () => dialog.classList.toggle('zoomed'));
  downloadBtn.addEventListener('click', download);
  closeBtn.addEventListener('click', () => dialog.close());
  // click en el fondo (fuera de la imagen) cierra
  stage.addEventListener('click', (event) => {
    if (event.target === stage) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.target.closest('button') && (event.key === 'Enter' || event.key === ' ')) return;
    if (event.key === 'ArrowLeft') go(-1);
    else if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'z' || event.key === 'Z') dialog.classList.toggle('zoomed');
    else if (event.key === 'd' || event.key === 'D') download();
    else return;
    event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    session++;
    img.removeAttribute('src');
  });

  return {
    async open({ accountId: id, images: list, index: start = 0, loadAll }) {
      const current = ++session;
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
