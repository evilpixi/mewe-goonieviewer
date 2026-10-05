import {
  COLORS,
  DEFAULTS,
  PRESETS,
  RANGES,
  THEMES,
  applyPreset,
  getSettings,
  getSettingsAccount,
  luminance,
  resetSettings,
  setOwnTheme,
  updateSettings,
} from '../settings.js';
import { h } from '../ui/dom.js';
import { userName } from '../ui/userName.js';

const SCALES = [
  ['zoom', 'Zoom de la interfaz', 'Agranda o achica todo a la vez'],
  ['fontScale', 'Tamaño de fuente', 'Sólo el texto'],
  ['chatFontScale', 'Texto de los chats', 'Aumento extra para mensajes y caja de redacción'],
  ['lineScale', 'Interlineado', 'Alto de línea: menos es más compacto'],
  ['density', 'Espaciado', 'Padding y márgenes: menos es más compacto'],
  ['iconScale', 'Tamaño de iconos', 'Iconos y avatares'],
];

const TOGGLES = [
  ['fullWidth', 'Usar todo el ancho', 'Mensajes, publicaciones y páginas ocupan el 100 % del ancho disponible'],
  ['compactThreads', 'Lista de chats compacta', 'Sólo avatares: deja más lugar para la conversación'],
  ['chatCover', 'Portada como fondo del chat', 'La portada de la persona o del grupo, atenuada, detrás de los mensajes'],
];

// [etiqueta, token del texto, token del fondo]
const CONTRAST_PAIRS = [
  ['Texto sobre paneles', '--text', '--panel'],
  ['Texto sobre fondo', '--text', '--bg'],
  ['Texto secundario', '--muted', '--panel'],
  ['Texto sobre acento', '--on-accent', '--accent'],
];

// Ruta 'settings': tema y colores (generales o de la cuenta activa), escalas y disposición. Cada cambio se aplica y se guarda al instante.
export function createSettingsView() {
  const themeGroup = h('div', { className: 'theme-grid', attrs: { role: 'radiogroup', 'aria-label': 'Tema' } });
  const scalesEl = h('div', { className: 'settings-rows' });
  const toggles = new Map(
    TOGGLES.map(([key]) => [key, h('input', { type: 'checkbox', onChange: (event) => update({ [key]: event.target.checked }) })]),
  );
  const togglesEl = h(
    'div',
    { className: 'settings-rows' },
    TOGGLES.map(([key, label, hint]) =>
      h('label', { className: 'settings-check' }, toggles.get(key), h('span', {}, label, h('span', { className: 'person-meta' }, hint))),
    ),
  );
  const presetsEl = h(
    'div',
    { className: 'settings-row' },
    PRESETS.map(([id, label, hint]) => h('button', { className: 'btn', title: hint, onClick: () => render(applyPreset(id)) }, label)),
  );
  // Un selector por color configurable; se crean una sola vez (recrearlos cerraría el selector abierto)
  const colorInputs = new Map(
    COLORS.map(([key, , label]) => {
      const input = h('input', { type: 'color', id: `setting-${key}`, onInput: () => update({ [key]: input.value }) });
      const reset = h('button', { className: 'btn', onClick: () => update({ [key]: '' }) }, 'Usar el del tema');
      reset.setAttribute('aria-label', `${label}: usar el color del tema`);
      return [key, { input, reset }];
    }),
  );
  const colorsEl = h(
    'div',
    { className: 'settings-rows' },
    COLORS.map(([key, , label, hint]) => {
      const { input, reset } = colorInputs.get(key);
      return h('div', { className: 'settings-row' }, h('label', { htmlFor: input.id }, label, h('span', { className: 'person-meta' }, hint)), input, reset);
    }),
  );
  // Quita todos los colores elegidos a mano: el tema vuelve a verse como viene
  const resetColorsBtn = h(
    'button',
    { className: 'btn', onClick: () => update(Object.fromEntries(COLORS.map(([key]) => [key, '']))) },
    'Restablecer los colores del tema',
  );
  const contrastEl = h('div', { className: 'badges contrast-info', attrs: { 'aria-label': 'Contraste de los colores actuales' } });
  // Tema y colores propios de la cuenta activa
  const ownInput = h('input', { type: 'checkbox', onChange: () => render(setOwnTheme(ownInput.checked)) });
  const ownLabel = h('span');
  const ownCard = h(
    'section',
    { className: 'card' },
    h('h2', { className: 'card-title' }, 'Cuenta'),
    h('label', { className: 'settings-check' }, ownInput, ownLabel),
  );
  const scopeEl = h('p', { className: 'person-meta settings-hint' });
  const el = h(
    'div',
    { className: 'view scroll page settings' },
    ownCard,
    h('section', { className: 'card' }, h('h2', { className: 'card-title' }, 'Tema'), scopeEl, themeGroup),
    h(
      'section',
      { className: 'card' },
      h('h2', { className: 'card-title' }, 'Colores'),
      h('p', { className: 'person-meta settings-hint' }, 'Se aplican encima del tema elegido. Conviene un contraste de 4,5:1 o más para leer cómodo.'),
      colorsEl,
      contrastEl,
      h('div', { className: 'settings-row settings-actions' }, resetColorsBtn),
    ),
    h(
      'section',
      { className: 'card' },
      h('h2', { className: 'card-title' }, 'Ajustes rápidos'),
      h('p', { className: 'person-meta settings-hint' }, 'Cambian tamaños y disposición de una vez; el tema y el color no se tocan.'),
      presetsEl,
    ),
    h('section', { className: 'card' }, h('h2', { className: 'card-title' }, 'Tamaños'), scalesEl),
    h('section', { className: 'card' }, h('h2', { className: 'card-title' }, 'Disposición'), togglesEl),
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
    const account = getSettingsAccount();
    ownCard.hidden = !account;
    ownInput.checked = settings.ownTheme;
    ownLabel.replaceChildren(
      'Tema y colores propios para ',
      userName(account?.name ?? ''),
      h('span', { className: 'person-meta' }, 'Apagado, la cuenta usa el tema general. Tamaños y disposición son siempre generales.'),
    );
    scopeEl.replaceChildren(
      ...(settings.ownTheme
        ? ['Estás cambiando el tema y los colores sólo de ', userName(account.name), '.']
        : ['Estás cambiando el tema y los colores generales (los de las cuentas sin tema propio).']),
    );
    // El selector de color necesita un valor: sin color propio muestra el del tema
    for (const [key, token] of COLORS) {
      const { input, reset } = colorInputs.get(key);
      input.value = settings[key] || tokenHex(token) || '#808080';
      reset.disabled = !settings[key];
    }
    resetColorsBtn.disabled = !COLORS.some(([key]) => settings[key]);
    renderContrast();
    for (const [key, input] of toggles) input.checked = settings[key];
    renderScales(settings);
  }

  // Contraste (WCAG) de las combinaciones que más se leen, con los colores vigentes
  function renderContrast() {
    contrastEl.replaceChildren(
      ...CONTRAST_PAIRS.map(([label, fgToken, bgToken]) => {
        const fg = tokenHex(fgToken);
        const bg = tokenHex(bgToken);
        if (!fg || !bg) return null; // color translúcido: no se puede medir
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        const ok = ratio >= 4.5;
        return h('span', { className: `badge${ok ? '' : ' warn'}` }, `${label} ${ratio.toFixed(1).replace('.', ',')}:1 ${ok ? '✓' : '⚠ bajo'}`);
      }).filter(Boolean),
    );
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

// Valor vigente de un token de color como #rrggbb (null si es translúcido o no se puede leer).
// El canvas normaliza cualquier sintaxis de color de CSS.
let colorCtx = null;
function tokenHex(token) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!value) return null;
  colorCtx ??= document.createElement('canvas').getContext('2d');
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = value;
  const color = colorCtx.fillStyle;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  // color-mix() se normaliza como "color(srgb r g b)" con componentes de 0 a 1
  const srgb = color.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!srgb) return null;
  return `#${srgb
    .slice(1)
    .map((c) => Math.round(Math.min(Math.max(Number(c), 0), 1) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}
