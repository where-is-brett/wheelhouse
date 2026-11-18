// tests/scripts/agents/setup-parts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentAsk } from '../../../scripts/agents/setup-parts.js';

test('the builder question says what the choice covers and where Claude Code\'s sandbox stops', () => {
  const { card } = agentAsk({ found: [{ name: 'copilot', label: 'Copilot' }], project: 'Shop' });
  assert.match(card.why, /chosen for each computer, and it can be changed later from the First Mate/);
  assert.match(card.why, /The chat and cards are the same either way; Claude Code's sandbox covers only Claude Code\./);
  assert.doesNotMatch(card.why, /checks apply either way/);
  const copilot = card.options.find((o) => o.label === 'Copilot');
  assert.equal(copilot.says, 'GitHub\'s Copilot does the building on this computer, using your Copilot plan\'s monthly requests. Setup adds its checks.');
});
