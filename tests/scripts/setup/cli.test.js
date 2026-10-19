// tests/scripts/setup/cli.test.js
// Setup's one command, `cli.js <plan | apply | status | resume>`: each form asks the helper's
// setup routes for this folder, and says what they answered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../../../scripts/setup/cli.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { setupLine } from '../../../scripts/state/card-lines.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { keepClick } from '../../../scripts/setup/clicks.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const SCRIPT = fileURLToPath(new URL('../../../scripts/setup/cli.js', import.meta.url));
const STEPS_MODULE = fileURLToPath(new URL('../../helpers/setup-steps.js', import.meta.url));
const T0 = new Date('2026-10-19T03:00:00.000Z');
const H = 'ab'.repeat(32);

// Runs the command with a client, and gives back its exit code and what it wrote.
async function run(argv, { client, cwd = '/x/Projects/shop' } = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, { client, cwd, out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}

// A helper's setup routes that keep every call and answer as `answers` says.
function fakeClient(answers = {}) {
  const calls = [];
  const route = (name) => async (body) => {
    calls.push([name, body]);
    const answer = answers[name];
    return typeof answer === 'function' ? answer(body) : answer ?? { ok: false, refused: 'not expected' };
  };
  return { calls, setup: { plan: route('plan'), apply: route('apply'), status: route('status') } };
}

test('each form asks the helper for this folder, and only with the folder, the step and the hash', async () => {
  const card = { question: `Setup step 2.\n${setupLine(2, H)}`, header: 'Setup', options: [{ label: 'Go ahead' }], multiSelect: false };
  const c = fakeClient({
    plan: { ok: true, changes: [{ kind: 'json-key', target: '/t', key: ['a'], after: 1 }], hash: H, card, director: 'One click' },
    apply: { ok: true, started: true },
    status: { ok: true, lines: ['Setup of /x/Projects/shop, started 2026-10-19T03:00:00.000Z.', 'Next: step 2, Tools.'], next: 2, ask: 2 },
  });
  const plan = await run(['plan', '2'], { client: c });
  assert.equal(plan.code, 0, plan.err);
  assert.deepEqual(JSON.parse(plan.out), { step: 2, title: 'Tools', hash: H, director: 'One click', changes: [{ kind: 'json-key', target: '/t', key: ['a'], after: 1 }], card });
  const apply = await run(['apply', '2', H], { client: c });
  assert.equal(apply.code, 0, apply.err);
  assert.deepEqual(JSON.parse(apply.out), { started: true });
  const status = await run(['status'], { client: c });
  assert.equal(status.code, 0, status.err);
  assert.equal(status.out, 'Setup of /x/Projects/shop, started 2026-10-19T03:00:00.000Z.\nNext: step 2, Tools.\n');
  const folder = path.resolve('/x/Projects/shop');
  assert.deepEqual(c.calls, [['plan', { folder, step: 2 }], ['apply', { folder, step: 2, hash: H }], ['status', { folder }]]);
});

test('resume gives where setup stands and the card of the first step neither done nor running', async () => {
  const card = { question: `Setup step 4.\n${setupLine(4, H)}` };
  const c = fakeClient({
    status: { ok: true, lines: ['Step 3: running since x', 'Next: step 3, The host and the connection.'], next: 3, ask: 4 },
    plan: { ok: true, changes: [], hash: H, card, director: 'One click' },
  });
  const resumed = await run(['resume'], { client: c });
  assert.equal(resumed.code, 0, resumed.err);
  assert.deepEqual(JSON.parse(resumed.out), {
    lines: ['Step 3: running since x', 'Next: step 3, The host and the connection.'], next: 3,
    plan: { step: 4, title: 'Three questions', hash: H, director: 'One click', changes: [], card },
  });
  assert.deepEqual(c.calls.map(([name, body]) => [name, body.step]), [['status', undefined], ['plan', 4]]);
  // Every step done, or every one left running: where setup stands, and no card.
  const done = fakeClient({ status: { ok: true, lines: ['Every step is done.'], next: null, ask: null } });
  assert.deepEqual(JSON.parse((await run(['resume'], { client: done })).out), { lines: ['Every step is done.'], next: null, plan: null });
  assert.deepEqual(done.calls.map(([name]) => name), ['status']);
});

test('a wrong form, a step out of range, a short hash or a refusal is one line on standard error', async () => {
  const c = fakeClient({ apply: { ok: false, refused: 'STOP is on' }, plan: { ok: false, refused: 'step 1, Install is already done' } });
  for (const argv of [[], ['go'], ['plan'], ['plan', '0'], ['plan', '11'], ['plan', '1', '2'], ['plan', 'x'], ['apply', '1'], ['apply', '1', H.slice(0, 12)],
    ['apply', '1', H.toUpperCase()], ['apply', '1', H, 'more'], ['status', 'now'], ['resume', '3']]) {
    const got = await run(argv, { client: c });
    assert.equal(got.code, 1, argv.join(' '));
    assert.equal(got.out, '');
    assert.match(got.err, /^[^\n]+\n$/, argv.join(' '));
  }
  assert.deepEqual(c.calls, [], 'nothing was asked for a wrong form');
  const stopped = await run(['apply', '1', H], { client: c });
  assert.deepEqual([stopped.code, stopped.err], [1, 'STOP is on\n']);
  const done = await run(['plan', '1'], { client: c });
  assert.deepEqual([done.code, done.err], [1, 'step 1, Install is already done\n']);
  const gone = await run(['status'], { client: { setup: { status: async () => { throw new Error('connect ENOENT'); } } } });
  assert.equal(gone.code, 1);
  assert.match(gone.err, /^The host helper didn't answer: connect ENOENT\n$/);
});

test('against the helper, a card is planned, refused without its click, applied after it, and read under STOP', async () => {
  const home = shortHome();
  const user = tempFolder('wh-cli zoë ');
  const folder = path.join(user, 'Projects', 'Café');
  fs.mkdirSync(folder, { recursive: true });
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify({ 1: [{ file: 'x.json', key: ['a'], value: 1 }] }));
    const helper = await startHelper({
      address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), now: () => T0, setupSteps: STEPS_MODULE, userHome: user,
    });
    const client = helperClient({ address: helper.address });
    try {
      const resumed = await run(['resume'], { client, cwd: folder });
      assert.equal(resumed.code, 0, resumed.err);
      const { plan } = JSON.parse(resumed.out);
      assert.equal(plan.step, 1);
      assert.ok(plan.card.question.includes(setupLine(1, plan.hash)));
      const refused = await run(['apply', '1', plan.hash], { client, cwd: folder });
      assert.equal(refused.code, 1);
      assert.match(refused.err, /click/);
      keepClick(makeEvent({ kind: 'action', data: { action: 'setup', step: 1, hash: plan.hash, question: plan.card.question, label: 'Go ahead' }, now: () => T0 }));
      setStop({ by: 'prompt' });
      assert.equal((await run(['status'], { client, cwd: folder })).code, 0);
      assert.equal((await run(['plan', '1'], { client, cwd: folder })).code, 0);
      assert.equal((await run(['resume'], { client, cwd: folder })).code, 0);
      assert.deepEqual((await run(['apply', '1', plan.hash], { client, cwd: folder })).err, 'STOP is on\n');
      liftStop();
      const applied = await run(['apply', '1', plan.hash], { client, cwd: folder });
      assert.equal(applied.code, 0, applied.err);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'x.json'), 'utf8')), { a: 1 });
      const status = await run(['status'], { client, cwd: folder });
      assert.match(status.out, /^Step 1, Install: done at /m);
      assert.match(status.out, /^Next: step 2, Tools\.$/m);
    } finally {
      await helper.close();
    }
  });
});

test('run as a script, a wrong form says how the command is used', () => {
  const got = spawnSync(process.execPath, [SCRIPT, 'go'], { encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: shortHome() } });
  assert.equal(got.status, 1);
  assert.equal(got.stdout, '');
  assert.match(got.stderr, /^Commands: plan <step>, apply <step> <hash>, status, resume\n$/);
});
