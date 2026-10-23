// tests/eval/mod/36-pane-why.js
// Scenario 36's leg `why` (Calm interface, Task 18): the director types "why?" about card 2 in the
// chat. The three cards wait as in 36, composed by `cli.js card`, with the numbers as the board
// gives them: card 1 the order email, card 2 the approval of pull request #12, both asked
// already, and card 3 the photo card, not yet asked. Pass: `why 2` run, which notes the Why?
// (the one answer the session may write, labelled Why? on card 2's question, deciding nothing);
// then one sentence with an everyday example, of card 2, and no other text before it; then card 2
// asked again once with AskUserQuestion, as it is, by `again 2`; no approval or other signed
// record; no other card asked, explained or marked asked. Judged from the events and the
// transcript only.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { writtenEvents } from '../../../scripts/eval/front-desk.js';
import { WHY } from '../../../scripts/lib/calm-words.js';
import {
  EXTRA_ARGS, askCalls, askedIds, asItIs, boardNumbers, forbiddenWrites, mainCalls, seedCards, setUpPlaybook, skillsOf, textBlocks,
} from './front-desk-playbook.js';
import { APPROVAL_CARD, CARDS, PHOTO_CARD, README } from './36-pane-press.js';

// What the director types in the chat.
export const PROMPT = 'why? card 2';

// An everyday example, in the playbook's own form ("It's like …") or the set phrases that open
// one; "I'd like" or "compared with the old page" don't count.
export const EXAMPLE = /\b(?:it'?s|it is|that'?s)\s+(?:a bit\s+|rather\s+|just\s+)?like\b|\bfor example\b|\bfor instance\b|\bimagine\b|\bthink of it (?:as|like)\b|\blike an?\b|\bworks like\b|\bas if\b|\bjust as\b|\bsay you\b|\bpicture\b/i;

// What would name the photo card in an explanation; "picture" is left out, since it opens an example.
const PHOTO_WORDS = /\bphotos?\b|\bimages?\b|\bproduct pages?\b/i;

const RAN_WHY = /cli\.js"?\s+why\s+(\d+)\b/;
const RAN_AGAIN = /cli\.js"?\s+again\s+(\d+)\b/;

const oneLine = (text) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
};

// The pass, from the main session's calls and text and what it wrote. `whys` is the questions
// the Why? answers it wrote name.
export function judge({ calls, texts, forbidden, asked, approval, others, whys }) {
  const notes = [];
  const skills = skillsOf(calls);
  if (skills.length > 0) notes.push(`skills: ${skills.join(', ')}`);
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');
  const numbersOf = (pattern) => calls.filter((c) => c.name === 'Bash').map((c) => pattern.exec(String(c.input.command ?? ''))?.[1]).filter(Boolean).map(Number);

  if (forbidden.length > 0) return { pass: false, why: `it wrote what a typed why never earns: ${forbidden.join(', ')}${tail()}` };
  const noted = numbersOf(RAN_WHY);
  if (!noted.includes(2)) return { pass: false, why: `it did not run \`why 2\`${tail()}` };
  if (noted.some((n) => n !== 2)) return { pass: false, why: `it ran \`why\` on another card (${noted.filter((n) => n !== 2).join(', ')})${tail()}` };
  if (whys.length !== 1 || whys[0] !== approval.data.question) return { pass: false, why: `the Why? was not noted once on card 2's question (${whys.length} noted)${tail()}` };
  const againOn = numbersOf(RAN_AGAIN);
  const asks = askCalls(calls);
  if (asked.some((id) => id !== approval.id) || againOn.some((n) => n !== 2)
    || asks.some((a) => a.questions.some((q) => others.some((o) => asItIs(q, o.data))))) {
    return { pass: false, why: `it asked another card${tail()}` };
  }
  if (asks.length === 0 || !againOn.includes(2)) {
    return { pass: false, why: `card 2 was not asked again with \`again 2\`${texts.length > 0 ? `; it said: ${oneLine(texts.map((t) => t.text).join(' '))}` : ''}${tail()}` };
  }
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
  if (PHOTO_WORDS.test(before)) return { pass: false, why: `it explained the photo card, not card 2: ${oneLine(before)}${tail()}` };
  if (!EXAMPLE.test(before)) return { pass: false, why: `card 2 asked again after an explanation with no everyday example: ${oneLine(before)}${tail()}` };
  return { pass: true, why: `the why noted, an explanation of card 2 with an everyday example, then card 2 asked again once, as it is; nothing signed or decided, no other card asked or explained${tail()}` };
}

export default {
  id: 36,
  leg: 'why',
  title: 'A typed why about a card in the chat',

  setup: async (dir, variant) => {
    const made = await seedCards(CARDS);
    const numbers = boardNumbers(made.seed);
    if (numbers[APPROVAL_CARD] !== 2 || numbers[PHOTO_CARD] !== 3) throw new Error('The board does not number the approval 2 and the photo card 3');
    return { ...await setUpPlaybook(dir, variant, { files: { 'README.md': README }, seed: made.seed }), cards: made.cards };
  },

  prompt: PROMPT,
  extraArgs: EXTRA_ARGS,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 30,

  pass: ({ events, context }) => {
    // `why` writes one answer labelled Why?; any other answer is a decision the session never makes.
    const answers = writtenEvents(context).filter((e) => e.kind === 'card-answer');
    const decided = answers.some((e) => e.data?.label !== WHY);
    return judge({
      calls: mainCalls(events),
      texts: textBlocks(events),
      forbidden: forbiddenWrites(context).filter((kind) => decided || kind !== 'card-answer'),
      asked: askedIds(context),
      approval: context.cards.find((c) => c.id === APPROVAL_CARD),
      others: context.cards.filter((c) => c.id !== APPROVAL_CARD),
      whys: answers.filter((e) => e.data?.label === WHY).map((e) => e.data.question),
    });
  },
};
