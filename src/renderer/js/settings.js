import { api } from './api.js';

// Ajustes de UI (guardados en localStorage). Todo se aplica redefiniendo tokens de styles.css en <html>:
// los temas van por el atributo data-theme y las escalas por variables (--font-scale, --density, --icon-scale).
const KEY = 'uiSettings';

export const THEMES = [
  ['auto', 'Automático', 'Claro u oscuro según el sistema'],
  ['light', 'Claro', 'Fondo claro clásico'],
  ['dark', 'Oscuro', 'Fondo oscuro, descansa la vista'],
  ['minimal', 'Minimal', 'Sin bordes ni sombras, mucho aire'],
  ['glass', 'Glass', 'Paneles translúcidos con desenfoque'],
  ['retro', 'Stale / retro', 'Esquinas rectas, bordes gruesos, monoespaciado'],
  ['contrast', 'Alto contraste', 'Negro, blanco y amarillo, bordes marcados'],
];

// [mínimo, máximo, paso] de cada escala
export const RANGES = {
  zoom: [0.6, 2, 0.05],
  fontScale: [0.8, 1.6, 0.05],
  density: [0.5, 2, 0.1],
  iconScale: [0.7, 1.8, 0.05],
};

export const DEFAULTS = Object.freeze({ theme: 'auto', zoom: 1, fontScale: 1, density: 1, iconScale: 1, accent: '' });

let current = load();

function load() {
  try {
    return sanitize({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') });
  } catch {
    return { ...DEFAULTS };
  }
}

function sanitize(settings) {
  const clean = { ...DEFAULTS };
  if (THEMES.some(([id]) => id === settings.theme)) clean.theme = settings.theme;
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const value = Number(settings[key]);
    if (Number.isFinite(value)) clean[key] = Math.min(Math.max(value, min), max);
  }
  if (/^#[0-9a-f]{6}$/i.test(settings.accent ?? '')) clean.accent = settings.accent;
  return clean;
}

export function getSettings() {
  return { ...current };
}

export function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.style.setProperty('--font-scale', current.fontScale);
  root.style.setProperty('--density', current.density);
  root.style.setProperty('--icon-scale', current.iconScale);
  if (current.accent) {
    root.style.setProperty('--accent', current.accent);
    // texto sobre el acento: negro o blanco, el que más contraste dé con el color elegido
    root.style.setProperty('--on-accent', luminance(current.accent) > 0.179 ? '#000000' : '#ffffff');
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
  }
  api.setZoom(current.zoom).catch((err) => console.warn('[ajustes] zoom', err));
}

// Luminancia relativa (WCAG) de un color #rrggbb
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function updateSettings(patch) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // sin storage: los ajustes duran hasta cerrar la app
  }
  applySettings();
  return getSettings();
}

export function resetSettings() {
  return updateSettings({ ...DEFAULTS });
}
