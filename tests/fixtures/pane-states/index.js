// tests/fixtures/pane-states/index.js
// The pane's states, one pane model each (the model scripts/desk/mod-pane.js gives, saved), in the pane design's order. The mod's
// tests and the VS Code add-on's tests both draw every one, so the two drawers keep to the same states. Besides the model, each
// file holds `view` (main, board or settings), `open` (why, suggest or null) and, for a card being recorded, `recording`: the
// card's id. The two settings states hold `settings`, the groups settingsGroups gives.
import fs from 'node:fs';

export const STATES = Object.freeze([
  'first-reading',
  'calm',
  'card-of-parts',
  'why-open',
  'feature-question',
  'suggest-open',
  'steered',
  'revised',
  'recording',
  'answered-elsewhere',
  'several-cards',
  'all-stop',
  'to-watch',
  'out-of-date',
  'settings',
  'settings-changed',
]);

// The fixture called `name`, fresh each time.
export const loadState = (name) => JSON.parse(fs.readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
