// scripts/update/cards.js
// The update's cards (update design, sections 4 and 7.3). The first, the Update card, is asked once by the command and signs
// nothing: its click only starts the update, and is never the approval of the reviewed change. The other two are real
// cards the state keeps and the prompt record or the helper's window can sign: the approval of a release that is not
// pins-only, and the old helper's card. Their words are composed once, here, so a card asked again reads the same.
import { composeCard } from '../cards/compose.js';
import { NOT_NOW } from '../lib/calm-words.js';
import { RELEASE_LABEL } from '../state/card-lines.js';
import { LEAVE_IT, STOP_IT, WAIT_LONGER, helperCard } from './finish.js';

export const UPDATE = 'Update';
export { NOT_NOW };
export const NO_SUMMARY = 'No summary was given for this release.';

const HEADER = 'Update';

const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const flat = (text) => String(text).replace(/\s+/g, ' ').trim();

// The Update card, as AskUserQuestion takes it: a composed card whose set line names the move, whether it is an update or a
// put-back, and the plan's hash, so the director's click is signed by the prompt record as the click for that plan and no
// other (update design, section 4). `approval` is 'card' when the release is not pins-only (the director approves the reviewed
// change when it is ready) and 'review' when Wheelhouse's review is enough. `put` is 'undo' for a put-back; `carryOn` for an
// update part-way. `locked` says this computer has Locked, which shows a password window; `others` are the other projects
// whose Locked stays on an older release. `hash` is the full hash of the plan the card is for.
export function updateCard({ from, to, says, approval = 'review', locked = false, others = [], put = 'release', carryOn = false, hash }) {
  const back = put === 'undo';
  const title = carryOn ? `Carry on with the update to ${to}` : back ? `Put Wheelhouse back to ${to} \u00b7 ${from} \u2192 ${to}` : `Update Wheelhouse \u00b7 ${from} \u2192 ${to}`;
  const happens = [
    `your project gets a small reviewed change naming ${to}, then this computer installs it and hands over to the new helper.`,
    'About five minutes. Work in progress finishes first.',
  ];
  if (approval === 'card') {
    happens.push(`${to} changes more than its pins, so once the change is ready you approve it, as you approve any change to the safety rules (a card here in Claude Code, the helper's window with another agent). Update starts it; it is not that approval.`);
  }
  if (locked) happens.push('Locked on this computer is brought up to date too, which shows a password window.');
  if (others.length > 0) happens.push(`Locked is one copy for the whole computer, so ${list(others)} will have the newer Locked and may need updating as well.`);
  const compose = (summary) => composeCard({
    kind: 'update',
    level: 4,
    ask: title,
    what: title,
    why: `What's new: ${summary}`,
    meanwhile: `Meanwhile: nothing stops; sessions open now keep ${from} until you start a new one.`,
    checks: `What happens: ${happens.join(' ')}`,
    recommend: UPDATE,
    because: 'nothing changes before you click',
    options: [
      { label: UPDATE, says: carryOn ? 'It carries on from where it stopped.' : back ? 'It puts this project and this computer back.' : 'It starts the update.' },
      { label: NOT_NOW, says: 'Leave it. Nothing changes, and this release is not announced again.' },
    ],
    target: { from, to, put, hash },
  }).question;
  const summary = flat(says ?? '') === '' ? NO_SUMMARY : flat(says).slice(0, 300);
  // A summary that cannot sit on a card (it holds a line the prompt record reads as a set line, or runs the card too long) is left out.
  try { return compose(summary); } catch { return compose(NO_SUMMARY); }
}

// The card that asks whether to stop an old helper that can't be asked, as AskUserQuestion takes it (section 7.3).
export function stopCard({ version = null } = {}) {
  const given = helperCard({ kind: 'unknown', version, canStop: true });
  return {
    question: given.question,
    header: 'Old helper',
    recommend: STOP_IT,
    options: [
      { label: STOP_IT, description: 'Recommended: stops the old helper, and the new one picks its work up again.' },
      { label: LEAVE_IT, description: 'Leaves it running; the new helper takes over when the computer restarts or you sign out and in.' },
    ],
    multiSelect: false,
  };
}

// The approval card for a release that is not pins-only, composed: { question, card }. Its set line names the move and the
// commit in full, so the click that signs it stands for that move and no other.
export function releaseCard({ previous, release, commit }) {
  return composeCard({
    kind: 'release',
    level: 4,
    what: `Move this project from Wheelhouse ${previous} to ${release}.`,
    why: `${release} changes more than its pins, which can bring new checks to the project's safety settings, so it needs your approval.`,
    checks: 'The change is reviewed first, and it is only added once you approve it here.',
    recommend: RELEASE_LABEL,
    because: 'the change is reviewed before it is added',
    meanwhile: 'Meanwhile nothing is installed, and your work carries on as it is.',
    options: [
      { label: RELEASE_LABEL, says: `The change naming ${release} may be added, and the update installs it.` },
      { label: NOT_NOW },
    ],
    target: { previous, release, commit },
  });
}

const HELPER_SAYS = Object.freeze({
  [STOP_IT]: 'The old helper is stopped, and the new one picks up the work it was doing.',
  [LEAVE_IT]: 'It keeps running; the new helper takes over when the computer restarts or you sign out and in.',
  [WAIT_LONGER]: 'Give it two more minutes to finish what it is doing.',
});

// The old helper's card (scripts/update/finish.js's helperCard) composed as a real card: { question, card }. Every option decides;
// a click is signed as the director's answer to this card by the prompt record or the helper's window.
export function helperCardFor(given) {
  const [what, why, meanwhile] = String(given.question).split('\n');
  return composeCard({
    kind: 'update-helper',
    level: 2,
    what,
    why,
    meanwhile,
    recommend: given.recommended,
    because: given.kind === 'busy' ? 'it lets the old helper finish what it is doing' : 'the new helper picks its work up again',
    options: given.options.map((label) => ({ label, says: HELPER_SAYS[label] })),
    target: { card: given.id },
  });
}
