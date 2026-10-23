// adapters/copilot/identity.js
// Who Copilot is to the core: its name, its label, the oldest version Wheelhouse has tested, and how to
// tell whether its command line is installed. It imports only the design's numbers.
import fs from 'node:fs';
import path from 'node:path';
import { COPILOT_VERSION } from '../../scripts/lib/copilot-numbers.js';

// Whether the `copilot` command line is on the PATH. It is looked for, never started, so its version is
// not asked for here (it starts the program). On Windows a program is an .exe or an npm .cmd shim, and the
// PATH variable may be spelt Path.
function find({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const windows = platform === 'win32';
  const join = windows ? path.win32.join : path.posix.join;
  const key = Object.keys(env).find((name) => (windows ? name.toLowerCase() === 'path' : name === 'PATH'));
  const folders = String(key ? env[key] : '').split(windows ? ';' : ':').map((f) => f.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const names = windows ? ['copilot.exe', 'copilot.cmd'] : ['copilot'];
  const found = folders.some((folder) => names.some((name) => exists(join(folder, name))));
  return { found, version: null };
}

export default Object.freeze({ name: 'copilot', label: 'Copilot', floor: COPILOT_VERSION, find });
