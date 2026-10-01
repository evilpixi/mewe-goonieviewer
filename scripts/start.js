// Lanza Electron sin ELECTRON_RUN_AS_NODE: las terminales de VS Code la definen
// y hace que Electron se comporte como Node puro (sin BrowserWindow, etc.).
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
