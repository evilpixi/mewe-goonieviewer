import { avatar } from './avatar.js';
import { h } from './dom.js';
import { userName } from './userName.js';

// Mención de MeWe dentro de un texto: @{{u_<userId>}Nombre visible}
const MENTION = /@\{\{u_(?<mentionId>[0-9a-f]+)\}(?<mentionName>[^{}\n]*)\}/;
const MENTIONS = new RegExp(MENTION.source, 'g');

// La mención sólo trae el id: la foto se pide con el patrón de la web (sin el fingerprint `f`, que es sólo caché).
// Si MeWe no la entrega, avatar() muestra las iniciales.
const mentionAvatarUrl = (userId) => `https://img.mewe.com/api/v2/photo/profile/150x150/${userId}`;

// GIF de Giphy: MeWe lo manda como el link pelado dentro del texto (mismo patrón que usa la web).
// El #h= / #w= del final es el tamaño que eligió quien lo envió, no parte de la dirección.
const GIPHY = /https?:\/\/(?<gif>media[0-9]*\.giphy\.com\/media\/(?:v1\.[^/\s]+\/)?[0-9a-zA-Z]+\/[0-9a-zA-Z_]+\.(?:gif|mp4)(?:[?&][a-zA-Z_]+=[^\s#<]+)?)(?:\??#[wh]=[0-9]+)?/;
const GIPHYS = new RegExp(GIPHY.source, 'g');

// Formato de texto de MeWe (un subconjunto de Markdown):
//   **negrita** · *itálica* o _itálica_ · ~~tachado~~ · `código` · menciones (ver MENTION) · GIFs de Giphy
// Los marcadores tienen que estar pegados al texto; * y _ sueltos o dentro de una palabra (snake_case) no cuentan.
// El GIF va primero: su dirección tiene _ que si no se tomarían por itálicas.
const RULES = new RegExp(
  `${GIPHY.source}|${
    /@\{\{u_(?<mentionId>[0-9a-f]+)\}(?<mentionName>[^{}\n]*)\}|\*\*\*(?=\S)(?<both>[\s\S]+?)(?<=\S)\*\*\*|\*\*(?=\S)(?<bold>[\s\S]+?)(?<=\S)\*\*|~~(?=\S)(?<strike>[\s\S]+?)(?<=\S)~~|`(?<code>[^`\n]+)`|(?<![\w*_])(?<mark>[*_])(?=\S)(?<italic>(?:(?!\k<mark>)[^\n])+?)(?<=\S)\k<mark>(?![\w*_])/
      .source
  }`,
  'g',
);

// Convierte el texto en nodos (strings y <strong>/<em>/<s>/<code>) para pasarle a h() como hijos.
// Nunca usa innerHTML: lo que no es formato queda como texto plano.
//   context: { accountId, navigate } → las menciones llevan la foto y abren el perfil
export function richText(text, context = {}) {
  const source = String(text ?? '');
  const nodes = [];
  let last = 0;
  for (const match of source.matchAll(RULES)) {
    if (match.index > last) nodes.push(source.slice(last, match.index));
    const { gif, mentionId, mentionName, both, bold, strike, code, italic } = match.groups;
    if (gif) nodes.push(giphy(gif, match[0]));
    else if (mentionId) nodes.push(mention(mentionId, mentionName, context));
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

// El GIF animado en lugar de su link (la variante .mp4 de Giphy tiene su .gif al lado).
// Se pide directo a Giphy (permitido en la CSP de index.html); si no carga, queda el link como texto.
function giphy(path, original) {
  const img = h('img', { className: 'gif-embed', src: `https://${path.replace(/\.mp4(?=$|[?&])/, '.gif')}`, alt: 'GIF', title: 'GIF de Giphy', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(original), { once: true });
  return img;
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
// deja las menciones como "@Nombre" y los GIFs de Giphy como "GIF"
export function plainText(text) {
  return String(text ?? '').replace(GIPHYS, 'GIF').replace(MENTIONS, '@$<mentionName>');
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[#*0-9]️?⃣|[‍️\s])+$/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Cantidad de emojis si el texto son sólo emojis (y espacios); 0 si tiene algo más
export function emojiOnlyCount(text) {
  const value = String(text ?? '').trim();
  if (!value || !EMOJI_ONLY.test(value)) return 0;
  return [...segmenter.segment(value)].filter(({ segment }) => segment.trim()).length;
}
