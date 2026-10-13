import { h } from '../ui/dom.js';
import { openPopover } from '../ui/popover.js';
import { MAX_DICE, MAX_FACES, MAX_MODIFIER, MIN_FACES, checkRoll, rollNotation } from './dice.js';

const COMMON = [4, 6, 8, 10, 12, 20, 100];

// Selector de dados: cada toque en un dado lo suma a la tirada; se pueden mezclar caras y agregar un modificador
// y un mensaje. onRoll({ groups, modifier, note }) se llama una vez, al tocar "Tirar".
export function openDicePicker(anchor, onRoll) {
  const dice = new Map(); // caras → cantidad
  const total = () => [...dice.values()].reduce((sum, count) => sum + count, 0);
  const spec = () => ({ groups: [...dice].map(([faces, count]) => ({ count, faces })), modifier: Math.trunc(Number(modifierInput.value)) || 0, note: noteInput.value.trim() });

  function add(faces) {
    if (total() >= MAX_DICE) return;
    dice.set(faces, (dice.get(faces) ?? 0) + 1);
    render();
  }

  function remove(faces) {
    if (dice.get(faces) > 1) dice.set(faces, dice.get(faces) - 1);
    else dice.delete(faces);
    render();
  }

  const options = COMMON.map((faces) => h('button', { type: 'button', className: 'btn dice-option', attrs: { 'aria-label': `Sumar un dado de ${faces} caras` }, onClick: () => add(faces) }, `d${faces}`));
  const facesInput = h('input', {
    type: 'number',
    className: 'dice-input',
    min: MIN_FACES,
    max: MAX_FACES,
    placeholder: `${MIN_FACES}–${MAX_FACES}`,
    attrs: { 'aria-label': 'Caras del dado' },
    onKeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addCustom();
    },
  });
  const addBtn = h('button', { type: 'button', className: 'btn', onClick: () => addCustom() }, 'Sumar');
  const modifierInput = h('input', {
    type: 'number',
    className: 'dice-input',
    min: -MAX_MODIFIER,
    max: MAX_MODIFIER,
    placeholder: '0',
    attrs: { 'aria-label': 'Modificador' },
    onInput: () => render(),
  });
  const noteInput = h('input', { className: 'dice-input', placeholder: 'Opcional', attrs: { 'aria-label': 'Mensaje de la tirada' }, onInput: () => render() });
  const chips = h('div', { className: 'dice-chips' });
  const summary = h('div', { className: 'dice-summary', attrs: { 'aria-live': 'polite' } });
  const clearBtn = h(
    'button',
    {
      type: 'button',
      className: 'btn',
      onClick: () => {
        dice.clear();
        modifierInput.value = noteInput.value = '';
        render();
      },
    },
    'Borrar',
  );
  const rollBtn = h(
    'button',
    {
      type: 'button',
      className: 'btn primary',
      onClick: () => {
        const roll = spec();
        popover.close();
        onRoll(roll);
      },
    },
    'Tirar',
  );

  function addCustom() {
    const faces = Math.trunc(Number(facesInput.value));
    if (faces < MIN_FACES || faces > MAX_FACES) {
      summary.textContent = `Los dados van de ${MIN_FACES} a ${MAX_FACES} caras.`;
      return;
    }
    facesInput.value = '';
    add(faces);
  }

  function render() {
    const full = total() >= MAX_DICE;
    for (const option of [...options, addBtn]) option.disabled = full;
    chips.replaceChildren(
      ...[...dice].map(([faces, count]) =>
        h('button', { type: 'button', className: 'dice-chip', title: 'Quitar un dado', attrs: { 'aria-label': `${count}d${faces}: quitar un dado` }, onClick: () => remove(faces) }, `${count}d${faces} ✕`),
      ),
    );
    let error = '';
    try {
      checkRoll(spec());
    } catch ({ message }) {
      error = total() ? message : 'Elige los dados de la tirada.';
    }
    summary.textContent = error || `Tirada: ${rollNotation(spec())} · ${total()} de ${MAX_DICE} dados`;
    rollBtn.disabled = Boolean(error);
    clearBtn.disabled = !total() && !modifierInput.value && !noteInput.value;
    popover.reposition(); // el alto cambia con la lista de dados
  }

  const popover = openPopover(
    anchor,
    [
      h('div', { className: 'emoji-section' }, 'Dados'),
      h('div', { className: 'dice-grid' }, options),
      h('label', { className: 'dice-field' }, 'Otro: d', facesInput, addBtn),
      h('label', { className: 'dice-field' }, 'Modificador', modifierInput),
      h('label', { className: 'dice-field' }, 'Mensaje', noteInput),
      chips,
      summary,
      h('div', { className: 'dice-actions' }, clearBtn, rollBtn),
    ],
    { className: 'dice-picker', label: 'Tirar dados' },
  );
  render();
  options[0].focus();
  return popover;
}
