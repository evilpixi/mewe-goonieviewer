import { imageUrl } from '../api.js';
import { h } from './dom.js';

// Único lugar donde se renderizan avatares. Si no hay imagen (o falla), muestra las iniciales.
// size: 'sm' | 'md' | 'lg' (tamaños en --avatar-*)
export function avatar(accountId, url, { name = '', size = 'md', className = '' } = {}) {
  const el = h('span', { className: `avatar avatar-${size} ${className}`.trim(), attrs: { 'aria-hidden': 'true' } });
  const src = imageUrl(accountId, url);
  if (!src) {
    el.append(initials(name));
    return el;
  }
  const img = h('img', { src, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(initials(name)), { once: true });
  el.append(img);
  return el;
}

export function initials(name = '') {
  const text = [...String(name).trim().split(/\s+/)]
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');
  return document.createTextNode(text || '?');
}
