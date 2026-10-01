import { api } from './api.js';
import { createAccountsColumn } from './accountsColumn.js';
import { createChatView } from './chatView.js';
import { createFeedView } from './feedView.js';
import { createLoginModal } from './loginModal.js';
import { clearError, showError } from './errorView.js';
import { createRouter } from './router.js';
import { createPostView } from './views/postView.js';

const $ = (selector) => document.querySelector(selector);

const titleEl = $('#app-title');
const errorEl = $('#app-error');
const viewTabsEl = $('#view-tabs');
const backBtn = $('#nav-back');
const refreshBtn = $('#refresh-view');
const reloginBtn = $('#relogin-account');
const removeBtn = $('#remove-account');

// Vistas raíz: las pestañas de la cabecera. El resto (perfil, grupo, post…) se abre con router.navigate.
const ROOT_VIEWS = ['feed', 'chat'];
const VIEW_KEY = 'view';

let accounts = [];
let active = null;
let rootView = savedView();

const router = createRouter({
  host: $('#view-host'),
  toolbarSlot: $('#view-toolbar'),
  onChange: ({ view, canGoBack }) => {
    backBtn.hidden = !canGoBack;
    for (const btn of viewTabsEl.querySelectorAll('[data-view]')) {
      const selected = btn.dataset.view === view;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', String(selected));
    }
  },
});

router.registerView('feed', createFeedView);
router.registerView('chat', createChatView);
router.registerView('post', createPostView);

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

// Alt+← como en un navegador
window.addEventListener('keydown', (event) => {
  if (event.altKey && event.key === 'ArrowLeft') router.back();
});

function selectAccount(account) {
  active = account;
  column.setActive(account?.id ?? null);
  titleEl.textContent = account ? account.name : 'Sin cuenta seleccionada';
  viewTabsEl.hidden = !account;
  for (const btn of [refreshBtn, reloginBtn, removeBtn]) btn.hidden = !account;
  clearError(errorEl);
  router.setAccount(account, account ? rootView : 'feed'); // sin cuenta, el feed muestra cómo agregar una
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
