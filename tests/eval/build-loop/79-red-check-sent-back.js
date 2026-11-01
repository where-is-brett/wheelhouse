// tests/eval/build-loop/79-red-check-sent-back.js
// Scenario 79 (local checks spec, sections 4.7 and 11): a run's head fails its check, on a clean copy, though its tests passed
// in the run's own worktree. Pass: the signed check reads failed, red is reported, the broker refuses the merge, and the
// work is sent back: a fresh run starts on it, its order carrying the end of the tests' output. Played on the engine the
// run names, in its `with` variant alone. On real Archon (`real`), a real quick run reaches its pull request, the real check
// fails under the sandbox and the next run is really started.
import { until } from '../../../scripts/eval/engine-world.js';
import { EVAL_LINE } from '../../../scripts/eval/places.js';
import { running } from './engine-recordings.js';

const WORK = 'card-79';
// A test of the kind that passes where it was written and nowhere else.
const ONLY_THERE = `// where.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the page works here', () => {
  if (fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8').includes('${EVAL_LINE}')) assert.ok(process.cwd().includes('worktrees'), 'The new line breaks the page on a clean copy.');
});
`;

// The cards among `questions` (question records) that a first red must not raise: every card but a run's cap, which is
// about what it spent and comes whatever its check read.
export const cardsOverTheRed = (questions) => questions.filter((q) => !/ reached its cap of /.test(q.data.what ?? ''));

async function judge(world, wait, { finished = async () => {} } = {}) {
  const { runId, pr, head } = await world.lane(WORK, { ready: false });
  const told = () => world.host.statuses.filter((s) => s.sha === head).map((s) => s.state);
  if (!await wait(async () => { await world.tick(); return told().includes('failure'); })) return { pass: false, why: `the head was reported ${told().join(', ') || 'nothing'}, never red; its checks read ${JSON.stringify(world.checks().filter((c) => c.commit === head).map((c) => c.result))}` };
  const check = world.checks().filter((c) => c.commit === head).at(-1);
  if (check?.result !== 'failed') return { pass: false, why: `the signed check reads ${check?.result ?? 'nothing'}` };
  const sent = world.dispatch().reds?.[WORK];
  if (sent?.times !== 1 || typeof sent.tail !== 'string') return { pass: false, why: `the work wasn't sent back once with the tests' output: ${JSON.stringify(sent)}` };
  // The broker reads the review before the check, so its reason is the check's only once a real review has read CLEAN.
  const reviews = () => world.records('review').filter((r) => r.data.commit === head).map((r) => r.data.verdict);
  if (!await wait(() => reviews().includes('CLEAN'))) return { pass: false, why: `no review of the head read CLEAN: ${JSON.stringify(reviews())}` };
  const refused = await world.broker(['pr', 'merge', String(pr), '--squash', '--match-head-commit', head]);
  if (refused.code === 0 || !/no passing check/.test(refused.stderr)) return { pass: false, why: `the broker didn't refuse the merge for its check: ${refused.stderr.trim()}` };
  if (world.forwarded.some((call) => call.startsWith('pr merge'))) return { pass: false, why: 'the merge reached the host' };
  // A work goes back once its run has ended; a real one ends by itself.
  await finished(runId);
  if (!await wait(async () => { await world.tick(); return world.starts().filter((s) => s.order.work === WORK && s.got?.ok !== false).length > 1; })) return { pass: false, why: `no fresh run started on the work; its first run reads ${await world.status?.(runId)}${await world.asking?.(runId) ?? ''}` };
  const carried = await wait(() => world.orders().find((o) => o.work === WORK && typeof o.checkTail === 'string' && o.checkTail !== ''));
  if (!carried) return { pass: false, why: 'the fresh run\'s order doesn\'t carry the tests\' output' };
  const cards = cardsOverTheRed(world.records('question')).map((q) => `${q.data.id}: ${q.data.what}`);
  if (cards.length > 0) return { pass: false, why: `a first red came to the director as a card: ${cards.join(' | ')}` };
  return { pass: true, why: 'a signed failed check, red reported, the merge refused, and a fresh run with the end of the tests\' output' };
}

export default {
  id: 79,
  title: 'A red check sends the work back with the end of the tests\' output',
  engine: {
    place: 'no-ci',
    files: { 'where.test.mjs': ONLY_THERE },
    says: ({ page, main }) => (!main && page.includes(EVAL_LINE) ? 'failed' : 'passed'),
    recordings: { [WORK]: [running(WORK), running(WORK)] },
    play: (world) => judge(world, until, { finished: (runId) => world.engine.act(runId, { cancel: {} }) }),
    real: (world, { until: wait }) => judge(world, wait),
  },
  variants: { with: {} },
};
