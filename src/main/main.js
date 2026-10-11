import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { serializeError } from '../mewe/errors.js';
import { AccountManager } from './accountManager.js';
import { AccountStore } from './accountStore.js';
import { handleImageProtocol, registerImageScheme } from './imageProtocol.js';
import { registerIpc } from './ipc.js';
import { Realtime } from './realtime.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;

// Empaquetada, los volcados de --mewe-debug van a la carpeta de datos del usuario
if (app.isPackaged) process.env.MEWE_DEBUG_DIR ??= path.join(app.getPath('userData'), 'mewe-debug');

registerImageScheme();

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 800,
    minWidth: 320,
    title: 'Goonie Mewe Viewer',
    autoHideMenuBar: true, // el menú File / Edit… sólo aparece con Alt
    webPreferences: {
      preload: path.join(dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadFile(path.join(dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const store = new AccountStore(app.getPath('userData'));
  await store.load();

  const accountManager = new AccountManager({
    store,
    getParentWindow: () => mainWindow,
    onLoginError: (accountId, err) => {
      const error = serializeError(err);
      console.error('[login]', error);
      mainWindow?.webContents.send('login:error', { accountId, error });
    },
    onLoginStatus: (accountId, message) => {
      console.log('[login]', message);
      mainWindow?.webContents.send('login:status', { accountId, message });
    },
  });

  const realtime = new Realtime({
    accountManager,
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload),
  });
  app.on('before-quit', () => realtime.stopAll());

  handleImageProtocol(accountManager);
  registerIpc({ accountManager, realtime, getWindow: () => mainWindow });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
