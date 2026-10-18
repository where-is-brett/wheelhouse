// scripts/board/inputs.js
// Everything the board, the briefing and the glance need, gathered for the folder a session
// works in. It reads files only and never runs git: the views as the last sync left them, the
// raw events in the state clone, the settings views, the usage store, the sources report, STOP,
// the project's record and the host facts' cache. The helper is asked only for whether it is
// up, who holds the project's lock and, once a day, the host facts, each within HELPER_WAIT_MS
// and all of them together within it too. With `offline` (the status line, which has half a
// second) nothing is asked of the helper, no raw events are read (the glance needs none), and
// what only the helper knows is left out. Nothing here throws: what can't be read is passed on
// as missing, and boardModel names it.
import fs from 'node:fs';
import path from 'node:path';
import { boardModel } from './model.js';
import { healthLines, readHostFacts } from './health.js';
import { projectOf } from '../hooks/kit.js';
import { localViews } from '../hooks/session-start.js';
import { listEvents } from '../state/events.js';
import { usageFigures } from '../usage/figures.js';
import { effectiveSettings } from '../settings/effective.js';
import { readProfileViews, profileRemote } from '../profile/store.js';
import { stopState } from '../lib/stop.js';
import { sourcesDir, stateDir } from '../lib/paths.js';
import { renewalDue } from '../host/connection.js';
import { helperClient } from '../host/helper-client.js';

export const HELPER_WAIT_MS = 2000;
export const NOT_A_PROJECT = 'This folder isn\'t part of a Wheelhouse project';

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

// What the helper knows: whether it is up and who holds the lock (undefined when unknown, so
// healthLines leaves their lines out), and the host facts, from their cache when it is fresh.
async function helperFacts(project, { client, address, now, offline, clockRead }) {
  if (offline) {
    return { helperUp: undefined, lock: undefined, facts: await readHostFacts(project, { now, ask: false }).catch(() => null) };
  }
  const asker = attempt(() => client ?? helperClient({ address, timeout: HELPER_WAIT_MS }));
  const [health, lock, facts] = await Promise.all([
    asker ? within(() => asker.health(), HELPER_WAIT_MS) : null,
    asker ? within(() => asker.lock.read({ project }), HELPER_WAIT_MS) : null,
    // It builds its own client, with the same limit, so a request not answered is closed.
    within(() => readHostFacts(project, { now, address, waitMs: HELPER_WAIT_MS, ask: clockRead }), HELPER_WAIT_MS),
  ]);
  return {
    helperUp: health?.ok === true,
    lock: lock !== LATE && lock?.ok === true ? (isRecord(lock.result) ? lock.result : null) : undefined,
    facts: facts === LATE ? null : facts,
  };
}

// loadBoardInputs({ cwd, client, address, now, offline }) ->
//   { project, model, usage, sources, settings } inside a Wheelhouse project, else { none }.
// `settings` are the settings in force (effectiveSettings), `usage` the week's figures and
// `sources` the weekly report, for the briefing and the settings text.
export async function loadBoardInputs(options = {}) {
  try {
    return await gather(isRecord(options) ? options : {});
  } catch {
    return { none: 'The board\'s inputs couldn\'t be read this time' };
  }
}

async function gather({ cwd, client, address, now = () => new Date(), offline = false }) {
  const found = attempt(() => (typeof cwd === 'string' && path.isAbsolute(cwd) ? projectOf(cwd) : null));
  if (!found) return { none: NOT_A_PROJECT };
  const { project, record, locked } = found;
  // The time as a Date: an unreadable clock gives an invalid one, which the model names.
  const clock = () => attempt(() => new Date(typeof now === 'function' ? now() : now), new Date(NaN));
  const clockRead = !Number.isNaN(clock().getTime());

  const views = attempt(() => localViews(project, null));
  const events = offline ? [] : attempt(() => listEvents(stateDir(project), { report: () => {}, skipped: [] }), []);
  const profileViews = attempt(() => readProfileViews());
  const settings = attempt(() => effectiveSettings({
    project: isRecord(views?.settings) ? views.settings : {}, profile: isRecord(profileViews?.settings) ? profileViews.settings : {}, now: clock,
  }));
  const factor = settings?.unusualFactor?.value;
  const usage = attempt(() => usageFigures({ project, now: clock, factor }));
  const sources = readSources();

  const known = await helperFacts(project, { client, address, now: clock, offline, clockRead }).catch(() => ({}));
  const health = attempt(() => healthLines({
    record,
    locked,
    stop: stopState(),
    lock: known.lock,
    helperUp: known.helperUp,
    facts: known.facts ?? null,
    renewal: attempt(() => renewalDue(record.connection, clock)),
    profile: attempt(() => profileRemote()),
    platform: process.platform,
    realUsers: settings?.phase?.value === 'launched',
  }));

  const model = boardModel({ project, views, events, usage, health, settings, sources, now: clock });
  return { project, model, usage, sources, settings };
}
