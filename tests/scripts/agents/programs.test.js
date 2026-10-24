// tests/scripts/agents/programs.test.js
// The agents' own programs, which the tool guard refuses to start from an agent's shell (ruling P8-9): built from each
// adapter's own list, Copilot's `copilot` and its package, Claude Code's none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import copilotPrograms from '../../../adapters/copilot/programs.js';
import { AGENTS } from '../../../scripts/agents/project-agent.js';
import { NESTED_PACKAGES, NESTED_REFUSED, PROGRAMS } from '../../../scripts/agents/programs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test("each agent has an entry, held to its adapter's own list; Claude Code has none", () => {
  assert.deepEqual(Object.keys(PROGRAMS).sort(), [...AGENTS].sort());
  assert.equal(PROGRAMS.copilot, copilotPrograms);
  assert.equal(PROGRAMS['claude-code'], null);
});

test('the refused names are built from the lists: Copilot\'s program and package, and nothing of Claude Code\'s', () => {
  assert.deepEqual([...NESTED_REFUSED], ['copilot']);
  assert.deepEqual([...NESTED_PACKAGES], ['@github/copilot']);
  assert.ok(Object.isFrozen(NESTED_REFUSED) && Object.isFrozen(NESTED_PACKAGES));
  assert.ok(!NESTED_REFUSED.includes('claude'));
});

test('the tool guard reads the names through scripts/agents/ and names no agent itself', () => {
  const guard = fs.readFileSync(path.join(REPO, 'scripts', 'hooks', 'tool-guard.js'), 'utf8');
  assert.match(guard, /from '\.\.\/agents\/programs\.js'/);
  assert.doesNotMatch(guard, /copilot/i);
});
