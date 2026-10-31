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
