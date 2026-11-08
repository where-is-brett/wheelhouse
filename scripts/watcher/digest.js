// scripts/watcher/digest.js
// The watcher's step for the director's day (design section 9 of the director's way of working). Each tick it does two things:
//   1. a phone alert, when a decision is newly waiting: it asks the helper (the only one that holds a channel and sends) for one
//      alert saying how many decisions wait, once per decision, never for progress (scripts/alerts/tick.js);
//   2. the daily digest, once a day after `digestAt` (a setting, 17:00 local time unless changed; there is no cron): it makes the
//      digest from the project's record and keeps it until the director's next message, which shows it once
//      (scripts/hooks/board-context.js). On the first digest seven days or more after the last it carries the decision log too.
//
// Nothing here answers a decision, and nothing turns a missing reply or a failed alert into one: a decision that waits keeps
// waiting in the chat, and an alert that couldn't be sent is noted in the digest. Each step fails on its own and is tried again at
// the next tick.
import { alertTick, readAlerts } from '../alerts/tick.js';
import { digestDue, logDue, readDigest, writeDigest } from '../digest/due.js';
import { digestModel, digestText, hasNews } from '../digest/model.js';
import { callsFrom } from '../decisions/calls.js';
import { decisionsFrom } from '../decisions/pending.js';
import { readDigestSeen, markSeen } from '../briefing/seen.js';
import { effectiveSettings } from '../settings/effective.js';
import { readProfileViews } from '../profile/store.js';
import { usageFigures } from '../usage/figures.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { stateDir } from '../lib/paths.js';
import { buildViews } from '../state/views.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const quiet = { report: () => {} };

// The seams a test replaces: what is read from the record, the settings and the usage files.
const REAL = {
  events: (project) => listEvents(stateDir(project), quiet),
  enrolled: () => readEnrolled(),
  settings: (now) => effectiveSettings({ profile: readProfileViews()?.settings ?? {}, now }),
  usage: (project, now) => usageFigures({ project, now }),
};

export function makeDigestTicker({ project, client, now = () => new Date(), log = () => {}, read = {} }) {
  const reader = { ...REAL, ...read };

  async function alertStep(waiting) {
    try {
      return await alertTick({ project, pending: waiting, client, now });
    } catch (error) {
      log(`A phone alert couldn't be sent: ${error.message}`);
      return null;
    }
  }

  function digestStep(t, events, enrolled) {
    const at = reader.settings(t).digestAt?.value;
    const seen = readDigestSeen(project, { now: t });
    if (!digestDue({ seen, now: t, at })) return { made: false };
    // A digest still waiting is replaced by this one, which carries on what it carried: the weekly log and the failed alerts.
    const waiting = readDigest(project);
    const weekly = logDue({ seen, now: t }) || waiting?.weekly === true;
    let usage = null;
    try {
      usage = reader.usage(project, t);
    } catch {
      // Usage that can't be read is left out of the digest, which says it isn't known.
    }
    // The log runs from the last one the director was shown, so a log made but never shown is made again.
    const logFrom = Date.parse(seen.digestLogShownAt ?? '');
    const calls = weekly ? callsFrom(events, { since: new Date(Number.isFinite(logFrom) ? logFrom : t.getTime() - 7 * DAY_MS) }) : [];
    const failed = readAlerts(project).failures;
    let held = [];
    try {
      held = Object.entries(buildViews(events, enrolled).helm ?? {}).map(([work, h]) => ({ work, since: h.since }));
    } catch {
      // Pieces held that can't be read are left out of the digest.
    }
    const model = digestModel({
      events, enrolled, calls, usage, held, now: t, weekly, since: seen.digestShownAt ?? undefined,
      pending: decisionsFrom(events, enrolled).pending,
      alertFailures: failed.flatMap((f) => f.channels),
    });
    const made = hasNews(model);
    if (made) writeDigest(project, { at: t.toISOString(), text: digestText(model, { now: t }), weekly, failures: failed.length });
    // Marked made whether or not it had news, so a quiet day is not looked at again every tick.
    markSeen(project, { digestAt: t, ...(weekly ? { digestLogAt: t } : {}) });
    // The failures it says stay in alerts.json until the director is shown the digest (the hook clears them then).
    return { made, weekly };
  }

  async function tick() {
    const t = now();
    let events = [];
    let enrolled = [];
    let waiting = [];
    try {
      events = reader.events(project);
      enrolled = reader.enrolled();
      waiting = decisionsFrom(events, enrolled).pending;
    } catch (error) {
      log(`The record couldn't be read for the digest: ${error.message}`);
      return { alert: null, digest: null };
    }
    const alert = await alertStep(waiting);
    let digest = null;
    try {
      digest = digestStep(t, events, enrolled);
    } catch (error) {
      log(`The daily digest couldn't be made: ${error.message}`);
    }
    return { alert, digest };
  }

  return { tick };
}
