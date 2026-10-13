import { native } from './platform.js';

// La app dibuja debajo de las barras del sistema (hora, batería, gestos): sus iconos tienen que contrastar
// con el fondo del tema de la app, que puede no coincidir con el del teléfono. Cada vez que cambia el tema
// (o los colores de una cuenta) se avisa a Capacitor si el fondo es oscuro o claro.
// El mismo color va también a la ventana nativa: es lo que se ve donde el WebView no llega (ver setWindowColor
// en MeweNativePlugin.java). Si no, ahí asoma el gris del tema de Android.
const systemBars = window.Capacitor.Plugins.SystemBars;
let current = null;
let currentColor = null;
let pending = false;

function sync() {
  pending = false;
  const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
  if (b === undefined) return;
  // DARK: fondo oscuro, iconos claros
  const style = 0.299 * r + 0.587 * g + 0.114 * b < 140 ? 'DARK' : 'LIGHT';
  const color = `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
  if (style === current && color === currentColor) return;
  const styled = style === current ? Promise.resolve() : (systemBars?.setStyle({ style }) ?? Promise.resolve());
  current = style;
  currentColor = color;
  // setStyle repinta la ventana con el color del tema de Android: el nuestro va después
  styled.catch(() => {}).then(() => native.setWindowColor({ color })).catch(() => {});
}

function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(sync);
}

export function followTheme() {
  // los ajustes de UI (src/renderer/js/settings.js) viven en <html>: data-theme y variables en style
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
  schedule();
}
