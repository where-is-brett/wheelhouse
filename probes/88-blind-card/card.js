// probes/88-blind-card/card.js
// Check 88 (D4): a question card with no recommended option, run through the card check and the prompt record.
// It makes the card the composer would make for a product question, takes the recommendation out of its text and
// out of its options' descriptions, and prints what scripts/hooks/card-check.js and scripts/hooks/prompt-record.js
// make of it. Nothing is written: both hooks run on a stand-in project that is only a function.
//
//   node probes/88-blind-card/card.js [--json]
import { composeCard } from '../../scripts/cards/compose.js';
import { cardProblems, decide as checkCard } from '../../scripts/hooks/card-check.js';
import tools from '../../adapters/claude-code/tools.js';

const input = {
  kind: 'question',
  level: 1,
  what: 'Which of two ways should the dashboard open by default?',
  why: 'It is a taste choice about your own product, so it is yours.',
  because: 'the weekly view shows more at once',
  meanwhile: 'Meanwhile that work waits, and the rest carries on.',
  recommend: 'Weekly view',
  options: [
    { label: 'Weekly view', says: 'Opens on the week, with days side by side' },
    { label: 'Daily view', says: 'Opens on today, with the hours listed' },
  ],
};

export function blindCard() {
  const { question } = composeCard(input);
  // The recommendation line, and the "Recommended:" mark on the one option that carries it.
  const text = question.question.split('\n').filter((l) => !/^Recommended:/i.test(l)).join('\n');
  return {
    ...question,
    question: text,
    options: question.options.map((o) => ({ label: o.label, description: o.description.replace(/^Recommended: /, '').replace(/, because .*$/, '') })),
  };
}

export async function trial() {
  const normal = composeCard(input).question;
  const blind = blindCard();
  const event = (q) => ({ tool_name: tools.ask, cwd: '/trial/project', tool_input: { questions: [q] } });
  const opts = { projectOf: () => ({ dir: '/trial/project' }) };
  return {
    normalProblems: cardProblems(normal),
    blindProblems: cardProblems(blind),
    normalHook: (await checkCard(event(normal), opts)) ?? 'let through',
    blindHook: (await checkCard(event(blind), opts)) ?? 'let through',
    blind,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const out = await trial();
  console.log(JSON.stringify(out, null, 2));
}
