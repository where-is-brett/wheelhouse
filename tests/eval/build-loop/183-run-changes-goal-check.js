// tests/eval/build-loop/183-run-changes-goal-check.js
// Scenario 183 (unattended goals design, section 4.1): a run tries to change the file a goal's check is in. Pass: the tool
// guard refuses the edit, and when the change gets there by a way the guard can't read, it stops at mark ready with a card
// and never reaches the merge queue. Played on the engine the run names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { areaQuestion } from '../../../scripts/engine/areas.js';
import { decide } from '../../../scripts/hooks/areas.js';
import { running } from './engine-recordings.js';
import { signGoal } from './goal-world.js';

const WORK = 'card-183';
const CHECK_FILE = 'README.md';
const stepEnv = (runId) => ({ WHEELHOUSE_ENGINE_RUN: '1', WORKFLOW_ID: runId, ARCHON_NODE_EXECUTION: JSON.stringify({ runId, path: ['implement'], invocation: 1, attempt: 1 }) });

export default {
  id: 183,
  title: 'A run can\'t change a goal\'s check file',
  engine: {
    startAt: '2026-11-01T09:00:00.000Z',
    place: 'no-ci',
    recordings: { [WORK]: running(WORK) },
    async play(world, { now }) {
      signGoal(world, { id: 'goal-183', work: WORK, title: 'The sale banner', now, checkFiles: [CHECK_FILE], areas: { may: ['src/**', CHECK_FILE], wontTouch: [CHECK_FILE] } });
      const { runId, head } = await world.lane(WORK, { ready: false });
      const edit = { tool_name: 'Edit', cwd: world.folder, tool_input: { file_path: CHECK_FILE, old_string: 'a', new_string: 'b' } };
      const refused = await decide(edit, { env: stepEnv(runId), client: { engine: { areas: world.areas } } });
      if (refused?.hookSpecificOutput?.permissionDecision !== 'deny') return { pass: false, why: 'the tool guard let the edit through' };
      const marked = await world.markReady(WORK);
      if (marked?.held !== 'areas') return { pass: false, why: `marking it ready read ${JSON.stringify(marked)}` };
      const id = areaQuestion(WORK, head);
      const card = await until(async () => { await world.tick(); return world.records('question').find((q) => q.data.id === id); });
      if (!card) return { pass: false, why: 'no card came' };
      if (world.engine.calls.some((c) => c.call === 'handOver')) return { pass: false, why: 'the merge queue was handed the change' };
      return { pass: true, why: 'the guard refused the edit, and the change that got past it stopped at mark ready with a card' };
    },
  },
  variants: { with: {} },
};
