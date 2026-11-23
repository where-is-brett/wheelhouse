// scripts/update/addon.js
// The Wheelhouse panel for VS Code (the add-on) on this computer, and whether the update or setup should offer it. VS Code lists
// what is installed (`code --list-extensions --show-versions`); the panel is offered once if it is not there, and as an update
// if the installed version is older than this release's. Nothing is offered for the same version. Where VS Code can't be asked
// (no `code` on the path), the offer still comes when VS Code is evidently on this computer, and the install then gives the
// clicks. Nothing here installs: scripts/addon/install.js does, once the director has clicked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quoteForCmd, resolveCommand } from '../lib/claude.js';
import { run as realRun } from '../lib/run.js';
import { compareVersions } from '../lib/versions.js';

export const ADDON_ID = 'wheelhouse.wheelhouse';

// The sentences the Update card carries about the panel, in its "What happens" part.
export const panelOnCard = (offer) => (offer.kind === 'update'
  ? `The Wheelhouse panel in VS Code goes from ${offer.from} to ${offer.to} too; reload VS Code after.`
  : `The Wheelhouse panel (${offer.to}) is added to VS Code too; Not now skips all of this.`);

// Runs `code <args>`, through cmd.exe where VS Code's command line is a .cmd shim. Resolves { code, stdout }; rejects when there is no `code` to run.
export async function runCode({ run = realRun, platform = process.platform, env = process.env, args, timeoutMs = 30000 }) {
  const resolved = resolveCommand({ name: 'code', platform, env });
  const call = resolved.kind === 'cmd'
    ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, ...args].map(quoteForCmd).join(' ')}"`], verbatim: true }
    : { file: resolved.file, args, verbatim: false };
  return run(call.file, call.args, { env, input: '', timeoutMs, windowsVerbatimArguments: call.verbatim });
}

// The version of the panel in a `--list-extensions --show-versions` listing: a version string (empty when the line carries
// none), or null when it isn't listed.
export function panelVersionIn(listing) {
  for (const line of String(listing ?? '').split(/\r?\n/)) {
    const [id, version = ''] = line.trim().split('@');
    if (id.toLowerCase() === ADDON_ID) return version;
  }
  return null;
}

// Whether VS Code is evidently on this computer when `code` can't be asked: it is where it installs by default.
export function vscodeHere({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  try {
    if (platform === 'darwin') return exists('/Applications/Visual Studio Code.app') || exists(path.posix.join(home, 'Applications', 'Visual Studio Code.app'));
    if (platform === 'win32') {
      const local = env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local');
      return exists(path.win32.join(local, 'Programs', 'Microsoft VS Code')) || exists(path.win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code'));
    }
    return exists('/usr/share/code') || exists('/opt/visual-studio-code');
  } catch {
    return false;
  }
}

// addonOffer({ run, platform, env, pluginVersion, present }) -> null | { kind: 'install' | 'update', from?, to }. `pluginVersion` is the
// release's own, which the panel carries. `present()` says whether VS Code is on this computer when `code` can't be asked. Never throws.
export async function addonOffer({
  run = realRun, platform = process.platform, env = process.env, pluginVersion, present = () => vscodeHere({ platform, env }),
} = {}) {
  try {
    const to = String(pluginVersion ?? '').replace(/^v/, '');
    if (to === '') return null;
    let listed = null;
    try {
      const got = await runCode({ run, platform, env, args: ['--list-extensions', '--show-versions'] });
      if (got?.code === 0) listed = { version: panelVersionIn(got.stdout) };
    } catch { /* no `code` to ask */ }
    if (listed === null) return present() === true ? { kind: 'install', to } : null;
    if (listed.version === null) return { kind: 'install', to };
    // A version that can't be read is taken as older, so the panel is brought to this release's.
    const order = compareVersions(listed.version, to);
    return order === -1 || order === null ? { kind: 'update', from: listed.version === '' ? 'an unknown version' : listed.version, to } : null;
  } catch {
    return null;
  }
}

// The offer the plan the director's click was for named, or null: only then does the install run.
export function planNamedAddon(journal) {
  try {
    const named = JSON.parse(fs.readFileSync(path.join(journal.folder, 'plan.json'), 'utf8'))?.plan?.addon;
    return named?.kind === 'install' || named?.kind === 'update' ? named : null;
  } catch {
    return null;
  }
}
