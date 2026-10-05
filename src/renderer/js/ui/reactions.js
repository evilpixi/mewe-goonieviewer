import { avatar } from './avatar.js';
import { emptyState, h } from './dom.js';
import { openEmojiPicker } from './emojiPicker.js';
import { icon } from './icon.js';
import { openPopover } from './popover.js';
import { userName } from './userName.js';

// Barra de reacciones reutilizable (posts, comentarios y mensajes): no sabe sobre qué está.
//   emojis: [{ emoji, count, mine }]
//   onToggle(emoji, on): async, guarda en MeWe (si falla se revierte)
//   loadReactors(): async → { reactors: [{ user, emojis }] }
// Click en un chip pone/quita tu reacción; "+" abre el selector; "¿Quién?" lista quién reaccionó.
export function createReactions({ accountId, emojis = [], canReact = true, onToggle, loadReactors, compact = false }) {
  const el = h('div', { className: `reactions${compact ? ' compact' : ''}`, attrs: { role: 'group', 'aria-label': 'Reacciones' } });
  let state = emojis.map((e) => ({ ...e }));
  let reactorsCache = null; // promesa con la lista de quién reaccionó

  async function toggle(emoji) {
    if (!canReact) return;
    const before = state.map((e) => ({ ...e }));
    const existing = state.find((e) => e.emoji === emoji);
    const on = !existing?.mine;
    if (existing) {
      existing.mine = on;
      existing.count += on ? 1 : -1;
    } else {
      state.push({ emoji, count: 1, mine: true });
    }
    state = state.filter((e) => e.count > 0);
    reactorsCache = null;
    render();
    try {
      await onToggle(emoji, on);
    } catch (err) {
      console.error('[reacciones]', err);
      state = before;
      render();
      el.title = `No se pudo guardar la reacción: ${err.message}`;
    }
  }

  function reactors() {
    reactorsCache ??= loadReactors().catch((err) => {
      reactorsCache = null;
      throw err;
    });
    return reactorsCache;
  }

  // Nombres en el tooltip del chip (se piden la primera vez que se pasa el mouse)
  async function fillTitle(chip, emoji) {
    if (chip.dataset.loaded) return;
    chip.dataset.loaded = '1';
    try {
      const { reactors: list } = await reactors();
      const names = list.filter((r) => r.emojis.includes(emoji)).map((r) => r.user.name);
      if (names.length) chip.title = `${emoji} ${names.join(', ')}`;
    } catch {
      delete chip.dataset.loaded;
    }
  }

  function showReactors(anchor) {
    const list = h('div', { className: 'reactors-list' }, emptyState('Cargando…'));
    openPopover(anchor, list, { className: 'reactors-popover', label: 'Quién reaccionó' });
    reactors()
      .then(({ reactors: items }) => {
        list.replaceChildren(
          ...(items.length
            ? items.map((r) =>
                h(
                  'div',
                  { className: 'reactor' },
                  avatar(accountId, r.user.avatar, { name: r.user.name, size: 'sm' }),
                  userName(r.user.name, { className: 'reactor-name' }),
                  h('span', { className: 'reactor-emojis' }, r.emojis.join(' ')),
                ),
              )
            : [emptyState('Nadie todavía.')]),
        );
      })
      .catch((err) => list.replaceChildren(emptyState(`No se pudo cargar: ${err.message}`)));
  }

  function render() {
    const chips = state
      .sort((a, b) => b.count - a.count)
      .map((e) => {
        const chip = h(
          'button',
          {
            className: `reaction${e.mine ? ' mine' : ''}`,
            disabled: !canReact,
            title: e.mine ? 'Quitar tu reacción' : 'Reaccionar igual',
            attrs: { 'aria-pressed': String(e.mine), 'aria-label': `${e.emoji} ${e.count}` },
            onClick: () => toggle(e.emoji),
          },
          h('span', { className: 'reaction-emoji' }, e.emoji),
          h('span', { className: 'reaction-count' }, e.count),
        );
        chip.addEventListener('mouseenter', () => fillTitle(chip, e.emoji), { once: true });
        return chip;
      });

    const addBtn =
      canReact &&
      h(
        'button',
        {
          className: 'reaction add',
          title: 'Agregar reacción',
          attrs: { 'aria-label': 'Agregar reacción', 'aria-haspopup': 'dialog' },
          onClick: (event) => openEmojiPicker(event.currentTarget, toggleOn),
        },
        icon('smile-plus'),
      );
    const whoBtn =
      state.length > 0 &&
      h(
        'button',
        {
          className: 'reaction who',
          title: 'Ver quién reaccionó',
          attrs: { 'aria-label': 'Ver quién reaccionó', 'aria-haspopup': 'dialog' },
          onClick: (event) => showReactors(event.currentTarget),
        },
        '¿Quién?',
      );
    el.replaceChildren(...chips, addBtn || '', whoBtn || '');
    el.classList.toggle('no-reactions', state.length === 0); // no 'empty': esa clase es el mensaje gris centrado
  }

  function toggleOn(emoji) {
    const existing = state.find((e) => e.emoji === emoji);
    if (!existing?.mine) toggle(emoji);
  }

  render();
  return {
    el,
    // Datos nuevos del servidor (polling / tiempo real)
    update(next) {
      state = next.map((e) => ({ ...e }));
      reactorsCache = null;
      render();
    },
    // Abre el selector desde afuera (ej. botón de reaccionar junto a un mensaje)
    pick(anchor) {
      if (canReact) openEmojiPicker(anchor, toggleOn);
    },
  };
}
