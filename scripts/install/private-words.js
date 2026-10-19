// scripts/install/private-words.js
// The check that this repository never names the project Wheelhouse is installed into
// (design section 16). The words to look for are kept on this computer only, one to a line, in
// <wheelhouseHome()>/install/private-words.txt; blank lines and lines starting with # are skipped.
// It reads every file in the index as staged (binary files skipped; a link's target is read too),
// the files' names, and the messages and added lines of the commits not yet on the remote's
// default branch, since a pushed commit can no longer be changed and the public history starts
// afresh; with no remote, the newest PRIVATE_SCAN_COMMITS.
// Matching ignores case. A hit names its place and the word's line in the list, never the word,
// so the check's own output can be pasted anywhere.
//   npm run private-check
// Exits 1 on any hit; 0, saying so, when there is no list on this computer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_SCAN_COMMITS } from '../lib/install-numbers.js';
import { wheelhouseHome } from '../lib/paths.js';
import { run as defaultRun, withoutGitVars } from '../lib/run.js';

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
  const git = async (args, { input, encoding } = {}) => {
    const result = await run('git', ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root, baseEnv: withoutGitVars(), env: { GIT_OPTIONAL_LOCKS: '0' }, input, encoding,
    });
    return result.code === 0 ? result.stdout : null;
  };
  const hits = [];
  // A path with every listed word masked, so a hit's place never shows a word.
  const mask = (text) => maskWords(text, listed.map(({ lower }) => lower));
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
  for (const { name, object } of entries) {
    const at = mask(name);
    for (const { lower, wordNo } of listed) if (name.toLowerCase().includes(lower)) hits.push({ where: 'file', at, line: 0, wordNo });
    const bytes = object ? blobs.get(object) : undefined;
    if (!bytes || bytes.subarray(0, BINARY_PROBE).includes(0)) continue;
    read += 1;
    lineHits(bytes.toString('utf8').split('\n'), 'file', at);
  }

  let ref = (await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']))?.trim() ?? '';
  if (ref === '') {
    for (const candidate of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
      if ((await git(['rev-parse', '--verify', '--quiet', candidate])) !== null) { ref = candidate; break; }
    }
  }
  const range = ref === '' ? ['-n', String(commits)] : [`${ref}..HEAD`];
  const logged = await git(['log', '--format=%H%x1f%B%x1e', ...range]);
  const messages = (logged ?? '').split('\x1e').map((r) => r.replace(/^\s+/, '')).filter(Boolean);
  for (const entry of messages) {
    const [sha, body = ''] = entry.split('\x1f');
    lineHits(body.replace(/\n+$/, '').split('\n'), 'commit', sha.trim());
  }

  // The lines each of those commits added, so a word added and then taken out again before the
  // push still fails. A line is numbered within its commit's changes, as `git log -p -U0` prints them.
  const patches = await git(['log', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--format=%x1e%H', ...range]);
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
  return { hits, files: read, messages: messages.length };
}

// Every place in the repository at `root` naming one of `words` (strings, or { word, line } with
// the word's line in the list), whatever its case: the index's files, by line and by name (line 0);
// the messages of commits not on the remote's default branch (or, with no remote, the newest
// `commits`); and the lines those commits added (`where: 'diff'`, numbered within the commit's
// changes). Each hit is { where: 'file' | 'commit' | 'diff', at, line, wordNo }; a file's path has
// every listed word masked.
export async function scanRepo({ root, words, commits = PRIVATE_SCAN_COMMITS, run = defaultRun }) {
  return (await scan({ root, words, commits, run })).hits;
}

const describe = (hit) => {
  const word = `word ${hit.wordNo} of the private list`;
  if (hit.where === 'commit') return `commit ${hit.at}, line ${hit.line}: ${word}`;
  if (hit.where === 'diff') return `commit ${hit.at}, line ${hit.line} of its changes: ${word}`;
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
    return { code: 0, lines: [`No private words found: ${files} tracked files and ${messages} commit messages read.`] };
  }
  return {
    code: 1,
    lines: [
      ...hits.map(describe),
      `${hits.length} ${hits.length === 1 ? 'place names' : 'places name'} a word of the private list. Take it out before this goes public.`,
    ],
  };
}

function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (Boolean(process.argv[1]) && startedAsScript()) {
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
