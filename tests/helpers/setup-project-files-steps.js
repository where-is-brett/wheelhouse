// tests/helpers/setup-project-files-steps.js
// Setup's step 7 alone, for the engine's routes in one test process: the test puts the step it
// built on globalThis.wheelhouseProjectFilesStep before the routes load this module.
const step = () => globalThis.wheelhouseProjectFilesStep;

export const STEPS = [{
  n: 7,
  title: 'The project\'s files, the pins and protection',
  plan: (ctx) => step().plan(ctx),
  apply: (ctx, changes) => step().apply(ctx, changes),
}];
