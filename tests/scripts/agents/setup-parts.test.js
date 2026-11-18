// tests/scripts/agents/setup-parts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentAsk } from '../../../scripts/agents/setup-parts.js';
import { COPILOT_SANDBOX_CHECKED } from '../../../scripts/agents/copilot/numbers.js';

test('the builder question says what the choice covers, and on a Mac or Linux what Claude Code\'s sandbox keeps its commands from', () => {
  const { card } = agentAsk({ found: [{ name: 'copilot', label: 'Copilot' }], project: 'Shop', platform: 'darwin' });
  assert.match(card.why, /chosen for each computer, and it can be changed later from the First Mate/);
  assert.match(card.why, /The chat and cards are the same either way\. In projects Wheelhouse has set up, Claude Code's sandbox keeps its commands from the key behind your clicks; Copilot's commands run without that\./);
  assert.doesNotMatch(card.why, /checks apply either way/);
  const copilot = card.options.find((o) => o.label === 'Copilot');
  assert.equal(copilot.says, 'GitHub\'s Copilot does the building on this computer, using your Copilot plan\'s monthly allowance. Setup adds its checks and reads your plan from your GitHub account.');
});

test('the builder question says nothing of a sandbox on Windows, which has none', () => {
  const { card } = agentAsk({ found: [{ name: 'copilot', label: 'Copilot' }], project: 'Shop', platform: 'win32' });
  assert.equal(card.why, 'It is chosen for each computer, and it can be changed later from the First Mate. The chat and cards are the same either way.');
});

test('the builder question says the same of the sandbox on Linux, as on a Mac', () => {
  const found = [{ name: 'copilot', label: 'Copilot' }];
  assert.equal(agentAsk({ found, platform: 'linux' }).card.why, agentAsk({ found, platform: 'darwin' }).card.why);
});

test('the words saying Copilot\'s commands run outside the sandbox and could read the key hold only while its sandbox is unchecked', () => {
  assert.equal(COPILOT_SANDBOX_CHECKED, false, 'COPILOT_SANDBOX_CHECKED is true: revisit step 6\'s signing line (scripts/setup/computer.js) and the builder question (scripts/agents/setup-parts.js agentAsk), which say another agent\'s commands run without Claude Code\'s sandbox and could read the signing key');
});

test('the builder question says another agent\'s commands run without the sandbox only while Copilot\'s sandbox is unchecked', () => {
  const { card } = agentAsk({ found: [{ name: 'copilot', label: 'Copilot' }], project: 'Shop', platform: 'darwin' });
  assert.equal(/run without that/.test(card.why), COPILOT_SANDBOX_CHECKED === false, 'the no-sandbox wording and COPILOT_SANDBOX_CHECKED disagree: revisit agentAsk in scripts/agents/setup-parts.js');
  assert.match(card.why, /In projects Wheelhouse has set up, Claude Code's sandbox keeps its commands from the key behind your clicks/);
  assert.doesNotMatch(card.why, /saved sign-ins/);
});
