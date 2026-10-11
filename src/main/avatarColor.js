import { nativeImage } from 'electron';
import { dominantColor, SAMPLE } from '../core/dominantColor.js';

const MAX_CACHE = 500;
const cache = new Map(); // url → '#rrggbb' | null

// Color predominante de una foto de perfil, como '#rrggbb' (null si no se puede leer la imagen).
// Se descarga desde main porque las imágenes de MeWe necesitan las cookies de la cuenta.
export async function avatarColor(client, url) {
  if (cache.has(url)) return cache.get(url);
  const { data } = await client.downloadImage(url);
  const img = nativeImage.createFromBuffer(Buffer.from(data)); // llega como Uint8Array
  const color = img.isEmpty() ? null : dominantColor(img.resize({ width: SAMPLE, height: SAMPLE }).toBitmap(), { bgra: true });
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(url, color);
  return color;
}
