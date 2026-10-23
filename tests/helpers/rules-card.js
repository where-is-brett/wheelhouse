// tests/helpers/rules-card.js
// A card of rules with Confirm all, as the prompt record and the helper's state routes take it
// (scripts/lib/setup-writes.js keeps the confirm-all support). Setup's step 5 asks no such card any
// more; these tests drive the support itself.
import { CONFIRM_ALL_LABEL, CORRECT_SOME_LABEL } from '../../scripts/state/card-lines.js';

const said = (rule) => `"${rule.words}" (${rule.source.file} line ${rule.source.line}, ${rule.original ? 'your words' : 'paraphrase'})`;

// The input of a confirm-all card for `rules`, without its kind's target.
export function rulesInput(name, rules) {
  const n = rules.length;
  const listed = rules.map((r, i) => `${i + 1}) ${said(r)}`).join('; ');
  return {
    kind: 'confirm-all',
    level: 3,
    what: `Setup step 5 found ${n} ${n === 1 ? 'rule' : 'rules'} ${name} already follows: ${listed}.`,
    why: 'They are in force already; confirmed, they become your rulings. Paraphrase: not found in your own messages.',
    options: [
      { label: CONFIRM_ALL_LABEL, says: 'Each goes into the rulebook as shown.' },
      { label: CORRECT_SOME_LABEL, says: 'Keep, reword or leave out each in turn.' },
      { label: 'Not now', says: 'Nothing is recorded yet.' },
    ],
    recommend: CONFIRM_ALL_LABEL,
    because: 'the project already follows them',
    meanwhile: 'Setup waits; nothing is recorded yet.',
  };
}
