import { api } from '../api.js';

const cache = new Map(); // url del avatar → '#rrggbb' | null | promesa

// Pinta `el` con el color predominante de una foto de perfil: define --author-color y agrega la clase `tinted`.
// Con el color ya conocido se aplica al instante (los mensajes se vuelven a dibujar seguido y no debe parpadear).
export function tintWithAvatarColor(el, accountId, url) {
  if (!url) return;
  const apply = (color) => {
    if (!color) return;
    el.style.setProperty('--author-color', color);
    el.classList.add('tinted');
  };
  if (!cache.has(url)) {
    const pending = api
      .getAvatarColor(accountId, url)
      .catch(() => null) // sin foto o sin red: el globo queda sin color
      .then((color) => {
        cache.set(url, color);
        return color;
      });
    cache.set(url, pending);
  }
  const known = cache.get(url);
  if (known instanceof Promise) known.then(apply);
  else apply(known);
}
