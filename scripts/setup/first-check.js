// scripts/setup/first-check.js
// What the first check on the default branch means (spec 4.5): the project's tests as they stand decide what the director
// hears, and a red start holds nothing up unless the director says so.
export const GET_THEM_PASSING = 'Get them passing first';
export const CARRY_ON = 'Carry on anyway';

// The Logbook's line for a check that ran (spec 4.8), the same on every host.
export const checksRanLine = ({ result, minutes }) => {
  const shown = Math.max(1, Math.round(minutes));
  return `Checks ran on this computer: ${result === 'passed' ? 'passed' : 'failed'}, ${shown} ${shown === 1 ? 'minute' : 'minutes'}.`;
};

export const FIRST_RED_CARD = Object.freeze({
  level: 3,
  what: 'This project\'s tests don\'t pass as they stand, before any new work. Changes can\'t show they are safe while the tests are already failing.',
  why: 'Whether to mend the tests first or carry on without them is a choice about your product, at level 3.',
  options: [
    { label: GET_THEM_PASSING, says: 'A build starts mending the tests, and other work waits until they pass.' },
    { label: CARRY_ON, says: 'Work goes on, and changes rest on review and on each work\'s own done checks. The tests count for good the first time they pass.' },
  ],
  recommendation: GET_THEM_PASSING,
});

// firstCheck({ found, check, state, note, card }) -> 'passed' | 'failed' | 'nothing' | 'could-not-run'. `found` what the finder
// found, null for nothing; `check` the first check's result; `state(data)` keeps a `checks-state`, `note(words)` writes
// to the Logbook and `card(data)` raises the card. A check that couldn't run goes to the runner's own card.
export async function firstCheck({ found, check, state, note, card }) {
  if (found === null) {
    await state({ state: 'not-counting', why: 'nothing-found' });
    return 'nothing';
  }
  if (check.result === 'passed') {
    await state({ state: 'counting', why: 'passed' });
    await note(checksRanLine(check));
    return 'passed';
  }
  if (check.result === 'failed' || check.result === 'timed-out') {
    await card(FIRST_RED_CARD);
    return 'failed';
  }
  return 'could-not-run';
}
