import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { threadAvatar } from '../ui/avatar.js';
import { emptyState, h } from '../ui/dom.js';
import { plainText } from '../ui/richText.js';
import { userName } from '../ui/userName.js';

// Para buscar sin distinguir mayúsculas ni acentos
const fold = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Se reenvían el texto y las imágenes; los videos y archivos no (ver MeweClient.forwardMessage)
export function canForward(message) {
  return !message.deleted && !message.expiresIn && (Boolean(message.text) || message.images.length > 0);
}

// Diálogo para reenviar un mensaje: se elige el chat (personas y grupos) y va ahí como un mensaje nuevo.
// Devuelve una promesa: el chat al que se reenvió, o null si se canceló.
export function openForwardDialog({ account, message }) {
  return new Promise((resolve) => {
    let threads = null;
    let sentTo = null;
    let busy = false;
    const images = message.images.length;
    const skipped = message.videos.length + message.files.length > 0;
    const input = h('input', { type: 'search', placeholder: 'Buscar chat…', attrs: { 'aria-label': 'Buscar chat' }, onInput: () => render() });
    const listEl = h('div', { className: 'forward-list scroll', attrs: { role: 'listbox', 'aria-label': 'Chats' } }, emptyState('Cargando…'));
    const errorEl = h('div');
    const cancelBtn = h('button', { type: 'button', className: 'btn', onClick: () => dialog.close() }, 'Cancelar');
    const dialog = h(
      'dialog',
      { className: 'modal forward', attrs: { 'aria-label': 'Reenviar mensaje' } },
      h('h2', {}, 'Reenviar a…'),
      h(
        'p',
        { className: 'forward-preview', attrs: { dir: 'auto' } },
        plainText(message.text),
        images > 0 && h('span', { className: 'forward-note' }, images === 1 ? '📷 1 imagen' : `📷 ${images} imágenes`),
        skipped && h('span', { className: 'forward-note' }, 'Los videos y archivos no se reenvían.'),
      ),
      input,
      errorEl,
      listEl,
      h('div', { className: 'modal-actions' }, cancelBtn),
    );

    async function send(thread, button) {
      if (busy) return;
      busy = true;
      clearError(errorEl);
      button.classList.add('sending');
      listEl.setAttribute('aria-busy', 'true');
      try {
        await api.forwardMessage(account.id, thread.id, thread.isGroup, {
          text: message.text,
          images: message.images.map((img) => img.full ?? img.src),
        });
        sentTo = thread;
        dialog.close();
      } catch (err) {
        showError(errorEl, err, 'MeWe chat');
      } finally {
        busy = false;
        button.classList.remove('sending');
        listEl.removeAttribute('aria-busy');
      }
    }

    function render() {
      if (!threads) return;
      const query = fold(input.value.trim());
      const found = threads.filter((t) => fold(t.name).includes(query));
      if (!found.length) {
        listEl.replaceChildren(emptyState(threads.length ? 'Ningún chat con ese nombre.' : 'Sin chats.'));
        return;
      }
      listEl.replaceChildren(
        ...found.map((t) =>
          h(
            'button',
            { type: 'button', className: 'menu-item account-item', attrs: { role: 'option' }, onClick: (event) => send(t, event.currentTarget) },
            threadAvatar(account.id, t),
            t.isGroup && h('span', { title: 'Chat de grupo' }, '👥'),
            userName(t.name, { fallback: 'Chat' }),
          ),
        ),
      );
    }

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(sentTo);
    });
    // mientras se envía no se cierra con Esc: el mensaje saldría igual
    dialog.addEventListener('cancel', (event) => busy && event.preventDefault());
    document.body.append(dialog);
    dialog.showModal();
    cancelBtn.focus(); // no el buscador: en mobile abriría el teclado encima de la lista

    api
      .getChatThreads(account.id, 'all')
      .then((list) => {
        threads = list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        render();
      })
      .catch((err) => {
        listEl.replaceChildren();
        showError(errorEl, err, 'MeWe chat');
      });
  });
}
