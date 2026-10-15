import { imageUrl } from '../api.js';
import { h } from './dom.js';
import { icon } from './icon.js';

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

// La foto de un chat. Un chat grupal entre personas no tiene una: son tres burbujas superpuestas con las fotos
// de tres de sus miembros, siempre los mismos (los de id menor); si son menos, se completa con un ícono de persona.
export function threadAvatar(accountId, thread, { size = 'md' } = {}) {
  if (!thread.isMultiUser) return avatar(accountId, thread.avatar, { name: thread.name, size });
  const chosen = [...(thread.participants ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, 3);
  const bubbles = [0, 1, 2].map((i) => {
    const user = chosen[i];
    if (!user) return h('span', { className: 'stack-bubble generic' }, icon('user'));
    const bubble = avatar(accountId, user.avatar, { name: user.name });
    bubble.className = 'stack-bubble';
    return bubble;
  });
  return h('span', { className: `avatar avatar-${size} avatar-stack`, attrs: { 'aria-hidden': 'true' } }, bubbles);
}

export function initials(name = '') {
  const text = [...String(name).trim().split(/\s+/)]
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');
  return document.createTextNode(text || '?');
}
