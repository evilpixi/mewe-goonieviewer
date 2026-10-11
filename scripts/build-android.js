// Arma www/, la carpeta web que Capacitor empaqueta en la app de Android (npm run android:sync).
//   www/        ← src/renderer (la UI, tal cual)
//   www/_app/   ← lo que en Electron corre en el proceso principal y en Android corre en el WebView:
//                 src/config.js, src/mewe, src/core y src/android (misma estructura: los imports no cambian)
// Sin bundler: son los mismos módulos ES de src/.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const at = (relative) => fileURLToPath(new URL(relative, root));
const BRIDGE = '<script type="module" src="_app/android/bridge.js"></script>';
const APP = '<script type="module" src="js/app.js"></script>';

await fs.rm(at('www'), { recursive: true, force: true });
await fs.cp(at('src/renderer'), at('www'), { recursive: true });
await fs.cp(at('src/config.js'), at('www/_app/config.js'));
for (const dir of ['mewe', 'core', 'android']) {
  await fs.cp(at(`src/${dir}`), at(`www/_app/${dir}`), { recursive: true });
}

// window.mewe tiene que existir antes de que arranque la UI: los módulos se ejecutan en el orden del documento
const indexFile = at('www/index.html');
const html = await fs.readFile(indexFile, 'utf8');
if (!html.includes(APP)) throw new Error(`No se encontró ${APP} en src/renderer/index.html`);
await fs.writeFile(indexFile, html.replace(APP, `${BRIDGE}\n    ${APP}`));

console.log('www/ lista para Capacitor');
