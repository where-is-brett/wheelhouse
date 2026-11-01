// tests/eval/build-loop/178-goal-spend.js
// Scenario 178 (unattended goals design, sections 5 and 8): scenario 173's ending with two runs going at once, neither alone at the
// goal's tokens and the two together past them. Pass: the meter adds the two runs' spend, both runs are cancelled, none is given up,
// and the goal ends `spend` with one record holding the tokens spent, both runs' included. Played on the engine the run names, in its
// `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';
import { signGoal, setPace, longRuns, endingsOf, cancelsOf, tickTimes } from './goal-world.js';

const GOAL = 'goal-178';
const FIRST = 'card-178-a';
const SECOND = 'card-178-b';
const EACH = 600000;
const TOKENS = 1000000;

export default {
  id: 178,
  title: 'A goal\'s spend is reached by two runs together, and both are cancelled',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [FIRST]: running(FIRST, EACH), [SECOND]: running(SECOND, EACH) },
    async play(world, { now }) {
      longRuns(world);
      setPace(world, 2);
      signGoal(world, { id: GOAL, works: [{ work: FIRST, title: 'The sale banner' }, { work: SECOND, title: 'The sale page' }], now, tokens: TOKENS });
      const both = await until(async () => { await world.tick(); return world.starts().length === 2; });
      if (!both) return { pass: false, why: `${world.starts().length} runs started, not two` };
      if (!await until(async () => { await world.tick(); return endingsOf(world) !== ''; })) return { pass: false, why: 'the goal never ended on its spend' };
      await tickTimes(world, 3);
      if (endingsOf(world) !== 'spend') return { pass: false, why: `the goal's endings read ${endingsOf(world)}` };
      const cancelled = cancelsOf(world);
      if (cancelled.length !== 2 || new Set(cancelled.map((c) => c.runId)).size !== 2) return { pass: false, why: `${cancelled.length} cancels were asked for, not one for each of the two runs` };
      if (world.acts().some((c) => c.action.abandon)) return { pass: false, why: 'a run\'s worktree was given up' };
      const { spent } = world.records('goal-end')[0].data;
      if (spent.tokens !== EACH * 2) return { pass: false, why: `the goal-end holds ${spent.tokens} tokens, not the two runs' ${EACH * 2}` };
      if (world.records('question').length > 0) return { pass: false, why: 'a card came for a run the goal cancelled' };
      return { pass: true, why: 'the two runs\' spend met the bound together, both were cancelled keeping their worktrees, and the goal-end holds what they spent' };
    },
  },
  variants: { with: {} },
};
