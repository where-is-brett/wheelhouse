// scripts/alerts/tick.js
// The watcher's side of the phone alert. Each tick it is given the decisions that wait, and asks the helper (the only one that
// holds a channel's topic or token, and the only one that sends) to send one alert when a decision is newly waiting. An alert is
// never sent for progress, only for a decision that waits for the director.
//
// What it keeps, in projects/<project>/alerts.json: `ids`, the decisions already alerted (so each is alerted once), and
// `failures`, the channels an alert could not reach after its one more try, which the next digest says. A decision whose alert
// was held by the quiet hours, or that had no channel to go to, is not marked, so it is asked again when it can be sent. Nothing
// here answers a decision, and a failure never turns into an answer: the decision waits in the chat whatever happens.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// The most failures kept.
const MOST_FAILURES = 20;

export function alertsFile(project) {
  return path.join(path.dirname(stateDir(project)), 'alerts.json');
}

// { ids, failures: [{ at, channels }] }; empty when the file can't be read.
export function readAlerts(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(alertsFile(project), 'utf8'));
    if (!isRecord(kept)) return { ids: [], failures: [] };
    return {
      ids: Array.isArray(kept.ids) ? kept.ids.filter((id) => typeof id === 'string') : [],
      failures: (Array.isArray(kept.failures) ? kept.failures : []).filter((f) => isRecord(f) && typeof f.at === 'string' && Array.isArray(f.channels))
        .map((f) => ({ at: f.at, channels: f.channels.filter((c) => typeof c === 'string') })).slice(-MOST_FAILURES),
    };
  } catch {
    return { ids: [], failures: [] };
  }
}

export function writeAlerts(project, kept) {
  const file = alertsFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(kept, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Forgets the oldest `count` failures (all, when none is named) and returns them: what the alerts could not reach, which a digest the
// director was shown has said.
export function takeFailures(project, count = Infinity) {
  const kept = readAlerts(project);
  if (kept.failures.length === 0) return [];
  const taken = kept.failures.slice(0, count);
  writeAlerts(project, { ...kept, failures: kept.failures.slice(taken.length) });
  return taken;
}

// The waiting decisions no alert was sent for.
export const newlyWaiting = (pending, ids) => (Array.isArray(pending) ? pending : []).filter((d) => isRecord(d) && typeof d.id === 'string' && !ids.includes(d.id));

// alertTick({ project, pending, client, now }) -> { asked, sent?, held?, none?, failed? }. `pending` is pendingDecisions' list;
// `client.alert({ project, count })` is the helper's route, which answers { ok, none } | { ok, held } | { ok, sent, failed }.
export async function alertTick({ project, pending, client, now = () => new Date() }) {
  const kept = readAlerts(project);
  const waiting = (Array.isArray(pending) ? pending : []).filter((d) => isRecord(d) && typeof d.id === 'string');
  const here = kept.ids.filter((id) => waiting.some((d) => d.id === id));
  const fresh = newlyWaiting(waiting, here);
  if (fresh.length === 0) {
    if (here.length !== kept.ids.length) writeAlerts(project, { ...kept, ids: here });
    return { asked: false };
  }
  const got = await client.alert({ project, count: waiting.length });
  if (got?.ok !== true) throw new Error(typeof got?.refused === 'string' ? got.refused : 'the helper gave no answer');
  if (got.none === true || got.held === true) {
    if (here.length !== kept.ids.length) writeAlerts(project, { ...kept, ids: here });
    return { asked: true, ...(got.none === true ? { none: true } : { held: true }) };
  }
  const failed = Array.isArray(got.failed) ? got.failed.filter((c) => typeof c === 'string') : [];
  // Sent to one channel at least, or tried on each and failed: either way this decision is not alerted again.
  writeAlerts(project, {
    ids: [...here, ...fresh.map((d) => d.id)],
    failures: failed.length === 0 ? kept.failures : [...kept.failures, { at: now().toISOString(), channels: failed }].slice(-MOST_FAILURES),
  });
  return { asked: true, sent: got.sent === true, failed };
}
