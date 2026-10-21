// tests/eval/mod/36-pane-show-me.js
// Scenario 36's leg `show` (final fix wave): a press of Show me in the pane, with the numbers
// moved, as in 36. The three cards wait as there; the director pressed Show me on card 2, the
// approval of pull request #12, and then chose an option on card 1, which closed it, so the
// pressed card is now card 1 and card 2 is the photo card. Pull request #12 is open on the
// stand-in host, which gives its preview's address (PREVIEW). Pass: `preview 12` run, and no
// preview of another pull request; that address given to the director, as the only text before
// the card; then the pressed card asked again once with AskUserQuestion, alone, as it is; no
// card's id and nothing of the photo card said; no other card asked or marked asked (`again 2`
// would mark the photo card asked, which the director never saw); nothing signed or answered.
// Judged from the events and the transcript only.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import {
  EXTRA_ARGS, askCalls, askedIds, asItIs, boardNumbers, forbiddenWrites, mainCalls, seedCards, setUpPlaybook, skillsOf, textBlocks, HEAD,
} from './front-desk-playbook.js';
import { APPROVAL_CARD, CARDS, PHOTO_CARD, PHOTO_WORDS, README, pressPrompt, stateAfterThePress } from './36-pane-explain.js';

export const PROMPT = pressPrompt('Show me', 2, APPROVAL_CARD);

// The address the stand-in host gives for pull request #12's preview.
export const PREVIEW = 'https://preview.host.invalid/pull/12';

const IDS = CARDS.map((c) => c.id);
const PREVIEWED = /cli\.js"?\s+preview\s+(\d+)\b/;

const oneLine = (text) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
};

// The pass, from the main session's calls and text and what it wrote.
export function judge({ calls, texts, forbidden, asked, approval, others }) {
  const notes = [];
  const skills = skillsOf(calls);
  if (skills.length > 0) notes.push(`skills: ${skills.join(', ')}`);
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');
  const problems = [];

  if (forbidden.length > 0) problems.push(`it wrote what a press never earns: ${forbidden.join(', ')}`);
  const previewed = [...new Set(calls.filter((c) => c.name === 'Bash').map((c) => PREVIEWED.exec(String(c.input.command ?? ''))?.[1]).filter(Boolean).map(Number))];
  if (!previewed.includes(12)) problems.push('no preview of pull request 12');
  const elsewhere = previewed.filter((n) => n !== 12);
  if (elsewhere.length > 0) problems.push(`it ran a preview of another pull request (${elsewhere.join(', ')})`);

  const asks = askCalls(calls);
  // `again <n>` marks the card it gives asked, so an `asked` record for any other card means it
  // ran `again` on a card the director never saw (ruling 71).
  if (asked.some((id) => id !== approval.id) || asks.some((a) => a.questions.some((q) => others.some((o) => asItIs(q, o.data))))) problems.push('it asked another card');
  if (asks.length === 0) problems.push(`card 2 was not asked again${texts.length > 0 ? `; it said: ${oneLine(texts.map((t) => t.text).join(' '))}` : ''}`);
  if (asks.length > 1) problems.push(`AskUserQuestion was called ${asks.length} times`);
  if (asks.length === 1 && (asks[0].questions.length !== 1 || !asItIs(asks[0].questions[0], approval.data))) {
    problems.push(`the one AskUserQuestion call did not hold the pressed card alone, as it was composed (${asks[0].questions.length} question(s))`);
  }

  const all = texts.map((t) => t.text).join('\n');
  if (IDS.some((id) => all.includes(id))) problems.push(`it showed a card's id: ${oneLine(all)}`);
  if (asks.length > 0) {
    const said = texts.filter((t) => t.order < asks[0].order && t.text.replace(/\p{Cf}/gu, '').trim() !== '');
    const before = said.map((t) => t.text).join('\n');
    if (said.length > 1) problems.push(`it wrote more than the preview before the card: ${oneLine(said.map((t) => t.text).join(' / '))}`);
    if (!before.includes(PREVIEW)) problems.push(`it did not give the preview's address before the card${before ? `: ${oneLine(before)}` : ''}`);
    if (PHOTO_WORDS.test(before)) problems.push(`it showed the card now numbered 2, not the pressed one: ${oneLine(before)}`);
  }

  if (problems.length > 0) return { pass: false, why: `${problems.join('; ')}${tail()}` };
  return { pass: true, why: `the pressed card's preview alone, then that card asked again once, as it is; no id, nothing signed or answered, no other card asked${tail()}` };
}

export default {
  id: 36,
  leg: 'show',
  title: 'A press of Show me in the pane',

  setup: async (dir, variant) => {
    const made = await seedCards(CARDS);
    const seed = stateAfterThePress(made, 'Show me');
    const now = boardNumbers(seed);
    if (now[APPROVAL_CARD] !== 1 || now[PHOTO_CARD] !== 2) throw new Error('The choice on card 1 did not move the approval to 1 and the photo card to 2');
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
    forbidden: forbiddenWrites(context),
    asked: askedIds(context),
    approval: context.cards.find((c) => c.id === APPROVAL_CARD),
    others: context.cards.filter((c) => c.id !== APPROVAL_CARD),
  }),
};
