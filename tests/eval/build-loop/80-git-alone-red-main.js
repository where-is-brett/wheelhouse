// tests/eval/build-loop/80-git-alone-red-main.js
// Scenario 80 (local checks spec, sections 7.6 and 11): the main version of a project with no host fails its clean check. Pass:
// one red-main incident and no card; one fix-main run; other work doesn't start while it is red; and once a new main
// version reads green the incident closes and the held work starts. The fix's way to the main version through the
// helper's gate is stood in by that new version, as in `tests/e2e/git-alone-merge.test.js`. Played on the engine the run
// names, in its `with` variant alone. On real Archon (`real`), the clean checks run under the sandbox and the fix-main run and
// the held work's run really start.
import { until } from '../../../scripts/eval/engine-world.js';
import { OUT_OF_ORDER } from '../../../scripts/eval/places.js';
import { fixing, running } from './engine-recordings.js';

const HELD = 'card-80';
// A run the engine took: a real engine may refuse one.
const began = (start) => start.got?.ok !== false;

async function judge(world, wait) {
  const first = await world.homeMain();
  const passedAt = (commit) => world.checks().some((c) => c.commit === commit && c.clean === true && c.result === 'passed');
  if (!await wait(async () => { await world.tick(); return passedAt(first); })) return { pass: false, why: `the first main version never passed its check: ${JSON.stringify(world.checks().map((c) => c.result))}` };
  const red = await world.land(OUT_OF_ORDER);
  const open = () => world.views().incidents.open.find((i) => i.kind === 'red-main');
  const incident = await wait(async () => { await world.tick(); return open(); });
  if (!incident) return { pass: false, why: `no incident opened; the checks at the red version read ${JSON.stringify(world.checks().filter((c) => c.commit === red).map((c) => c.result))}` };
  if (world.records('question').length + world.records('card').length > 0) return { pass: false, why: 'a card came to the director for a red main line' };
  const fixes = () => world.starts().filter((s) => s.order.lane === 'fix-main' && began(s));
  if (!await wait(async () => { await world.tick(); return fixes().length > 0; })) return { pass: false, why: 'no fix-main run started' };
  world.put('work', { id: HELD, title: 'The footer links', lane: 'quick', visible: false, dependsOn: [] });
  for (let i = 0; i < 3; i += 1) await world.tick();
  if (world.starts().some((s) => s.order.work === HELD)) return { pass: false, why: 'other work started while the main line was red' };
  if (fixes().length !== 1) return { pass: false, why: `${fixes().length} fix runs started, not one` };
  const green = await world.land('In order again.');
  if (!await wait(async () => { await world.tick(); return passedAt(green) && !open(); })) return { pass: false, why: 'the incident stayed open with the main line green' };
  if (!await wait(async () => { await world.tick(); return world.starts().some((s) => s.order.work === HELD && began(s)); })) return { pass: false, why: 'the held work didn\'t start once the main line was green' };
  if (fixes().length !== 1) return { pass: false, why: 'a second fix run started' };
  if (world.records('question').length + world.records('card').length > 0) return { pass: false, why: 'a card came to the director while the main line was mended' };
  return { pass: true, why: 'one incident and one fix run, no card, other work held, closed on green, and the held work started' };
}

export default {
  id: 80,
  title: 'A red main line in git alone holds the work and is mended, with no card',
  engine: {
    place: 'git-alone',
    recordings: { 'fix-main': fixing('fix-main'), [HELD]: running(HELD) },
    play: (world) => judge(world, until),
    real: (world, { until: wait }) => judge(world, wait),
  },
  variants: { with: {} },
};
