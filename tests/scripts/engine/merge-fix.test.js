// tests/scripts/engine/merge-fix.test.js
// The fix-main lane's merge step: asks the helper to add the run's fix through its own gate, carrying the run's
// ticket; a refusal is printed and fails the step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../../scripts/engine/merge-fix.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { tempFolder } from '../../helpers/homes.js';

const TICKET = 'e'.repeat(64);
function artefacts() {
  const dir = tempFolder('wh-merge-fix-');
  fs.writeFileSync(path.join(dir, TICKET_FILE), `${TICKET}\n`);
  return dir;
}

test('merge-fix asks the helper to add the run\'s fix, with the run\'s ticket', async () => {
  const calls = [];
  const client = { engine: { mergeFix: async (body) => { calls.push(body); return { ok: true, pr: 12, head: 'a'.repeat(40) }; } } };
  const lines = [];
  assert.equal(await main(['--run', 'r1', '--artefacts', artefacts()], { client, out: (l) => lines.push(l) }), 0);
  assert.deepEqual(calls, [{ runId: 'r1', ticket: TICKET }]);
  assert.match(lines.join('\n'), /#12/);
});

test('merge-fix prints the refusal and exits 1', async () => {
  const client = { engine: { mergeFix: async () => ({ ok: false, refused: 'the fix deletes the test tests/a.test.js' }) } };
  const lines = [];
  assert.equal(await main(['--run', 'r1', '--artefacts', artefacts()], { client, out: (l) => lines.push(l) }), 1);
  assert.match(lines.join('\n'), /deletes the test tests\/a\.test\.js/);
});

test('merge-fix waits while the fix\'s check is running, and only then', async () => {
  const answers = [{ ok: false, refused: 'checking', waiting: true }, { ok: false, refused: 'checking', waiting: true }, { ok: true, pr: 12, head: 'a'.repeat(40) }];
  let slept = 0;
  const client = { engine: { mergeFix: async () => answers.shift() } };
  assert.equal(await main(['--run', 'r1', '--artefacts', artefacts()], { client, out: () => {}, sleep: async () => { slept += 1; } }), 0);
  assert.equal(slept, 2);
});

test('merge-fix stops waiting at its limit, with the refusal', async () => {
  const client = { engine: { mergeFix: async () => ({ ok: false, refused: 'no passing check', waiting: true }) } };
  const lines = [];
  assert.equal(await main(['--run', 'r1', '--artefacts', artefacts()], { client, out: (l) => lines.push(l), sleep: async () => {}, waitMs: 30, everyMs: 10 }), 1);
  assert.match(lines.join('\n'), /no passing check/);
});

test('merge-fix needs the run', async () => {
  assert.equal(await main([], { client: { engine: { mergeFix: async () => ({ ok: true }) } }, out: () => {} }), 2);
});
