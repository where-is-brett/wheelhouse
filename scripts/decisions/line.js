// scripts/decisions/line.js
// The decision line (design section 5 of the director's way of working): which side of it a call falls on. Anything that
// shapes what the product does, costs money or is hard to undo is the director's; how it is built is the agents'. When
// unsure, it is the director's, so a kind this file doesn't know is the director's.

export const DIRECTOR_KINDS = Object.freeze([
  'behaviour', 'algorithm', 'cost', 'data-model', 'security', 'public-interface', 'major-dependency', 'deletion', 'rewrite',
]);

export const AGENT_KINDS = Object.freeze([
  'structure', 'bug-fix', 'tests', 'performance', 'minor-dependency', 'library-in-stack', 'tooling',
]);

// 'director' or 'agent'. Only a kind named in AGENT_KINDS is the agents'.
export const sideOf = (kind) => (AGENT_KINDS.includes(kind) ? 'agent' : 'director');

// The lowest decision level a director-side call comes at: levels 3 and 4 are the director's card.
export const DIRECTOR_LEVEL = 3;
