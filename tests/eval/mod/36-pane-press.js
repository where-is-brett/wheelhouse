// tests/eval/mod/36-pane-press.js
// Scenario 36, the pane scenario (mod plan, Task 12; Calm interface, Task 18): a press of Suggest a
// change… in the pane. Three cards wait, composed by `cli.js card`: card 1 a question about the
// order email and card 2 the approval of pull request #12, both asked already, and card 3 a
// question about a second photo on the product pages, not yet asked. The director pressed Suggest
// a change… on card 2 and wrote their words, so the bridge wrote that card's answer (Suggest a
// change…, which marks the card steered and decides nothing, and never holds the words) and
// submitted its press prompt, which carries the words and is this session's prompt. Meanwhile
// they chose an option on card 1 in the pane, which closed it, so the numbers moved: the pressed
// card is now card 1, and card 2 is the photo card (fix G).
// Pass: the words treated as steering on the pressed approval card and no other. An approval signs
// the pull request's head, so the front desk hands the change to the build with one `work` record
// (the card's work, re-stated in its own words) and composes no card at the old head; nothing else
// is recorded, written as an answer or signed; no card is asked; and one line says that a new
// proposal will follow, with nothing else said. Judged from the events and the transcript only.
//
// The prompt is the bridge's own wording (scripts/mod/press.js, suggestCard). Its lead is built
// here to match it exactly, from the same lead, since the bridge doesn't export it.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { seedEvent, writtenEvents } from '../../../scripts/eval/front-desk.js';
import { LEADS } from '../../../scripts/lib/mod-numbers.js';
import { SUGGEST } from '../../../scripts/lib/calm-words.js';
import {
  EXTRA_ARGS, HEAD, askCalls, askedIds, boardNumbers, forbiddenWrites, mainCalls, seedCards, setUpPlaybook, skillsOf, textBlocks,
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

// The state the session finds: the cards, the press's answer (Suggest a change…, or the `label`
// pressed, which decides nothing), and the director's choice on card 1 in the pane a moment
// later, which closed it.
export function stateAfterThePress({ seed, cards }, label = SUGGEST) {
  const question = (id) => cards.find((c) => c.id === id).data.question;
  return [
    ...seed,
    seedEvent('card-answer', { question: question(APPROVAL_CARD), label }, '2026-10-20T09:30:00.000Z'),
    seedEvent('card-answer', { question: question(EMAIL_CARD), label: 'Show the date' }, '2026-10-20T09:30:20.000Z'),
    // The work pull request #12 belongs to, which the handing-over names.
    seedEvent('work', { id: 'orders-csv-export', title: 'A CSV export on the orders page', lane: 'small', visible: true, dependsOn: [], place: 3 }, '2026-10-20T08:05:00.000Z'),
  ];
}

// The press prompt, as press.js's promptOf words a press that isn't a question card's own option.
export const pressPrompt = (label, n, id) => `${LEADS.pane} the director pressed ${label} on card ${n} (${id}).`;

// The director's words with Suggest a change…, and the prompt that carries them, as press.js's
// suggestCard words it.
export const WORDS = 'Only include this month\'s orders in the export.';
export const suggestPrompt = (n, id, words) => `${LEADS.pane} the director suggested a change on card ${n} (${id}): ${words}`;
export const PROMPT = suggestPrompt(2, APPROVAL_CARD, WORDS);

export const README = `# Shop

An online shop: the catalogue, the basket, checkout and the orders page.
`;

// What would name the photo card, the one card 2 now is, in a line.
export const PHOTO_WORDS = /\bphotos?\b|\bpictures?\b|\bimages?\b|\bproduct pages?\b/i;

const IDS = CARDS.map((c) => c.id);

// The one line the front desk says: that a new proposal will follow.
export const FOLLOWS = /\bnew proposal\b[^.]*\b(?:will follow|follows|is coming|will come)\b/i;

const oneLine = (text) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
};

// The pass, from the main session's calls and text and what it wrote. `written` is the events it
// wrote to the state; `forbidden` is what a press never earns (forbiddenWrites, less the cards,
// which are judged here by what they revise).
export function judge({ calls, texts, forbidden, written, asked, approval }) {
  const notes = [];
  const skills = skillsOf(calls);
  if (skills.length > 0) notes.push(`skills: ${skills.join(', ')}`);
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');
  const problems = [];

  if (forbidden.length > 0) problems.push(`it wrote what a press never earns: ${forbidden.join(', ')}`);
  const cards = written.filter((e) => e.kind === 'card');
  if (cards.length > 0) problems.push('it composed a card, though the pull request\'s head has not moved');
  const handed = written.filter((e) => e.kind === 'work');
  if (handed.length === 0) problems.push('it did not hand the change to the build with a work record');
  if (handed.length > 1) problems.push(`it recorded ${handed.length} work records`);
  if (handed.some((e) => JSON.stringify(e.data ?? {}).includes(WORDS))) problems.push('the work record holds the director\'s own words');
  const recorded = [...new Set(written.map((e) => e.kind).filter((kind) => !['work', 'asked'].includes(kind)))];
  if (recorded.length > 0) problems.push(`it recorded more than the work: ${recorded.join(', ')}`);
  // Any `asked` record naming a card other than the pressed one is a card the director never saw.
  if (asked.some((id) => id !== approval.id)) problems.push('it asked another card');
  if (askCalls(calls).length > 0) problems.push('it asked a card with AskUserQuestion, though the new proposal comes later');

  const all = texts.map((t) => t.text).join('\n');
  if (texts.length === 0) problems.push('it said nothing: no line saying a new proposal will follow');
  else if (texts.length > 1) problems.push(`it wrote more than the one line: ${oneLine(texts.map((t) => t.text).join(' / '))}`);
  else {
    if (/\n/.test(all.trim())) problems.push(`the line is not one line: ${oneLine(all)}`);
    if (all.trim().split(/\s+/).length > 25) problems.push(`the line is longer than 25 words: ${oneLine(all)}`);
    if (!FOLLOWS.test(all)) problems.push(`the line does not say a new proposal will follow: ${oneLine(all)}`);
  }
  if (IDS.some((id) => all.includes(id))) problems.push(`it showed a card's id: ${oneLine(all)}`);
  if (PHOTO_WORDS.test(all)) problems.push(`it spoke of the card now numbered 2, not the pressed one: ${oneLine(all)}`);

  if (problems.length > 0) return { pass: false, why: `${problems.join('; ')}${tail()}` };
  return { pass: true, why: `the suggestion handed to the build as one work record, no card composed, one line that a new proposal will follow; nothing answered, signed or otherwise recorded, no card asked${tail()}` };
}

export default {
  id: 36,
  title: 'A press of Suggest a change… in the pane',

  setup: async (dir, variant) => {
    const made = await seedCards(CARDS);
    const numbers = boardNumbers(made.seed);
    if (numbers[APPROVAL_CARD] !== 2) throw new Error(`The board numbers the approval ${numbers[APPROVAL_CARD]}, not 2`);
    const seed = stateAfterThePress(made);
    const now = boardNumbers(seed);
    if (now[APPROVAL_CARD] !== 1 || now[PHOTO_CARD] !== 2) throw new Error('The choice on card 1 did not move the approval to 1 and the photo card to 2');
    // Pull request #12 is open on the stand-in host, which the command reads to compose a card
    // about it.
    return { ...await setUpPlaybook(dir, variant, { files: { 'README.md': README }, seed, pullRequests: { 12: HEAD } }), cards: made.cards };
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
    forbidden: forbiddenWrites(context).filter((kind) => kind !== 'card'),
    written: writtenEvents(context),
    asked: askedIds(context),
    approval: context.cards.find((c) => c.id === APPROVAL_CARD),
  }),
};
