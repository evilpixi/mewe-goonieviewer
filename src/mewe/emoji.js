import shortcodes from './emojiShortcodes.json' with { type: 'json' };

// MeWe manda los emojis como :codigo: (":grin:"). Los conocidos se convierten al emoji real;
// los propios de MeWe (":hearts_doodle:") no tienen equivalente y quedan como texto.
// La tabla se genera con `npm run emoji:update`.
export function emojify(text) {
  return String(text ?? '').replace(/:([a-z0-9_+-]+):/gi, (match, name) => shortcodes[name.toLowerCase()] ?? match);
}
