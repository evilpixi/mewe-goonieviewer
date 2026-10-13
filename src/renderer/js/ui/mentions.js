import { api } from '../api.js';
import { avatar } from './avatar.js';
import { h } from './dom.js';
import { openPopover } from './popover.js';
import { replaceMentions } from './richText.js';
import { userName } from './userName.js';

// Menciones al escribir. Con "@" y, si se quiere, parte del nombre, aparece un menú para elegir a quién
// mencionar; se va afinando mientras se sigue escribiendo. En la caja queda "@Nombre": el formato de MeWe
// (@{{u_<userId>}Nombre}, ver richText.js) se arma recién al enviar, con encode().
const OPEN_DELAY_MS = 1500; // desde que se escribe la "@" hasta que aparece el menú
const SEARCH_DEBOUNCE_MS = 250; // con el menú ya abierto, entre lo que se escribe y la búsqueda
const MAX_OPTIONS = 8;
const MIN_SEARCH = 2; // el buscador de MeWe no acepta menos letras
// "@" al principio o después de un espacio, seguida de hasta dos palabras, justo antes del cursor
const TOKEN = /(?:^|[\s(])@((?:[^\s@]+ ?){0,2})$/;

const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// las llaves y los saltos de línea romperían el formato de la mención
const cleanName = (name) => String(name ?? '').replace(/[{}\n]/g, '').trim();

// A quiénes sigue cada cuenta (la primera página): lo que se ofrece antes de que haya algo que buscar
const following = new Map(); // accountId → promesa de [{ id, name, avatar }]
function followed(accountId) {
  if (!following.has(accountId)) {
    following.set(
      accountId,
      api
        .getPeople(accountId, 'following')
        .then((page) => page.users)
        .catch(() => {
          following.delete(accountId); // se reintenta en la próxima mención
          return [];
        }),
    );
  }
  return following.get(accountId);
}

// Agrega las menciones a una caja de texto.
//   accountId(): la cuenta que escribe
//   people(): [{ id, name, avatar }] (o una promesa) de quienes están en la conversación; van primero
// Devuelve { encode(texto) → con las menciones en el formato de MeWe, decode(texto) → al revés (para editar), clear() }
export function attachMentions(textarea, { accountId, people } = {}) {
  const picked = new Map(); // nombre tal como quedó en la caja → userId
  let token = null; // la mención que se está escribiendo: { start, query, ready, shown, dismissed }
  let timer = null;
  let menu = null;
  let options = [];
  let index = 0;
  let searchId = 0;

  // La "@" que se está escribiendo justo antes del cursor: { start (posición de la @), query }
  function current() {
    if (textarea.selectionStart !== textarea.selectionEnd) return null;
    const before = textarea.value.slice(0, textarea.selectionStart);
    const match = TOKEN.exec(before);
    if (!match) return null;
    // una mención ya elegida con texto detrás no es una búsqueda nueva
    if ([...picked.keys()].some((name) => match[1].startsWith(name))) return null;
    return { start: before.length - match[1].length - 1, query: match[1].trim() };
  }

  function closeMenu() {
    menu?.close();
    menu = null;
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    token = null;
    searchId++;
    closeMenu();
  }

  function onInput() {
    const next = current();
    if (!next) {
      stop();
      return;
    }
    if (token?.start !== next.start) {
      // una "@" nueva: el menú espera un momento, por si no se quería mencionar a nadie
      stop();
      token = { ...next, ready: false, shown: false, dismissed: false };
      timer = setTimeout(() => {
        if (!token) return;
        token.ready = true;
        load();
      }, OPEN_DELAY_MS);
      return;
    }
    token.query = next.query;
    // el menú se cerró con Esc o tocando afuera: no vuelve a aparecer para esta "@"
    if (token.shown && !menu?.el.isConnected) token.dismissed = true;
    if (!token.ready || token.dismissed) return;
    clearTimeout(timer);
    timer = setTimeout(load, SEARCH_DEBOUNCE_MS);
  }

  async function load() {
    timer = null;
    const id = accountId?.();
    if (!token || !id) return;
    const request = ++searchId;
    const { query } = token;
    const [context, follows, found] = await Promise.all([
      Promise.resolve()
        .then(() => people?.() ?? [])
        .catch(() => []),
      followed(id),
      query.length >= MIN_SEARCH ? api.searchUsers(id, query).catch(() => []) : [],
    ]);
    if (request !== searchId || !token) return;
    const wanted = fold(query);
    const seen = new Set();
    // primero los de la conversación y los que se siguen; después lo que encuentre el buscador de MeWe
    options = [...[...context, ...follows].filter((user) => fold(user?.name).includes(wanted)), ...found]
      .filter((user) => user?.id && cleanName(user.name) && !seen.has(user.id) && seen.add(user.id))
      .slice(0, MAX_OPTIONS);
    index = 0;
    render(id);
  }

  function render(id = accountId?.()) {
    if (!token || !options.length || document.activeElement !== textarea) {
      if (token) token.shown = false; // sin resultados: si se sigue escribiendo, se vuelve a buscar
      closeMenu();
      return;
    }
    const list = h(
      'div',
      { className: 'menu mention-menu', attrs: { role: 'listbox', 'aria-label': 'Personas' } },
      options.map((user, i) =>
        h(
          'button',
          {
            type: 'button',
            className: 'menu-item account-item',
            attrs: { role: 'option', 'aria-selected': String(i === index) },
            // el foco se queda en la caja de texto (y el teclado en pantalla, abierto)
            onPointerdown: (event) => event.preventDefault(),
            onMousedown: (event) => event.preventDefault(),
            onClick: () => pick(user),
          },
          avatar(id, user.avatar, { name: user.name, size: 'sm' }),
          userName(user.name),
        ),
      ),
    );
    token.shown = true;
    if (menu?.el.isConnected) {
      menu.el.replaceChildren(list);
      menu.reposition();
    } else {
      menu = openPopover(textarea, list, { className: 'menu-popover mention-popover', label: 'Mencionar a alguien' });
    }
  }

  function pick(user) {
    const now = current();
    if (!token || !user || now?.start !== token.start) {
      stop(); // el cursor ya no está en esa "@"
      return;
    }
    const name = cleanName(user.name);
    picked.set(name, user.id);
    textarea.setRangeText(`@${name} `, token.start, textarea.selectionStart, 'end');
    stop();
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true })); // la caja se reacomoda, el borrador se guarda…
  }

  textarea.addEventListener('input', onInput);
  // En captura: con el menú abierto, las flechas y Enter son del menú y no de la caja (que con Enter enviaría)
  textarea.addEventListener(
    'keydown',
    (event) => {
      if (!menu?.el.isConnected || event.isComposing) return;
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step) {
        index = (index + step + options.length) % options.length;
        render();
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        pick(options[index]);
      } else {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  textarea.addEventListener('blur', () =>
    setTimeout(() => {
      if (document.activeElement !== textarea) stop();
    }, 150),
  );

  return {
    encode(text) {
      let result = String(text ?? '');
      // primero los nombres más largos: "@Ana María" antes que "@Ana"
      for (const [name, userId] of [...picked].sort((a, b) => b[0].length - a[0].length)) {
        result = result.replace(new RegExp(`@${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'gu'), () => `@{{u_${userId}}${name}}`);
      }
      return result;
    },
    decode(text) {
      return replaceMentions(text, (userId, rawName) => {
        const name = cleanName(rawName) || 'Usuario';
        picked.set(name, userId);
        return `@${name}`;
      });
    },
    clear() {
      picked.clear();
      stop();
    },
  };
}
