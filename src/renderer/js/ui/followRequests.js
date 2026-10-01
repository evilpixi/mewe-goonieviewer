import { api } from '../api.js';
import { showError } from '../errorView.js';
import { avatar } from './avatar.js';
import { h } from './dom.js';
import { userName } from './userName.js';

// Solicitudes de seguimiento recibidas, con Aceptar / Rechazar. Se oculta sola si no hay ninguna.
export function createFollowRequests({ navigate, onChange }) {
  const listEl = h('ul', { className: 'people-list' });
  const errorEl = h('div');
  const el = h(
    'section',
    { className: 'card follow-requests', hidden: true, attrs: { 'aria-label': 'Solicitudes de seguimiento' } },
    h('h2', { className: 'card-title' }, 'Solicitudes de seguimiento'),
    errorEl,
    listEl,
  );
  let generation = 0;

  async function load(account) {
    const gen = ++generation;
    el.hidden = true;
    errorEl.replaceChildren();
    if (!account) return;
    try {
      const requests = await api.getFollowRequests(account.id);
      if (gen !== generation) return;
      listEl.replaceChildren(...requests.map((request) => renderRequest(account, request)));
      el.hidden = !requests.length;
    } catch (err) {
      // sin solicitudes visibles la sección no aporta nada: sólo se registra
      console.warn('[solicitudes]', err);
    }
  }

  function renderRequest(account, { requestId, user }) {
    const item = h('li', { className: 'person' });
    const answer = async (accept, button) => {
      button.disabled = true;
      try {
        await api.answerFollowRequest(account.id, requestId, accept);
        item.remove();
        el.hidden = !listEl.childElementCount;
        onChange?.();
      } catch (err) {
        button.disabled = false;
        showError(errorEl, err, 'MeWe seguimiento');
      }
    };
    item.append(
      h(
        'button',
        { className: 'person-main link-btn', onClick: () => navigate('profile', { userId: user.id }) },
        avatar(account.id, user.avatar, { name: user.name, size: 'sm' }),
        h('span', { className: 'person-info' }, userName(user.name, { className: 'person-name' }), user.handle && h('span', { className: 'person-meta' }, `@${user.handle}`)),
      ),
      h('button', { className: 'btn primary', disabled: !requestId, onClick: (event) => answer(true, event.currentTarget) }, 'Aceptar'),
      h('button', { className: 'btn', disabled: !requestId, onClick: (event) => answer(false, event.currentTarget) }, 'Rechazar'),
    );
    return item;
  }

  return { el, load };
}
