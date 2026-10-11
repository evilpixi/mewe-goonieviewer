import fs from 'node:fs/promises';
import path from 'node:path';
import { session } from 'electron';
import { openLoginWindow } from './loginWindow.js';
import { SessionCookies } from './sessionCookies.js';

// Lo que el código compartido (src/core, src/mewe) necesita de Electron y de Node.

// Para AccountManager: cada cuenta tiene su partition de Electron, así que las cookies nunca se mezclan.
export function electronPlatform({ getParentWindow }) {
  const sessionOf = (account) => session.fromPartition(account.partition);
  return {
    newAccount: (id) => ({ id, partition: `persist:mewe-${id}` }),
    cookiesFor: (account) => new SessionCookies(sessionOf(account)),
    clientOptions: { dump: dumpResponse },
    login: ({ account, ...options }) => openLoginWindow({ ses: sessionOf(account), parent: getParentWindow(), ...options }),
    clearSession: (account) => sessionOf(account).clearStorageData(),
  };
}

// Para AccountStore: un archivo de texto
export function fileStorage(file) {
  return {
    async read() {
      try {
        return await fs.readFile(file, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async write(text) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
    },
  };
}

// Para Realtime: el WebSocket de Node (undici) acepta cabeceras extra
export function connectWebSocket(url, headers) {
  return new WebSocket(url, { headers });
}

// Modo debug: la última respuesta de cada endpoint queda en ./mewe-debug/
// (la app empaquetada define MEWE_DEBUG_DIR: su carpeta de instalación no es escribible)
async function dumpResponse(url, text) {
  const dir = process.env.MEWE_DEBUG_DIR ?? path.join(process.cwd(), 'mewe-debug');
  const file = `${url.pathname.replace(/^\/api\//, '').replace(/[^\w-]+/g, '_')}.json`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), text);
}
