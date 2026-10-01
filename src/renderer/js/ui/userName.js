import { h } from './dom.js';

// Único lugar donde se renderizan nombres de usuario/grupo.
// `.user-name` lleva la pila de fuentes para nombres con caracteres "raros" (ver --font-names en styles.css);
// dir=auto evita que un nombre RTL desordene el resto de la línea.
export function userName(name, { className = '', fallback = 'Desconocido', tag = 'span' } = {}) {
  const text = name || fallback;
  return h(tag, { className: `user-name ${className}`.trim(), title: text, attrs: { dir: 'auto' } }, text);
}
