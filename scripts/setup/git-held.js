// scripts/setup/git-held.js
// A look at whether the director's own git holds a sign-in for a host, kept on this computer: it reads git's settings, then asks the
// store the credential helper names whether it has an entry for the host, by the entry's name alone. It never runs `git credential fill`
// (which can reach the host or open a window), never opens a window and never reads or prints a key.
//   Windows' Credential Manager   `cmdkey /list`, whose lines are entries' names (no secrets); an entry named for the host is held.
//   the Mac's keychain            `security find-internet-password -s <host>`, asked without `-g` or `-w`, so it reads the entry's
//                                 attributes and never its secret; code 0 is held, 44 is none.
//   git's `store` helper          the file it names (its own file by default): a line for the host is held. The text is searched
//                                 and dropped, never kept.
// Gives 'held', 'none' or 'unknown'. 'none' is said only where it is certain: no helper at all and no .netrc entry, or a store looked
// into and found without the host. Any helper this does not know (a cache, a library of the system's) or a store that can't be read
// gives 'unknown', and the card then claims nothing either way, so its wording and recommendation do not change later.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The helper's name as git is told it, whatever its path, without the `git-credential-` prefix and `.exe`.
const kindOf = (helper) => {
  const word = String(helper).trim().split(/\s+/)[0] ?? '';
  const name = word.replace(/^!/, '').split(/[\\/]/).at(-1).replace(/\.exe$/i, '').replace(/^git-credential-/, '');
  return name;
};

// The file a `store` helper reads: `--file <path>` or `--file=<path>`, else git's own two.
function storeFiles(helper, home) {
  const given = /--file(?:=|\s+)("[^"]+"|'[^']+'|\S+)/.exec(helper)?.[1]?.replace(/^["']|["']$/g, '');
  if (given) return [given.replace(/^~(?=[\\/])/, home)];
  return [path.join(home, '.git-credentials'), path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'git', 'credentials')];
}

function fileNames(files, host) {
  const re = new RegExp(`@${escapeRegExp(host)}(?:[:/]|\\s|$)|//${escapeRegExp(host)}(?:[:/]|\\s|$)`, 'i');
  let unreadable = false;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') unreadable = true;
      continue;
    }
    if (re.test(text)) return 'held';
  }
  return unreadable ? 'unknown' : 'none';
}

// `address` is the host's address (https://host[:port]); `ask(args)` runs the director's own git for a read of its settings (as
// host-access.js's `ask`); `run(file, args)` runs the system's program for the keychain or Credential Manager.
export async function gitHoldsKey({ address, ask, run, platform = process.platform, home = os.homedir() }) {
  let host;
  try {
    host = new URL(address).host;
  } catch {
    return 'unknown';
  }
  let helpers;
  try {
    const got = await ask(['config', '--get-urlmatch', 'credential.helper', address]);
    if (got.code !== 0 && got.code !== 1) return 'unknown';
    helpers = got.code === 0 ? got.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '') : [];
  } catch {
    return 'unknown';
  }
  // An empty value in git's settings clears the helpers named before it, so only what follows the last one counts.
  const cleared = helpers.lastIndexOf('');
  if (cleared >= 0) helpers = helpers.slice(cleared + 1);
  if (helpers.length === 0) return netrcNames(host, home);
  let sawUnknown = false;
  for (const helper of helpers) {
    const kind = kindOf(helper);
    let said = 'unknown';
    try {
      if (/^(?:manager|manager-core|wincred)$/.test(kind) && platform === 'win32') {
        const got = await run('cmdkey', ['/list']);
        if (got.code === 0) said = new RegExp(`git:https?://(?:[^/@\\s]+@)?${escapeRegExp(host)}(?:[/\\s]|$)`, 'im').test(got.stdout) ? 'held' : 'none';
      } else if (kind === 'osxkeychain' && platform === 'darwin') {
        const got = await run('security', ['find-internet-password', '-s', host.replace(/:\d+$/, '')]);
        said = got.code === 0 ? 'held' : got.code === 44 ? 'none' : 'unknown';
      } else if (kind === 'store') {
        said = fileNames(storeFiles(helper, home), host);
      }
    } catch {
      said = 'unknown';
    }
    if (said === 'held') return 'held';
    if (said === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'none';
}

// With no helper, git holds nothing itself; a `.netrc` with the host is the one other place it may be read from.
function netrcNames(host, home) {
  const re = new RegExp(`machine\\s+${escapeRegExp(host.replace(/:\d+$/, ''))}(?:\\s|$)`, 'i');
  for (const name of ['.netrc', '_netrc']) {
    try {
      if (re.test(fs.readFileSync(path.join(home, name), 'utf8'))) return 'held';
    } catch { /* none there */ }
  }
  return 'none';
}
