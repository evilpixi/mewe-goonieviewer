// Copia a src/renderer/icons/ los íconos de Lucide (lucide-static, licencia ISC) que usa la app.
// La app empaquetada sólo incluye src/, así que no puede leerlos de node_modules.
// Para sumar un ícono: agregarlo a ICONS, correr `npm run icons:update` y declarar `.icon-<nombre>` en styles.css.
import fs from 'node:fs/promises';

const ICONS = [
  'reply', 'smile', 'smile-plus', 'dices', 'pencil', 'paperclip', 'maximize-2', 'minimize-2', 'corner-down-left', 'x',
  // cabecera y segundo panel
  'arrow-left', 'arrow-down', 'newspaper', 'message-circle', 'list', 'users', 'circle-dashed', 'search', 'bell', 'ellipsis-vertical', 'plus', 'refresh-cw',
  // barra de la vista en mobile: reemplazan a las etiquetas
  'layout-grid', 'user', 'users-round', 'user-check', 'heart', 'bell', 'check-check', 'radio', 'settings',
  // acciones
  'ban', 'download', 'copy', 'link', 'check', 'play', 'external-link',
  // chat: menú de un mensaje y temporizador
  'ellipsis', 'forward', 'timer',
  // historias
  'pause', 'trash-2', 'send', 'chevron-left', 'chevron-right', 'type', 'image', 'eye',
];
const SOURCE = new URL('../node_modules/lucide-static/icons/', import.meta.url);
const OUTPUT = new URL('../src/renderer/icons/', import.meta.url);

await fs.mkdir(OUTPUT, { recursive: true });
for (const name of ICONS) {
  await fs.copyFile(new URL(`${name}.svg`, SOURCE), new URL(`${name}.svg`, OUTPUT));
}
console.log(`${ICONS.length} íconos copiados a src/renderer/icons/`);
