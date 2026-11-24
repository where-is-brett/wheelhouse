// tests/eval/front-desk/11-feature-design.js
// Scenario 11 (the feature design step, 24 November 2026): a feature request, "customers should see their past orders on a page".
// Pass: brainstorming is loaded (Superpowers' own, as Wheelhouse installs it, or `wheelhouse-brainstorming` in Copilot's chat); the
// first question is a card for what the first version includes (a `question` card, topic `design-<work id>`, its text naming the first
// version), at most three question cards in all; and the design's summary is posted as a chat message of its own, with the link to the
// whole design, before the approval card ("Approve this design?") is asked. Nothing is built.
// Run it with `npm run eval -- 11 --variant with` and `--variant without`.
//
// One session over three of the director's turns: the request, then two answers. Judged from the events, the cards recorded and the calls.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import { buildCommands, buildDispatches, cardsRecorded, productWrites, replyText, setUpFrontDesk, skillsStarted, writtenEvents } from '../../../scripts/eval/front-desk.js';
import { SHOP_FILES, clock } from './shop.js';

export const MESSAGE = 'Customers should be able to see their past orders on a page, and reorder one with a click.';
export const PROMPTS = [
  MESSAGE,
  'Go with what you recommend for the first version.',
  'That all sounds right. Please write the design and put it to me.',
];

export const BRAINSTORMING = /(?:^|[:-])brainstorming$/;
const APPROVE = 'Approve this design?';
const LINK = /The whole design: \[[^\]]+\]\([^)]+\)/;

// The session's moves in order: the chat messages it posted ({ text }) and the questions it asked ({ ask }).
export function moves(events) {
  const out = [];
  for (const event of events) {
    if (event.type !== 'assistant' || event.parent_tool_use_id) continue;
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of content) {
      if (block.type === 'text' && String(block.text ?? '').trim() !== '') out.push({ text: block.text });
      if (block.type === 'tool_use' && block.name === 'AskUserQuestion') for (const q of block.input?.questions ?? []) out.push({ ask: String(q?.question ?? '') });
    }
  }
  return out;
}

// The pass, from the events, the cards recorded and the calls.
export function judge({ events = [], written, calls, dir }) {
  const loaded = skillsStarted(calls).some((s) => BRAINSTORMING.test(s));
  if (!loaded) return { pass: false, why: 'brainstorming was never loaded' };
  const questions = cardsRecorded(written).filter((c) => c.kind === 'question');
  if (questions.length === 0) return { pass: false, why: 'brainstorming loaded, but no question card was recorded' };
  if (questions.length > 3) return { pass: false, why: `${questions.length} question cards: at most three in all` };
  const first = questions[0];
  if (!/first version/i.test(String(first.question ?? ''))) return { pass: false, why: 'its first question card does not ask what the first version includes' };
  const off = questions.filter((c) => !String(c.topic ?? '').startsWith('design-'));
  if (off.length > 0) return { pass: false, why: `a question card has the topic ${JSON.stringify(off[0].topic)}, not design-<work id>` };
  const built = [...new Set(productWrites(calls, dir))];
  if (built.length > 0 || buildCommands(calls).length > 0 || buildDispatches(calls).length > 0) return { pass: false, why: `something was built${built.length > 0 ? `: ${built.join(', ')}` : ''}` };
  const order = moves(events);
  const approval = order.findIndex((m) => typeof m.ask === 'string' && m.ask.includes(APPROVE));
  if (approval === -1) return { pass: false, why: `no approval card asking "${APPROVE}" was put to the director` };
  const summary = order.findIndex((m, i) => i < approval && typeof m.text === 'string' && LINK.test(m.text));
  if (summary === -1) return { pass: false, why: 'the design\'s summary, with the link to the whole design, was not posted as a message before the approval card' };
  return { pass: true, why: `brainstorming loaded, ${questions.length} question card${questions.length === 1 ? '' : 's'} (the first about the first version), the summary posted before the approval card, and nothing built` };
}

export default {
  id: 11,
  title: 'A feature design, shaped with questions',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, { files: SHOP_FILES, lastPrompt: ago(20) });
  },

  prompts: PROMPTS,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 60,

  pass: ({ events, turns, dir, context }) => (turns && turns.length < PROMPTS.length
    ? { pass: false, why: `did not count: ${turns.length} of ${PROMPTS.length} turns ran` }
    : judge({ events, written: writtenEvents(context), calls: callsOf(events), dir })),
};
