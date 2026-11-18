// tests/scripts/agents/setup-parts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentAsk } from '../../../scripts/agents/setup-parts.js';

test('the builder question says what the choice covers, and on a Mac whose commands are kept from private files', () => {
  const { card } = agentAsk({ found: [{ name: 'copilot', label: 'Copilot' }], project: 'Shop', platform: 'darwin' });
  assert.match(card.why, /chosen for each computer, and it can be changed later from the First Mate/);
  assert.match(card.why, /The chat and cards are the same either way\. On a Mac, Claude Code keeps its commands from your private files; Copilot's commands run without that\./);
  assert.doesNotMatch(card.why, /checks apply either way/);
  const copilot = card.options.find((o) => o.label === 'Copilot');
  assert.equal(copilot.says, 'GitHub\'s Copilot does the building on this computer, using your Copilot plan\'s monthly allowance. Setup adds its checks and reads your plan from your GitHub account.');
});

test('the builder question says nothing of a sandbox on Windows, which has none', () => {
  const { card } = agentAsk({ found: [{ name: 'copilot', label: 'Copilot' }], project: 'Shop', platform: 'win32' });
  assert.equal(card.why, 'It is chosen for each computer, and it can be changed later from the First Mate. The chat and cards are the same either way.');
});
