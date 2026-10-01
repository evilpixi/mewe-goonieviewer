import { h } from './dom.js';

// Pestañas accesibles (role=tablist): ← → Inicio Fin mueven la selección; sólo la activa está en el orden de tabulación.
//   tabs: [[id, etiqueta]] · onChange(id) se llama cuando el usuario cambia de pestaña
// Devuelve { el, value, select(id) } (select no dispara onChange).
export function createTabs({ tabs, label, onChange, className = '' }) {
  const buttons = tabs.map(([id, text]) => h('button', { type: 'button', dataset: { tab: id }, attrs: { role: 'tab' } }, text));
  const el = h('div', { className: `segmented ${className}`.trim(), attrs: { role: 'tablist', 'aria-label': label } }, buttons);
  let value = tabs[0]?.[0] ?? null;

  function render() {
    for (const btn of buttons) {
      const selected = btn.dataset.tab === value;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    }
  }

  function choose(id, focus = false) {
    if (!id || id === value) return;
    value = id;
    render();
    if (focus) buttons.find((b) => b.dataset.tab === id)?.focus();
    onChange?.(id);
  }

  el.addEventListener('click', (event) => choose(event.target.closest('[data-tab]')?.dataset.tab));
  el.addEventListener('keydown', (event) => {
    const index = tabs.findIndex(([id]) => id === value);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next == null) return;
    event.preventDefault();
    choose(tabs[(next + tabs.length) % tabs.length][0], true);
  });

  render();
  return {
    el,
    get value() {
      return value;
    },
    select(id) {
      if (tabs.some(([tab]) => tab === id)) value = id;
      render();
    },
    // Cambia la etiqueta de una pestaña (ej. para agregar un contador)
    setLabel(id, text) {
      const btn = buttons.find((b) => b.dataset.tab === id);
      if (btn) btn.textContent = text;
    },
  };
}
