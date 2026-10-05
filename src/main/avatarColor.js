import { nativeImage } from 'electron';

const SAMPLE = 24; // la foto se reduce a SAMPLE×SAMPLE antes de contar colores
const MAX_CACHE = 500;
const cache = new Map(); // url → '#rrggbb' | null

// Color predominante de una foto de perfil, como '#rrggbb' (null si no se puede leer la imagen).
// Se descarga desde main porque las imágenes de MeWe necesitan las cookies de la cuenta.
export async function avatarColor(client, url) {
  if (cache.has(url)) return cache.get(url);
  const { data } = await client.downloadImage(url);
  const color = dominantColor(data);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(url, color);
  return color;
}

// Agrupa los píxeles en 512 tonos y devuelve el promedio del grupo con más peso.
// Los colores vivos pesan más que grises, blancos y negros: si no, casi todas las fotos darían un gris.
function dominantColor(buffer) {
  const img = nativeImage.createFromBuffer(buffer);
  if (img.isEmpty()) return null;
  const pixels = img.resize({ width: SAMPLE, height: SAMPLE }).toBitmap(); // BGRA
  const buckets = new Map();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [b, g, r, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a < 128) continue;
    const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const weight = 1 + 4 * saturation;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? buckets.set(key, { weight: 0, r: 0, g: 0, b: 0 }).get(key);
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.weight > best.weight) best = bucket;
  }
  if (!best) return null;
  const hex = (sum) => Math.round(sum / best.weight).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}
