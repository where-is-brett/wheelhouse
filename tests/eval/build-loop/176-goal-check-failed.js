// tests/eval/build-loop/176-goal-check-failed.js
// Scenario 176 (unattended goals design, sections 8 and 9.1): a goal whose only piece merged and whose last check fails. Pass: the
// signed last check names the check that failed, and the goal ends `check-failed` with one record and never reads as `done`; nothing
// is cancelled. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { lastCheckHolds } from '../../../scripts/engine/goal.js';
import { goalChecked, quickRun } from './engine-recordings.js';
import { signGoal, endingsOf, cancelsOf, tickTimes } from './goal-world.js';

const GOAL = 'goal-176';
const WORK = 'card-176';
const PR = 1761;
const CHECK = { command: 'npm test', expect: 0 };

export default {
  id: 176,
  title: 'A goal whose last check fails ends check-failed, never Done',
  engine: {
    place: 'git-alone',
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [WORK]: quickRun(WORK, { pr: PR }), 'goal-check': goalChecked('last', [{ check: CHECK, ok: false }]) },
    async play(world, { now }) {
      const { hash } = signGoal(world, { id: GOAL, work: WORK, title: 'The sale banner', now });
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.work === WORK && r.data.pr === PR); });
      if (!ended) return { pass: false, why: 'the piece\'s run never ended with its pull request' };
      world.put('report', { work: WORK, outcome: 'merged', pr: PR, summary: 'Merged.', rulings: [] });
      const last = await until(async () => { await world.tick(); return world.records('goal-check').find((c) => c.data.when === 'last'); });
      if (!last) return { pass: false, why: 'the last check was never signed' };
      if (last.data.results.filter((r) => r.ok === false).map((r) => r.check.command).join() !== CHECK.command) return { pass: false, why: 'the signed last check doesn\'t name the check that failed' };
      const got = await until(async () => { await world.tick(); return endingsOf(world); });
      if (!got) return { pass: false, why: 'the goal never ended on its failed check' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'check-failed') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      if (lastCheckHolds(world.views().goalChecks, { id: GOAL, hash, head: last.data.head })) return { pass: false, why: 'a failed last check reads as Done' };
      if (cancelsOf(world).length > 0) return { pass: false, why: 'a run was cancelled in a goal whose pieces had all merged' };
      return { pass: true, why: 'the failed check is named, the goal ended check-failed with one record, and it never reads as Done' };
    },
  },
  variants: { with: {} },
};
