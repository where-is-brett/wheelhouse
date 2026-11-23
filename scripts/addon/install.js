// scripts/addon/install.js
// Installs the Wheelhouse panel from the release's .vsix with VS Code's own command line (`code --install-extension <file>`),
// after the director's click on its card. A local install takes no updates, so no setting is changed. Nothing is published.
//
// The file is always checked against `vscode/vsix.sha256` first (scripts/addon/hash.js, which the release job and CI also
// use). A file that differs, or no recorded hash, is refused in plain words with nothing installed. The packing and hashing
// modules are loaded when needed, not at the top, so this file loads in a release that doesn't carry them: the answer is then
// "the panel's package isn't in this release".
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';
import { ADDON_ID, runCode } from '../update/addon.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL_WAIT_MS = 120000;

export const MISMATCH = 'The panel file here isn\'t the one this release was checked with, so nothing was installed. Please tell whoever looks after Wheelhouse for you.';
export const UNRELEASED = 'The Wheelhouse panel\'s package isn\'t in this release, so nothing was installed.';
export const REFUSED = 'VS Code didn\'t take the panel, so it wasn\'t installed. Your company may allow only some extensions; your IT can allow wheelhouse.wheelhouse.';
export const INSTALLED = 'The Wheelhouse panel is installed in VS Code. Reload VS Code to start it.';

// The words for a computer where `code` isn't on the path: the clicks, and where the file is.
export const clicksFor = (file) => `VS Code's command line isn't on this computer's path, so the panel is ready for you to add by hand: in VS Code, open Extensions, choose the ⋯ menu, then Install from VSIX…, and pick ${file}.`;

// The packing and hashing modules (Task 7.1), or null where this release doesn't carry them.
export async function loadPackage() {
  try {
    const [pack, hash] = await Promise.all([import('./pack.js'), import('./hash.js')]);
    if (typeof pack.vsixName !== 'function' || typeof pack.pack !== 'function' || typeof hash.checkHash !== 'function') return null;
    return { vsixName: pack.vsixName, pack: pack.pack, checkHash: hash.checkHash };
  } catch {
    return null;
  }
}

const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// install({ file, run, platform, env, load }) -> Promise<{ ok, says, file }>. Never throws. Refuses a file whose hash is not the
// recorded one and installs nothing; with no `code` on the path says the clicks and names the file. `load` gives the packing
// and hashing modules (a seam for tests).
export async function install({ file, run = realRun, platform = process.platform, env = process.env, load = loadPackage } = {}) {
  try {
    const part = await load();
    if (part === null || part === undefined) return { ok: false, says: UNRELEASED };
    let checked;
    try { checked = await part.checkHash(); } catch { checked = null; }
    if (checked === null || checked === undefined) return { ok: false, says: UNRELEASED };
    let actual = null;
    try { actual = sha256Of(file); } catch { /* an unreadable file is a file that differs */ }
    if (checked.ok !== true || typeof checked.expected !== 'string' || actual !== checked.expected) return { ok: false, says: MISMATCH };
  } catch {
    return { ok: false, says: UNRELEASED };
  }
  try {
    const result = await runCode({ run, platform, env, args: ['--install-extension', file, '--force'], timeoutMs: INSTALL_WAIT_MS });
    if (result?.code !== 0) return { ok: false, says: REFUSED, file };
    return { ok: true, says: INSTALLED, file };
  } catch {
    // No `code` to run: the file stays, for the director to pick by hand.
    return { ok: false, says: clicksFor(file), file };
  }
}

// The version the release at `root` is: the plugin's own. Null when it can't be read.
export function pluginVersionOf(root = HERE) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null; } catch { return null; }
}

// installPanel({ root, tmp, run, platform, env, load }) -> Promise<{ ok, says, file? }>: packs the release's panel into a
// folder of its own under `tmp`, then installs it. Never throws.
export async function installPanel({ root = HERE, tmp = os.tmpdir(), run = realRun, platform = process.platform, env = process.env, load = loadPackage } = {}) {
  let part;
  try { part = await load(); } catch { part = null; }
  if (part === null || part === undefined) return { ok: false, says: UNRELEASED };
  const version = pluginVersionOf(root);
  if (typeof version !== 'string') return { ok: false, says: UNRELEASED };
  let file;
  try {
    const dir = fs.mkdtempSync(path.join(tmp, 'wheelhouse-panel-'));
    const made = await part.pack({ out: path.join(dir, part.vsixName(version)) });
    file = made?.file ?? path.join(dir, part.vsixName(version));
  } catch (error) {
    return { ok: false, says: `The Wheelhouse panel wasn't packed: ${String(error?.message ?? 'no reason given').replace(/\s+/g, ' ')}` };
  }
  return install({ file, run, platform, env, load: async () => part });
}

export { ADDON_ID };
