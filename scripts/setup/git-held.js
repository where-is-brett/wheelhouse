// scripts/setup/git-held.js
// A look at whether the director's own git holds a sign-in for a host, kept on this computer: it reads git's settings, then asks the
// store the credential helper names whether it has an entry for the host, by the entry's name alone. It never runs `git credential fill`
// (which can reach the host or open a window), never opens a window and never reads or prints a key.
//   Windows' Credential Manager   `cmdkey /list`, whose lines are entries' names (no secrets); an entry named for the host is held.
//   the Mac's keychain            `security find-internet-password -s <host>`, asked without `-g` or `-w`, so it reads the entry's
//                                 attributes and never its secret; code 0 is held, 44 is none.
//   git's `store` helper          the file it names (its own file by default): a line for the host is held. Each line is reduced
//                                 to its host as it is read, and the rest of it is let go, never kept, printed or written.
//   .netrc                        read word by word for its `machine` names alone, whatever the helpers: curl reads it for git.
// Every helper git is given counts, in its own order (`--get-urlmatch` names only the last). Nothing here prints a file's text.
// Gives 'held', 'none' or 'unknown'. 'none' is said only where it is certain: no helper at all and no .netrc entry, or each store
// looked into and found without the host. Any helper this does not know (a cache, a library of the system's) or a store that can't be read
// gives 'unknown', and the card then claims nothing either way, so its wording and recommendation do not change later.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// How long the keychain or Credential Manager is given to answer: a look that waits longer is not told.
const LOOK_MS = 5000;
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

// The host names a file of sign-ins names, and nothing else of it: each line is reduced to its host as it is read, and the
// file's text is let go when this returns. `unreadable` is set where the file is there but could not be read.
function hostsInFile(file, hostOfLine) {
  const hosts = new Set();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { hosts, unreadable: error?.code !== 'ENOENT' };
  }
  for (const line of text.split(/\r?\n/)) {
    const host = hostOfLine(line);
    if (typeof host === 'string' && host !== '') hosts.add(host.toLowerCase());
  }
  text = null;
  return { hosts, unreadable: false };
}

// A line of git's store file is a URL with the sign-in in it: only its host (with any port) is taken.
const storeHost = (line) => {
  try {
    return new URL(line.trim()).host;
  } catch {
    return null;
  }
};

function storeNames(files, host) {
  let unreadable = false;
  for (const file of files) {
    const got = hostsInFile(file, storeHost);
    if (got.hosts.has(host.toLowerCase())) return 'held';
    unreadable ||= got.unreadable;
  }
  return unreadable ? 'unknown' : 'none';
}

// The machines a .netrc names, read word by word so a password is never taken for a name; `*` stands for its `default` entry,
// which any host is given.
function netrcHosts(home) {
  const hosts = new Set();
  for (const name of ['.netrc', '_netrc']) {
    let words;
    try {
      words = fs.readFileSync(path.join(home, name), 'utf8').split(/\s+/);
    } catch {
      continue;
    }
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i].toLowerCase();
      if (word === 'machine' && i + 1 < words.length) hosts.add(words[(i += 1)].toLowerCase());
      else if (word === 'default') hosts.add('*');
      else if (word === 'login' || word === 'password' || word === 'account') i += 1;
    }
    words = null;
  }
  return hosts;
}

// Where an address-scoped helper setting (`credential.<url>.helper`) applies to `address`: true, false, or null where this
// can't be sure (a wildcard, a user name or a path in it, or a URL that does not parse), and the look then never says none.
function scopeMatches(scope, address) {
  let url;
  try {
    url = new URL(scope);
  } catch {
    return null;
  }
  if (url.protocol !== address.protocol || url.port !== address.port) return url.hostname.includes('*') ? null : false;
  if (url.hostname.includes('*')) return null;
  if (url.hostname.toLowerCase() !== address.hostname.toLowerCase()) return false;
  if (url.username !== '' || !['', '/'].includes(url.pathname)) return null;
  return true;
}

// The helpers git uses for `address`, in the order it reads them: every `credential.helper` and every `credential.<url>.helper`
// that matches, an empty value clearing those before it. `--get-urlmatch` gives only the last of them, so each setting is listed.
async function helpersFor(address, ask) {
  const got = await ask(['config', '--null', '--get-regexp', '^credential\\..*helper$']);
  if (got.code === 1) return { helpers: [], unsure: false };
  if (got.code !== 0) return null;
  let helpers = [];
  let unsure = false;
  for (const entry of got.stdout.split('\0')) {
    if (entry === '') continue;
    const cut = entry.indexOf('\n');
    const key = cut < 0 ? entry : entry.slice(0, cut);
    const value = cut < 0 ? '' : entry.slice(cut + 1).trim();
    if (!/^credential\..*helper$/i.test(key)) continue;
    if (key.toLowerCase() !== 'credential.helper') {
      if (!/\.helper$/i.test(key)) continue;
      const matches = scopeMatches(key.slice('credential.'.length, -'.helper'.length), address);
      if (matches === false) continue;
      if (matches === null) {
        unsure = true;
        continue;
      }
    }
    if (value === '') helpers = [];
    else helpers.push(value);
  }
  return { helpers, unsure };
}

// `address` is the host's address (https://host[:port]); `ask(args)` runs the director's own git for a read of its settings (as
// host-access.js's `ask`); `run(file, args, options)` runs the system's program for the keychain or Credential Manager.
export async function gitHoldsKey({ address, ask, run, platform = process.platform, home = os.homedir() }) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return 'unknown';
  }
  const host = url.host;
  // Git reaches the host through curl, which reads .netrc whatever helpers are set.
  const netrc = netrcHosts(home);
  if (netrc.has(url.hostname.toLowerCase()) || netrc.has('*')) return 'held';
  let found;
  try {
    found = await helpersFor(url, ask);
  } catch {
    return 'unknown';
  }
  if (found === null) return 'unknown';
  let sawUnknown = found.unsure;
  for (const helper of found.helpers) {
    const kind = kindOf(helper);
    let said = 'unknown';
    try {
      if (/^(?:manager|manager-core|wincred)$/.test(kind) && platform === 'win32') {
        const got = await run('cmdkey', ['/list'], { timeoutMs: LOOK_MS });
        if (got.code === 0) said = new RegExp(`git:https?://(?:[^/@\\s]+@)?${escapeRegExp(host)}(?:[/\\s]|$)`, 'im').test(got.stdout) ? 'held' : 'none';
      } else if (kind === 'osxkeychain' && platform === 'darwin') {
        const got = await run('security', ['find-internet-password', '-s', url.hostname], { timeoutMs: LOOK_MS });
        said = got.code === 0 ? 'held' : got.code === 44 ? 'none' : 'unknown';
      } else if (kind === 'store') {
        said = storeNames(storeFiles(helper, home), host);
      }
    } catch {
      said = 'unknown';
    }
    if (said === 'held') return 'held';
    if (said === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'none';
}

// ---- The hosts this computer already signs in to ----

// Hosts that are not a company's GitLab, whatever stores a sign-in for them.
const NOT_GITLAB = /^(?:(?:www\.)?github\.com|(?:www\.)?gitlab\.com|bitbucket\.org|dev\.azure\.com|ssh\.dev\.azure\.com|[^.]+\.visualstudio\.com|[^.]+\.pkg\.github\.com|gist\.github\.com)$/i;
const HOST_NAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

// The host names where this computer holds a sign-in a GitLab might use, as names alone, never a key: the hosts GitLab's own program
// (glab) is set up for, those in git's `store` files and `.netrc`, and, on Windows, Credential Manager's `git:` entries (read by
// name with `cmdkey /list`). Each is a guess at a company's GitLab, so the card that offers one names where it was found and
// recommends none. Reads only; at most `limit` names.
export async function signedInHosts({ home, platform = process.platform, env = process.env, limit = 4, run = null } = {}) {
  // Without the computer's home named there is nothing to read, so a caller that has none (a test) sees no hosts.
  if (typeof home !== 'string' || home === '') return [];
  const found = [];
  const add = (name) => {
    const host = String(name ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (host !== '' && !host.includes(':') && HOST_NAME.test(host) && host.includes('.') && !NOT_GITLAB.test(host) && !found.includes(host)) found.push(host);
  };
  const read = (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  };
  // glab's file lists each host as a key under `hosts:`.
  for (const file of [path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'glab-cli', 'config.yml'), ...(env.APPDATA ? [path.join(env.APPDATA, 'glab-cli', 'config.yml')] : [])]) {
    const text = read(file);
    const block = /^hosts:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m.exec(text)?.[1] ?? '';
    for (const line of block.split(/\r?\n/)) {
      const key = /^ {1,4}([A-Za-z0-9.-]+):\s*$/.exec(line)?.[1];
      if (key) add(key);
    }
  }
  for (const file of [path.join(home, '.git-credentials'), path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'git', 'credentials')]) {
    for (const host of hostsInFile(file, (line) => (/^https:/i.test(line.trim()) ? storeHost(line)?.replace(/:\d+$/, '') : null)).hosts) add(host);
  }
  for (const host of netrcHosts(home)) if (host !== '*') add(host);
  if (platform === 'win32' && run !== null) {
    try {
      const got = await run('cmdkey', ['/list']);
      for (const match of String(got?.stdout ?? '').matchAll(/git:https:\/\/(?:[^/@\s]+@)?([^/\s:]+)/gi)) add(match[1]);
    } catch { /* none to read */ }
  }
  return found.slice(0, limit);
}
