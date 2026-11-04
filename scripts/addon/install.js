// scripts/addon/install.js
// Packs the VS Code add-on and installs it with VS Code's own command line (`code --install-extension <file>`), as
// `start-helper.js addon` does after the director's click on its card. A local install takes no updates, so no
// setting is changed. Nothing is published.
//
// The pack is always checked against `vscode/vsix.sha256` first, wherever the folder is from (a plugin folder has no .git, so
// nothing is decided from git). A pack that differs, or no recorded hash, is refused in plain words with nothing installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteForCmd, resolveCommand } from '../lib/claude.js';
import { run as realRun } from '../lib/run.js';
import { checkHash } from './hash.js';
import { pack, pluginVersion, vsixName } from './pack.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL_WAIT_MS = 120000;

export const MISMATCH = 'The add-on file here isn\'t the one this release was checked with, so nothing was installed. Please tell whoever looks after Wheelhouse for you.';
export const UNRELEASED = 'The Wheelhouse add-on isn\'t released in this version, so nothing was installed.';
export const REFUSED = 'VS Code didn\'t take the add-on, so it wasn\'t installed.';
const IT_MAY_BLOCK = ' Your company may allow only some extensions; your IT can allow wheelhouse.wheelhouse.';

// The words for a computer where `code` isn't on the path: the clicks, and where the file is.
export const clicksFor = (file) => `VS Code's command line isn't on this computer's path, so the add-on is ready for you to add by hand: in VS Code, open Extensions, choose ⋯, then Install from VSIX…, and pick ${file}.`;

// installAddon({ root, tmp, run, platform, env, check }) -> Promise<{ ok, line, file? }>. Never throws. `check` is for tests.
export async function installAddon({ root = HERE, tmp = os.tmpdir(), run = realRun, platform = process.platform, env = process.env, check = checkHash } = {}) {
  let file;
  try {
    file = pack({ root, out: path.join(tmp, 'wheelhouse-addon', vsixName(pluginVersion(root))) });
  } catch (error) {
    return { ok: false, line: `The add-on wasn't packed: ${error.message}` };
  }
  let checked;
  try { checked = check({ root, file }); } catch { checked = { ok: false }; }
  if (checked?.ok !== true) {
    fs.rmSync(file, { force: true });
    return { ok: false, line: checked?.missing ? UNRELEASED : MISMATCH };
  }
  try {
    const resolved = resolveCommand({ name: 'code', platform, env });
    const args = ['--install-extension', file];
    const call = resolved.kind === 'cmd'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, ...args].map(quoteForCmd).join(' ')}"`], verbatim: true }
      : { file: resolved.file, args, verbatim: false };
    const result = await run(call.file, call.args, { env, input: '', timeoutMs: INSTALL_WAIT_MS, windowsVerbatimArguments: call.verbatim });
    if (result?.code !== 0) return { ok: false, line: `${REFUSED}${IT_MAY_BLOCK}`, file };
    return { ok: true, line: 'The Wheelhouse add-on is installed in VS Code. Reload VS Code to start it', file };
  } catch {
    // The file stays, for the director to pick by hand.
    return { ok: false, line: clicksFor(file), file };
  }
}

// Whether VS Code already has the add-on: `code --list-extensions` names it. Null when that can't be asked (no command line,
// or it failed): the answer is "can't tell", and the offer still comes. Never throws.
export async function addonInstalled({ run = realRun, platform = process.platform, env = process.env } = {}) {
  try {
    const resolved = resolveCommand({ name: 'code', platform, env });
    const args = ['--list-extensions'];
    const call = resolved.kind === 'cmd'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, ...args].map(quoteForCmd).join(' ')}"`], verbatim: true }
      : { file: resolved.file, args, verbatim: false };
    const result = await run(call.file, call.args, { env, input: '', timeoutMs: 30000, windowsVerbatimArguments: call.verbatim });
    if (result?.code !== 0) return null;
    return String(result.stdout ?? '').split(/\r?\n/).some((l) => l.trim().toLowerCase() === 'wheelhouse.wheelhouse');
  } catch {
    return null;
  }
}
