// tests/eval/build-loop/133-models.js
// Scenario 133, scenario 33 rewritten against the pack (Archon design, sections 7.4, 7.6 and 18): the steps that build
// run on the models the project's routing table names, not on a model of their own choosing. Pass: no step of the pack
// names a model, only a tier; the routing table's builder, critical builder and mechanical models reach the run's work
// order as the tiers' bindings, and the engine is given them as Archon's model bindings; and every tier a step of the
// lane names is bound. No model is named in the repository: the table's names here are made up, and the real play
// reads the one model the world binds every tier to. Played on the engine the run names, in its `with` variant alone;
// on real Archon, Archon's own record of a real step says which model it ran on.
import fs from 'node:fs';
import path from 'node:path';
import { until } from '../../../scripts/eval/engine-world.js';
import { bindingsFor } from '../../../scripts/engine/archon/adapter.js';
import { TINY_GOAL, quickRun } from './engine-recordings.js';
import { isAgentStep, packWorkflows } from './pack-routes.js';

const WORK = 'card-133';
const TIERS = ['small', 'medium', 'large'];
// The routing table, by role: names that are no real model's, so nothing passes by a default.
const TABLE = { builder: 'table-builder-model', builderCritical: 'table-critical-model', mechanical: 'table-mechanical-model' };
const BOUND = { large: TABLE.builderCritical, medium: TABLE.builder, small: TABLE.mechanical };

export default {
  id: 133,
  title: 'The steps that build run on the routing table\'s models',
  engine: {
    recordings: { [WORK]: quickRun(WORK, { pr: 133 }) },
    async play(world) {
      const quick = packWorkflows().find((f) => f.name === 'wheelhouse-quick');
      const named = new Set();
      for (const { name, nodes } of packWorkflows()) {
        for (const { node, group } of nodes.filter((n) => isAgentStep(n.node))) {
          // A loop's body runs on its group's tier unless it names its own.
          const tier = node.model ?? group?.model;
          if (!TIERS.includes(tier)) return { pass: false, why: `${name}'s ${node.id} names the model ${tier}, not a tier` };
        }
      }
      for (const { node, group } of quick.nodes.filter((n) => isAgentStep(n.node))) named.add(node.model ?? group?.model);

      fs.mkdirSync(path.join(world.folder, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(world.folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: TABLE }));
      world.put('work', { id: WORK, title: 'Greet the customer by name', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started` };
      const order = await until(() => world.orders()[0]);
      if (JSON.stringify(order?.bindings?.tiers) !== JSON.stringify(BOUND)) return { pass: false, why: `the work order binds the tiers to ${JSON.stringify(order?.bindings)}` };
      const given = bindingsFor(world.starts()[0].order.bindings);
      for (const tier of TIERS) if (!given.includes(`${tier}=${BOUND[tier]}`)) return { pass: false, why: `the engine isn't given ${tier}=${BOUND[tier]}: ${given.join(' ')}` };
      for (const tier of named) if (order.bindings.tiers[tier] !== BOUND[tier]) return { pass: false, why: `the quick lane's ${tier} steps aren't bound to the table's model` };
      return { pass: true, why: `no step names a model; the table's three models reached the order and the engine as the tiers' bindings, covering the quick lane's ${[...named].sort().join(' and ')} steps` };
    },
    // On real Archon: a real quick run's first agent step, as Archon records it, ran on the model the world binds every
    // tier to.
    async real(world, { until: wait }) {
      world.put('work', { id: WORK, title: TINY_GOAL, lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      const [run] = world.runs();
      if (!run) return { pass: false, why: `the run didn't start: ${world.starts()[0]?.got?.refused ?? 'nothing was started'}` };
      const step = await wait(async () => {
        try { return (await world.engine.inspect(run)).steps?.find((s) => typeof s.model === 'string' && s.model !== ''); } catch { return null; }
      });
      if (!step) return { pass: false, why: `Archon's record never said which model a step ran on (the run is ${await world.status(run)})${await world.trouble(run)}` };
      // Archon records the model it resolved, or, when it reports none, the one asked for: a tier's word means the
      // binding wasn't applied.
      if (['small', 'medium', 'large'].includes(step.model)) return { pass: false, why: `Archon's record has the step ${step.id} asked for the tier ${step.model}, not a bound model` };
      if (!step.model.includes(world.model)) return { pass: false, why: `the step ${step.id} ran on ${step.model}, not ${world.model}, the model the world bound` };
      return { pass: true, why: `Archon's record has the step ${step.id} on ${step.model}, the bound model` };
    },
  },
  variants: { with: {} },
};
