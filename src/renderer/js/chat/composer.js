import { avatar } from '../ui/avatar.js';
import { h } from '../ui/dom.js';
import { openEmojiPicker } from '../ui/emojiPicker.js';
import { icon } from '../ui/icon.js';
import { plainText } from '../ui/richText.js';
import { userName } from '../ui/userName.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_FILES = 10;

// Segundos; MeWe sólo hace desaparecer fotos/videos, así que aplica a las imágenes adjuntas
const TIMERS = [
  [0, 'Sin temporizador'],
  [5, '5 s'],
  [10, '10 s'],
  [30, '30 s'],
  [60, '1 min'],
  [300, '5 min'],
  [3600, '1 h'],
  [86400, '24 h'],
];

// Caja de redacción del chat.
//   onSend({ text, files, replyTo, expiresIn, editId }) → promesa; si se resuelve, se limpia la caja
//   (editId: id del mensaje que se está editando; ahí sólo importa `text`)
// Imágenes y GIFs: botón 📎, Ctrl+V con una imagen en el portapapeles, o arrastrarlas (ver acceptDrop).
// Botón ⤢: caja grande para textos de varias líneas (ahí Enter hace salto de línea y Ctrl+Enter envía).
// El placeholder es corto para que entre en una línea; las teclas van en el title.
const PLACEHOLDER = 'Escribe un mensaje…';
const HINT = 'Enter envía, Shift+Enter hace salto de línea';
const HINT_EXPANDED = 'Enter hace salto de línea, Ctrl+Enter envía';

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
  const expandBtn = h(
    'button',
    { type: 'button', className: 'btn icon-btn', title: 'Agrandar la caja de texto', attrs: { 'aria-label': 'Agrandar la caja de texto', 'aria-pressed': 'false' } },
    icon('maximize-2'),
  );
  const sendBtn = h('button', { type: 'submit', className: 'btn primary' }, 'Enviar');
  // Foto de la cuenta que va a escribir (ver setAccount)
  const meEl = h('span', { className: 'writing-as', attrs: { role: 'img' }, hidden: true });
  const fileInput = h('input', {
    type: 'file',
    accept: IMAGE_TYPES.join(','),
    multiple: true,
    hidden: true,
    attrs: { 'aria-hidden': 'true', tabindex: '-1' },
  });
  const attachBtn = h(
    'button',
    { type: 'button', className: 'btn icon-btn', title: 'Adjuntar imagen', attrs: { 'aria-label': 'Adjuntar imagen' } },
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
  const timerSelect = h(
    'select',
    { className: 'composer-timer', title: 'Temporizador: la imagen desaparece después de verla', attrs: { 'aria-label': 'Temporizador' } },
    TIMERS.map(([value, label]) => h('option', { value }, `⏱ ${label}`)),
  );
  const thumbs = h('div', { className: 'composer-thumbs' });
  const attachmentsBar = h('div', { className: 'composer-attachments', hidden: true }, thumbs, timerSelect);
  const status = h('div', { className: 'composer-status', attrs: { 'aria-live': 'polite' } });
  const el = h(
    'form',
    { className: 'chat-composer' },
    replyBar,
    editBar,
    attachmentsBar,
    status,
    h('div', { className: 'composer-row' }, meEl, attachBtn, emojiBtn, textarea, expandBtn, sendBtn),
    fileInput,
  );

  let files = []; // [{ file, url }]
  let replyTo = null;
  let editing = null; // mensaje que se está editando
  let busy = false;
  let expanded = false;

  function setExpanded(value) {
    expanded = value;
    el.classList.toggle('expanded', expanded);
    expandBtn.setAttribute('aria-pressed', String(expanded));
    expandBtn.replaceChildren(icon(expanded ? 'minimize-2' : 'maximize-2'));
    expandBtn.title = expanded ? 'Achicar la caja de texto' : 'Agrandar la caja de texto';
    expandBtn.setAttribute('aria-label', expandBtn.title);
    textarea.title = expanded ? HINT_EXPANDED : HINT;
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
    attachBtn.disabled = Boolean(message);
    sendBtn.textContent = message ? 'Guardar' : 'Enviar';
    if (!message) return;
    editText.textContent = plainText(message.text);
    textarea.value = message.text;
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
    const images = [...list].filter((f) => IMAGE_TYPES.includes(f.type));
    if (!images.length || editing) return false; // al editar sólo cambia el texto
    for (const file of images.slice(0, MAX_FILES - files.length)) {
      files.push({ file, url: URL.createObjectURL(file) });
    }
    if (images.length > MAX_FILES) status.textContent = `Máximo ${MAX_FILES} imágenes por envío.`;
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
          h('img', { src: url, alt: file.name }),
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
    timerSelect.value = '0';
    status.textContent = '';
    setReplyTo(null);
    setEditing(null);
    autosize();
  }

  async function send() {
    const text = textarea.value.trim();
    if (busy || (!text && !files.length)) return;
    if (editing && text === editing.text.trim()) {
      cancelEditing(); // sin cambios: no hay nada que guardar
      return;
    }
    busy = true;
    sendBtn.disabled = true;
    status.textContent = files.length ? 'Subiendo imágenes…' : '';
    try {
      await onSend({
        text,
        files: files.map((f) => f.file),
        replyTo: replyTo?.id ?? null,
        expiresIn: Number(timerSelect.value) || null,
        editId: editing?.id ?? null,
      });
      clear();
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
    // caja normal: Enter envía · caja agrandada: Enter hace salto de línea y Ctrl+Enter envía
    const sends = expanded ? event.ctrlKey || event.metaKey : !event.shiftKey;
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
  // Ctrl+V con una imagen copiada
  textarea.addEventListener('paste', (event) => {
    if (addFiles(event.clipboardData?.files ?? [])) event.preventDefault();
  });
  attachBtn.addEventListener('click', () => fileInput.click());
  emojiBtn.addEventListener('click', () => openEmojiPicker(emojiBtn, insertText, { forText: true }));
  expandBtn.addEventListener('click', () => setExpanded(!expanded));
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  return {
    el,
    setAccount(account) {
      meEl.hidden = !account;
      if (!account) return;
      meEl.title = `Escribes como ${account.name}`;
      meEl.setAttribute('aria-label', meEl.title);
      meEl.replaceChildren(avatar(account.id, account.avatar, { name: account.name }));
    },
    setReplyTo,
    setEditing,
    addFiles,
    clear,
    focus: () => {
      autosize(); // recién ahora la caja es visible y se puede medir
      textarea.focus();
    },
    setStatus: (text) => {
      status.textContent = text;
    },
    // Hace que `zone` acepte imágenes arrastradas (muestra un aviso mientras se arrastra)
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
