// tests/eval/build-loop/77-git-alone-to-merge.js
// Scenario 77 (local checks spec, sections 5, 7.4 and 11): a project with no host, quick lane to merge. Pass: a run's change
// opens as a local change, its head has a passing signed check and a signed review, the local queue adds it to the main
// version in the home, the folder comes up to it, and no tool of a code host runs. Played on the engine the run names, in
// its `with` variant alone. On real Archon (`real`), a real quick run goes from its work order to the merge, with its
// check under the sandbox and the real local adapter.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';

const WORK = 'card-77';

async function judge(world, wait) {
  const before = await world.homeMain();
  const { pr, head } = await world.lane(WORK);
  const merged = await wait(async () => { await world.tick(); return world.changeOf(pr)?.state === 'merged' ? world.changeOf(pr) : null; });
  if (!merged) return { pass: false, why: `the change is ${world.changeOf(pr)?.state ?? 'gone'}, not merged; the checks read ${JSON.stringify(world.checks().map((c) => c.result))}` };
  const main = await world.homeMain();
  if (main === before || main !== merged.mergeCommit) return { pass: false, why: 'the home\'s main version isn\'t the merge' };
  if (world.checks().filter((c) => c.commit === head).at(-1)?.result !== 'passed') return { pass: false, why: 'the change merged with no passing check at its head' };
  if (!world.records('review').some((r) => r.data.commit === head && r.data.verdict === 'CLEAN')) return { pass: false, why: 'the change merged with no signed review at its head' };
  if (!await wait(async () => { await world.tick(); return (await world.folderMain()) === main; })) return { pass: false, why: 'the folder never came up to the main version' };
  if (world.forwarded.length > 0) return { pass: false, why: `a code host's tool was called: ${world.forwarded.join('; ')}` };
  return { pass: true, why: 'an open local change, a signed check and review, the local queue\'s merge in the home, and the folder up to it, with no host tool' };
}

export default {
  id: 77,
  title: 'A project with no host goes from the quick lane to the main version',
  engine: {
    place: 'git-alone',
    recordings: { [WORK]: running(WORK) },
    play: (world) => judge(world, until),
    real: (world, { until: wait }) => judge(world, wait),
  },
  variants: { with: {} },
};
