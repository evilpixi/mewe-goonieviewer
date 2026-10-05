import { api } from './api.js';

// Ajustes de UI (guardados en localStorage). Todo se aplica redefiniendo tokens de styles.css en <html>:
// los temas van por el atributo data-theme, las escalas por variables (--font-scale, --density, --icon-scale…)
// y las opciones de disposición por atributos (data-full-width, data-compact-threads).
// La apariencia (tema y colores) puede ser propia de cada cuenta: ver setOwnTheme.
const KEY = 'uiSettings';

export const THEMES = [
  ['auto', 'Automático', 'Claro u oscuro según el sistema'],
  ['light', 'Claro', 'Fondo claro clásico'],
  ['dark', 'Oscuro', 'Fondo oscuro, descansa la vista'],
  ['minimal', 'Minimal', 'Sin bordes ni sombras, mucho aire'],
  ['glass', 'Glass', 'Paneles translúcidos con desenfoque'],
  ['retro', 'Stale / retro', 'Esquinas rectas, bordes gruesos, monoespaciado'],
  ['contrast', 'Alto contraste', 'Negro, blanco y amarillo, bordes marcados'],
  ['midnight', 'Medianoche', 'Negro puro con texto claro, ideal para teles y OLED'],
  ['nord', 'Nórdico', 'Gris azulado oscuro y suave'],
  ['forest', 'Bosque', 'Oscuro con verdes'],
  ['amber', 'Ámbar', 'Oscuro con texto cálido, tipo terminal'],
  ['sepia', 'Sepia', 'Papel cálido, cómodo para leer mucho'],
  ['ocean', 'Océano', 'Claro con azules'],
  ['rose', 'Rosa', 'Claro con rosas'],
];

// Colores que se pueden cambiar sobre cualquier tema: [clave, token, etiqueta, descripción]
export const COLORS = [
  ['accent', '--accent', 'Acento', 'Botones, enlaces y globos propios'],
  ['bg', '--bg', 'Fondo', 'Detrás de publicaciones y mensajes'],
  ['panel', '--panel', 'Paneles', 'Publicaciones, tarjetas, cabecera y globos ajenos'],
  ['text', '--text', 'Texto', 'Color principal del texto'],
  ['sidebar', '--sidebar', 'Columna de cuentas', 'La barra de la izquierda'],
];

// Lo que puede ser propio de cada cuenta
const APPEARANCE_KEYS = ['theme', ...COLORS.map(([key]) => key)];

// [mínimo, máximo, paso] de cada escala
export const RANGES = {
  zoom: [0.6, 2.5, 0.05],
  fontScale: [0.8, 4, 0.05],
  chatFontScale: [1, 3, 0.05],
  lineScale: [0.75, 1.3, 0.05],
  density: [0.2, 2, 0.05],
  iconScale: [0.7, 3, 0.05],
};

// Opciones sí/no → atributo en <html>
const FLAGS = {
  fullWidth: 'data-full-width',
  compactThreads: 'data-compact-threads',
  chatCover: 'data-chat-cover',
};

export const DEFAULTS = Object.freeze({
  theme: 'auto',
  zoom: 1,
  fontScale: 1,
  chatFontScale: 1,
  lineScale: 1,
  density: 1,
  iconScale: 1,
  fullWidth: false,
  compactThreads: false,
  chatCover: false,
  accent: '',
  bg: '',
  panel: '',
  text: '',
  sidebar: '',
});

// Lo que cambian los ajustes rápidos: tamaños y disposición (el fondo del chat es un gusto aparte)
const LAYOUT_DEFAULTS = Object.fromEntries(
  Object.entries(DEFAULTS).filter(([key]) => !APPEARANCE_KEYS.includes(key) && key !== 'chatCover'),
);

// Ajustes rápidos: cambian escalas y disposición, no el tema ni el acento.
// "tv" apunta a una tele en 720p vista a unos 4 m: mensajes a ~35 px, resto de la UI a ~25 px.
export const PRESETS = [
  ['desktop', 'Escritorio', 'Valores por defecto', LAYOUT_DEFAULTS],
  [
    'tv',
    'TV a distancia',
    'Texto grande y compacto para leer a varios metros',
    { ...LAYOUT_DEFAULTS, fontScale: 1.8, chatFontScale: 1.4, lineScale: 0.9, density: 0.7, iconScale: 1.6, fullWidth: true, compactThreads: true },
  ],
];

let { current, overrides } = load(); // ajustes generales · apariencia propia por id de cuenta
let account = null; // cuenta activa: { id, name }

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const accounts = {};
    for (const [id, value] of Object.entries(stored.accounts ?? {})) accounts[id] = appearanceOf(sanitize(value ?? {}));
    return { current: sanitize(stored), overrides: accounts };
  } catch {
    return { current: { ...DEFAULTS }, overrides: {} };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, accounts: overrides }));
  } catch {
    // sin storage: los ajustes duran hasta cerrar la app
  }
}

function appearanceOf(settings) {
  return Object.fromEntries(APPEARANCE_KEYS.map((key) => [key, settings[key]]));
}

// Ajustes vigentes: los generales, con la apariencia de la cuenta activa encima si tiene una propia
function effective() {
  return { ...current, ...(account && overrides[account.id]) };
}

function sanitize(settings) {
  const clean = { ...DEFAULTS };
  if (THEMES.some(([id]) => id === settings.theme)) clean.theme = settings.theme;
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const value = Number(settings[key]);
    if (Number.isFinite(value)) clean[key] = Math.min(Math.max(value, min), max);
  }
  for (const key of Object.keys(FLAGS)) clean[key] = settings[key] === true;
  for (const [key] of COLORS) {
    if (/^#[0-9a-f]{6}$/i.test(settings[key] ?? '')) clean[key] = settings[key];
  }
  return clean;
}

// ownTheme: la cuenta activa tiene tema y colores propios (los cambios de apariencia van sólo a ella)
export function getSettings() {
  return { ...effective(), ownTheme: Boolean(account && overrides[account.id]) };
}

export function getSettingsAccount() {
  return account;
}

// Cuenta activa (o null): aplica su apariencia propia si la tiene
export function setSettingsAccount(newAccount) {
  account = newAccount ? { id: newAccount.id, name: newAccount.name } : null;
  applySettings();
}

// Activa o quita la apariencia propia de la cuenta activa. Al activarla arranca con la que se está viendo.
export function setOwnTheme(enabled) {
  if (!account) return getSettings();
  if (enabled) overrides[account.id] ??= appearanceOf(effective());
  else delete overrides[account.id];
  save();
  applySettings();
  return getSettings();
}

export function applySettings() {
  const settings = effective();
  const root = document.documentElement;
  const setVar = (name, value) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name));
  // negro o blanco, el que más contraste dé sobre el color elegido
  const onColor = (hex) => hex && (luminance(hex) > 0.179 ? '#000000' : '#ffffff');

  root.dataset.theme = settings.theme;
  root.style.setProperty('--font-scale', settings.fontScale);
  root.style.setProperty('--chat-font-scale', settings.chatFontScale);
  root.style.setProperty('--line-scale', settings.lineScale);
  root.style.setProperty('--density', settings.density);
  root.style.setProperty('--icon-scale', settings.iconScale);
  for (const [key, attr] of Object.entries(FLAGS)) root.toggleAttribute(attr, settings[key]);

  for (const [key, token] of COLORS) setVar(token, settings[key]);
  // Tokens que dependen de un color elegido a mano: se recalculan para que sigan siendo legibles
  setVar('--on-accent', onColor(settings.accent));
  setVar('--on-sidebar', onColor(settings.sidebar));
  setVar('--sidebar-item', settings.sidebar && 'color-mix(in srgb, var(--sidebar) 78%, var(--on-sidebar))');
  setVar('--sidebar-item-border', settings.sidebar && 'color-mix(in srgb, var(--sidebar) 50%, var(--on-sidebar))');
  setVar('--muted', (settings.text || settings.bg || settings.panel) && 'color-mix(in srgb, var(--text) 72%, var(--panel))');
  setVar('--border', (settings.bg || settings.panel) && 'color-mix(in srgb, var(--text) 24%, var(--panel))');
  setVar('--bubble', settings.panel && 'var(--panel)');
  setVar('--bg-image', settings.bg && 'none'); // el fondo decorativo del tema taparía el color elegido
  root.style.colorScheme = settings.bg ? (luminance(settings.bg) > 0.179 ? 'light' : 'dark') : '';

  api.setZoom(settings.zoom).catch((err) => console.warn('[ajustes] zoom', err));
}

// Luminancia relativa (WCAG) de un color #rrggbb
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function updateSettings(patch) {
  const own = account && overrides[account.id];
  if (own) {
    // con apariencia propia, tema y colores se guardan en la cuenta; el resto sigue siendo general
    overrides[account.id] = appearanceOf(sanitize({ ...own, ...patch }));
    current = sanitize({ ...current, ...patch, ...appearanceOf(current) });
  } else {
    current = sanitize({ ...current, ...patch });
  }
  save();
  applySettings();
  return getSettings();
}

export function applyPreset(id) {
  const preset = PRESETS.find(([presetId]) => presetId === id);
  return preset ? updateSettings(preset[3]) : getSettings();
}

// Vuelve todo a los valores por defecto (también la apariencia propia de la cuenta activa)
export function resetSettings() {
  if (account) delete overrides[account.id];
  current = { ...DEFAULTS };
  save();
  applySettings();
  return getSettings();
}
