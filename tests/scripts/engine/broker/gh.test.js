// tests/scripts/engine/broker/gh.test.js
// The broker's program (Archon design, section 12.4): it sends the exact request to the helper and writes back its
// answer, interpreting nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main as ghMain } from '../../../../scripts/engine/broker/gh.js';

function streams() {
  const got = { out: '', err: '' };
  return { got, stdout: (t) => { got.out += t; }, stderr: (t) => { got.err += t; } };
}

test('gh.js passes the real output through unchanged', async () => {
  const sent = [];
  const client = { broker: { gh: async (body) => { sent.push(body); return { ok: true, code: 3, stdout: '{"a":1}\n', stderr: 'warning: x\n' }; } } };
  const { got, stdout, stderr } = streams();
  const code = await ghMain(['pr', 'view', '14', '--json', 'body'], { client, cwd: '/p/wt', stdin: async () => 'in', stdout, stderr });
  assert.equal(code, 3);
  assert.deepEqual(got, { out: '{"a":1}\n', err: 'warning: x\n' });
  assert.deepEqual(sent, [{ argv: ['pr', 'view', '14', '--json', 'body'], cwd: '/p/wt', stdin: 'in' }]);
  const unreachable = { broker: { gh: async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' }) } };
  const down = streams();
  assert.equal(await ghMain(['pr', 'view', '1'], { client: unreachable, stdin: async () => '', stdout: down.stdout, stderr: down.stderr }), 1);
  assert.match(down.got.err, /couldn't ask the helper/);
});
