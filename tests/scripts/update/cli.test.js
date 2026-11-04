// tests/scripts/update/cli.test.js
// The update command's one script (update design, section 6): plan, apply, status and answer, each a request to the
// helper's /update/* routes naming the folder the session is in, and each giving JSON. Nothing here signs anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, USAGE } from '../../../scripts/update/cli.js';

const HASH = 'b'.repeat(64);

function run(argv, answers = {}) {
  const calls = [];
  const route = (name) => async (body) => {
    calls.push([name, body]);
    const answer = answers[name];
    return typeof answer === 'function' ? answer(body) : answer ?? { ok: true };
  };
  const client = { update: { plan: route('plan'), apply: route('apply'), status: route('status'), answer: route('answer') } };
  let out = '';
  let err = '';
  return main(argv, { cwd: '/p', client, out: (t) => { out += t; }, err: (t) => { err += t; } }).then((code) => ({ code, out, err, calls }));
}

test('cli: plan names the folder, and a release when one is given, and prints the helper\'s card and hash as JSON', async () => {
  const got = await run(['plan'], { plan: { ok: true, hash: HASH, card: { question: 'Update Wheelhouse', options: [] }, lines: ['x'] } });
  assert.equal(got.code, 0);
  assert.deepEqual(got.calls, [['plan', { folder: '/p' }]]);
  assert.deepEqual(JSON.parse(got.out), { hash: HASH, card: { question: 'Update Wheelhouse', options: [] }, lines: ['x'] });
  const named = await run(['plan', 'v0.2.8']);
  assert.deepEqual(named.calls, [['plan', { folder: '/p', tag: 'v0.2.8' }]]);
});

test('cli: plan with nothing newer gives the one line and no card', async () => {
  const got = await run(['plan'], { plan: { ok: true, lines: ['You have the latest Wheelhouse, v0.2.6.'] } });
  assert.deepEqual(JSON.parse(got.out), { lines: ['You have the latest Wheelhouse, v0.2.6.'] });
});

test('cli: a release that is not a tag is refused before the helper is asked', async () => {
  for (const bad of ['latest', '0.2.8', 'v1', '--x', 'v0.2.8; rm', 'v0.2.8/../x']) {
    const got = await run(['plan', bad]);
    assert.equal(got.code, 1, bad);
    assert.deepEqual(got.calls, []);
  }
});

test('cli: apply takes the full hash and answers started; a short or odd hash is refused', async () => {
  const got = await run(['apply', HASH], { apply: { ok: true, started: true } });
  assert.deepEqual(got.calls, [['apply', { folder: '/p', hash: HASH }]]);
  assert.deepEqual(JSON.parse(got.out), { started: true });
  for (const bad of ['abc', HASH.toUpperCase(), `${HASH}0`]) assert.equal((await run(['apply', bad])).code, 1);
});

test('cli: the helper\'s refusal is said as it is, so All stop says to lift it first', async () => {
  const got = await run(['apply', HASH], { apply: { ok: false, refused: 'Lift All stop first.' } });
  assert.equal(got.code, 1);
  assert.equal(got.err, 'Lift All stop first.\n');
  assert.equal(got.out, '');
});

test('cli: status gives its lines, the cards waiting for the director and its state', async () => {
  const asks = [{ id: 'release-1', card: { question: 'Q', options: [] } }];
  const got = await run(['status'], { status: { ok: true, lines: ['Updating Wheelhouse to v0.2.7.'], asks, state: 'running' } });
  assert.deepEqual(JSON.parse(got.out), { lines: ['Updating Wheelhouse to v0.2.7.'], asks, state: 'running' });
  assert.deepEqual(got.calls, [['status', { folder: '/p' }]]);
});

test('cli: status with no helper answering says so in a line and stops the loop only the helper can end', async () => {
  const got = await run(['status'], { status: { ok: false, refused: 'the host helper could not be reached: is it running?' } });
  assert.equal(got.code, 0);
  const said = JSON.parse(got.out);
  assert.equal(said.state, 'unreachable');
  assert.match(said.lines[0], /isn't answering/);
});

test('cli: answer relays a label on a card and signs nothing; only the known labels and card names are taken', async () => {
  const got = await run(['answer', 'update-helper-4242-x', 'Stop it'], { answer: { ok: true, recorded: true, lines: ['Carrying on.'] } });
  assert.deepEqual(got.calls, [['answer', { folder: '/p', card: 'update-helper-4242-x', label: 'Stop it' }]]);
  assert.deepEqual(JSON.parse(got.out), { recorded: true, lines: ['Carrying on.'] });
  assert.equal((await run(['answer', 'update-helper-4242-x', 'Delete everything'])).code, 1);
  assert.equal((await run(['answer', '../x', 'Stop it'])).code, 1);
  assert.equal((await run(['answer', 'x'])).code, 1);
  // The not-now answer to the Update card names the plan's hash.
  const later = await run(['answer', HASH, 'Not now']);
  assert.deepEqual(later.calls, [['answer', { folder: '/p', card: HASH, label: 'Not now' }]]);
});

test('cli: nothing but the four forms is taken, and the usage names them', async () => {
  for (const argv of [[], ['remove'],['plan', 'v0.2.8', 'extra'], ['status', 'x'], ['apply'], ['apply', HASH, 'x']]) {
    const got = await run(argv);
    assert.equal(got.code, 1, argv.join(' '));
    assert.deepEqual(got.calls, []);
  }
  assert.match(USAGE, /plan \[<tag>\], apply <hash>, status, answer <card> <label>/);
});
