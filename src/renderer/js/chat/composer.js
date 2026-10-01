import { h } from '../ui/dom.js';
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
//   onSend({ text, files, replyTo, expiresIn }) → promesa; si se resuelve, se limpia la caja
// Imágenes: botón 📎, Ctrl+V con una imagen en el portapapeles, o arrastrarlas (ver acceptDrop).
export function createComposer({ onSend }) {
  const textarea = h('textarea', {
    name: 'text',
    rows: 1,
    placeholder: 'Escribe un mensaje… (Enter envía, Shift+Enter salto)',
    attrs: { 'aria-label': 'Mensaje' },
  });
  const sendBtn = h('button', { type: 'submit', className: 'btn primary' }, 'Enviar');
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
    '📎',
  );
  const replyText = h('span', { className: 'composer-reply-text' });
  const replyBar = h(
    'div',
    { className: 'composer-reply', hidden: true },
    h('span', { className: 'composer-reply-label' }, '↩ Respondiendo a'),
    replyText,
    h(
      'button',
      { type: 'button', className: 'icon-btn', title: 'Cancelar respuesta', attrs: { 'aria-label': 'Cancelar respuesta' }, onClick: () => setReplyTo(null) },
      '✕',
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
    attachmentsBar,
    status,
    h('div', { className: 'composer-row' }, attachBtn, textarea, sendBtn),
    fileInput,
  );

  let files = []; // [{ file, url }]
  let replyTo = null;
  let busy = false;

  function setReplyTo(message, authorName = '') {
    replyTo = message;
    replyBar.hidden = !message;
    if (message) {
      replyText.replaceChildren(
        userName(authorName || (message.mine ? 'ti' : message.author), { className: 'composer-reply-author' }),
        ': ',
        message.text || (message.images.length ? '📷 Imagen' : '…'),
      );
      textarea.focus();
    }
  }

  function addFiles(list) {
    const images = [...list].filter((f) => IMAGE_TYPES.includes(f.type));
    if (!images.length) return false;
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
    autosize();
  }

  async function send() {
    const text = textarea.value.trim();
    if (busy || (!text && !files.length)) return;
    busy = true;
    sendBtn.disabled = true;
    status.textContent = files.length ? 'Subiendo imágenes…' : '';
    try {
      await onSend({
        text,
        files: files.map((f) => f.file),
        replyTo: replyTo?.id ?? null,
        expiresIn: Number(timerSelect.value) || null,
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

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  el.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape' && replyTo) {
      setReplyTo(null);
    }
  });
  textarea.addEventListener('input', autosize);
  // Ctrl+V con una imagen copiada
  textarea.addEventListener('paste', (event) => {
    if (addFiles(event.clipboardData?.files ?? [])) event.preventDefault();
  });
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  return {
    el,
    setReplyTo,
    addFiles,
    clear,
    focus: () => textarea.focus(),
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
