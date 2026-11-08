// tests/helpers/made-feature.js
// Makes a worktree look as Wheelhouse leaves a feature's: a `.wheelhouse/feature` folder holding a
// brief whose `work` is the feature's slug.
import fs from 'node:fs';
import path from 'node:path';

export function makeFeatureFolder(tree, work) {
  const dir = path.join(tree, '.wheelhouse', 'feature');
  fs.mkdirSync(dir, { recursive: true });
  const fields = {
    v: 1, work, lane: 'small', version: 1, goal: 'The goal.', done: ['It works.'], appetite: { sessions: 1, tokens: 100000 },
    rulings: [], routing: {}, shownFirst: false,
  };
  fs.writeFileSync(path.join(dir, 'brief.md'), `\`\`\`json\n${JSON.stringify(fields, null, 2)}\n\`\`\`\n\n# The goal\n\nThe goal.\n`);
  return tree;
}
