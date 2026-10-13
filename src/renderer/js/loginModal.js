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
  const googleBtn = dialog.querySelector('#login-google');
  // En Android la ventana de login no abre popups, y el de Google lo necesita
  googleBtn.hidden = Boolean(window.Capacitor);
  let busy = false;
  let withGoogle = false; // el estado lo fija el diálogo: los avisos de la ventana no lo pisan

  // Errores de /auth/login que ocurren dentro de la ventana de MeWe
  api.onLoginError(({ error }) => {
    if (!dialog.open) return;
    showError(errorEl, { details: error }, 'MeWe login');
    statusEl.textContent = 'MeWe devolvió un error. Puedes reintentar en su ventana.';
  });

  api.onLoginStatus(({ message }) => {
    if (dialog.open && busy && !withGoogle) statusEl.textContent = message;
  });

  cancelBtn.addEventListener('click', () => {
    if (!busy) dialog.close();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    login({ email: data.get('email').trim(), password: data.get('password') }, 'Completa el captcha en la ventana de MeWe…');
  });

  // Con Google no hacen falta el email ni la contraseña: se abre la ventana de MeWe sin rellenar nada
  googleBtn.addEventListener('click', () => {
    withGoogle = true;
    login({ email: '', password: '' }, 'Pulsa «Continuar con Google» en la ventana de MeWe.');
  });

  async function login(credentials, status) {
    if (busy) return;
    setBusy(true);
    clearError(errorEl);
    statusEl.textContent = status;

    try {
      const account = await api.addAccount(credentials);
      form.reset();
      dialog.close();
      onLoggedIn(account);
    } catch (err) {
      statusEl.textContent = 'No se pudo iniciar sesión.';
      showError(errorEl, err, 'MeWe login');
    } finally {
      withGoogle = false;
      setBusy(false);
    }
  }

  function setBusy(value) {
    busy = value;
    submitBtn.disabled = value;
    googleBtn.disabled = value;
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
