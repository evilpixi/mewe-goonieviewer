// Relleno automático del login de mewe.com: un script que corre dentro de la página de MeWe.
// Si falla, el usuario puede loguearse a mano en la misma ventana.

// Resultados posibles del script de relleno
export const PREFILL_MESSAGES = {
  signup: 'MeWe no encontró una cuenta con ese email (te mandó al registro).',
  'no-form': 'No se pudo rellenar el formulario automáticamente. Inicia sesión a mano en la ventana de MeWe.',
  timeout: 'MeWe no mostró el paso de contraseña. Continúa a mano en su ventana (puede pedir captcha o código).',
  'email-filled': 'Email rellenado. Continúa en la ventana de MeWe.',
};

// El login web es por pasos: email -> Next -> contraseña (o registro si el email no existe).
export function prefillScript(email, password) {
  // Los valores van serializados con JSON.stringify: no se interpolan como código
  return `(async (email, password) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const onScreen = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth + 1;
    };
    const waitFor = async (check, ms) => {
      for (let t = 0; t < ms; t += 200) {
        const value = check();
        if (value) return value;
        await sleep(200);
      }
      return null;
    };
    const setValue = (el, value) => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const submitOf = (el) => (el.form ?? el.closest('form, div'))?.querySelector('[type=submit]');

    const emailInput = await waitFor(() => document.querySelector('#email-input'), 10000);
    if (!emailInput) return 'no-form';
    setValue(emailInput, email);
    if (!password) return 'email-filled';
    await sleep(300);
    submitOf(emailInput)?.click();

    const step = await waitFor(() => {
      const pass = document.querySelector('#password-input');
      if (onScreen(pass)) return 'password';
      if (onScreen(document.querySelector('#first-name-input'))) return 'signup';
      return null;
    }, 20000);
    if (step !== 'password') return step ?? 'timeout';

    const passInput = document.querySelector('#password-input');
    setValue(passInput, password);
    await sleep(300);
    submitOf(passInput)?.click();
    return 'submitted';
  })(${JSON.stringify(email ?? '')}, ${JSON.stringify(password ?? '')})`;
}
