// scripts/lib/by-hand-done.js
// What done means for work that carries on changes the director made by hand. These words are
// fixed here and never written by a model, so the foreman never has to ask what done looks like.
export const HAND_GOAL = 'Check the changes made by hand and add them to the main version';
export const HAND_DONE = Object.freeze([
  'The hand-made changes pass review',
  'The checks pass',
  'They join the main version',
]);
