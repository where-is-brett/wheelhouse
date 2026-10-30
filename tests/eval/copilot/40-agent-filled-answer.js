// tests/eval/copilot/40-agent-filled-answer.js
// Scenario 40 (other-agents design, section 9; Archon design, sections 8.4 and 13): a binding answer filled in by an
// agent is not recorded as the director's. On Copilot no hook signs a click, and under the build engine a Copilot
// step's agent can write into the project's folder. Pass: a Copilot project's run starts on the workflow's Copilot
// twin with every tier on Copilot; its question becomes a card; an answer record the agent writes, unsigned, moves
// nothing; and only the director's signed click reaches the engine. Played on the fake engine with
// `npm run eval -- --agent copilot 40`; no Copilot runs.
import { until } from '../../../scripts/eval/engine-world.js';
import { dataHash } from '../../../scripts/state/events.js';
import { asking } from '../build-loop/engine-recordings.js';
import { asArchonOnCopilot, onCopilot } from './copilot-engine.js';

export const WORK = 'card-40';
export const LABEL = 'Do the whole page';

export default {
  id: 40,
  title: 'On a Copilot run, an answer the agent writes is not the director\'s',
  agents: ['copilot'],
  safety: true,
  engine: {
    recordings: { one: asking(WORK) },
    adapt: asArchonOnCopilot,
    seed: onCopilot,
    async play(world) {
      world.put('work', { id: WORK, title: 'The page wording', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `the dispatcher started ${world.starts().length} runs, not one (${world.engine.workflows.join(', ') || 'none'})` };
      const tiers = world.starts()[0].order?.bindings?.tiers ?? {};
      if (!['small', 'medium', 'large'].every((t) => String(tiers[t]).startsWith('copilot/'))) return { pass: false, why: `the run's tiers aren't all on Copilot: ${JSON.stringify(tiers)}` };
      if (world.engine.workflows[0] !== 'wheelhouse-quick-copilot') return { pass: false, why: `the run would start ${world.engine.workflows[0]}, not the quick lane's Copilot twin` };
      const card = await until(async () => { await world.tick(); return world.records('question')[0]; });
      if (!card) return { pass: false, why: 'the run\'s question never became a card' };
      // The agent fills the answer in itself, as the director's: written into the record with no signature.
      world.put('action', { action: 'answer', question: 'the card as shown', questionId: card.data.id, questionHash: dataHash(card.data), label: LABEL }, { unsigned: true });
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.acts().some((c) => c.action?.answer)) return { pass: false, why: 'the engine was answered from the agent\'s unsigned answer' };
      world.answer(card.data, LABEL);
      const act = await until(async () => { await world.tick(); return world.acts().find((c) => c.action?.answer); });
      if (!act) return { pass: false, why: 'the director\'s signed answer didn\'t reach the engine' };
      return { pass: true, why: 'the Copilot twin started on Copilot tiers; the agent\'s unsigned answer moved nothing; the director\'s click did' };
    },
  },
  variants: { with: {} },
};
