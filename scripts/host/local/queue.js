// scripts/host/local/queue.js
// The local queue (spec 7.4): the one place a Wheelhouse piece stands in for Archon, whose merge queue needs a forge (A6). A
// script: no model and no tokens, since with every fact exact what the sweep decides is a table. With no host this is the last
// gate before the main line. The rows copy Archon's gate, and the monthly upgrade reads the files GATE_ROWS names for changes.
import { classifyChange } from '../../gate/guardrails.js';
import { withLocalLock } from '../../lib/local-git.js';
import { projectFolder } from './home.js';

// The table in its order: what each row finds, what it does, and the file of Archon's it copies.
export const GATE_ROWS = Object.freeze([
  { row: 'main-red', act: 'hold', archon: '.shared/merge.ts (the main line holds merges when red)' },
  { row: 'stopped', act: 'hold', archon: 'merge-queue/scripts/facts.ts (nothing moves under a hold)' },
  { row: 'incident', act: 'hold', archon: 'merge-queue/commands/sweep.md (only the fix goes on)' },
  // Not Archon's, whose main line waits for nothing: with no host the main line's own check is the only clean run a merge
  // gets, so each one comes back before the next merge, and a red names its one suspect.
  { row: 'main-waiting', act: 'wait', archon: null },
  { row: 'check-waiting', act: 'wait', archon: '.shared/merge.ts (pending checks wait)' },
  { row: 'check-red', act: 'send-back', archon: 'merge-queue/commands/sweep.md (a failed check goes back)' },
  { row: 'review-stale', act: 'send-back', archon: 'merge-queue/commands/sweep.md (a stale verdict goes back)' },
  { row: 'clash', act: 'send-back', archon: 'merge-queue/commands/sweep.md (a conflict goes back)' },
  { row: 'approval', act: 'raise', archon: 'merge-queue/commands/sweep.md (an unclear change is asked about)' },
  { row: 'permit', act: 'wait', archon: '.shared/merge.ts (the gate refuses)' },
  { row: 'merge', act: 'merge', archon: '.shared/merge.ts' },
]);

const answer = (row, reason = row) => ({ act: GATE_ROWS.find((r) => r.row === row).act, reason });

// What the sweep does with one open change that is ready, pure, in the table's order. `main` is 'red', 'waiting' or 'green';
// `incident` is incidentFor's; `check` the head's own reading, 'waiting', 'red' or 'green'; `review` whether a signed CLEAN
// review of the head counts; `clashes` whether the head no longer merges; `permit` brokerDecision's answer.
export function sweepDecision({ main, stopped, incident, check, review, clashes, needsApproval, approval, permit }) {
  if (main === 'red') return answer('main-red');
  if (stopped !== false) return answer('stopped');
  if (incident?.open !== false && incident?.isFix !== true) return answer('incident');
  if (main !== 'green') return answer('main-waiting');
  if (check === 'red') return answer('check-red', 'red');
  if (check !== 'green') return answer('check-waiting');
  if (review !== true) return answer('review-stale', 'stale');
  if (clashes === true) return answer('clash');
  if (needsApproval === true && approval !== true) return answer('approval');
  if (permit?.allow !== true) return answer('permit', permit?.reason ?? 'the permit gave no answer');
  return answer('merge');
}

// What the records say of a head for the command now on the default branch. Read from the signed records alone, so the state's
// words on a host can't stand in. A check that couldn't run has no answer yet, and a not-counted one has none for a project
// whose tests count: it is checked again.
export function headReading({ records, head, digest, notCounting = false }) {
  const newest = records.filter((r) => r.commit === head && r.command === digest).at(-1);
  if (newest === undefined) return 'waiting';
  if (newest.result === 'passed' || (newest.result === 'not-counted' && notCounting)) return 'green';
  return newest.result === 'failed' || newest.result === 'timed-out' ? 'red' : 'waiting';
}

// A change the director clicks for (spec 7.4): the permit's own cases, and from Archon's "unclear" list as a set rule, a
// project's critical area or anything under `.archon/`.
export function needsApprovalOf({ permit = {}, paths = [], config }) {
  if (permit.shownFirst === true || permit.level === 4 || permit.guardrail === true) return true;
  if (paths.some((file) => String(file).replace(/\\/g, '/').startsWith('.archon/'))) return true;
  return classifyChange({ paths, config }).criticalAreas.length > 0;
}

// One sweep, inside the project's lock, the oldest change first. Each finding is read as its turn comes, since a merge moves
// the main line. Gives what happened to each change, [{ n, act, reason }]. `facts` is:
// - `changes()` the open changes, oldest first; `ready()` the changes marked ready, { [n]: { head, work } };
// - `main()` the main line's reading; `moved()` whether something moved the main version outside the helper; `stopped()`;
// - `about(change)` { incident, check, review, clashes, needsApproval, approval, permit, level }, what sweepDecision needs;
// and `acts` is { merge(change), sendBack(change, reason, work), raise(change, ready), wait(change, reason) }.
export async function localSweep({ project, facts, acts, lock = withLocalLock, now = () => new Date() }) {
  return lock({ dir: projectFolder(project) }, async () => {
    const done = [];
    if (await facts.moved()) return done;
    const ready = facts.ready();
    for (const change of facts.changes()) {
      const marked = ready[change.n];
      // A head that moved since it was marked belongs to the run that moved it, which marks it again.
      if (marked === undefined || marked.head !== change.head) continue;
      const about = await facts.about(change);
      const decided = sweepDecision({ main: await facts.main(), stopped: facts.stopped(), ...about });
      done.push({ n: change.n, ...decided });
      if (decided.act === 'hold') break;
      if (decided.act === 'merge') await acts.merge(change, marked);
      else if (decided.act === 'send-back') await acts.sendBack(change, decided.reason, marked.work);
      else if (decided.act === 'raise') await acts.raise(change, { ...marked, level: about.level });
      else await acts.wait(change, decided.reason);
    }
    return done;
  }, { now });
}
