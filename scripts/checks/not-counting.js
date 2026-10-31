// scripts/checks/not-counting.js
// A project whose tests already fail, or which has none, has nothing a check can show (spec 4.5, ruling 2). That is one state
// in the private record, set only by the finder finding nothing or the director's click, and it ends for good the first
// time the command passes on the main line. `states` are the data of the signed `checks-state` events, oldest first.

export const notCounting = (states) => states.at(-1)?.state === 'not-counting';

// Whether a check ends the state: a pass on the main line, and only from a clean run.
export const countingEnds = (holding, check) => holding === true && check?.clean === true && check?.result === 'passed';

// Once a project has counted it always does.
export const mayStopCounting = (states) => !states.some((s) => s.state === 'counting');

// What the finder found and the record keeps, until the default branch names a command: the data of the newest signed
// `checks-found` event, or null.
export const keptCommand = (found) => found.at(-1) ?? null;

// The Logbook's line for a check that ran (spec 4.8), the same on every host.
const RESULT_WORDS = { passed: 'passed', failed: 'failed', 'timed-out': 'ran out of time', 'not-counted': 'tests not counted yet' };
export const checksRanLine = ({ result, minutes }) => {
  const words = RESULT_WORDS[result];
  if (!words) return 'Checks ran on this computer: couldn\'t run.';
  const shown = Math.max(1, Math.round(minutes));
  return `Checks ran on this computer: ${words}, ${shown} ${shown === 1 ? 'minute' : 'minutes'}.`;
};

// The standing offer while tests aren't counting (spec 4.5).
export const NOT_COUNTING_LINE = 'Tests aren\'t counting yet: ask the First Mate to add tests or repair them';
