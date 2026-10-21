// scripts/hooks/kit.js
// What every Wheelhouse hook shares: reading the input, shaping the answer,
// finding the project without running git, and the rule that a Locked project
// hears from the managed copy of a hook only.
//
// What Claude Code gives and takes, from https://code.claude.com/docs/en/hooks
// and https://code.claude.com/docs/en/plugins-reference (read 18 October 2026):
//
// Input. One JSON object on stdin. Every event carries session_id,
// transcript_path, cwd, hook_event_name and, on most events, permission_mode.
// permission_mode is one of "default" (the mode labelled Manual), "plan",
// "acceptEdits", "auto", "dontAsk", "bypassPermissions"; "not every event
// includes it", so a hook treats a missing one as unknown. Further fields:
//   SessionStart      source: "startup" | "resume" | "clear" | "compact" | "fork"
//                     (the matcher takes the same values); agent_type sometimes.
//   UserPromptSubmit  prompt.
//   PreToolUse        tool_name, tool_input, tool_use_id.
//   PostToolUse       tool_name, tool_input, tool_response (its shape depends on
//                     the tool), tool_use_id, duration_ms.
//   SubagentStop      agent_type (the matcher filters on it), agent_id,
//                     agent_transcript_path (the subagent's own transcript),
//                     stop_hook_active, and last_assistant_message, the text of
//                     the subagent's final reply. The docs recommend it over
//                     reading the transcript. agent_type is therefore present.
//   PreCompact        trigger: "manual" | "auto" (the matcher takes the same
//                     values), custom_instructions (null unless /compact had text).
//   SessionEnd        reason: "clear" | "resume" | "logout" | "prompt_input_exit"
//                     | "other". It takes a matcher on reason; Wheelhouse sets none.
//   Inside a subagent the common fields also carry agent_id and agent_type.
// Every field the plan relies on exists. Two things to know: SessionEnd has no
// decision control and a 1.5-second default budget (the 10-second timeout in
// hooks.json raises it), and SessionStart's matcher also takes "fork".
//
// Output. Exit code 0 with JSON on stdout.
//   PreToolUse   { hookSpecificOutput: { hookEventName: 'PreToolUse',
//                  permissionDecision: 'allow'|'deny'|'ask'|'defer',
//                  permissionDecisionReason } }
//   Context      { hookSpecificOutput: { hookEventName, additionalContext } },
//                  wrapped in a system reminder, capped at 10,000 characters.
//   Block        { decision: 'block', reason } on UserPromptSubmit, PostToolUse,
//                  Stop, SubagentStop and PreCompact. Exit code 2 with the reason
//                  on stderr also blocks, and JSON cannot override it.
//
// Plugin hooks. hooks/hooks.json wraps the event map in a top-level "hooks"
// key. ${CLAUDE_PLUGIN_ROOT} is the plugin's installed folder and is also
// exported to the hook's process. "timeout" is in seconds.
//
// Hooks never run git or anything else in a folder an agent controls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectForFolder, isInsideFolder } from '../lib/projects.js';
import { lockedProjects, managedDir } from '../protection/managed.js';
import { wheelhouseHome } from '../lib/paths.js';
import { readJournal, firstUnfinished, runClosed } from '../lib/setup-run.js';
import { readSmallText, SMALL_FILE_BYTES } from '../lib/small-file.js';
import { pluginOnIn } from '../lib/plugin-on.js';
import { answer } from '../../adapters/claude-code/answers.js';
import translateClaudeCode from '../../adapters/claude-code/translate.js';
import { agentOfInput } from '../agents/of-input.js';

export { managedDir, lockedProjects };

const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
const keyOf = (p) => (caseBlind ? p.toLowerCase() : p);

function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

// The JSON object on the stream. Anything else throws.
export async function readInput(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The hook input must be an object');
  return parsed;
}

// The answers Claude Code's hooks write live in the Claude Code adapter.
export { answer };

// A small regular file's text, or null, read without waiting (scripts/lib/small-file.js).
export { readSmallText, SMALL_FILE_BYTES };
const readText = (file) => readSmallText(file);

// The main folder of the repository `cwd` is in, read from .git files with fs
// only. A `.git` folder is the main folder. A `.git` file holds `gitdir: <path>`;
// that folder's `commondir` leads to the main .git, whose parent is the main
// folder. Without a commondir the folder holding the .git file is the answer.
export function findRepoRoot(cwd) {
  if (typeof cwd !== 'string' || cwd === '' || !path.isAbsolute(cwd)) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    const dot = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(dot);
    } catch {
      // Not here; look higher.
    }
    if (stat?.isDirectory()) return dir;
    if (stat?.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dot) ?? '');
      if (!pointer) return dir;
      const gitdir = path.resolve(dir, pointer[1]);
      const common = readText(path.join(gitdir, 'commondir'))?.trim();
      if (!common) return dir;
      // Only a main .git folder counts: a worktree of a submodule or of a bare
      // repository has no main working folder to name.
      const mainGit = path.resolve(gitdir, common);
      return path.basename(mainGit) === '.git' ? path.dirname(mainGit) : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// The registered project `cwd` belongs to, and whether it is Locked. Reads files only.
export function projectOf(cwd, { dir = managedDir() } = {}) {
  const root = findRepoRoot(cwd);
  if (root === null) return null;
  const found = projectForFolder(realPath(root));
  if (!found) return null;
  // By the record's folder, as lockedByPath does: a rewritten .git file can move `root`, not the record.
  const locked = lockedProjects({ dir }).some((folder) => sameFolder(folder, found.record.folder));
  return { project: found.project, record: found.record, locked };
}

// Whether the folder lies inside a registered project's main folder, worked out
// by path alone, so a rewritten .git file cannot step out of a guard. Null when
// the folder cannot be placed.
export function registeredByPath(cwd) {
  try {
    return projectForFolder(fs.realpathSync.native(cwd)) !== null;
  } catch {
    return null;
  }
}

// The folder being set up that `cwd` lies in, or null. The hooks act only in a registered project,
// and the folder setup is working on isn't one yet (the plan's builder check 3), so a folder in no
// registered project counts as being set up when a setup run's folder holds it, or when its own
// settings, or a folder's above it short of the home folder, switch the plugin on: setup installs
// the plugin for the project's folder. `run` is the latest run there (the nearest folder's), or null.
// A journal that can't be read leaves the folder counted as being set up, so the guards act, with
// `journal: false`.
// Setup's step 3 registers the folder, and step 7 makes its first commit, so for steps 4 to 10 the
// folder is a registered one, with no .git until step 7. A registered folder still counts as being
// set up while the latest run in the registered record's own folder is unfinished, and only then:
// the product's folder exists from setup's step 1, and its run is there (ruling R34), so a run in
// a folder above it, another product's setup, is never this project's (ruling R27). Once every
// step is done it is a project like any other, and a registered folder whose journal can't be read
// is left to the project's own hooks (the session start then holds the foreman back, as whether
// setup finished isn't known). Never throws: a folder that can't be placed is null, and
// callers that guard treat that as they already do. The guards ask projectOf and registeredByPath
// first, and act in a registered folder by those.
// A run uninstall has closed (ruling R89) is over: it never counts. A folder held by closed runs and
// no open one is one Wheelhouse was removed from (removedFrom), not one being set up, even while its
// settings still switch the plugin on, until the director removes it; a newer run there, setting it
// up again, counts as any run does.
export function beingSetUp(cwd, { home = os.homedir() } = {}) {
  if (typeof cwd !== 'string' || cwd === '' || !path.isAbsolute(cwd)) return null;
  let real;
  let registered;
  try {
    real = fs.realpathSync.native(cwd);
    registered = projectForFolder(real);
  } catch {
    return null;
  }
  let runs;
  try {
    runs = readJournal().runs;
  } catch {
    return registered ? null : { folder: real, run: null, journal: false };
  }
  const named = runs.filter((r) => typeof r?.folder === 'string');
  const open = named.filter((r) => !runClosed(r));
  if (registered) {
    const run = open.filter((r) => sameFolder(r.folder, registered.record.folder)).at(-1);
    return run && firstUnfinished(run) !== null ? { folder: run.folder, run, journal: true } : null;
  }
  const holding = holdingRuns(open, real, home);
  if (holding.length > 0) {
    const run = nearestRun(holding);
    return { folder: run.folder, run, journal: true };
  }
  // A folder Wheelhouse was removed from (only a closed run's folder is it) is not being set up,
  // though its settings still switch the plugin on; a folder inside it whose own settings switch
  // the plugin on is a new one.
  const stop = path.resolve(home);
  for (let dir = real; dir !== stop && !sameFolder(dir, stop); dir = path.dirname(dir)) {
    if (named.some((r) => sameFolder(r.folder, dir))) return null;
    if (pluginOnIn(dir)) return { folder: dir, run: null, journal: true };
    if (path.dirname(dir) === dir) break;
  }
  return null;
}

// The runs whose folder holds `real`. A run at the home folder or above it is never one setup started
// (the engine refuses it), and would hold every folder under home.
const holdingRuns = (runs, real, home) => runs.filter((r) => isInsideFolder(r.folder, real) && !isInsideFolder(r.folder, home));
// The latest run of the nearest folder among them.
function nearestRun(holding) {
  const nearest = Math.max(...holding.map((r) => r.folder.length));
  return holding.filter((r) => r.folder.length === nearest).at(-1);
}

// The folder Wheelhouse was removed from that `cwd` lies in, or null (ruling R89): no project is
// registered there, no open setup run holds it, and a run uninstall closed does, so the session start
// says Wheelhouse was removed rather than that the folder isn't set up yet. `run` is the latest closed
// run of the nearest such folder. Never throws: a folder that can't be placed, or a journal that can't
// be read, is null.
export function removedFrom(cwd, { home = os.homedir() } = {}) {
  if (typeof cwd !== 'string' || cwd === '' || !path.isAbsolute(cwd)) return null;
  try {
    const real = fs.realpathSync.native(cwd);
    if (projectForFolder(real) !== null) return null;
    const named = readJournal().runs.filter((r) => typeof r?.folder === 'string');
    if (holdingRuns(named.filter((r) => !runClosed(r)), real, home).length > 0) return null;
    const closed = holdingRuns(named.filter(runClosed), real, home);
    if (closed.length === 0) return null;
    const run = nearestRun(closed);
    return { folder: run.folder, run };
  } catch {
    return null;
  }
}

// Exists, whatever it is: a folder or a symlink (even a dangling one) counts.
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

// The nearest folder upwards from `cwd` with a .git entry (file or folder), by fs only.
export function worktreeRoot(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    if (exists(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Whether Locked's managed copy of the hooks is in place: its kit.js is there,
// and managed-settings.json has a hook that runs a script under
// <dir>/wheelhouse/scripts/hooks/ with a Node.js that exists. Without all of
// that nothing would answer in a Locked project, so the plugin's copy must.
export function managedCopyInPlace(dir) {
  try {
    const own = path.join(dir, 'wheelhouse');
    if (!fs.statSync(path.join(own, 'scripts', 'hooks', 'kit.js')).isFile()) return false;
    const settings = JSON.parse(fs.readFileSync(path.join(dir, 'managed-settings.json'), 'utf8'));
    const prefix = path.join(own, 'scripts', 'hooks') + path.sep;
    const named = Object.values(settings?.hooks ?? {}).flatMap((groups) => (Array.isArray(groups) ? groups : []))
      .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
      .filter((hook) => Array.isArray(hook?.args) && typeof hook.args[0] === 'string' && hook.args[0].startsWith(prefix));
    if (named.length === 0) return false;
    return named.every((hook) => {
      try {
        return typeof hook.command === 'string' && fs.statSync(hook.command).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

// The file the managed copy's session-start writes for a session; null for an odd id.
export function managedMarker(project, sessionId) {
  if (typeof project !== 'string' || typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
  return path.join(wheelhouseHome(), 'projects', project, 'sessions', `${sessionId}.managed`);
}

// Whether two folders are the same one: real paths, case folded where the system folds it.
export function sameFolder(a, b) {
  return keyOf(realPath(a)) === keyOf(realPath(b));
}

// Whether the folder lies inside a registered project that is Locked, by path alone.
export function lockedByPath(cwd, { dir = managedDir() } = {}) {
  try {
    const found = projectForFolder(fs.realpathSync.native(cwd));
    return Boolean(found) && lockedProjects({ dir }).some((folder) => sameFolder(folder, found.record.folder));
  } catch {
    return false;
  }
}

const SELF = fileURLToPath(import.meta.url);

// Whether `file` lies inside `folder`: the test for a script being the managed copy.
export function isInside(folder, file) {
  const base = keyOf(realPath(folder));
  const target = keyOf(realPath(file));
  return target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

// The translation of each agent's hook input and answers. The adapters' registry (scripts/agents/index.js)
// reaches the setup and evaluation code, which a hook must not load, so the kit holds each agent's
// translation on its own. An agent with no entry here has no translation, and its input is refused.
const TRANSLATORS = Object.freeze({ 'claude-code': Object.freeze({ translate: translateClaudeCode }) });
function translators(agent) {
  if (!Object.hasOwn(TRANSLATORS, agent)) throw new Error(`The hook kit has no translation for the agent ${JSON.stringify(agent)}`);
  return TRANSLATORS[agent];
}

// What a guard answers when its check could not run, shaped for its event.
// SessionStart and SessionEnd cannot refuse anything, so they stay silent.
function failureAnswer(event) {
  const reason = 'Wheelhouse\'s check could not run';
  if (event === 'PreToolUse') return answer.deny(reason);
  if (['UserPromptSubmit', 'PostToolUse', 'SubagentStop', 'PreCompact'].includes(event)) return answer.block(reason);
  return null;
}

// Runs one hook. `decide(input, deps)` returns the JSON to print, or nothing.
// A throw from a guard prints a denial that names no detail; a throw from a hook
// that only informs prints nothing. In a Locked project the plugin's copy stays
// silent once the managed copy is in place and has started the session. The managed copy guards everywhere
// and informs only in Locked projects.
//
// Every guard today is on PreToolUse (the STOP guard also runs at SessionEnd,
// where nothing can be refused); the hooks on UserPromptSubmit, PostToolUse,
// SubagentStop and PreCompact only inform (failClosed: false). So failureAnswer's
// block answer for those events is kept only for a guard that may one day be added there.
export async function hookMain(decide, { failClosed, event }, io = {}) {
  const { stdin = process.stdin, write = (text) => process.stdout.write(text), self = SELF, dir, deps = {}, projectOf: find = projectOf, adapter: given } = io;
  // The adapter's translation is applied to what is written, and the refusal goes through it too.
  let adapter = given ?? translators('claude-code');
  try {
    const raw = await readInput(stdin);
    // The agent the input came from; input that names none is Claude Code's, as it always was.
    const agent = agentOfInput(raw) ?? 'claude-code';
    if (given === undefined) adapter = translators(agent);
    const input = adapter.translate.toGuardInput(raw, event);
    // An input the adapter cannot translate is handled as a hook that could not read its input.
    if (input === null || input === undefined) throw new Error('The adapter could not translate the hook input');
    const managed = dir ?? managedDir();
    const isManagedCopy = isInside(managed, self);
    if (typeof input.cwd === 'string') {
      const found = find(input.cwd, { dir: managed });
      const locked = found?.locked === true;
      // The plugin's copy defers to the managed copy once that is in place; after
      // SessionStart, only when the managed copy has answered this session.
      if (!isManagedCopy && locked && managedCopyInPlace(managed)) {
        const marker = event === 'SessionStart' ? null : managedMarker(found.project, input.session_id);
        if (event === 'SessionStart' || (marker !== null && fs.existsSync(marker))) return;
      }
      // The managed copy runs everywhere as a guard, and only in Locked projects as an informer.
      if (isManagedCopy && !failClosed && !locked) return;
    }
    const out = await decide(input, { event, dir: managed, ...deps });
    const shaped = out === undefined || out === null ? out : adapter.translate.fromGuardAnswer(out, event);
    if (shaped !== undefined && shaped !== null) write(`${JSON.stringify(shaped)}\n`);
  } catch {
    try {
      const refusal = failClosed ? failureAnswer(event) : null;
      const shaped = refusal ? adapter.translate.fromGuardAnswer(refusal, event) : null;
      if (shaped) write(`${JSON.stringify(shaped)}\n`);
    } catch {
      // The adapter could not shape the refusal either; nothing more can be said.
    }
  }
}

// What a hook script's main block runs. Writes the answer, waits for the write
// to be taken (a Windows pipe takes it asynchronously), then exits: a request
// or a timer still open must not hold the process past the hook's timeout.
export async function runAndExit(decide, options, io = {}) {
  const chunks = [];
  await hookMain(decide, options, { ...io, write: (text) => chunks.push(text) });
  const text = chunks.join('');
  if (text !== '') await new Promise((resolve) => process.stdout.write(text, () => resolve()));
  process.exit(0);
}

const TAIL_BYTES = 256 * 1024;

// The last 256 KB of a transcript as parsed JSON lines, oldest first. The partial
// first line is dropped when the file is longer than that, and a line that is
// not JSON is skipped. Null when the file cannot be read.
export function readTailEntries(file, { bytes = TAIL_BYTES } = {}) {
  if (typeof file !== 'string' || file === '') return null;
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const from = Math.max(0, size - bytes);
      const buffer = Buffer.alloc(size - from);
      fs.readSync(fd, buffer, 0, buffer.length, from);
      text = buffer.toString('utf8');
      if (from > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const entries = [];
  for (const line of text.split('\n')) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Not a JSON line.
    }
  }
  return entries;
}
