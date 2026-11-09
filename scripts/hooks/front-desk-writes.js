// scripts/hooks/front-desk-writes.js
// Before each file-writing tool (Write, Edit, MultiEdit, NotebookEdit) and each shell command in the front desk's chat:
// refuses a write to the product's own files. The front desk records a plan or a piece of work and asks a card; the
// builders make the change in their own folders. A weaker model may otherwise answer a yes by writing the product itself,
// with no plan and no review, by a file tool or, once that is refused, by the shell.
//
// The front desk is the session whose role is the front desk, in a registered project, in no engine step and in no
// setup that is under way. It is judged by the file it would change: one inside the project's folder is refused, but
// for `.wheelhouse/` (where it keeps its briefs and the JSON it hands to its command) and the checkout of a linked
// worktree it stands in. Files outside the project, and folders that are not set-up projects, are left alone, as is
// anything that only reads. The shell check is narrow: a redirect, tee, an in-place edit, cp, mv, touch, a project
// starter, or a one-line program that writes, aimed at the project. When the hook can't tell, it allows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answer, runAndExit, projectOf, beingSetUp, worktreeRoot, sameFolder } from './kit.js';
import { segmentsWithOperators } from './shell-words.js';
import { sessionRole, asideKind } from '../lib/role.js';
import { refreshSeat } from '../lib/first-mate-seat.js';
import { ownRun } from '../protection/archon.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { buildViews } from '../state/views.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { stateDir } from '../lib/paths.js';
import { isOpen } from '../desk/views.js';

export const WRITING = Object.freeze({ Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' });
const SHELL = ['Bash', 'PowerShell'];
// The folder in the project the front desk may write to.
export const OWN_FOLDER = '.wheelhouse';
// A setup run counts as under way while it has had a step shown, clicked or finished within this long.
export const SETUP_LIVE_MS = 2 * 60 * 60 * 1000;

export const FRONT_DESK_NO_WRITES = (file) => `Wheelhouse does not let the front desk write the product's own files (${file}). `
  + 'Record the change through intake as a plan or work and ask its card; the builders make the change. '
  + `Your briefs and notes go in ${OWN_FOLDER}/work/<id>.md. `
  + 'To edit by hand, start a session in a worktree; its changes reach main through the director\'s own pull request.';

export const ASIDE_NO_WRITES = (file) => `This window isn't the First Mate and stands in the project's main folder, so it can't change the product's files here (${file}). `
  + 'To edit by hand, start a session in a worktree; its changes reach main through the director\'s own pull request. '
  + `Notes you need to keep go in ${OWN_FOLDER}/work/<id>.md.`;

export const APPROVED_LOCKED = (work, file) => `${file} is the approved document of ${work}, so it is locked. `
  + 'Changing an approved design is an amendment: write the changed text to its own file, '
  + `such as ${OWN_FOLDER}/work/${work}.change.md, and run \`record amendment\` naming it as doc. `
  + 'The director\'s click on the change card puts it in place.';

export const NO_STATUS_LINE = 'Where work stands is kept in the Logbook (`views work`), not in the document: '
  + 'a status line in a design goes out of date and an edit to an approved document breaks its approval. Leave the status line out.';

// Whether a line of `text` reads as a status written into a document: `Status: draft`, `**Status:** approved`,
// `> Status: pending`, after any list, quote, heading or bold marks.
const STATUS_LINE = /^[\s>*_#\-+]*status\s*(?::\s*[*_]*|[*_]+\s*:[*_]*)\s*(draft|approved|awaiting|waiting|pending|proposed|changed since)\b/i;
export function statusLineIn(text) {
  return typeof text === 'string' && text.split(/\r?\n/).some((line) => STATUS_LINE.test(line));
}

// The approved documents of open work: [{ work, file (full path), hash }]. Closed or finished work, and work with no
// approval, is not listed.
export function lockedDocuments(views, folder) {
  const listed = [];
  const work = views?.work;
  if (work === null || typeof work !== 'object') return listed;
  for (const [id, entry] of Object.entries(work)) {
    const docPath = entry?.work?.data?.doc?.path;
    const hash = entry?.approval?.hash;
    if (!entry?.approval || typeof docPath !== 'string' || docPath === '' || typeof hash !== 'string' || !isOpen(views, id)) continue;
    listed.push({ work: id, file: path.isAbsolute(docPath) ? docPath : path.join(folder, docPath), hash });
  }
  return listed;
}

function lockedNow(project, folder) {
  try {
    return lockedDocuments(buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled()), folder);
  } catch {
    return [];
  }
}

// The text a write tool puts into its file, for the status check.
function writtenText(input) {
  const t = input.tool_input ?? {};
  if (input.tool_name === 'Write') return [t.content];
  if (input.tool_name === 'Edit') return [t.new_string];
  if (input.tool_name === 'MultiEdit') return Array.isArray(t.edits) ? t.edits.map((e) => e?.new_string) : [];
  return [];
}

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
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
const keyOf = (p) => (caseBlind ? p.toLowerCase() : p);
const inside = (folder, file) => {
  const base = keyOf(realPath(folder));
  const target = keyOf(realPath(file));
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
};

// Whether a setup run has been at work lately: the latest time on one of its steps, or its start.
function setupLive(run, now) {
  const times = [run?.startedAt, ...Object.values(run?.steps ?? {}).flatMap((s) => [s?.shownAt, s?.clickedAt, s?.doneAt])]
    .map((t) => (typeof t === 'string' ? Date.parse(t) : NaN)).filter(Number.isFinite);
  return times.length === 0 || now - Math.max(...times) <= SETUP_LIVE_MS;
}

// ---- The shell ----

const flagless = (args) => args.filter((a) => !a.startsWith('-'));
// Code a one-line program (node -e, python -c) runs that writes a file.
const WRITING_CODE = /writeFile|appendFile|createWriteStream|copyFile|\brename(Sync)?\b|mkdirSync|\bwrite_text\b|\bwrite_bytes\b|(?<!std(?:out|err))\.write\s*\(|open\s*\([^)]*['"][wax]\+?b?['"]/;
const CODE_FLAGS = { node: ['-e', '--eval', '-p', '--print'], deno: ['eval'], python: ['-c'], python3: ['-c'], perl: ['-e', '-pe', '-ne', '-E'], ruby: ['-e'] };
const POWERSHELL_WRITERS = new Set(['set-content', 'add-content', 'out-file', 'new-item', 'copy-item', 'move-item']);

// The paths a PowerShell writer names: the values of -Path, -LiteralPath, -FilePath and -Destination, and its first
// argument when that is not a flag. Other flags' values (-ItemType Directory, -Encoding utf8) are not paths.
const POWERSHELL_PATH_FLAGS = new Set(['-path', '-literalpath', '-filepath', '-destination']);
function powershellPaths(args) {
  const found = args.length > 0 && !args[0].startsWith('-') ? [args[0]] : [];
  args.forEach((a, k) => {
    const flag = a.toLowerCase();
    if (POWERSHELL_PATH_FLAGS.has(flag) && args[k + 1] !== undefined && !args[k + 1].startsWith('-')) found.push(args[k + 1]);
    else {
      const joined = /^(-[A-Za-z]+):(.+)$/.exec(a);
      if (joined && POWERSHELL_PATH_FLAGS.has(joined[1].toLowerCase())) found.push(joined[2]);
    }
  });
  return found;
}

// The heredoc bodies of a command taken out, so words inside one are never read as commands: { text, bodies }, where
// `bodies` holds those fed to a program that runs them ({ program, body }), which are read instead.
const RUNS_ITS_INPUT = new Set(['python', 'python3', 'node', 'deno', 'ruby', 'perl', 'sh', 'bash', 'zsh']);
function withoutHeredocs(command) {
  const lines = String(command).split('\n');
  const kept = [];
  const bodies = [];
  let end = null;
  let current = null;
  for (const line of lines) {
    if (end !== null) {
      if (line.trim() === end) {
        end = null;
        if (current !== null) bodies.push(current);
        current = null;
      } else if (current !== null) current.body += `${line}\n`;
      continue;
    }
    const found = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    kept.push(found ? line.replace(found[0], ' ') : line);
    if (found) {
      end = found[2];
      const before = line.slice(0, found.index).split(/[|;&]/).at(-1).trim().split(/\s+/)[0] ?? '';
      const program = path.basename(before).replace(/\.exe$/i, '').replace(/\d+(\.\d+)*$/, '');
      current = RUNS_ITS_INPUT.has(program) ? { program, body: '' } : null;
    }
  }
  return { text: kept.join('\n'), bodies };
}

// What a shell command would change: { paths: [full path], here: whether it writes somewhere it doesn't name, in the
// folder it runs in }, or null when it can't be read. A `cd` to a plain folder moves where the rest runs.
export function shellChanges(command, cwd, { windows = false, home = os.homedir() } = {}) {
  const { text: bare, bodies } = withoutHeredocs(command);
  const text = bare.replace(/\d*>&(\d+|-)(?=$|[\s;|&)])/g, ' ');
  const read = segmentsWithOperators(text, windows);
  if (read === null || read.operators.some((op) => op === '(' || op === '`')) return null;
  const paths = [];
  let here = false;
  let at = cwd;
  const inner = [];
  for (const { program, body } of bodies) {
    if (['sh', 'bash', 'zsh'].includes(program)) inner.push(shellChanges(body, cwd, { windows, home }));
    else if (WRITING_CODE.test(body)) here = true;
  }
  const place = (given) => {
    if (typeof given !== 'string' || given === '' || /[$`*?]/.test(given)) return;
    paths.push(given === '~' ? home : given.startsWith('~/') ? path.join(home, given.slice(2)) : path.resolve(at, given));
  };
  read.segments.forEach((words, i) => {
    if (read.operators[i] === '>') {
      place(words[0]);
      words = words.slice(1);
    } else if (read.operators[i] === '<') words = words.slice(1);
    if (words.length === 0) return;
    const name = path.basename(words[0]).replace(/\.exe$/i, '');
    const lower = name.toLowerCase();
    const args = words.slice(1);
    if (name === 'cd') {
      const [to] = flagless(args);
      if (to !== undefined && !/[$`~*?]/.test(to)) at = path.resolve(at, to);
    } else if (name === 'tee') flagless(args).forEach(place);
    else if (name === 'sed' || name === 'perl') {
      if (args.some((a) => /^-[A-Za-z]*i|^--in-place/.test(a))) {
        const given = [];
        args.forEach((a, k) => { if (!a.startsWith('-') && !['-e', '-pe', '-ne', '-f'].includes(args[k - 1])) given.push(a); });
        const withScript = args.some((a) => ['-e', '-pe', '-ne', '-f', '--expression', '--file'].includes(a));
        (withScript ? given : given.slice(1)).forEach(place);
      }
    } else if (name === 'cp' || name === 'mv' || name === 'install' || name === 'ln') place(flagless(args).at(-1));
    else if (name === 'touch' || name === 'mkdir' || name === 'truncate') flagless(args).forEach(place);
    else if (name === 'git' && flagless(args)[0] === 'init') place(flagless(args)[1] ?? '.');
    else if (['npm', 'pnpm', 'yarn', 'bun'].includes(name) && ['create', 'init'].includes(flagless(args)[0])) here = true;
    else if (['npx', 'bunx'].includes(name) && /^create-/.test(flagless(args)[0] ?? '')) here = true;
    else if (CODE_FLAGS[name.replace(/\d+(\.\d+)*$/, '')] || CODE_FLAGS[name]) {
      const flags = CODE_FLAGS[name] ?? CODE_FLAGS[name.replace(/\d+(\.\d+)*$/, '')];
      const k = args.findIndex((a) => flags.includes(a));
      if (k >= 0 && WRITING_CODE.test(args.slice(k + 1).join(' '))) here = true;
    } else if (windows && POWERSHELL_WRITERS.has(lower)) powershellPaths(args).forEach(place);
  });
  for (const one of inner) {
    if (one === null) continue;
    paths.push(...one.paths);
    if (one.here !== null) here = true;
  }
  return { paths, here: here ? at : null };
}

// The holder's hook keeps the seat's `seenAt` fresh. Never throws.
const refreshHeld = (project, session) => refreshSeat(project, session);

// The hook's answer: undefined to let the tool run.
export function decide(input, { env = process.env, find = projectOf, setUp = beingSetUp, role = sessionRole, now = Date.now, locked = lockedNow } = {}) {
  const tool = input?.tool_name;
  const field = WRITING[tool];
  if ((field === undefined && !SHELL.includes(tool)) || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)) return undefined;
  if (ownRun(env) !== null) return undefined;
  const found = find(input.cwd);
  const folder = found?.record?.folder;
  if (!folder) return undefined;
  const running = setUp(input.cwd);
  if (running !== null && setupLive(running.run, now())) return undefined;
  const kind = role({ sessionId: input.session_id, env, cwd: input.cwd });
  if (kind === 'front-desk') refreshHeld(found.project, input.session_id);
  else if (!(kind === 'aside' && asideKind({ cwd: input.cwd }) === 'main')) return undefined;
  const noWrites = kind === 'front-desk' ? FRONT_DESK_NO_WRITES : ASIDE_NO_WRITES;
  // A linked worktree the session stands in is its own checkout (an engine worktree, a job folder); a nested repository
  // made inside the project (`git init`) is not.
  const root = worktreeRoot(input.cwd);
  let linked = null;
  try {
    if (root !== null && !sameFolder(root, folder) && fs.statSync(path.join(root, '.git')).isFile()) linked = root;
  } catch { /* not linked */ }
  const refused = (file) => inside(folder, file) && !inside(path.join(folder, OWN_FOLDER), file) && !(linked !== null && inside(linked, file));
  const named = (file) => path.relative(realPath(folder), realPath(file)).split(path.sep).join('/') || '.';
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
  let held = [];
  try {
    if (targets.length > 0) held = locked(found.project, folder);
  } catch { /* can't tell: allow */ }
  const lockedHit = Array.isArray(held) ? held.find((d) => typeof d?.file === 'string' && targets.some((t) => keyOf(realPath(t)) === keyOf(realPath(d.file)))) : undefined;
  if (lockedHit !== undefined) return answer.deny(APPROVED_LOCKED(lockedHit.work, named(lockedHit.file)));
  if (field !== undefined && field !== 'notebook_path') {
    const work = path.join(folder, OWN_FOLDER, 'work');
    if (inside(work, targets[0]) && targets[0].endsWith('.md') && writtenText(input).some(statusLineIn)) return answer.deny(NO_STATUS_LINE);
  }
  const first = targets.find(refused);
  return first === undefined ? undefined : answer.deny(noWrites(named(first)));
}

if (startedAsScript(import.meta.url)) await runAndExit(decide, { failClosed: false, event: 'PreToolUse' });
