// tests/eval/build-loop/60-red-main-fixed.js
// Scenario 60 (Archon design, sections 7.7 and 18): the merge gate holds on a red main line while other work waits to
// start. Pass: the hold opens one red-main incident with no card; the dispatcher starts one fix-main run and holds the
// waiting piece; once the fix run has ended and the main line reads green, the incident closes and the waiting piece
// starts on the next tick. The fix's merge through the helper's gate is scenario 61's. Played on the engine the run
// names, in its `with` variant alone.
import { until } from '../../../scripts/eval/engine-world.js';
import { redMain, fixing, running } from './engine-recordings.js';

const SHA = '6060606a2b3c4d5e6f708192a3b4c5d6e7f80912';

export default {
  id: 60,
  title: 'A red main line is fixed, and held work goes on once it is green',
  engine: {
    recordings: { 'card-60': redMain('card-60'), 'fix-main': fixing('fix-main', 'completed'), 'card-60b': running('card-60b') },
    // The code host's main line: red until the scenario turns it green.
    host: () => {
      const host = { state: 'failure' };
      return Object.assign(host, {
        defaultBranch: async () => 'main',
        branchHead: async () => SHA,
        ciState: async (sha) => ({ sha, state: host.state }),
      });
    },
    async play(world) {
      world.put('work', { id: 'card-60', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      const incident = await until(() => world.views().incidents.open.find((i) => i.kind === 'red-main'));
      if (!incident) return { pass: false, why: 'answering the hold opened no red-main incident' };
      if (world.records('question').length + world.records('card').length > 0) return { pass: false, why: 'a card came to the director for a red main line' };
      world.put('work', { id: 'card-60b', title: 'The footer links', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      await world.tick();
      const lanes = () => world.starts().map((s) => s.order.lane);
      if (lanes().filter((l) => l === 'fix-main').length !== 1) return { pass: false, why: `the dispatcher started ${lanes().filter((l) => l === 'fix-main').length} fix runs, not one` };
      if (world.starts().some((s) => s.order.work === 'card-60b')) return { pass: false, why: 'other work started while the main line was red' };
      const fix = world.starts().find((s) => s.order.lane === 'fix-main').order;
      if (fix.work !== incident.work) return { pass: false, why: `the fix run isn't the incident's fix (${fix.work})` };
      // The fix run has ended; the main line turns green.
      world.host.state = 'success';
      await world.tick();
      if (world.views().incidents.open.length > 0) return { pass: false, why: 'the incident stayed open with the main line green' };
      await world.tick();
      if (!await until(() => world.starts().some((s) => s.order.work === 'card-60b'))) return { pass: false, why: 'the held piece didn\'t start once the main line was green' };
      if (lanes().filter((l) => l === 'fix-main').length !== 1) return { pass: false, why: 'a second fix run started' };
      const said = world.records('note').filter((n) => n.data.about === 'engine').map((n) => n.data.words);
      if (!said.some((w) => /green again/.test(w))) return { pass: false, why: 'the Logbook doesn\'t say the main line is green again' };
      return { pass: true, why: 'one incident and one fix run, other work held, closed on green, held work started' };
    },
  },
  variants: { with: {} },
};
