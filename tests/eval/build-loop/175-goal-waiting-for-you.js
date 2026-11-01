// tests/eval/build-loop/175-goal-waiting-for-you.js
// Scenario 175 (unattended goals design, sections 8 and 9.1): a goal whose only piece stops at a question card. Pass: with all that is
// left waiting on the director, nothing new starts and nothing is cancelled; when `until` passes the goal ends `waiting-for-you` and
// leaves the run as it is; and once the director has answered and the piece has merged, the goal's checks run again, a `goal-check` with
// when `last` signed after the goal-end. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { asking, goalChecked } from './engine-recordings.js';
import { signGoal, endingsOf, cancelsOf, tickTimes } from './goal-world.js';

const GOAL = 'goal-175';
const WORK = 'card-175';
const UNTIL = '2026-10-29T09:30:00.000Z';

export default {
  id: 175,
  title: 'A goal waiting on the director ends at until, and runs its checks again once the work has merged',
  engine: {
    place: 'git-alone',
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [WORK]: asking(WORK), 'goal-check': goalChecked('last', [{ check: { command: 'npm test', expect: 0 }, ok: true }]) },
    async play(world, { now, at }) {
      signGoal(world, { id: GOAL, work: WORK, title: 'The sale banner', now, until: UNTIL });
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.work === WORK); });
      if (!card) return { pass: false, why: 'the piece never came to its question card' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== '') return { pass: false, why: 'the goal ended before until, with its piece waiting' };
      at('2026-10-29T09:20:00.000Z');
      await tickTimes(world, 3);
      if (world.starts().length !== 1 || cancelsOf(world).length > 0) return { pass: false, why: 'the waiting goal started or cancelled a run' };
      at('2026-10-29T09:31:00.000Z');
      const ended = await until(async () => { await world.tick(); return endingsOf(world); });
      if (ended !== 'waiting-for-you') return { pass: false, why: `the goal's endings read ${ended || 'none'} at until` };
      if (world.starts().length !== 1 || cancelsOf(world).length > 0) return { pass: false, why: 'the goal\'s end started or cancelled a run' };
      if (world.records('goal-check').some((c) => c.data.when === 'last')) return { pass: false, why: 'the checks ran with the piece still unfinished' };
      world.answer(card.data, 'Keep it small');
      const ran = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.work === WORK && r.data.state === 'ended'); });
      if (!ran) return { pass: false, why: 'the answered piece never finished' };
      await tickTimes(world, 3);
      if (world.records('goal-check').some((c) => c.data.when === 'last')) return { pass: false, why: 'the checks ran again before the piece merged' };
      world.put('report', { work: WORK, outcome: 'merged', pr: 1751, summary: 'Merged.', rulings: [] });
      const last = await until(async () => { await world.tick(); return world.records('goal-check').find((c) => c.data.when === 'last'); });
      if (!last) return { pass: false, why: 'the goal\'s checks never ran again' };
      const end = world.records('goal-end')[0];
      if (Date.parse(last.at) < Date.parse(end.at)) return { pass: false, why: 'the checks that ran again came before the goal-end' };
      await tickTimes(world, 3);
      if (world.records('goal-check').filter((c) => c.data.when === 'last').length !== 1) return { pass: false, why: 'the checks ran more than once' };
      if (endingsOf(world) !== 'waiting-for-you') return { pass: false, why: `the goal's endings read ${endingsOf(world)} after the checks` };
      return { pass: true, why: 'the goal waited, spent nothing, ended waiting-for-you at until, and its checks ran again once the answered piece merged' };
    },
  },
  variants: { with: {} },
};
