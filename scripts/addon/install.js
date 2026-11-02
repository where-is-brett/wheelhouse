// scripts/addon/install.js
// Packs the VS Code add-on and installs it with VS Code's own command line (`code --install-extension <file>`), as
// `start-helper.js addon` does after the director's click on its card. A local install takes no updates, so no
// setting is changed. Nothing is published.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteForCmd, resolveCommand } from '../lib/claude.js';
import { run as realRun } from '../lib/run.js';
import { pack, pluginVersion, vsixName } from './pack.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL_WAIT_MS = 120000;

export const NO_CODE = 'VS Code\'s command line (`code`) isn\'t available here, so the add-on wasn\'t installed. In VS Code, run "Shell Command: Install \'code\' command in PATH", then ask again';
export const REFUSED = 'VS Code didn\'t take the add-on, so it wasn\'t installed';

// installAddon({ root, tmp, run, platform, env }) -> Promise<{ ok, line, file? }>. Never throws.
export async function installAddon({ root = HERE, tmp = os.tmpdir(), run = realRun, platform = process.platform, env = process.env } = {}) {
  let file;
  try {
    file = pack({ root, out: path.join(tmp, 'wheelhouse-addon', vsixName(pluginVersion(root))) });
  } catch (error) {
    return { ok: false, line: `The add-on wasn't packed: ${error.message}` };
  }
  try {
    const resolved = resolveCommand({ name: 'code', platform, env });
    const args = ['--install-extension', file];
    const call = resolved.kind === 'cmd'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, ...args].map(quoteForCmd).join(' ')}"`], verbatim: true }
      : { file: resolved.file, args, verbatim: false };
    const result = await run(call.file, call.args, { env, input: '', timeoutMs: INSTALL_WAIT_MS, windowsVerbatimArguments: call.verbatim });
    if (result?.code !== 0) return { ok: false, line: REFUSED, file };
    return { ok: true, line: 'The Wheelhouse add-on is installed in VS Code. Reload VS Code to start it', file };
  } catch {
    fs.rmSync(file, { force: true });
    return { ok: false, line: NO_CODE };
  }
}
