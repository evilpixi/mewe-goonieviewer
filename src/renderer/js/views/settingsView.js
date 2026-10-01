import { DEFAULTS, RANGES, THEMES, getSettings, resetSettings, updateSettings } from '../settings.js';
import { h } from '../ui/dom.js';
import { userName } from '../ui/userName.js';

const SCALES = [
  ['zoom', 'Zoom de la interfaz', 'Agranda o achica todo a la vez'],
  ['fontScale', 'Tamaño de fuente', 'Sólo el texto'],
  ['density', 'Espaciado', 'Padding y márgenes: menos es más compacto'],
  ['iconScale', 'Tamaño de iconos', 'Iconos y avatares'],
];

// Ruta 'settings': tema, color de acento y escalas. Cada cambio se aplica y se guarda al instante.
export function createSettingsView() {
  const themeGroup = h('div', { className: 'theme-grid', attrs: { role: 'radiogroup', 'aria-label': 'Tema' } });
  const scalesEl = h('div', { className: 'settings-rows' });
  const accentInput = h('input', { type: 'color', id: 'setting-accent', onInput: () => update({ accent: accentInput.value }) });
  const accentReset = h('button', { className: 'btn', onClick: () => update({ accent: '' }) }, 'Usar el del tema');
  const el = h(
    'div',
    { className: 'view scroll page settings' },
    h('section', { className: 'card' }, h('h2', { className: 'card-title' }, 'Tema'), themeGroup),
    h(
      'section',
      { className: 'card' },
      h('h2', { className: 'card-title' }, 'Color de acento'),
      h('div', { className: 'settings-row' }, h('label', { htmlFor: 'setting-accent' }, 'Botones, enlaces y globos propios'), accentInput, accentReset),
    ),
    h('section', { className: 'card' }, h('h2', { className: 'card-title' }, 'Tamaños'), scalesEl),
    h(
      'section',
      { className: 'card' },
      h('h2', { className: 'card-title' }, 'Vista previa'),
      h(
        'p',
        {},
        'Nombres con caracteres especiales: ',
        userName('𝓐𝓷𝓪 𝕭𝖊𝖗𝖙𝖆 ℂ𝕒𝕣𝕝𝕠𝕤 🅳🅰🅽🅸 ⓔⓛⓘ ꧁༺ 𝐹𝑒𝒹𝑒 ༻꧂ ☆彡 ✪ ⚝ 🦊'),
      ),
      h('div', { className: 'settings-row' }, h('button', { className: 'btn primary' }, 'Botón principal'), h('button', { className: 'btn' }, 'Botón'), h('button', { className: 'btn danger' }, 'Peligro')),
    ),
    h('button', { className: 'btn', onClick: () => render(resetSettings()) }, 'Restablecer valores por defecto'),
  );

  function update(patch) {
    render(updateSettings(patch));
  }

  function render(settings) {
    themeGroup.replaceChildren(
      ...THEMES.map(([id, label, description]) =>
        h(
          'label',
          { className: `theme-option${settings.theme === id ? ' active' : ''}` },
          h('input', { type: 'radio', name: 'theme', value: id, checked: settings.theme === id, onChange: () => update({ theme: id }) }),
          h('strong', {}, label),
          h('span', { className: 'person-meta' }, description),
        ),
      ),
    );
    // El selector de color necesita un valor: sin acento propio muestra el del tema
    accentInput.value = settings.accent || themeAccent();
    accentReset.disabled = !settings.accent;
    renderScales(settings);
  }

  // Los deslizadores se crean una sola vez (recrearlos mientras se arrastra cortaría el gesto)
  const sliders = new Map();
  function renderScales(settings) {
    if (!sliders.size) {
      for (const [key, label, hint] of SCALES) {
        const [min, max, step] = RANGES[key];
        const id = `setting-${key}`;
        const output = h('output', { htmlFor: id, className: 'settings-value' });
        const input = h('input', { type: 'range', id, min, max, step });
        // el zoom se aplica al soltar: aplicarlo mientras se arrastra mueve el propio control
        input.addEventListener(key === 'zoom' ? 'change' : 'input', () => update({ [key]: Number(input.value) }));
        input.addEventListener('input', () => {
          output.textContent = percent(input.value);
        });
        const reset = h('button', { className: 'btn', title: 'Volver al 100 %', onClick: () => update({ [key]: DEFAULTS[key] }) }, '↺');
        reset.setAttribute('aria-label', `Restablecer ${label.toLowerCase()}`);
        sliders.set(key, { input, output });
        scalesEl.append(
          h('div', { className: 'settings-row' }, h('label', { htmlFor: id }, label, h('span', { className: 'person-meta' }, hint)), input, output, reset),
        );
      }
    }
    for (const [key, { input, output }] of sliders) {
      input.value = settings[key];
      output.textContent = percent(settings[key]);
    }
  }

  return {
    el,
    show() {
      render(getSettings());
    },
  };
}

function percent(value) {
  return `${Math.round(Number(value) * 100)} %`;
}

// Acento que define el tema activo, como #rrggbb
function themeAccent() {
  const root = document.documentElement;
  const inline = root.style.getPropertyValue('--accent');
  root.style.removeProperty('--accent');
  const value = getComputedStyle(root).getPropertyValue('--accent').trim();
  if (inline) root.style.setProperty('--accent', inline);
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#2f5fe8';
}
