import { avatar } from './avatar.js';
import { h } from './dom.js';
import { userName } from './userName.js';

// Mención de MeWe dentro de un texto: @{{u_<userId>}Nombre visible}
const MENTION = /@\{\{u_(?<mentionId>[0-9a-f]+)\}(?<mentionName>[^{}\n]*)\}/;
const MENTIONS = new RegExp(MENTION.source, 'g');

// La mención sólo trae el id: la foto se pide con el patrón de la web (sin el fingerprint `f`, que es sólo caché).
// Si MeWe no la entrega, avatar() muestra las iniciales.
const mentionAvatarUrl = (userId) => `https://img.mewe.com/api/v2/photo/profile/150x150/${userId}`;

// Formato de texto de MeWe (un subconjunto de Markdown):
//   **negrita** · *itálica* o _itálica_ · ~~tachado~~ · `código` · menciones (ver MENTION)
// Los marcadores tienen que estar pegados al texto; * y _ sueltos o dentro de una palabra (snake_case) no cuentan.
const RULES =
  /@\{\{u_(?<mentionId>[0-9a-f]+)\}(?<mentionName>[^{}\n]*)\}|\*\*\*(?=\S)(?<both>[\s\S]+?)(?<=\S)\*\*\*|\*\*(?=\S)(?<bold>[\s\S]+?)(?<=\S)\*\*|~~(?=\S)(?<strike>[\s\S]+?)(?<=\S)~~|`(?<code>[^`\n]+)`|(?<![\w*_])(?<mark>[*_])(?=\S)(?<italic>(?:(?!\k<mark>)[^\n])+?)(?<=\S)\k<mark>(?![\w*_])/g;

// Convierte el texto en nodos (strings y <strong>/<em>/<s>/<code>) para pasarle a h() como hijos.
// Nunca usa innerHTML: lo que no es formato queda como texto plano.
//   context: { accountId, navigate } → las menciones llevan la foto y abren el perfil
export function richText(text, context = {}) {
  const source = String(text ?? '');
  const nodes = [];
  let last = 0;
  for (const match of source.matchAll(RULES)) {
    if (match.index > last) nodes.push(source.slice(last, match.index));
    const { mentionId, mentionName, both, bold, strike, code, italic } = match.groups;
    if (mentionId) nodes.push(mention(mentionId, mentionName, context));
    else if (both) nodes.push(h('strong', {}, h('em', {}, richText(both, context))));
    else if (bold) nodes.push(h('strong', {}, richText(bold, context)));
    else if (strike) nodes.push(h('s', {}, richText(strike, context)));
    else if (code) nodes.push(h('code', {}, code));
    else nodes.push(h('em', {}, richText(italic, context)));
    last = match.index + match[0].length;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}

// Foto chiquita (del alto de la línea) + nombre; con `navigate` es un link al perfil
function mention(userId, name, { accountId, navigate }) {
  const children = [
    accountId && avatar(accountId, mentionAvatarUrl(userId), { name, size: 'inline' }),
    userName(name, { fallback: 'Usuario' }),
  ];
  if (!navigate) return h('span', { className: 'mention' }, children);
  return h(
    'button',
    {
      type: 'button',
      className: 'link-btn mention',
      onClick: (event) => {
        event.stopPropagation(); // dentro de una cita o un resultado, no dispara el click de afuera
        navigate('profile', { userId });
      },
    },
    children,
  );
}

// Para lugares de una sola línea sin formato (citas, vista previa del chat, notificaciones):
// deja las menciones como "@Nombre"
export function plainText(text) {
  return String(text ?? '').replace(MENTIONS, '@$<mentionName>');
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[#*0-9]️?⃣|[‍️\s])+$/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Cantidad de emojis si el texto son sólo emojis (y espacios); 0 si tiene algo más
export function emojiOnlyCount(text) {
  const value = String(text ?? '').trim();
  if (!value || !EMOJI_ONLY.test(value)) return 0;
  return [...segmenter.segment(value)].filter(({ segment }) => segment.trim()).length;
}
