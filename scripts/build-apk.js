// Genera el APK de release de Android y lo deja en dist/ (npm run android:apk).
// Para que salga firmado tiene que existir android/keystore.properties (ver android/app/build.gradle).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const at = (relative) => fileURLToPath(new URL(relative, root));
const { version } = createRequire(import.meta.url)('../package.json');
const windows = process.platform === 'win32';

function run(command, cwd) {
  // shell: los .cmd / .bat de Windows (npm, gradlew) no se pueden lanzar sin él
  const { status } = spawnSync(command, { cwd, stdio: 'inherit', shell: true });
  if (status !== 0) process.exit(status ?? 1);
}

run('npm run android:sync', at('.'));
run(`${windows ? '.\\gradlew.bat' : './gradlew'} assembleRelease`, at('android'));

const outputs = at('android/app/build/outputs/apk/release');
const signed = (await fs.readdir(outputs)).includes('app-release.apk');
const apk = at(`dist/Goonie-Mewe-Viewer-${version}${signed ? '' : '-sin-firmar'}.apk`);
await fs.mkdir(at('dist'), { recursive: true });
await fs.copyFile(`${outputs}/${signed ? 'app-release.apk' : 'app-release-unsigned.apk'}`, apk);
console.log(signed ? `APK firmado: ${apk}` : `APK SIN FIRMAR (falta android/keystore.properties): ${apk}`);
