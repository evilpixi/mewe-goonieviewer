// Puente seguro entre la UI (renderer) y el proceso principal.
// Es genérico: agregar un canal nuevo no requiere tocar este archivo mientras use un prefijo permitido.
const { contextBridge, ipcRenderer } = require('electron');

// Dominios que la UI puede invocar (ipcMain.handle en src/main/ipc.js)
const INVOKE_PREFIXES = ['accounts:', 'feed:', 'chat:', 'post:', 'profile:', 'group:', 'notif:', 'ui:'];
// Eventos que main empuja a la UI (webContents.send)
const EVENT_PREFIXES = ['login:', 'chat:', 'notif:'];

function allowed(channel, prefixes) {
  return typeof channel === 'string' && prefixes.some((prefix) => channel.startsWith(prefix));
}

contextBridge.exposeInMainWorld('mewe', {
  invoke(channel, ...args) {
    if (!allowed(channel, INVOKE_PREFIXES)) {
      return Promise.resolve({ ok: false, error: { name: 'IpcError', message: `Canal IPC no permitido: ${channel}` } });
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, callback) {
    if (!allowed(channel, EVENT_PREFIXES)) throw new Error(`Evento IPC no permitido: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
