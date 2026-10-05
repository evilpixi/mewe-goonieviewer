// Genera src/mewe/emojiShortcodes.json ({ "grin": "😁", … }) a partir de emojibase-data.
// MeWe manda los emojis como :codigo: (nombres de JoyPixels en su mayoría); la app los convierte al emoji real.
// Sólo hace falta volver a correrlo (npm run emoji:update) al actualizar emojibase-data.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OUTPUT = new URL('../src/mewe/emojiShortcodes.json', import.meta.url);
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
await fs.writeFile(OUTPUT, `${JSON.stringify(sorted, null, 0)}\n`);
console.log(`${Object.keys(sorted).length} códigos de emoji → ${OUTPUT.pathname}`);
