// tests/eval/build-loop/184-goal-refused-checks-pass.js
// Scenario 184 (unattended goals design, section 4.1): a sheet whose checks all pass already. Pass: its baseline runs once on
// the main line with no model, the signed result shows them all passing, and a Start on that sheet starts nothing; a new
// sheet with a check that fails today has its own baseline, and Start then holds. Played on the engine the run names, in its
// `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { sheetHash } from '../../../scripts/engine/goal.js';
import { dataHash } from '../../../scripts/state/events.js';
import { startGoalLine } from '../../../scripts/state/card-lines.js';
import { goalChecked } from './engine-recordings.js';

const WORK = 'card-184';
const PIECE = { id: WORK, title: 'The export', lane: 'quick', visible: false, dependsOn: [] };
const KEEPS = { command: 'node keeps-passing.js', expect: 0 };
const NEW = { command: 'node export-works.js', expect: 0 };
const AT = '2026-10-29T09:00:00.000Z';

const sheetOf = (done) => ({
  title: 'Customers can export their orders', done, checksSay: done.map((c) => `${c.command} passes.`),
  pieces: [{ work: WORK, hash: dataHash(PIECE) }], areas: { may: ['src/**'], wontTouch: ['billing/**'] }, spend: { tokens: 1000000 }, until: '2026-10-29T17:00:00.000Z',
});
const startOn = (world, id, sheet) => {
  const hash = sheetHash(sheet);
  return world.put('action', { action: 'start-goal', goal: id, hash, label: 'Start', question: `Start this goal?\n${startGoalLine(id, hash)}` });
};
const signedFor = async (world, hash) => until(async () => { await world.tick(); return world.records('goal-check').find((r) => r.data.hash === hash); });

export default {
  id: 184,
  title: 'A goal whose checks all pass already is refused',
  engine: {
    place: 'git-alone',
    startAt: AT,
    recordings: {
      'goal-check': [
        goalChecked('all-pass', [{ check: KEEPS, ok: true }]),
        goalChecked('one-fails', [{ check: KEEPS, ok: true }, { check: NEW, ok: false }]),
      ],
    },
    async play(world) {
      world.put('work', { ...PIECE });
      const passing = sheetOf([KEEPS]);
      world.put('goal', { id: 'all-pass', sheet: passing });
      if ((await world.goalCheck('all-pass', 'before')).ok !== true) return { pass: false, why: 'the baseline didn\'t start' };
      const first = await signedFor(world, sheetHash(passing));
      if (!first) return { pass: false, why: 'the baseline was never signed' };
      if (first.data.results.some((r) => r.ok !== true) || first.data.ok !== true) return { pass: false, why: `the baseline read ${JSON.stringify(first.data.results)}` };
      startOn(world, 'all-pass', passing);
      if (Object.keys(world.views().goals).length > 0) return { pass: false, why: 'a goal started whose checks prove nothing' };
      const failing = sheetOf([KEEPS, NEW]);
      world.put('goal', { id: 'one-fails', sheet: failing });
      if ((await world.goalCheck('one-fails', 'before')).ok !== true) return { pass: false, why: 'the second baseline didn\'t start' };
      if (!await signedFor(world, sheetHash(failing))) return { pass: false, why: 'the second baseline was never signed' };
      startOn(world, 'one-fails', failing);
      if (!world.views().goals['one-fails']) return { pass: false, why: 'a goal with a check failing today didn\'t start' };
      const runs = world.starts().filter((s) => s.order.lane === 'goal-check').length;
      if (runs !== 2) return { pass: false, why: `${runs} check runs started, not one for each baseline` };
      return { pass: true, why: 'all passing refused, one failing today started, each from a signed baseline' };
    },
  },
  variants: { with: {} },
};
