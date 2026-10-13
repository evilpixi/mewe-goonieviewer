import { imageUrl } from '../api.js';
import { h, spinWhileLoading } from './dom.js';
import { openLightbox } from './lightbox.js';

const MAX_TILES = 4;

// Grilla de fotos de un post: hasta 4 miniaturas; la última muestra "+N" si hay más.
// total: cuántas fotos tiene el post (el feed puede traer menos); loadAll: async () => todas
export function renderGallery({ accountId, images, total = images.length, loadAll }) {
  if (!images.length) return null;
  const count = Math.max(total, images.length);
  const tiles = images.slice(0, MAX_TILES);
  const hidden = count - tiles.length;
  const open = (index) =>
    openLightbox({ accountId, images, index, loadAll: count > images.length ? loadAll : undefined });

  return h(
    'div',
    { className: `gallery count-${Math.min(count, MAX_TILES)}` },
    tiles.map((img, i) => {
      const more = i === tiles.length - 1 && hidden > 0;
      const tile = h(
        'button',
        {
          className: 'gallery-tile',
          title: more ? `Ver las ${count} imágenes` : 'Ver imagen',
          attrs: { 'aria-label': more ? `Ver las ${count} imágenes` : `Ver imagen ${i + 1} de ${count}` },
          onClick: () => open(i),
        },
        more && h('span', { className: 'gallery-more' }, `+${hidden}`),
      );
      const image = spinWhileLoading(tile, h('img', { src: imageUrl(accountId, img.src), alt: '', loading: 'lazy' }));
      // una foto sola toma el alto de la imagen: hasta que carga no tendría ninguno (ni lugar para el spinner),
      // así que mientras tanto se le reserva el suyo
      if (count === 1) {
        tile.classList.add('loading');
        if (img.width && img.height) tile.style.aspectRatio = `${img.width} / ${img.height}`;
        const loaded = () => {
          tile.classList.remove('loading');
          tile.style.removeProperty('aspect-ratio');
        };
        image.addEventListener('load', loaded, { once: true });
        image.addEventListener('error', loaded, { once: true });
      }
      tile.prepend(image);
      return tile;
    }),
  );
}
