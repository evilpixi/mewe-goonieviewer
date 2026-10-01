import { h } from './dom.js';
import { openPopover } from './popover.js';

// Selector de emojis: recientes + una selección común + campo libre (Win+. abre el panel de Windows).
const COMMON = [
  '👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '👏', '🙏', '😍', '🥰', '😘', '🤗', '😊', '😁',
  '🤣', '😅', '😉', '😎', '🤔', '🙄', '😴', '😱', '🥺', '😭', '😤', '🤯', '🥳', '🤩', '😇', '🤤',
  '💯', '✨', '⭐', '🌹', '🌷', '🌵', '💋', '💪', '👀', '🙌', '👌', '✌️', '🤝', '💀', '🤡', '👻',
];
const RECENT_KEY = 'recentEmojis';
const MAX_RECENT = 16;
const COLUMNS = 8; // igual que .emoji-grid en styles.css

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

// Abre el selector anclado a `anchor`; onSelect(emoji) se llama una vez.
export function openEmojiPicker(anchor, onSelect) {
  let popover = null;
  const choose = (picked) => {
    // MeWe guarda los emojis sin el selector de variación (❤ y no ❤️): si no, serían reacciones distintas
    const emoji = picked.replace(/️/g, '');
    remember(emoji);
    popover?.close();
    onSelect(emoji);
  };
  const grid = (list) =>
    h(
      'div',
      { className: 'emoji-grid' },
      list.map((emoji) => h('button', { className: 'emoji-option', title: emoji, attrs: { 'aria-label': `Reaccionar con ${emoji}` }, onClick: () => choose(emoji) }, emoji)),
    );

  const input = h('input', {
    className: 'emoji-input',
    placeholder: 'Otro emoji… (Win + .)',
    attrs: { 'aria-label': 'Escribir un emoji' },
    onKeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const value = firstEmoji(input.value);
      if (value) choose(value);
    },
  });

  const recents = recent();
  popover = openPopover(
    anchor,
    [
      recents.length ? [h('div', { className: 'emoji-section' }, 'Recientes'), grid(recents)] : null,
      h('div', { className: 'emoji-section' }, 'Emojis'),
      grid(COMMON),
      input,
    ],
    { className: 'emoji-picker', label: 'Elegir emoji' },
  );
  // Flechas para moverse por los emojis (↑ ↓ saltan una fila de la grilla)
  popover.el.addEventListener('keydown', (event) => {
    const options = [...popover.el.querySelectorAll('.emoji-option')];
    const index = options.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (index < 0 || !step) return;
    event.preventDefault();
    options[Math.min(Math.max(index + step, 0), options.length - 1)].focus();
  });
  popover.el.querySelector('.emoji-option')?.focus();
  return popover;
}

// Primer grafema del texto (un emoji puede ocupar varios code points)
function firstEmoji(text) {
  const value = text.trim();
  if (!value) return null;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? null;
}
