// scripts/addon/install.js
// Installs the Wheelhouse panel from the release's .vsix with VS Code's own command (`code --install-extension <file>`), after
// the director's click on its card. A local install takes no updates, so no setting is changed. Nothing is published.
//
// The file is always checked against `vscode/vsix.sha256` first (scripts/addon/hash.js, which the release job and CI also use),
// and again just before `code` runs. A file that differs, or no recorded hash, is refused with nothing installed. The packing and
// hashing modules are loaded when needed, so this file loads in a release that doesn't carry them: the answer is then "the
// panel's package isn't in this release".
//
// The packed file is made in the director's Downloads folder, where they can find it, and is removed once VS Code has taken it.
// Where VS Code can't be run, it stays, and the answer says how to add it by hand.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';
import { runCode } from '../update/addon.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL_WAIT_MS = 120000;

export const MISMATCH = 'The panel\'s file doesn\'t match this release, so nothing was installed. This is a fault to report.';
export const UNRELEASED = 'The Wheelhouse panel\'s package isn\'t in this release, so nothing was installed.';
export const REFUSED = 'VS Code didn\'t take the panel, so it wasn\'t installed. Your company may allow only some extensions; your IT can allow wheelhouse.wheelhouse.';
export const INSTALLED = 'The Wheelhouse panel is installed in VS Code. Reload VS Code to start it.';

// The steps for adding the file by hand.
const byHand = (file, platform) => `in VS Code, open Extensions, choose the ⋯ menu, then Install from VSIX…, and pick the file ${file}.${platform === 'darwin' ? ` On a Mac, in the file window press Cmd+Shift+G and paste this path: ${file}` : ''}`;

// Where VS Code can't be run: the clicks, and where the file is.
export const clicksFor = (file, platform = process.platform) => `Wheelhouse couldn't add the panel for you, so here is how to add it: ${byHand(file, platform)}`;
// A file name VS Code can't be given safely: the same clicks.
export const unsafeFor = (file, platform = process.platform) => `The panel's file name has a character Wheelhouse can't safely pass to VS Code, so here is how to add it yourself: ${byHand(file, platform)}`;
// VS Code was found, but it didn't answer.
export const SILENT = 'VS Code didn\'t answer, so the panel wasn\'t installed.';

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

// Whether `file` is the file the recorded hash names (a fresh pack of `root` must match that hash too).
async function holds({ part, root, file }) {
  let checked;
  try { checked = await part.checkHash({ root }); } catch { return 'unreleased'; }
  if (checked === null || checked === undefined) return 'unreleased';
  let actual = null;
  try { actual = sha256Of(file); } catch { /* an unreadable file is a file that differs */ }
  return checked.ok === true && typeof checked.expected === 'string' && actual === checked.expected ? 'holds' : 'differs';
}

// install({ file, root, run, platform, env, home, exists, load }) -> Promise<{ ok, says, file }>. Never throws. Refuses a file whose
// hash is not the recorded one and installs nothing; with no `code` says the clicks and names the file. `load` gives the packing and
// hashing modules (a seam for tests).
export async function install({
  file, root = HERE, run = realRun, platform = process.platform, env = process.env, home = os.homedir(), exists, load = loadPackage,
} = {}) {
  try {
    const part = await load();
    if (part === null || part === undefined) return { ok: false, says: UNRELEASED };
    const verdict = await holds({ part, root, file });
    if (verdict === 'unreleased') return { ok: false, says: UNRELEASED };
    if (verdict === 'differs') return { ok: false, says: MISMATCH };
  } catch {
    return { ok: false, says: UNRELEASED };
  }
  try {
    const result = await runCode({ run, platform, env, home, ...(exists === undefined ? {} : { exists }), args: ['--install-extension', file, '--force'], timeoutMs: INSTALL_WAIT_MS });
    if (result?.code !== 0) return { ok: false, says: REFUSED, file };
    return { ok: true, says: INSTALLED, file };
  } catch (error) {
    // The file stays, for the director to pick by hand.
    if (error?.code === 'NO_CODE') return { ok: false, says: clicksFor(file, platform), file };
    if (error?.code === 'UNSAFE_NAME') return { ok: false, says: unsafeFor(file, platform), file };
    return { ok: false, says: `${SILENT} ${clicksFor(file, platform)}`, file };
  }
}

// The version the release at `root` is: the plugin's own. Null when it can't be read.
export function pluginVersionOf(root = HERE) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null; } catch { return null; }
}

// The folder the packed file goes in: the director's Downloads, else their home.
function placeFor(home) {
  const downloads = path.join(home, 'Downloads');
  try { return fs.statSync(downloads).isDirectory() ? downloads : home; } catch { return home; }
}

// installPanel({ root, home, run, platform, env, exists, load }) -> Promise<{ ok, says, file? }>: packs the release's panel into
// the director's Downloads folder, then installs it, and removes the file once VS Code has taken it. Never throws.
export async function installPanel({
  root = HERE, home = os.homedir(), run = realRun, platform = process.platform, env = process.env, exists, load = loadPackage,
} = {}) {
  let part;
  try { part = await load(); } catch { part = null; }
  if (part === null || part === undefined) return { ok: false, says: UNRELEASED };
  const version = pluginVersionOf(root);
  if (typeof version !== 'string') return { ok: false, says: UNRELEASED };
  let file;
  try {
    const made = await part.pack({ root, out: path.join(placeFor(home), part.vsixName(version)) });
    file = made?.file;
    if (typeof file !== 'string') throw new Error('no file was made');
  } catch (error) {
    return { ok: false, says: `The Wheelhouse panel wasn't packed: ${String(error?.message ?? 'no reason given').replace(/\s+/g, ' ')}` };
  }
  const got = await install({ file, root, run, platform, env, home, exists, load: async () => part });
  // Kept only where the director may add it by hand.
  if (got.ok || [MISMATCH, UNRELEASED, REFUSED].includes(got.says)) fs.rmSync(file, { force: true });
  return got;
}
