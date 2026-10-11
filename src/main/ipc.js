import fs from 'node:fs/promises';
import { clipboard, dialog, ipcMain, nativeImage } from 'electron';
import { accountChannels, registerChannels, wrapHandler } from '../core/channels.js';
import { avatarColor } from './avatarColor.js';

// Engancha a ipcMain los canales compartidos (src/core/channels.js) y los propios de Electron ('ui:*').
function handle(channel, fn) {
  const run = wrapHandler(channel, fn);
  ipcMain.handle(channel, (_event, ...args) => run(...args));
}

export function registerIpc({ accountManager, realtime, getWindow }) {
  registerChannels({ handle, accountManager, realtime });

  const account = accountChannels(handle, accountManager);

  // Zoom de toda la ventana (ajustes de UI)
  handle('ui:zoom', (factor) => {
    const zoom = Math.min(Math.max(Number(factor) || 1, 0.5), 2.5);
    getWindow()?.webContents.setZoomFactor(zoom);
    return zoom;
  });

  // Color predominante de una foto de perfil (borde de los globos del chat)
  account('ui:avatarColor', (client, _me, url) => avatarColor(client, url));

  // Descarga una imagen de MeWe (con las cookies de la cuenta) y la guarda donde elija el usuario
  account('ui:download', async (client, _me, url, suggestedName) => {
    const { data, contentType } = await client.downloadImage(url);
    const type = contentType.split(';')[0].trim();
    // video/mp4: los videos de las historias se guardan por el mismo camino
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4' }[type] ?? 'jpg';
    const base = String(suggestedName || 'mewe-imagen').replace(/[^\w.-]+/g, '_').replace(/\.\w+$/, '');
    const options = { defaultPath: `${base}.${ext}`, filters: [{ name: ext === 'mp4' ? 'Video' : 'Imagen', extensions: [ext] }] };
    const win = getWindow();
    const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (canceled || !filePath) return { saved: false };
    await fs.writeFile(filePath, data);
    return { saved: true, filePath };
  });

  // Copia una imagen de MeWe al portapapeles. nativeImage sólo decodifica PNG y JPEG: con otro formato
  // devuelve { copied: false } y la UI recurre a ui:copyImageAt.
  account('ui:copyImage', async (client, _me, url) => {
    const { data } = await client.downloadImage(url);
    const image = nativeImage.createFromBuffer(Buffer.from(data));
    if (image.isEmpty()) return { copied: false };
    clipboard.writeImage(image);
    return { copied: true };
  });

  // Copia la imagen que se ve en ese punto de la ventana (x, y en px de CSS): sirve para WebP y GIF
  handle('ui:copyImageAt', (x, y) => {
    const contents = getWindow()?.webContents;
    if (!contents) return { copied: false };
    const zoom = contents.getZoomFactor();
    contents.copyImageAt(Math.round(Number(x) * zoom), Math.round(Number(y) * zoom));
    return { copied: true };
  });

  handle('ui:copyText', (text) => {
    clipboard.writeText(String(text ?? '').slice(0, 2000));
    return true;
  });
}
