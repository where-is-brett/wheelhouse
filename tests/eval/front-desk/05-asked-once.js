// tests/eval/front-desk/05-asked-once.js
// Scenario 5 (design section 18): the same open question across five turns.
// Pass: it is put to the director in exactly one turn of the five. A turn puts
// it when it puts the card to the director as a decision to make now (ruling
// F104): an AskUserQuestion holding the card the front desk recorded for it
// (howAsked in scripts/eval/front-desk.js), or a paragraph of the reply laying
// its options out for a pick, in any spelling of the dates: an "Options:" line
// naming both, list items each naming one, or a question asking which (asksIt).
// That is how `claude -p`, which offers no AskUserQuestion, puts the card in its
// reply. A turn that names the waiting card, its question and its choice, and
// offers to ask it again or put it back up, doesn't (a status answer), nor one that only says it
// waits.
// Run it with `npm run eval -- 5 --variant with` and `--variant without`.
//
// One session over five of the director's turns (the harness resumes it),
// two of which invite the question again: "Anything waiting on me?", and one
// about the pre-orders themselves (ruling F93). The state holds a question from the Christmas
// pre-orders' build: close on 18 or 20 December? With Wheelhouse, the board
// context hook's "cards to ask" line comes with each prompt while a card for it
// waits to be handed out, and the session start reloads what waits on each
// resume. The project also has the question written down in
// docs/open-questions.md, which is all a session without Wheelhouse has of it.
// Judged from each turn's events and the cards recorded.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { cardsRecorded, howAsked, paragraphs, replyText, seedEvent, setUpFrontDesk, writtenEvents } from '../../../scripts/eval/front-desk.js';
import { answerLine } from '../../../scripts/state/card-lines.js';
import { SHOP_FILES, clock, featureEvent, workEvent } from './shop.js';

export const QUESTION = 'q-christmas-pre-orders-1';
export const WHAT = 'Should Christmas pre-orders close on 18 December or 20 December?';

export const PROMPTS = [
  'Morning! How are things going?',
  'What does the staff page show at the moment?',
  'Anything waiting on me?',
  'How are the Christmas pre-orders coming along?',
  'Thanks, that\'s everything for today.',
];

export const OPEN_QUESTIONS = `# Open questions

From the Christmas pre-orders build, 20 October 2026:

- ${WHAT} 18 December gives two clear days to bake every order; 20 December takes more orders with one baking day less. Recommended: 18 December.
`;

// The question's two options, in any spelling of the dates ("18 December", "18 Dec", "the 18th").
const EIGHTEEN = /\b18(?:th)?\b/;
const TWENTY = /\b20(?:th)?\b/;
const bothDates = (text) => EIGHTEEN.test(text) && TWENTY.test(text) && /\bDec(?:ember)?\b/i.test(text);
// Words that ask the director to pick.
const PICK = /\b(?:which|would you like|do you want|pick|choose|prefer)\b/i;
// An offer to put the card again ("ask it again", "put it back up"), which makes a line naming it a
// status answer (ruling F104).
const OFFER = /\b(?:ask|asked|show|shown|put)\b[^.?!\n]{0,40}\b(?:again|back)\b/i;
// A sentence's end, past closing marks of bold, quotes and brackets.
const endsAsking = (sentence) => sentence.replace(/[*_"'\u201d)\s]+$/, '').endsWith('?');

// Whether a reply lays the question's options out for a pick (ruling F104): in one paragraph, an
// "Options:" line naming both, or list items each naming one, or a question between them that asks
// which, or that the reply doesn't make a status line by offering to put the card again. A card
// quoted (each line after "> ") is read as it stands.
export const asksIt = (reply) => {
  const text = String(reply).split('\n').map((line) => line.replace(/^\s*>\s?/, '')).join('\n');
  const offered = OFFER.test(text);
  return paragraphs(text).some((p) => {
    if (!bothDates(p)) return false;
    if (/(?:^|\n)\s*(?:\*\*)?(?:your\s+)?options?(?:\*\*)?\s*:/i.test(p)) return true;
    const items = p.split('\n').filter((line) => /^\s*(?:[-*\u2022]|\d+[.)])\s+/.test(line));
    if (items.some((l) => EIGHTEEN.test(l) && !TWENTY.test(l)) && items.some((l) => TWENTY.test(l) && !EIGHTEEN.test(l))) return true;
    return p.split(/(?<=[.!?])\s+|\n+/).some((one) => endsAsking(one) && bothDates(one) && (PICK.test(one) || !offered));
  });
};

// The pass, from each turn's events and the cards recorded.
export function judge({ turns, written }) {
  if (!Array.isArray(turns) || turns.length < PROMPTS.length) return { pass: false, why: `did not count: ${turns?.length ?? 0} of ${PROMPTS.length} turns ran` };
  const card = cardsRecorded(written).find((c) => c.line === answerLine(QUESTION));
  const asked = turns.map((turn, i) => {
    // Only AskUserQuestion counts of howAsked: its other forms, the card's first part in the reply,
    // are what a status answer names too (ruling F104).
    const how = card === undefined ? null : howAsked(turn.events, card);
    if (how === 'AskUserQuestion') return `turn ${i + 1} (AskUserQuestion)`;
    return asksIt(replyText(turn.events)) ? `turn ${i + 1} (its options laid out for a pick)` : null;
  }).filter(Boolean);
  const carded = card === undefined ? 'no card recorded for it' : 'its card recorded';
  if (asked.length === 1) return { pass: true, why: `asked once, in ${asked[0]}; ${carded}` };
  if (asked.length === 0) return { pass: false, why: `never asked in five turns; ${carded}` };
  return { pass: false, why: `asked in ${asked.length} turns: ${asked.join(', ')}; ${carded}` };
}

export default {
  id: 5,
  title: 'The same open question across five turns',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, {
      files: { ...SHOP_FILES, 'docs/open-questions.md': OPEN_QUESTIONS },
      seed: [
        workEvent('christmas-pre-orders', 'Customers can pre-order the Christmas range', 'feature', ago(2000)),
        featureEvent('christmas-pre-orders', 'building', ago(100), { branch: 'feature/christmas-pre-orders', slice: { n: 1, m: 3 } }),
        seedEvent('question', {
          id: QUESTION,
          work: 'christmas-pre-orders',
          what: WHAT,
          why: 'It sets the last day customers can order, which they will see.',
          options: [{ label: '18 December', says: 'Two clear days to bake every order.' }, { label: '20 December', says: 'More orders, with one baking day less.' }],
          recommendation: '18 December',
          level: 3,
        }, ago(45)),
      ],
      lastPrompt: ago(20),
    });
  },

  prompts: PROMPTS,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ turns, context }) => judge({ turns, written: writtenEvents(context) }),
};
