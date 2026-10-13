// Tiradas de dados de rol en el chat: "/roll 2d20", "/roll d6 + 2d8 - 1 {con un mensaje}" o el selector
// (ver dicePicker.js).
// El resultado se envía como un mensaje de texto común, así se ve igual en la app oficial de MeWe:
//   ꧁𓊈𒆜❖ **/ROLL** ❖𒆜𓊉꧂
//   > con un mensaje
//
//   ► **2d20** = 21
//   🎲 14 ⇥ 🎲 7              (⇥ = tabulación; hasta COLUMNS dados por línea)
//
//   ► **+3**
//
//   **Σ = 24**
export const MAX_DICE = 20;
export const MIN_FACES = 2;
export const MAX_FACES = 100;
export const MAX_MODIFIER = 999;

const COMMAND = /^\/roll(?:\s+|$)/i;
const TERM = /\s*([+-]?)\s*(?:(\d*)d(\d+)|(\d+))/iy;
const COLUMNS = 4;
// Espacio del ancho de un dígito: empareja los números para que la tabulación caiga siempre en la misma columna
const FIGURE_SPACE = '\u2007';
const HEADER = '꧁𓊈𒆜❖ **/ROLL** ❖𒆜𓊉꧂';
// Mensaje opcional al final del comando, entre llaves (la de cierre se puede olvidar)
const NOTE = /\{([\s\S]*?)\}?$/;
const USAGE = 'Escribe los dados después de /roll, por ejemplo: /roll 2d20';

export const isRollCommand = (text) => COMMAND.test(text);

// "/roll 2d20 + d6 - 3 {mensaje}" → { groups: [{ count, faces }], modifier, note }; los dados de las mismas
// caras se juntan.
// Lanza un Error con el motivo si no se entiende o se pasa de los límites.
export function parseRoll(text) {
  const command = text.replace(COMMAND, '').trim();
  const note = NOTE.exec(command)?.[1].trim() ?? '';
  const source = command.replace(NOTE, '').trim();
  if (!source) throw new Error(USAGE);
  const dice = new Map(); // caras → cantidad
  let modifier = 0;
  for (let position = 0; position < source.length; position = TERM.lastIndex) {
    TERM.lastIndex = position;
    const match = TERM.exec(source);
    if (!match) throw new Error(USAGE);
    const [, sign, count, faces, number] = match;
    if (faces === undefined) {
      modifier += (sign === '-' ? -1 : 1) * Number(number);
    } else {
      if (sign === '-') throw new Error('Los dados sólo se pueden sumar.');
      dice.set(Number(faces), (dice.get(Number(faces)) ?? 0) + (count === '' ? 1 : Number(count)));
    }
  }
  return checkRoll({ groups: [...dice].map(([faces, count]) => ({ count, faces })), modifier, note });
}

// Devuelve la misma tirada si respeta los límites; si no, lanza un Error con el motivo
export function checkRoll(spec) {
  const total = spec.groups.reduce((sum, { count }) => sum + count, 0);
  if (!total) throw new Error(USAGE);
  if (total > MAX_DICE) throw new Error(`Máximo ${MAX_DICE} dados por tirada.`);
  if (spec.groups.some(({ faces }) => faces < MIN_FACES || faces > MAX_FACES)) {
    throw new Error(`Los dados van de ${MIN_FACES} a ${MAX_FACES} caras.`);
  }
  if (Math.abs(spec.modifier) > MAX_MODIFIER) throw new Error(`El modificador va de -${MAX_MODIFIER} a ${MAX_MODIFIER}.`);
  return spec;
}

// "2d20+1d6-3"
export function rollNotation({ groups, modifier }) {
  const dice = groups.map(({ count, faces }) => `${count}d${faces}`).join('+');
  return modifier ? `${dice}${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}` : dice;
}

const sum = (values) => values.reduce((a, b) => a + b, 0);

// Tira los dados y devuelve el texto del mensaje: el mensaje de quien tira como cita, un bloque por tipo de dado
// (y otro para el modificador) y, si hay más de un bloque, el total al final.
export function rollMessage(spec, random = Math.random) {
  // al menos 2: con números de una cifra la tabulación quedaba del ancho de un espacio
  const width = Math.max(2, String(Math.max(...spec.groups.map(({ faces }) => faces))).length);
  let total = spec.modifier;
  const blocks = spec.groups.map(({ count, faces }) => {
    const values = Array.from({ length: count }, () => Math.floor(random() * faces) + 1);
    total += sum(values);
    const rows = [];
    for (let i = 0; i < values.length; i += COLUMNS) {
      const cells = values.slice(i, i + COLUMNS).map((value) => `🎲 ${String(value).padEnd(width, FIGURE_SPACE)}`);
      rows.push(cells.join('\t').trimEnd());
    }
    return [`► **${count}d${faces}** = ${sum(values)}`, ...rows].join('\n');
  });
  if (spec.modifier) blocks.push(`► **${spec.modifier > 0 ? '+' : '-'}${Math.abs(spec.modifier)}**`);
  if (blocks.length > 1) blocks.push(`**Σ = ${total}**`);
  // cada línea del mensaje lleva su ">" (las vacías también, para que la cita no se corte ahí), y después va
  // una línea en blanco: sin ella, Markdown sigue la cita
  const quote = spec.note ? spec.note.split('\n').map((line) => `> ${line}`.trimEnd()) : [];
  return [HEADER, ...(quote.length ? [...quote, ''] : []), blocks.join('\n\n')].join('\n');
}
