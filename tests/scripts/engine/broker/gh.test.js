// tests/scripts/engine/broker/gh.test.js
// The broker's program and git's credential helper (Archon design, section 12.4): both send the exact request to the
// helper and write back its answer, interpreting nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main as ghMain } from '../../../../scripts/engine/broker/gh.js';
import { main as credentialMain } from '../../../../scripts/engine/broker/git-credential.js';

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

test('the credential helper answers only what the helper gives, and only for get', async () => {
  const asked = [];
  const client = { broker: { credential: async (body) => { asked.push(body); return { ok: true, username: 'x-access-token', password: 'ghs_FAKE' }; } } };
  let out = '';
  assert.equal(await credentialMain(['get'], { client, cwd: '/p', stdin: async () => 'protocol=https\nhost=github.com\n', out: (t) => { out += t; } }), 0);
  assert.equal(out, 'username=x-access-token\npassword=ghs_FAKE\n');
  assert.equal(asked[0].request, 'protocol=https\nhost=github.com\n');
  out = '';
  assert.equal(await credentialMain(['store'], { client, stdin: async () => '', out: (t) => { out += t; } }), 0);
  assert.equal(out, '');
  const refusing = { broker: { credential: async () => ({ ok: false, refused: 'not the project\'s' }) } };
  await credentialMain(['get'], { client: refusing, stdin: async () => '', out: (t) => { out += t; } });
  assert.equal(out, '');
});
