// scripts/board/inputs.js
// Everything the board, the briefing and the glance need, gathered for the folder a session
// works in. It reads files only and never runs git: the views as the last sync left them, the
// raw events in the private record, the settings views, the usage store, the sources report, STOP,
// the project's record, the host facts' cache and setup's journal (whether its push test reached
// the phone). The helper is asked only for whether it is up, who holds the project's lock and,
// once a day, the host facts, each within HELPER_WAIT_MS
// (or the shorter `waitMs` a caller with a limit of its own asks for) and all of them together
// within it too.
//
// With `offline` (the status line, which has half a second and whose reads can't be interrupted)
// only what the glance needs is read, each a file of known size or a view by name: the waiting,
// questions, work, features and blockers views, STOP, the weekly share from the allowance file alone, and
// the small files health reads (the host facts' cache). No raw events,
// other views, settings, usage days, sources, key files, setup journal or the project's
// configuration are read, no browser is looked for, and nothing is asked of the helper, so the
// model is the glance's, not the board's.
//
// Nothing here throws: what can't be read is passed on as missing, and boardModel names it.
import fs from 'node:fs';
import path from 'node:path';
import { boardModel } from './model.js';
import { healthLines, readHostFacts, readScreens } from './health.js';
import { projectOf } from '../hooks/kit.js';
import { localViews } from '../hooks/session-start.js';
import { listEvents } from '../state/events.js';
import { usageFigures, weeklyShare } from '../usage/figures.js';
import { agentInFolder } from '../agents/names.js';
import { effectiveSettings } from '../settings/effective.js';
import { readProfileViews } from '../profile/store.js';
import { stopState } from '../lib/stop.js';
import { computerId, sourcesDir, stateDir, wheelhouseHome } from '../lib/paths.js';
import { buildsShown } from '../protection/windows-builds.js';
import { guardedReady } from '../windows/low.js';
import { renewalDue } from '../host/connection.js';
import { helperClient } from '../host/helper-client.js';
import { HELPER_WAIT_MS } from '../lib/core-numbers.js';
import { helperGrace } from '../lib/helper-grace.js';
import { phonePushResult } from '../lib/setup-run.js';
import { readSeen } from '../briefing/seen.js';
import { readLean } from '../lean/project.js';
import { readStatus } from '../safekeeping/readings.js';
import { readFrontDeskModel } from '../lib/front-desk-model.js';
import { agentSandboxLine } from '../agents/sandbox-line.js';

export const NOT_A_PROJECT = 'This folder isn\'t part of a Wheelhouse project';
// readHostFacts keeps its own limit this far inside HELPER_WAIT_MS, so it has given up, and marked
// the helper as tried, before the reading as a whole stops waiting.
const FACTS_MARGIN_MS = 150;
// The views the glance counts from.
const GLANCE_VIEWS = ['waiting', 'questions', 'work', 'features', 'blockers'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const LATE = Symbol('late');

// The value `read` gives, or `fallback` when it throws.
function attempt(read, fallback = null) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// What the promise gives within `ms`, else LATE; a throw counts as no answer.
async function within(start, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(LATE), ms); });
  try {
    return await Promise.race([Promise.resolve().then(start), late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The weekly sources report (sources/check.js), or null when there is none or it is damaged.
function readSources() {
  return attempt(() => {
    const report = JSON.parse(fs.readFileSync(path.join(sourcesDir(), 'report.json'), 'utf8'));
    return isRecord(report) ? report : null;
  });
}

// The usage figures the glance needs: the week's share alone, never the days. A clock that
// can't be read gives no share.
// The allowance read is Claude's: a project on another agent (ruling P8-32) shows no share of it.
function glanceUsage(clock, clockRead, otherAgent = false) {
  const { share, shareAt } = clockRead && !otherAgent ? attempt(() => weeklyShare({ now: clock }), {}) : {};
  return { week: { share: share ?? null, shareAt: shareAt ?? null }, missing: [] };
}

// What the helper knows: whether it is up and who holds the lock (undefined when unknown, so
// healthLines leaves their lines out), and the host facts, from their cache when it is fresh.
async function helperFacts(project, { client, address, now, offline, clockRead, waitMs }) {
  if (offline) {
    return { helperUp: undefined, lock: undefined, facts: await readHostFacts(project, { now, ask: false }).catch(() => null) };
  }
  const asker = attempt(() => client ?? helperClient({ address, timeout: waitMs }));
  const [health, lock, asked] = await Promise.all([
    asker ? within(() => asker.health(), waitMs) : null,
    asker ? within(() => asker.lock.read({ project }), waitMs) : null,
    // It builds its own client with its own, shorter limit, so a request not answered is closed
    // and the helper marked as tried before this stops waiting. The race is a second guard.
    within(() => readHostFacts(project, { now, address, waitMs: waitMs - FACTS_MARGIN_MS, ask: clockRead }), waitMs),
  ]);
  const facts = asked === LATE ? await readHostFacts(project, { now, ask: false }).catch(() => null) : asked;
  return {
    helperUp: health?.ok === true,
    // The GitLab address, while the helper says it could not lately be reached for this project.
    away: typeof health?.away?.[project] === 'string' ? health.away[project] : undefined,
    // The engine room's line while the helper keeps it open (scripts/engine/room.js).
    engineRoom: typeof health?.engineRoom === 'string' ? health.engineRoom : undefined,
    lock: lock !== LATE && lock?.ok === true ? (isRecord(lock.result) ? lock.result : null) : undefined,
    facts,
  };
}

// loadBoardInputs({ cwd, client, address, now, offline, waitMs, findBrowser }) ->
//   { project, model, usage, sources, settings } inside a Wheelhouse project, else { none }.
// `settings` are the settings in force (effectiveSettings), `usage` the week's figures and
// `sources` the weekly report, for the briefing and the settings text. `waitMs` (at most
// HELPER_WAIT_MS, the default, and what a test adds: helper-grace.js) is how long the helper is
// waited for. `findBrowser` stands in for the helper's way of finding its browser
// (scripts/screens/browser.js) in tests.
export async function loadBoardInputs(options = {}) {
  try {
    return await gather(isRecord(options) ? options : {});
  } catch {
    return { none: 'The Logbook\'s inputs couldn\'t be read this time' };
  }
}

async function gather({ cwd, client, address, now = () => new Date(), offline = false, waitMs: asked, findBrowser }) {
  // A wait too short to leave readHostFacts its margin is no wait at all, so it gives the usual one.
  const most = HELPER_WAIT_MS + helperGrace();
  const waitMs = Number.isInteger(asked) && asked > FACTS_MARGIN_MS && asked <= most ? asked : most;
  const found = attempt(() => (typeof cwd === 'string' && path.isAbsolute(cwd) ? projectOf(cwd) : null));
  if (!found) return { none: NOT_A_PROJECT };
  const { project, record, locked, lean } = found;
  // The time as a Date: an unreadable clock gives an invalid one, which the model names.
  const clock = () => attempt(() => new Date(typeof now === 'function' ? now() : now), new Date(NaN));
  const clockRead = !Number.isNaN(clock().getTime());

  const views = attempt(() => localViews(project, offline ? GLANCE_VIEWS : null));
  const events = offline ? [] : attempt(() => listEvents(stateDir(project), { report: () => {}, skipped: [] }), []);
  const profileViews = offline ? null : attempt(() => readProfileViews());
  const settings = offline ? null : attempt(() => effectiveSettings({
    project: isRecord(views?.settings) ? views.settings : {}, profile: isRecord(profileViews?.settings) ? profileViews.settings : {}, now: clock,
  }));
  const factor = settings?.unusualFactor?.value;
  // The agent the project runs on here: a Lean project's record names it, else the project's configuration.
  const usageAgent = attempt(() => (lean === true ? readLean(project)?.agent : agentInFolder(record.folder, { computerId: computerId() }))) ?? null;
  const usage = offline
    ? glanceUsage(clock, clockRead, typeof usageAgent === 'string' && usageAgent !== 'claude-code')
    : attempt(() => usageFigures({ project, now: clock, factor, agent: usageAgent }));
  const sources = offline ? null : readSources();

  const known = await helperFacts(project, { client, address, now: clock, offline, clockRead, waitMs }).catch(() => ({}));
  // On Windows, the level build commands run at on this computer: Guarded only while this
  // computer's self-test passes.
  const builds = process.platform === 'win32'
    ? attempt(() => buildsShown({ views, computer: computerId(), locked, guardedReady: guardedReady({ home: wheelhouseHome(), now: clock, platform: process.platform }) }))
    : null;
  const lines = attempt(() => healthLines({
    record,
    locked,
    stop: stopState(),
    lock: known.lock,
    helperUp: known.helperUp,
    facts: known.facts ?? null,
    // Offline, no key file is opened: the glance has no renewal to show.
    renewal: offline ? null : attempt(() => renewalDue(record.connection, clock)),
    platform: process.platform,
    realUsers: settings?.phase?.value === 'launched',
    builds,
    // Whether an approval asks again after an update for want of Chrome: from the configuration in
    // the project's main folder. The glance shows no line of its level, so offline it isn't looked for.
    screens: offline ? null : attempt(() => readScreens({ folder: record.folder, ...(findBrowser ? { findBrowser } : {}) })),
    // Offline, the setup journal isn't read: the glance shows no push test.
    phonePush: offline ? null : attempt(() => phonePushResult()),
    // The model the front desk last ran on here and the one the main folder's configuration pins.
    frontDeskModel: offline ? null : attempt(() => readFrontDeskModel({ project, folder: record.folder })),
    // The agent's sandbox on this computer, for an agent whose adapter says (agentSandboxLine).
    agentSandbox: !offline && typeof usageAgent === 'string' ? attempt(() => agentSandboxLine(usageAgent)) : undefined,
    // Lean projects keep their own copy step, and have no status.
    safekeeping: lean === true ? null : attempt(() => readStatus(project)),
  }));
  const health = Array.isArray(lines) && typeof known.engineRoom === 'string' ? [...lines, { level: 'watch', text: known.engineRoom }] : lines;

  // What is new is counted from the last briefing. The glance counts nothing new, so offline it isn't read.
  const since = offline ? null : attempt(() => readSeen(project, { now: clock }).briefedAt);
  // A Lean project's agent lines (ruling P5-31): the agent its record names, at Lean, where Node.js runs this
  // board, with the helper's block only while the helper answers. A project on a code host gets none until its
  // tier is placed.
  const leanAgent = lean === true ? attempt(() => readLean(project)?.agent) : undefined;
  const agent = typeof leanAgent === 'string'
    ? { name: leanAgent, tier: 'lean', helper: known.helperUp === true, node: true, platform: process.platform }
    : undefined;
  const model = boardModel({ project, views, profileUnconfirmed: profileViews?.unconfirmed, events, usage, health, settings, sources, hostUnreachable: known.away, agent, local: record.host === 'local', now: clock, since });
  return { project, model, usage, sources, settings };
}
