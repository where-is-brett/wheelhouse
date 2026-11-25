// scripts/foreman/foreman-card.js
// The "Start the foreman" card (builders and settings design, sections 7.1 and 14): setup's last card on the Desktop route,
// and the card the First Mate asks when the foreman isn't running. It is a plain question card at level 2. A click on
// START_FOREMAN is the director asking, in words, for the foreman session, and only then does the First Mate start it with
// `user_asked`. The card holds no free text: only the project's own words for it.

// The card's topic, by which the card waiting already is found.
export const FOREMAN_TOPIC = 'start-foreman';
export const START_FOREMAN = 'Start the foreman session';
// Not "Not now": the card composer refuses that label on a question card, as a button that puts a card off.
export const LEAVE_IT = 'Leave it off';

export function foremanCardInput() {
  return {
    kind: 'question',
    level: 2,
    what: 'Start the foreman?',
    why: 'On this computer, builders start in Claude Desktop. The foreman is the session that starts them and keeps them going, and it starts only when you say so.',
    options: [
      { label: START_FOREMAN, says: 'A foreman session opens in Claude Desktop and checks in. You can watch it in the sidebar, and builders start from it as work is approved.' },
      { label: LEAVE_IT, says: 'Nothing starts. Approved work waits, and I offer this card again when it is needed.' },
    ],
    recommend: START_FOREMAN,
    because: 'approved work can only start once the foreman is running',
    meanwhile: 'Nothing is built: approved work waits for the foreman.',
    topic: FOREMAN_TOPIC,
    suggest: false,
  };
}
