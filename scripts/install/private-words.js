// scripts/install/private-words.js
// The check that this repository never names the project Wheelhouse is installed into
// (design section 16). The words to look for are kept on this computer only, one to a line, in
// <wheelhouseHome()>/install/private-words.txt; blank lines and lines starting with # are skipped.
// It reads every tracked file (binary files skipped), the tracked files' names, and the messages
// of the commits not yet on the remote's default branch, since a pushed commit can no longer be
// changed and the public history starts afresh; with no remote, the newest PRIVATE_SCAN_COMMITS.
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

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function scan({ root, words, commits = PRIVATE_SCAN_COMMITS, run = defaultRun }) {
  const listed = (Array.isArray(words) ? words : []).map((entry, i) => (typeof entry === 'string'
    ? { word: entry, wordNo: i + 1 }
    : { word: entry?.word, wordNo: entry?.line ?? i + 1 }))
    .filter(({ word }) => typeof word === 'string' && word.trim() !== '')
    .map(({ word, wordNo }) => ({ lower: word.trim().toLowerCase(), wordNo }));
  const git = async (args) => {
    const result = await run('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, baseEnv: withoutGitVars(), env: { GIT_OPTIONAL_LOCKS: '0' } });
    return result.code === 0 ? result.stdout : null;
  };
  const hits = [];
  // A path with every listed word masked, so a hit's place never shows a word.
  const masks = listed.map(({ lower }) => new RegExp(escape(lower), 'gi'));
  const mask = (text) => masks.reduce((t, re) => t.replace(re, '***'), text);
  const lineHits = (text, where, at) => {
    text.split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '').toLowerCase();
      for (const { lower, wordNo } of listed) if (line.includes(lower)) hits.push({ where, at, line: i + 1, wordNo });
    });
  };

  const tracked = await git(['ls-files', '-z']);
  if (tracked === null) throw new Error(`${root} is not a git repository`);
  const files = tracked.split('\0').filter(Boolean);
  let read = 0;
  for (const name of files) {
    const at = mask(name);
    for (const { lower, wordNo } of listed) if (name.toLowerCase().includes(lower)) hits.push({ where: 'file', at, line: 0, wordNo });
    let bytes;
    try { bytes = fs.readFileSync(path.join(root, ...name.split('/'))); } catch { continue; }
    if (bytes.subarray(0, BINARY_PROBE).includes(0)) continue;
    read += 1;
    lineHits(bytes.toString('utf8'), 'file', at);
  }

  let ref = (await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']))?.trim() ?? '';
  if (ref === '') {
    for (const candidate of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
      if ((await git(['rev-parse', '--verify', '--quiet', candidate])) !== null) { ref = candidate; break; }
    }
  }
  const format = '--format=%H%x1f%B%x1e';
  const logged = ref === '' ? await git(['log', '-n', String(commits), format]) : await git(['log', format, `${ref}..HEAD`]);
  const messages = (logged ?? '').split('\x1e').map((r) => r.replace(/^\s+/, '')).filter(Boolean);
  for (const entry of messages) {
    const [sha, body = ''] = entry.split('\x1f');
    lineHits(body.replace(/\n+$/, ''), 'commit', sha.trim());
  }
  return { hits, files: read, messages: messages.length };
}

// Every place in the repository at `root` naming one of `words` (strings, or { word, line } with
// the word's line in the list), whatever its case: tracked files' lines and names (line 0) and
// the messages of commits not on the remote's default branch (or, with no remote, the newest
// `commits`). Each hit is { where: 'file' | 'commit', at, line, wordNo }; a file's path has every
// listed word masked.
export async function scanRepo({ root, words, commits = PRIVATE_SCAN_COMMITS, run = defaultRun }) {
  return (await scan({ root, words, commits, run })).hits;
}

const describe = (hit) => {
  const word = `word ${hit.wordNo} of the private list`;
  if (hit.where === 'commit') return `commit ${hit.at}, line ${hit.line}: ${word}`;
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
