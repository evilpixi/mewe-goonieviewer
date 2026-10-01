import { BrowserWindow } from 'electron';
import { config } from '../config.js';
import { MeweApiError } from '../mewe/errors.js';

// Abre el login real de mewe.com en la sesión (partition) de la cuenta.
// - Rellena email/contraseña; el usuario sólo resuelve el captcha.
// - Captura las respuestas de error de /auth/login y las reporta con onApiError.
// - Resuelve con el perfil cuando aparece la cookie de sesión y verify() la valida.
// - Rechaza si el usuario cierra la ventana sin loguearse.
// Si el relleno automático falla, el usuario puede loguearse a mano en la misma ventana.
export function openLoginWindow({ ses, parent, email, password, verify, onApiError, onStatus }) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 480,
      height: 760,
      parent,
      modal: Boolean(parent),
      title: 'Iniciar sesión en MeWe',
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    let settled = false;
    let verifying = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      ses.cookies.removeListener('changed', onCookieChanged);
      fn(value);
      if (!win.isDestroyed()) win.close();
    };

    // quiet: comprobación oportunista (al navegar); si falla no es un error, el login sigue en curso
    const tryVerify = async ({ quiet = false } = {}) => {
      if (settled || verifying) return;
      verifying = true;
      try {
        if (!quiet) onStatus('Verificando sesión…');
        finish(resolve, await verify());
      } catch (err) {
        // Un 401 aquí sólo significa que el login aún no terminó
        if (quiet) return;
        if (err.status === 401) onStatus('Esperando a que termines el login en la ventana de MeWe…');
        else onApiError(err);
        if (config.debug) console.log('[login] verify falló:', err);
      } finally {
        verifying = false;
      }
    };

    const onCookieChanged = (_event, cookie, _cause, removed) => {
      if (!removed && cookie.name === config.mewe.cookies.session) tryVerify();
    };
    ses.cookies.on('changed', onCookieChanged);

    win.on('closed', () => {
      finish(reject, new Error('Se cerró la ventana de MeWe sin iniciar sesión.'));
    });

    watchLoginErrors(win, onApiError);

    // Si la sesión ya era válida, MeWe redirige fuera de /login sin tocar la cookie de sesión:
    // sin esto la ventana quedaba abierta y, al cerrarla a mano, el login se daba por fallido.
    const onNavigated = (_event, url) => {
      if (!new URL(url).pathname.startsWith('/login')) tryVerify({ quiet: true });
    };
    win.webContents.on('did-navigate', onNavigated);
    win.webContents.on('did-navigate-in-page', onNavigated);

    if (config.debug) {
      win.webContents.openDevTools({ mode: 'detach' });
      win.webContents.on('did-navigate', (_e, url) => console.log('[login] navega a', url));
      win.webContents.on('did-navigate-in-page', (_e, url) => console.log('[login] navega a', url));
    }

    let prefilled = false;
    win.webContents.on('did-finish-load', () => {
      if (prefilled || !win.webContents.getURL().includes('/login')) return;
      prefilled = true;
      if (!email) {
        onStatus('Inicia sesión en la ventana de MeWe.');
        return;
      }
      onStatus('Rellenando el formulario de MeWe…');
      win.webContents
        .executeJavaScript(prefillScript(email, password))
        .then((result) => {
          if (config.debug) console.log('[login] resultado del relleno:', result);
          if (settled) return;
          if (result === 'signup') onApiError(new Error(PREFILL_MESSAGES.signup));
          else onStatus(PREFILL_MESSAGES[result] ?? 'Completa el captcha en la ventana de MeWe si aparece.');
        })
        .catch((err) => {
          console.warn('[login] No se pudo rellenar el formulario:', err.message);
          onStatus(PREFILL_MESSAGES['no-form']);
        });
    });

    win.loadURL(config.mewe.loginUrl).catch((err) => {
      onApiError(new MeweApiError({ message: `No se pudo cargar ${config.mewe.loginUrl}: ${err.message}` }));
    });
  });
}

// Usa el protocolo de DevTools para leer el cuerpo de las respuestas de login fallidas
function watchLoginErrors(win, onApiError) {
  const dbg = win.webContents.debugger;
  const pending = new Map();

  try {
    dbg.attach('1.3');
  } catch (err) {
    console.warn('[login] No se pudo adjuntar el debugger:', err.message);
    return;
  }
  dbg.sendCommand('Network.enable').catch(() => {});

  dbg.on('message', async (_event, method, params) => {
    if (method === 'Network.responseReceived') {
      const { url, status } = params.response;
      if (config.debug && url.includes('/api/')) console.log(`[login] ${status} ${url}`);
      if (url.includes(config.mewe.endpoints.login) && status >= 400) {
        pending.set(params.requestId, { url, status });
      }
    } else if (method === 'Network.loadingFinished' && pending.has(params.requestId)) {
      const { url, status } = pending.get(params.requestId);
      pending.delete(params.requestId);
      let body = null;
      try {
        const res = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        body = JSON.parse(res.body);
      } catch {
        // cuerpo no disponible o no JSON
      }
      onApiError(new MeweApiError({ status, url, body }));
    }
  });
}

// Resultados posibles del script de relleno
const PREFILL_MESSAGES = {
  signup: 'MeWe no encontró una cuenta con ese email (te mandó al registro).',
  'no-form': 'No se pudo rellenar el formulario automáticamente. Inicia sesión a mano en la ventana de MeWe.',
  timeout: 'MeWe no mostró el paso de contraseña. Continúa a mano en su ventana (puede pedir captcha o código).',
  'email-filled': 'Email rellenado. Continúa en la ventana de MeWe.',
};

// El login web es por pasos: email -> Next -> contraseña (o registro si el email no existe).
function prefillScript(email, password) {
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
