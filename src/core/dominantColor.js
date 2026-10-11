export const SAMPLE = 24; // la foto se reduce a SAMPLE×SAMPLE antes de contar colores

// Color predominante de una imagen ya reducida, como '#rrggbb' (null si no hay píxeles opacos).
//   pixels: 4 bytes por píxel · bgra: true si vienen como BGRA (nativeImage de Electron) y no RGBA (canvas)
// Agrupa los píxeles en 512 tonos y devuelve el promedio del grupo con más peso.
// Los colores vivos pesan más que grises, blancos y negros: si no, casi todas las fotos darían un gris.
export function dominantColor(pixels, { bgra = false } = {}) {
  const buckets = new Map();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, a] = bgra
      ? [pixels[i + 2], pixels[i + 1], pixels[i], pixels[i + 3]]
      : [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
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
