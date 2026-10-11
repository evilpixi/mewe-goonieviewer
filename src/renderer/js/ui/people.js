import { api } from '../api.js';
import { avatar } from './avatar.js';
import { confirmDialog } from './confirm.js';
import { h } from './dom.js';
import { icon } from './icon.js';
import { userName } from './userName.js';

const PROFILE_HOST = 'https://mewe.com';
const COPIED_MS = 1500;

// Link público de un perfil (el que usa la web: mewe.com/{@usuario}); null si la persona no tiene @usuario
export function profileLink(user) {
  return user?.handle ? `${PROFILE_HOST}/${user.handle}` : null;
}

// Botón de icono que copia el link del perfil. No se muestra si la persona no tiene @usuario.
export function copyLinkButton(user, { className = 'btn icon-btn' } = {}) {
  const link = profileLink(user);
  if (!link) return null;
  const label = 'Copiar el link del perfil';
  const button = h('button', { className, title: label, attrs: { 'aria-label': label } }, icon('link'));
  button.addEventListener('click', async () => {
    try {
      await api.copyText(link);
      button.replaceChildren(icon('check'));
      button.title = 'Link copiado';
    } catch (err) {
      button.title = `No se pudo copiar: ${err.message}`;
    }
    setTimeout(() => {
      button.replaceChildren(icon('link'));
      button.title = label;
    }, COPIED_MS);
  });
  return button;
}

// Abre el chat con una persona (el que ya existe o uno nuevo) dentro de la vista de chats, con su lista al lado
export async function openChatWith({ account, user, navigate }) {
  const thread = await api.openChatWith(account.id, user.id);
  navigate('chat', { thread: { ...thread, name: user.name, avatar: user.avatar, userId: user.id } });
}

// Pregunta y bloquea. Devuelve true si se bloqueó, false si se canceló; lanza si MeWe falla.
export async function confirmBlock(account, user) {
  const confirmed = await confirmDialog({
    title: `¿Seguro que quieres bloquear a ${user.name || 'esta persona'}?`,
    text: 'No va a poder escribirte ni ver tu perfil, y se dejan de seguir. Puedes desbloquearla desde tu perfil, en la pestaña Bloqueados.',
    confirmLabel: 'Bloquear',
    danger: true,
  });
  if (!confirmed) return false;
  await api.blockUser(account.id, user.id);
  return true;
}

export async function confirmUnblock(account, user) {
  const confirmed = await confirmDialog({
    title: `¿Desbloquear a ${user.name || 'esta persona'}?`,
    text: 'Va a poder volver a escribirte y a ver tu perfil.',
    confirmLabel: 'Desbloquear',
  });
  if (!confirmed) return false;
  await api.unblockUser(account.id, user.id);
  return true;
}

// Fila de una persona para las listas (.people-list): foto + nombre + @usuario que llevan al perfil,
// y a la derecha las acciones (nodos) que se pasen.
export function personRow({ account, user, navigate, actions = [] }) {
  return h(
    'li',
    { className: 'person' },
    h(
      'button',
      { className: 'person-main link-btn', onClick: () => navigate('profile', { userId: user.id }) },
      avatar(account.id, user.avatar, { name: user.name, size: 'sm' }),
      h('span', { className: 'person-info' }, userName(user.name, { className: 'person-name' }), user.handle && h('span', { className: 'person-meta' }, `@${user.handle}`)),
    ),
    actions,
  );
}
