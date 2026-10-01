import { h } from './dom.js';

// Popover flotante anclado a un elemento (uno abierto a la vez).
// Se cierra con Esc, click afuera o close(). Devuelve { el, close }.
let current = null;

export function openPopover(anchor, content, { className = '', label } = {}) {
  current?.close();
  const el = h('div', { className: `popover ${className}`.trim(), attrs: { role: 'dialog', 'aria-label': label } }, content);
  document.body.append(el);
  place(el, anchor);

  const onPointer = (event) => {
    if (!el.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      anchor.focus?.();
    }
  };
  const onScroll = (event) => {
    if (!el.contains(event.target)) close();
  };
  setTimeout(() => document.addEventListener('pointerdown', onPointer), 0);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);

  function close() {
    if (current?.el !== el) return;
    current = null;
    el.remove();
    document.removeEventListener('pointerdown', onPointer);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
  }

  current = { el, close, reposition: () => place(el, anchor) };
  return current;
}

export function closePopover() {
  current?.close();
}

// Debajo del ancla si entra; si no, arriba. Siempre dentro de la ventana.
function place(el, anchor) {
  const margin = 6;
  const a = anchor.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  let top = a.bottom + margin;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, a.top - height - margin);
  const left = Math.min(Math.max(margin, a.left), window.innerWidth - width - margin);
  el.style.top = `${top}px`;
  el.style.left = `${Math.max(margin, left)}px`;
}
