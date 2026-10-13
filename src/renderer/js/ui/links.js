import { api } from '../api.js';
import { h } from './dom.js';
import { icon } from './icon.js';
import { closePopover, openPopover } from './popover.js';

// Direcciones dentro de un texto: con http(s):// o empezando con www.
const URLS = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Puntuación que suele quedar pegada al final de un link sin ser parte de él
const TRAILING = /[.,;:!?)\]}»”’]+$/;
const COPIED_MS = 1500;

function isUrl(text) {
  try {
    return Boolean(new URL(text));
  } catch {
    return false;
  }
}

// Convierte el texto en nodos para pasarle a h() como hijos: los links van como <a> (ver externalLink)
// y el resto queda como texto plano.
export function linkify(text) {
  const source = String(text ?? '');
  const nodes = [];
  let last = 0;
  for (const match of source.matchAll(URLS)) {
    const shown = match[0].replace(TRAILING, '');
    const url = /^www\./i.test(shown) ? `https://${shown}` : shown;
    if (!isUrl(url)) continue;
    if (match.index > last) nodes.push(source.slice(last, match.index));
    nodes.push(externalLink(url, shown));
    last = match.index + shown.length;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}

// Link a una página de afuera: el click la abre en el navegador del sistema; el click derecho (o mantenerlo
// apretado en una pantalla táctil) abre un menú para abrirla o copiar su dirección.
export function externalLink(url, label = url) {
  const open = () => api.openExternal(url).catch((err) => console.warn('[link]', url, err));
  const link = h('a', { className: 'ext-link', href: url, title: `${url}\nClick derecho o mantener apretado: copiar`, attrs: { rel: 'noreferrer' } }, label);
  link.addEventListener('click', (event) => {
    event.preventDefault(); // la app no navega: el link se abre afuera
    event.stopPropagation();
    open();
  });
  link.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const item = (name, text, run) =>
      h('button', { className: 'menu-item account-item', attrs: { role: 'menuitem' }, onClick: run }, h('span', { className: 'account-item-icon' }, icon(name)), text);
    const copyItem = item('copy', 'Copiar link', async () => {
      try {
        await api.copyText(url);
        copyItem.lastChild.textContent = 'Link copiado';
      } catch (err) {
        copyItem.lastChild.textContent = `No se pudo copiar: ${err.message}`;
      }
      setTimeout(() => popover.close(), COPIED_MS); // (si ya se abrió otro popover, close() no hace nada)
    });
    const menu = h(
      'div',
      { className: 'menu', attrs: { role: 'menu' } },
      item('external-link', 'Abrir en el navegador', () => {
        closePopover();
        open();
      }),
      copyItem,
    );
    const popover = openPopover(link, menu, { className: 'menu-popover', label: 'Link' });
    menu.querySelector('button')?.focus();
  });
  return link;
}
