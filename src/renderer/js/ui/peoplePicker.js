import { api } from '../api.js';
import { clearError, showError } from '../errorView.js';
import { avatar } from './avatar.js';
import { emptyState, h } from './dom.js';
import { userName } from './userName.js';

const SEARCH_DEBOUNCE_MS = 300;

// Diálogo para elegir personas: sin texto lista a quienes sigues (la primera página); con 2 letras o más,
// el buscador de MeWe. Lo elegido queda arriba, y se puede quitar tocándolo.
//   excludeIds: quienes no se pueden elegir (ya están en el chat) · min: cuántas hacen falta para confirmar
//   fields: nodos que van antes del buscador (p. ej. el nombre del chat)
//   onConfirm(users): hace el trabajo; si lanza, el error se muestra y el diálogo sigue abierto
// Devuelve una promesa con lo que devolvió onConfirm, o null si se canceló.
export function openPeoplePicker({ account, title, confirmLabel, excludeIds = [], min = 1, fields = null, onConfirm }) {
  return new Promise((resolve) => {
    const excluded = new Set(excludeIds);
    const selected = new Map(); // userId → usuario
    let following = null; // primera página de seguidos: la lista sin texto
    let searchId = 0;
    let timer = null;
    let busy = false;
    let result = null;

    const input = h('input', { type: 'search', className: 'input', placeholder: 'Buscar personas…', attrs: { 'aria-label': 'Buscar personas' } });
    const chipsEl = h('div', { className: 'picker-chips', attrs: { 'aria-live': 'polite' } });
    const listEl = h('ul', { className: 'people-list picker-list scroll' }, emptyState('Cargando…', 'li'));
    const errorEl = h('div');
    const cancelBtn = h('button', { type: 'button', className: 'btn', onClick: () => dialog.close() }, 'Cancelar');
    const confirmBtn = h('button', { type: 'submit', className: 'btn primary', disabled: true }, confirmLabel);
    const form = h(
      'form',
      { className: 'picker-form' },
      h('h2', {}, title),
      fields,
      input,
      chipsEl,
      listEl,
      errorEl,
      h('div', { className: 'modal-actions' }, cancelBtn, confirmBtn),
    );
    const dialog = h('dialog', { className: 'modal people-picker', attrs: { 'aria-label': title } }, form);

    function update() {
      confirmBtn.disabled = busy || selected.size < min;
      confirmBtn.textContent = selected.size ? `${confirmLabel} (${selected.size})` : confirmLabel;
      chipsEl.replaceChildren(
        ...[...selected.values()].map((user) =>
          h(
            'button',
            { type: 'button', className: 'picker-chip', title: `Quitar a ${user.name}`, onClick: () => toggle(user) },
            avatar(account.id, user.avatar, { name: user.name, size: 'sm' }),
            userName(user.name),
            ' ✕',
          ),
        ),
      );
    }

    function toggle(user) {
      if (selected.has(user.id)) selected.delete(user.id);
      else selected.set(user.id, user);
      update();
      for (const box of listEl.querySelectorAll(`input[data-user-id="${CSS.escape(user.id)}"]`)) box.checked = selected.has(user.id);
    }

    function renderUsers(users, empty) {
      const shown = users.filter((user) => user.id && user.id !== account.userId);
      if (!shown.length) {
        listEl.replaceChildren(emptyState(empty, 'li'));
        return;
      }
      listEl.replaceChildren(
        ...shown.map((user) => {
          const taken = excluded.has(user.id);
          const checkbox = h('input', {
            type: 'checkbox',
            checked: selected.has(user.id),
            disabled: taken,
            dataset: { userId: user.id },
            onChange: () => toggle(user),
          });
          return h(
            'li',
            {},
            h(
              'label',
              { className: 'person' },
              checkbox,
              avatar(account.id, user.avatar, { name: user.name, size: 'sm' }),
              h(
                'span',
                { className: 'person-info' },
                userName(user.name, { className: 'person-name' }),
                taken ? h('span', { className: 'person-meta' }, 'Ya está en el chat') : user.handle && h('span', { className: 'person-meta' }, `@${user.handle}`),
              ),
            ),
          );
        }),
      );
    }

    async function search() {
      const current = ++searchId;
      const query = input.value.trim();
      clearError(errorEl);
      try {
        if (query.length < 2) {
          following ??= (await api.getPeople(account.id, 'following')).users;
          if (current === searchId) renderUsers(following, 'Todavía no sigues a nadie: busca por nombre.');
          return;
        }
        listEl.replaceChildren(emptyState('Buscando…', 'li'));
        const users = await api.searchUsers(account.id, query);
        if (current === searchId) renderUsers(users, 'Nadie con ese nombre.');
      } catch (err) {
        if (current !== searchId) return;
        listEl.replaceChildren();
        showError(errorEl, err, 'MeWe personas');
      }
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, SEARCH_DEBOUNCE_MS);
    });
    // Enter en el buscador no confirma: busca ya
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      clearTimeout(timer);
      search();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || selected.size < min) return;
      busy = true;
      update();
      clearError(errorEl);
      try {
        result = await onConfirm([...selected.values()]);
        dialog.close();
      } catch (err) {
        showError(errorEl, err, 'MeWe');
      } finally {
        busy = false;
        update();
      }
    });
    dialog.addEventListener('cancel', (event) => busy && event.preventDefault());
    dialog.addEventListener('close', () => {
      clearTimeout(timer);
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    cancelBtn.focus(); // no el buscador: en mobile abriría el teclado encima de la lista
    update();
    search();
  });
}
