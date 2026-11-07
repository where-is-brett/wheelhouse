// scripts/watcher/decision-batch.js
// The watcher's daily step for decision records (design section 6.6 of the director's way of working). The first tick after
// local midnight asks the helper to batch the previous day's decision records that belong to no piece (or to a dropped one) into
// one change that touches only docs/decisions/. The helper does the work and the merge; this only asks, once a day, and again
// later while the change is still opening or waiting. A refusal or an error is noted and tried again; it is never taken as done.
//
// The same tick keeps whether the repository is public, read through the helper every few hours, so a decision message offers
// "private" only on a public project (scripts/decisions/visibility.js).
import { dayOf } from '../decisions/record-file.js';

// How long a change that is opening, waiting or refused is left before it is asked about again.
export const RETRY_MS = 10 * 60 * 1000;
// How often whether the repository is public is read again.
export const PUBLIC_MS = 6 * 60 * 60 * 1000;

// The calendar day before `t` on this computer, as yyyy-mm-dd.
const dayBefore = (t) => dayOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1, 12));

export function makeDecisionBatcher({ project, client, now = () => new Date(), log = () => {} }) {
  let doneDay = null;
  let retryAt = 0;
  let publicAt = null;

  async function readPublic(t) {
    if (publicAt !== null && t.getTime() - publicAt < PUBLIC_MS) return;
    publicAt = t.getTime();
    try {
      await client.host.public({ project });
    } catch (error) {
      log(`Whether the repository is public couldn't be read: ${error.message}`);
    }
  }

  async function tick() {
    const t = now();
    await readPublic(t);
    const today = dayOf(t);
    if (doneDay === today || t.getTime() < retryAt) return null;
    let got;
    try {
      got = await client.decisions.batch({ project, date: dayBefore(t) });
    } catch (error) {
      retryAt = t.getTime() + RETRY_MS;
      log(`The day's decision records couldn't be batched: ${error.message}`);
      return null;
    }
    if (got?.ok !== true) {
      retryAt = t.getTime() + RETRY_MS;
      log(`The day's decision records weren't batched: ${typeof got?.refused === 'string' ? got.refused : 'the helper gave no answer'}`);
      return got ?? null;
    }
    if (got.step === 'none' || got.step === 'merged') doneDay = today;
    else retryAt = t.getTime() + RETRY_MS;
    return got;
  }

  return { tick };
}
