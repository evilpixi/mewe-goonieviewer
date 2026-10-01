import { api } from './api.js';
import { createAccountsColumn } from './accountsColumn.js';
import { createChatView } from './chatView.js';
import { createFeedView } from './feedView.js';
import { createLoginModal } from './loginModal.js';
import { clearError, showError } from './errorView.js';
import { createRouter } from './router.js';
import { applySettings } from './settings.js';
import { createGroupView } from './views/groupView.js';
import { createGroupsView } from './views/groupsView.js';
import { createNotificationsView } from './views/notificationsView.js';
import { createPostView } from './views/postView.js';
import { createProfileView } from './views/profileView.js';
import { createSettingsView } from './views/settingsView.js';
import { createThreadView } from './views/threadView.js';

const $ = (selector) => document.querySelector(selector);

const titleEl = $('#app-title');
const errorEl = $('#app-error');
const viewTabsEl = $('#view-tabs');
const backBtn = $('#nav-back');
const refreshBtn = $('#refresh-view');
const reloginBtn = $('#relogin-account');
const removeBtn = $('#remove-account');

const notifBtn = $('#open-notifications');
const notifBadge = $('#notif-badge');
const settingsBtn = $('#open-settings');

// Vistas raíz: las pestañas de la cabecera. El resto (perfil, grupo, post…) se abre con router.navigate.
const ROOT_VIEWS = ['feed', 'chat', 'groups'];
const VIEW_KEY = 'view';
const NOTIF_POLL_MS = 60000;

let accounts = [];
let active = null;
let rootView = savedView();

applySettings();

const router = createRouter({
  host: $('#view-host'),
  toolbarSlot: $('#view-toolbar'),
  onChange: ({ view, canGoBack }) => {
    backBtn.hidden = !canGoBack;
    for (const btn of viewTabsEl.querySelectorAll('[data-view]')) {
      const selected = btn.dataset.view === view;
      btn.classList.toggle('active', selected);
      if (selected) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    notifBtn.classList.toggle('active', view === 'notifications');
    settingsBtn.classList.toggle('active', view === 'settings');
  },
});

router.registerView('feed', createFeedView);
router.registerView('chat', createChatView);
router.registerView('groups', createGroupsView);
router.registerView('post', createPostView);
router.registerView('profile', createProfileView);
router.registerView('group', createGroupView);
router.registerView('thread', createThreadView);
router.registerView('notifications', (nav) => createNotificationsView({ ...nav, onUnseenChange: setUnseen }));
router.registerView('settings', createSettingsView);

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

backBtn.addEventListener('click', () => router.back());

// Abre una vista secundaria desde la cabecera (sin apilarla dos veces)
function openView(view, params) {
  if (router.current()?.view === view) router.back();
  else router.navigate(view, params);
}

titleEl.addEventListener('click', () => {
  if (active?.userId && router.current()?.params?.userId !== active.userId) router.navigate('profile', { userId: active.userId });
});
notifBtn.addEventListener('click', () => openView('notifications'));
settingsBtn.addEventListener('click', () => openView('settings'));

// Alt+← como en un navegador · F5 actualiza la vista · Ctrl+1…3 cambia de sección
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
  titleEl.textContent = account ? account.name : 'Sin cuenta seleccionada';
  titleEl.disabled = !account?.userId;
  viewTabsEl.hidden = !account;
  for (const btn of [notifBtn, refreshBtn, reloginBtn, removeBtn]) btn.hidden = !account;
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

refreshBtn.addEventListener('click', () => router.reload());

reloginBtn.addEventListener('click', async () => {
  if (!active) return;
  clearError(errorEl);
  try {
    const account = await api.reloginAccount(active.id);
    await refreshAccounts();
    selectAccount(account);
  } catch (err) {
    showError(errorEl, err, 'MeWe login');
  }
});

// Errores de login durante una reconexión (el modal está cerrado en ese caso)
api.onLoginError(({ accountId, error }) => {
  if (active?.id === accountId) showError(errorEl, { details: error }, 'MeWe login');
});

removeBtn.addEventListener('click', async () => {
  if (!active || !confirm(`¿Quitar la cuenta ${active.name}? Se borrará su sesión.`)) return;
  try {
    await api.removeAccount(active.id);
    await refreshAccounts();
    selectAccount(accounts[0] ?? null);
  } catch (err) {
    showError(errorEl, err);
  }
});

try {
  await refreshAccounts();
  selectAccount(accounts[0] ?? null);
} catch (err) {
  showError(errorEl, err);
}
