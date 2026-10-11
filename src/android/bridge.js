// window.mewe en Android: el mismo contrato que el preload de Electron (src/preload/preload.cjs), pero la
// lógica corre acá, en el WebView, en vez de en un proceso principal. scripts/build-android.js carga este
// módulo antes que la UI.
import { AccountManager } from '../core/accountManager.js';
import { AccountStore } from '../core/accountStore.js';
import { registerChannels, wrapHandler } from '../core/channels.js';
import { Realtime } from '../core/realtime.js';
import { serializeError } from '../mewe/errors.js';
import { androidPlatform, connectWebSocket, native, nativeStorage } from './platform.js';
import { followTheme } from './systemBars.js';
import { imageUrl, registerUiChannels } from './ui.js';

const handlers = new Map(); // canal → función que devuelve { ok, data } | { ok: false, error }
const handle = (channel, fn) => handlers.set(channel, wrapHandler(channel, fn));

const listeners = new Map(); // evento → callbacks de la UI
const send = (channel, payload) => {
  for (const callback of listeners.get(channel) ?? []) callback(payload);
};

const store = new AccountStore(nativeStorage('accounts'));
const accountManager = new AccountManager({
  store,
  platform: androidPlatform(),
  onLoginError: (accountId, err) => {
    const error = serializeError(err);
    console.error('[login]', error);
    send('login:error', { accountId, error });
  },
  onLoginStatus: (accountId, message) => send('login:status', { accountId, message }),
});
const realtime = new Realtime({ accountManager, send, connect: connectWebSocket });

registerChannels({ handle, accountManager, realtime });
registerUiChannels({ handle, accountManager });

const ready = store.load();

window.mewe = {
  async invoke(channel, ...args) {
    await ready;
    const handler = handlers.get(channel);
    if (!handler) return { ok: false, error: { name: 'IpcError', message: `Canal desconocido: ${channel}` } };
    return handler(...args);
  },
  on(channel, callback) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);
    return () => listeners.get(channel).delete(callback);
  },
  imageUrl,
};

// El botón "atrás": la UI cierra lo que tenga abierto (ver app.js) y cancela el evento;
// si no había nada que cerrar, la app se va al fondo.
native.addListener('back', () => {
  if (window.dispatchEvent(new CustomEvent('mewe:back', { cancelable: true }))) native.minimize();
});

followTheme();
