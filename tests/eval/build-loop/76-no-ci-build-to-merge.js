// tests/eval/build-loop/76-no-ci-build-to-merge.js
// Scenario 76 (local checks spec, sections 4 and 11): a hosted project with no CI, build to merge. Pass: a quick run's head is
// reported pending, checked on this computer and reported green from a signed `check` record; Wheelhouse's own status
// doesn't make the project read as having CI, so the next look at it still runs here; and the broker's permit lets the merge
// through. No card comes. Played on the engine the run names, in its `with` variant alone. On real Archon (`real`), a real
// quick run goes from its work order to its pull request, the check runs under the sandbox, and the broker's own launcher
// is run as Archon's steps run gh; GitHub is stood in, and a call let through is kept, not run.
import { until } from '../../../scripts/eval/engine-world.js';
import { running } from './engine-recordings.js';

const WORK = 'card-76';

async function judge(world, wait) {
  const { pr, head } = await world.lane(WORK);
  const told = () => world.host.statuses.filter((s) => s.sha === head).map((s) => s.state);
  if (!await wait(async () => { await world.tick(); return told().includes('success'); })) return { pass: false, why: `the head was reported ${told().join(', ') || 'nothing'}, never green` };
  if (told()[0] !== 'pending') return { pass: false, why: `the head's first report was ${told()[0]}, not pending` };
  const check = world.checks().filter((c) => c.commit === head).at(-1);
  if (check?.result !== 'passed') return { pass: false, why: `the signed check reads ${check?.result ?? 'nothing'}` };
  if (!await wait(async () => { await world.tick(); return world.checks().some((c) => c.clean === true && c.commit !== head && c.result === 'passed'); })) return { pass: false, why: 'the main line was never checked here: Wheelhouse\'s own status read as the project\'s CI' };
  const merged = await world.broker(['pr', 'merge', String(pr), '--squash', '--match-head-commit', head]);
  if (merged.code !== 0) return { pass: false, why: `the broker refused the merge: ${merged.stderr.trim()}` };
  if (!world.forwarded.some((call) => call.startsWith(`pr merge ${pr} `))) return { pass: false, why: 'the merge was never forwarded to the host' };
  const cards = world.records('question').filter((q) => q.data.work === 'checks');
  if (cards.length > 0) return { pass: false, why: `a card came about the checks: ${cards[0].data.what}` };
  return { pass: true, why: 'pending, checked here, green from the signed record, and the permit let the merge through, with no card' };
}

export default {
  id: 76,
  title: 'A hosted project with no CI goes from build to merge on the checks of this computer',
  engine: {
    place: 'no-ci',
    recordings: { [WORK]: running(WORK) },
    play: (world) => judge(world, until),
    real: (world, { until: wait }) => judge(world, wait),
  },
  variants: { with: {} },
};
