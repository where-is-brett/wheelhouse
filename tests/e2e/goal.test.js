// tests/e2e/goal.test.js
// A goal's endings on the fake engine (unattended goals design, sections 8, 9.1 and 9.3), with the runner and the dispatcher's
// runner joined as the helper joins them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { wayBack, asking, forever, quiet, atLimit, failing } from '../helpers/way-back.js';
import { dataHash } from '../../scripts/state/events.js';
import { goalRule } from '../../scripts/engine/goal.js';

const MINUTE = 60 * 1000;
const STARTED = '2026-10-29T09:00:00.000Z';
const UNTIL = '2026-10-29T18:00:00.000Z';
const HEAD = 'a'.repeat(40);
// Long enough that a lane's own cap plays no part.
const LONG = { capMinutes: { quick: 100000 } };

// A goal over `pieces`, signed, as `views.goals` holds it.
const goalOver = (w, pieces, { id = 'g', until = UNTIL, spend = { tokens: 100000000 }, stopEarly } = {}) => {
  w.goals[id] = {
    sheet: { title: 'A goal', until, spend, pieces: pieces.map((work) => ({ work, hash: dataHash(w.work[work].work.data) })), ...(stopEarly ? { stopEarly } : {}) },
    hash: 'signed', startedAt: STARTED, ended: null, endAsked: null,
  };
};
const keptOf = (w) => JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8'));
const ends = (w) => w.written.filter((x) => x.kind === 'goal-end').map((x) => x.data);
const cancels = (w) => w.engine.calls.filter((c) => c.call === 'act' && c.action.cancel);
const merged = (w, work, pr = 7) => { w.reports[work] = { at: w.clock.now.toISOString(), data: { work, outcome: 'merged', pr, summary: 'Added.', rulings: [] } }; };

// The helper's goal checks, played by hand: `asks` each ask, and `say` puts a signed result on the record.
function checksFor() {
  const asks = [];
  const world = {};
  return {
    asks,
    attach: (w) => { world.w = w; },
    goalCheck: async (ask) => { asks.push(ask); return { ok: true, runId: 'check-run', head: HEAD }; },
    say(goal, ok, over = {}) {
      const { w } = world;
      ((w.goalChecks ??= {})[goal] ??= []).push({ goal, hash: 'signed', when: 'last', head: HEAD, results: [{ check: { command: 'npm test', expect: 0 }, ok }], ok, at: w.clock.now.toISOString(), ...over });
    },
  };
}
function withChecks(over = {}) {
  const checks = checksFor();
  const w = wayBack({ ...over, dispatchExtra: { goalCheck: checks.goalCheck, ...over.dispatchExtra } });
  checks.attach(w);
  return { w, checks };
}

test('a goal to Done: its pieces merged, the last check asked for once and passing', async () => {
  const { w, checks } = withChecks({ recordings: { a: quiet() } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  merged(w, 'a');
  await w.tick(2);
  assert.deepEqual(checks.asks, [{ goal: 'g', when: 'last' }]);
  assert.deepEqual(ends(w), [], 'it isn\'t Done on the merge alone');
  checks.say('g', true);
  await w.tick();
  assert.equal(ends(w).length, 1);
  assert.equal(ends(w)[0].ending, 'done');
  await w.tick(2);
  assert.equal(ends(w).length, 1, 'one record of it');
});

test('a last check that fails is never Done, and one with no result is asked for once more', async () => {
  const { w, checks } = withChecks({ recordings: { a: quiet() } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  merged(w, 'a');
  await w.tick();
  checks.say('g', false, { results: [], said: 'The check run failed', head: null });
  await w.tick();
  assert.equal(checks.asks.length, 2, 'asked again');
  assert.deepEqual(ends(w), []);
  checks.say('g', false);
  await w.tick();
  assert.equal(ends(w)[0].ending, 'check-failed');
});

test('a feature reaches Done by its own run, with only its switch-on to come', async () => {
  const approval = asking('ap', { kind: 'approval', recommend: 'approve', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Not this' }] });
  const { w, checks } = withChecks({ recordings: { f: approval } });
  w.put('f', { lane: 'feature' });
  w.startAs = async (args, real) => real({ ...args, order: { ...args.order, lane: 'feature' } });
  goalOver(w, ['f']);
  w.work.f.approved = true;
  w.runs.f = [{ at: '2026-10-29T09:30:00.000Z', data: { engine: 'fake', work: 'f', lane: 'feature', runId: w.engine.start({ work: 'f', lane: 'feature', recording: 'f', folder: '/work/f' }).runId, state: 'started', branch: 'wh/f' } }];
  await w.tick(3);
  assert.equal(ends(w)[0]?.ending, 'done', 'its run signs no goal-check, so Done reads the run');
  assert.deepEqual(checks.asks, []);
});

test('nothing can run and all waits on the director: the goal waits until until, spending nothing', async () => {
  const { w } = withChecks({ recordings: { a: asking('q1') } });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T10:10:00.000Z' });
  await w.tick(3);
  assert.equal(keptOf(w).goalRun.state, 'waiting');
  assert.deepEqual(ends(w), []);
  await w.pass(11 * MINUTE);
  assert.equal(ends(w)[0].ending, 'waiting-for-you');
  assert.deepEqual(cancels(w), [], 'a run at a question stays as it is');
});

test('a card holding up the whole goal rises, past another piece going', async () => {
  const { w } = withChecks({ recordings: { a: asking('q1'), other: forever() } });
  w.put('other');
  await w.tick();
  w.put('a');
  goalOver(w, ['a']);
  w.goals.g.startedAt = new Date(w.clock.now.getTime() + 1).toISOString();
  await w.tick(3);
  const tops = w.written.filter((x) => x.kind === 'note' && x.data.about === 'top-card').map((x) => x.data.id);
  assert.equal(tops.at(-1), w.cardOf('a').id);
});

test('a sleep past until gives the run its wind-down', async () => {
  const { w } = withChecks({ recordings: { a: forever() }, settings: LONG });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T10:30:00.000Z' });
  await w.tick(2);
  const asleep = w.clock.now.toISOString();
  w.clock.now = new Date(w.clock.now.getTime() + 6 * 60 * MINUTE);
  w.slept = [{ from: asleep, to: w.clock.now.toISOString() }];
  await w.tick();
  assert.equal(keptOf(w).goalRun.state, 'winding');
  assert.deepEqual(cancels(w), [], 'nothing is cancelled at the moment it wakes');
  await w.pass(59 * MINUTE);
  assert.deepEqual(cancels(w), []);
  await w.pass(2 * MINUTE);
  assert.equal(cancels(w).length, 1);
  assert.equal(ends(w)[0].ending, 'time');
});

test('a run parked at a limit is cancelled when the goal ends, keeping its worktree', async () => {
  const { w } = withChecks({ recordings: { a: atLimit('lim', { resetAt: '2026-10-30T09:00:00.000Z' }) } });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T10:02:00.000Z' });
  await w.tick(2);
  assert.deepEqual(cancels(w), []);
  await w.pass(4 * MINUTE);
  assert.equal(cancels(w).length, 1, 'nothing wakes and spends after the goal has ended');
  assert.deepEqual(w.engine.calls.filter((c) => c.action?.abandon), []);
  assert.equal(ends(w)[0].ending, 'time');
  await w.tick(3);
  assert.equal(w.cardOf('a'), null, 'the goal stopped it, so no card asks about it');
});

test('a helper started again takes the goal up where it was', async () => {
  const { w } = withChecks({ recordings: { a: forever(), b: forever() }, settings: LONG });
  w.put('a');
  w.put('b', { files: [] });
  goalOver(w, ['a', 'b'], { until: '2026-10-29T10:01:00.000Z' });
  w.goals.g.endAsked = null;
  await w.tick(2);
  await w.pass(2 * MINUTE);
  const before = keptOf(w).goalRun;
  assert.equal(before.state, 'winding');
  w.restart();
  await w.tick();
  assert.equal(keptOf(w).goalRun.windingSince, before.windingSince, 'the wind-down keeps its clock');
  await w.pass(58 * MINUTE);
  assert.deepEqual(ends(w), []);
  await w.pass(2 * MINUTE);
  assert.equal(ends(w)[0].ending, 'time');
});

test('stuck counts no time parked, waiting or asleep', async () => {
  const { w } = withChecks({ recordings: { a: asking('q1'), b: atLimit('lim', { resetAt: '2026-10-29T12:00:00.000Z' }) }, pace: 1 });
  w.put('a');
  w.put('b');
  goalOver(w, ['a', 'b']);
  await w.tick(3);
  await w.pass(90 * MINUTE, 5 * MINUTE);
  assert.notEqual(keptOf(w).goalRun.state, 'winding');
});

test('a run that finishes no step for an hour winds the goal down as stuck', async () => {
  const { w } = withChecks({ recordings: { a: forever() }, settings: LONG });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  await w.pass(61 * MINUTE);
  assert.equal(keptOf(w).goalRun.windingFor, 'stuck');
});

test('spend cancels running runs and keeps their worktrees', async () => {
  const { w } = withChecks({ recordings: { a: forever() } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  w.goals.g.sheet.spend.tokens = 10;
  w.engine.inspect = ((read) => async (id) => ({ ...(await read(id)), steps: [{ tokens: 20, dollars: 1, source: 'reported' }] }))(w.engine.inspect.bind(w.engine));
  await w.tick(2);
  assert.equal(cancels(w).length, 1);
  assert.equal(ends(w)[0].ending, 'spend');
  assert.equal(ends(w)[0].spent.tokens, 20);
  assert.deepEqual(w.engine.calls.filter((c) => c.action?.abandon), []);
  await w.tick(3);
  assert.equal(w.cardOf('a'), null, 'the report names what is left, not a card');
});

test('one failed read of a live run ends nothing, and reads that go on failing do', async () => {
  const { w } = withChecks({ recordings: { a: forever() }, settings: LONG });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  w.goals.g.sheet.spend = { tokens: 1000 };
  const read = w.engine.inspect.bind(w.engine);
  w.engine.inspect = async () => { throw new Error('no answer'); };
  await w.tick();
  assert.deepEqual([ends(w).length, cancels(w).length], [0, 0]);
  w.engine.inspect = read;
  await w.tick();
  assert.equal(keptOf(w).goalRun.unreadSince, null);
  w.engine.inspect = async () => { throw new Error('no answer'); };
  await w.pass(14 * MINUTE);
  assert.equal(ends(w)[0]?.ending, 'spend');
  assert.equal(ends(w)[0].spent.unknown, true);
});

test('a run that won\'t cancel is tried twice, then ended by its processes, and the goal still ends', async () => {
  const ended = [];
  const { w } = withChecks({ recordings: { a: forever() }, dispatchExtra: { endRun: async (runId) => { ended.push(runId); return { ended: [], survivors: [] }; } } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  w.engine.act = ((act) => (id, action) => (action.cancel ? { ok: false, refused: 'no' } : act(id, action)))(w.engine.act.bind(w.engine));
  w.goals.g.endAsked = { at: w.clock.now.toISOString(), now: true };
  await w.tick(4);
  assert.equal(ended.length, 1);
  assert.equal(ends(w)[0].ending, 'end-goal');
});

test('All stop ends the goal and its lift starts nothing', async () => {
  const { w } = withChecks({ recordings: { a: forever(), b: forever() }, pace: 1 });
  w.put('a');
  w.put('b');
  goalOver(w, ['a', 'b']);
  await w.tick(2);
  w.stop = true;
  await w.tick();
  assert.equal(ends(w)[0].ending, 'all-stop');
  w.stop = false;
  const before = w.starts.length;
  await w.tick(3);
  assert.equal(w.starts.length, before);
});

test('Carry on offers a new sheet', async () => {
  const { w } = withChecks({ recordings: { a: quiet() } });
  w.put('a');
  goalOver(w, ['a']);
  w.stop = true;
  await w.tick();
  w.stop = false;
  assert.match(w.notes().join(' '), /Carry on offers a new sheet/);
  w.work.a.work.at = '2026-10-29T11:00:00.000Z';
  await w.tick(2);
  assert.equal(w.starts.length, 0, 'queued again it holds, as its goal has ended');
  goalOver(w, ['a'], { id: 'g2' });
  await w.tick();
  assert.equal(w.starts.at(-1).order.goalId, 'g2');
});

test('End goal winds down, and End goal now stops at once', async () => {
  const { w } = withChecks({ recordings: { a: forever(), b: forever() } });
  w.put('a');
  w.put('b');
  goalOver(w, ['a']);
  await w.tick(2);
  w.goals.g.endAsked = { at: w.clock.now.toISOString(), now: false };
  await w.tick();
  assert.equal(keptOf(w).goalRun.windingFor, 'end-goal');
  assert.deepEqual([ends(w).length, cancels(w).length], [0, 0]);
  w.goals.g.endAsked = { at: w.clock.now.toISOString(), now: true };
  await w.tick();
  assert.equal(cancels(w).length, 1);
  assert.equal(ends(w)[0].ending, 'end-goal');
});

test('nothing new starts in a wind-down, and an answer waits for the goal\'s end', async () => {
  const { w } = withChecks({ recordings: { a: asking('q1'), b: forever(), c: forever() }, pace: 2 });
  w.put('a');
  w.put('b');
  w.put('c');
  goalOver(w, ['a', 'b', 'c']);
  await w.tick(3);
  const started = w.starts.length;
  w.goals.g.endAsked = { at: w.clock.now.toISOString(), now: false };
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(3);
  assert.equal(w.starts.length, started);
  assert.deepEqual(w.answers(), [], 'no run wakes to be cancelled by the wind-down');
  await w.pass(61 * MINUTE);
  assert.equal(ends(w)[0].ending, 'end-goal');
  await w.tick(3);
  assert.equal(w.answers().length, 1, 'it carries on as ordinary work');
});

test('the merge queue runs on through a wind-down and after, and its spend is named after the end', async () => {
  const { w } = withChecks({
    recordings: { a: forever(), merge: quiet() },
    dispatchExtra: { queueFolder: async () => ({ ok: true, folder: '/queue' }) },
  });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  w.goals.g.endAsked = { at: w.clock.now.toISOString(), now: true };
  await w.tick();
  assert.equal(ends(w)[0].ending, 'end-goal');
  w.ready[7] = { head: HEAD, runId: w.runsOf('a')[0], work: 'a', showFirst: false };
  await w.tick(2);
  const queued = w.engine.calls.filter((c) => c.call === 'start' && c.order?.lane === 'merge');
  assert.equal(queued.length, 1, 'finished work isn\'t stranded');
  await w.tick(2);
  const after = w.written.filter((x) => x.kind === 'note' && x.data.about === 'goal-queue-after');
  assert.equal(after.length, 1);
  assert.equal(after[0].data.goal, 'g');
  assert.equal(after[0].data.tokens, 0);
});

test('an answered piece after the end comes back through returning', async () => {
  const { w } = withChecks({ recordings: { a: asking('q1') } });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T10:02:00.000Z' });
  await w.tick(2);
  await w.pass(4 * MINUTE);
  assert.equal(ends(w)[0].ending, 'waiting-for-you');
  assert.ok(goalRule(w.views(), w.clock.now).startsStopped);
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.equal(w.answers().length, 1);
});

test('once waiting work has merged after the end, the goal\'s checks run again and the report says so', async () => {
  const { w, checks } = withChecks({ recordings: { a: asking('q1') } });
  w.put('a');
  goalOver(w, ['a'], { until: '2026-10-29T10:02:00.000Z' });
  await w.tick(2);
  await w.pass(4 * MINUTE);
  assert.deepEqual(checks.asks, []);
  merged(w, 'a');
  await w.tick(2);
  assert.deepEqual(checks.asks, [{ goal: 'g', when: 'last' }]);
  checks.say('g', true);
  await w.tick(2);
  assert.equal(checks.asks.length, 1, 'once');
  assert.equal(w.notes().filter((n) => /checks ran again/.test(n)).length, 1);
});

test('goal-end holds the spend the report reads', async () => {
  const { w } = withChecks({ recordings: { a: forever() }, dispatchExtra: { allowance: () => ({ share: 40, shareAt: '2026-10-29T09:01:00.000Z', resetsAt: '2026-11-03T00:00:00.000Z' }) } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  w.goals.g.endAsked = { at: w.clock.now.toISOString(), now: true };
  await w.tick();
  const { spent } = ends(w)[0];
  assert.deepEqual(Object.keys(spent).sort(), ['points', 'queueRuns', 'requests', 'shareAtStart', 'tokens', 'unknown']);
  assert.equal(spent.shareAtStart.share, 40);
  assert.deepEqual(spent.queueRuns, []);
});

test('two pieces failing in a row wind the goal down as stuck', async () => {
  const { w } = withChecks({ recordings: { a: failing('other'), b: failing('other'), c: forever() }, pace: 3 });
  w.put('a');
  w.put('b');
  goalOver(w, ['a', 'b']);
  await w.tick(5);
  assert.equal(ends(w)[0]?.ending, 'stuck');
});

test('a second red main line winds the goal down as stuck, and a fix goes on', async () => {
  const { w } = withChecks({ recordings: { a: forever(), 'red-1': forever() } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  const red = (id) => { w.incidents.open = [{ id, what: 'red', at: w.clock.now.toISOString(), fixes: [], kind: 'red-main', work: id }]; };
  red('red-1');
  await w.tick();
  assert.equal(keptOf(w).goalRun.reds.length, 1);
  w.incidents.open = [];
  await w.tick();
  red('red-2');
  await w.tick();
  assert.equal(keptOf(w).goalRun.windingFor, 'stuck');
});

test('a piece whose record changed leaves the goal, and is said once', async () => {
  const { w } = withChecks({ recordings: { a: quiet() } });
  w.put('a');
  w.put('b');
  goalOver(w, ['a', 'b']);
  await w.tick();
  w.work.b.work.data = { ...w.work.b.work.data, title: 'Changed since' };
  await w.tick(2);
  merged(w, 'a');
  await w.tick(3);
  assert.equal(ends(w)[0]?.ending, 'stuck');
  assert.equal(w.notes().filter((n) => /changed since the goal's sheet/.test(n)).length, 1);
});

test('a crash just after the goal-end leaves nothing held', async () => {
  const { w } = withChecks({ recordings: { a: asking('q1'), b: forever() }, pace: 2 });
  w.put('a');
  w.put('b');
  goalOver(w, ['a', 'b']);
  await w.tick(3);
  w.goals.g.endAsked = { at: w.clock.now.toISOString(), now: true };
  await w.tick();
  const file = path.join(w.dir, 'dispatch.json');
  const kept = keptOf(w);
  fs.writeFileSync(file, JSON.stringify({ ...kept, goalRun: { ...kept.goalRun, state: 'winding', closing: { ending: 'end-goal', cancel: [] } } }));
  w.restart();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.equal(w.answers().length, 1);
  assert.equal(ends(w).length, 1);
  assert.equal(keptOf(w).goalRun.state, 'ended');
});

test('a piece the director stopped at its cap isn\'t waited for', async () => {
  const { w } = withChecks({ recordings: { a: forever() }, settings: { capMinutes: { quick: 1 } } });
  w.put('a');
  goalOver(w, ['a']);
  await w.tick(2);
  await w.pass(3 * MINUTE);
  w.answer('a', 'Stop');
  await w.tick(3);
  w.endRun('a');
  await w.tick(3);
  assert.equal(ends(w)[0]?.ending, 'stuck');
});
