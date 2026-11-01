// tests/eval/build-loop/122-question-not-ruling.js
// Scenario 122, scenario 22 rewritten against the pack (Archon design, sections 7.2, 8.3 and 18): a step meets a choice
// that changes what users see, the price format at checkout. Pass: every agent step of every workflow can only put a
// level 3 or 4 question through its blocked exit, and the rules every step reads say so; the work order the run is
// served says what users see beyond the goal is level 3; the step's question comes to the director as one level-3 card
// with the step's options and recommendation, even when the ask brings an answer of its own; nothing answers it, the
// run starts nothing more, and the director's click is what goes back. Played on the engine the run names, in its
// `with` variant alone.
import fs from 'node:fs';
import path from 'node:path';
import { until } from '../../../scripts/eval/engine-world.js';
import { PACK_DIR, NO_PERSON_LINE, READ_ONLY } from '../../../scripts/engine/pack-check.js';
import { asking } from './engine-recordings.js';
import { isAgentStep, packWorkflows } from './pack-routes.js';

const WORK = 'card-122';
const WHAT = 'How should a price show at checkout: $12.50, A$12.50 or 12.50 AUD? Whichever is used shows on every checkout page.';
const FORMATS = [{ id: 'dollars', label: '$12.50' }, { id: 'prefix', label: 'A$12.50' }, { id: 'suffix', label: '12.50 AUD' }];
const USERS_SEE = /^Level 3 is a blocked exit, never a choice you make: what users see beyond the goal/;

export default {
  id: 122,
  title: 'A choice users would see comes to the director as a level-3 card, and the run waits',
  engine: {
    // The step's ask, carrying an answer as if it had ruled: the router still asks the director.
    recordings: { [WORK]: asking(WORK, { level: 3, what: WHAT }).map((e) => (e.type === 'ask' ? { ...e, options: FORMATS, recommend: 'prefix', answer: 'dollars' } : e)) },
    async play(world) {
      for (const { name, nodes } of packWorkflows()) {
        for (const { node } of nodes.filter((n) => isAgentStep(n.node))) {
          const shape = node.output_format?.properties ?? {};
          // The reader alone: it runs after the card is written, changes no outcome and raises nothing, so it has no exit.
          if (READ_ONLY.has(name)) {
            if (shape.blocked) return { pass: false, why: `${name}'s ${node.id} has a blocked exit, and a reader raises nothing` };
            continue;
          }
          if (!shape.blocked || !shape.question || !shape.options || !shape.recommend || JSON.stringify(shape.level?.enum) !== '["3","4"]') return { pass: false, why: `${name}'s ${node.id} has no blocked exit for a level 3 or 4 question alone` };
        }
      }
      const rules = fs.readFileSync(path.join(PACK_DIR, 'prompts', 'rules.md'), 'utf8');
      if (!rules.includes(NO_PERSON_LINE) || !/A level 3 or 4 question is the one exception: take the blocked exit/.test(rules)) return { pass: false, why: 'the rules every step reads don\'t send a level 3 or 4 question to the blocked exit' };

      world.put('work', { id: WORK, title: 'The price at checkout', lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      if (world.starts().length !== 1) return { pass: false, why: `${world.starts().length} runs started` };
      const order = await until(() => world.orders()[0]);
      if (!order?.decisionRules?.some((rule) => USERS_SEE.test(rule))) return { pass: false, why: 'the work order doesn\'t say what users see is level 3' };
      const card = await until(async () => { await world.tick(); return world.records('question')[0]; });
      if (!card) return { pass: false, why: 'no card came for the step\'s question' };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.records('question').length !== 1) return { pass: false, why: `${world.records('question').length} cards came for one question` };
      if (card.data.level !== 3 || !card.data.what.includes('How should a price show at checkout')) return { pass: false, why: `the card is level ${card.data.level}, asking ${card.data.what}` };
      if (card.data.recommendation !== 'A$12.50' || card.data.options.map((o) => o.label).sort().join() !== FORMATS.map((f) => f.label).sort().join()) return { pass: false, why: 'the card doesn\'t give the step\'s options and recommendation' };
      if (world.acts().some((c) => c.action?.answer)) return { pass: false, why: 'the question was answered before the director chose' };
      if (world.records('note').some((n) => /answered/.test(n.data.words ?? ''))) return { pass: false, why: 'the Logbook says the question was answered for the director' };
      if (world.starts().length !== 1) return { pass: false, why: 'the work ran again while its question waited' };
      world.answer(card.data, '12.50 AUD');
      const act = await until(async () => { await world.tick(); return world.acts().find((c) => c.action?.answer); });
      if (act?.action.answer.choice !== 'suffix') return { pass: false, why: `the director's click didn't go back as their choice: ${JSON.stringify(act?.action)}` };
      return { pass: true, why: 'every step\'s only way to a level-3 choice is its blocked exit; the price question came as one level-3 card, unanswered until the director\'s click went back' };
    },
  },
  variants: { with: {} },
};
