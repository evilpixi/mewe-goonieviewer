import { api } from './api.js';
import { clearError, showError } from './errorView.js';

// Modal de login: pide email y contraseña, abre la ventana de MeWe
// (donde se rellenan solos) y espera a que el usuario resuelva el captcha.
export function createLoginModal({ dialog, onLoggedIn }) {
  const form = dialog.querySelector('#login-form');
  const statusEl = dialog.querySelector('#login-status');
  const errorEl = dialog.querySelector('#login-error');
  const submitBtn = dialog.querySelector('#login-submit');
  const cancelBtn = dialog.querySelector('#login-cancel');
  let busy = false;

  // Errores de /auth/login que ocurren dentro de la ventana de MeWe
  api.onLoginError(({ error }) => {
    if (!dialog.open) return;
    showError(errorEl, { details: error }, 'MeWe login');
    statusEl.textContent = 'MeWe devolvió un error. Puedes reintentar en su ventana.';
  });

  api.onLoginStatus(({ message }) => {
    if (dialog.open && busy) statusEl.textContent = message;
  });

  cancelBtn.addEventListener('click', () => {
    if (!busy) dialog.close();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const credentials = { email: data.get('email').trim(), password: data.get('password') };

    setBusy(true);
    clearError(errorEl);
    statusEl.textContent = 'Completa el captcha en la ventana de MeWe…';

    try {
      const account = await api.addAccount(credentials);
      form.reset();
      dialog.close();
      onLoggedIn(account);
    } catch (err) {
      statusEl.textContent = 'No se pudo iniciar sesión.';
      showError(errorEl, err, 'MeWe login');
    } finally {
      setBusy(false);
    }
  });

  function setBusy(value) {
    busy = value;
    submitBtn.disabled = value;
    cancelBtn.disabled = value;
  }

  return {
    open() {
      clearError(errorEl);
      statusEl.textContent = '';
      dialog.showModal();
      form.elements.email.focus();
    },
  };
}
