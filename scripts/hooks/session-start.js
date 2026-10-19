// scripts/hooks/session-start.js
// At the start of every session in a Wheelhouse project: starts the host helper
// when it is not answering, sends any records a hook kept, syncs the state,
// starts the watcher when the project's shape is 1 and it isn't running
// (ruling R62), checks the installed upstream skills against Wheelhouse's
// manifest (holding edits and commands on a mismatch, and recording the hold
// in the state once) and records the session's provenance, and adds a short
// reload as context. The reload names things; it never pastes whole files
// (design section 19.1, point 5).
//
// Limits. The hook has ten seconds (hooks.json); it keeps to eight: at most
// five of them waiting for the helper to start, the rest for the records, the
// sync, the views and the watcher, which is last and gets what is left. On Windows the Guarded
// self-test (scripts/windows/low.js) runs after them, within its own 3 seconds or what is left,
// when the level would be Guarded or the last result is missing or over a day old, and only once
// the copy of Node.js it needs is whole; the copy itself is made in the background, never here. Context added by a hook is capped at 10,000 characters
// (https://code.claude.com/docs/en/hooks, read 18 October 2026), so the reload
// stays under 9,000 and each list shows at most 20 entries.
//
// In a folder being set up (no project record yet, or one setup registered and is still finishing:
// kit.js's beingSetUp) it makes this computer's signing key when there is none, and enrols it when
// this computer's list is empty (the plan's call: the first key is trusted on first use), starts
// the helper, and says where setup stands. In a project setup is still finishing (step 3 has
// registered it and step 7 made its first commit), the project's reload says where setup stands in
// place of the front desk's line, so the session carries on with setup.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { answer, runAndExit, projectOf, isInside, managedDir, managedMarker, readTailEntries, readSmallText, beingSetUp } from './kit.js';
import { keep, sendPending, withinBudget } from './pending.js';
import { startWatcher, watcherRunning } from '../foreman/start.js';
import { helperClient } from '../host/helper-client.js';
import { stopState } from '../lib/stop.js';
import { wheelhouseHome, stateDir, computerId } from '../lib/paths.js';
import { WINDOWS_LINE, UNATTENDED_LINE } from '../lib/platform-lines.js';
import { buildsShown, settingKey } from '../protection/windows-builds.js';
import { listEvents } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { startBackground, startDetached } from '../lib/background.js';
import { sessionRole } from '../lib/role.js';
import { projectConfig } from '../watcher/main.js';
import { CLAUDE_CODE_FLOOR } from '../lib/build-loop.js';
import { readProject } from '../lib/projects.js';
import { run as runProgram } from '../lib/run.js';
import {
  LOW_NODE_SCRIPT, guardedReady, lowNodeReady, needsSelfTest, selfTest, SELF_TEST_MS,
} from '../windows/low.js';
import { checkLineage, holdEvent, markRecorded, warningLines, writeProvenance } from '../lineage/check.js';
import { claudeCodeOf } from '../lineage/provenance.js';
import { makeSigningKey, ownKey, readEnrolled, enrol } from '../state/signing.js';
import { SETUP_STEPS, firstUnfinished } from '../lib/setup-run.js';

const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TOTAL_MS = 8000;
export const START_WAIT_MS = 5000;
export const MAX_CHARS = 9000;
export const MAX_ENTRIES = 20;
const LINE_CHARS = 200;

export const NO_HELPER = 'The host helper isn\'t running, so nothing can be pushed or merged';
export const NOT_SYNCED = 'State was not synced with the host this time';
export const NO_USAGE = 'Usage counts couldn\'t start this time';
// In the project's main folder, for any session that isn't the foreman's: the front desk's playbook.
export const FRONT_DESK_LINE = 'This is the front desk. Follow wheelhouse:front-desk.';

// In a folder being set up: where setup stands.
export const NOT_SET_UP = 'This folder isn\'t set up for Wheelhouse yet. Follow wheelhouse:setup.';
export const partWay = (n, title) => `Setup is part-way through: step ${n}, ${title}, is next. Follow wheelhouse:setup.`;
export const JOURNAL_UNREADABLE = 'Setup\'s journal couldn\'t be read, so where setup stands isn\'t known. Follow wheelhouse:setup.';

// hooks.json's `onFailure: "block"` makes a guard that fails (crashes, times out) stop the
// tool call. Claude Code reads that field from CLAUDE_CODE_FLOOR; an older one lets the call through.
export const GUARD_FLOOR = CLAUDE_CODE_FLOOR.split('.').map(Number);
export const OLD_CLAUDE_CODE = `This Claude Code is older than ${CLAUDE_CODE_FLOOR}, so a guard that fails does not stop a tool call: update Claude Code`;

// Claude Code's version as the newest transcript entry that carries one gives it, as three
// numbers, or null when it is not known.
export function claudeCodeVersion(transcriptPath) {
  const version = claudeCodeOf(readTailEntries(transcriptPath) ?? []);
  return version === null ? null : version.split('.').map(Number);
}

function olderThan(version, floor) {
  for (let i = 0; i < floor.length; i += 1) {
    if (version[i] !== floor[i]) return version[i] < floor[i];
  }
  return false;
}

// This copy's version, from its own .claude-plugin/plugin.json; null when unreadable.
function ownVersion(pluginRoot) {
  try {
    const version = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'))?.version;
    return typeof version === 'string' && version !== '' ? version : null;
  } catch {
    return null;
  }
}

const oneLine = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS - 1)}…` : text;
};

// At most MAX_ENTRIES lines under a heading, then "and N more".
function section(heading, lines) {
  if (lines.length === 0) return [];
  const shown = lines.slice(0, MAX_ENTRIES).map((l) => `- ${oneLine(l)}`);
  if (lines.length > MAX_ENTRIES) shown.push(`and ${lines.length - MAX_ENTRIES} more`);
  return [heading, ...shown];
}

// A value as one line of text: a string as it is, anything else as JSON.
const show = (value) => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Small regular files only, opened without waiting: a FIFO HEAD can't hang the hook.
const readText = (file) => readSmallText(file);

// The branch a folder is on, read from the HEAD file with fs only (never git).
export function branchOf(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    const dot = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(dot);
    } catch { /* look higher */ }
    let gitdir = null;
    if (stat?.isDirectory()) gitdir = dot;
    else if (stat?.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dot) ?? '');
      if (!pointer) return null;
      gitdir = path.resolve(dir, pointer[1]);
    }
    if (gitdir) {
      const head = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readText(path.join(gitdir, 'HEAD')) ?? '');
      return head ? head[1] : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function featureSlug(cwd) {
  const match = /^feature\/([A-Za-z0-9._-]+)$/.exec(branchOf(cwd) ?? '');
  return match && !/^\.+$/.test(match[1]) ? match[1] : null;
}

// The views as the last sync left them on disk, when the helper cannot give them.
// While views are being replaced the old ones sit in `views.old` for a moment (or for good
// after a crash), so that folder is read when `views` is not there. `names` null reads
// every view there (the board's inputs).
export function localViews(project, names = ['rulebook', 'levels', 'waiting', 'unconfirmed', 'keptAsIs', 'damaged']) {
  const base = path.join(wheelhouseHome(), 'projects', project, 'views');
  const dir = fs.existsSync(base) ? base : `${base}.old`;
  const out = {};
  let wanted = names;
  try {
    wanted ??= fs.readdirSync(dir).filter((n) => /^[A-Za-z][A-Za-z0-9-]*\.json$/.test(n)).map((n) => n.slice(0, -'.json'.length));
  } catch {
    return null;
  }
  for (const name of wanted) {
    try {
      out[name] = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    } catch { /* missing */ }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// The views the session start reads when the helper can't give them: those the last sync left on
// disk, with the settings and the unconfirmed changes built from the local events, as the waker
// reads them, so the level shown is the one the waker acts on. Events that can't be read leave
// the views on disk as they are.
function fallbackViews(project) {
  const views = localViews(project);
  let built = null;
  try {
    built = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
  } catch {
    return views;
  }
  return { ...views, settings: built.settings, unconfirmed: built.unconfirmed };
}

const MARKER_DAYS = 7;

// True the first time it is asked for a session, false after. Markers older
// than seven days are removed whenever one is written.
function firstForSession(project, sessionId, now) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(sessionId)) return true;
  const file = path.join(wheelhouseHome(), 'projects', project, 'session-markers', `${sessionId}.windows`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const cutoff = now().getTime() - MARKER_DAYS * 86400000;
    for (const name of fs.readdirSync(path.dirname(file))) {
      if (!name.endsWith('.windows')) continue;
      const old = path.join(path.dirname(file), name);
      try {
        if (fs.statSync(old).mtimeMs < cutoff) fs.rmSync(old, { force: true });
      } catch { /* gone already */ }
    }
    fs.writeFileSync(file, '', { flag: 'wx' });
    return true;
  } catch (error) {
    return error?.code !== 'EEXIST';
  }
}

// The managed copy says it has started this session, so the plugin's copy knows
// to stay silent. Markers older than seven days are removed as one is written.
function markManaged(project, sessionId, { self, dir, now }) {
  try {
    if (!isInside(dir, self)) return;
    const file = managedMarker(project, sessionId);
    if (file === null) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const cutoff = now().getTime() - MARKER_DAYS * 86400000;
    for (const name of fs.readdirSync(path.dirname(file))) {
      if (!name.endsWith('.managed')) continue;
      const old = path.join(path.dirname(file), name);
      try {
        if (fs.statSync(old).mtimeMs < cutoff) fs.rmSync(old, { force: true });
      } catch { /* gone already */ }
    }
    fs.writeFileSync(file, '');
  } catch { /* the plugin's copy then answers as well, which is safe */ }
}

// The helper's /health answer once it answers, starting it when it does not; null when it never does.
async function ensureHelper(client, { spawn, pluginRoot, waitMs, pause, end }) {
  const first = await withinBudget(end)(client.health());
  if (first?.ok === true) return first;
  try {
    // Started in Wheelhouse's own folder, never in the session's.
    const home = wheelhouseHome();
    fs.mkdirSync(home, { recursive: true });
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'host', 'helper-main.js')], { cwd: home, detached: true, windowsHide: true, stdio: 'ignore' });
    child?.unref?.();
    child?.on?.('error', () => {});
  } catch {
    return null;
  }
  const until = Math.min(end, Date.now() + waitMs);
  while (Date.now() < until) {
    await pause(100);
    const health = await withinBudget(until)(client.health());
    if (health?.ok === true) return health;
  }
  return null;
}

// A hold just written becomes one plain lineage-hold event (ruling R146), for the front desk
// to put to the director: a held session can't ask, and nothing else reads the hold file. Once
// per mismatch set: while the same set stands, the hold file says it is recorded. It is kept
// with the records a hook keeps, and sent with them below or at a later start. It informs, so
// a failure is passed over, and the hold still stands.
function recordHold(project, result, now) {
  if (result.ok || result.kept !== true || result.recorded === true || typeof result.set !== 'string') return;
  try {
    keep(project, 'write', { project, kind: 'lineage-hold', data: holdEvent(now().toISOString(), result.mismatches) }, now);
    markRecorded(project, result.set);
  } catch { /* the hold stands without it */ }
}

// The lineage check (scripts/lineage/check.js) for the project's folder: writes the hold file on
// a mismatch and removes it on a match, records the hold in the state, and records this
// session's provenance. Gives the warning lines. It informs, so anything that goes wrong is
// passed over.
function lineageCheck(found, input, version, { check, root, claudeHome, now }) {
  try {
    const folder = found.record?.folder ?? readProject(found.project)?.folder;
    const result = check({ project: found.project, projectDir: folder, root, claudeHome, now });
    recordHold(found.project, result, now);
    try {
      writeProvenance({
        project: found.project, sessionId: input.session_id, root, upstreams: result.upstreams, ok: result.ok,
        claudeCode: version === null ? null : version.join('.'), transcript: input.transcript_path,
      });
    } catch { /* the session carries on without it */ }
    return result.ok ? [] : warningLines(result.mismatches, { kept: result.kept !== false });
  } catch {
    return [];
  }
}

// In a Shape 1 project, starts the watcher when it isn't running, as the
// foreman's start script does (ruling R62). A watcher found running needs no
// configuration asked for. It informs, so anything that goes wrong is passed over.
async function ensureWatcher(project, client, { spawn, pluginRoot }) {
  try {
    if (watcherRunning(project) || typeof client.config !== 'function') return;
    const read = await projectConfig(project, client);
    // As the start script reads the shape: anything but 2 is Shape 1.
    if (read.config !== null && read.config.watcherShape !== 2) startWatcher(project, { spawn, pluginRoot });
  } catch { /* the session carries on without it */ }
}

// A setting for build commands on Windows is confirmed only through its own card, so a proposal
// of one is never listed as changed without the director's confirmation (as on the board).
const BUILDS_KEY = settingKey('');
const isBuildsProposal = (u) => u?.kind === 'setting' && [u.key, u.data?.key].some((key) => typeof key === 'string' && key.startsWith(BUILDS_KEY));

// `lineage` is the lineage check's warning lines, which come first after STOP. `windows` adds the
// Windows line after them; `builds`, the level build commands run at on this computer, adds the
// Unattended line after that while it is on. All come before the lists, so the cut at MAX_CHARS
// never takes them.
export function reload({ views, stop, lineage = [], notes, feature, stateRoot, windows, builds, frontDesk = false }) {
  const lines = [];
  if (stop?.on) lines.push(`STOP is on (set by ${oneLine(stop.by ?? 'unknown')} at ${oneLine(stop.at ?? 'an unknown time')})`);
  lines.push(...lineage);
  if (windows) {
    lines.push(WINDOWS_LINE);
    if (builds === 'unattended') lines.push(UNATTENDED_LINE);
  }
  const damaged = Array.isArray(views?.damaged) ? views.damaged.map((d) => (typeof d === 'string' ? d : JSON.stringify(d))) : [];
  lines.push(...section('Damaged state:', damaged));
  if (frontDesk) lines.push(FRONT_DESK_LINE);
  lines.push(...notes);
  const title = (d) => show(d?.title ?? d?.question ?? d?.words ?? d?.value ?? '');
  // A proposal kept as is on its card here is no longer waiting for the director (ruling F49).
  const kept = new Set(Array.isArray(views?.keptAsIs) ? views.keptAsIs : []);
  const unconfirmed = (views?.unconfirmed ?? []).filter((u) => !isBuildsProposal(u) && !kept.has(u?.id)).map((u) => `${u.id} (${u.kind}${u.key ? ` ${u.key}` : ''}): ${title(u.data)}`);
  const quoted = (unconfirmed.length > 0 || (views?.waiting ?? []).length > 0 || (views?.rulebook ?? []).some((r) => r.status === 'accepted'));
  if (quoted) lines.push('Titles are quoted as agents wrote them.');
  lines.push(...section('Changed without the director\'s confirmation:', unconfirmed));
  lines.push(...section('Waiting on the director:', (views?.waiting ?? []).map((w) => `${w.id}: ${title(w.data)}`)));
  const rules = (views?.rulebook ?? []).filter((r) => r.status === 'accepted')
    .map((r) => `${r.id} (accepted): ${show(r.words ?? '').split('\n')[0]}`);
  lines.push(...section('Rulebook (accepted):', rules));
  const levels = Object.values(views?.levels ?? {}).map((l) => `${l.key}: ${show(l.value)}`);
  lines.push(...section('Levels:', levels));
  if (feature) lines.push(`Your feature's ledger: ${path.join(stateRoot, 'features', feature, 'ledger.md')}`);
  let text = lines.join('\n');
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS - 1)}…`;
  return text;
}

// This computer's signing key, made when there is none (or kept when one was made before), and
// enrolled in this computer's own list when the list is empty, so the director's first click can
// be signed and checked. A computer that already has a list adds nothing to it here; a damaged
// list is never written over (enrol refuses it). It informs, so a failure is passed over.
function firstKey(now) {
  try {
    let own = ownKey();
    if (own === null) {
      try {
        own = makeSigningKey();
      } catch {
        own = ownKey();
      }
    }
    if (own !== null && readEnrolled().length === 0) enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: now().toISOString() });
  } catch { /* no first click can be signed until a key is enrolled; setup's playbook says so */ }
}

// Where setup stands in a folder being set up, as one line; null when every step is done.
function setupNote(setup) {
  if (setup.journal === false) return JOURNAL_UNREADABLE;
  if (setup.run === null) return NOT_SET_UP;
  const next = firstUnfinished(setup.run);
  return next === null ? null : partWay(next, SETUP_STEPS.find((s) => s.n === next).title);
}

// The session start in a folder being set up: the first key, the helper as in a project, and a
// short reload of STOP, what couldn't start, and where setup stands. It gives no Windows lines:
// they speak of a project's deny rules and its build-command level, and a folder with no project
// record has neither until setup writes them (a registered folder being set up gets the project's
// reload, Windows lines included).
async function setupStart(input, setup, { given, spawn, pluginRoot, startWaitMs, totalMs, pause, stopOf, now }) {
  firstKey(now);
  const end = Date.now() + totalMs;
  const lines = [];
  const stop = stopOf();
  if (stop?.on) lines.push(`STOP is on (set by ${oneLine(stop.by ?? 'unknown')} at ${oneLine(stop.at ?? 'an unknown time')})`);
  const version = claudeCodeVersion(input.transcript_path);
  if (version !== null && olderThan(version, GUARD_FLOOR)) lines.push(OLD_CLAUDE_CODE);
  const up = await ensureHelper(given ?? helperClient({ timeout: Math.min(3000, totalMs) }), { spawn, pluginRoot, waitMs: startWaitMs, pause, end });
  if (!up) lines.push(NO_HELPER);
  const note = setupNote(setup);
  if (note !== null) lines.push(note);
  return lines.length === 0 ? undefined : answer.context('SessionStart', lines.join('\n'));
}

export async function decide(input, deps = {}) {
  const {
    dir, projectOf: find = projectOf, client: given, spawn = nodeSpawn,
    platform = process.platform, now = () => new Date(), stopState: stopOf = stopState,
    self = SELF, pluginRoot = PLUGIN_ROOT, startWaitMs = START_WAIT_MS, totalMs = TOTAL_MS, pause = sleep,
    background = startBackground, lineage: check = checkLineage, lineageRoot, claudeHome, env = process.env,
    guardedSelfTest = selfTest, run = runProgram, lowNodeReady: copyReady = lowNodeReady,
  } = deps;
  // Makes the copy of Node.js the Guarded runner starts from, detached, outside this budget.
  const startLowNodeCopy = deps.startLowNodeCopy ?? (() => startDetached(spawn, path.join(pluginRoot, LOW_NODE_SCRIPT)));
  const found = find(input.cwd, { dir });
  if (!found) {
    const setup = beingSetUp(input.cwd);
    return setup === null ? undefined : setupStart(input, setup, { given, spawn, pluginRoot, startWaitMs, totalMs, pause, stopOf, now });
  }
  const { project, locked } = found;
  markManaged(project, input.session_id, { self, dir: dir ?? managedDir(), now });
  const end = Date.now() + totalMs;
  const left = withinBudget(end);
  const notes = [];
  // Each call may take no longer than the budget that is left.
  const clientNow = () => given ?? helperClient({ timeout: Math.max(1, end - Date.now()) });

  const version = claudeCodeVersion(input.transcript_path);
  if (version !== null && olderThan(version, GUARD_FLOOR)) notes.push(OLD_CLAUDE_CODE);
  const lineage = lineageCheck(found, input, version, { check, root: lineageRoot, claudeHome, now });
  const up = await ensureHelper(given ?? helperClient({ timeout: Math.min(3000, totalMs) }), { spawn, pluginRoot, waitMs: startWaitMs, pause, end });
  // Records what this session is for and starts the usage receiver, alongside the sync below.
  const usage = Promise.resolve().then(() => background({ pluginRoot, session: input.session_id, cwd: input.cwd, project, spawn, now })).catch(() => null);
  let views = null;
  if (!up) notes.push(NO_HELPER);
  else {
    const mine = ownVersion(pluginRoot);
    if (typeof up.version === 'string' && mine !== null && up.version !== mine) {
      notes.push(`The helper running is version ${oneLine(up.version)}; this copy is version ${mine}`);
    }
    await left(sendPending(project, clientNow(), { until: end }));
    const synced = await left(clientNow().state.sync({ project }));
    if (synced?.ok !== true) notes.push(NOT_SYNCED);
    const got = await left(clientNow().state.views({ project }));
    if (got?.ok === true && got.views && typeof got.views === 'object') views = got.views;
    await left(ensureWatcher(project, clientNow(), { spawn, pluginRoot }));
  }
  views ??= fallbackViews(project);
  if ((await left(usage))?.receiver === 'failed') notes.push(NO_USAGE);

  const setup = beingSetUp(input.cwd);
  const setupLine = setup === null ? null : setupNote(setup);
  if (setupLine !== null) notes.push(setupLine);

  const stateRoot = stateDir(project);
  // The Guarded self-test, on Windows, when the level read as if it passed would be Guarded, or
  // the last result is missing, over a day old or ran out of time, so the level and the
  // Unattended card's Use Guarded go by a result under a day old. It needs a whole copy of
  // Node.js: with none, the copy is started in the background and the self-test waits for a
  // later session start. It informs, so anything that fails is passed over: the session goes on,
  // and Guarded reads Ask.
  let ready = false;
  if (platform === 'win32') {
    try {
      const home = wheelhouseHome();
      const copied = copyReady({ home });
      if (!copied) startLowNodeCopy();
      const wouldGuard = buildsShown({ views, computer: computerId(), locked, guardedReady: true }).level === 'guarded';
      const timeoutMs = Math.min(SELF_TEST_MS, end - Date.now());
      if (copied && (wouldGuard || needsSelfTest({ home, now })) && timeoutMs > 0) {
        await guardedSelfTest({ run, home, worktree: input.cwd, now, pluginRoot, timeoutMs });
      }
      ready = guardedReady({ home, now, platform });
    } catch { /* not ready */ }
  }
  const windows = platform === 'win32' && firstForSession(project, input.session_id, now);
  // Anything that fails here, the computer's id included, shows Ask and leaves the rest of the
  // reload as it is.
  let builds = 'ask';
  if (windows) {
    try {
      builds = buildsShown({ views, computer: computerId(), locked, guardedReady: ready }).level;
    } catch { /* shown as Ask */ }
  }
  const text = reload({
    views, stop: stopOf(), lineage, notes, feature: featureSlug(input.cwd), stateRoot, windows, builds,
    frontDesk: setupLine === null && featureSlug(input.cwd) === null && sessionRole({ sessionId: input.session_id, env, cwd: input.cwd }) === 'front-desk',
  });
  return text === '' ? undefined : answer.context('SessionStart', text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAndExit(decide, { failClosed: false, event: 'SessionStart' });
}
