// vscode/resolver.cjs
// What the add-on needs from Wheelhouse without importing it: the helper's address and the project's id. Both are
// copies of core's (scripts/lib/paths.js helperAddress, scripts/hooks/kit.js projectOf), and a CI test compares them
// with core's own, so a change there that is not made here fails the build. Plain Node.js with no import from
// `scripts/`, because the add-on is packed alone.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The Wheelhouse home: WHEELHOUSE_HOME where one is given, else ~/.wheelhouse.
const wheelhouseHome = (env = process.env) => env.WHEELHOUSE_HOME || path.join(os.homedir(), '.wheelhouse');

// The helper's socket in `home`, or on Windows its named pipe (a pipe of a home other than ~/.wheelhouse carries a
// short hash of that home's path).
function helperAddress({ platform = process.platform, user = os.userInfo().username, home = wheelhouseHome(), homedir = os.homedir() } = {}) {
  if (platform === 'win32') {
    const spelt = (dir) => path.win32.resolve(dir).toLowerCase();
    const own = spelt(home) === spelt(path.join(homedir, '.wheelhouse'))
      ? '' : `-${crypto.createHash('sha256').update(spelt(home)).digest('hex').slice(0, 12)}`;
    return `\\\\.\\pipe\\wheelhouse-${String(user).replace(/[^A-Za-z0-9_.-]/g, '_')}${own}-helper`;
  }
  return path.join(home, 'helper.sock');
}

const SAFE_PART = /^[A-Za-z0-9._-]+$/;
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
const keyOf = (p) => (caseBlind ? p.toLowerCase() : p);
const SMALL = 1024 * 1024;

function readText(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= SMALL ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

// The main folder of the repository `cwd` is in, read from .git files only: a `.git` folder is the main folder; a
// `.git` file's gitdir leads, through its commondir, to the main .git, whose parent is the main folder.
function repoRoot(cwd) {
  if (typeof cwd !== 'string' || cwd === '' || !path.isAbsolute(cwd)) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    const dot = path.join(dir, '.git');
    let stat = null;
    try { stat = fs.statSync(dot); } catch { /* not here; look higher */ }
    if (stat?.isDirectory()) return dir;
    if (stat?.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dot) ?? '');
      if (!pointer) return dir;
      const gitdir = path.resolve(dir, pointer[1]);
      const common = readText(path.join(gitdir, 'commondir'))?.trim();
      if (!common) return dir;
      const mainGit = path.resolve(gitdir, common);
      return path.basename(mainGit) === '.git' ? path.dirname(mainGit) : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// The id of the registered project whose folder holds `folder`, or null. The nearest folder wins when projects nest.
function projectIdFor(folder, { home = wheelhouseHome() } = {}) {
  const root = repoRoot(folder);
  if (root === null) return null;
  const target = realPath(root);
  if (target === null) return null;
  const inside = keyOf(target);
  let names;
  try { names = fs.readdirSync(path.join(home, 'projects')); } catch { return null; }
  let best = null;
  for (const id of names) {
    if (!SAFE_PART.test(id) || /^\.+$/.test(id)) continue;
    let record = null;
    try { record = JSON.parse(readText(path.join(home, 'projects', id, 'project.json'))); } catch { record = null; }
    if (typeof record?.folder !== 'string' || !path.isAbsolute(record.folder)) continue;
    const base = realPath(record.folder);
    if (base === null) continue;
    const at = keyOf(base);
    const contains = inside === at || inside.startsWith(at.endsWith(path.sep) ? at : at + path.sep);
    if (contains && (best === null || at.length > best.length)) best = { id, length: at.length };
  }
  return best === null ? null : best.id;
}

module.exports = { wheelhouseHome, helperAddress, projectIdFor };
