// scripts/checks/runner.js
// A check's life on a project whose checks run here (spec 4.3), run by the helper: a new head is reported pending at once and
// queued, each tick adds the default branch's head and starts what is due, and the result is signed before it is reported.
// What is reported is read back from the signed record, so nothing a test wrote or left in a file can decide it. A check
// runs apart from the tick, which never waits for one. A check that couldn't run twice stops running until a new head, a
// changed command or the director's Try again, so it can't keep running or keep raising cards. On a project whose checks
// run on the host nothing is run or reported: the runner only watches for host checks that have stopped reporting.
import { dueChecks, withCheckTurn } from './queue.js';
import { writeCheck } from './record.js';
import { runCheck } from './run.js';
import { keepQueue, readQueue } from './standing.js';
import { stuckHostChecks, whereChecks } from './where.js';
import { LEAVE_THEM, RUN_CHECKS_HERE } from '../state/card-lines.js';

export const CHECK_CARD_WORK = 'checks';
export const CHECK_TRY_AGAIN = 'Try again';
export const CHECK_LEAVE_IT = 'Leave it';
const NOT_RAN_LIMIT = 2;
const KEPT_READINGS = 3;

const STATUS = {
  passed: { state: 'success', description: 'The tests passed on this computer' },
  'not-counted': { state: 'success', description: 'Tests not counted yet' },
  failed: { state: 'failure', description: 'The tests failed on this computer' },
  'timed-out': { state: 'failure', description: 'The tests ran out of time on this computer' },
  'could-not-run': { state: 'pending', description: 'The tests couldn\'t run on this computer yet' },
};
const CHECKING = { state: 'pending', description: 'Checking on this computer' };
const isRed = (word) => word === 'failed' || word === 'timed-out';

// checkRunner({ project, repo, permissionLink, adapter, facts, source, results, write, onRed, card, answerOf, ended, stopped,
//   openHeads, now, run, turn }) -> { took(head, work), tick(), stop(), idle() }.
// - `facts()` what the helper reads from the default branch and the host: { setting, host, contexts, hasWorkflows, main,
//   settings, digest }; `source()` the folder a check fetches from, brought up to date;
// - `results()` the data of the signed `check` events, verified, oldest first; `write({ project, event })` signs and keeps one;
// - `onRed(head, work, tail)` sends a change back; `card(data)` raises a question; `answerOf(id)` the label the director chose;
// - `ended(work)` whether a work's change has merged or closed; `stopped()` whether All stop is on;
// - `openHeads()` [{ head, work }], the open changes' heads as the host has them, for a head nothing told the helper of.
export function checkRunner({
  project, repo, permissionLink, adapter, facts, source, results, write, onRed, card, answerOf = () => null, ended = () => false, stopped = () => false,
  openHeads = async () => [], now = () => new Date(), run = runCheck, turn = withCheckTurn,
}) {
  let active = null;
  let abort = null;
  const change = (fn) => {
    const kept = readQueue(project);
    fn(kept);
    keepQueue(project, kept);
    return kept;
  };
  const latest = (commit, digest) => results().filter((r) => r.commit === commit && r.command === digest).at(-1) ?? null;
  const askedId = (kept) => `q-${CHECK_CARD_WORK}-${(kept.cards += 1)}`;

  async function ask(name, data) {
    const kept = readQueue(project);
    if (kept.asked[name]) return;
    const id = askedId(kept);
    kept.asked[name] = id;
    keepQueue(project, kept);
    await card({ id, work: CHECK_CARD_WORK, level: 3, ...data });
  }

  const askPermission = () => ask('permission', {
    what: `Wheelhouse has this project's check results but isn't allowed to tell GitHub, so nothing can be added to the main line yet. Accept the one new permission here: ${permissionLink}`,
    why: 'Giving Wheelhouse a new permission on GitHub is yours to decide, at level 3.',
    options: [
      { label: 'I\'ve accepted it', says: 'Wheelhouse tells GitHub the results it is holding, and the work carries on.' },
      { label: 'Leave it', says: 'Finished work waits. The checks still run, and nothing is added to the main line.' },
    ],
    recommendation: 'I\'ve accepted it',
  });

  const askNotRan = () => ask('notRan', {
    what: 'This project\'s checks couldn\'t run on this computer, twice in a row, so they\'ve stopped trying. Finished work waits, and nothing is added to the main line.',
    why: 'Wheelhouse can\'t tell from here whether something is wrong with this computer or only a passing fault, so whether to try again is yours to decide, at level 3.',
    options: [
      { label: CHECK_TRY_AGAIN, says: 'It runs the checks again now.' },
      { label: CHECK_LEAVE_IT, says: 'It waits, and the checks run when there is a new version to check.' },
    ],
    recommendation: CHECK_TRY_AGAIN,
  });

  const askBroken = () => ask('broken', {
    what: 'GitHub\'s checks for this project aren\'t running: on the last two versions they waited or stopped with no job started, so nothing can be added to the main line.',
    why: 'Wheelhouse isn\'t allowed to change a project\'s settings on GitHub, so turning those checks off takes your click, at level 3.',
    options: [
      { label: RUN_CHECKS_HERE, says: `Open https://github.com/${repo}/settings/actions, choose Disable actions and press Save. You can turn them back on there at any time. Wheelhouse sees them stop, and runs the checks on this computer.` },
      { label: LEAVE_THEM, says: 'Wheelhouse keeps waiting for GitHub\'s checks, and finished work waits with them.' },
    ],
    recommendation: RUN_CHECKS_HERE,
  });

  // Reports a commit, from the signed record: 'pending' while it has none for this command. A status that can't post is kept
  // and tried again on the next tick; the record stands meanwhile.
  async function report(commit, digest, checking = false) {
    const record = checking ? null : latest(commit, digest);
    const status = record ? STATUS[record.result] : CHECKING;
    let got;
    try {
      got = await adapter.setStatus({ sha: commit, ...status });
    } catch {
      got = { refused: 'unreachable' };
    }
    const posted = got?.ok === true;
    const kept = change((q) => {
      q.unposted = q.unposted.filter((c) => c !== commit);
      if (!posted) q.unposted.push(commit);
      if (posted) q.waitingForPermission = false;
      else if (got?.refused === 'permission') q.waitingForPermission = true;
    });
    if (kept.waitingForPermission) await askPermission();
    return posted;
  }

  function settleTries(answer, commit, digest, wasStopped) {
    const key = `${commit}:${digest}`;
    return change((q) => {
      if (wasStopped) return;
      if (answer.result !== 'could-not-run') {
        delete q.tries[key];
        q.streak = 0;
        delete q.asked.notRan;
        return;
      }
      q.tries[key] = (q.tries[key] ?? 0) + 1;
      q.streak += 1;
    });
  }

  async function checkOne({ commit, main }, { settings, digest }) {
    const controller = new AbortController();
    abort = controller;
    await report(commit, digest, true);
    const answer = await turn(async () => {
      if (controller.signal.aborted) return null;
      const from = await source();
      change((q) => { q.checkingUntil = new Date(now().getTime() + settings.minutes * 60000).toISOString(); });
      try {
        return await run({ project, commit, main, settings, source: from, signal: controller.signal });
      } finally {
        change((q) => { q.checkingUntil = null; });
      }
    });
    if (answer === null) return;
    const event = await writeCheck(project, answer, { write });
    const kept = settleTries(answer, commit, digest, controller.signal.aborted);
    if (stopped()) {
      change((q) => { if (!q.unposted.includes(commit)) q.unposted.push(commit); });
      return;
    }
    await report(commit, digest);
    if (kept.streak >= NOT_RAN_LIMIT) await askNotRan();
    if (main || !isRed(answer.result)) return;
    const head = readQueue(project).heads.find((h) => h.commit === commit);
    if (!head || head.redFor === digest) return;
    change((q) => { q.heads.find((h) => h.commit === commit).redFor = digest; });
    await onRed(commit, head.work, event.data.tail);
  }

  // The director's answer to the card for a check that couldn't run: Try again gives every held head its tries back.
  function answered() {
    const kept = readQueue(project);
    const id = kept.asked.notRan;
    if (!id) return;
    const label = answerOf(id);
    if (label === CHECK_TRY_AGAIN) {
      change((q) => {
        q.tries = {};
        q.streak = 0;
        delete q.asked.notRan;
      });
    }
  }

  // What the host's checks are doing on the newest heads seen, read while the project's checks are the host's.
  async function watchHost(f) {
    if (f.setting === 'host' || f.setting === 'here') return;
    const stamp = now().toISOString();
    const kept = readQueue(project);
    if (f.main && !kept.readings.some((r) => r.head === f.main)) kept.readings.push({ head: f.main, firstSeen: stamp, readAt: stamp, contexts: [] });
    kept.readings = kept.readings.slice(-KEPT_READINGS);
    for (const reading of kept.readings.slice(-2)) {
      try {
        reading.contexts = await adapter.checkContexts(reading.head);
        reading.readAt = stamp;
      } catch { /* read again on the next tick */ }
    }
    keepQueue(project, kept);
    if (!kept.asked.broken && stuckHostChecks(kept.readings)) await askBroken();
  }

  // Queues a head, once for each head of a work.
  function queued(head, work) {
    const stamp = now().toISOString();
    change((q) => {
      q.heads = [...q.heads.filter((h) => h.work !== work && h.commit !== head), { commit: head, work }];
      q.readings = [...q.readings.filter((r) => r.head !== head), { head, firstSeen: stamp, readAt: stamp, contexts: [] }].slice(-KEPT_READINGS);
    });
  }

  async function takeOpenHeads(digest) {
    let open = [];
    try { open = await openHeads(); } catch { return; }
    for (const { head, work } of open) {
      if (readQueue(project).heads.some((h) => h.commit === head)) continue;
      queued(head, work);
      await report(head, digest, true);
    }
  }

  async function tick() {
    if (stopped()) return;
    const f = await facts();
    if (f === null || f === undefined) return;
    change((q) => { q.heads = q.heads.filter((h) => !ended(h.work)); });
    let kept = readQueue(project);
    if (!kept.hostChecksOff && kept.asked.broken && answerOf(kept.asked.broken) === RUN_CHECKS_HERE) kept = change((q) => { q.hostChecksOff = true; });
    if (whereChecks({ ...f, hostChecksOff: kept.hostChecksOff }) !== 'here') {
      await watchHost(f);
      return;
    }
    if (typeof f.settings?.testCommand !== 'string') return;
    answered();
    for (const commit of kept.unposted) await report(commit, f.digest);
    await takeOpenHeads(f.digest);
    if (active !== null) return;
    const held = readQueue(project).tries;
    const due = dueChecks({ main: f.main, heads: readQueue(project).heads.map((h) => h.commit), results: results(), digest: f.digest })
      .filter(({ commit }) => (held[`${commit}:${f.digest}`] ?? 0) < NOT_RAN_LIMIT);
    if (due.length === 0) return;
    // A check whose record can't be kept counts as one that couldn't run, or it would run again on every tick.
    active = checkOne(due[0], f).catch(async () => {
      if (settleTries({ result: 'could-not-run' }, due[0].commit, f.digest, false).streak >= NOT_RAN_LIMIT) await askNotRan();
    }).catch(() => {}).finally(() => {
      active = null;
      abort = null;
    });
  }

  return {
    // A head the helper took in: reported pending at once where the project's checks run here, and queued in its work's place.
    async took(head, work) {
      queued(head, work);
      const f = await facts();
      if (!f || stopped() || typeof f.settings?.testCommand !== 'string') return;
      if (whereChecks({ ...f, hostChecksOff: readQueue(project).hostChecksOff }) === 'here') await report(head, f.digest, true);
    },
    tick,
    // All stop: ends the check under way. Its result is could-not-run, and it runs again after All stop lifts.
    async stop() {
      abort?.abort();
      await active;
    },
    idle: async () => { await active; },
  };
}
