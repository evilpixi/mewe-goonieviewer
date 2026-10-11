import { api } from '../api.js';
import { showError } from '../errorView.js';
import { avatar } from './avatar.js';
import { emptyState, h } from './dom.js';
import { userName } from './userName.js';

// Botón para seguir a `user` (o pedirle seguirlo si su cuenta es privada). Antes de seguir consulta
// el perfil: las listas no dicen si ya se lo sigue.
//   results: Map userId → texto del resultado, para que el botón no reaparezca al redibujar la lista
export function followButton({ account, user, results, onError }) {
  const done = (text) => h('span', { className: 'status' }, text);
  if (results?.has(user.id)) return done(results.get(user.id));
  if (user.following) return done('Ya lo sigues');
  const button = h(
    'button',
    {
      className: 'btn',
      onClick: async () => {
        button.disabled = true;
        try {
          const profile = await api.getProfile(account.id, user.id);
          let text = 'Ya lo sigues';
          if (profile.requestSent) text = 'Solicitud enviada';
          else if (!profile.following) {
            const result = await api.setFollow(account.id, user.id, true);
            text = result.following || profile.isPublic ? 'Siguiendo' : 'Solicitud enviada';
          }
          results?.set(user.id, text);
          button.replaceWith(done(text));
        } catch (err) {
          button.disabled = false;
          onError?.(err);
        }
      },
    },
    user.isPublic === false ? 'Solicitar seguir' : 'Seguir',
  );
  return button;
}

// Solicitudes de seguimiento recibidas, con Aceptar / Rechazar (pestaña "Solicitudes" del perfil propio).
// Al aceptar, la fila queda con el botón para seguir también a esa persona.
// onChange(userId) avisa cuando se respondió una solicitud · onCount(n): cuántas quedan sin responder.
export function createFollowRequests({ navigate, onChange, onCount }) {
  const listEl = h('ul', { className: 'people-list' });
  const errorEl = h('div');
  const el = h('section', { className: 'card follow-requests', attrs: { 'aria-label': 'Solicitudes de seguimiento' } }, errorEl, listEl);
  const rows = new Map(); // userId → fila (sólo las que siguen sin responder)
  let generation = 0;

  function renderEmpty() {
    if (!listEl.childElementCount) listEl.replaceChildren(emptyState('No hay solicitudes de seguimiento.', 'li'));
  }

  // Devuelve las solicitudes pendientes (vacío si no se pudieron cargar)
  async function load(account) {
    const gen = ++generation;
    errorEl.replaceChildren();
    listEl.replaceChildren();
    rows.clear();
    onCount?.(0);
    if (!account) return [];
    try {
      const requests = await api.getFollowRequests(account.id);
      if (gen !== generation) return [];
      listEl.replaceChildren(...requests.map((request) => renderRequest(account, request)));
      renderEmpty();
      onCount?.(rows.size);
      return requests;
    } catch (err) {
      if (gen === generation) showError(errorEl, err, 'MeWe seguimiento');
      return [];
    }
  }

  // La solicitud de esa persona ya no está pendiente. dropRow: además se quita su fila.
  function settle(userId, dropRow) {
    if (dropRow) rows.get(userId)?.remove();
    rows.delete(userId);
    renderEmpty();
    onCount?.(rows.size);
  }

  function renderRequest(account, { requestId, user }) {
    const item = h('li', { className: 'person' });
    const onError = (err) => showError(errorEl, err, 'MeWe seguimiento');
    const answer = async (accept, button) => {
      const buttons = [...item.querySelectorAll('.btn')];
      for (const btn of buttons) btn.disabled = true;
      errorEl.replaceChildren();
      try {
        await api.answerFollowRequest(account.id, requestId, accept);
        if (accept) {
          for (const btn of buttons) btn.remove();
          item.append(h('span', { className: 'status' }, 'Aceptada'), followButton({ account, user, onError }));
        }
        settle(user.id, !accept);
        onChange?.(user.id);
      } catch (err) {
        for (const btn of buttons) btn.disabled = false;
        button.focus();
        onError(err);
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
    rows.set(user.id, item);
    return item;
  }

  return { el, load };
}
