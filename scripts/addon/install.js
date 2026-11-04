// scripts/addon/install.js
// Packs the VS Code add-on and installs it with VS Code's own command line (`code --install-extension <file>`), as
// `start-helper.js addon` does after the director's click on its card. A local install takes no updates, so no
// setting is changed. Nothing is published.
//
// On a checkout at a release tag, the pack is checked against `vscode/vsix.sha256` first, and a pack that differs is refused
// in plain words with nothing installed. Between tags the pack is made from the checkout as it is.
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
export const REFUSED = 'VS Code didn\'t take the add-on, so it wasn\'t installed.';
const IT_MAY_BLOCK = ' Your company may allow only some extensions; your IT can allow wheelhouse.wheelhouse.';

// The words for a computer where `code` isn't on the path: the clicks, and where the file is.
export const clicksFor = (file) => `VS Code's command line isn't on this computer's path, so the add-on is ready for you to add by hand: in VS Code, open Extensions, choose ⋯, then Install from VSIX…, and pick ${file}.`;

// Whether the checkout is exactly at a release tag. A checkout that can't be asked is not at one.
async function atReleaseTag({ root, git, env }) {
  const got = await git('git', ['describe', '--exact-match', '--tags'], { cwd: root, env, input: '', timeoutMs: 10000 });
  return got?.code === 0 && String(got.stdout).trim() !== '';
}

// installAddon({ root, tmp, run, platform, env, tagged, check }) -> Promise<{ ok, line, file? }>. Never throws.
// `git`, `tagged` and `check` are for tests: git's runner, whether the checkout is at a release tag, and the hash check.
export async function installAddon({ root = HERE, tmp = os.tmpdir(), run = realRun, platform = process.platform, env = process.env, git = realRun, tagged = () => atReleaseTag({ root, git, env }), check = checkHash } = {}) {
  let file;
  try {
    file = pack({ root, out: path.join(tmp, 'wheelhouse-addon', vsixName(pluginVersion(root))) });
  } catch (error) {
    return { ok: false, line: `The add-on wasn't packed: ${error.message}` };
  }
  let onTag = false;
  try { onTag = (await tagged()) === true; } catch { onTag = false; }
  if (onTag && !check({ root, file }).ok) {
    fs.rmSync(file, { force: true });
    return { ok: false, line: MISMATCH };
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
