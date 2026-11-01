// tests/eval/build-loop/174-goal-to-done.js
// Scenario 174 (unattended goals design, sections 8 and 9.1): a goal of one quick piece, whose pull request merges and whose last
// check passes. Pass: the last check isn't asked for until the piece has merged, it is then asked for once, and when it is signed
// passing the goal ends `done` with one record, with nothing cancelled. Played on the engine the run names,
// in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { goalChecked, quickRun } from './engine-recordings.js';
import { signGoal, endingsOf, cancelsOf, tickTimes } from './goal-world.js';

const GOAL = 'goal-174';
const WORK = 'card-174';
const PR = 1741;

export default {
  id: 174,
  title: 'A goal whose piece merged and whose last check passed is Done',
  engine: {
    place: 'git-alone',
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [WORK]: quickRun(WORK, { pr: PR }), 'goal-check': goalChecked('last', [{ check: { command: 'npm test', expect: 0 }, ok: true }]) },
    async play(world, { now }) {
      signGoal(world, { id: GOAL, work: WORK, title: 'The sale banner', now });
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.work === WORK && r.data.pr === PR); });
      if (!ended) return { pass: false, why: 'the piece\'s run never ended with its pull request' };
      await tickTimes(world, 2);
      if (world.records('goal-check').some((c) => c.data.when === 'last')) return { pass: false, why: 'the last check was asked for before the piece merged' };
      world.put('report', { work: WORK, outcome: 'merged', pr: PR, summary: 'Merged.', rulings: [] });
      const last = await until(async () => { await world.tick(); return world.records('goal-check').find((c) => c.data.when === 'last'); });
      if (!last) return { pass: false, why: 'the last check was never signed' };
      if (world.starts().filter((s) => s.order.lane === 'goal-check').length !== 1) return { pass: false, why: 'the last check wasn\'t asked for exactly once' };
      const done = await until(async () => { await world.tick(); return endingsOf(world) !== ''; });
      if (!done) return { pass: false, why: 'the goal never ended' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'done') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      if (cancelsOf(world).length > 0) return { pass: false, why: 'a run was cancelled in a goal that was Done' };
      return { pass: true, why: 'the piece merged, the last check ran once and passed, and the goal ended Done with one record' };
    },
  },
  variants: { with: {} },
};
