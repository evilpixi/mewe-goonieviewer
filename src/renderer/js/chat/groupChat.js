import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from '../ui/avatar.js';
import { confirmDialog } from '../ui/confirm.js';
import { emptyState, h } from '../ui/dom.js';
import { icon } from '../ui/icon.js';
import { openPeoplePicker } from '../ui/peoplePicker.js';
import { userName } from '../ui/userName.js';

// Chats grupales entre personas (no los de un grupo de MeWe): crearlos y manejar quiénes están.

// "Nuevo chat grupal": nombre opcional y al menos dos personas. Devuelve el chat creado, o null si se canceló.
export function openNewGroupChat({ account }) {
  const nameInput = h('input', { type: 'text', className: 'input', maxLength: 100, placeholder: 'Nombre del chat (opcional)', attrs: { 'aria-label': 'Nombre del chat', dir: 'auto' } });
  return openPeoplePicker({
    account,
    title: 'Nuevo chat grupal',
    confirmLabel: 'Crear chat',
    min: 2,
    fields: nameInput,
    onConfirm: (users) => api.createGroupChat(account.id, users.map((user) => user.id), nameInput.value.trim()),
  });
}

// Miembros de un chat grupal: cambiarle el nombre, sumar gente, sacar (sólo quien lo creó) y salir.
//   onChanged(changes): cambió el nombre ({ name }) o los miembros ({ participants }) · onLeft(): se salió del chat
export function openChatMembers({ account, thread, onChanged, onLeft }) {
  let participants = [...thread.participants];
  const isOwner = Boolean(thread.startedBy) && thread.startedBy === account.userId;
  const errorEl = h('div');
  const nameInput = h('input', { type: 'text', className: 'input', maxLength: 100, value: thread.name, attrs: { 'aria-label': 'Nombre del chat', dir: 'auto' } });
  const renameBtn = h('button', { type: 'submit', className: 'btn' }, 'Guardar nombre');
  const renameForm = h('form', { className: 'chat-members-name' }, nameInput, renameBtn);
  const listEl = h('ul', { className: 'people-list chat-members-list scroll' });
  const countEl = h('strong');
  const addBtn = h('button', { type: 'button', className: 'btn' }, icon('user-plus'), ' Agregar personas');
  const leaveBtn = h('button', { type: 'button', className: 'btn danger' }, icon('log-out'), ' Salir del chat');
  const closeBtn = h('button', { type: 'button', className: 'btn primary', onClick: () => dialog.close() }, 'Listo');
  const dialog = h(
    'dialog',
    { className: 'modal chat-members', attrs: { 'aria-label': 'Miembros del chat' } },
    h('h2', {}, 'Chat grupal'),
    renameForm,
    h('div', { className: 'chat-members-head' }, countEl, addBtn),
    listEl,
    errorEl,
    h('div', { className: 'modal-actions' }, leaveBtn, closeBtn),
  );

  function render() {
    countEl.textContent = `${participants.length + 1} miembros`;
    const me = h(
      'li',
      { className: 'person' },
      avatar(account.id, account.avatar, { name: account.name, size: 'sm' }),
      h('span', { className: 'person-info' }, userName(account.name, { className: 'person-name' }), h('span', { className: 'person-meta' }, isOwner ? 'Tú · creaste el chat' : 'Tú')),
    );
    listEl.replaceChildren(
      me,
      ...participants.map((user) =>
        h(
          'li',
          { className: 'person' },
          avatar(account.id, user.avatar, { name: user.name, size: 'sm' }),
          h(
            'span',
            { className: 'person-info' },
            userName(user.name, { className: 'person-name' }),
            user.id === thread.startedBy ? h('span', { className: 'person-meta' }, 'Creó el chat') : user.handle && h('span', { className: 'person-meta' }, `@${user.handle}`),
          ),
          isOwner &&
            h(
              'button',
              {
                type: 'button',
                className: 'btn icon-btn danger',
                title: 'Sacar del chat',
                attrs: { 'aria-label': `Sacar del chat a ${user.name}` },
                onClick: (event) => remove(user, event.currentTarget),
              },
              icon('user-minus'),
            ),
        ),
      ),
    );
    if (!participants.length) listEl.append(emptyState('Nadie más en el chat.', 'li'));
  }

  // Corre una acción mostrando su error en el diálogo
  async function run(button, action) {
    button.disabled = true;
    clearError(errorEl);
    try {
      return await action();
    } catch (err) {
      showError(errorEl, err, 'MeWe chat');
      return false;
    } finally {
      button.disabled = false;
    }
  }

  async function remove(user, button) {
    const confirmed = await confirmDialog({
      title: `¿Sacar a ${user.name} del chat?`,
      text: 'Ya no va a poder mandar ni recibir mensajes nuevos en este chat.',
      confirmLabel: 'Sacar',
      danger: true,
    });
    if (!confirmed) return;
    const done = await run(button, () => api.removeChatParticipant(account.id, thread.id, user.id));
    if (!done) return;
    participants = participants.filter((other) => other.id !== user.id);
    render();
    onChanged?.({ participants });
  }

  renameForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name || name === thread.name) return;
    if (await run(renameBtn, () => api.renameChat(account.id, thread.id, name))) onChanged?.({ name });
  });

  addBtn.addEventListener('click', async () => {
    const added = await openPeoplePicker({
      account,
      title: 'Agregar al chat',
      confirmLabel: 'Agregar',
      excludeIds: participants.map((user) => user.id),
      onConfirm: async (users) => {
        await api.addChatParticipants(account.id, thread.id, users.map((user) => user.id));
        return users;
      },
    });
    if (!added?.length) return;
    participants = [...participants, ...added];
    render();
    onChanged?.({ participants });
  });

  leaveBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '¿Salir de este chat?',
      text: 'Dejarás de recibir sus mensajes. Para volver, alguien del chat tiene que agregarte.',
      confirmLabel: 'Salir',
      danger: true,
    });
    if (!confirmed) return;
    if (!(await run(leaveBtn, () => api.leaveChat(account.id, thread.id)))) return;
    dialog.close();
    onLeft?.();
  });

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  closeBtn.focus();
  render();
}
