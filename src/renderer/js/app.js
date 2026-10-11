import { api } from './api.js';
import { createAccountsColumn } from './accountsColumn.js';
import { createChatView } from './chatView.js';
import { createFeedView } from './feedView.js';
import { createLoginModal } from './loginModal.js';
import { clearError, showError } from './errorView.js';
import { createRouter } from './router.js';
import { applySettings, setSettingsAccount } from './settings.js';
import { avatar } from './ui/avatar.js';
import { confirmDialog } from './ui/confirm.js';
import { h } from './ui/dom.js';
import { icon } from './ui/icon.js';
import { isMobile } from './ui/mobile.js';
import { closePopover, openPopover } from './ui/popover.js';
import { createGroupView } from './views/groupView.js';
import { createListsView } from './views/listsView.js';
import { createNotificationsView } from './views/notificationsView.js';
import { createPostView } from './views/postView.js';
import { createProfileView } from './views/profileView.js';
import { createSearchView } from './views/searchView.js';
import { createSettingsView } from './views/settingsView.js';
import { createStoriesView } from './views/storiesView.js';
import { createThreadView } from './views/threadView.js';

const $ = (selector) => document.querySelector(selector);

const profileBtn = $('#app-title');
const errorEl = $('#app-error');
const viewTabsEl = $('#view-tabs');
const toolbarEl = $('#view-toolbar');
const refreshBtn = $('#refresh-view');

const notifBtn = $('#open-notifications');
const notifBadge = $('#notif-badge');
const optionsBtn = $('#open-options');
const searchBtn = $('#open-search');

// Vistas raíz: los iconos del centro de la cabecera. El resto (perfil, grupo, post…) se abre con router.navigate.
const ROOT_VIEWS = ['feed', 'chat', 'lists', 'stories'];
const VIEW_KEY = 'view';
const NOTIF_POLL_MS = 60000;

let accounts = [];
let active = null;
let rootView = savedView();
let optionsMenu = null; // popover del menú Opciones mientras está abierto
let accountMenu = null; // ídem, el menú de la cuenta (mobile)

applySettings();

const router = createRouter({
  host: $('#view-host'),
  toolbarSlots: { left: $('#toolbar-left'), center: $('#toolbar-center'), right: $('#toolbar-right') },
  onChange: ({ view, hasToolbar, canReload }) => {
    for (const btn of viewTabsEl.querySelectorAll('[data-view]')) {
      const selected = btn.dataset.view === view;
      btn.classList.toggle('active', selected);
      if (selected) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    notifBtn.classList.toggle('active', view === 'notifications');
    optionsBtn.classList.toggle('active', view === 'settings');
    searchBtn.classList.toggle('active', view === 'search');
    // el segundo panel sólo se muestra si la vista pone algo o se puede actualizar
    refreshBtn.hidden = !active || !canReload;
    toolbarEl.hidden = !active || (!hasToolbar && refreshBtn.hidden);
  },
});

router.registerView('feed', createFeedView);
router.registerView('chat', createChatView);
router.registerView('lists', createListsView);
router.registerView('stories', createStoriesView);
router.registerView('post', createPostView);
router.registerView('profile', (nav) => createProfileView({ ...nav, onAccountChanged: refreshActiveAccount }));
router.registerView('group', createGroupView);
router.registerView('thread', createThreadView);
router.registerView('notifications', (nav) => createNotificationsView({ ...nav, onUnseenChange: setUnseen }));
router.registerView('settings', createSettingsView);
router.registerView('search', createSearchView);

const column = createAccountsColumn({
  listEl: $('#account-list'),
  addButton: $('#add-account'),
  onSelect: selectAccount,
  onAdd: () => loginModal.open(),
});

const loginModal = createLoginModal({
  dialog: $('#login-modal'),
  onLoggedIn: async (account) => {
    await refreshAccounts();
    selectAccount(account);
  },
});

function savedView() {
  try {
    const view = localStorage.getItem(VIEW_KEY);
    return ROOT_VIEWS.includes(view) ? view : 'feed';
  } catch {
    return 'feed';
  }
}

viewTabsEl.addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]')?.dataset.view;
  if (!view || view === router.current()?.view) return;
  rootView = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // sin storage: la vista no se recuerda
  }
  clearError(errorEl);
  router.setRoot(view);
});

// Abre una vista secundaria desde la cabecera (sin apilarla dos veces)
function openView(view, params) {
  if (router.current()?.view === view) router.back();
  else router.navigate(view, params);
}

function openMyProfile() {
  if (active?.userId && router.current()?.params?.userId !== active.userId) router.navigate('profile', { userId: active.userId });
}

// En mobile la foto abre el menú de la cuenta; en escritorio, el perfil
profileBtn.addEventListener('click', () => (isMobile() ? openAccountMenu() : openMyProfile()));
notifBtn.addEventListener('click', () => openView('notifications'));
searchBtn.addEventListener('click', () => openView('search'));

// Foto de la cuenta activa en la cabecera (sin el nombre, que queda en el title)
// Sin cuenta sólo se ve en mobile (clase no-account), con un ícono: es la única entrada al menú de la cuenta.
function renderProfileButton() {
  profileBtn.hidden = false;
  profileBtn.classList.toggle('no-account', !active);
  profileBtn.title = active ? `${active.name} — mi perfil y cuentas` : 'Cuentas y ajustes';
  profileBtn.setAttribute('aria-label', profileBtn.title);
  profileBtn.replaceChildren(active ? avatar(active.id, active.avatar, { name: active.name }) : icon('users'));
}

// --- Menú de la cuenta (mobile): se abre desde la foto. Junta las cuentas (no hay columna) con lo que en
// escritorio está repartido por la cabecera: mi perfil, buscar y las opciones. ---

function openAccountMenu() {
  if (accountMenu?.el.isConnected) {
    closePopover();
    return;
  }
  const item = (run, { current = false, className = '' } = {}, ...content) =>
    h(
      'button',
      {
        className: `menu-item account-item${current ? ' active' : ''} ${className}`.trim(),
        attrs: { role: 'menuitem', 'aria-current': current ? 'true' : null },
        onClick: () => {
          closePopover();
          run();
        },
      },
      content,
    );
  const action = (name, label, run, className) => item(run, { className }, h('span', { className: 'account-item-icon' }, icon(name)), label);
  const menu = h(
    'div',
    { className: 'menu', attrs: { role: 'menu' } },
    // arriba, la cuenta activa: tocarla abre su perfil
    active &&
      item(
        openMyProfile,
        { className: 'account-current' },
        avatar(active.id, active.avatar, { name: active.name, size: 'lg' }),
        h(
          'span',
          { className: 'account-current-info' },
          h('span', { className: 'user-name' }, active.name),
          h('span', { className: 'account-current-hint' }, 'Ver mi perfil'),
        ),
      ),
    active && h('hr', { className: 'menu-sep' }),
    h('div', { className: 'menu-label' }, icon('users'), accounts.length > 1 ? ' Cambiar de cuenta' : ' Cuentas'),
    accounts
      .filter((account) => account.id !== active?.id)
      .map((account) =>
        item(() => selectAccount(account), {}, avatar(account.id, account.avatar, { name: account.name }), h('span', { className: 'user-name' }, account.name)),
      ),
    action('plus', 'Agregar cuenta', () => loginModal.open()),
    h('hr', { className: 'menu-sep' }),
    active && action('search', 'Buscar personas', () => openView('search')),
    action('settings', 'Ajustes de la interfaz', () => openView('settings')),
    active && action('refresh-cw', 'Reconectar', relogin),
    active && action('trash-2', 'Quitar cuenta', removeAccount, 'danger'),
  );
  accountMenu = openPopover(profileBtn, menu, { className: 'menu-popover', label: 'Cuenta' });
  menu.querySelector('button')?.focus();
}

// --- Menú Opciones: ajustes, reconectar y quitar la cuenta ---

optionsBtn.addEventListener('click', () => {
  if (optionsMenu?.el.isConnected) {
    closePopover();
    return;
  }
  const item = (label, run, className = '') =>
    h(
      'button',
      {
        className: `menu-item ${className}`.trim(),
        attrs: { role: 'menuitem' },
        onClick: () => {
          closePopover();
          run();
        },
      },
      label,
    );
  const menu = h(
    'div',
    { className: 'menu', attrs: { role: 'menu' } },
    item('Ajustes de la interfaz', () => openView('settings')),
    active && item('Reconectar', relogin),
    active && item('Quitar cuenta', removeAccount, 'danger'),
  );
  optionsMenu = openPopover(optionsBtn, menu, { className: 'menu-popover', label: 'Opciones' });
  menu.querySelector('button')?.focus();
});

// Alt+← como en un navegador · F5 actualiza la vista · Ctrl+1…4 cambia de sección
window.addEventListener('keydown', (event) => {
  if (event.altKey && event.key === 'ArrowLeft') router.back();
  else if (event.key === 'F5') {
    event.preventDefault();
    router.reload();
  } else if (event.ctrlKey && !event.altKey && !event.shiftKey && active && ROOT_VIEWS[Number(event.key) - 1]) {
    event.preventDefault();
    viewTabsEl.querySelector(`[data-view="${ROOT_VIEWS[Number(event.key) - 1]}"]`)?.click();
  }
});

// --- Contador de notificaciones sin ver (campana) ---

function setUnseen(count) {
  notifBadge.hidden = !count;
  notifBadge.textContent = count > 99 ? '99+' : String(count || '');
  notifBtn.setAttribute('aria-label', count ? `Notificaciones (${count} sin ver)` : 'Notificaciones');
}

async function refreshUnseen() {
  const account = active;
  if (!account || document.hidden) return;
  try {
    const { unseenCount } = await api.getUnseenNotifications(account.id);
    // con la lista abierta ya se marcaron como vistas
    if (active?.id === account.id && router.current()?.view !== 'notifications') setUnseen(unseenCount);
  } catch (err) {
    console.warn('[notificaciones]', err);
  }
}

setInterval(refreshUnseen, NOTIF_POLL_MS);
document.addEventListener('visibilitychange', refreshUnseen);
api.onNotification(({ accountId }) => {
  if (accountId !== active?.id) return;
  if (router.current()?.view === 'notifications') router.reload();
  else refreshUnseen();
});

function selectAccount(account) {
  active = account;
  column.setActive(account?.id ?? null);
  setSettingsAccount(account); // cada cuenta puede tener su tema y colores
  renderProfileButton();
  viewTabsEl.hidden = !account;
  for (const btn of [searchBtn, notifBtn]) btn.hidden = !account;
  clearError(errorEl);
  setUnseen(0);
  router.setAccount(account, account ? rootView : 'feed'); // sin cuenta, el feed muestra cómo agregar una
  if (account) {
    // el websocket también avisa de notificaciones nuevas, no sólo de mensajes
    api.startRealtime(account.id).catch((err) => console.warn('[realtime]', err));
    refreshUnseen();
  }
}

async function refreshAccounts() {
  accounts = await api.listAccounts();
  column.setAccounts(accounts);
}

// La cuenta activa cambió su nombre o su foto (se editó el perfil): se vuelven a pedir sus datos a MeWe
// y se actualizan la cabecera y la columna de cuentas, sin salir de la vista. Devuelve la cuenta actualizada.
async function refreshActiveAccount() {
  if (!active) return null;
  const account = await api.reloginAccount(active.id);
  await refreshAccounts();
  if (active?.id !== account.id) return account;
  active = account;
  column.setActive(account.id);
  router.updateAccount(account);
  renderProfileButton();
  return account;
}

refreshBtn.addEventListener('click', () => router.reload());

async function relogin() {
  if (!active) return;
  clearError(errorEl);
  try {
    const account = await api.reloginAccount(active.id);
    await refreshAccounts();
    selectAccount(account);
  } catch (err) {
    showError(errorEl, err, 'MeWe login');
  }
}

// Errores de login durante una reconexión (el modal está cerrado en ese caso)
api.onLoginError(({ accountId, error }) => {
  if (active?.id === accountId) showError(errorEl, { details: error }, 'MeWe login');
});

async function removeAccount() {
  const account = active;
  if (!account) return;
  const confirmed = await confirmDialog({
    title: `¿Quitar la cuenta ${account.name}?`,
    text: 'Se borrará su sesión de esta aplicación. La cuenta de MeWe no se toca.',
    confirmLabel: 'Quitar',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api.removeAccount(account.id);
    await refreshAccounts();
    selectAccount(accounts[0] ?? null);
  } catch (err) {
    showError(errorEl, err);
  }
}

try {
  await refreshAccounts();
  selectAccount(accounts[0] ?? null);
} catch (err) {
  showError(errorEl, err);
}
