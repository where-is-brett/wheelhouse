// scripts/checks/runner.js
// A check's life on a project whose checks run here (spec 4.3), run by the helper: a new head is reported pending at once and
// queued, each tick adds the default branch's head and starts what is due, and the result is signed before it is reported.
// What is reported is read back from the signed record, so nothing a test wrote or left in a file can decide it. A check
// runs apart from the tick, which never waits for one. A check that couldn't run twice stops running until a new head, a
// changed command or the director's Try again, so it can't keep running or keep raising cards. On a project whose checks
// run on the host nothing is run or reported: the runner only watches for host checks that have stopped reporting.
import { sweepHeads } from './folder.js';
import { checksRanLine, countingEnds, mayStopCounting } from './not-counting.js';
import { dueChecks, withCheckTurn } from './queue.js';
import { writeCheck } from './record.js';
import { runCheck } from './run.js';
import { keepQueue, readQueue, whereNow } from './standing.js';
import { rulesNameOurs, stuckHostChecks } from './where.js';
import { CARRY_ON, FIRST_RED_CARD, GET_THEM_PASSING, firstCheck } from '../setup/first-check.js';
import { LEAVE_THEM, RUN_CHECKS_HERE } from '../state/card-lines.js';

export const CHECK_CARD_WORK = 'checks';
export const CHECK_TRY_AGAIN = 'Try again';
export const CHECK_LEAVE_IT = 'Leave it';
export const CHECK_ACCEPTED = 'I\'ve accepted it';
export const KEEP_REPORTING = 'Keep reporting';
const NOT_RAN_LIMIT = 2;
// How many looks in a row at rules nobody can read before it is the director's: about five minutes, past a passing fault.
const UNREAD_LIMIT = 5;
const KEPT_READINGS = 3;
const KEPT_TAKEN = 200;

const STATUS = {
  passed: { state: 'success', description: 'The tests passed on this computer' },
  'not-counted': { state: 'success', description: 'Tests not counted yet' },
  failed: { state: 'failure', description: 'The tests failed on this computer' },
  'timed-out': { state: 'failure', description: 'The tests ran out of time on this computer' },
  'could-not-run': { state: 'pending', description: 'The tests couldn\'t run on this computer yet' },
};
const CHECKING = { state: 'pending', description: 'Checking on this computer' };
// A first red waits for the director's answer: reported as red, it would start the host's merge queue on the fix by itself.
const FIRST_WAITS = { state: 'pending', description: 'Waiting for the director' };
const isRed = (word) => word === 'failed' || word === 'timed-out';

// checkRunner({ project, repo, permissionLink, adapter, facts, source, results, write, onRed, onPassed = () => {}, onFix = async () => {}, onRedMain = async () => {}, keep = async () => {}, note = async () => {}, record = async () => {}, states = () => [], card, answerOf, ended, stopped,
//   openHeads, now, run, turn, sweep }) -> { took(head, work), tick(), stop(), idle() }.
// - `facts()` what the helper reads from the default branch and the host: { setting, host, contexts, hasWorkflows, required, main,
//   settings, digest, notCounting, finder (what the finder found on the default branch), keptOnly (the command is the record's) }; `source()` the folder a check fetches from, brought up to date;
// - `results()` the data of the signed `check` events, verified, oldest first; `write({ project, event })` signs and keeps one;
// - `onRed(head, work, tail)` sends a change back; `onPassed(work)` says a work's head passed; `onFix(commit)` starts mending a
//   main line whose first check failed; `onRedMain(commit)` opens the incident for a red main line where no queue asks to; `keep()` takes a command kept only in the record to the default branch; `note(words)`
//   writes to the Logbook; `record(kind, data)` signs a `checks-state` or `checks-found`; `states()` the verified `checks-state`s; `card(data)` raises a question; `answerOf(id)` the label the director chose;
// - `ended(work)` whether a work's change has merged or closed; `stopped()` whether All stop is on;
// - `openHeads()` [{ head, work }], the open changes' heads as the host has them, for a head nothing told the helper of.
export function checkRunner({
  project, repo, permissionLink, adapter, facts, source, results, write, onRed, onPassed = () => {}, onFix = async () => {}, onRedMain = async () => {}, keep = async () => {}, note = async () => {}, record = async () => {}, states = () => [], card, answerOf = () => null, ended = () => false, stopped = () => false,
  openHeads = async () => [], now = () => new Date(), run = runCheck, turn = withCheckTurn, sweep = sweepHeads,
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

  // Raises a card once: it counts as asked when it has been written, so one that couldn't be is asked again on the next tick.
  const asking = new Set();
  async function ask(name, data) {
    if (readQueue(project).asked[name] || asking.has(name)) return;
    asking.add(name);
    try {
      const id = `q-${CHECK_CARD_WORK}-${change((q) => { q.cards += 1; }).cards}`;
      await card({ id, work: CHECK_CARD_WORK, level: 3, ...data });
      change((q) => { q.asked[name] = id; });
    } finally {
      asking.delete(name);
    }
  }

  const askPermission = () => ask('permission', {
    what: `Wheelhouse has this project's check results but isn't allowed to tell GitHub, so nothing can be added to the main line yet. Accept the one new permission here: ${permissionLink}`,
    why: 'Giving Wheelhouse a new permission on GitHub is yours to decide, at level 3.',
    options: [
      { label: CHECK_ACCEPTED, says: 'Wheelhouse tells GitHub the results it is holding, and the work carries on.' },
      { label: 'Leave it', says: 'Finished work waits. The checks still run, and nothing is added to the main line.' },
    ],
    recommendation: CHECK_ACCEPTED,
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
      { label: RUN_CHECKS_HERE, says: `Open https://github.com/${repo}/settings/actions, choose Disable actions and press Save. You can turn them back on there at any time. If https://github.com/${repo}/settings/rules asks for those checks by name, take them off the list there too. Wheelhouse sees them stop, and runs the checks on this computer.` },
      { label: LEAVE_THEM, says: 'Wheelhouse keeps waiting for GitHub\'s checks, and finished work waits with them.' },
    ],
    recommendation: RUN_CHECKS_HERE,
  });

  const askUnread = () => ask('rulesUnread', {
    what: 'Wheelhouse can\'t read this project\'s rules on GitHub, so it can\'t tell whether they still ask for its own check. If they do and it stops reporting, nothing can be added to the main line.',
    why: 'Running the checks here as well as on GitHub costs this computer some time, and only you can say whether that is wanted, at level 3.',
    options: [
      { label: KEEP_REPORTING, says: 'The checks run on this computer as well, and report to GitHub, so nothing waits for a report that never comes.' },
      { label: CHECK_LEAVE_IT, says: 'Only GitHub\'s own checks run. If the rules still ask for Wheelhouse\'s check, finished work waits.' },
    ],
    recommendation: KEEP_REPORTING,
  });

  // A project whose checks read as the host's, when nobody can say whether the rules still ask for ours. A read that comes
  // back settles it, and only looks in a row count, so a passing fault raises nothing.
  async function watchRules(f) {
    const kept = readQueue(project);
    const unread = rulesNameOurs({ required: f.required, recorded: kept.required }) === null;
    if (!unread) {
      if (kept.rulesUnread !== 0) change((q) => { q.rulesUnread = 0; });
      return;
    }
    const seen = change((q) => { q.rulesUnread += 1; });
    if (seen.rulesUnread >= UNREAD_LIMIT) await askUnread();
  }

  // Reports a commit, from the signed record: 'pending' while it has none for this command. A status that can't post is kept
  // and tried again on the next tick; the record stands meanwhile.
  async function report(commit, digest, checking = false) {
    const held = checking ? null : latest(commit, digest);
    const waits = readQueue(project).firstFor === commit && isRed(held?.result);
    const status = waits ? FIRST_WAITS : held ? STATUS[held.result] : CHECKING;
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
      if (posted) {
        q.waitingForPermission = false;
        delete q.asked.permission;
      } else if (got?.refused === 'permission') {
        q.waitingForPermission = true;
        // Accepted and still refused: the card comes once more.
        if (q.asked.permission && answerOf(q.asked.permission) === CHECK_ACCEPTED) delete q.asked.permission;
      }
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

  // The first check on the default branch that says anything decides what the director hears (spec 4.5).
  async function firstHeard(answer, wasFirst, f) {
    if (!wasFirst) return;
    const got = await firstCheck({
      found: { testCommand: f.settings.testCommand }, check: answer, note,
      state: (data) => record('checks-state', data),
      card: async (data) => {
        change((q) => { q.firstFor = answer.commit; });
        await ask('first', data);
      },
    });
    return got;
  }

  // A check has ended on the main line: not counting may end with it.
  async function afterMain(answer, f) {
    const { firstFor } = readQueue(project);
    if (!countingEnds(f.notCounting === true || Boolean(firstFor), answer)) return;
    // A red first check's card may still be open: its answer has nothing left to decide.
    change((q) => { q.firstFor = null; });
    await record('checks-state', { state: 'counting', why: 'passed' });
    await note(checksRanLine(answer));
  }

  async function checkOne({ commit, main, work }, f) {
    const { digest } = f;
    const settings = { ...f.settings, ...(f.notCounting === true ? { notCounting: true } : {}) };
    const wasFirst = main && f.notCounting !== true && mayStopCounting(states()) && !results().some((r) => r.clean === true && r.result !== 'could-not-run');
    const controller = new AbortController();
    abort = controller;
    await report(commit, digest, true);
    const answer = await turn(async () => {
      if (controller.signal.aborted || stopped()) return null;
      const from = await source();
      change((q) => { q.checkingUntil = new Date(now().getTime() + settings.minutes * 60000).toISOString(); });
      try {
        return await run({ project, commit, main, work, settings, source: from, signal: controller.signal });
      } finally {
        change((q) => { q.checkingUntil = null; });
      }
    });
    if (answer === null) return;
    const event = await writeCheck(project, answer, { write });
    const kept = settleTries(answer, commit, digest, controller.signal.aborted);
    if (main && !controller.signal.aborted) {
      await firstHeard(answer, wasFirst, f).catch(() => {});
      await afterMain(answer, f);
    }
    // Under All stop the report waits; the dispatcher holds what is sent back until it lifts.
    if (stopped()) {
      change((q) => { if (!q.unposted.includes(commit)) q.unposted.push(commit); });
    } else {
      await report(commit, digest);
      if (kept.streak >= NOT_RAN_LIMIT) await askNotRan();
    }
    if (!main && answer.result === 'passed') {
      const passed = readQueue(project).heads.find((h) => h.commit === commit);
      if (passed) await onPassed(passed.work);
    }
    if (main || !isRed(answer.result)) return;
    const head = readQueue(project).heads.find((h) => h.commit === commit);
    if (!head || head.redFor === digest) return;
    change((q) => { q.heads.find((h) => h.commit === commit).redFor = digest; });
    await onRed(commit, head.work, event.data.tail);
  }

  // The director's answer to the first red's card.
  async function firstAnswered(f) {
    const { asked, firstFor } = readQueue(project);
    if (!firstFor || !asked.first) return;
    const label = answerOf(asked.first);
    if (label !== GET_THEM_PASSING && label !== CARRY_ON) return;
    if (label === CARRY_ON && mayStopCounting(states())) await record('checks-state', { state: 'not-counting', why: 'director' });
    if (label === GET_THEM_PASSING) await onFix(firstFor);
    change((q) => { q.firstFor = null; });
    // Carry on anyway stays pending until the check that doesn't count: a red here would start the fix just declined.
    if (label === GET_THEM_PASSING) await report(firstFor, f.digest);
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
    } else if (label === CHECK_LEAVE_IT) {
      // What was left stays held, and a new version that can't run starts afresh.
      change((q) => {
        q.streak = 0;
        delete q.asked.notRan;
      });
    }
  }

  // A card that couldn't be written when it was due.
  async function askedAgain() {
    const { streak, waitingForPermission, firstFor, asked } = readQueue(project);
    if (waitingForPermission) await askPermission().catch(() => {});
    if (streak >= NOT_RAN_LIMIT) await askNotRan().catch(() => {});
    if (firstFor && !asked.first) await ask('first', FIRST_RED_CARD).catch(() => {});
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

  // Queues a head in its work's place. A head taken again keeps what is known of it.
  function queued(head, work) {
    const stamp = now().toISOString();
    change((q) => {
      const same = q.heads.find((h) => h.commit === head && h.work === work);
      q.heads = [...q.heads.filter((h) => h.work !== work && h.commit !== head), same ?? { commit: head, work }];
      q.taken = [...q.taken.filter((c) => c !== head), head].slice(-KEPT_TAKEN);
      q.readings = [...q.readings.filter((r) => r.head !== head), { head, firstSeen: stamp, readAt: stamp, contexts: [] }].slice(-KEPT_READINGS);
    });
  }

  async function takeOpenHeads(digest) {
    let open = [];
    try { open = await openHeads(); } catch { return; }
    // Each head once, so a work's older change left open can't take the place of its newer one again.
    for (const { head, work } of open) {
      if (readQueue(project).taken.includes(head) || ended(work)) continue;
      queued(head, work);
      await report(head, digest);
    }
  }

  const mainPassed = (f) => results().filter((r) => r.commit === f.main && r.command === f.digest && r.clean === true).at(-1)?.result === 'passed';
  const readNotCounting = (f) => f.notCounting === true;

  // The main line's clean check came back red, after its second try. A first check has its own card, and the same commit
  // opens one incident, however many ticks see it.
  async function redMain(f) {
    const { firstFor, redOpened } = readQueue(project);
    const newest = results().filter((r) => r.commit === f.main && r.clean === true).at(-1);
    if (firstFor || redOpened === f.main || f.notCounting === true || !isRed(newest?.result)) return;
    await onRedMain(f.main);
    change((q) => { q.redOpened = f.main; });
  }

  async function tick() {
    if (stopped()) return;
    const f = await facts();
    if (f === null || f === undefined) return;
    change((q) => { q.heads = q.heads.filter((h) => !ended(h.work)); });
    let kept = readQueue(project);
    if (!kept.hostChecksOff && kept.asked.broken && answerOf(kept.asked.broken) === RUN_CHECKS_HERE) kept = change((q) => { q.hostChecksOff = true; });
    if (!kept.keepReporting && kept.asked.rulesUnread && answerOf(kept.asked.rulesUnread) === KEEP_REPORTING) change((q) => { q.keepReporting = true; });
    if (whereNow(project, f) !== 'here') {
      await watchRules(f);
      await watchHost(f);
      return;
    }
    if (stopped()) return;
    // No command to run and nothing kept: the finder's answer settles it, and the next tick goes on from there. One the
    // record can't keep, or a project that counted and lost its command, is the director's card, never a quiet stop.
    if (typeof f.settings?.testCommand !== 'string') {
      if (f.finder) {
        await record('checks-found', f.finder).catch(() => askNotRan().catch(() => {}));
        return;
      }
      if (f.notCounting !== true) {
        if (mayStopCounting(states())) await firstCheck({ found: null, state: (data) => record('checks-state', data) });
        else await askNotRan().catch(() => {});
        return;
      }
    }
    answered();
    await askedAgain();
    await redMain(f).catch(() => {});
    await firstAnswered(f);
    for (const commit of kept.unposted) await report(commit, f.digest);
    await takeOpenHeads(f.digest);
    if (active !== null) return;
    const { tries: held, heads } = readQueue(project);
    const workOf = (commit) => heads.find((h) => h.commit === commit)?.work ?? null;
    if (f.keptOnly === true && mainPassed(f)) await keep().catch(() => {});
    const due = dueChecks({ main: f.main, heads: heads.map((h) => h.commit), results: results(), digest: f.digest, notCounting: readNotCounting(f) })
      .filter(({ commit }) => (held[`${commit}:${f.digest}`] ?? 0) < NOT_RAN_LIMIT).map((c) => ({ ...c, work: workOf(c.commit) }));
    // Ended work's folders go while no check runs.
    await sweep(project, heads.map((h) => h.work)).catch(() => {});
    if (due.length === 0 || stopped() || active !== null) return;
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
      if (!f || stopped() || (typeof f.settings?.testCommand !== 'string' && f.notCounting !== true)) return;
      if (whereNow(project, f) !== 'here') return;
      // Reported from the record, so a head taken again doesn't lose its result. One that came back red with nothing
      // changed goes back again, which the second time is the director's card.
      await report(head, f.digest);
      const record = latest(head, f.digest);
      if (isRed(record?.result)) await onRed(head, work, record.tail);
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
