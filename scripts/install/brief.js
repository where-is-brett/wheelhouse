// scripts/install/brief.js
// The private install brief: everything specific to the project being switched over to
// Wheelhouse, kept on this computer under <wheelhouseHome()>/install/, never in a repository.
// `brief.md` is the agent's account for the director and the reviewer; `brief.json`, read and
// written here, is the machine part the install card is built from.
//
// The reader is strict: a key that is missing, of the wrong type, or not one the brief has is an
// error that names it (for example `inFlight.behind`), and a brief whose `folder` isn't the folder
// asked about is refused, since its answers belong to another project.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { writeWhole } from '../lib/setup-clicks.js';

export const BRIEF_FILE = 'brief.json';
export const KINDS = Object.freeze(['skill', 'agent', 'command', 'hook', 'scheduled']);
const COMPUTER_ID = /^[0-9a-f]{8}$/;

// A folder's one spelling: its real path when it exists (links resolved, so /tmp and
// /private/tmp agree), else the resolved path; lowercased where the system folds case.
function folderKey(folder) {
  let full = path.resolve(folder);
  try { full = fs.realpathSync.native(full); } catch { /* not there yet */ }
  return process.platform === 'darwin' || process.platform === 'win32' ? full.toLowerCase() : full;
}

// The folder the brief for the project in `folder` lives in: its folder name, then the first
// eight hex characters of the SHA-256 of its real path, so two projects with the same folder
// name never share a brief, and every spelling of one folder finds the same brief.
export function briefDir(folder) {
  if (typeof folder !== 'string' || folder === '') throw new Error('The project folder is not a path');
  const full = folderKey(folder);
  const name = path.basename(full).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'project';
  const hash = crypto.createHash('sha256').update(full).digest('hex').slice(0, 8);
  return path.join(wheelhouseHome(), 'install', `${name}-${hash}`);
}

// --- The shape ---

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (key, what) => { throw new Error(`The brief's ${key} ${what}`); };

const string = (value, key) => { if (typeof value !== 'string' || value === '') fail(key, 'is not a piece of text'); };
const boolean = (value, key) => { if (typeof value !== 'boolean') fail(key, 'is not true or false'); };
const count = (value, key) => { if (!Number.isInteger(value) || value < 0) fail(key, 'is not a whole number'); };
const positive = (value, key) => { if (!Number.isInteger(value) || value < 1) fail(key, 'is not a whole number from 1'); };
const oneOf = (options) => (value, key) => { if (!options.includes(value)) fail(key, `is not one of ${options.join(', ')}`); };
const textOrNull = (value, key) => { if (value !== null) string(value, key); };
const computerId = (value, key) => { if (value !== null && (typeof value !== 'string' || !COMPUTER_ID.test(value))) fail(key, 'is not a computer ID (eight hex characters) or null'); };

// An object with exactly these keys, each checked by its rule.
const record = (rules) => (value, key) => {
  if (!isObject(value)) fail(key, 'is not an object');
  for (const name of Object.keys(rules)) {
    const at = key ? `${key}.${name}` : name;
    if (!Object.hasOwn(value, name)) fail(at, 'is missing');
    rules[name](value[name], at);
  }
  for (const name of Object.keys(value)) if (!Object.hasOwn(rules, name)) fail(key ? `${key}.${name}` : name, 'is not a key the brief has');
};
const list = (rule) => (value, key) => {
  if (!Array.isArray(value)) fail(key, 'is not a list');
  value.forEach((item, i) => rule(item, `${key}[${i}]`));
};

const checkShape = record({
  v: (value, key) => { if (value !== 1) fail(key, 'is not 1'); },
  folder: string,
  host: oneOf(['github', 'gitlab']),
  computers: list(record({ label: string, id: computerId })),
  answers: record({ product: string, liveData: boolean, realUsers: boolean }),
  protection: oneOf(['standard', 'locked']),
  connection: oneOf(['quick', 'narrow']),
  firstVersion: list(record({ kind: oneOf(KINDS), name: string, path: string })),
  copies: list(record({ name: string, path: string, plugin: string })),
  keep: list(record({ name: string, path: string, why: string })),
  inFlight: record({
    behind: count,
    dirty: boolean,
    prs: list(record({ number: positive, branch: string })),
    worktrees: list(record({ path: string, branch: textOrNull, dirty: boolean })),
  }),
  deniedAfterSwitchBack: list(string),
  plugins: record({ off: list(record({ id: string, why: string })), skillsOff: list(record({ name: string, why: string })) }),
  docsToAlign: list(record({ file: string, line: positive })),
});

// Throws, naming the key, unless `brief` is a whole brief. Locked never takes the quick
// connection (design section 11).
export function checkBrief(brief) {
  checkShape(brief, '');
  if (!path.isAbsolute(brief.folder)) fail('folder', 'is not a full path');
  if (brief.protection === 'locked' && brief.connection !== 'narrow') fail('connection', 'is quick, which Locked never takes');
}

// Whether two paths are the same folder: as given and as their real paths, case folded where
// the system folds it.
function sameFolder(a, b) {
  const fold = process.platform === 'win32' || process.platform === 'darwin';
  const forms = (p) => {
    const given = path.resolve(p);
    let real = given;
    try { real = fs.realpathSync.native(given); } catch { /* not there */ }
    return [given, real].map((x) => (fold ? x.toLowerCase() : x));
  };
  const theirs = forms(b);
  return forms(a).some((x) => theirs.includes(x));
}

// --- Reading and writing ---

// The brief for the project in `folder`, or null when none has been written. Throws when the file
// can't be read as JSON, when a key is missing or mistyped (naming it), or when the brief is for
// another folder.
export function readBrief(folder) {
  const file = path.join(briefDir(folder), BRIEF_FILE);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`The brief's ${BRIEF_FILE} can't be read: ${error.code ?? 'unknown error'}`);
  }
  let brief;
  try {
    brief = JSON.parse(text);
  } catch {
    throw new Error(`The brief's ${BRIEF_FILE} isn't JSON`);
  }
  checkBrief(brief);
  if (!sameFolder(brief.folder, folder)) throw new Error(`This brief is for another folder, not ${path.resolve(folder)}`);
  return brief;
}

// Writes the brief whole, for its owner only (a temporary file, then a rename), after checking it.
export function writeBrief(brief) {
  checkBrief(brief);
  writeWhole(path.join(briefDir(brief.folder), BRIEF_FILE), `${JSON.stringify(brief, null, 2)}\n`);
}
