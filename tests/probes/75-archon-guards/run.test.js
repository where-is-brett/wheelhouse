// tests/probes/75-archon-guards/run.test.js
// The pure parts of check 75's probe: the attempt list, the filled workflow, and the tally that reads
// an Archon transcript. No Archon or Claude runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATTEMPTS, PLUGIN, callsByStep, fillWorkflow, tallyE2, verdict, workflowOf } from '../../../probes/75-archon-guards/run.js';

const TEMPLATE = fs.readFileSync(fileURLToPath(new URL('../../../probes/75-archon-guards/guards.yaml', import.meta.url)), 'utf8');

// Archon's transcript lines for one tool call in `step`: the call, then its result.
let n = 0;
function call(step, name, input, output, status = 'failed') {
  const id = `toolu_${n += 1}`;
  return [
    JSON.stringify({ type: 'provider_event', step, event: { type: 'tool_call', toolCallId: id, name, rawInput: input } }),
    JSON.stringify({ type: 'provider_event', step, event: { type: 'tool_call_update', toolCallId: id, status, output } }),
  ];
}
const one = (id) => ATTEMPTS.filter((a) => a.id === id);

test('tallyE2 marks an attempt refused by a hook from the PreToolUse error', () => {
  const lines = call('env-cat', 'Bash', { command: 'cat .env' },
    'PreToolUse:Bash hook error: Wheelhouse does not let an agent run the host tools, push, or read a .env file: ask the helper to do it');
  assert.deepEqual(tallyE2(lines, one('env-cat')).attempts, [{ id: 'env-cat', refused: true, how: 'hook', calls: 1 }]);
});

test('tallyE2 marks a deny rule\'s refusal as deny', () => {
  const lines = call('env-read', 'Read', { file_path: '/x/.env' }, '<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>');
  assert.equal(tallyE2(lines, one('env-read')).attempts[0].how, 'deny');
  const gh = call('gh', 'Bash', { command: 'gh --version' }, 'Permission to use Bash with command gh --version has been denied.');
  assert.equal(tallyE2(gh, one('gh')).attempts[0].how, 'deny');
});

test('tallyE2 marks a sandbox refusal from the command\'s output', () => {
  const lines = call('archon-db', 'Bash', { command: 'head -c 15 /h/archon.db' }, 'head: /h/archon.db: Operation not permitted');
  assert.deepEqual(tallyE2(lines, one('archon-db')).attempts, [{ id: 'archon-db', refused: true, how: 'sandbox', calls: 1 }]);
  // A call that completed ran, even when its output names the sandbox.
  const ran = call('unsandboxed', 'Bash', { command: 'curl', dangerouslyDisableSandbox: true }, '{"stdout":"200","dangerouslyDisableSandbox":true}', 'completed');
  assert.equal(tallyE2(ran, one('unsandboxed')).attempts[0].refused, false);
  // A connection that just failed is not a refusal.
  const port = call('port-3090', 'Bash', { command: 'curl http://127.0.0.1:3090/' }, 'Exit code 7\ncurl: (7) Failed to connect to 127.0.0.1 port 3090');
  assert.equal(tallyE2(port, one('port-3090')).attempts[0].refused, false);
});

test('tallyE2 marks an attempt that ran as not refused', () => {
  const lines = call('config-yaml', 'Read', { file_path: '/h/config.yaml' }, '{"type":"text","file":{"content":"# Archon Global Config"}}', 'completed');
  assert.deepEqual(tallyE2(lines, one('config-yaml')).attempts, [{ id: 'config-yaml', refused: false, how: 'none', calls: 1 }]);
  // gh missing from PATH is not a guard's refusal.
  const gh = call('gh', 'Bash', { command: 'gh --version' }, 'Exit code 127\n(eval):1: command not found: gh');
  assert.equal(tallyE2(gh, one('gh')).attempts[0].refused, false);
});

test('tallyE2 counts a step refused only when every call it made was refused', () => {
  const lines = [
    ...call('env-cat', 'Bash', { command: 'cat .env' }, 'PreToolUse:Bash hook error: no'),
    ...call('env-cat', 'Bash', { command: 'head .env' }, 'FAKE_TOKEN=x', 'completed'),
  ];
  assert.deepEqual(tallyE2(lines, one('env-cat')).attempts, [{ id: 'env-cat', refused: false, how: 'none', calls: 2 }]);
});

test('tallyE2 treats a missing transcript as a failure for every attempt', () => {
  for (const input of [undefined, null, [], ['', 'not json']]) {
    const { attempts } = tallyE2(input);
    assert.equal(attempts.length, ATTEMPTS.length);
    assert.ok(attempts.every((a) => a.refused === false && a.how === 'none' && a.calls === 0));
    assert.equal(verdict({ attempts }).pass, false);
  }
  assert.equal(verdict({ attempts: [] }).pass, false);
});

test('the verdict passes only when everything is refused but archon, and the control ran', () => {
  const refusedAll = ATTEMPTS.map((a) => ({ id: a.id, refused: !(a.control || a.expected === 'ran'), how: 'hook', calls: 1 }));
  assert.equal(verdict({ attempts: refusedAll }).pass, true);
  const archonRefused = refusedAll.map((t) => (t.id === 'archon' ? { ...t, refused: true } : t));
  assert.deepEqual(verdict({ attempts: archonRefused }).wrong, ['archon']);
  const oneRan = refusedAll.map((t) => (t.id === 'keychain' ? { ...t, refused: false, how: 'none' } : t));
  assert.deepEqual(verdict({ attempts: oneRan }).wrong, ['keychain']);
});

test('callsByStep pairs each call with its result and ignores other lines', () => {
  const lines = [
    JSON.stringify({ type: 'node_start', step: 'control' }),
    JSON.stringify({ type: 'provider_event', step: 'control', event: { type: 'hook', hookEvent: 'PreToolUse' } }),
    ...call('control', 'Read', { file_path: 'README.md' }, 'hello', 'completed'),
  ];
  assert.deepEqual(callsByStep(lines), { control: [{ name: 'Read', input: { file_path: 'README.md' }, text: 'hello', failed: false }] });
});

test('guards.yaml has one step per attempt, each naming the Wheelhouse plugin, and fills every prompt', () => {
  const ids = [...TEMPLATE.matchAll(/^ {2}- id: ([\w-]+)$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ATTEMPTS.map((a) => a.id));
  assert.equal([...TEMPLATE.matchAll(/^ {4}plugins: \[wheelhouse@wheelhouse\]$/gm)].length, ids.length);
  const filled = fillWorkflow(TEMPLATE);
  assert.doesNotMatch(filled, /\{\{prompt:[\w-]+\}\}/);
  for (const a of ATTEMPTS) assert.ok(filled.includes(JSON.stringify(a.prompt)), a.id);
  assert.throws(() => fillWorkflow('prompt: {{prompt:nothing}}'), /not an attempt/);
});

test('a written workflow names the plugin in every step', () => {
  const text = workflowOf('e2-x', [{ id: 'a', prompt: 'p' }, { id: 'b', prompt: 'q', dependsOn: 'a' }]);
  assert.equal(text.split(`plugins: [${PLUGIN}]`).length - 1, 2);
  assert.match(text, /depends_on: \[a\]/);
});
