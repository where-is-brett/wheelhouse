// scripts/lean/project.js
// A Lean project on this computer (ruling P5-9). Lean has no code host, so it has no project.json:
// its record is <wheelhouseHome>/projects/<project>/lean.json,
//
//   LeanRecord = {
//     folder: string,           the project's working folder (a full path)
//     store: string | null,     the store repository's folder (a full path), once Task 5 makes it
//     copy: string | null,      where the store's copy goes, once one is set
//     test: string | null,      the command that tests the product, once one is set
//     identity: { name, email } | null, who a merge or an undo is committed as
//     registeredAt: string,     when it was registered, UTC ISO 8601
//     main?: string | null,     the main version's commit as the helper last moved it (ruling P5-27), once the
//                               project's git is in the store (scripts/lean/store.js)
//     realUsers?: boolean,      whether the product has real users, so a chat click never approves a merge
//     agent?: string,           the coding agent the project runs on here, set by the helper's install
//   }
//
// `main`, `realUsers` and `agent` are optional: a record without them reads as it did, with none carried. The
// helper's uninstall removes the record (unregisterLean), so nothing reads a project it has left.
//
// readProject stays strict (scripts/lib/projects.js), so every caller that needs a host finds no
// record and refuses. projectForFolder reads this record too, so the hooks place a Lean folder.
// Its private record is a local repository at stateDir(project): events are committed there and never pushed.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, projectsDir, wheelhouseHome } from '../lib/paths.js';
import { safeGit } from '../lib/safe-git.js';
import { readProject, projectForFolder } from '../lib/projects.js';
import { openRecord } from '../state/record.js';

// What every route that needs a host answers for a Lean project.
export const LEAN_NO_HOST = 'a Lean project has no code host';
// What setup and uninstall answer in a folder registered as a Lean project (ruling P5-47): they read
// a host's record, which a Lean project has not got, and would take away its only copy of the state.
// The folder may be the Lean project's own or one inside it, so the line says either.
export const LEAN_FOLDER = 'This folder is a Lean project\'s, or inside one, so setup and uninstall leave it alone: a Lean project is set up and removed by the install and uninstall of Wheelhouse\'s helper.';

const LEAN_FILE = 'lean.json';
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const fullPath = (x) => typeof x === 'string' && path.isAbsolute(x);
const textOrNull = (x) => x === null || (typeof x === 'string' && x !== '');
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const FULL_COMMIT = /^[0-9a-f]{40}$/;

// Each field the record holds, in the order it is written, and what it must be. A later task adds
// its own row here.
const FIELDS = [
  ['folder', fullPath],
  ['store', (x) => x === null || fullPath(x)],
  ['copy', textOrNull],
  ['test', textOrNull],
  ['identity', (x) => x === null || (isPlain(x) && typeof x.name === 'string' && x.name !== '' && typeof x.email === 'string' && x.email !== '')],
  ['registeredAt', (x) => typeof x === 'string' && TIME.test(x) && !Number.isNaN(Date.parse(x))],
];
// Fields a record may leave out, each carried only when it is there (Task 5's store).
const OPTIONAL = [
  ['main', (x) => x === null || (typeof x === 'string' && FULL_COMMIT.test(x))],
  ['realUsers', (x) => typeof x === 'boolean'],
  ['agent', (x) => typeof x === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(x)],
];

// stateDir refuses a name that is not a folder name.
const projectFolder = (project) => path.join(stateDir(project), '..');
const leanFile = (project) => path.join(projectFolder(project), LEAN_FILE);

// The record with only its known fields, each checked, or null when one is missing or wrong.
function checked(record) {
  if (!isPlain(record)) return null;
  const kept = {};
  for (const [name, good] of FIELDS) {
    const value = name === 'identity' && isPlain(record.identity) ? { name: record.identity.name, email: record.identity.email } : record[name];
    if (!good(value)) return null;
    kept[name] = value;
  }
  for (const [name, good] of OPTIONAL) {
    if (record[name] === undefined) continue;
    if (!good(record[name])) return null;
    kept[name] = record[name];
  }
  return kept;
}

// Whether a project is a Lean one on this computer: a lean.json and no project.json (where both are there,
// project.json wins, as projectForFolder has it). False for a name that can't be read.
export function isLeanProject(project) {
  try {
    return readProject(project) === null && readLean(project) !== null;
  } catch {
    return false;
  }
}

// The project's Lean record, or null when there is none or it is unreadable.
export function readLean(project) {
  try {
    return checked(JSON.parse(fs.readFileSync(leanFile(project), 'utf8')));
  } catch {
    return null;
  }
}

// The Lean projects registered on this computer, by folder name in order: each folder under
// projects/ with no project.json and a lean.json that reads, { project, record }.
export function registeredLeanProjects() {
  let names;
  try {
    names = fs.readdirSync(projectsDir());
  } catch {
    return [];
  }
  return names.sort().flatMap((project) => {
    if (readProject(project) !== null) return [];
    const record = readLean(project);
    return record === null ? [] : [{ project, record }];
  });
}

// Writes the record whole: a temporary file in the same folder, then a rename.
function writeLean(project, record) {
  const kept = checked(record);
  if (kept === null) throw new Error('The Lean record is not whole');
  const file = leanFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(kept, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return kept;
}

// Changes the project's record: `changes` holds the fields to set, and the record is written whole again. Throws
// when there is no record, or when the record with the changes is not whole.
export function updateLean(project, changes) {
  const held = readLean(project);
  if (held === null) throw new Error('This project is not registered as a Lean project');
  return writeLean(project, { ...held, ...changes });
}

// Removes the project's Lean record, so the hooks, the session start and the board no longer place its folder
// (ruling P5-51). Its state, beside the record, is left as it is.
export function unregisterLean(project) {
  // The add-on's pane doesn't offer the folder again.
  const held = readLean(project);
  if (held !== null) declineLean({ folder: held.folder });
  fs.rmSync(leanFile(project), { force: true });
}

const realOrNull = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

// Registers `folder` as the Lean project `project` (for Task 6's install). Registering the same
// project and folder again keeps the record as it was. Refused for a project with a code host, for
// another folder under the same name, and for a folder that is already another project's.
export function registerLean({ project, folder, now = () => new Date() }) {
  stateDir(project);
  if (!fullPath(folder)) throw new Error('The Lean project\'s folder must be a full path');
  const real = realOrNull(folder);
  if (real === null || !fs.statSync(real).isDirectory()) throw new Error('The Lean project\'s folder does not exist');
  if (readProject(project) !== null) throw new Error('This project is registered with a code host, so it is not registered as a Lean project');
  const held = readLean(project);
  if (held !== null) {
    if (realOrNull(held.folder) !== real) throw new Error('This Lean project is registered for another folder');
    return held;
  }
  const found = projectForFolder(real);
  if (found !== null && found.project !== project && realOrNull(found.record.folder) === real) {
    throw new Error('This folder is already registered as another project');
  }
  return writeLean(project, {
    folder, store: null, copy: null, test: null, identity: null, registeredAt: now().toISOString(),
  });
}

// --- Lean's chat setup leaves no record; the director may register its folder from the add-on's pane ---
//
// Lean's chat setup runs with git alone, so it can write no record of its own, and an agent never registers a project
// (design for other agents, section 8.2). On a computer where no Node.js 22 runs, the add-on offers, in its pane, to
// register the folder setup left, and registers it only when the director presses Yes. Nothing registers on open.

const DECLINED_FILE = 'lean-declined.json';
const declinedFile = () => path.join(wheelhouseHome(), DECLINED_FILE);

// The folders (real paths) the director answered Not now for, or took out of Lean (unregisterLean): not offered again.
function declinedFolders() {
  try {
    const list = JSON.parse(fs.readFileSync(declinedFile(), 'utf8'));
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Remembers that `folder` is not to be offered again. Never throws.
export function declineLean({ folder } = {}) {
  try {
    const real = realOrNull(folder);
    if (real === null) return false;
    const held = declinedFolders();
    if (held.includes(real)) return true;
    fs.mkdirSync(wheelhouseHome(), { recursive: true });
    fs.writeFileSync(declinedFile(), `${JSON.stringify([...held, real], null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

// The name a Lean project gets for `folder`: the folder's own name made safe, with a number added while that name is
// another project's.
export function leanNameFor(folder) {
  const base = path.basename(folder).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'project';
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    const held = readLean(name);
    if (readProject(name) === null && (held === null || realOrNull(held.folder) === folder)) return name;
  }
}

// Whether git tracks `.wheelhouse/record/.gitkeep` in `folder`: the mark setup's commit leaves, which a file merely
// written does not make.
async function tracksRecord(folder, run) {
  const call = safeGit({ run, cwd: folder, env: {}, reach: 'local', list: 'project', look: 'once', caller: 'lean', what: 'the Lean setup\'s record folder' });
  const got = await call(['ls-files', '--error-unmatch', '--', '.wheelhouse/record/.gitkeep']);
  return got.code === 0;
}

// The words about Node.js in the offer: 'old' (a Node.js is on the PATH but older than 22) or 'none' (none is visible to
// VS Code). Wherever a Node.js 22 or later runs ('ok') nothing is offered: the helper's install card serves there.
const NODE_WORDS = Object.freeze({
  old: 'The Node.js on this computer is older than version 22, so Wheelhouse\'s helper would run inside VS Code.',
  none: 'VS Code can\'t see a Node.js on this computer, so Wheelhouse\'s helper would run inside VS Code.',
});

// The offer for `folder`, { folder, line }, or null: nothing until `ready` (the add-on's switch, checked first); nothing for a folder that is a
// project already, was declined, or isn't a git folder with the record folder tracked; nothing for one Claude Code
// setup might want (it has a `.claude` folder or a CLAUDE.md); nothing where Node.js 22 runs. Reads only; never throws.
export async function leanOffer({ folder, nodeState, run, ready } = {}) {
  try {
    if (ready !== true) return null;
    if (!Object.hasOwn(NODE_WORDS, nodeState)) return null;
    const real = typeof folder === 'string' && fullPath(folder) ? realOrNull(folder) : null;
    if (real === null || projectForFolder(real) !== null || declinedFolders().includes(real)) return null;
    const has = (...parts) => fs.existsSync(path.join(real, ...parts));
    if (!has('.git') || has('.claude') || has('CLAUDE.md')) return null;
    if (!(await tracksRecord(real, run))) return null;
    return { folder: real, line: `Use this folder as your Lean project? ${real} ${NODE_WORDS[nodeState]}` };
  } catch {
    return null;
  }
}

// The director's Yes: the offer is made again (so nothing stale registers), and the folder is registered under the name
// the helper's install would give. Gives { project, record } or null.
export async function useLeanFolder({ folder, nodeState, run, now, ready } = {}) {
  try {
    const offered = await leanOffer({ folder, nodeState, run, ready });
    if (offered === null) return null;
    const project = leanNameFor(offered.folder);
    return { project, record: registerLean({ project, folder: offered.folder, now }) };
  } catch {
    return null;
  }
}

// What the add-on's press path may call (vscode/press.cjs).
export const LEAN_PRESS = Object.freeze({ useLeanFolder, declineLean });

// The Lean project's private record, made when the folder is absent or empty, as every project's is
// (scripts/state/record.js): no remote, so nothing is ever pushed from it. Gives the folder.
export function leanState(project, { run } = {}) {
  return openRecord(stateDir(project), { run, caller: 'lean', what: 'the Lean project\'s private record' });
}
