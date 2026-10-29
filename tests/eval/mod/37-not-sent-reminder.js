// tests/eval/mod/37-not-sent-reminder.js
// Scenario 37's leg `reminder` (final fix wave, Ruling 68): the courier's one reminder for the
// two new cards. Their wake was handed on, but its notification wasn't sent, so the front desk
// asked nothing; the cards still wait unasked, and the next tick past the gap reminds: "cards 3
// and 4 are still waiting". Claude's notification answers "Not sent" again (NOT_SENT), and the
// playbook asks the cards on a reminder whatever the notification answers. Pass: as 37's own
// (passWake): one one-line notification naming no card's words, then one AskUserQuestion call
// holding cards 3 and 4 as they are, and at most one short closing line.
import { NOT_SENT, locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { EXTRA_ARGS, boardNumbers, seedCards, setUpPlaybook } from './front-desk-playbook.js';
import { CARDS, passWake, wakePrompt } from './37-courier-wake.js';

// The reminder, as the bridge would submit it: courierWake's, a gap after the cards' own wake.
export const reminderPrompt = (numbers) => wakePrompt(numbers, { reminder: true });

let prompt = null;

export default {
  id: 37,
  leg: 'reminder',
  title: 'The courier\'s reminder for two cards, the notification not sent',

  setup: async (dir, variant) => {
    const made = await seedCards(CARDS);
    const wake = await reminderPrompt(boardNumbers(made.seed));
    prompt = wake.line;
    return { ...await setUpPlaybook(dir, variant, { seed: made.seed, push: NOT_SENT, wake }), cards: made.cards };
  },

  // The reminder is made in setup, by the courier's own code, before the session starts.
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

  pass: passWake,
};
