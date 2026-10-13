import { avatar } from '../ui/avatar.js';
import { h } from '../ui/dom.js';
import { openEmojiPicker } from '../ui/emojiPicker.js';
import { takeFiles } from '../ui/files.js';
import { icon } from '../ui/icon.js';
import { attachMentions } from '../ui/mentions.js';
import { isMobile } from '../ui/mobile.js';
import { plainText } from '../ui/richText.js';
import { userName } from '../ui/userName.js';
import { isRollCommand, parseRoll, rollMessage } from './dice.js';
import { openDicePicker } from './dicePicker.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_FILES = 10;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // igual que en MeweClient
const isVideo = (file) => file.type.startsWith('video/');
// Pausa entre tiradas de dados, para que no llenen el chat
const ROLL_COOLDOWN = 2000;

// Temporizador: se usa o no, siempre con esta duración (segundos). MeWe sólo hace desaparecer fotos/videos,
// así que aplica a las imágenes y videos adjuntos.
const TIMER_SECONDS = 86400;

// Caja de redacción del chat.
//   onSend({ text, files, replyTo, expiresIn, editId }) → promesa; si se resuelve, se limpia la caja
//   (y, si resuelve con un texto, queda como aviso en el estado)
//   (editId: id del mensaje que se está editando; ahí sólo importa `text`)
// Imágenes, GIFs y videos: botón 📎, Ctrl+V con uno en el portapapeles, o arrastrarlos (ver acceptDrop).
// Menciones: "@" y el nombre abren un menú para elegir a quién mencionar (ver ui/mentions.js).
// Dados de rol: botón 🎲 (elige los dados y envía la tirada) o escribir "/roll 2d20" (ver dice.js).
// Dos filas: arriba la caja de texto a todo el ancho, abajo los botones (con "Enviar" al final).
// Botón "Enter envía" (sólo escritorio): elige si Enter envía el mensaje o hace un salto de línea.
// En mobile Enter siempre hace un salto de línea: se envía con el botón.
// Botón ⤢: caja grande para textos de varias líneas (ahí Enter hace salto de línea y Ctrl+Enter envía).
// El placeholder es corto para que entre en una línea; las teclas van en el title.
const PLACEHOLDER = 'Escribe un mensaje…';
const HINT = 'Enter envía, Shift+Enter hace salto de línea';
const HINT_NEWLINE = 'Enter hace salto de línea, Ctrl+Enter envía';
const ENTER_SENDS_KEY = 'chatEnterSends';

function storedEnterSends() {
  try {
    return localStorage.getItem(ENTER_SENDS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function createComposer({ onSend }) {
  const textarea = h('textarea', {
    name: 'text',
    rows: 1,
    placeholder: PLACEHOLDER,
    title: HINT,
    attrs: { 'aria-label': 'Mensaje' },
  });
  const emojiBtn = h(
    'button',
    { type: 'button', className: 'btn icon-btn', title: 'Insertar emoji', attrs: { 'aria-label': 'Insertar emoji', 'aria-haspopup': 'dialog' } },
    icon('smile'),
  );
  const diceBtn = h(
    'button',
    { type: 'button', className: 'btn icon-btn', title: 'Tirar dados (/roll 2d20)', attrs: { 'aria-label': 'Tirar dados', 'aria-haspopup': 'dialog' } },
    icon('dices'),
  );
  const expandBtn = h(
    'button',
    { type: 'button', className: 'btn icon-btn expand-btn', title: 'Agrandar la caja de texto', attrs: { 'aria-label': 'Agrandar la caja de texto', 'aria-pressed': 'false' } },
    icon('maximize-2'),
  );
  // en mobile no se muestra (ver styles.css)
  const enterBtn = h('button', { type: 'button', className: 'btn enter-btn' }, icon('corner-down-left'), h('span', {}, 'Enter envía'));
  // en mobile se ve sólo el ícono (ver styles.css)
  const sendIcon = icon('send');
  sendIcon.classList.add('label-icon');
  const sendLabel = h('span', { className: 'label-text' }, 'Enviar');
  const sendBtn = h('button', { type: 'submit', className: 'btn primary send-btn', title: 'Enviar' }, sendIcon, sendLabel);
  // Foto de la cuenta que va a escribir (ver setAccount)
  const meEl = h('span', { className: 'writing-as', attrs: { role: 'img' }, hidden: true });
  const fileInput = h('input', {
    type: 'file',
    accept: [...IMAGE_TYPES, 'video/*'].join(','),
    multiple: true,
    hidden: true,
    attrs: { 'aria-hidden': 'true', tabindex: '-1' },
  });
  const attachBtn = h(
    'button',
    { type: 'button', className: 'btn icon-btn', title: 'Adjuntar imagen o video', attrs: { 'aria-label': 'Adjuntar imagen o video' } },
    icon('paperclip'),
  );
  const replyText = h('span', { className: 'composer-reply-text' });
  const replyBar = h(
    'div',
    { className: 'composer-reply', hidden: true },
    h('span', { className: 'composer-reply-label' }, icon('reply'), ' Respondiendo a'),
    replyText,
    h(
      'button',
      { type: 'button', className: 'icon-btn', title: 'Cancelar respuesta', attrs: { 'aria-label': 'Cancelar respuesta' }, onClick: () => setReplyTo(null) },
      icon('x'),
    ),
  );
  // Edición de un mensaje propio (ver setEditing): el texto se corrige en la misma caja
  const editText = h('span', { className: 'composer-reply-text' });
  const editBar = h(
    'div',
    { className: 'composer-reply', hidden: true },
    h('span', { className: 'composer-reply-label' }, icon('pencil'), ' Editando'),
    editText,
    h(
      'button',
      { type: 'button', className: 'icon-btn', title: 'Cancelar edición (Esc)', attrs: { 'aria-label': 'Cancelar edición' }, onClick: () => cancelEditing() },
      icon('x'),
    ),
  );
  const timerBtn = h(
    'button',
    {
      type: 'button',
      className: 'btn composer-timer',
      title: 'Temporizador (24 h): la imagen o el video desaparece después de verlo',
      attrs: { 'aria-pressed': 'false' },
      onClick: () => setTimed(!timed),
    },
    icon('timer'),
    ' Temporal',
  );
  const thumbs = h('div', { className: 'composer-thumbs' });
  const attachmentsBar = h('div', { className: 'composer-attachments', hidden: true }, thumbs, timerBtn);
  const status = h('div', { className: 'composer-status', attrs: { 'aria-live': 'polite' } });
  const el = h(
    'form',
    { className: 'chat-composer' },
    replyBar,
    editBar,
    attachmentsBar,
    status,
    textarea,
    h('div', { className: 'composer-row' }, meEl, attachBtn, emojiBtn, diceBtn, expandBtn, h('span', { className: 'composer-spacer' }), enterBtn, sendBtn),
    fileInput,
  );

  let files = []; // [{ file, url }]
  let replyTo = null;
  let editing = null; // mensaje que se está editando
  let timed = false; // lo adjunto va con temporizador
  let busy = false;
  let expanded = false;
  let enterSends = storedEnterSends();
  let lastRoll = 0;
  let accountId = null;
  let people = null; // quiénes están en el chat (ver setPeople)
  const mentions = attachMentions(textarea, { accountId: () => accountId, people: () => people?.() ?? [] });

  // ¿Enter (sin modificadores) envía? Si no, hace un salto de línea y se envía con Ctrl+Enter o con el botón.
  const sendsOnEnter = () => enterSends && !expanded && !isMobile();

  function renderEnterMode() {
    enterBtn.setAttribute('aria-pressed', String(enterSends));
    enterBtn.title = enterSends ? 'Enter envía el mensaje. Click para que haga un salto de línea.' : 'Enter hace un salto de línea. Click para que envíe el mensaje.';
    textarea.title = sendsOnEnter() ? HINT : HINT_NEWLINE;
    // la tecla Enter del teclado en pantalla
    textarea.enterKeyHint = sendsOnEnter() ? 'send' : 'enter';
  }

  function setEnterSends(value) {
    enterSends = value;
    try {
      localStorage.setItem(ENTER_SENDS_KEY, String(value));
    } catch {
      // sin almacenamiento: vale hasta cerrar la app
    }
    renderEnterMode();
    textarea.focus();
  }

  function setTimed(value) {
    timed = value;
    timerBtn.setAttribute('aria-pressed', String(timed));
  }

  function setExpanded(value) {
    expanded = value;
    el.classList.toggle('expanded', expanded);
    expandBtn.setAttribute('aria-pressed', String(expanded));
    expandBtn.replaceChildren(icon(expanded ? 'minimize-2' : 'maximize-2'));
    expandBtn.title = expanded ? 'Achicar la caja de texto' : 'Agrandar la caja de texto';
    expandBtn.setAttribute('aria-label', expandBtn.title);
    renderEnterMode();
    autosize();
    textarea.focus();
  }

  // Inserta texto donde está el cursor (reemplaza la selección)
  function insertText(text) {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
    autosize();
    textarea.focus();
  }

  // Pone la caja a editar `message` (su texto pasa a la caja); null vuelve a redactar un mensaje nuevo
  function setEditing(message) {
    if (message) setReplyTo(null);
    editing = message;
    editBar.hidden = !message;
    attachBtn.disabled = diceBtn.disabled = Boolean(message);
    sendBtn.title = sendLabel.textContent = message ? 'Guardar' : 'Enviar';
    if (!message) return;
    editText.textContent = plainText(message.text);
    textarea.value = mentions.decode(message.text); // las menciones se ven como "@Nombre"
    autosize();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function cancelEditing() {
    if (!editing) return;
    setEditing(null);
    textarea.value = '';
    autosize();
    textarea.focus();
  }

  function setReplyTo(message, authorName = '') {
    if (message) cancelEditing();
    replyTo = message;
    replyBar.hidden = !message;
    if (message) {
      replyText.replaceChildren(
        userName(authorName || (message.mine ? 'ti' : message.author), { className: 'composer-reply-author' }),
        ': ',
        plainText(message.text) || (message.images.length ? '📷 Imagen' : '…'),
      );
      textarea.focus();
    }
  }

  function addFiles(list) {
    const media = [...list].filter((f) => IMAGE_TYPES.includes(f.type) || isVideo(f));
    if (!media.length || editing) return false; // al editar sólo cambia el texto
    const fit = media.filter((f) => !isVideo(f) || f.size <= MAX_VIDEO_BYTES);
    for (const file of fit.slice(0, MAX_FILES - files.length)) {
      files.push({ file, url: URL.createObjectURL(file) });
    }
    if (fit.length < media.length) status.textContent = 'Los videos de más de 200 MB no se pueden enviar.';
    else if (media.length > MAX_FILES) status.textContent = `Máximo ${MAX_FILES} archivos por envío.`;
    renderFiles();
    textarea.focus();
    return true;
  }

  function removeFile(index) {
    URL.revokeObjectURL(files[index].url);
    files.splice(index, 1);
    renderFiles();
  }

  function renderFiles() {
    attachmentsBar.hidden = !files.length;
    thumbs.replaceChildren(
      ...files.map(({ file, url }, i) =>
        h(
          'div',
          { className: 'composer-thumb' },
          isVideo(file)
            ? [h('video', { src: url, muted: true, preload: 'metadata', title: file.name }), h('span', { className: 'gif-badge', attrs: { 'aria-hidden': 'true' } }, 'Video')]
            : h('img', { src: url, alt: file.name }),
          h(
            'button',
            { type: 'button', className: 'icon-btn', title: 'Quitar', attrs: { 'aria-label': `Quitar ${file.name}` }, onClick: () => removeFile(i) },
            '✕',
          ),
        ),
      ),
    );
  }

  function clear() {
    for (const { url } of files) URL.revokeObjectURL(url);
    files = [];
    renderFiles();
    textarea.value = '';
    mentions.clear();
    setTimed(false);
    status.textContent = '';
    setReplyTo(null);
    setEditing(null);
    autosize();
  }

  // Texto del mensaje de una tirada, o null (con el motivo en el estado) si todavía no se puede tirar
  function roll(spec) {
    if (Date.now() - lastRoll < ROLL_COOLDOWN) {
      status.textContent = 'Espera un momento antes de volver a tirar.';
      return null;
    }
    lastRoll = Date.now();
    return rollMessage(spec);
  }

  // Envía una tirada elegida en el selector, sin tocar lo que haya escrito en la caja
  async function sendRoll(spec) {
    if (busy || editing) return;
    const text = roll(spec);
    if (!text) return;
    busy = true;
    sendBtn.disabled = true;
    status.textContent = '';
    try {
      await onSend({ text, files: [], replyTo: replyTo?.id ?? null, expiresIn: null, editId: null });
      setReplyTo(null);
    } catch {
      // el error lo muestra la conversación
    } finally {
      busy = false;
      sendBtn.disabled = false;
      textarea.focus();
    }
  }

  async function send() {
    let text = mentions.encode(textarea.value.trim());
    if (busy || (!text && !files.length)) return;
    if (editing && text === editing.text.trim()) {
      cancelEditing(); // sin cambios: no hay nada que guardar
      return;
    }
    // "/roll 2d20": se envía el resultado de la tirada en lugar del comando
    if (!editing && isRollCommand(text)) {
      try {
        text = roll(parseRoll(text));
      } catch ({ message }) {
        status.textContent = message;
        return;
      }
      if (!text) return;
    }
    busy = true;
    sendBtn.disabled = true;
    status.textContent = files.length ? 'Subiendo…' : '';
    try {
      const note = await onSend({
        text,
        files: files.map((f) => f.file),
        replyTo: replyTo?.id ?? null,
        expiresIn: timed ? TIMER_SECONDS : null,
        editId: editing?.id ?? null,
      });
      clear();
      if (note) status.textContent = note;
    } catch {
      status.textContent = ''; // el error lo muestra la conversación
    } finally {
      busy = false;
      sendBtn.disabled = false;
      textarea.focus();
    }
  }

  // Crece con el texto. Agrandada, o mientras la caja está oculta (scrollHeight 0), el alto lo pone el CSS:
  // fijar ahí un alto en px la dejaba aplastada hasta que se empezaba a escribir.
  function autosize() {
    textarea.style.height = '';
    if (expanded || !textarea.scrollHeight) return;
    textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
  }

  el.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
  textarea.addEventListener('keydown', (event) => {
    // Enter envía (ver sendsOnEnter) y Shift+Enter hace salto de línea; si no, Enter hace salto de línea.
    // Ctrl+Enter envía siempre.
    const sends = event.ctrlKey || event.metaKey || (sendsOnEnter() && !event.shiftKey);
    if (event.key === 'Enter' && sends && !event.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape' && editing) {
      cancelEditing();
    } else if (event.key === 'Escape' && replyTo) {
      setReplyTo(null);
    }
  });
  textarea.addEventListener('input', autosize);
  // El alto depende del ancho (el texto se parte distinto): se recalcula al cambiar el tamaño de la ventana
  // y al volver a mostrarse la caja (cambio de pestaña o de chat), que es cuando pasa de ancho 0 al real.
  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === lastWidth) return;
    lastWidth = width;
    autosize();
  }).observe(textarea);
  // Ctrl+V con una imagen o un video copiados
  textarea.addEventListener('paste', (event) => {
    if (addFiles(event.clipboardData?.files ?? [])) event.preventDefault();
  });
  // Tocar "Enviar" no le saca el foco a la caja: en mobile eso cerraba el teclado (y con el salto de la pantalla
  // el toque se perdía: había que tocar dos veces). Así además se puede seguir escribiendo después de enviar.
  for (const type of ['pointerdown', 'mousedown']) sendBtn.addEventListener(type, (event) => event.preventDefault());
  attachBtn.addEventListener('click', () => fileInput.click());
  emojiBtn.addEventListener('click', () => openEmojiPicker(emojiBtn, insertText, { forText: true }));
  diceBtn.addEventListener('click', () => openDicePicker(diceBtn, sendRoll));
  expandBtn.addEventListener('click', () => setExpanded(!expanded));
  enterBtn.addEventListener('click', () => setEnterSends(!enterSends));
  renderEnterMode();
  fileInput.addEventListener('change', async () => {
    addFiles(await takeFiles(fileInput));
  });

  return {
    el,
    setAccount(account) {
      accountId = account?.id ?? null;
      meEl.hidden = !account;
      if (!account) return;
      meEl.title = `Escribes como ${account.name}`;
      meEl.setAttribute('aria-label', meEl.title);
      meEl.replaceChildren(avatar(account.id, account.avatar, { name: account.name }));
    },
    // loader(): [{ id, name, avatar }] (o una promesa) de las personas del chat: son las primeras que se ofrecen al mencionar
    setPeople(loader) {
      people = loader;
    },
    setReplyTo,
    setEditing,
    addFiles,
    clear,
    focus: () => {
      autosize(); // recién ahora la caja es visible y se puede medir
      renderEnterMode(); // el ancho de la ventana (mobile o no) pudo cambiar
      textarea.focus();
    },
    setStatus: (text) => {
      status.textContent = text;
    },
    // Hace que `zone` acepte imágenes y videos arrastrados (muestra un aviso mientras se arrastra)
    acceptDrop(zone) {
      let depth = 0;
      const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
      zone.addEventListener('dragenter', (event) => {
        if (!hasFiles(event)) return;
        depth++;
        zone.classList.add('drop-active');
      });
      zone.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (!depth) zone.classList.remove('drop-active');
      });
      zone.addEventListener('dragover', (event) => {
        if (hasFiles(event)) event.preventDefault();
      });
      zone.addEventListener('drop', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth = 0;
        zone.classList.remove('drop-active');
        if (!el.hidden) addFiles(event.dataTransfer.files);
      });
    },
  };
}
