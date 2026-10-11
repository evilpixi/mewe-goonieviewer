// Sube el APK de dist/ a la versión de GitHub que corresponde a package.json (npm run android:publish).
// La versión (el tag vX.Y.Z y su release) ya tiene que existir, y hace falta la CLI de GitHub (gh) con sesión iniciada.
// Además del APK, agrega su hash a SHA256SUMS.txt: toma el que ya tiene la versión, para no pisar los de escritorio.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { version } = createRequire(import.meta.url)('../package.json');
const tag = `v${version}`;
const name = `Goonie-Mewe-Viewer-${version}.apk`;
const apk = fileURLToPath(new URL(`../dist/${name}`, import.meta.url));
const SUMS = 'SHA256SUMS.txt';

function gh(args, { capture = false } = {}) {
  const result = spawnSync('gh', args, { stdio: capture ? ['ignore', 'pipe', 'ignore'] : 'inherit', encoding: 'utf8' });
  if (result.error) throw new Error('No se encontró la CLI de GitHub (gh): https://cli.github.com/');
  return result;
}

const data = await fs.readFile(apk).catch(() => {
  throw new Error(`No existe ${apk}: generalo antes con "npm run android:apk".`);
});
if (gh(['release', 'view', tag], { capture: true }).status !== 0) {
  throw new Error(`No existe la versión ${tag} en GitHub (o gh no tiene sesión): creala antes de subir el APK.`);
}

// mismo formato que el resto del archivo: "<hash> *<archivo>"
const hash = createHash('sha256').update(data).digest('hex');
const current = gh(['release', 'download', tag, '--pattern', SUMS, '--output', '-'], { capture: true });
const lines = (current.status === 0 ? current.stdout : '').split(/\r?\n/).filter((line) => line.trim() && !line.endsWith(`*${name}`));
const sums = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mewe-apk-')), SUMS);
await fs.writeFile(sums, `${[...lines, `${hash} *${name}`].join('\n')}\n`);

// --clobber: reemplaza el APK y el SHA256SUMS.txt si la versión ya los tenía
if (gh(['release', 'upload', tag, apk, sums, '--clobber']).status !== 0) process.exit(1);
console.log(`${name} subido a ${tag}\nSHA-256: ${hash}`);
