// scripts/update/addon.js
// The Wheelhouse panel for VS Code (the add-on) on this computer, and whether setup or the update should offer it. VS Code lists
// what is installed (`code --list-extensions --show-versions`); the panel is offered once if it is not there, and as an update
// if the installed version is older than this release's. Nothing is offered for the same version, and no update is offered when
// the installed version can't be read. `code` is looked for on the path first, then in VS Code's own folders; with none found,
// the version is read from VS Code's extensions folder, and the install gives the clicks. Nothing here installs:
// scripts/addon/install.js does, once the director has clicked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quoteForCmd, resolveCommand } from '../lib/claude.js';
import { run as realRun } from '../lib/run.js';
import { compareVersions } from '../lib/versions.js';

export const ADDON_ID = 'wheelhouse.wheelhouse';

// What the Update card says about the panel when it is already installed and older. A first install is never on the Update card:
// it is its own question (scripts/update/panel.js).
export const panelOnCard = (offer) => `The Wheelhouse panel in VS Code goes from ${offer.from} to ${offer.to} too; reload VS Code after.`;

// Thrown when there is no `code` to run: not on the path and not in VS Code's own folders.
export class NoCodeError extends Error {
  constructor() {
    super('VS Code has no command to run on this computer.');
    this.code = 'NO_CODE';
  }
}
// Thrown when a name can't be passed to cmd.exe safely.
export class UnsafeNameError extends Error {
  constructor(message) {
    super(message);
    this.code = 'UNSAFE_NAME';
  }
}

// Where VS Code's own copy of its command is, by system.
function ownCopies({ platform, env, home }) {
  if (platform === 'darwin') {
    return [
      { kind: 'direct', file: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' },
      { kind: 'direct', file: path.posix.join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code') },
    ];
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local');
    return [
      { kind: 'cmd', file: path.win32.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') },
      { kind: 'cmd', file: path.win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'bin', 'code.cmd') },
    ];
  }
  return [{ kind: 'direct', file: '/usr/share/code/bin/code' }];
}

// VS Code's command: on the path first, then VS Code's own copy. { kind: 'direct' | 'cmd', file } or null.
export function findCode({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  try {
    if (platform === 'win32') {
      try { return resolveCommand({ name: 'code', platform, env, exists }); } catch { /* not on the path: VS Code's own copy */ }
    } else {
      for (const folder of String(env.PATH ?? '').split(':').filter((f) => f.startsWith('/'))) {
        const file = path.posix.join(folder, 'code');
        if (exists(file)) return { kind: 'direct', file };
      }
    }
    return ownCopies({ platform, env, home }).find((copy) => exists(copy.file)) ?? null;
  } catch {
    return null;
  }
}

// Runs `code <args>`, through cmd.exe where the command is a .cmd file. Resolves { code, stdout }. Rejects with a NoCodeError where
// there is no `code` to run, and an UnsafeNameError for a name cmd.exe can't be given safely.
export async function runCode({
  run = realRun, platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync, args, timeoutMs = 30000,
}) {
  const found = findCode({ platform, env, home, exists });
  if (found === null) throw new NoCodeError();
  let call;
  if (found.kind === 'cmd') {
    let line;
    try { line = [found.file, ...args].map(quoteForCmd).join(' '); } catch (error) { throw new UnsafeNameError(error.message); }
    call = { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  } else {
    call = { file: found.file, args, verbatim: false };
  }
  try {
    return await run(call.file, call.args, { env, input: '', timeoutMs, windowsVerbatimArguments: call.verbatim });
  } catch (error) {
    if (error?.code === 'ENOENT' || /ENOENT/.test(String(error?.message))) throw new NoCodeError();
    throw error;
  }
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

// The version of the panel VS Code keeps in its extensions folder (~/.vscode/extensions/wheelhouse.wheelhouse-<version>), the
// highest if there are several; null when none is there.
export function versionOnDisk({ home = os.homedir(), readdir = (d) => fs.readdirSync(d) } = {}) {
  try {
    const found = readdir(path.join(home, '.vscode', 'extensions'))
      .map((name) => /^wheelhouse\.wheelhouse-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)(?:-(?:universal|darwin|win32|linux|alpine|web)[\w-]*)?$/i.exec(String(name))?.[1])
      .filter(Boolean);
    return found.sort((a, b) => compareVersions(b, a) ?? 0)[0] ?? null;
  } catch {
    return null;
  }
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

// addonOffer({ run, platform, env, home, exists, readdir, pluginVersion, present }) -> null | { kind: 'install' | 'update', from?, to }.
// `pluginVersion` is the release's own, which the panel carries. The panel's version comes from `code --list-extensions
// --show-versions`, else from VS Code's extensions folder. A version that can't be read means no update offer; an install is
// offered only where the panel is clearly absent (listed as missing, or VS Code is here and no copy of it is). Never throws.
export async function addonOffer({
  run = realRun, platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync, readdir,
  pluginVersion, present = () => vscodeHere({ platform, env, home, exists }),
} = {}) {
  try {
    const to = String(pluginVersion ?? '').replace(/^v/, '');
    if (to === '') return null;
    let version; // undefined: not asked; null: asked and absent; a string: the version
    try {
      const got = await runCode({ run, platform, env, home, exists, args: ['--list-extensions', '--show-versions'] });
      if (got?.code === 0) version = panelVersionIn(got.stdout);
    } catch { /* no `code` to ask */ }
    if (version === undefined) {
      const disk = versionOnDisk({ home, ...(readdir === undefined ? {} : { readdir }) });
      if (disk !== null) version = disk;
    }
    if (version === undefined) return present() === true ? { kind: 'install', to } : null;
    if (version === null) return { kind: 'install', to };
    // A version that can't be read gets no update offer.
    return compareVersions(version, to) === -1 ? { kind: 'update', from: version, to } : null;
  } catch {
    return null;
  }
}

// The offer the plan the director's click was for named, or null: only then does the update bring the panel up to date.
export function planNamedAddon(journal) {
  try {
    const named = JSON.parse(fs.readFileSync(path.join(journal.folder, 'plan.json'), 'utf8'))?.plan?.addon;
    return named?.kind === 'update' ? named : null;
  } catch {
    return null;
  }
}
