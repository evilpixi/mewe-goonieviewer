import { config } from '../config.js';
import { prefillScript } from '../core/loginPrefill.js';

// Lo que el código compartido (src/core, src/mewe) necesita de Android. Es la contraparte de
// src/main/platform.js: acá todo pasa por el plugin nativo (android/…/MeweNativePlugin.java),
// que es quien guarda las cookies de cada cuenta. Las cookies nunca llegan al WebView.
export const native = window.Capacitor.Plugins.MeweNative;

const NULL_BODY_STATUS = [101, 204, 205, 304]; // estados que no admiten cuerpo
const CHUNK = 0x8000;

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// fetch para el MeweClient de una cuenta: la petición sale de nativo con sus cookies
function nativeFetch(accountId) {
  return async (url, { method = 'GET', headers = {}, body } = {}) => {
    const request = { accountId, url: String(url), method, headers: { ...headers } };
    if (body instanceof FormData) {
      // un FormData no cruza el puente: se arma el multipart acá (con su boundary) y viaja como bytes
      const encoded = new Request('https://localhost/', { method: 'POST', body });
      request.headers['content-type'] = encoded.headers.get('content-type');
      request.bodyBase64 = toBase64(new Uint8Array(await encoded.arrayBuffer()));
    } else if (body != null) {
      request.body = String(body);
    }
    const response = await native.request(request);
    const data = NULL_BODY_STATUS.includes(response.status) ? null : fromBase64(response.bodyBase64);
    return new Response(data, { status: response.status, headers: response.headers });
  };
}

// La interfaz de cookies de MeweClient (ver src/main/sessionCookies.js)
function nativeCookies(accountId) {
  return {
    header: async () => '', // la cabecera cookie la pone nativo
    get: async (name) => (await native.getCookie({ accountId, name })).value ?? undefined,
    storeFromResponse: async () => {}, // las guarda nativo
  };
}

const LOGIN_CLOSED = 'Se cerró la ventana de MeWe sin iniciar sesión.';

// Abre el login real de mewe.com en una ventana nativa. Resuelve con el perfil cuando verify() valida
// la sesión; rechaza si el usuario cierra la ventana antes.
async function login({ account, email, password, verify, onApiError, onStatus }) {
  let profile = null;
  let verifying = null;
  let lastError = null;

  // nativo avisa cada vez que las cookies de la cuenta tienen una sesión para probar
  const listener = await native.addListener('loginSession', (event) => {
    if (event.accountId !== account.id || profile || verifying) return;
    verifying = verify()
      .then((result) => {
        profile = result;
        return native.loginClose();
      })
      .catch((err) => {
        // Un 401/403 aquí sólo significa que el login aún no terminó; el resto se reporta una vez
        if (err.status === 401 || err.status === 403 || err.message === lastError) return;
        lastError = err.message;
        if (err.status) onApiError(err);
      })
      .finally(() => {
        verifying = null;
      });
  });

  try {
    onStatus(email ? 'Rellenando el formulario de MeWe…' : 'Inicia sesión en la ventana de MeWe.');
    await native.loginOpen({ accountId: account.id, url: config.mewe.loginUrl, script: email ? prefillScript(email, password) : undefined });
    await verifying; // la ventana pudo cerrarse con una verificación en curso
    if (!profile) throw new Error(LOGIN_CLOSED);
    return profile;
  } finally {
    listener.remove();
  }
}

// Para AccountManager
export function androidPlatform() {
  return {
    newAccount: (id) => ({ id }),
    cookiesFor: (account) => nativeCookies(account.id),
    clientOptionsFor: (account) => ({ fetch: nativeFetch(account.id) }),
    login,
    clearSession: (account) => native.clearAccount({ accountId: account.id }),
  };
}

// Para AccountStore: un valor guardado en nativo, junto a las cookies
export function nativeStorage(key) {
  return {
    read: async () => (await native.storageGet({ key })).value ?? null,
    write: (value) => native.storageSet({ key, value }),
  };
}

// Para Realtime: un WebSocket nativo con la interfaz del WebSocket estándar que usa (eventos, send y close).
// El del navegador no acepta cabeceras, y la conexión se autentica con las cookies de la cuenta.
const sockets = new Map(); // id → NativeSocket
let socketCount = 0;
let listening = false;

class NativeSocket extends EventTarget {
  constructor(url, headers, accountId) {
    super();
    this.id = `ws-${++socketCount}`;
    sockets.set(this.id, this);
    native.wsOpen({ id: this.id, accountId, url: String(url), headers, cookieUrl: config.mewe.host }).catch(() => this.handle({ type: 'close' }));
  }

  handle(event) {
    if (event.type === 'close') sockets.delete(this.id);
    this.dispatchEvent(event.type === 'message' ? new MessageEvent('message', { data: event.data }) : new Event(event.type));
  }

  send(data) {
    native.wsSend({ id: this.id, data: String(data) });
  }

  close() {
    native.wsClose({ id: this.id });
  }
}

export function connectWebSocket(url, headers, accountId) {
  if (!listening) {
    listening = true;
    native.addListener('ws', (event) => sockets.get(event.id)?.handle(event));
  }
  return new NativeSocket(url, headers, accountId);
}
