import { isMobile } from './mobile.js';

// Teclado en pantalla (mobile). El navegador no avisa cuándo se abre: se deduce de que, con un campo de texto
// enfocado, la ventana pierde alto (en Android el WebView se achica para dejarle lugar al teclado).
// Mientras está abierto, <html> lleva el atributo data-keyboard (styles.css oculta la barra de navegación).
const KEYBOARD_MIN_PX = 120; // menos que esto no es un teclado (una barra del sistema que aparece o se va)
const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

export function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !NOT_TEXT.has(el.type);
}

const height = () => window.visualViewport?.height ?? window.innerHeight;
const listeners = new Set();
let width = window.innerWidth;
let fullHeight = height(); // alto de la ventana sin teclado
let open = false;

function update() {
  if (window.innerWidth !== width) {
    // se giró la pantalla (o cambió el ancho de la ventana): el alto de antes ya no sirve de referencia
    width = window.innerWidth;
    fullHeight = height();
  } else {
    fullHeight = Math.max(fullHeight, height());
  }
  const now = isMobile() && isTextField(document.activeElement) && fullHeight - height() > KEYBOARD_MIN_PX;
  if (now === open) return;
  open = now;
  document.documentElement.toggleAttribute('data-keyboard', open);
  for (const callback of listeners) callback(open);
}

window.addEventListener('resize', update);
window.visualViewport?.addEventListener('resize', update);
document.addEventListener('focusin', update);
// Se espera un momento antes de dar el teclado por cerrado: al pasar de un campo a otro el foco queda un instante
// en ningún lado y, sobre todo, al tocar un botón (Enviar) el foco sale de la caja antes del click. Si la barra
// de navegación reapareciera ahí, movería el botón debajo del dedo y el toque se perdería.
const BLUR_GRACE_MS = 350;
document.addEventListener('focusout', () => setTimeout(update, BLUR_GRACE_MS));

export const keyboardOpen = () => open;

// callback(abierto) en cada cambio
export function onKeyboardChange(callback) {
  listeners.add(callback);
}

// Sacar el foco del campo cierra el teclado
export function hideKeyboard() {
  if (isTextField(document.activeElement)) document.activeElement.blur();
}
