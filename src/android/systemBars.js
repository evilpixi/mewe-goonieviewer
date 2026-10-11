// La app dibuja debajo de las barras del sistema (hora, batería, gestos): sus iconos tienen que contrastar
// con el fondo del tema de la app, que puede no coincidir con el del teléfono. Cada vez que cambia el tema
// (o los colores de una cuenta) se avisa a Capacitor si el fondo es oscuro o claro.
const systemBars = window.Capacitor.Plugins.SystemBars;
let current = null;
let pending = false;

function sync() {
  pending = false;
  const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
  if (b === undefined) return;
  // DARK: fondo oscuro, iconos claros
  const style = 0.299 * r + 0.587 * g + 0.114 * b < 140 ? 'DARK' : 'LIGHT';
  if (style === current) return;
  current = style;
  systemBars?.setStyle({ style }).catch(() => {});
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
