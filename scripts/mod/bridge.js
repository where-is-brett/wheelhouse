// scripts/mod/bridge.js
// What the mod runs: `node <plugin root>/scripts/mod/bridge.js` through `$.process.run`, with
// one JSON request on standard input. It prints one JSON line, { ok, says?, ... } with only the
// fields lineOf lets through, and exits 0 within BRIDGE_MS of reading the request (a foreman's
// tick, which runs the watcher's loop, gets WATCH_BRIDGE_MS), whatever the request was. The mod
// signs nothing and runs no shell; this script signs only because the mod's commands run outside
// the session's sandbox, where the signing key can be read (check 32). Run inside the sandbox, by
// an agent, it can't read the key, so it signs nothing and says so.
//
// Nothing in a request is trusted beyond its `origin`, which the mod takes from Claude Code.
// Only `composer` (typed) and `bridge` (phoned) are the director's messages, and `pane` is the
// director's press on the pane; `sdk`, `peer` and every other origin never count.
//
//   { cmd: 'usage', session, cwd, usd?, windows? }  the session's running cost and the allowance
//   { cmd: 'tick', session, cwd, idle, surface }    what the pane and the status line show now and the
//                                                   courier's wake, with the ids it marked sent and its
//                                                   stamp, or a Shape 2 foreman's wakes from one
//                                                   watcher loop, or nothing while setup runs; it also
//                                                   records a lineage-lift once a hold file is gone
//   { cmd: 'unsent', session, cwd, ids, at }        the mod couldn't hand on the courier's wake stamped
//                                                   `at`: its marks are undone, so the next tick wakes
//                                                   again
//   { cmd: 'reply', origin, text, cwd }             a reply code and an option, as the click
//   { cmd: 'press', origin, cwd, card, hash, label } a press on a card in the pane, as its click
//   { cmd: 'why', origin, cwd, card, hash }         Why? on a card: its answer noted quietly, no prompt
//   { cmd: 'suggest', origin, cwd, card, hash, words } Suggest a change… on a card: its answer noted, and
//                                                   the director's words handed on as one prompt
//   { cmd: 'settings', cwd }                        the settings pane's rows and groups, from the views on disk
//   { cmd: 'setting', origin, cwd, key, choice }    a choice in the settings pane: sets it and confirms it
//   { cmd: 'go', origin, cwd, since? }              /go or the pane: lifts STOP with a signed record;
//                                                   the pane's carries the start of the STOP it drew
//   { cmd: 'stop', origin, cwd }                    a phoned "stop" or the pane: sets STOP
//   { cmd: 'digest', origin, cwd }                  /digest: the briefing since the last, as text (any origin)
//
// The signed records go through the helper as the prompt record sends its own: kept in
// pending/ first, sent, and removed once the helper has them.
import path from 'node:path';
import { settingKey } from '../protection/windows-builds.js';
import { computerId } from '../lib/paths.js';
import { replyRecord as defaultReply } from './reply.js';
import { pressCard as defaultPress, whyCard as defaultWhy, suggestCard as defaultSuggest } from './press.js';
import { settingsRows as defaultRows, settingsGroups as defaultGroups, pressSetting as defaultSetting, effectiveFor as defaultEffective, changesFor as defaultChanges, ADVANCED } from './settings-pane.js';
import { keepEarned, sendKept } from '../hooks/prompt-record.js';
import { withinBudget } from '../hooks/pending.js';
import { helperGrace } from '../lib/helper-grace.js';
import { projectOf as defaultProjectOf, readSmallText, beingSetUp as defaultBeingSetUp } from '../hooks/kit.js';
import { featureSlug as defaultFeatureSlug, localViews as defaultLocalViews } from '../hooks/session-start.js';
import { recordLift as defaultRecordLift } from '../lineage/check.js';
import { journalTrouble as defaultJournalTrouble } from '../lib/setup-run.js';
import { helperClient } from '../host/helper-client.js';
import { loadBoardInputs } from '../board/inputs.js';
import { recordModReading, recordSession } from '../usage/store.js';
import { stopState as defaultStopState, setStop as defaultSetStop, liftStop as defaultLiftStop } from '../lib/stop.js';
import { sessionRole as defaultSessionRole } from '../lib/role.js';
import { isOwnStatusLine } from '../protection/settings.js';
import { LIFT_STOP } from '../state/card-lines.js';
import { FOREMAN_TICK_MS, TICK_MS, WATCH_BRIDGE_MS } from '../lib/mod-numbers.js';
import { digestText as defaultDigest } from './digest.js';
import { paneModel as defaultPaneModel, writePaneStatus as defaultWritePaneStatus } from './status.js';
import { needsYou, courierWake as defaultCourierWake, courierUnsent as defaultCourierUnsent, LOCK_WAIT_MS } from './courier.js';
import { watchTick as defaultWatchTick } from './watch.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { NOT_RECORDED } from '../lib/calm-words.js';

// The whole run for most requests, from reading the request to the answer.
export const BRIDGE_MS = 5000;
// How long the helper is waited for, inside BRIDGE_MS.
export const HELPER_MS = 3000;
// The waits as kept: each with the time a test on a loaded computer adds (helper-grace.js).
const helperMs = () => HELPER_MS + helperGrace();
const bridgeMs = () => BRIDGE_MS + helperGrace();
// The time the courier needs inside BRIDGE_MS: its wait for courier.json's lock, and the file. A
// front desk's tick with less left skips the courier, so a wake is never marked sent and then
// lost to the late answer.
export const COURIER_MS = LOCK_WAIT_MS + 500;
export const MAX_REQUEST_BYTES = 64 * 1024;
const DIRECTOR = ['composer', 'bridge'];
// The director's press on the pane.
const PANE = 'pane';
// The role a tick answers for a session in a folder setup is working on.
export const SETUP_ROLE = 'setup';

export const SAYS = {
  unreadable: 'Wheelhouse couldn\'t read that request',
  unknown: 'Wheelhouse doesn\'t know that request',
  failed: NOT_RECORDED,
  late: 'Wheelhouse couldn\'t do that in time',
  notKept: 'That usage reading couldn\'t be kept',
  notDirector: 'Only the director\'s own messages count',
  notProject: 'This isn\'t a Wheelhouse project',
  goNotDirector: 'Only the director can lift STOP',
  goNotProject: 'This isn\'t a Wheelhouse project, so STOP stays on',
  goUndated: 'The pane didn\'t say which STOP it showed, so STOP stays on; type /go to lift it',
  goOtherStop: 'That isn\'t the STOP the pane showed, so STOP stays on; look at the pane again',
  stopOff: 'STOP isn\'t on.',
  cantSign: 'Wheelhouse couldn\'t sign that here, so STOP stays on',
  cantLift: 'STOP couldn\'t be lifted, so it stays on',
  nothingBuilding: 'No build work is in progress.',
  noCourier: 'The courier couldn\'t run this time',
  stopNotPhone: 'Only a message from your phone or a press in the pane sets STOP here',
  notPane: 'Only a press in the pane counts as one',
  stopOn: 'STOP is on.',
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = (says) => ({ ok: false, says });
const fromDirector = (origin) => typeof origin === 'string' && DIRECTOR.includes(origin);

const DEFAULTS = {
  now: () => new Date(),
  projectOf: defaultProjectOf,
  featureSlug: defaultFeatureSlug,
  replyRecord: defaultReply,
  pressCard: defaultPress,
  whyCard: defaultWhy,
  suggestCard: defaultSuggest,
  settingsRows: defaultRows,
  settingsGroups: defaultGroups,
  computer: computerId,
  localViews: defaultLocalViews,
  recordLift: defaultRecordLift,
  pressSetting: defaultSetting,
  readEffective: defaultEffective,
  readChanges: defaultChanges,
  // The bridge's own time zone, which the pane's times are worked out in.
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  loadInputs: loadBoardInputs,
  stopState: defaultStopState,
  setStop: defaultSetStop,
  liftStop: defaultLiftStop,
  sessionRole: defaultSessionRole,
  beingSetUp: defaultBeingSetUp,
  journalTrouble: defaultJournalTrouble,
  digestText: defaultDigest,
  paneModel: defaultPaneModel,
  writePaneStatus: defaultWritePaneStatus,
  courierWake: defaultCourierWake,
  courierUnsent: defaultCourierUnsent,
  // A clock for the time a request has taken.
  elapsedClock: () => performance.now(),
  watchTick: defaultWatchTick,
  env: process.env,
};

// The project a full path belongs to, or null.
function placeOf(cwd, d) {
  try {
    return typeof cwd === 'string' && path.isAbsolute(cwd) ? d.projectOf(cwd)?.project ?? null : null;
  } catch {
    return null;
  }
}

// The registered project a full path belongs to ({ project, record }), or null.
function siteOf(cwd, d) {
  try {
    const found = typeof cwd === 'string' && path.isAbsolute(cwd) ? d.projectOf(cwd) : null;
    return typeof found?.project === 'string' ? found : null;
  } catch {
    return null;
  }
}

function clientOf(d) {
  d.client ??= helperClient({ timeout: helperMs() });
  return d.client;
}

// The mod's reading. The store checks the session ID and drops windows it can't read; a cost
// that isn't a number of dollars is left out. What the session is for is written the first time
// only, and only inside a project, marked as the mod's: the session start, which can tell a
// foreman, replaces it once.
async function usage(req, d) {
  const usd = typeof req.usd === 'number' && Number.isFinite(req.usd) && req.usd >= 0 ? req.usd : undefined;
  const windows = Array.isArray(req.windows) ? req.windows.filter(isRecord) : undefined;
  const at = d.now();
  try {
    recordModReading({ session: req.session, usd, windows, at });
  } catch {
    return no(SAYS.notKept);
  }
  const project = placeOf(req.cwd, d);
  if (project) {
    try {
      const work = d.featureSlug(req.cwd);
      recordSession({ session: req.session, project, role: work ? 'feature' : 'front-desk', ...(work ? { work } : {}), at, by: 'mod' });
    } catch {
      // The reading is kept even when what the session is for can't be.
    }
  }
  return { ok: true };
}

async function reply(req, d) {
  if (!fromDirector(req.origin)) return no(SAYS.notDirector);
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.notProject);
  const { made, says } = await d.replyRecord({ project, text: req.text, client: clientOf(d), now: d.now, liftStop: d.liftStop, stopState: d.stopState, budget: helperMs() });
  return typeof says === 'string' ? { ok: made === true, says } : { ok: made === true };
}

// What the build loop has in progress, read from files only.
async function inProgress(cwd, d) {
  try {
    const features = (await d.loadInputs({ cwd, now: d.now, offline: true }))?.model?.build?.features;
    const n = Array.isArray(features) ? features.filter((f) => f?.step === 'building').length : 0;
    return n === 0 ? SAYS.nothingBuilding : `In progress: ${n} ${n === 1 ? 'feature' : 'features'} building.`;
  } catch {
    return SAYS.nothingBuilding;
  }
}

// A press on a card in the pane, from the pane alone: it records what a click on the same
// button of the same card would (press.js). A press that only hands the front desk its prompt,
// under STOP, is still ok, so the mod submits the prompt.
async function press(req, d) {
  if (req.origin !== PANE) return no(SAYS.notPane);
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.notProject);
  const { made, says, submit } = await d.pressCard({
    project, card: req.card, hash: req.hash, label: req.label, client: clientOf(d), now: d.now, liftStop: d.liftStop, stopState: d.stopState, budget: helperMs(),
  });
  const answer = { ok: made === true || strings(submit) };
  if (typeof says === 'string') answer.says = says;
  if (strings(submit)) answer.submit = submit;
  return answer;
}

// Why? on a card in the pane, from the pane alone: the card's answer is noted quietly (press.js),
// so the answer is ok with nothing to say and no prompt, whether or not the card was still there.
async function why(req, d) {
  if (req.origin !== PANE) return no(SAYS.notPane);
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.notProject);
  await d.whyCard({ project, card: req.card, hash: req.hash, client: clientOf(d), now: d.now, stopState: d.stopState, budget: helperMs() });
  return { ok: true };
}

// Suggest a change… on a card in the pane, from the pane alone. The director's words go to the
// front desk as the one prompt press.js builds; they are kept nowhere else.
async function suggest(req, d) {
  if (req.origin !== PANE) return no(SAYS.notPane);
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.notProject);
  const { made, says, submit } = await d.suggestCard({
    project, card: req.card, hash: req.hash, words: req.words, client: clientOf(d), now: d.now, stopState: d.stopState, budget: helperMs(),
  });
  const answer = { ok: made === true || strings(submit) };
  if (typeof says === 'string') answer.says = says;
  if (strings(submit)) answer.submit = submit;
  return answer;
}

// The settings pane's rows, from the settings views on disk and the profile's: the settings in
// force, with each row's choices as they are offered now. A project's Locked mark is passed when
// the project says it.
async function settings(req, d) {
  const found = siteOf(req.cwd, d);
  if (found === null) return no(SAYS.notProject);
  const effective = d.readEffective({ project: found.project, now: d.now });
  const inputs = { effective, changes: d.readChanges({ project: found.project }), now: d.now, timeZone: d.timeZone, locked: typeof found.locked === 'boolean' ? found.locked : undefined };
  // The level build commands run at on Windows is kept per computer: this computer's is shown.
  const builds = effective?.[settingKey(d.computer())];
  return { ok: true, rows: d.settingsRows(inputs), groups: d.settingsGroups({ ...inputs, stop: await d.stopState(), windows: builds?.value }), text: ADVANCED };
}

// A choice in the settings pane, from the pane alone, Undo included: the setting is written and the
// director's confirmation of it signed, as a Confirm click on its card would (settings-pane.js).
async function setting(req, d) {
  if (req.origin !== PANE) return no(SAYS.notPane);
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.notProject);
  const { made, says } = await d.pressSetting({ project, key: req.key, choice: req.choice, client: clientOf(d), now: d.now, timeZone: d.timeZone, budget: helperMs(), stopState: d.stopState });
  return typeof says === 'string' ? { ok: made === true, says } : { ok: made === true };
}

// /go, or Lift STOP on the pane: the signed lift-stop action is kept first, by the prompt
// record's own path, and STOP is lifted only once it is. A record that can't be signed or kept
// leaves STOP on. The pane's press carries `since`, the start of the STOP the pane drew, and
// lifts only that STOP, as a Lift STOP card does only for a STOP begun before it was shown, so a
// pane drawn before STOP was set again can't lift a STOP the director never saw. /go typed or
// phoned lifts the STOP in force.
async function go(req, d) {
  if (!fromDirector(req.origin) && req.origin !== PANE) return no(SAYS.goNotDirector);
  const fromPane = req.origin === PANE;
  if (fromPane && (typeof req.since !== 'string' || req.since === '')) return no(SAYS.goUndated);
  const stop = await d.stopState();
  if (!stop.on) return { ok: true, says: SAYS.stopOff };
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.goNotProject);
  if (fromPane && stop.at !== req.since) return no(SAYS.goOtherStop);
  const got = { made: { kind: 'action', data: { action: 'lift-stop', question: LIFT_STOP, label: '/go' } }, lift: true };
  let lifting = false;
  let kept;
  try {
    kept = keepEarned(project, got, { now: d.now, liftStop: () => { lifting = true; d.liftStop(); } });
  } catch {
    return no(lifting ? SAYS.cantLift : SAYS.cantSign);
  }
  try {
    await sendKept(clientOf(d), withinBudget(Date.now() + helperMs()), kept);
  } catch {
    // Kept in pending/ for the next session start to send.
  }
  return { ok: true, says: `STOP is off. ${await inProgress(req.cwd, d)}` };
}

// A typed "stop" is the stop-word hook's; a phoned one or STOP on the pane sets it here.
async function stop(req, d) {
  if (req.origin !== 'bridge' && req.origin !== PANE) return no(SAYS.stopNotPhone);
  d.setStop({ by: 'mod', now: d.now });
  return { ok: true, says: SAYS.stopOn };
}

// /digest, from any origin: the briefing since the last one, as the answer's text. It only reads,
// and marks a briefing given, so whose command it is doesn't matter.
async function digest(req, d) {
  return d.digestText({ cwd: req.cwd, now: d.now, client: clientOf(d), load: d.loadInputs, readEffective: d.readEffective });
}

// Whether the project's local settings name Wheelhouse's own status line (board-and-usage), which
// the terminal then draws itself. Read from the file alone, and only read: the folder is one an
// agent controls, so the file is read as a small regular file, which a FIFO planted there is not.
function ownStatusLine(record) {
  try {
    if (typeof record?.folder !== 'string') return false;
    const text = readSmallText(path.join(record.folder, '.claude', 'settings.local.json'));
    const settings = text === null ? null : JSON.parse(text);
    return isRecord(settings) && isOwnStatusLine(settings.statusLine);
  } catch {
    return false;
  }
}

// The role of the session that sent a request, as the board-context hook recorded it from the
// first prompt, or WHEELHOUSE_ROLE. A role that can't be read is the front desk's, as anywhere.
function roleOf(req, d) {
  try {
    return d.sessionRole({ sessionId: req.session, cwd: req.cwd, env: d.env });
  } catch {
    return 'front-desk';
  }
}

// Whether the host helper answers its health check within HELPER_MS. Never throws.
async function helperAnswers(d) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), helperMs()); });
  try {
    return await Promise.race([Promise.resolve().then(() => clientOf(d).health()).then((got) => got?.ok === true, () => false), late]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The watcher's half of a tick (watch.js), which never holds up the rest: anything that throws
// is a failure. While setup's journal can't be read, whether setup has finished isn't known, so
// the watcher is `held` back, at the front desk (the pane's `watcher` says so) and in a foreman's
// session alike, as the session start holds it back (ruling R72).
function watching(found, role, client, d) {
  return Promise.resolve()
    .then(() => (d.journalTrouble() === null ? d.watchTick({ project: found.project, role, client, now: d.now }) : { watcher: 'held', submit: [] }))
    .catch(() => ({ watcher: 'failed', submit: [] }));
}

// A foreman's tick. In Shape 2 it runs one loop of the watcher and hands back its wake lines as
// the foreman's prompts, every FOREMAN_TICK_MS, including while the shape is still being read or
// a loop failed. A Shape 1 foreman is woken by its watcher, so it is told to stop ticking. The
// loop has the whole of WATCH_BRIDGE_MS, so its helper is one with no shorter limit of its own.
async function foremanTick(found, d) {
  const watched = await watching(found, 'foreman', d.client ?? helperClient(), d);
  if (watched?.watcher === 'not-needed') return { ok: true, role: 'foreman', every: 0 };
  return { ok: true, role: 'foreman', every: FOREMAN_TICK_MS, submit: strings(watched?.submit) ? watched.submit : [] };
}

// The courier's wake for this tick, as { submit, woken, wokeAt }, or null (courier.js), from this
// tick's pane model; presence and the quiet hours are the settings in force. `woken` names the ids
// the wake marked sent and `wokeAt` its stamp, which the mod sends back as `unsent` when it can't
// hand the wake on. A courier
// that fails wakes for nothing this tick and says so in the pane; what it found waits for the next
// tick.
async function courier(found, pane, req, d) {
  try {
    const effective = d.readEffective({ project: found.project, now: d.now });
    const { submit, sent, at } = await d.courierWake({
      project: found.project,
      session: req.session,
      items: needsYou({ after: pane }),
      presence: effective?.presence,
      quiet: effective?.notifications?.value?.quiet,
      idle: req.idle === true,
      now: d.now,
      timeZone: d.timeZone,
    });
    // One shape for every submit: a list of prompts.
    if (typeof submit !== 'string') return null;
    return { submit: [submit], woken: strings(sent) ? sent : [], ...(typeof at === 'string' ? { wokeAt: at } : {}) };
  } catch {
    pane.missing = [...pane.missing, SAYS.noCourier];
    return null;
  }
}

// Whether the session's folder is one setup is working on (kit.js's beingSetUp: a registered
// project whose setup run is unfinished, or a folder with no project record yet that a run holds
// or whose settings switch the plugin on). A lookup that throws counts as no setup.
function settingUp(cwd, d) {
  try {
    return d.beingSetUp(cwd) !== null;
  } catch {
    return false;
  }
}

// A lineage hold whose hold file is gone has its card closed within a tick: the lift is recorded
// once for each standing hold (lineage/check.js recordLift), by the tick because the session start
// can't, the hold file being gone while no session starts. It informs, so a failure is passed over.
async function liftingHold(project, d) {
  try {
    const views = d.localViews(project, ['lineageHolds']);
    if (!Array.isArray(views?.lineageHolds) || views.lineageHolds.length === 0) return;
    await d.recordLift({ project, views, computer: d.computer(), now: d.now, client: clientOf(d), left: withinBudget(Date.now() + helperMs()) });
  } catch { /* the next tick tries again */ }
}

// What the pane and the status line show now. Only the front desk, in a project's main folder,
// has a pane: its model is kept as status.json before the answer goes, with whether the
// watcher runs (a Shape 1 watcher that has stopped is started again here), and the courier's
// wake, when it has one, is the answer's `submit`. A Shape 2 foreman's tick runs the watcher's
// loop. A session that would be the front desk in a folder setup is working on is setup's: it
// gets the role `setup` and TICK_MS, and nothing is drawn, run or handed on for it, so once setup
// finishes its next tick is the front desk's and the pane comes. A feature session, a Shape 1
// foreman and a folder outside a project get an `every` of 0, which tells the mod to stop
// ticking. In the terminal, when Wheelhouse's own status line is set, `status` is left out so the
// glance isn't shown twice.
async function tick(req, d) {
  const role = roleOf(req, d);
  const found = siteOf(req.cwd, d);
  if (found !== null && role === 'foreman') return foremanTick(found, d);
  if (role === 'front-desk' && settingUp(req.cwd, d)) return { ok: true, role: SETUP_ROLE, every: TICK_MS };
  if (role !== 'front-desk' || found === null) return { ok: true, role, every: 0 };
  const started = d.elapsedClock();
  // The watch runs beside the pane, so the two share the time the tick has.
  const watched = watching(found, role, clientOf(d), d);
  const lifting = liftingHold(found.project, d);
  // The pane is read from files, so it asks the helper whether it is up, to say so when it isn't.
  const pane = await d.paneModel({ project: found.project, cwd: req.cwd, now: d.now, helperUp: await helperAnswers(d), client: clientOf(d) });
  const watcher = (await watched)?.watcher;
  pane.watcher = typeof watcher === 'string' ? watcher : null;
  await lifting;
  // With too little of BRIDGE_MS left, the courier waits for the next tick, marking nothing.
  const wake = d.elapsedClock() - started > BRIDGE_MS - COURIER_MS ? null : await courier(found, pane, req, d);
  try {
    d.writePaneStatus(found.project, pane);
  } catch {
    pane.missing = [...pane.missing, 'The pane\'s status file couldn\'t be kept'];
  }
  const answer = { ok: true, role, every: TICK_MS, pane, glance: pane.glance };
  if (!(req.surface === 'terminal' && ownStatusLine(found.record))) answer.status = pane.glance;
  if (wake !== null) {
    answer.submit = wake.submit;
    answer.woken = wake.woken;
    if (wake.wokeAt !== undefined) answer.wokeAt = wake.wokeAt;
  }
  return answer;
}

// The mod couldn't hand on the courier's wake stamped `at` that marked `ids`: the courier takes
// out those marks that are still that session's wake's (courier.js courierUnsent), so the next idle
// tick wakes again. The session's own folder names the project.
async function unsent(req, d) {
  const found = siteOf(req.cwd, d);
  if (found === null) return no(SAYS.notProject);
  await d.courierUnsent({ project: found.project, session: req.session, ids: req.ids, at: req.at });
  return { ok: true };
}

const COMMANDS = { usage, reply, press, why, suggest, settings, setting, go, stop, digest, tick, unsent };

// handle(request, deps) -> { ok, says? }. Never throws.
export async function handle(request, deps = {}) {
  if (!isRecord(request)) return no(SAYS.unreadable);
  const cmd = typeof request.cmd === 'string' && Object.hasOwn(COMMANDS, request.cmd) ? COMMANDS[request.cmd] : null;
  if (!cmd) return no(SAYS.unknown);
  try {
    return await cmd(request, { ...DEFAULTS, ...deps });
  } catch {
    return no(SAYS.failed);
  }
}

// The text on the stream, or null once it passes `max` bytes.
async function readCapped(stream, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > max) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// The request on the stream, as { request }, or the answer to give when it can't be read.
async function requestFrom(stdin) {
  try {
    const text = await readCapped(stdin, MAX_REQUEST_BYTES);
    return text === null ? no(SAYS.unreadable) : { request: JSON.parse(text) };
  } catch {
    return no(SAYS.unreadable);
  }
}

const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

// The answer's one line: { ok } and `says` when there is one, then only the fields the mod reads
// (role, every, pane, glance, status, submit, woken, wokeAt, rows, text), each when it is present
// and of its type; `submit` and `woken` are always lists of strings. Nothing else a command put in its
// answer reaches the mod.
export function lineOf(answer) {
  const out = { ok: answer?.ok === true };
  if (typeof answer?.says === 'string') out.says = answer.says;
  if (typeof answer?.role === 'string') out.role = answer.role;
  if (typeof answer?.every === 'number' && Number.isFinite(answer.every) && answer.every >= 0) out.every = answer.every;
  if (isRecord(answer?.pane)) out.pane = answer.pane;
  if (typeof answer?.glance === 'string') out.glance = answer.glance;
  if (typeof answer?.status === 'string') out.status = answer.status;
  if (strings(answer?.submit)) out.submit = answer.submit;
  if (strings(answer?.woken)) out.woken = answer.woken;
  if (typeof answer?.wokeAt === 'string') out.wokeAt = answer.wokeAt;
  if (Array.isArray(answer?.rows) && answer.rows.every(isRecord)) out.rows = answer.rows;
  if (Array.isArray(answer?.groups) && answer.groups.every(isRecord)) out.groups = answer.groups;
  if (typeof answer?.text === 'string') out.text = answer.text;
  return JSON.stringify(out);
}

// How long a request may take once it is read: a foreman's tick runs the watcher's loop, which
// needs longer than anything else.
export function limitFor(request, { limitMs = BRIDGE_MS, watchMs = WATCH_BRIDGE_MS, deps } = {}) {
  return isRecord(request) && request.cmd === 'tick' && roleOf(request, { ...DEFAULTS, ...deps }) === 'foreman' ? watchMs : limitMs;
}

// What `work` gives, or the late answer once `ms` have passed.
async function within(work, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(no(SAYS.late)), ms); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

// runBridge({ stdin, limitMs, watchMs, deps }) -> the answer's line. Never throws. The request is
// read within `limitMs`; the time to answer it starts once it is read, `watchMs` for a foreman's
// tick and `limitMs` for anything else, and the late answer comes if it isn't done by then.
export async function runBridge({ stdin = process.stdin, limitMs = bridgeMs(), watchMs = WATCH_BRIDGE_MS, deps } = {}) {
  try {
    const read = await within(requestFrom(stdin), limitMs);
    if (!Object.hasOwn(read, 'request')) return lineOf(read);
    const ms = limitFor(read.request, { limitMs, watchMs, deps });
    return lineOf(await within(handle(read.request, deps).catch(() => no(SAYS.failed)), ms));
  } catch {
    return lineOf(no(SAYS.failed));
  }
}

if (startedAsScript(import.meta.url)) {
  const line = await runBridge();
  // Waits for the write to be taken (a Windows pipe takes it asynchronously), then exits, so a
  // request or a timer still open can't hold the process.
  await new Promise((resolve) => process.stdout.write(`${line}\n`, () => resolve()));
  process.exit(0);
}
