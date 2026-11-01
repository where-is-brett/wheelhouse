// tests/eval/build-loop/186-report-against-record.js
// Scenario 186 (unattended goals design, section 10): a goal of two pieces, one merged and one going when the director ends it now,
// with a sleep in between. Pass: the report, made by a script from the record, reads line by line against that record: the merged
// piece is Added and nothing else is, the one stopped is left undone by name, the sleep is under What went wrong, and the spend is
// what the goal's `goal-end` holds, unknown spend reading as unknown. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { goalReport, goalReportText } from '../../../scripts/engine/goal-report.js';
import { quickRun, running } from './engine-recordings.js';
import { signGoal, setPace, longRuns, goalEnds, endingsOf, startedRuns, tickTimes } from './goal-world.js';

const GOAL = 'goal-186';
const FIRST = 'card-186-a';
const SECOND = 'card-186-b';
const PR = 1861;
const WAKES = '2026-10-29T09:41:00.000Z';

export default {
  id: 186,
  title: 'The report on a goal reads line by line against its record',
  engine: {
    place: 'git-alone',
    startAt: '2026-10-29T09:00:00.000Z',
    recordings: { [FIRST]: quickRun(FIRST, { pr: PR }), [SECOND]: running(SECOND, 1000) },
    async play(world, { now, at }) {
      longRuns(world);
      setPace(world, 2);
      signGoal(world, { id: GOAL, works: [{ work: FIRST, title: 'The sale banner' }, { work: SECOND, title: 'The sale page' }], now });
      const ended = await until(async () => { await world.tick(); return world.records('run').find((r) => r.data.work === FIRST && r.data.pr === PR); });
      if (!ended) return { pass: false, why: 'the first piece\'s run never ended with its pull request' };
      world.put('report', { work: FIRST, outcome: 'merged', pr: PR, summary: 'Merged.', rulings: [] });
      if (!await until(async () => { await world.tick(); return startedRuns(world, SECOND).length > 0; })) return { pass: false, why: 'the second piece never started' };
      // The clock jumps, as the computer's does asleep: the helper's next beat records the span.
      at(WAKES);
      await tickTimes(world, 2);
      const [slept] = world.records('slept');
      if (!slept) return { pass: false, why: 'no sleep was recorded' };
      const minutes = Math.floor((Date.parse(slept.data.to) - Date.parse(slept.data.from)) / 60000);
      world.put('note', { about: 'end-goal', goal: GOAL, now: true });
      if (!await until(async () => { await world.tick(); return endingsOf(world) !== ''; })) return { pass: false, why: 'the goal never ended' };

      const views = world.views();
      const goal = { id: GOAL, ...views.goals[GOAL] };
      const report = goalReport({ goal, views, ending: goal.ended, timeZone: 'UTC' });
      const text = goalReportText(report);
      const [end] = goalEnds(world);
      const spend = end.data.spent.unknown ? /\*\*Spent:\*\* Unknown/ : /\*\*Spent:\*\* \S/;
      const failures = [
        [report.added.pieces.join() === 'The sale banner', 'Added isn\'t the one piece merged'],
        [report.verdict.left.join() === 'The sale page', 'what\'s left undone isn\'t named'],
        [text.includes('Left undone: The sale page.'), 'the words don\'t name what\'s left undone'],
        [report.wrong.some((line) => line.startsWith(`The computer slept for ${minutes} minutes at `)), 'the sleep on the record isn\'t under What went wrong'],
        [report.spent.tokens === end.data.spent.tokens && report.spent.unknown === end.data.spent.unknown, 'the spend isn\'t the record\'s'],
        [spend.test(text), 'the spend doesn\'t read as the record does'],
        [report.waits.top.length === 0, 'something waits with no card behind it'],
        [text.indexOf('**Added') < text.indexOf('**What went wrong') && text.indexOf('**What went wrong') < text.indexOf('**Spent'), 'the parts are out of order'],
      ].filter(([holds]) => !holds).map(([, why]) => why);
      if (failures.length > 0) return { pass: false, why: `${failures.join('; ')}: ${text}` };
      return { pass: true, why: 'each line of the report reads against the record: one piece added, one left undone by name, the sleep and the spend as written' };
    },
  },
  variants: { with: {} },
};
