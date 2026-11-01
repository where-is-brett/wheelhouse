// tests/eval/build-loop/185-late-piece-caught.js
// Scenario 185 (unattended goals design, sections 4.1 and 8): a piece merged early and then taken off the sheet by a narrowing
// breaks late. Pass: the last check still runs that piece's check, from the signed sheet, against the main line's head, the
// signed result names what failed, and it can't read as Done. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { lastCheckHolds, sheetHash } from '../../../scripts/engine/goal.js';
import { dataHash } from '../../../scripts/state/events.js';
import { startGoalLine } from '../../../scripts/state/card-lines.js';
import { goalChecked } from './engine-recordings.js';

const GOAL = 'orders-export';
const EARLY = { id: 'card-185-early', title: 'The early piece', lane: 'quick', visible: false, dependsOn: [] };
const LATER = { id: 'card-185-later', title: 'The later piece', lane: 'quick', visible: false, dependsOn: [] };
const OWN = { command: 'node export-works.js', expect: 0 };
const EARLY_CHECK = { command: 'node early-piece.js', expect: 0 };
const LATER_CHECK = { command: 'node later-piece.js', expect: 0 };
const AT = '2026-10-29T09:00:00.000Z';

const SHEET = {
  title: 'Customers can export their orders', done: [OWN], checksSay: ['The export works.'],
  pieces: [{ work: EARLY.id, hash: dataHash(EARLY), done: [EARLY_CHECK] }, { work: LATER.id, hash: dataHash(LATER), done: [LATER_CHECK] }],
  areas: { may: ['src/**'], wontTouch: ['billing/**'] }, spend: { tokens: 1000000 }, until: '2026-10-29T17:00:00.000Z',
};

export default {
  id: 185,
  title: 'A piece that breaks late is caught by the last check',
  engine: {
    place: 'git-alone',
    startAt: AT,
    recordings: {
      'goal-check': [
        goalChecked('baseline', [{ check: OWN, ok: false }]),
        goalChecked('last', [{ check: OWN, ok: true }, { check: EARLY_CHECK, ok: false }, { check: LATER_CHECK, ok: true }]),
      ],
    },
    async play(world) {
      const hash = sheetHash(SHEET);
      world.put('work', { ...EARLY });
      world.put('work', { ...LATER });
      world.put('goal', { id: GOAL, sheet: SHEET });
      await world.goalCheck(GOAL, 'before');
      if (!await until(async () => { await world.tick(); return world.records('goal-check').length === 1; })) return { pass: false, why: 'the baseline was never signed' };
      world.put('action', { action: 'start-goal', goal: GOAL, hash, label: 'Start', question: `Start this goal?\n${startGoalLine(GOAL, hash)}` });
      if (!world.views().goals[GOAL]) return { pass: false, why: 'the goal didn\'t start' };
      world.put('note', { about: 'narrow-goal', goal: GOAL, change: { pieces: [LATER.id] } });
      if (world.views().goals[GOAL].sheet.pieces.length !== 1) return { pass: false, why: 'the narrowing didn\'t take' };
      for (const piece of [EARLY, LATER]) world.put('report', { work: piece.id, outcome: 'merged', summary: 'Merged.', rulings: [] });
      const asked = await world.goalCheck(GOAL, 'last');
      if (asked.ok !== true) return { pass: false, why: `the last check didn't start: ${asked.refused}` };
      if (world.starts().filter((s) => s.order.lane === 'goal-check').length !== 2) return { pass: false, why: 'the last check didn\'t start a run of its own' };
      const last = await until(async () => { await world.tick(); return world.records('goal-check').find((r) => r.data.when === 'last'); });
      if (!last) return { pass: false, why: 'the last check was never signed' };
      const failed = last.data.results.filter((r) => r.ok === false).map((r) => r.check.command);
      if (failed.join() !== EARLY_CHECK.command) return { pass: false, why: `the failed checks read ${failed.join(', ') || 'none'}` };
      if (lastCheckHolds(world.views().goalChecks, { id: GOAL, hash, head: last.data.head })) return { pass: false, why: 'a failed last check reads as Done' };
      return { pass: true, why: 'the narrowed piece\'s check ran, its failure is named, and the goal isn\'t Done' };
    },
  },
  variants: { with: {} },
};
