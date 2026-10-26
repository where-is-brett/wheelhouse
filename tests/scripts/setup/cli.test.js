// tests/scripts/setup/cli.test.js
// Setup's one command, `cli.js <plan | apply | status | resume>`: each form asks the helper's
// setup routes for this folder, and says what they answered.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, USAGE, WAIT_MOST_MS } from '../../../scripts/setup/cli.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { setupLine } from '../../../scripts/state/card-lines.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { keepClick } from '../../../scripts/setup/clicks.js';
import { readJournal } from '../../../scripts/setup/journal.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const SCRIPT = fileURLToPath(new URL('../../../scripts/setup/cli.js', import.meta.url));
const STEPS_MODULE = fileURLToPath(new URL('../../helpers/setup-steps.js', import.meta.url));
const T0 = new Date('2026-10-19T03:00:00.000Z');
const H = 'ab'.repeat(32);

// Runs the command with a client, and gives back its exit code and what it wrote.
async function run(argv, { client, cwd = '/x/Projects/shop', ...rest } = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, { client, cwd, out: (t) => { out += t; }, err: (t) => { err += t; }, ...rest });
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
  return {
    calls,
    setup: {
      plan: route('plan'), apply: route('apply'), status: route('status'), health: route('health'),
      uninstall: { plan: route('uninstall plan'), apply: route('uninstall apply'), status: route('uninstall status') },
    },
  };
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

// A step that settles says its line at once (rulings R101, R120): plan and resume pass `said`
// through, cleaned of line breaks as status's lines are; a settling with nothing said has none.
test('a settled step\'s said line comes with its plan and with resume, and none when it said nothing', async () => {
  const said = 'Setup step 6, Changes to this computer: every setting is already as Wheelhouse needs.\nYour own settings that weaken Standard: docker runs outside the sandbox.';
  const one = 'Setup step 6, Changes to this computer: every setting is already as Wheelhouse needs. Your own settings that weaken Standard: docker runs outside the sandbox.';
  const c = fakeClient({
    plan: { ok: true, done: true, said },
    status: { ok: true, lines: ['Next: step 6, Changes to this computer.'], next: 6, ask: 6 },
  });
  assert.deepEqual(JSON.parse((await run(['plan', '6'], { client: c })).out), { step: 6, title: 'Changes to this computer', done: true, said: one });
  assert.deepEqual(JSON.parse((await run(['resume'], { client: c })).out).plan, { step: 6, title: 'Changes to this computer', done: true, said: one });
  const quiet = fakeClient({ plan: { ok: true, done: true } });
  assert.deepEqual(JSON.parse((await run(['plan', '2'], { client: quiet })).out), { step: 2, title: 'Tools', done: true });
});

// Step 10 (ruling R41): the session hands in the lines its sandboxed trials printed, as they are,
// and gets back the joined board; with none, it learns which pull request and project to try.
test('health hands the trial lines to the helper, as they are, and gives back the board', async () => {
  const lines = ['read .env.local: refused / refused', 'merge with forged approval: refused / MERGED (unexpected)'];
  const answer = { ok: true, green: false, lines: ['Passed: x.'], board: 'The board.', trials: { pr: 12, project: 'o__r' } };
  const c = fakeClient({ health: answer });
  const got = await run(['health', ...lines], { client: c });
  assert.equal(got.code, 0, got.err);
  const { ok, ...rest } = answer; // eslint-disable-line no-unused-vars
  assert.deepEqual(JSON.parse(got.out), rest);
  const none = await run(['health'], { client: c });
  assert.equal(none.code, 0, none.err);
  assert.deepEqual(c.calls, [['health', { folder: path.resolve('/x/Projects/shop'), lines }], ['health', { folder: path.resolve('/x/Projects/shop'), lines: [] }]]);
  const bad = fakeClient({ health: answer });
  for (const argv of [['health', 'read .env.local: refused / refused; rm -rf x'], ['health', 'not a trial line'], ['health', ...Array.from({ length: 13 }, () => lines[0])]]) {
    const refused = await run(argv, { client: bad });
    assert.equal(refused.code, 1, argv.join(' '));
    assert.match(refused.err, /^[^\n]+\n$/);
  }
  assert.deepEqual(bad.calls, []);
  // Once green, the first briefing and the carry-on card (ruling A9) come back as the helper gives them.
  const card = { question: { question: 'Shall I carry them on?', header: 'Question', options: [], multiSelect: false }, id: 'e1' };
  const green = { ok: true, green: true, lines: ['Passed: x.'], board: 'The board.', trials: { pr: 12, project: 'o__r' }, started: 'Started.', briefing: 'The briefing.', card };
  const finished = await run(['health', ...lines], { client: fakeClient({ health: green }) });
  assert.deepEqual(JSON.parse(finished.out).card, card);
});

test('a wrong form, a step out of range, a short hash or a refusal is one line on standard error', async () => {
  const c = fakeClient({ apply: { ok: false, refused: 'STOP is on' }, plan: { ok: false, refused: 'step 1, Install is already done' } });
  for (const argv of [[], ['go'], ['plan'], ['plan', '11'], ['plan', '1', '2'], ['plan', 'x'], ['apply', '1'], ['apply', '1', H.slice(0, 12)],
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
      run: hostGuard,
      address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), now: () => T0, setupSteps: STEPS_MODULE, userHome: user,
    });
    const client = helperClient({ address: helper.address });
    try {
      // Resume gives the one card first (design section 15.1); a step's own card is planned by its number.
      const resumed = await run(['resume'], { client, cwd: folder });
      assert.equal(resumed.code, 0, resumed.err);
      assert.equal(JSON.parse(resumed.out).plan.step, 0);
      const planned = await run(['plan', '1'], { client, cwd: folder });
      assert.equal(planned.code, 0, planned.err);
      const plan = JSON.parse(planned.out);
      assert.equal(plan.step, 1);
      assert.ok(plan.card.question.includes(setupLine(1, plan.hash)));
      const refused = await run(['apply', '1', plan.hash], { client, cwd: folder });
      assert.equal(refused.code, 1);
      assert.match(refused.err, /click/);
      const runId = readJournal().runs.at(-1).id;
      keepClick(makeEvent({ kind: 'action', data: { action: 'setup', runId, step: 1, hash: plan.hash, question: plan.card.question, label: 'Go ahead' }, now: () => T0 }));
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
  assert.match(got.stderr, /^Commands: plan <step>, apply <step> <hash>, status, resume, wait <step>, choices, change <key>, health \[<trial line> ...\], uninstall plan, uninstall apply <hash>, uninstall status\n$/);
});

test('run as a script through a linked plugin folder, it still runs', () => {
  // A plugin folder reached through a link: the command's path is the link's, its module's is real.
  const linked = path.join(tempFolder('wh-linked '), 'plugin');
  fs.symlinkSync(path.resolve(path.dirname(SCRIPT), '..', '..'), linked, process.platform === 'win32' ? 'junction' : 'dir');
  const got = spawnSync(process.execPath, [path.join(linked, 'scripts', 'setup', 'cli.js'), 'go'], { encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: shortHome() } });
  assert.equal(got.status, 1);
  assert.match(got.stderr, /^Commands: plan <step>, apply <step> <hash>, status, resume, wait <step>, choices, change <key>, health \[<trial line> ...\], uninstall plan, uninstall apply <hash>, uninstall status\n$/);
});

test('the uninstall forms ask the helper\'s uninstall routes for this folder, apply with the full hash only', async () => {
  const card = { question: 'Uninstall.\nRemove Wheelhouse from shop as listed, abababababab', header: 'Uninstall', options: [{ label: 'Remove it' }], multiSelect: false };
  const c = fakeClient({
    'uninstall plan': { ok: true, hash: H, card, asks: [], last: true },
    'uninstall apply': { ok: true, started: true },
    'uninstall status': { ok: true, lines: ['Uninstall is done.', 'Locked: Locked is off.', 'Open the pull request: https://github.com/o/shop/pull/3'], uninstall: { state: 'done' } },
  });
  const plan = await run(['uninstall', 'plan'], { client: c });
  assert.equal(plan.code, 0, plan.err);
  assert.deepEqual(JSON.parse(plan.out), { hash: H, card, asks: [], last: true });
  const apply = await run(['uninstall', 'apply', H], { client: c });
  assert.equal(apply.code, 0, apply.err);
  assert.deepEqual(JSON.parse(apply.out), { started: true });
  const status = await run(['uninstall', 'status'], { client: c });
  assert.equal(status.out, 'Uninstall is done.\nLocked: Locked is off.\nOpen the pull request: https://github.com/o/shop/pull/3\n');
  assert.deepEqual(c.calls, [
    ['uninstall plan', { folder: path.resolve('/x/Projects/shop') }],
    ['uninstall apply', { folder: path.resolve('/x/Projects/shop'), hash: H }],
    ['uninstall status', { folder: path.resolve('/x/Projects/shop') }],
  ]);
  // A short hash, and any other words, are refused before the helper is asked.
  for (const argv of [['uninstall', 'apply', 'abc'], ['uninstall'], ['uninstall', 'plan', 'now'], ['uninstall', 'status', 'x'], ['uninstall', 'apply']]) {
    const got = await run(argv, { client: c });
    assert.equal(got.code, 1, argv.join(' '));
  }
  assert.equal(c.calls.length, 3);
});

// From the rehearsal on a project under way (docs/evals/rehearsal-project-under-way.md): Claude Code
// refuses a foreground `sleep`, so the session's first try at step 9's two-minute wait was refused
// each time. `wait <step>` waits in the command itself, asking the step's plan again as it goes, up
// to WAIT_MOST_MS a call, so it stays within a command's own time limit.
test('wait <step> waits while the step\'s plan is a wait, up to WAIT_MOST_MS a call, and says when it is over', async () => {
  let clock = T0.getTime();
  const slept = [];
  const timing = { now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } };
  const until = (end) => () => (clock < end ? { ok: true, wait: end - clock, why: 'the director\'s screen is locked' } : { ok: true, ask: { step: 9, id: 'push-arrived', card: {} } });
  const soon = fakeClient({ plan: until(T0.getTime() + 30000) });
  const over = await run(['wait', '9'], { client: soon, ...timing });
  assert.equal(over.code, 0, over.err);
  assert.deepEqual(JSON.parse(over.out), { step: 9, waited: true });
  assert.deepEqual(slept, [30000]);
  // A wait longer than a call waits WAIT_MOST_MS, then says how long is left.
  clock = T0.getTime();
  slept.length = 0;
  const long = fakeClient({ plan: until(T0.getTime() + WAIT_MOST_MS + 20000) });
  const part = await run(['wait', '9'], { client: long, ...timing });
  assert.deepEqual(JSON.parse(part.out), { step: 9, waiting: 20000 });
  assert.equal(slept.reduce((a, b) => a + b, 0), WAIT_MOST_MS);
  assert.ok(WAIT_MOST_MS <= 100000, 'well within the two minutes a command may run by default');
  // A step that isn't waiting is over at once, and a refusal is said as the helper gave it.
  const none = await run(['wait', '3'], { client: fakeClient({ plan: { ok: true, ask: { step: 3, id: 'x', card: {} } } }), ...timing });
  assert.deepEqual(JSON.parse(none.out), { step: 3, waited: true });
  const refused = await run(['wait', '3'], { client: fakeClient({ plan: { ok: false, refused: 'STOP is on' } }), ...timing });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /STOP is on/);
  assert.match(USAGE, /wait <step>/);
});
