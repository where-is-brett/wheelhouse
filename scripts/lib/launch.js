// scripts/lib/launch.js
// Runs the script a launcher (bin/wh-*) stands for, with the launcher's arguments, its standard input and output,
// and its exit status. The script runs under the same Node.js that runs this, with NO_SYSTEM_CA when it knows it.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNCHED, LAUNCHERS } from './launchers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function launch(name, args = process.argv.slice(2), { exit = process.exit } = {}) {
  if (!Object.hasOwn(LAUNCHERS, name)) {
    process.stderr.write(`Wheelhouse has no launcher ${JSON.stringify(name)}\n`);
    return exit(2);
  }
  const flags = process.allowedNodeEnvironmentFlags.has('--use-system-ca') ? ['--no-use-system-ca'] : [];
  const child = spawn(process.execPath, [...flags, path.join(ROOT, LAUNCHERS[name]), ...args], { stdio: 'inherit', env: { ...process.env, [LAUNCHED]: '1' } });
  child.on('error', (error) => {
    process.stderr.write(`${name} could not start: ${error.message}\n`);
    exit(1);
  });
  child.on('exit', (code, signal) => exit(code ?? (signal === null ? 1 : 128)));
  return child;
}
