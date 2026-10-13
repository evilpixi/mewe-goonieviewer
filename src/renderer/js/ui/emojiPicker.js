import { h } from './dom.js';
import CATEGORIES from './emojiData.js';
import { openPopover } from './popover.js';

// Selector de emojis: buscador + una pestaña de recientes y frecuentes + las categorías de MeWe
// (el catálogo, emojiData.js, lo genera `npm run emoji:update`).
const COMMON = [
  '👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '👏', '🙏', '😍', '🥰', '😘', '🤗', '😊', '😁',
  '🤣', '😅', '😉', '😎', '🤔', '🙄', '😴', '😱', '🥺', '😭', '😤', '🤯', '🥳', '🤩', '😇', '🤤',
  '💯', '✨', '⭐', '🌹', '🌷', '🌵', '💋', '💪', '👀', '🙌', '👌', '✌️', '🤝', '💀', '🤡', '👻',
];
const RECENT_KEY = 'recentEmojis';
const MAX_RECENT = 16;
const COLUMNS = 8; // igual que .emoji-grid en styles.css
const FREQUENT = 'frequent'; // la pestaña de recientes y frecuentes
const MAX_RESULTS = 160;

// Para buscar sin distinguir mayúsculas ni acentos (las palabras del catálogo ya vienen así)
const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function recent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? [];
  } catch {
    return [];
  }
}

function remember(emoji) {
  try {
    const list = [emoji, ...recent().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // sin storage: no hay recientes
  }
}

// Emojis cuyo nombre o palabras clave tienen todas las palabras buscadas: [[emoji, nombre]]
function search(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const found = [];
  for (const { emojis } of CATEGORIES) {
    for (const [emoji, name, keywords] of emojis) {
      if (words.every((word) => keywords.includes(word))) found.push([emoji, name]);
      if (found.length >= MAX_RESULTS) return found;
    }
  }
  return found;
}

// Grilla de emojis para reaccionar sin abrir el selector (menú de un mensaje del chat): los recientes y,
// hasta completar `count`, los frecuentes. onSelect(emoji) recibe el elegido.
export function quickReactions(onSelect, count = COLUMNS * 2) {
  // sin el selector de variación, como las guarda MeWe (ver openEmojiPicker)
  const emojis = [...new Set([...recent(), ...COMMON].map((emoji) => emoji.replace(/️/g, '')))].slice(0, count);
  return h(
    'div',
    { className: 'emoji-grid' },
    emojis.map((emoji) =>
      h(
        'button',
        {
          type: 'button',
          className: 'emoji-option',
          attrs: { 'aria-label': `Reaccionar con ${emoji}` },
          onClick: () => {
            remember(emoji);
            onSelect(emoji);
          },
        },
        emoji,
      ),
    ),
  );
}

// Abre el selector anclado a `anchor`; onSelect(emoji) se llama una vez.
// forText: el emoji va dentro de un texto (no es una reacción), así que se deja tal cual.
export function openEmojiPicker(anchor, onSelect, { forText = false } = {}) {
  let popover = null;
  let tab = FREQUENT;
  const choose = (picked) => {
    // MeWe guarda las reacciones sin el selector de variación (❤ y no ❤️): si no, serían reacciones distintas
    const emoji = forText ? picked : picked.replace(/️/g, '');
    remember(emoji);
    popover?.close();
    onSelect(emoji);
  };
  const section = (text) => h('div', { className: 'emoji-section' }, text);
  // list: emojis sueltos o [emoji, nombre]
  const grid = (list) =>
    h(
      'div',
      { className: 'emoji-grid' },
      list.map((item) => {
        const [emoji, name = emoji] = [item].flat();
        return h(
          'button',
          { type: 'button', className: 'emoji-option', title: name, attrs: { 'aria-label': `${forText ? 'Insertar' : 'Reaccionar con'} ${name}` }, onClick: () => choose(emoji) },
          emoji,
        );
      }),
    );

  const input = h('input', {
    type: 'search',
    className: 'emoji-input',
    placeholder: 'Buscar emoji…',
    title: 'Busca por nombre, o escribe un emoji y pulsa Enter (Win + . abre el panel de Windows)',
    attrs: { 'aria-label': 'Buscar emoji' },
    onInput: () => render(),
    onKeydown: (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        body.querySelector('.emoji-option')?.focus();
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      // el primer resultado o, si lo escrito ya es un emoji, ese
      const value = search(input.value)[0]?.[0] ?? typedEmoji(input.value);
      if (value) choose(value);
    },
  });
  const tabButton = (id, label, symbol) =>
    h(
      'button',
      {
        type: 'button',
        className: 'emoji-tab',
        title: label,
        dataset: { tab: id },
        attrs: { role: 'tab', 'aria-label': label },
        onClick: () => {
          tab = id;
          input.value = '';
          render();
        },
      },
      symbol,
    );
  const tabsEl = h(
    'div',
    { className: 'emoji-tabs', attrs: { role: 'tablist', 'aria-label': 'Categorías' } },
    tabButton(FREQUENT, 'Recientes y frecuentes', '🕒'),
    CATEGORIES.map(({ id, name, icon }) => tabButton(id, name, icon)),
  );
  const body = h('div', { className: 'emoji-body scroll' });

  // Sólo se dibuja lo que se ve: la categoría elegida o lo que se está buscando
  function render() {
    const query = input.value.trim();
    for (const button of tabsEl.children) button.setAttribute('aria-selected', String(!query && button.dataset.tab === tab));
    if (query) {
      const found = search(query);
      body.replaceChildren(section(found.length ? 'Resultados' : 'Sin resultados. Si escribiste un emoji, pulsa Enter.'), grid(found));
    } else if (tab === FREQUENT) {
      const recents = recent();
      body.replaceChildren(...[recents.length ? [section('Recientes'), grid(recents)] : [], section('Frecuentes'), grid(COMMON)].flat());
    } else {
      const { name, emojis } = CATEGORIES.find((category) => category.id === tab);
      body.replaceChildren(section(name), grid(emojis));
    }
    body.scrollTop = 0;
  }

  render();
  popover = openPopover(anchor, [input, tabsEl, body], { className: 'emoji-picker', label: 'Elegir emoji' });
  // Flechas para moverse por los emojis (↑ ↓ saltan una fila de la grilla)
  popover.el.addEventListener('keydown', (event) => {
    const options = [...popover.el.querySelectorAll('.emoji-option')];
    const index = options.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (index < 0 || !step) return;
    event.preventDefault();
    options[Math.min(Math.max(index + step, 0), options.length - 1)].focus();
  });
  // el foco va a un emoji y no al buscador: en mobile abriría el teclado encima del selector
  popover.el.querySelector('.emoji-option')?.focus();
  return popover;
}

// Primer grafema de lo escrito, si es un emoji (puede ocupar varios code points) y no texto
function typedEmoji(text) {
  const value = text.trim();
  if (!value || /^[\p{L}\p{N}]/u.test(value)) return null;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? null;
}
