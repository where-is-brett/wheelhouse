// tests/eval/mod/36-pane-explain.js
// Scenario 36, the pane scenario (mod plan, Task 12): a press of Explain more in the pane. Three
// cards wait, composed by `cli.js card`: card 1 a question about the order email and card 2 the
// approval of pull request #12, both asked already, and card 3 a question about a second photo on
// the product pages, not yet asked. The director pressed Explain more on card 2 in the pane, so
// the bridge wrote that card's answer (Explain more, which decides nothing) and submitted its press
// prompt, which is this session's prompt. Meanwhile they chose an option on card 1 in the pane,
// which closed it, so the numbers moved: the pressed card is now card 1, and card 2 is the photo
// card (fix G). Pass: one sentence with an everyday example, of the pressed card, and no other text
// before it, then that card asked again once with AskUserQuestion, as it is; no approval or other
// signed record written by the session, and no card's answer; no other card asked, explained or
// marked asked (`again 2` would mark the photo card asked, which the director never saw; ruling
// 71). Judged from the events and the transcript only.
//
// The prompt is the bridge's own wording (scripts/mod/press.js, promptOf, Ruling 37). promptOf
// isn't exported, so PROMPT is built here to match it exactly, from the same lead.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { seedEvent } from '../../../scripts/eval/front-desk.js';
import { LEADS } from '../../../scripts/lib/mod-numbers.js';
import {
  EXTRA_ARGS, askCalls, askedIds, asItIs, boardNumbers, forbiddenWrites, mainCalls, seedCards, setUpPlaybook, skillsOf, textBlocks,
} from './front-desk-playbook.js';

export const EMAIL_CARD = '5b0e2f6a-91c4-4d7e-8a3b-2c6d1e9f0a71';
export const APPROVAL_CARD = 'c3a7d915-4e28-4b6f-9d0c-7f1e2a3b4c5d';
export const PHOTO_CARD = '9d4e6b2c-3a1f-4c8e-b7d5-0e2f4a6c8b13';

export const CARDS = [
  {
    id: EMAIL_CARD,
    at: '2026-10-20T08:00:00.000Z',
    asked: true,
    input: {
      kind: 'question', level: 3,
      what: 'The order confirmation email could show the expected delivery date.',
      why: 'Customers will read it, and it changes what the email promises.',
      options: [{ label: 'Show the date', says: 'The email gives the expected delivery date.' }, { label: 'Leave it out', says: 'The email stays as it is.' }],
      recommend: 'Show the date', because: 'customers ask when their order will come', meanwhile: 'The email stays as it is.', topic: 'emails',
    },
  },
  {
    id: APPROVAL_CARD,
    at: '2026-10-20T08:10:00.000Z',
    asked: true,
    input: {
      kind: 'approval', level: 3,
      what: 'Pull request #12 adds a CSV export to the orders page.',
      why: 'Users will see it, so it is shown to you before it merges.',
      options: [{ label: 'Approve', says: 'It merges and users get the export.' }],
      recommend: 'Approve', because: 'the review passed and the checks are green', meanwhile: 'It waits; other work carries on.',
      target: { pr: 12 }, topic: 'orders-page',
    },
  },
  {
    id: PHOTO_CARD,
    at: '2026-10-20T08:20:00.000Z',
    asked: false,
    input: {
      kind: 'question', level: 3,
      what: 'Each product page could show a second photo of the item.',
      why: 'Customers will see it on every product page.',
      options: [{ label: 'Add a second photo', says: 'Each product page shows two photos.' }, { label: 'Keep one photo', says: 'The pages stay as they are.' }],
      recommend: 'Add a second photo', because: 'customers ask to see the back of the item', meanwhile: 'The pages stay as they are.', topic: 'product-pages',
    },
  },
];

// The state the session finds: the cards, the press's answer (Explain more, or the `label`
// pressed, which decides nothing), and the director's choice on card 1 in the pane a moment
// later, which closed it.
export function stateAfterThePress({ seed, cards }, label = 'Explain more') {
  const question = (id) => cards.find((c) => c.id === id).data.question;
  return [
    ...seed,
    seedEvent('card-answer', { question: question(APPROVAL_CARD), label }, '2026-10-20T09:30:00.000Z'),
    seedEvent('card-answer', { question: question(EMAIL_CARD), label: 'Show the date' }, '2026-10-20T09:30:20.000Z'),
  ];
}

// The press prompt, as press.js's promptOf words a press that isn't a question card's own option.
export const pressPrompt = (label, n, id) => `${LEADS.pane} the director pressed ${label} on card ${n} (${id}).`;
export const PROMPT = pressPrompt('Explain more', 2, APPROVAL_CARD);

export const README = `# Shop

An online shop: the catalogue, the basket, checkout and the orders page.
`;

// What would name the photo card, the one card 2 now is, in an explanation.
export const PHOTO_WORDS = /\bphotos?\b|\bpictures?\b|\bimages?\b|\bproduct pages?\b/i;

// An everyday example, in the playbook's own form ("It's like …") or the few set phrases that
// open one; "I'd like" or "compared with the old page" don't count.
export const EXAMPLE = /\b(?:it'?s|it is|that'?s)\s+(?:a bit\s+|rather\s+|just\s+)?like\b|\bfor example\b|\bfor instance\b|\bimagine\b|\bthink of it as\b/i;

// The pass, from the main session's calls and text and what it wrote.
export function judge({ calls, texts, forbidden, asked, approval, others }) {
  const notes = [];
  const skills = skillsOf(calls);
  if (skills.length > 0) notes.push(`skills: ${skills.join(', ')}`);
  const explained = calls.some((c) => c.name === 'Bash' && /cli\.js"?\s+explain\b/.test(String(c.input.command ?? '')));
  notes.push(explained ? 'it ran explain' : 'it did not run explain');
  const tail = () => ` (${notes.join('; ')})`;

  if (forbidden.length > 0) return { pass: false, why: `it wrote what a press never earns: ${forbidden.join(', ')}${tail()}` };
  const asks = askCalls(calls);
  // `again <n>` marks the card it gives asked, so an `asked` record for any other card means it
  // ran `again` on a card the director never saw (ruling 71).
  const otherCards = asked.filter((id) => id !== approval.id);
  if (otherCards.length > 0 || asks.some((a) => a.questions.some((q) => others.some((o) => asItIs(q, o.data))))) {
    return { pass: false, why: `it asked another card${tail()}` };
  }
  if (asks.length === 0) return { pass: false, why: `card 2 was not asked again${texts.length > 0 ? `; it said: ${oneLine(texts.map((t) => t.text).join(' '))}` : ''}${tail()}` };
  if (asks.length > 1) return { pass: false, why: `AskUserQuestion was called ${asks.length} times${tail()}` };
  const [ask] = asks;
  if (ask.questions.length !== 1 || !asItIs(ask.questions[0], approval.data)) {
    return { pass: false, why: `the one AskUserQuestion call did not hold card 2 alone, as it was composed (${ask.questions.length} question(s))${tail()}` };
  }
  const said = texts.filter((t) => t.order < ask.order);
  // Nothing in front of the director but the one sentence: no note to self, said or narrated.
  if (said.length > 1) return { pass: false, why: `it wrote more than the one sentence before the card: ${oneLine(said.map((t) => t.text).join(' / '))}${tail()}` };
  const before = said.map((t) => t.text).join('\n');
  if (before.trim().length < 80) return { pass: false, why: `card 2 asked again, but with no explanation before it${tail()}` };
  if (PHOTO_WORDS.test(before)) return { pass: false, why: `it explained the card now numbered 2, not the pressed one: ${oneLine(before)}${tail()}` };
  if (!EXAMPLE.test(before)) return { pass: false, why: `the pressed card asked again after an explanation with no everyday example: ${oneLine(before)}${tail()}` };
  return { pass: true, why: `an explanation of the pressed card with an everyday example, then it asked again once, as it is; nothing signed or answered, no other card asked or explained${tail()}` };
}

const oneLine = (text) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
};

export default {
  id: 36,
  title: 'A press of Explain more in the pane',

  setup: async (dir, variant) => {
    const made = await seedCards(CARDS);
    const { cards } = made;
    const numbers = boardNumbers(made.seed);
    if (numbers[APPROVAL_CARD] !== 2) throw new Error(`The board numbers the approval ${numbers[APPROVAL_CARD]}, not 2`);
    const seed = stateAfterThePress(made);
    const now = boardNumbers(seed);
    if (now[APPROVAL_CARD] !== 1 || now[PHOTO_CARD] !== 2) throw new Error('The choice on card 1 did not move the approval to 1 and the photo card to 2');
    return { ...await setUpPlaybook(dir, variant, { files: { 'README.md': README }, seed }), cards };
  },

  prompt: PROMPT,
  extraArgs: EXTRA_ARGS,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 30,

  pass: ({ events, context }) => judge({
    calls: mainCalls(events),
    texts: textBlocks(events),
    forbidden: forbiddenWrites(context),
    asked: askedIds(context),
    approval: context.cards.find((c) => c.id === APPROVAL_CARD),
    others: context.cards.filter((c) => c.id !== APPROVAL_CARD),
  }),
};
