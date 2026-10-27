// scripts/hooks/session-start.js
// At the start of every session in a Wheelhouse project: starts the host helper
// when it is not answering, sends any records a hook kept, imports v0.1.x's
// records once, starts the watcher when the project's shape is 1 and it isn't running
// (ruling R62), checks the installed upstream skills against Wheelhouse's
// manifest (holding edits and commands on a mismatch, and recording the hold
// in the state once) and records the session's provenance (all but when the session
// starts from a compaction, which leaves lineage alone), and adds a short
// reload as context. The reload names things; it never pastes whole files
// (design section 19.1, point 5). In the project's main folder it also keeps
// `.wheelhouse/` in the main checkout's local git exclusions, as the foreman does.
//
// Limits. The hook has ten seconds (hooks.json); it keeps to eight: at most
// five of them waiting for the helper to start, the rest for the records, the
// import, the views and the watcher, which is last and gets what is left. On Windows the Guarded
// self-test (scripts/windows/low.js) runs after them, within its own 3 seconds or what is left,
// when the level would be Guarded or the last result is missing or over a day old, and only once
// the copy of Node.js it needs is whole; the copy itself is made in the background, never here.
// Context added by a hook is capped at 10,000 characters
// (https://code.claude.com/docs/en/hooks, read 18 October 2026), so the reload
// stays under 9,000 and each list shows at most 20 entries.
//
// In a folder being set up (no project record yet, or one setup registered and is still finishing:
// kit.js's beingSetUp) it makes this computer's signing key when there is none, and enrols it when
// this computer's list is empty (the plan's call: the first key is trusted on first use), starts
// the helper, and says where setup stands. In a folder Wheelhouse was removed from (uninstall closed
// its run, ruling R89, and no new run has started) it says so, with what is left for the director:
// removing the plugin. In a project setup is still finishing (step 3 has
// registered it and step 7 made its first commit), the project's reload says where setup stands in
// place of the front desk's line, so the session carries on with setup.
//
// The import from v0.1.x (design section 24.5): in a project, before the views are read, it asks the
// helper to import the project's old state clone (/state/import) and the old profile clone
// (/profile/import); in a folder being set up, once step 3 is done, the profile's alone, as no
// project is known yet. The helper imports each once and keeps a mark, so later answers say done. An
// import that brought anything in gets one line (importedLine). It informs, so a failure, or an
// answer later than the budget, gives no line. Each record is a local repository with no remote, so
// there is nothing to sync.
//
// On an agent whose hooks only read (`writeVia: 'helper'`) it does none of the writing above: readOnlyStart.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { answer, runAndExit, projectOf, pluginRoots, isInside, managedDir, managedMarker, readTailEntries, readSmallText, beingSetUp, removedFrom } from './kit.js';
import { keep, sendPending, withinBudget } from './pending.js';
import { startWatcher, watcherRunning } from '../foreman/start.js';
import { helperClient } from '../host/helper-client.js';
import { caEnv } from '../host/company-ca.js';
import { stopState, NO_HELPER_STOP } from '../lib/stop.js';
import { jobFolder, wheelhouseHome, stateDir, computerId } from '../lib/paths.js';
import { WINDOWS_LINE, UNATTENDED_LINE } from '../lib/platform-lines.js';
import { buildsShown, settingKey } from '../protection/windows-builds.js';
import { listEvents, makeEvent } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { isLeanProject } from '../lean/project.js';
import { startBackground, startDetached } from '../lib/background.js';
import { sessionRole } from '../lib/role.js';
import { projectConfig } from '../watcher/main.js';
import { CLAUDE_CODE_FLOOR } from '../lib/build-loop.js';
import { readProject } from '../lib/projects.js';
import { ensureIgnored } from '../feature/files.js';
import { run as runProgram } from '../lib/run.js';
import {
  LOW_NODE_SCRIPT, guardedReady, lowNodeReady, needsSelfTest, selfTest, SELF_TEST_MS,
} from '../windows/low.js';
import { checkLineage, holdEvent, markRecorded, recordLift, warningLines, writeProvenance } from '../lineage/check.js';
import { claudeCodeOf } from '../lineage/provenance.js';
import { MARKETPLACE } from '../lineage/manifest.js';
import { makeSigningKey, ownKey, readEnrolled, enrol } from '../state/signing.js';
import { SETUP_STEPS, firstUnfinished, journalTrouble, stepDone } from '../lib/setup-run.js';
import { composeCard } from '../cards/compose.js';
import { TAKEOVER_LABEL, LEAVE_LABEL } from '../state/card-lines.js';
import { agentOfInput } from '../agents/of-input.js';
import { readAllowance } from '../usage/figures.js';
import { weeklyOf } from '../routing/nudge.js';
import { usageOffer } from '../routing/offer.js';
import { columnsReadyOf } from '../routing/in-force.js';
import { TOOL_SHEETS } from '../agents/tool-sheets.js';
import { frontDeskCommand, knowsNoSystemCa } from '../protection/settings.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { helperGrace } from '../lib/helper-grace.js';
import { MAIN_MOVED } from '../lean/store.js';
import { keepRunningModel, modelOfInput } from '../lib/front-desk-model.js';

const SELF = fileURLToPath(import.meta.url);
// The script that brings this computer's settings for a project up to date, run detached.
const LOCAL_REFRESH_SCRIPT = path.join('scripts', 'setup', 'local-refresh.js');
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TOTAL_MS = 8000;
export const START_WAIT_MS = 5000;
export const MAX_CHARS = 9000;
export const MAX_ENTRIES = 20;
const LINE_CHARS = 200;

export const NO_HELPER = 'The host helper isn\'t running, so nothing can be pushed or merged';
export const NO_LOCK = 'The lock couldn\'t be taken this time, so pushes and merges are refused until a later session start takes it';
export const heldElsewhere = (holder, since) => `Another computer (${oneLine(holder)}) holds this project's lock, last written ${oneLine(since)}, so pushes and merges from this computer are refused`;
export const NO_USAGE = 'Usage counts couldn\'t start this time';
// In the project's main folder, for any session that isn't the foreman's: the front desk's playbook.
export const FRONT_DESK_LINE = 'This is the front desk. Load wheelhouse:front-desk before you write anything, and never announce a skill: the director sees every line.';

// In a folder being set up: where setup stands, and that setup comes before whatever the director's
// message asks, which is kept for the front desk (SETUP_FIRST). board-context.js says it again with
// each prompt while setup is unfinished, so a long first message can't win over this line.
export const SETUP_FIRST = 'Setup comes first, whatever the director\'s message asks: if setup isn\'t already under way in this conversation, say in one plain line that you\'ll set Wheelhouse up first and keep their request for afterwards, then follow wheelhouse:setup. Keep their request as they wrote it, and do no work on it until setup is done.';
export const NOT_SET_UP = `This folder isn't set up for Wheelhouse yet. ${SETUP_FIRST}`;
export const partWay = (n, title) => `Setup is part-way through: step ${n}, ${title}, is next. ${SETUP_FIRST}`;
export const JOURNAL_UNREADABLE = 'Setup\'s journal couldn\'t be read, so where setup stands isn\'t known. Follow wheelhouse:setup.';
// The plugin as setup's step 1 switches it on for the project (its enabledPlugins key), and the line
// that says how it is removed, which is the director's to do in Claude Desktop.
export const PLUGIN_KEY = `wheelhouse@${MARKETPLACE}`;
export const REMOVE_PLUGIN = `remove the Wheelhouse plugin (${PLUGIN_KEY}) from this project in Claude Desktop`;
// In a folder Wheelhouse was removed from (ruling R89): not "isn't set up yet".
export const REMOVED = `Wheelhouse was removed from this folder. What is left is the director's: ${REMOVE_PLUGIN}. To set it up here again, follow wheelhouse:setup.`;
// In a project's front desk, when setup's journal can't be read, whether setup has finished isn't
// known, so the foreman is held back (ruling R72): a journal a newer Wheelhouse wrote, or anything else.
export const FOREMAN_HELD_NEWER = 'The foreman is held back because setup\'s journal couldn\'t be read: a newer Wheelhouse wrote it. Tell the director to update Wheelhouse.';
export const FOREMAN_HELD_UNREADABLE = 'The foreman is held back because setup\'s journal couldn\'t be read. Tell the director, and follow wheelhouse:setup to look at it.';

// hooks.json's `onFailure: "block"` makes a guard that fails (crashes, times out) stop the
// tool call, which Claude Code reads from 2.1.295; the mod's files load from CLAUDE_CODE_FLOOR
// (check 40). Older than the floor, the mod doesn't load and a guard that fails may let the call through.
export const GUARD_FLOOR = CLAUDE_CODE_FLOOR.split('.').map(Number);
export const OLD_CLAUDE_CODE = `This Claude Code is older than ${CLAUDE_CODE_FLOOR}, so Wheelhouse's mod doesn't load and a guard that fails may not stop a tool call: update Claude Code`;

// Each agent's tool sheet, from scripts/agents/tool-sheets.js: the adapters' registry
// (scripts/agents/index.js) reaches the setup and evaluation code, which a hook must not load, so the
// sheets come from a file that imports only each adapter's tool-sheet module. An agent with no entry
// there is given no sheet.
export { TOOL_SHEETS };

// The lines that tell a session its agent's tools and where the Wheelhouse command is: the agent's
// tool sheet, then the command line (the front desk's command, which the playbooks' other scripts
// are named from). The command line carries --no-use-system-ca when this Node.js knows it, so the sandbox's certificate
// lines don't fill the output. It is left out when the plugin's folder can't be typed as a command.
export function toolSheetLines(agent, { pluginRoot, platform = process.platform, allowedFlags = process.allowedNodeEnvironmentFlags } = {}) {
  const lines = Object.hasOwn(TOOL_SHEETS, agent) && TOOL_SHEETS[agent] !== '' ? TOOL_SHEETS[agent].split('\n') : [];
  const command = frontDeskCommand(pluginRoot, { platform, noSystemCa: knowsNoSystemCa(allowedFlags) });
  if (command !== null) lines.push(`The Wheelhouse command is ${command}`);
  return lines;
}

// The folder the Wheelhouse command is named from: the plugin's own folder, which the allow rules written at
// setup name. In a Locked project this hook is the managed copy, whose folder is not the plugin's, so the
// plugin folder recorded when Locked was installed is used (kit.js's pluginRoots); with no record, the hook's own.
function commandRoot({ dir, self = SELF } = {}, pluginRoot) {
  return pluginRoots(dir, self, pluginRoot).at(-1);
}

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

// The views as the helper last wrote them on disk, when it cannot give them.
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

// The views the session start reads when the helper can't give them: those the helper last left on
// disk, with the settings and the unconfirmed changes built from the local events, as the waker
// reads them, so the level shown is the one the waker acts on. Events that can't be read leave
// the views on disk as they are.
function fallbackViews(project) {
  const views = localViews(project);
  let built = null;
  try {
    built = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled(), { lean: isLeanProject(project) });
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
    const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'host', 'helper-main.js')], { cwd: jobFolder(), detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ...caEnv(home) } });
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
function lineageCheck(found, input, version, { check, root, claudeHome, now, pinsPending = false }) {
  try {
    const folder = found.record?.folder ?? readProject(found.project)?.folder;
    const result = check({ project: found.project, projectDir: folder, root, claudeHome, now, pinsPending });
    recordHold(found.project, result, now);
    try {
      writeProvenance({
        project: found.project, sessionId: input.session_id, root, upstreams: result.upstreams, ok: result.ok && !(result.pending?.length > 0),
        claudeCode: version === null ? null : version.join('.'), transcript: input.transcript_path,
      });
    } catch { /* the session carries on without it */ }
    return result.ok ? [] : warningLines(result.mismatches, { kept: result.kept !== false });
  } catch {
    return [];
  }
}

// In a Shape 1 project, starts the watcher when it isn't running, as the
// foreman's start script does (ruling R62), once setup has finished there (R44). A watcher found running needs no
// configuration asked for. It informs, so anything that goes wrong is passed over.
// The lock (design section 9, "One computer at a time"): which computer holds the front desk and foreman, and the fencing counter the
// merge gate and every code push check. Kept where this computer holds it already (a touch, which leaves the
// counter as it is), else taken, which a free lock, a stale one or this computer's own allows. Null when this
// computer holds it after; else the line that says why not. Nothing else takes it in real use.
async function keepLock(project, client, left, seen = {}) {
  if (typeof client?.lock?.take !== 'function') return null;
  const touched = typeof client.lock.touch === 'function' ? await left(client.lock.touch({ project })) : null;
  if (touched?.ok === true && touched.result?.touched === true) return null;
  const took = await left(client.lock.take({ project }));
  if (took?.ok === true && took.result?.taken === true) return null;
  if (took?.ok === true && took.result?.taken === false) seen.holder = took.result.holder;
  if (took?.ok === true && took.result?.taken === false) return heldElsewhere(took.result.holder ?? 'unknown', took.result.since ?? 'at an unknown time');
  return NO_LOCK;
}

// The words before the take-over card's AskUserQuestion input, as JSON on the same line.
export const TAKEOVER_ASK = 'Another computer holds the front desk: show the director the board as it stands, read-only, and ask them this card with AskUserQuestion, exactly as given, as a question of its own: ';
// Within this long since the other computer last wrote, it counts as in use. (A lock idle two hours is taken at once.)
const RECENT_MS = 30 * 60 * 1000;
const agoWords = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${rest === 0 ? '' : ` ${rest} ${rest === 1 ? 'minute' : 'minutes'}`} ago`;
};

// The Take over here card for a lock another computer holds (design section 9), naming the lock as it stands now, read
// from the helper. No card when the lock can't be read, is this computer's, or is held by something that isn't a
// computer's id. It informs, so anything that fails gives no line.
async function takeOverNotes({ client, left, project, now }) {
  try {
    if (typeof client?.lock?.read !== 'function') return [];
    const got = await left(client.lock.read({ project }));
    const lock = got?.ok === true ? got.result : null;
    if (!lock || lock.computer === computerId() || !/^[0-9a-f]{8}$/.test(String(lock.computer)) || !Number.isInteger(lock.counter) || lock.counter < 1) return [];
    const idle = now().getTime() - Date.parse(lock.lastWriteAt);
    if (!Number.isFinite(idle)) return [];
    const ago = agoWords(idle);
    const inUse = idle < RECENT_MS;
    const { question } = composeCard({
      kind: 'take-over',
      level: 3,
      what: `Your computer ${lock.computer} has the front desk, and last wrote ${ago}; this computer can only look at the board until you take over.`,
      why: 'Only one computer runs the work at a time, so two never merge or push over each other.',
      options: [
        { label: TAKEOVER_LABEL, says: `This computer runs the work from now on, and computer ${lock.computer} can no longer merge or push code.` },
        { label: LEAVE_LABEL, says: `Computer ${lock.computer} keeps the work, and this one only shows the board.` },
      ],
      recommend: inUse ? LEAVE_LABEL : TAKEOVER_LABEL,
      because: inUse ? `computer ${lock.computer} was in use ${ago}` : `nothing has been written on computer ${lock.computer} since ${ago}`,
      meanwhile: 'This computer shows the board and changes nothing; its merges and pushes are refused.',
      target: { holder: lock.computer, counter: lock.counter },
    });
    return [`${TAKEOVER_ASK}${JSON.stringify(question)}`];
  } catch {
    return [];
  }
}

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
// never takes them. `sheet` (toolSheetLines) comes after the front desk's line and before the notes and the lists, so
// a cut takes the briefing and never the tool sheet.
export function reload({ views, stop, lineage = [], notes, feature, stateRoot, windows, builds, frontDesk = false, sheet = [] }) {
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
  lines.push(...sheet);
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

// The line for an import that brought records in: how many events, that nothing was deleted, and how
// many signed records were left out because their signature couldn't be checked against this
// computer's trusted keys.
export function importedLine({ imported, unsigned = 0, what = 'this project\'s records' }) {
  const events = `${imported} event${imported === 1 ? '' : 's'}`;
  const line = `Wheelhouse moved ${what} to this computer: ${events}. Nothing was deleted; the old copies stay until you choose.`;
  if (!(unsigned > 0)) return line;
  return `${line} ${unsigned} signed record${unsigned === 1 ? '' : 's'} couldn't be checked and ${unsigned === 1 ? 'was' : 'were'} left out.`;
}

// Said once when the import from v0.1.x failed: why, and that nothing old was lost.
export function importFailedLine({ why, what = 'this project\'s records' }) {
  return `Wheelhouse couldn't move ${what} to this computer: ${oneLine(why)}. Nothing was deleted; the old copy stays as it was, and Wheelhouse carries on without it.`;
}

// Asks the helper for each import (`asks`, each a function returning the helper's answer) within the
// budget, and gives the line for what this start imported: an answer counts only when it says the
// import ran now (`done: false`) and brought something in. It informs, so anything that fails
// gives no line.
async function importNotes(asks, { left, what }) {
  let imported = 0;
  let unsigned = 0;
  const failed = [];
  for (const ask of asks) {
    try {
      const got = await left(Promise.resolve().then(ask));
      if (got?.ok === true && got.done === false && typeof got.failed === 'string') failed.push(importFailedLine({ why: got.failed, ...(what ? { what } : {}) }));
      if (got?.ok !== true || got.done !== false || !(got.imported > 0)) continue;
      imported += got.imported;
      if (got.unsigned > 0) unsigned += got.unsigned;
    } catch { /* it informs */ }
  }
  return [...(imported > 0 ? [importedLine({ imported, unsigned, ...(what ? { what } : {}) })] : []), ...failed];
}

// The usage card for this week's allowance, if one is due (design section 14.6): its line for the front desk, and
// the offer kept as a usage-card record, so the same card isn't offered again. The reading is the weekly file's, which
// costs no reasoning; the mark is the director's own, from their profile. It informs, so a failure gives no line.
// The record is signed with this computer's key and sent through /state/record, so no session can write an offer. The
// card is handed out only once the helper has taken it: the click on its switch counts only for a signed offer the
// state holds (the prompt record), so a record not taken is not kept either, and the card is offered later.
async function usageNotes({ client, left, up, project, views, now, allowance = () => weeklyOf(readAllowance()), timeZone, ready = columnsReadyOf }) {
  try {
    const reading = allowance();
    if (reading === null || reading === undefined) return [];
    let profile = {};
    if (up && typeof client?.profile?.views === 'function') {
      const got = await left(client.profile.views({}));
      if (got?.ok === true && got.views?.settings && typeof got.views.settings === 'object') profile = got.views.settings;
    }
    const offer = usageOffer({ views, profile, allowance: reading, ready: ready({ project }), now, timeZone });
    if (offer === null) return [];
    // Written at once, so a second session start doesn't offer it again.
    const body = { project, event: makeEvent({ kind: 'usage-card', data: offer.record, now }) };
    const wrote = up && typeof client?.state?.record === 'function' ? await left(client.state.record(body)) : null;
    return wrote?.ok === true ? [offer.line] : [];
  } catch {
    return [];
  }
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
async function setupStart(input, setup, { given, spawn, pluginRoot, root, platform, startWaitMs, totalMs, pause, stopOf, now }) {
  firstKey(now);
  const end = Date.now() + totalMs;
  const lines = [];
  const stop = stopOf();
  if (stop?.on) lines.push(`STOP is on (set by ${oneLine(stop.by ?? 'unknown')} at ${oneLine(stop.at ?? 'an unknown time')})`);
  const version = claudeCodeVersion(input.transcript_path);
  if (version !== null && olderThan(version, GUARD_FLOOR)) lines.push(OLD_CLAUDE_CODE);
  const up = await ensureHelper(given ?? helperClient({ timeout: Math.min(3000 + helperGrace(), totalMs) }), { spawn, pluginRoot, waitMs: startWaitMs, pause, end });
  if (!up) lines.push(NO_HELPER);
  // The setup playbook runs the Wheelhouse command, so a folder being set up is told where it is.
  lines.push(...toolSheetLines(agentOfInput(input) ?? 'claude-code', { pluginRoot: root, platform }));
  const note = setupNote(setup);
  if (note !== null) lines.push(note);
  // Once step 3 is done, v0.1.x's profile clone, when there is one, is imported into the settings.
  if (up && setup.run !== null && setup.run !== undefined && stepDone(setup.run, 3)) {
    const client = given ?? helperClient({ timeout: Math.max(1, end - Date.now()) });
    const asks = typeof client?.profile?.import === 'function' ? [() => client.profile.import({})] : [];
    lines.push(...await importNotes(asks, { left: withinBudget(end), what: 'your settings' }));
  }
  return lines.length === 0 ? undefined : answer.context('SessionStart', lines.join('\n'));
}

// In the project's main folder, `.wheelhouse/` in the main checkout's local exclusions, as the
// foreman keeps it (ensureIgnored), so the front desk's input file (FRONT_DESK_INPUT) never shows
// to git, even before the foreman first wakes (ruling F87). Best effort: a failure says nothing.
function keepOutOfGit(found) {
  try {
    const folder = found.record?.folder ?? readProject(found.project)?.folder;
    if (typeof folder === 'string') ensureIgnored(folder, { mainCheckout: folder });
  } catch { /* the session carries on without it */ }
}

// The line naming the Lean command, the chat's way to the helper at Lean (scripts/lean/cli.js).
export function leanCommandLine(root, { node = process.execPath } = {}) {
  return `The Lean command is "${node}" "${root}/scripts/lean/cli.js"`;
}

// The session start on an agent whose hooks only read (`writeVia: 'helper'`, ruling P5-20). It writes nothing
// under the Wheelhouse home and never opens the keys folder: no managed marker, no helper started, no watcher,
// no usage receiver, no lineage hold, no key made, no records sent. It answers with the briefing from the
// helper's views (the views on disk when the helper isn't answering, with NO_HELPER_STOP), the agent's tool sheet
// and, in a Lean project, the Lean command line. `helperUp` is the hook's own ask of /health, when it made one.
async function readOnlyStart(input, { dir, find, client, helperUp, agent, pluginRoot, self, platform, stopOf, totalMs }) {
  const root = commandRoot({ dir, self }, pluginRoot);
  const sheet = (lean) => [...toolSheetLines(agent, { pluginRoot: root, platform }), ...(lean ? [leanCommandLine(root)] : [])];
  const end = Date.now() + totalMs;
  const left = withinBudget(end);
  const api = client ?? helperClient({ timeout: Math.min(3000 + helperGrace(), totalMs) });
  const up = helperUp ?? (await left(api.health()))?.ok === true;
  const found = find(input.cwd, { dir });
  if (!found) {
    const setup = beingSetUp(input.cwd);
    if (setup === null) return undefined;
    const stop = stopOf();
    const lines = [];
    if (stop?.on) lines.push(`STOP is on (set by ${oneLine(stop.by ?? 'unknown')} at ${oneLine(stop.at ?? 'an unknown time')})`);
    if (!up) lines.push(NO_HELPER_STOP);
    lines.push(...sheet(false));
    const note = setupNote(setup);
    if (note !== null) lines.push(note);
    return lines.length === 0 ? undefined : answer.context('SessionStart', lines.join('\n'));
  }
  const { project } = found;
  const notes = [];
  let views = null;
  if (!up) notes.push(NO_HELPER_STOP);
  else {
    // A Lean project's main version, compared by the helper with the one it last moved (ruling P5-27 f): a move
    // made outside it is said here, and the helper raises the card that asks the director.
    if (found.lean === true && typeof api.lean?.status === 'function') {
      const status = await left(api.lean.status({ project }));
      if (status?.ok === true && status.moved === true) notes.push(MAIN_MOVED);
    }
    // The helper keeps or takes the lock: a request, so this start still writes nothing itself.
    const lockLine = await keepLock(project, api, left);
    if (lockLine !== null) notes.push(lockLine);
    const got = await left(api.state.views({ project }));
    if (got?.ok === true && got.views && typeof got.views === 'object') views = got.views;
  }
  views ??= localViews(project);
  const text = reload({ views, stop: stopOf(), notes, feature: featureSlug(input.cwd), stateRoot: stateDir(project), sheet: sheet(found.lean === true) });
  return text === '' ? undefined : answer.context('SessionStart', text);
}

// The session's title, by its role (the director's call, 27 October 2026): shown in Claude Code's session
// lists in place of a generic one, so the director can tell the sessions on a project apart. Given only
// when the session starts afresh (`source` "startup"), so a name the director gives a session survives
// its resumes; null outside a Wheelhouse project, and for an agent whose hooks only read.
export const TITLES = Object.freeze({
  firstMate: 'Wheelhouse · First Mate',
  setup: 'Wheelhouse · Setup',
  bosun: 'Wheelhouse · Bosun',
});
export const crewTitle = (feature) => `Wheelhouse · Crew: ${oneLine(feature)}`;
export function sessionTitle(input, { dir, projectOf: find = projectOf, env = process.env } = {}) {
  if (input?.source !== 'startup') return null;
  const found = find(input.cwd, { dir });
  const setup = beingSetUp(input.cwd);
  if (!found) return setup === null ? null : TITLES.setup;
  const role = sessionRole({ sessionId: input.session_id, env, cwd: input.cwd });
  if (role === 'foreman') return TITLES.bosun;
  const feature = featureSlug(input.cwd);
  if (feature !== null) return crewTitle(feature);
  return setup === null ? TITLES.firstMate : TITLES.setup;
}

export async function decide(input, deps = {}) {
  const out = await started(input, deps);
  if (deps.writeVia !== undefined && deps.writeVia !== 'self') return out;
  let title = null;
  try {
    title = sessionTitle(input, deps);
  } catch { /* the session keeps Claude Code's own title */ }
  if (title === null) return out;
  const output = out?.hookSpecificOutput ?? { hookEventName: 'SessionStart' };
  return { ...out, hookSpecificOutput: { ...output, sessionTitle: title } };
}

async function started(input, deps) {
  if (deps.writeVia !== undefined && deps.writeVia !== 'self') {
    const { dir, projectOf: find = projectOf, client, helperUp, agent, pluginRoot = PLUGIN_ROOT, self = SELF, platform = process.platform, stopState: stopOf = stopState, totalMs = TOTAL_MS + helperGrace() } = deps;
    return readOnlyStart(input, { dir, find, client, helperUp, agent: agent ?? agentOfInput(input) ?? 'claude-code', pluginRoot, self, platform, stopOf, totalMs });
  }
  const {
    dir, projectOf: find = projectOf, client: given, spawn = nodeSpawn,
    platform = process.platform, now = () => new Date(), stopState: stopOf = stopState,
    self = SELF, pluginRoot = PLUGIN_ROOT, startWaitMs = START_WAIT_MS + helperGrace(), totalMs = TOTAL_MS + helperGrace(), pause = sleep,
    background = startBackground, lineage: check = checkLineage, lineageRoot, claudeHome, env = process.env,
    guardedSelfTest = selfTest, run = runProgram, lowNodeReady: copyReady = lowNodeReady,
  } = deps;
  // Brings this computer's settings for the project up to date, as a process of its own.
  const refreshLocal = deps.refreshLocal ?? ((folder) => startDetached(spawn, path.join(pluginRoot, LOCAL_REFRESH_SCRIPT), [folder]));
  // Makes the copy of Node.js the Guarded runner starts from, detached, outside this budget.
  const startLowNodeCopy = deps.startLowNodeCopy ?? (() => startDetached(spawn, path.join(pluginRoot, LOW_NODE_SCRIPT)));
  const found = find(input.cwd, { dir });
  if (!found) {
    const setup = beingSetUp(input.cwd);
    if (setup !== null) return setupStart(input, setup, { given, spawn, pluginRoot, root: commandRoot({ dir, self }, pluginRoot), platform, startWaitMs, totalMs, pause, stopOf, now });
    if (removedFrom(input.cwd) === null) return undefined;
    // Setting up again follows the setup playbook, which runs the Wheelhouse command.
    return answer.context('SessionStart', [REMOVED, ...toolSheetLines(agentOfInput(input) ?? 'claude-code', { pluginRoot: commandRoot({ dir, self }, pluginRoot), platform })].join('\n'));
  }
  const { project, locked } = found;
  markManaged(project, input.session_id, { self, dir: dir ?? managedDir(), now });
  const end = Date.now() + totalMs;
  const left = withinBudget(end);
  const notes = [];
  // Whether setup is still finishing here, read once: it holds back the watcher and adds its note.
  const setup = beingSetUp(input.cwd);
  // Why setup's journal can't be read, when it can't, in a folder not being set up (beingSetUp
  // counts such a folder as the project it is): it holds back the watcher and adds its note.
  const trouble = setup === null ? journalTrouble() : null;
  // Each call may take no longer than the budget that is left.
  const clientNow = () => given ?? helperClient({ timeout: Math.max(1, end - Date.now()) });

  // This computer's settings for the project, once setup's step 7 has written them, as step 7 would write them now:
  // after an update, the allow rules for the Wheelhouse command name the new version's folder, and those for the
  // old one go (scripts/setup/local-refresh.js), in a process of its own: the mod's bridge imports this file, and
  // nothing it imports may reach what writes Claude Code's settings. Not while setup's journal can't be read, nor
  // in a Lean project, which setup's step 7 never wrote. It informs: a failure leaves the file as it was.
  if (trouble === null && found.lean !== true && (setup === null || stepDone(setup.run, 7)) && typeof found.record?.folder === 'string') {
    try {
      refreshLocal(found.record.folder);
    } catch { /* left as it was */ }
  }
  const version = claudeCodeVersion(input.transcript_path);
  if (version !== null && olderThan(version, GUARD_FLOOR)) notes.push(OLD_CLAUDE_CODE);
  // While this folder's setup run is open and has not yet installed the kits (step 7), kits not
  // installed are setup's own state, not drift, and write no hold (ruling R136).
  const pinsPending = setup?.run != null && !stepDone(setup.run, 7);
  // A compaction installs nothing, so the check belongs to the session's real start: no check,
  // the hold file neither written nor removed (a lift may still be recorded, elsewhere, for a hold
  // whose file is gone), no provenance rewritten, and a hold already standing stands.
  const lineage = input.source === 'compact' ? [] : lineageCheck(found, input, version, { check, root: lineageRoot, claudeHome, now, pinsPending });
  const up = await ensureHelper(given ?? helperClient({ timeout: Math.min(3000 + helperGrace(), totalMs) }), { spawn, pluginRoot, waitMs: startWaitMs, pause, end });
  // Records what this session is for and starts the usage receiver, alongside the import below.
  const usage = Promise.resolve().then(() => background({ pluginRoot, session: input.session_id, cwd: input.cwd, project, spawn, now })).catch(() => null);
  let views = null;
  const lockSeen = {};
  if (!up) notes.push(NO_HELPER);
  else {
    const mine = ownVersion(pluginRoot);
    if (typeof up.version === 'string' && mine !== null && up.version !== mine) {
      notes.push(`The helper running is version ${oneLine(up.version)}; this copy is version ${mine}`);
    }
    await left(sendPending(project, clientNow(), { until: end }));
    // v0.1.x's records, imported once, before the views are read so the briefing holds them.
    if (setup === null || stepDone(setup.run, 3)) {
      const api = clientNow();
      const asks = [
        ...(typeof api?.state?.import === 'function' ? [() => clientNow().state.import({ project })] : []),
        ...(typeof api?.profile?.import === 'function' ? [() => clientNow().profile.import({})] : []),
      ];
      notes.push(...await importNotes(asks, { left }));
    }
    const lockLine = await keepLock(project, clientNow(), left, lockSeen);
    if (lockLine !== null) notes.push(lockLine);
    const got = await left(clientNow().state.views({ project }));
    if (got?.ok === true && got.views && typeof got.views === 'object') views = got.views;
    // Starting the foreman is the last thing setup does, once its health check's board is green
    // (rulings R44, R67, scripts/setup/health.js): not while setup is finishing in this project,
    // which it is until that board has been green, nor while setup's journal can't be read, when
    // whether it has finished isn't known (beingSetUp counts such a folder as the project it is,
    // so the rest of the session start goes on as in any project, and a line says why: R72).
    if (setup === null && trouble === null) await left(ensureWatcher(project, clientNow(), { spawn, pluginRoot }));
  }
  views ??= fallbackViews(project);
  // A hold whose file is gone (a matching check, or a compaction that finds it removed) has its card
  // closed by one lift.
  try {
    const lineageHolds = views.lineageHolds ?? localViews(project, ['lineageHolds'])?.lineageHolds;
    await left(recordLift({ project, views: { lineageHolds }, computer: computerId(), now, client: clientNow(), left }));
  } catch { /* it informs */ }
  if ((await left(usage))?.receiver === 'failed') notes.push(NO_USAGE);

  const setupLine = setup === null ? null : setupNote(setup);
  if (setupLine !== null) notes.push(setupLine);
  // The front desk's session: not a feature's, nor the foreman's own. Only it is told why the
  // foreman is held back, as it is the session that speaks to the director.
  const deskSession = featureSlug(input.cwd) === null && sessionRole({ sessionId: input.session_id, env, cwd: input.cwd }) === 'front-desk';
  if (trouble !== null && deskSession) notes.push(trouble === 'newer' ? FOREMAN_HELD_NEWER : FOREMAN_HELD_UNREADABLE);

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
  // The card that offers the lock, when another computer holds it, goes to the front desk only.
  if (deskSession && lockSeen.holder !== undefined) notes.push(...await takeOverNotes({ client: clientNow(), left, project, now }));
  // The usage card comes last, with whatever time is left; only the front desk's.
  if (deskSession && setupLine === null) notes.push(...await usageNotes({ client: clientNow(), left, up: Boolean(up), project, views, now, allowance: deps.allowance, timeZone: deps.timeZone, ...(deps.columnsReady ? { ready: deps.columnsReady } : {}) }));
  const windows = platform === 'win32' && firstForSession(project, input.session_id, now);
  // Anything that fails here, the computer's id included, shows Ask and leaves the rest of the
  // reload as it is.
  let builds = 'ask';
  if (windows) {
    try {
      builds = buildsShown({ views, computer: computerId(), locked, guardedReady: ready }).level;
    } catch { /* shown as Ask */ }
  }
  const frontDesk = setupLine === null && deskSession;
  if (frontDesk) keepOutOfGit(found);
  // The model the front desk's session runs on, for the board's line when it isn't the pin (design
  // section 8). It informs, so a failure is passed over.
  const model = deskSession ? modelOfInput(input) : null;
  if (model !== null) {
    try {
      keepRunningModel(project, model, { now });
    } catch { /* it informs */ }
  }
  const text = reload({
    views, stop: stopOf(), lineage, notes, feature: featureSlug(input.cwd), stateRoot, windows, builds, frontDesk,
    sheet: toolSheetLines(agentOfInput(input) ?? 'claude-code', { pluginRoot: commandRoot({ dir, self }, pluginRoot), platform }),
  });
  return text === '' ? undefined : answer.context('SessionStart', text);
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'SessionStart' });
}
