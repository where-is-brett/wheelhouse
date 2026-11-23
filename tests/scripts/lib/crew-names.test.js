// tests/scripts/lib/crew-names.test.js
// The names a feature session dispatches its Crew by (scripts/lib/crew-names.js): Claude Code's with a colon, a launcher
// session's with a hyphen, as its agent files carry them; and whether a configuration runs by launcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crewAgent, runsByLauncher, withLauncherCrewNames } from '../../../scripts/lib/crew-names.js';
import { computerId } from '../../../scripts/lib/paths.js';

test('a Crew member is named with a colon for Claude Code and with a hyphen for a launcher session', () => {
  for (const role of ['builder', 'reviewer', 'tester']) {
    assert.equal(crewAgent(role), `wheelhouse:${role}`);
    assert.equal(crewAgent(role, false), `wheelhouse:${role}`);
    assert.equal(crewAgent(role, true), `wheelhouse-${role}`);
  }
});

test('only the Crew\'s names change in a text, never a skill\'s', () => {
  const text = 'Dispatch `wheelhouse:reviewer`, then `wheelhouse:builder` and `wheelhouse:tester`; start `superpowers:requesting-code-review` and `wheelhouse:intake`.';
  assert.equal(withLauncherCrewNames(text), 'Dispatch `wheelhouse-reviewer`, then `wheelhouse-builder` and `wheelhouse-tester`; start `superpowers:requesting-code-review` and `wheelhouse:intake`.');
});

test('a configuration runs by launcher when this computer\'s agent is one that matches a command by its stem', () => {
  assert.equal(runsByLauncher({ agents: { [computerId()]: 'copilot' } }), true);
  assert.equal(runsByLauncher({ agents: { [computerId()]: 'claude-code' } }), false);
  assert.equal(runsByLauncher({ agents: { 'another-computer': 'copilot' } }), false);
  assert.equal(runsByLauncher({}), false);
  assert.equal(runsByLauncher(null), false);
  assert.equal(runsByLauncher(undefined), false);
});
