// adapters/copilot/lean-branch-writes.js
// At Lean, before each file-writing tool and each shell command that writes: refuses a write to the product's own files unless
// the project's folder is on a feature's own copy (HEAD is a `feature/*` branch). Between features the folder is on the main
// version, or detached at it, and nothing there is changed by the chat: a change, however small, is recorded through Intake and
// a Crew member builds it on a branch. The Crew member works on that branch in the same folder, so this does not stop it.
//
// A Lean project is a folder holding `.git` and the record folder (`.wheelhouse/record`), as the shell guard places it
// (./lean-guard.sh). Left alone are the project's Wheelhouse files (`.wheelhouse/`, the Logbook), git's own
// folder, and the files setup makes on the main version (.gitignore, .vscode/settings.json, .github/copilot-instructions.md),
// the last three still held by the guards of files that steer an agent. A write outside every Lean project is left alone, as is
// anything that only reads. Anything the hook cannot read (no HEAD, a folder it cannot place, a command it cannot parse) is
// let through: it fails open.
import fs from 'node:fs';
import path from 'node:path';
import { answer } from '../../scripts/hooks/kit.js';
import { WRITING, shellChanges } from '../../scripts/hooks/front-desk-writes.js';
import { BOARD_FILE, LEAN_RECORD_DIR } from '../../scripts/lib/copilot-numbers.js';

const SHELL = ['Bash', 'PowerShell'];
// What may be written on the main version, below the project's folder.
const OWN = Object.freeze(['.wheelhouse', '.git']);
// The Logbook's folder itself too, so setup can make it again on the main version; only the Logbook goes in it.
const SETUP_FILES = Object.freeze([path.posix.dirname(BOARD_FILE), BOARD_FILE, '.gitignore', '.vscode/settings.json', '.github/copilot-instructions.md']);

export const LEAN_NO_MAIN_WRITES = 'Wheelhouse does not let the chat change the product\'s own files while the project is on the main version. '
  + 'Record the change through Intake (the brief and its card), and do not make a branch yourself.';

// The real path of `file`, which may not exist yet: its nearest folder that does, with the rest after it.
function realPath(file) {
  const resolved = path.resolve(file);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(realPath(parent), path.basename(resolved));
  }
}

// The Lean project a real path is in: the nearest folder at or above it holding `.git` and the record folder, or null.
export function leanRootOf(real) {
  let up = real;
  for (;;) {
    try {
      if (fs.statSync(up).isDirectory() && fs.existsSync(path.join(up, '.git')) && fs.statSync(path.join(up, ...LEAN_RECORD_DIR.split('/'))).isDirectory()) return up;
    } catch { /* not here */ }
    const parent = path.dirname(up);
    if (parent === up) return null;
    up = parent;
  }
}

// The branch the project's folder is on: its name, '' for a detached HEAD, or null where it cannot be read. `.git` may be a
// folder or, in a linked worktree, a file naming the real one.
export function branchOf(root) {
  try {
    let gitDir = path.join(root, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const line = fs.readFileSync(gitDir, 'utf8').split('\n')[0];
      if (!line.startsWith('gitdir: ')) return null;
      gitDir = path.resolve(root, line.slice('gitdir: '.length).trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').split('\n')[0].trim();
    if (head === '') return null;
    return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : '';
  } catch {
    return null;
  }
}

// The same, as case patterns for the shell guard (lower case, below the project's folder).
export const LEAN_BRANCH_LEFT = Object.freeze([...OWN.flatMap((d) => [d, `${d}/*`]), ...SETUP_FILES.map((f) => f.toLowerCase())]);

const left = (below) => OWN.some((d) => below === d || below.startsWith(`${d}/`)) || SETUP_FILES.includes(below);

// The hook's answer: undefined to let the tool run.
export function decide(input) {
  const tool = input?.tool_name;
  const field = WRITING[tool];
  if ((field === undefined && !SHELL.includes(tool)) || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)) return undefined;
  try {
    let targets;
    if (field !== undefined) {
      const given = input.tool_input?.[field];
      if (typeof given !== 'string' || given === '') return undefined;
      targets = [path.resolve(input.cwd, given)];
    } else {
      const command = input.tool_input?.command;
      if (typeof command !== 'string') return undefined;
      const changes = shellChanges(command, input.cwd, { windows: tool === 'PowerShell' });
      if (changes === null) return undefined;
      targets = changes.here === null ? changes.paths : [...changes.paths, changes.here];
    }
    for (const target of targets) {
      const real = realPath(target);
      const root = leanRootOf(real);
      if (root === null) continue;
      const branch = branchOf(root);
      if (branch === null || branch.startsWith('feature/')) continue;
      const below = path.relative(root, real).split(path.sep).join('/').toLowerCase();
      if (below !== '' && left(below)) continue;
      return answer.deny(LEAN_NO_MAIN_WRITES);
    }
  } catch {
    return undefined;
  }
  return undefined;
}
