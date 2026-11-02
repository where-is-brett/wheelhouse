// tests/scripts/hooks/policy-click.test.js
// A chat click on Copilot is signed only by the policy hook's managed copy, and only once check 59 (C6) allows it.
// C6_PASSED is a constant, so each test gives it through deps; the default reads the real constant (false).
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { policyClick } from '../../../scripts/agents/copilot/hook-entry.js';
import { C6_PASSED } from '../../../scripts/lib/copilot-numbers.js';
import copilot from '../../../adapters/copilot/index.js';
import { tempFolder } from '../../helpers/homes.js';

const MANAGED = tempFolder('wh-policy-click-managed-');
const OWN = tempFolder('wh-policy-click-own-');
const CLEAN = tempFolder('wh-policy-click-clean-');
const input = { hook_event_name: 'PostToolUse', cwd: '/p', tool_name: 'ask_user', tool_input: { questions: [] }, tool_response: {} };

// A stand-in for the prompt record: remembers how it was called.
function spy() {
  const calls = [];
  return { calls, decide: async (given, deps) => { calls.push({ given, deps }); return undefined; } };
}
const inManaged = path.join(MANAGED, 'wheelhouse', 'scripts', 'agents', 'copilot', 'hook-entry.js');

test('a policy hook signs only when C6_PASSED', async () => {
  const off = spy();
  await policyClick(input, { c6: false, self: inManaged, dir: MANAGED, decide: off.decide });
  assert.equal(off.calls.length, 0);
  const on = spy();
  await policyClick(input, { c6: true, self: inManaged, dir: MANAGED, decide: on.decide });
  assert.equal(on.calls.length, 1);
  assert.equal(on.calls[0].deps.proof, 'policy-hook');
  assert.equal(on.calls[0].deps.writeVia, 'self');
  assert.equal(on.calls[0].given.tool_name, 'AskUserQuestion');
  // The default reads the real constant, which is false.
  assert.equal(C6_PASSED, false);
  const real = spy();
  await policyClick(input, { self: inManaged, dir: MANAGED, decide: real.decide });
  assert.equal(real.calls.length, 0);
});

test('the person\'s own hook copy never signs', async () => {
  const s = spy();
  await policyClick(input, { c6: true, self: path.join(OWN, 'scripts', 'agents', 'copilot', 'hook-entry.js'), dir: MANAGED, decide: s.decide });
  assert.equal(s.calls.length, 0);
});

test('the clean home\'s copy never signs', async () => {
  const s = spy();
  await policyClick(input, { c6: true, self: path.join(CLEAN, 'wheelhouse', 'scripts', 'agents', 'copilot', 'hook-entry.js'), dir: MANAGED, decide: s.decide });
  assert.equal(s.calls.length, 0);
});

test('a project with real users does not take policy-hook: the adapter\'s list names it, the gate\'s real-user list stays as it was', async () => {
  assert.ok(copilot.cards.binding.includes('policy-hook'));
  const { readFileSync } = await import('node:fs');
  const gate = readFileSync(new URL('../../../scripts/gate/conditions.js', import.meta.url), 'utf8');
  assert.match(gate, /const REAL_USER_PROOFS = \['host', 'add-on', 'window'\];/);
});
