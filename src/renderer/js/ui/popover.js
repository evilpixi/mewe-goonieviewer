import { h } from './dom.js';
import { isTextField } from './keyboard.js';

// Popover flotante anclado a un elemento (uno abierto a la vez).
// Se cierra con Esc, click afuera o close(). Devuelve { el, close, reposition }.
let current = null;

export function openPopover(anchor, content, { className = '', label } = {}) {
  current?.close();
  const el = h('div', { className: `popover ${className}`.trim(), attrs: { role: 'dialog', 'aria-label': label } }, content);
  // dentro de un diálogo modal (el visor de imágenes) va adentro: afuera quedaría tapado e inerte
  (anchor.closest('dialog[open]') ?? document.body).append(el);
  place(el, anchor);

  const onPointer = (event) => {
    if (!el.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault(); // que Esc no cierre también el diálogo modal que lo contiene
      close();
      anchor.focus?.();
    }
  };
  // ¿Se está escribiendo en un campo del popover (o en su ancla, como el menú de menciones)?
  const typing = () => isTextField(document.activeElement) && (el.contains(document.activeElement) || anchor.contains(document.activeElement));
  const onScroll = (event) => {
    if (el.contains(event.target) || anchor.contains(event.target)) return;
    // al abrirse el teclado en pantalla la página se puede desplazar para mostrar el campo: no es motivo para cerrar
    if (typing()) place(el, anchor);
    else close();
  };
  // El teclado en pantalla (Android) cambia el alto de la ventana: cerrar ahí sacaba el foco del campo y el
  // teclado se volvía a ir. Sólo se cierra si cambia el ancho (se giró la pantalla o se redimensionó la ventana).
  let width = window.innerWidth;
  const onResize = () => {
    if (window.innerWidth !== width) close();
    else place(el, anchor);
  };
  setTimeout(() => document.addEventListener('pointerdown', onPointer), 0);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);

  function close() {
    if (current?.el !== el) return;
    current = null;
    el.remove();
    document.removeEventListener('pointerdown', onPointer);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  }

  current = { el, close, reposition: () => place(el, anchor) };
  return current;
}

// Devuelve si había uno abierto
export function closePopover() {
  const open = Boolean(current);
  current?.close();
  return open;
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
