// scripts/update/finish.js
// The second half of an update, run from the new version's own code:
//   node <new folder>/scripts/update/finish.js <project>
// (design 2026-11-04-update-command-design.md, sections 6.5 to 6.9 and 7). In order: the refreshes the new release
// brings, the own-files record, the helper hand-over, the watcher, and the last line. Every process, helper, clock and
// refresh is a seam, so a test never touches a real one. Nothing is ended by its name; an old helper is stopped only
// through part 4's proofs and only after the director's answer to a card.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caEnv } from '../host/company-ca.js';
import { helperClient } from '../host/helper-client.js';
import { readHelperRecord } from '../host/helper-record.js';
import { MARKETPLACE, claudeHome as defaultClaudeHome } from '../lineage/manifest.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { compareVersions } from '../lib/versions.js';
import { computerId, helperAddress, jobFolder, stateDir, wheelhouseHome } from '../lib/paths.js';
import { registeredProjects } from '../lib/projects.js';
import { run as defaultRun } from '../lib/run.js';
import { fileHash, recordUpdate } from '../health/own-files.js';
import {
  RESTART_LINE, defaultCacheRoot, findByAddress, pidAlive, proveRecorded, reprove, stopProved, waitForQuiet,
} from './old-helper.js';
import { planNamedAddon, removeAddon } from './addon.js';
import { parkedAgentOfProject } from '../agents/names.js';
import { openJournal, updateLockHeld } from './journal.js';
import { raiseParked } from './parked.js';
import { statusLineStep } from './status-line.js';
import { verify, readEnrolled } from '../state/signing.js';
import { listEvents } from '../state/events.js';
import { startWatcher, stopWatcher, watcherRunning } from '../foreman/start.js';
import { processStartTime } from '../watcher/waker.js';
import { projectConfig } from '../watcher/main.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const STOP_IT = 'Stop it';
export const LEAVE_IT = 'Leave it';
export const WAIT_LONGER = 'Wait longer';
// How long an old helper is given to close, and how often a v0.2.5 or v0.2.6 helper that refuses as busy is asked again.
export const CLOSE_MS = 2 * 60 * 1000;
export const SLOW_AFTER_MS = 20 * 1000;
export const ASK_AGAIN_MS = 10 * 1000;
export const NEW_HELPER_MS = 20 * 1000;
export const WAITING_LINE = 'Waiting for the old helper to finish what it\'s doing';
export const ASKING_LINE = 'Waiting for your answer about the old helper.';
export const NOT_RUNNING_LINE = 'The new helper did not answer yet. It starts with the next session.';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

const progressFile = (journal) => path.join(journal.folder, 'finish.json');
const readProgress = (journal) => {
  const found = readJson(progressFile(journal));
  return isObject(found) ? { refreshed: {}, wrote: [], ...found } : { refreshed: {}, wrote: [] };
};

// Whether `newRoot` is the plugin cache folder of the release `tag`, by real paths.
export function rootIsCacheFor({ newRoot, claudeHome, tag }) {
  try {
    const version = String(tag).replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) return false;
    const expected = fs.realpathSync(path.join(claudeHome, 'plugins', 'cache', MARKETPLACE, 'wheelhouse', version));
    return fs.realpathSync(newRoot) === expected;
  } catch {
    return false;
  }
}

export function versionOf(root) {
  const found = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  return typeof found?.version === 'string' ? found.version : null;
}

// The card that asks about an old helper that did not make way. Plain card data: part 9 raises it. `kind` is 'busy' (a
// v0.2.5 or v0.2.6 helper still busy after two minutes), 'unknown' (one that does not know the request) or 'hung' (one that
// was asked and has not closed). `canStop` is whether the helper was proved to be Wheelhouse's own.
export function helperCardId({ pid, startTime, version, round = 0 }) {
  return `update-helper-${pid}-${String(startTime ?? version ?? 'unknown').replace(/[^A-Za-z0-9.-]+/g, '-')}${round > 0 ? `-${round}` : ''}`;
}

// The director's answer to the helper card `card`: the label of a signed action of this computer's own key, naming this card's
// id (unique to the process it asks about, so an old answer never counts for a new helper). A record that is not signed, or
// names another card, is no answer. Part 9 writes the action into the state when the director clicks. `events` are the
// project's state events; `enrolled` the computers whose signatures count.
export function signedAnswer({ events, enrolled, card, options }) {
  if (typeof card !== 'string' || !Array.isArray(events)) return null;
  const found = events
    .filter((e) => e?.kind === 'action' && e.data?.action === 'update-helper-answer' && e.data.card === card && options.includes(e.data.label) && verify(e, enrolled))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return found.length === 0 ? null : found.at(-1).data.label;
}

export function helperCard({ kind, version, canStop, id }) {
  const options = kind === 'busy'
    ? [WAIT_LONGER, ...(canStop ? [STOP_IT] : []), LEAVE_IT]
    : [STOP_IT, LEAVE_IT];
  return {
    id: id ?? 'update-helper',
    kind,
    version: version ?? null,
    options,
    recommended: options[0],
    question: kind === 'busy'
      ? [
        'The old helper is still busy.',
        'Waiting longer lets it finish what it is doing. Stopping it hands its work to the new one, which picks it up again.',
        'Meanwhile the update is installed, and the new helper starts when the old one goes.',
      ].join('\n')
      : [
        'The old helper isn\'t answering. Stop it?',
        'Work it was doing is picked up again by the new one.',
        'Meanwhile the update is installed, and the new helper starts when the old one goes.',
      ].join('\n'),
  };
}

// The refreshes of section 6.5, as the seams a real run uses. Each gives null when it does not apply here, { ok: true,
// wrote: [files] } when it made them, or { ok: false, line } for what is left.
export function realRefreshes({ project, folder, newRoot, claudeHome, platform, lockedDir, run = defaultRun, address = helperAddress({ platform }) }) {
  return {
    async local() {
      if (typeof folder !== 'string') return null;
      const { refreshLocalSettings, refreshCompactSection } = await import('../setup/local-refresh.js');
      const wrote = [];
      const edits = refreshLocalSettings({
        folder, address, node: process.execPath, pluginRoot: newRoot, platform, claudeHome,
      });
      if (edits > 0) wrote.push(path.join(folder, '.claude', 'settings.local.json'));
      try {
        if (refreshCompactSection({ folder, project })) wrote.push(path.join(folder, 'CLAUDE.md'));
      } catch { /* it informs: the file stays as it was */ }
      return { ok: true, wrote };
    },
    async locked() {
      const { lockedProjects, managedDir } = await import('../protection/managed.js');
      if (managedDir(platform) === null) return null;
      const { updateLocked, ownFile } = await import('../protection/locked.js');
      const dir = lockedDir ?? managedDir(platform);
      const list = lockedProjects({ dir });
      if (list.length === 0 || !ownFile(dir)) return null;
      const norm = (f) => String(f).replace(/\\/g, '/').toLowerCase();
      const named = registeredProjects().find((p) => list.some((f) => norm(f) === norm(p.record?.folder)));
      if (!named) return null;
      const got = await updateLocked({ project: named.project, platform, run, dir, address });
      return /^Locked is up to date/.test(String(got?.line)) ? { ok: true, wrote: [] } : { ok: false, line: `Locked was not brought up to date: ${got?.line ?? 'no reason given'}.` };
    },
  };
}

// Asks the old helper to retire for the update and waits for it to go. Gives 'closed' (its address went quiet), 'hung'
// (asked and still answering after two minutes), 'busy' (a v0.2.5 or v0.2.6 helper that refused as busy for two minutes),
// 'unknown' (it does not know the request) or 'refused' (with `why`).
async function askToRetire({ client, old, say, now, sleep }) {
  const started = now();
  let asked = await client.retire({ forUpdate: true });
  while (asked?.ok === true && asked.retired === false) {
    if (now() - started >= CLOSE_MS) return { result: 'busy' };
    await sleep(ASK_AGAIN_MS);
    asked = await client.retire({ forUpdate: true });
  }
  if (asked?.ok === true && asked.retired === true) {
    const first = await old.waitForQuiet({ client, now, sleep, timeoutMs: SLOW_AFTER_MS });
    if (first) return { result: 'closed' };
    say(WAITING_LINE);
    const rest = await old.waitForQuiet({ client, now, sleep, timeoutMs: CLOSE_MS - SLOW_AFTER_MS });
    return { result: rest ? 'closed' : 'hung' };
  }
  if (asked?.refused === 'unknown request') return { result: 'unknown' };
  return { result: 'refused', why: asked?.refused ?? 'no reason given' };
}

// The hand-over of section 7.2 and 7.3. Resolves { done: true, line? } | { asks: [card], line } | { left: line }.
async function handOver(ctx) {
  const {
    client, to, old, say, now, sleep, readAnswer, progress, startHelper, save, proofOptions, stopOptions,
  } = ctx;
  const health = await client.health();
  const answering = health?.ok === true;
  if (answering && typeof health.version === 'string' && compareVersions(health.version, to) >= 0) return { done: true };

  let closed = !answering;
  if (answering) {
    const waiting = progress.handover?.waiting ?? null;
    const reply = waiting ? await readAnswer(waiting.card) : null;
    if (waiting && reply === LEAVE_IT) return { done: true, line: RESTART_LINE, stays: true };
    if (waiting && reply === STOP_IT) {
      const stopped = await stopProved({ ...stopOptions, proof: waiting.proof, reprove: (p) => old.reprove({ ...proofOptions, version: waiting.version ?? health.version, proof: p }) });
      if (stopped.why) return { done: true, line: `The old helper was not stopped: ${stopped.why}. It is replaced when the computer restarts, or when you sign out and in.`, stays: true };
      closed = true;
    } else if (waiting && reply === null) {
      return { asks: [waiting.card], line: ASKING_LINE };
    } else {
      if (waiting && reply === WAIT_LONGER) progress.round = (progress.round ?? 0) + 1; // the next card is a new one, so this answer is used once
      const got = await askToRetire({ client, old, say, now, sleep });
      if (got.result === 'closed') closed = true;
      else if (got.result === 'refused') return { done: true, line: `The old helper could not be asked to make way (${got.why}). It is replaced when the computer restarts, or when you sign out and in.`, stays: true };
      else {
        // It did not make way. Prove it is Wheelhouse's own before anything is offered; any doubt stops nothing.
        let proof = await old.proveRecorded({ ...proofOptions });
        if (proof.why === 'no record') proof = await old.findByAddress({ ...proofOptions, version: health.version });
        if (proof.why && got.result !== 'busy') {
          return { done: true, line: proof.why === 'not told' ? RESTART_LINE : `The old helper was left running (${proof.why}). It is replaced when the computer restarts, or when you sign out and in.`, stays: true };
        }
        const canStop = !proof.why;
        const card = helperCard({ kind: got.result, version: health.version, canStop, id: helperCardId({ pid: health.pid, startTime: proof.startTime, version: health.version, round: progress.round ?? 0 }) });
        progress.handover = { waiting: { card, proof: canStop ? proof : null, version: health.version, kind: got.result } };
        save();
        return { asks: [card], line: ASKING_LINE };
      }
    }
  }
  if (!closed) return { done: true, line: RESTART_LINE, stays: true };
  startHelper();
  const until = now() + NEW_HELPER_MS;
  for (;;) {
    let seen = null;
    try { seen = await client.health(); } catch { seen = null; }
    if (seen?.ok === true && typeof seen.version === 'string' && compareVersions(seen.version, to) >= 0) return { done: true, line: '' };
    if (now() >= until) return { left: NOT_RUNNING_LINE };
    await sleep(500);
  }
}

// Finishes an update. `journal` is the project's update journal (scripts/update/journal.js); `answer` is the director's
// answer to a card this raised before, by its label. Resolves { ok, line, asks? }. Safe to run again: done refreshes and a
// done hand-over are not repeated, and a waiting card is returned until it is answered.
export async function finish({
  project, journal, answer = null, events, enrolled, newRoot = PLUGIN_ROOT, folder, claudeHome = defaultClaudeHome(), platform = process.platform,
  to, from, client = helperClient(), refresh, old, say = () => {}, now = Date.now, sleep = pause, startHelper, hash = fileHash, record = recordUpdate,
  readRecord = readHelperRecord, startTimeOf = processStartTime, alive = pidAlive, address = helperAddress({ platform }), run = defaultRun,
  user, cacheRoot = defaultCacheRoot(), kill, watcher, heldNow = updateLockHeld, move = realMove, addon = realAddon, parked = realParked, statusLine = statusLineStep,
}) {
  // Only the job's own step runs this: the update lock is held and the journal has the finish step running. It never takes
  // the lock itself, and it runs only from the plugin cache folder of the tag the journal names.
  const state = journal.read();
  const named = to ?? state.steps?.checks?.data?.tag;
  if (heldNow() !== true || state.steps?.finish?.state !== 'running') return { ok: false, line: 'The second half of an update runs only from an update that is under way.' };
  if (!rootIsCacheFor({ newRoot, claudeHome, tag: named })) return { ok: false, line: 'The second half of an update runs only from the new release\'s folder in the plugin cache.' };
  {
    const dir = folder ?? registeredProjects().find((p) => p.project === project)?.record?.folder;
    const version = to ?? journal.read().steps?.checks?.data?.tag ?? `v${versionOf(newRoot)}`;
    const previous = from ?? readJson(path.join(journal.folder, 'install.json'))?.previous?.ref ?? null;
    const progress = readProgress(journal);
    const save = () => writeJson(progressFile(journal), progress);
    const refreshes = refresh ?? realRefreshes({ project, folder: dir, newRoot, claudeHome, platform, run, address });
    const oldHelper = {
      proveRecorded, findByAddress, reprove, stopProved, waitForQuiet, ...(old ?? {}),
    };
    const left = [];

    // 1. The refreshes of section 6.5.
    const fresh = [];
    for (const name of ['local', 'locked']) {
      if (progress.refreshed[name] === 'done') continue;
      let got;
      try { got = await refreshes[name](); } catch (error) { got = { ok: false, line: String(error?.message ?? error).replace(/\s+/g, ' ') }; }
      if (got === null || got === undefined) { progress.refreshed[name] = 'done'; continue; }
      if (got.ok === true) {
        progress.refreshed[name] = 'done';
        fresh.push(...(got.wrote ?? []));
      } else {
        left.push(got.line);
      }
      save();
    }

    // 2. The own-files record, with every file written and its hash.
    if (fresh.length > 0 || progress.recorded !== true) {
      const wrote = [...new Set(fresh)].map((file) => ({ file, hash: hash(file) })).filter((w) => typeof w.hash === 'string');
      const click = journal.read().steps?.merged?.data?.approved;
      record({ from: previous, to: version, at: new Date(now()).toISOString(), answer: typeof click === 'string' ? click : null, wrote });
      progress.recorded = true;
      save();
    }

    // 3. The helper hand-over.
    const user_ = user ?? (await import('node:os')).userInfo().username;
    const handing = progress.handover?.done === true ? { done: true, line: progress.handover.line ?? '', stays: progress.handover.stays === true } : await handOver({
      client,
      to: version.replace(/^v/, ''),
      old: oldHelper,
      say,
      now,
      sleep,
      readAnswer: async (card) => {
        if (answer !== null && answer !== undefined) return [STOP_IT, LEAVE_IT, WAIT_LONGER].includes(answer) ? answer : null; // a seam for tests; the command passes none
        return signedAnswer({ events: events ?? listEvents(stateDir(project), { report: () => {} }), enrolled: enrolled ?? readEnrolled(), card: card?.id, options: card?.options ?? [] });
      },
      progress,
      save,
      startHelper: startHelper ?? (() => realStartHelper(newRoot)),
      proofOptions: { client, read: readRecord, startTime: startTimeOf, alive, address, platform, run, user: user_, cacheRoot },
      stopOptions: { platform, kill: kill ?? process.kill.bind(process), wait: () => oldHelper.waitForQuiet({ client, now, sleep }) },
    });
    if (handing.asks) return { ok: false, line: handing.line, asks: handing.asks };
    if (handing.left) left.push(handing.left);
    if (handing.done) {
      progress.handover = { done: true, line: handing.line ?? '', stays: handing.stays === true };
      save();
    }

    // 3b. The move off Archon (core cut, design 6 item 1), at the quiet point the hand-over gives: the old helper has
    // gone and the new one tends no Archon run. A move that must be tried again holds the update's last line.
    let moved = null;
    if (handing.done) {
      try { moved = await move({ project, folder: dir, journal, progress, save, client }); } catch (error) { moved = { done: false, lines: [`The move off Archon stopped: ${String(error?.message ?? error).replace(/\s+/g, ' ')}`] }; }
      if (moved && moved.done !== true) left.push(...moved.lines);
    }

    // 3c. The pieces parked in the core cut, once the new helper is up: the VS Code add-on, removed only where the card the
    // director clicked named it, the card about a parked agent, and Wheelhouse's own status line taken out of the local settings. They inform: a line each, never a stop for the update.
    const said = [];
    if (handing.done) {
      for (const step of [addon, parked, statusLine]) {
        try { said.push(...((await step({ project, folder: dir, journal, progress, save, client, run, platform }))?.lines ?? [])); } catch { /* it informs */ }
      }
    }

    // 4. The watcher, restarted from the new folder, only through stopWatcher and startWatcher.
    const lines = [];
    if (handing.done && handing.stays !== true && progress.watcher !== 'done') {
      const w = { stopWatcher, startWatcher, watcherRunning, ...(watcher ?? {}) };
      const gone = await w.stopWatcher(project);
      if (gone.stopped === true) {
        const until = now() + 15000;
        while (w.watcherRunning(project) && now() < until) await sleep(500);
      }
      if (!w.watcherRunning(project)) w.startWatcher(project, { pluginRoot: newRoot });
      progress.watcher = 'done';
      save();
    }

    // 5. The last line.
    if (left.length > 0) return { ok: false, line: left.join(' ') };
    lines.push(`Wheelhouse ${version} is installed. Start a new session on this folder to use it.`);
    if (handing.line) lines.push(handing.line);
    if (moved?.done === true) lines.push(...moved.lines);
    lines.push(...said);
    return { ok: true, line: lines.join(' ') };
  }
}

// The add-on's removal, for a plan whose card named it; null when it did not.
async function realAddon({ journal, progress, save, run, platform }) {
  if (!planNamedAddon(journal)) return null;
  return removeAddon({ run, platform, progress, save });
}

// The card about a parked agent, for the project's folder, with the real state.
function realParked({ project, folder, client, progress, save }) {
  return raiseParked({ project, folder, client, progress, save, parked: (where) => parkedAgentOfProject(where, { computerId: computerId() }) });
}

// The move off Archon with the real helper, settings and connector. Archon's connector is built only for a project that
// still stores Archon, and Archon on the computer is archived only once no other registered project stores it.
async function realMove({ project, folder, journal, progress, save, client }) {
  const [{ moveOffArchon }, { storedEngine }, { settingsViews }] = await Promise.all([
    import('./engine-move.js'), import('../settings/effective.js'), import('../desk/settings-views.js'),
  ]);
  const stored = () => storedEngine(settingsViews(project));
  if (progress.engine === undefined && stored() !== 'archon') return null;
  const { packedArchon } = await import('../host/helper-main.js');
  return moveOffArchon({
    project,
    folder,
    journal,
    progress,
    save,
    stored,
    views: async () => (await client.state.views({ project }))?.views ?? null,
    connector: packedArchon(),
    client,
    othersOnArchon: () => registeredProjects().some((p) => p.project !== project && storedEngine(settingsViews(p.project)) === 'archon'),
  });
}

// Starts the helper from the new folder, as the session start does: detached, hidden, in Wheelhouse's own folder.
async function realStartHelper(root) {
  const { spawn } = await import('node:child_process');
  const home = wheelhouseHome();
  fs.mkdirSync(home, { recursive: true });
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'host', 'helper-main.js')], {
    cwd: jobFolder(), detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ...caEnv(home) },
  });
  child?.on?.('error', () => {});
  child?.unref?.();
}

export async function main(argv, { out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t), ...deps } = {}) {
  const [project, ...rest] = argv;
  if (typeof project !== 'string' || rest.length > 0) {
    err('Give the project: finish.js <project>\n');
    return 1;
  }
  try {
    const result = await finish({ project, journal: openJournal(project), ...deps });
    out(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    err(`That did not work: ${String(error?.message ?? error).replace(/\s+/g, ' ')}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
