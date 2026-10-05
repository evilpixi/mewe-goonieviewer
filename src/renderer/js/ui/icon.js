import { h } from './dom.js';

// Ícono de línea (Lucide, ver scripts/build-icons.js). Mide 1em y toma el color del texto,
// así que se agranda con font-size. Cada nombre tiene su clase `.icon-<nombre>` en styles.css.
// Es decorativo: el botón que lo contiene lleva el aria-label.
export function icon(name) {
  return h('span', { className: `icon icon-${name}`, attrs: { 'aria-hidden': 'true' } });
}
