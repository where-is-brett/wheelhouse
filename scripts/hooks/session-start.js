// scripts/hooks/session-start.js
// At the start of every session in a Wheelhouse project: starts the host helper
// when it is not answering, sends any records a hook kept, syncs the state,
// starts the watcher when the project's shape is 1 and it isn't running
// (ruling R62), and adds a short reload as context. The reload names things;
// it never pastes whole files (design section 19.1, point 5).
//
// Limits. The hook has ten seconds (hooks.json); it keeps to eight: at most
// five of them waiting for the helper to start, the rest for the records, the
// sync, the views and the watcher, which is last and gets what is left. Context added by a hook is capped at 10,000 characters
// (https://code.claude.com/docs/en/hooks, read 18 October 2026), so the reload
// stays under 9,000 and each list shows at most 20 entries.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { answer, runAndExit, projectOf, isInside, managedDir, managedMarker, readTailEntries } from './kit.js';
import { sendPending, withinBudget } from './pending.js';
import { startWatcher, watcherRunning } from '../foreman/start.js';
import { helperClient } from '../host/helper-client.js';
import { stopState } from '../lib/stop.js';
import { wheelhouseHome, stateDir } from '../lib/paths.js';
import { WINDOWS_LINE } from '../lib/platform-lines.js';
import { projectConfig } from '../watcher/main.js';

const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TOTAL_MS = 8000;
export const START_WAIT_MS = 5000;
export const MAX_CHARS = 9000;
export const MAX_ENTRIES = 20;
const LINE_CHARS = 200;

export const NO_HELPER = 'The host helper isn\'t running, so nothing can be pushed or merged';
export const NOT_SYNCED = 'State was not synced with the host this time';

// hooks.json's `onFailure: "block"` makes a guard that fails (crashes, times out) stop the
// tool call. Claude Code reads that field from 2.1.295; an older one lets the call through.
export const GUARD_FLOOR = [2, 1, 295];
export const OLD_CLAUDE_CODE = 'This Claude Code is older than 2.1.295, so a guard that fails does not stop a tool call: update Claude Code';

// Claude Code's version as the newest transcript entry that carries one gives it, as three
// numbers, or null when it is not known.
export function claudeCodeVersion(transcriptPath) {
  const entries = readTailEntries(transcriptPath) ?? [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const version = entries[i]?.version;
    if (typeof version !== 'string') continue;
    const m = /^(\d+)\.(\d+)\.(\d+)(?![0-9])/.exec(version);
    return m ? m.slice(1, 4).map(Number) : null;
  }
  return null;
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

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

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
// after a crash), so that folder is read when `views` is not there.
function localViews(project) {
  const base = path.join(wheelhouseHome(), 'projects', project, 'views');
  const dir = fs.existsSync(base) ? base : `${base}.old`;
  const out = {};
  for (const name of ['rulebook', 'levels', 'waiting', 'unconfirmed', 'damaged']) {
    try {
      out[name] = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    } catch { /* missing */ }
  }
  return Object.keys(out).length > 0 ? out : null;
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

export function reload({ views, stop, notes, feature, stateRoot, windows }) {
  const lines = [];
  if (stop?.on) lines.push(`STOP is on (set by ${oneLine(stop.by ?? 'unknown')} at ${oneLine(stop.at ?? 'an unknown time')})`);
  const damaged = Array.isArray(views?.damaged) ? views.damaged.map((d) => (typeof d === 'string' ? d : JSON.stringify(d))) : [];
  lines.push(...section('Damaged state:', damaged));
  lines.push(...notes);
  const title = (d) => show(d?.title ?? d?.question ?? d?.words ?? d?.value ?? '');
  const unconfirmed = (views?.unconfirmed ?? []).map((u) => `${u.id} (${u.kind}${u.key ? ` ${u.key}` : ''}): ${title(u.data)}`);
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
  if (windows) lines.push(WINDOWS_LINE);
  let text = lines.join('\n');
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS - 1)}…`;
  return text;
}

export async function decide(input, deps = {}) {
  const {
    dir, projectOf: find = projectOf, client: given, spawn = nodeSpawn,
    platform = process.platform, now = () => new Date(), stopState: stopOf = stopState,
    self = SELF, pluginRoot = PLUGIN_ROOT, startWaitMs = START_WAIT_MS, totalMs = TOTAL_MS, pause = sleep,
  } = deps;
  const found = find(input.cwd, { dir });
  if (!found) return undefined;
  const { project } = found;
  markManaged(project, input.session_id, { self, dir: dir ?? managedDir(), now });
  const end = Date.now() + totalMs;
  const left = withinBudget(end);
  const notes = [];
  // Each call may take no longer than the budget that is left.
  const clientNow = () => given ?? helperClient({ timeout: Math.max(1, end - Date.now()) });

  const version = claudeCodeVersion(input.transcript_path);
  if (version !== null && olderThan(version, GUARD_FLOOR)) notes.push(OLD_CLAUDE_CODE);
  const up = await ensureHelper(given ?? helperClient({ timeout: Math.min(3000, totalMs) }), { spawn, pluginRoot, waitMs: startWaitMs, pause, end });
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
  views ??= localViews(project);

  const stateRoot = stateDir(project);
  const text = reload({
    views, stop: stopOf(), notes, feature: featureSlug(input.cwd), stateRoot,
    windows: platform === 'win32' && firstForSession(project, input.session_id, now),
  });
  return text === '' ? undefined : answer.context('SessionStart', text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAndExit(decide, { failClosed: false, event: 'SessionStart' });
}
