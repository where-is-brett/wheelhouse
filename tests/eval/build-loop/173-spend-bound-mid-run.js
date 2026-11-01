// tests/eval/build-loop/173-spend-bound-mid-run.js
// Scenario 173 (unattended goals design, section 5): a goal of two pieces, one at a time, whose first run reaches the goal's
// tokens while it runs; then the pace goes up, so only the spend can hold the second. Pass: the meter reads the live run's
// spend, the run is cancelled, the goal ends on its spend, the second piece never starts and no card asks about it. Played on
// the engine the run names, in its `with` variant alone.
import { confirmationFor, dataHash } from '../../../scripts/state/events.js';
import { startGoalLine } from '../../../scripts/state/card-lines.js';
import { sheetHash } from '../../../scripts/engine/goal.js';
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';

const GOAL = 'goal-173';
const FIRST = 'card-173-a';
const SECOND = 'card-173-b';
const TOKENS = 1000000;
const pieceOf = (id, title) => ({ id, title, lane: 'quick', visible: false, dependsOn: [] });

export default {
  id: 173,
  title: 'A goal\'s spend is reached in mid-run, and nothing more starts',
  engine: {
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [FIRST]: running(FIRST, TOKENS), [SECOND]: running(SECOND, 1) },
    async play(world) {
      const paceOf = (value) => world.put('confirmation', confirmationFor(world.put('setting', { key: 'pace', value })).data);
      paceOf(1);
      const pieces = [pieceOf(FIRST, 'The sale banner'), pieceOf(SECOND, 'The sale page')];
      for (const piece of pieces) world.put('work', piece);
      const sheet = {
        title: 'The sale goes live', done: [{ command: 'node --test', expect: 0 }], checksSay: ['The tests pass on the main line'],
        pieces: pieces.map((piece) => ({ work: piece.id, hash: dataHash(piece) })), areas: { may: ['src/**'], wontTouch: ['tests/**'] },
        spend: { tokens: TOKENS }, until: '2026-10-29T17:00:00.000Z',
      };
      world.put('goal', { id: GOAL, sheet });
      const hash = sheetHash(sheet);
      world.put('action', { action: 'start-goal', goal: GOAL, hash, question: `What this is.\n${startGoalLine(GOAL, hash)}`, label: 'Start' });
      const going = await until(async () => { await world.tick(); return world.records('run').some((r) => r.data.work === FIRST && r.data.state === 'started'); });
      if (!going) return { pass: false, why: 'the first piece never started' };
      paceOf(2);
      for (let i = 0; i < 4; i += 1) await world.tick();
      if (world.starts().some((s) => s.order.work === SECOND)) return { pass: false, why: 'the second piece started past the goal\'s spend' };
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started` };
      if (world.acts().filter((c) => c.action.cancel).length !== 1) return { pass: false, why: 'the run wasn\'t cancelled once' };
      if (world.records('goal-end').map((r) => r.data.ending).join() !== 'spend') return { pass: false, why: 'the goal didn\'t end on its spend' };
      if (world.records('question').some((q) => q.data.work === SECOND)) return { pass: false, why: 'a card came for the held piece' };
      return { pass: true, why: 'the live run\'s spend met the bound, the goal ended on it, and the next piece held with no card' };
    },
  },
  variants: { with: {} },
};
