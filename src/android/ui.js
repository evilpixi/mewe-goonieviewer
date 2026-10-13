import { accountChannels, externalUrl } from '../core/channels.js';
import { dominantColor, SAMPLE } from '../core/dominantColor.js';
import { native } from './platform.js';

// Los canales 'ui:*' en Android (en Electron: src/main/ipc.js)

// La imagen de MeWe servida por nativo con las cookies de la cuenta (ver MediaServer.java).
// Es del mismo origen que la app: se puede dibujar en un canvas y leer sus píxeles.
export function imageUrl(accountId, url) {
  return `/_mewe-img/${accountId}?u=${encodeURIComponent(url)}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
    img.src = src;
  });
}

function draw(img, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, width, height);
  return canvas;
}

const MAX_COLOR_CACHE = 500;
const colors = new Map(); // url → '#rrggbb' | null

async function avatarColor(accountId, url) {
  if (colors.has(url)) return colors.get(url);
  let color = null;
  try {
    const canvas = draw(await loadImage(imageUrl(accountId, url)), SAMPLE, SAMPLE);
    color = dominantColor(canvas.getContext('2d').getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    // imagen ilegible: sin color
  }
  if (colors.size >= MAX_COLOR_CACHE) colors.delete(colors.keys().next().value);
  colors.set(url, color);
  return color;
}

// El portapapeles web sólo acepta PNG: la imagen se redibuja. Si el WebView no deja, { copied: false }
async function copyImage(accountId, url) {
  try {
    const img = await loadImage(imageUrl(accountId, url));
    const canvas = draw(img, img.naturalWidth, img.naturalHeight);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return { copied: true };
  } catch {
    return { copied: false };
  }
}

export function registerUiChannels({ handle, accountManager }) {
  const account = accountChannels(handle, accountManager);

  // Zoom (ajustes de UI): en Android es el tamaño del texto del WebView
  handle('ui:zoom', async (factor) => {
    const zoom = Math.min(Math.max(Number(factor) || 1, 0.5), 2.5);
    await native.setTextZoom({ value: Math.round(zoom * 100) });
    return zoom;
  });

  // Color predominante de una foto de perfil (borde de los globos del chat)
  account('ui:avatarColor', (_client, me, url) => avatarColor(me.id, url));

  // Guarda una imagen o un video de MeWe en la galería
  account('ui:download', (_client, me, url, suggestedName) => native.saveMedia({ accountId: me.id, url, name: suggestedName }));

  account('ui:copyImage', (_client, me, url) => copyImage(me.id, url));

  // No hay cómo copiar "lo que se ve en ese punto" como en Electron
  handle('ui:copyImageAt', () => ({ copied: false }));

  handle('ui:copyText', async (text) => {
    await navigator.clipboard.writeText(String(text ?? '').slice(0, 2000));
    return true;
  });

  // Abre un link en el navegador del teléfono (los links de un perfil). Sólo http(s).
  handle('ui:openExternal', async (url) => {
    await native.openUrl({ url: externalUrl(url) });
    return true;
  });
}
