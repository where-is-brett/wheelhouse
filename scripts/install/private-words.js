// scripts/install/private-words.js
// The check that this repository never names the project Wheelhouse is installed into
// (design section 16). The words to look for are kept on this computer only, one to a line, in
// <wheelhouseHome()>/install/private-words.txt; blank lines and lines starting with # are skipped.
// It reads every file in the index as staged (binary files skipped; a link's target is read too),
// and every untracked file git does not ignore, as it is in the folder; the files' names; the
// messages, added lines and touched file names of the commits not yet on the remote's default
// branch, since a pushed commit can no longer be changed and the public history starts afresh
// (with no remote, the newest PRIVATE_SCAN_COMMITS); and the names of the current branch and of
// every local branch not on a remote (with no remote, every one) and every tag, since git keeps no
// record of which tags a remote has without asking it, and the check stays off the network.
// Matching ignores case. A hit names its place and the word's line in the list, never the word,
// so the check's own output can be pasted anywhere.
//   npm run private-check
// Exits 1 on any hit; 0, saying so, when there is no list on this computer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_SCAN_COMMITS } from '../lib/install-numbers.js';
import { wheelhouseHome } from '../lib/paths.js';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const NO_LIST = 'No private list on this computer.';
const BINARY_PROBE = 8000;

export function privateListFile() {
  return path.join(wheelhouseHome(), 'install', 'private-words.txt');
}

// The list's words with their line numbers, or null when there is no list.
function readList(file = privateListFile()) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`The private list can't be read: ${error.code ?? 'unknown error'}`);
  }
  return text.split('\n').map((raw, i) => ({ word: raw.trim(), line: i + 1 }))
    .filter(({ word }) => word !== '' && !word.startsWith('#'));
}

// The words in the private list on this computer; [] when there is none.
export function privateWords() {
  return (readList() ?? []).map(({ word }) => word);
}

// `text` with every stretch matched by any of `lowers` replaced by ***, the matches found on
// the lowercased text and merged where they overlap or touch, so no part of a word is left.
export function maskWords(text, lowers) {
  const lowered = text.toLowerCase();
  const source = lowered.length === text.length ? text : lowered;
  const spans = [];
  for (const lower of lowers) {
    if (lower === '') continue;
    for (let at = lowered.indexOf(lower); at !== -1; at = lowered.indexOf(lower, at + 1)) spans.push([at, at + lower.length]);
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (const [from, to] of spans.slice(1)) {
    const last = merged.at(-1);
    if (from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  let out = '';
  let kept = 0;
  for (const [from, to] of merged) {
    out += `${source.slice(kept, from)}***`;
    kept = to;
  }
  return out + source.slice(kept);
}

// The blobs of the index's entries, by object name, read in one `git cat-file --batch`.
async function readBlobs(git, names) {
  const blobs = new Map();
  if (names.length === 0) return blobs;
  const bytes = await git(['cat-file', '--batch'], { input: `${names.join('\n')}\n`, encoding: 'buffer' });
  if (bytes === null) throw new Error('git cat-file could not read the index\'s files');
  let at = 0;
  while (at < bytes.length) {
    const end = bytes.indexOf(0x0a, at);
    if (end === -1) break;
    const [name, type, size] = bytes.subarray(at, end).toString('utf8').split(' ');
    at = end + 1;
    if (type === 'missing' || size === undefined) continue;
    const length = Number.parseInt(size, 10);
    blobs.set(name, bytes.subarray(at, at + length));
    at += length + 1; // the newline after each object
  }
  return blobs;
}

async function scan({ root, words, commits = PRIVATE_SCAN_COMMITS, run = defaultRun }) {
  const listed = (Array.isArray(words) ? words : []).map((entry, i) => (typeof entry === 'string'
    ? { word: entry, wordNo: i + 1 }
    : { word: entry?.word, wordNo: entry?.line ?? i + 1 }))
    .filter(({ word }) => typeof word === 'string' && word.trim() !== '')
    .map(({ word, wordNo }) => ({ lower: word.trim().toLowerCase(), wordNo }));
  // It scans the maintainer's own checkout, whose ordinary keys the allowed list would refuse, and
  // none of its commands runs a filter, diff driver or pager under the fence (--no-ext-diff and
  // --no-textconv stay), so the fence alone is used. `log.showSignature` is switched off, so a
  // `git log` never runs the checkout's `gpg.program` to verify a signature.
  const fenced = safeGit({ run, cwd: root, env: { GIT_OPTIONAL_LOCKS: '0' }, look: 'never' });
  const git = async (args, { input, encoding } = {}) => {
    const result = await fenced(['-c', 'core.quotepath=off', '-c', 'log.showSignature=false', ...args], { input, encoding });
    return result.code === 0 ? result.stdout : null;
  };
  const hits = [];
  // A path with every listed word masked, so a hit's place never shows a word.
  const mask = (text) => maskWords(text, listed.map(({ lower }) => lower));
  // One hit per listed word in a name (a path or a ref), at line 0.
  const nameHits = (name, where, at) => {
    const lower = name.toLowerCase();
    for (const entry of listed) if (lower.includes(entry.lower)) hits.push({ where, at, line: 0, wordNo: entry.wordNo });
  };
  const lineHits = (lines, where, at) => {
    lines.forEach((raw, i) => {
      if (raw === null) return;
      const line = raw.replace(/\r$/, '').toLowerCase();
      for (const { lower, wordNo } of listed) if (line.includes(lower)) hits.push({ where, at, line: i + 1, wordNo });
    });
  };

  // The index, not the working tree: what is staged is what will be committed, and a link's
  // committed target is a blob like any other. Gitlinks (submodules) have no blob here.
  const staged = await git(['ls-files', '--stage', '-z']);
  if (staged === null) throw new Error(`${root} is not a git repository`);
  const entries = [];
  const seen = new Set();
  for (const record of staged.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, object] = record.slice(0, tab).split(' ');
    const name = record.slice(tab + 1);
    if (seen.has(name)) continue; // one stage of a conflicted path is enough
    seen.add(name);
    entries.push({ name, object: mode === '160000' ? null : object });
  }
  const blobs = await readBlobs(git, [...new Set(entries.map((e) => e.object).filter(Boolean))]);
  let read = 0;
  const readFile = (name, bytes) => {
    const at = mask(name);
    nameHits(name, 'file', at);
    if (!bytes || bytes.subarray(0, BINARY_PROBE).includes(0)) return;
    read += 1;
    lineHits(bytes.toString('utf8').split('\n'), 'file', at);
  };
  for (const { name, object } of entries) readFile(name, object ? blobs.get(object) : undefined);

  // Untracked files git does not ignore, as they are in the folder: one `git add --all` from being
  // staged. A link's target is read as its text; a nested repository (listed as `name/`) by name only.
  const others = await git(['ls-files', '--others', '--exclude-standard', '-z']);
  for (const name of (others ?? '').split('\0').filter(Boolean)) {
    const full = path.join(root, ...name.split('/').filter(Boolean));
    let bytes;
    try {
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) bytes = Buffer.from(fs.readlinkSync(full), 'utf8');
      else if (stat.isFile()) bytes = fs.readFileSync(full);
    } catch { /* gone since git listed it */ }
    readFile(name, bytes);
  }

  // Branch and tag names, each with every listed word masked: the current branch, local branches
  // no remote has (with no remote, all of them), and every tag.
  const remotes = (await git(['remote']) ?? '').split('\n').map((r) => r.trim()).filter(Boolean);
  const onRemote = new Set();
  for (const remoteRef of (await git(['for-each-ref', '--format=%(refname)', 'refs/remotes']) ?? '').split('\n').filter(Boolean)) {
    const remote = remotes.find((r) => remoteRef.startsWith(`refs/remotes/${r}/`));
    if (remote) onRemote.add(`refs/heads/${remoteRef.slice(`refs/remotes/${remote}/`.length)}`);
  }
  const current = (await git(['symbolic-ref', '--quiet', 'HEAD']))?.trim() ?? '';
  const refs = new Set(current.startsWith('refs/heads/') ? [current] : []);
  for (const name of (await git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags']) ?? '').split('\n').filter(Boolean)) {
    if (name.startsWith('refs/tags/') || !onRemote.has(name)) refs.add(name);
  }
  for (const name of refs) nameHits(name, 'ref', mask(name));

  let ref = (await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']))?.trim() ?? '';
  if (ref === '') {
    for (const candidate of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
      if ((await git(['rev-parse', '--verify', '--quiet', candidate])) !== null) { ref = candidate; break; }
    }
  }
  const range = ref === '' ? ['-n', String(commits)] : [`${ref}..HEAD`];
  const logged = await git(['log', '--no-show-signature', '--format=%H%x1f%B%x1e', ...range]);
  const messages = (logged ?? '').split('\x1e').map((r) => r.replace(/^\s+/, '')).filter(Boolean);
  for (const entry of messages) {
    const [sha, body = ''] = entry.split('\x1f');
    lineHits(body.replace(/\n+$/, '').split('\n'), 'commit', sha.trim());
  }

  // The lines each of those commits added, so a word added and then taken out again before the
  // push still fails. A line is numbered within its commit's changes, as `git log -p -U0` prints them.
  const patches = await git(['log', '--no-show-signature', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--format=%x1e%H', ...range]);
  for (const entry of (patches ?? '').split('\x1e').filter((e) => e.trim() !== '')) {
    const [first, ...rest] = entry.replace(/\r\n/g, '\n').split('\n');
    const lines = rest.join('\n').replace(/^\n+/, '').split('\n');
    // A file's header runs from its `diff --git` line to its first `@@`; after that, a `+` line is
    // an added line whatever follows the `+`, `+++` included.
    let header = false;
    const added = lines.map((l) => {
      if (l.startsWith('diff --git ')) header = true;
      else if (l.startsWith('@@')) header = false;
      return !header && l.startsWith('+') ? l.slice(1) : null;
    });
    lineHits(added, 'diff', first.trim());
  }

  // The file names each of those commits touched, old and new names of a rename both, so a name
  // added and taken out again before the push still fails. The header lines above are not read.
  const touched = await git(['log', '--no-show-signature', '--name-only', '--no-renames', '-z', '--format=%x1e%H', ...range]);
  for (const entry of (touched ?? '').split('\x1e').filter((e) => e.trim() !== '')) {
    const [sha, ...names] = entry.split('\0');
    for (const name of names.map((n) => n.replace(/^\n/, '')).filter(Boolean)) nameHits(name, 'diff', sha.trim());
  }
  return { hits, files: read, messages: messages.length };
}

// Every place in the repository at `root` naming one of `words` (strings, or { word, line } with
// the word's line in the list), whatever its case: the index's files and the untracked files git
// does not ignore, by line and by name (line 0); the messages of commits not on the remote's
// default branch (or, with no remote, the newest `commits`); the lines those commits added
// (`where: 'diff'`, numbered within the commit's changes) and the file names they touched
// (`where: 'diff'`, line 0); and branch and tag names (`where: 'ref'`, line 0). Each hit is
// { where: 'file' | 'commit' | 'diff' | 'ref', at, line, wordNo }; `at` is a commit's hash, or a
// path or full ref name with every listed word masked.
export async function scanRepo({ root, words, commits = PRIVATE_SCAN_COMMITS, run = defaultRun }) {
  return (await scan({ root, words, commits, run })).hits;
}

const describe = (hit) => {
  const word = `word ${hit.wordNo} of the private list`;
  if (hit.where === 'commit') return `commit ${hit.at}, line ${hit.line}: ${word}`;
  if (hit.where === 'diff' && hit.line === 0) return `commit ${hit.at}, in a file name it touches: ${word}`;
  if (hit.where === 'diff') return `commit ${hit.at}, line ${hit.line} of its changes: ${word}`;
  if (hit.where === 'ref') return `branch or tag ${hit.at}, in its name: ${word}`;
  if (hit.line === 0) return `file ${hit.at}, in a file's name: ${word}`;
  return `file ${hit.at}, line ${hit.line}: ${word}`;
};

// The check on the repository at `root` with the list in `file`: { code, lines }.
export async function checkPrivate({ root, file = privateListFile(), run = defaultRun } = {}) {
  const list = readList(file);
  if (list === null) return { code: 0, lines: [NO_LIST] };
  if (list.length === 0) return { code: 0, lines: ['The private list on this computer has no words.'] };
  const { hits, files, messages } = await scan({ root, words: list, run });
  if (hits.length === 0) {
    return { code: 0, lines: [`No private words found: ${files} staged and untracked files and ${messages} commit messages read.`] };
  }
  return {
    code: 1,
    lines: [
      ...hits.map(describe),
      `${hits.length} ${hits.length === 1 ? 'place names' : 'places name'} a word of the private list. Take it out before this goes public.`,
    ],
  };
}

if (startedAsScript(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    const { code, lines } = await checkPrivate({ root });
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
