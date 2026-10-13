// Genera src/mewe/emojiShortcodes.js (export default { "grin": "😁", … }) a partir de emojibase-data.
// Es un módulo y no un .json: importar JSON no funciona en los WebView viejos de Android.
// MeWe manda los emojis como :codigo: (nombres de JoyPixels en su mayoría); la app los convierte al emoji real.
// Sólo hace falta volver a correrlo (npm run emoji:update) al actualizar emojibase-data.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OUTPUT = new URL('../src/mewe/emojiShortcodes.js', import.meta.url);
// Si dos fuentes usan el mismo código para emojis distintos, gana la primera
const SOURCES = ['joypixels', 'iamcal', 'github', 'emojibase', 'emojibase-legacy'];

const unicode = new Map();
for (const emoji of require('emojibase-data/en/compact.json')) {
  unicode.set(emoji.hexcode, emoji.unicode);
  for (const skin of emoji.skins ?? []) unicode.set(skin.hexcode, skin.unicode);
}

const shortcodes = {};
for (const source of SOURCES) {
  const data = require(`emojibase-data/en/shortcodes/${source}.json`);
  for (const [hexcode, names] of Object.entries(data)) {
    const emoji = unicode.get(hexcode);
    if (!emoji) continue;
    for (const name of [names].flat()) {
      // los puramente numéricos chocarían con horas escritas como 10:30:45
      if (!/^\d+$/.test(name)) shortcodes[name.toLowerCase()] ??= emoji;
    }
  }
}

const sorted = Object.fromEntries(Object.entries(shortcodes).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(OUTPUT, `// Generado por scripts/build-emoji.js: no editar a mano\nexport default ${JSON.stringify(sorted, null, 0)};\n`);
console.log(`${Object.keys(sorted).length} códigos de emoji → ${OUTPUT.pathname}`);

// --- Catálogo del selector de emojis (src/renderer/js/ui/emojiData.js) ---
// Los emojis que entiende MeWe (los que tienen código de JoyPixels), en las categorías de su selector y en su
// orden. Cada uno va con su nombre en español y las palabras por las que se lo puede buscar.
// Sin las variantes de tono de piel.
const PICKER_OUTPUT = new URL('../src/renderer/js/ui/emojiData.js', import.meta.url);
// [id, nombre, emoji de la pestaña, grupos de Unicode que junta]
const CATEGORIES = [
  ['people', 'Caritas y personas', '😀', [0, 1]],
  ['nature', 'Animales y naturaleza', '🐻', [3]],
  ['food', 'Comida y bebida', '🍔', [4]],
  ['activity', 'Actividades', '⚽', [6]],
  ['travel', 'Viajes y lugares', '🚗', [5]],
  ['objects', 'Objetos', '💡', [7]],
  ['symbols', 'Símbolos', '💟', [8]],
  ['flags', 'Banderas', '🏁', [9]],
];
// sin acentos ni mayúsculas, como se compara al buscar (ver emojiPicker.js)
const fold = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const joypixels = require('emojibase-data/en/shortcodes/joypixels.json');
const spanish = require('emojibase-data/es/compact.json').sort((a, b) => a.order - b.order);
const catalog = CATEGORIES.map(([id, name, icon, groups]) => ({
  id,
  name,
  icon,
  emojis: spanish
    .filter((emoji) => groups.includes(emoji.group) && joypixels[emoji.hexcode])
    .map((emoji) => {
      const codes = [joypixels[emoji.hexcode]].flat().map((code) => code.replaceAll('_', ' '));
      const words = new Set(fold([emoji.label, ...(emoji.tags ?? []), ...codes].join(' ')).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
      return [emoji.unicode, emoji.label, [...words].join(' ')];
    }),
}));

await fs.writeFile(PICKER_OUTPUT, `// Generado por scripts/build-emoji.js: no editar a mano\nexport default ${JSON.stringify(catalog, null, 0)};\n`);
console.log(`${catalog.reduce((sum, category) => sum + category.emojis.length, 0)} emojis en ${catalog.length} categorías → ${PICKER_OUTPUT.pathname}`);
