// tests/eval/build-loop/69-bug-shown-first.js
// Scenario 69 (Archon design, sections 7.2, 9 and 18): a bug whose fix users would see, recorded as shown first.
// Pass: the run starts only on the director's approval of the work, and its fix comes back as an approval card naming
// the pull request's head, with nothing answered for the director. Played on the engine the run names, in its `with`
// variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { approving, bugWork } from './engine-recordings.js';

const HEAD = '6969696a2b3c4d5e6f708192a3b4c5d6e7f80912';

export default {
  id: 69,
  title: 'A bug users would see waits for the director\'s approval of its fix',
  engine: {
    recordings: { 'card-69': approving('card-69', { pr: 69, head: HEAD }).map((e) => (e.type === 'run-started' ? { ...e, lane: 'bug' } : e)) },
    async play(world) {
      bugWork(world, { id: 'card-69', title: 'A 65-second clip shows as 1:5 on its card', visible: true });
      await world.tick();
      if (world.starts().length !== 1 || world.starts()[0].order.lane !== 'bug') return { pass: false, why: 'the approved bug didn\'t start on the bug lane' };
      const order = await until(() => world.orders()[0]);
      if (order?.showFirst !== true) return { pass: false, why: 'the order doesn\'t show the fix first' };
      const card = await until(() => world.records('card').find((c) => /#69/.test(c.data.question ?? '')));
      if (!card) return { pass: false, why: 'no approval card was written' };
      if (!card.data.question.includes(HEAD.slice(0, 12))) return { pass: false, why: 'the card doesn\'t name the head it approves' };
      if (world.acts().length > 0) return { pass: false, why: 'the engine was answered before the director approved' };
      return { pass: true, why: 'started on the approval, shown first, and an approval card for the head with nothing answered for the director' };
    },
  },
  variants: { with: {} },
};
