// tests/eval/mod/37-not-sent-card-wake.js
// Scenario 37's leg `unsent` (final fix wave, Ruling 68): the courier's wake for the two new
// cards, as in 37, but Claude's notification answers as it does while the director has just been
// active: "Not sent — this terminal is active, …" (NOT_SENT). The playbook then asks nothing:
// the pane shows the cards, and the courier's reminder asks them later. Pass: one call to
// PushNotification, its message one line naming no card's words; no `cards` or `again` run, no
// AskUserQuestion call and no `asked` record; no text before the notification, and after it at
// most one closing line, as 37 allows; nothing written that a wake doesn't earn. Judged from the
// events and the transcript only.
import { NOT_SENT, locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import {
  EXTRA_ARGS, askCalls, askedIds, boardNumbers, forbiddenWrites, mainCalls, seedCards, setUpPlaybook, skillsOf, textBlocks,
} from './front-desk-playbook.js';
import { CARDS, notificationProblems, saidProblems, wakePrompt } from './37-courier-wake.js';

// A run of the front desk's command that puts a card before the director.
const ASKING = /cli\.js"?\s+(cards|again)\b/;

// The pass, from the main session's calls and text and what it wrote.
export function judge({ calls, texts, forbidden, asked }) {
  const notes = [];
  const skills = skillsOf(calls);
  if (skills.length > 0) notes.push(`skills: ${skills.join(', ')}`);
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');
  const problems = [];

  if (forbidden.length > 0) problems.push(`it wrote what a wake never earns: ${forbidden.join(', ')}`);
  const ran = [...new Set(calls.filter((c) => c.name === 'Bash').map((c) => ASKING.exec(String(c.input.command ?? ''))?.[1]).filter(Boolean))];
  for (const command of ran) problems.push(`it ran \`${command}\` after "Not sent"`);
  if (askCalls(calls).length > 0) problems.push('it asked the cards after "Not sent"');
  if (asked.length > 0) problems.push('it marked a card asked');

  const pushes = calls.filter((call) => call.name === 'PushNotification');
  problems.push(...notificationProblems(pushes, notes));
  const end = pushes.length > 0 ? pushes[0].order : Number.POSITIVE_INFINITY;
  problems.push(...saidProblems(texts, end, notes).map((p) => p.replace('before the calls ended', 'before the notification')));

  if (problems.length > 0) return { pass: false, why: `${problems.join('; ')}${tail()}` };
  const closed = notes.some((note) => note.startsWith('closing line:'));
  return { pass: true, why: `one one-line notification naming no card's words, no card asked, and ${closed ? 'one short closing line' : 'nothing else said'}${tail()}` };
}

let prompt = null;

export default {
  id: 37,
  leg: 'unsent',
  title: 'A courier\'s wake for two new cards, the notification not sent',

  setup: async (dir, variant) => {
    const made = await seedCards(CARDS);
    const numbers = boardNumbers(made.seed);
    prompt = await wakePrompt(numbers);
    return { ...await setUpPlaybook(dir, variant, { seed: made.seed, push: NOT_SENT }), cards: made.cards };
  },

  // The wake is made in setup, by the courier's own code, before the session starts.
  get prompt() {
    if (prompt === null) throw new Error('Scenario 37\'s prompt is made by its setup');
    return prompt;
  },
  extraArgs: EXTRA_ARGS,
  offered: ['PushNotification'],

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
  }),
};
