// scripts/crew/levels.js
// The three levels of crew visibility, in one place. A leaf module: it imports nothing, so the settings catalogue and
// the records' own code can name the levels without a cycle through scripts/crew/level.js.
export const LEVELS = ['off', 'steps', 'transcript'];
