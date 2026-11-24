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
import { main, USAGE, WAIT_MOST_MS, RUNNING_POLL_MS, HELPER_RETRIES, HELPER_RETRY_MS, HELPER_NOT_UP } from '../../../scripts/setup/cli.js';
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
  const code = await main(argv, { client, cwd, out: (t) => { out += t; }, err: (t) => { err += t; }, entrypoint: 'cli', env: {}, ...rest });
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

test('each form asks the helper for this folder, and only with the folder, the step, the hash and, for a step\'s card, where the session runs', async () => {
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
  assert.deepEqual(c.calls, [['plan', { folder, step: 2, entrypoint: 'terminal' }], ['apply', { folder, step: 2, hash: H, entrypoint: 'terminal' }], ['status', { folder }]]);
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
  // Until step 7 is applied, resume reminds a session that ran setup outside the sandbox to keep doing so.
  const due = fakeClient({ status: { ok: true, lines: ['Every step is done.'], next: null, ask: null, filesDue: true } });
  assert.match(JSON.parse((await run(['resume'], { client: due })).out).sandbox, /^Step 7 is not applied yet: try the sandbox first.*run it outside/);
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

// The phone's step settles with no card where none can be shown; step 10's card, which opens with
// the verdict and first briefing, is in the same resume, from a status taken after it settled.
test('resume carries on past a step that settled with nothing said, to the card after it', async () => {
  const statuses = [
    { ok: true, lines: ['Step 9, Phone notifications: not started'], next: 9, ask: 9 },
    { ok: true, lines: ['Setup is finished.'], next: null, ask: 10 },
  ];
  const ready = { step: 10, id: 'setup-ready', card: { question: 'All 12 checks passed. Wheelhouse is ready.\nSetup is finished.' } };
  const c = fakeClient({
    status: () => statuses.shift() ?? { ok: true, lines: ['Setup is finished.'], next: null, ask: null },
    plan: (body) => (body.step === 9 ? { ok: true, done: true } : { ok: true, ask: ready }),
  });
  const resumed = JSON.parse((await run(['resume'], { client: c })).out);
  assert.equal(resumed.next, null);
  assert.deepEqual(resumed.plan.ask, ready);
  assert.deepEqual(c.calls.map(([name, body]) => [name, body.step]), [['status', undefined], ['plan', 9], ['status', undefined], ['plan', 10]]);
  // Nothing after it: one more status, and the settled step's plan as it was.
  const alone = fakeClient({ status: () => ({ ok: true, lines: ['Setup is finished.'], next: null, ask: 9 }), plan: { ok: true, done: true } });
  assert.deepEqual(JSON.parse((await run(['resume'], { client: alone })).out).plan, { step: 9, title: 'Phone notifications', done: true });
  assert.deepEqual(alone.calls.map(([name]) => name), ['status', 'plan', 'status']);
});

// Step 10 (ruling R41): the session hands in the lines its sandboxed trials printed, as they are,
// and gets back the joined board; with none, it learns which pull request and project to try.
test('health hands the trial lines to the helper, as they are, and gives back the board', async () => {
  const lines = ['read .env.local: refused / refused', 'merge with forged approval: refused / MERGED (unexpected)'];
  const answer = { ok: true, green: false, lines: ['Passed: x.'], board: 'The board.', trials: { pr: 12, project: 'o__r' } };
  const c = fakeClient({ health: answer });
  const got = await run(['health', ...lines], { client: c, entrypoint: 'cli' });
  assert.equal(got.code, 0, got.err);
  const { ok, ...rest } = answer; // eslint-disable-line no-unused-vars
  assert.deepEqual(JSON.parse(got.out), rest);
  const none = await run(['health'], { client: c, entrypoint: 'cli' });
  const app = await run(['health'], { client: c, entrypoint: 'claude-desktop' });
  assert.equal(app.code, 0, app.err);
  assert.equal(none.code, 0, none.err);
  assert.deepEqual(c.calls, [['health', { folder: path.resolve('/x/Projects/shop'), lines }], ['health', { folder: path.resolve('/x/Projects/shop'), lines: [] }], ['health', { folder: path.resolve('/x/Projects/shop'), lines: [], desktop: true }]]);
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
  const c = fakeClient({ apply: { ok: false, refused: 'All stop is on' }, plan: { ok: false, refused: 'step 1, Install is already done' } });
  for (const argv of [[], ['go'], ['plan'], ['plan', '11'], ['plan', '1', '2'], ['plan', 'x'], ['apply', '1'], ['apply', '1', H.slice(0, 12)],
    ['apply', '1', H.toUpperCase()], ['apply', '1', H, 'more'], ['status', 'now'], ['resume', '3']]) {
    const got = await run(argv, { client: c });
    assert.equal(got.code, 1, argv.join(' '));
    assert.equal(got.out, '');
    assert.match(got.err, /^[^\n]+\n$/, argv.join(' '));
  }
  assert.deepEqual(c.calls, [], 'nothing was asked for a wrong form');
  const stopped = await run(['apply', '1', H], { client: c });
  assert.deepEqual([stopped.code, stopped.err], [1, 'All stop is on\n']);
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
      assert.match(plan.card.question, /^Setup step 1, Install:/);
      assert.ok(!plan.card.question.includes(setupLine(1, plan.hash)), 'sent without its line of hash');
      const refused = await run(['apply', '1', plan.hash], { client, cwd: folder });
      assert.equal(refused.code, 1);
      assert.match(refused.err, /click/);
      const runId = readJournal().runs.at(-1).id;
      keepClick(makeEvent({ kind: 'action', data: { action: 'setup', runId, step: 1, hash: plan.hash, question: plan.card.question, label: 'Go ahead' }, now: () => T0 }));
      setStop({ by: 'prompt' });
      assert.equal((await run(['status'], { client, cwd: folder })).code, 0);
      assert.equal((await run(['plan', '1'], { client, cwd: folder })).code, 0);
      assert.equal((await run(['resume'], { client, cwd: folder })).code, 0);
      assert.deepEqual((await run(['apply', '1', plan.hash], { client, cwd: folder })).err, 'All stop is on\n');
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
  assert.match(got.stderr, /^Commands: plan <step>, apply <step> <hash>, status, resume, wait <step>, choices, change <key>, health \[<trial line> ...\], sign-in, uninstall plan, uninstall apply <hash>, uninstall status\n$/);
});

test('run as a script through a linked plugin folder, it still runs', () => {
  // A plugin folder reached through a link: the command's path is the link's, its module's is real.
  const linked = path.join(tempFolder('wh-linked '), 'plugin');
  fs.symlinkSync(path.resolve(path.dirname(SCRIPT), '..', '..'), linked, process.platform === 'win32' ? 'junction' : 'dir');
  const got = spawnSync(process.execPath, [path.join(linked, 'scripts', 'setup', 'cli.js'), 'go'], { encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: shortHome() } });
  assert.equal(got.status, 1);
  assert.match(got.stderr, /^Commands: plan <step>, apply <step> <hash>, status, resume, wait <step>, choices, change <key>, health \[<trial line> ...\], sign-in, uninstall plan, uninstall apply <hash>, uninstall status\n$/);
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
  const idle = { ok: true, lines: [] };
  const soon = fakeClient({ status: idle, plan: until(T0.getTime() + 30000) });
  const over = await run(['wait', '9'], { client: soon, ...timing });
  assert.equal(over.code, 0, over.err);
  assert.deepEqual(JSON.parse(over.out), { step: 9, waited: true });
  assert.deepEqual(slept, [30000]);
  // A wait longer than a call waits WAIT_MOST_MS, then says how long is left.
  clock = T0.getTime();
  slept.length = 0;
  const long = fakeClient({ status: idle, plan: until(T0.getTime() + WAIT_MOST_MS + 20000) });
  const part = await run(['wait', '9'], { client: long, ...timing });
  assert.deepEqual(JSON.parse(part.out), { step: 9, waiting: 20000 });
  assert.equal(slept.reduce((a, b) => a + b, 0), WAIT_MOST_MS);
  assert.ok(WAIT_MOST_MS <= 100000, 'well within the two minutes a command may run by default');
  // A step that isn't waiting is over at once, and a refusal is said as the helper gave it.
  const none = await run(['wait', '3'], { client: fakeClient({ status: idle, plan: { ok: true, ask: { step: 3, id: 'x', card: {} } } }), ...timing });
  assert.deepEqual(JSON.parse(none.out), { step: 3, waited: true });
  const refused = await run(['wait', '3'], { client: fakeClient({ status: idle, plan: { ok: false, refused: 'All stop is on' } }), ...timing });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /All stop is on/);
  assert.match(USAGE, /wait <step>/);
});

// From a new product's setup on v0.1.2: after `apply 10` gave { started: true }, `wait 10` answered
// "Health check is already running" at once, since a running step's plan is refused, and the
// session wrote a wait loop of its own that failed for twenty minutes. A running step is a wait:
// `wait` asks status, and is over once the step has stopped running.
test('wait <step> waits while the step runs, and is over once it stops, within WAIT_MOST_MS a call', async () => {
  let clock = T0.getTime();
  const slept = [];
  const timing = { now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } };
  const stops = T0.getTime() + 14000;
  const status = () => ({ ok: true, lines: [], ...(clock < stops ? { running: [10] } : {}) });
  const refusedWhileRunning = () => (clock < stops ? { ok: false, refused: 'Step 10, Health check is already running' } : { ok: true, wait: 30000, why: 'step 10\'s own checks are done' });
  const c = fakeClient({ status, plan: refusedWhileRunning });
  const over = await run(['wait', '10'], { client: c, ...timing });
  assert.equal(over.code, 0, over.err);
  assert.deepEqual(JSON.parse(over.out), { step: 10, waited: true });
  assert.ok(slept.every((ms) => ms <= RUNNING_POLL_MS));
  assert.ok(clock >= stops && clock < stops + RUNNING_POLL_MS + 1);
  assert.equal(c.calls.filter(([name]) => name === 'plan').length, 0, 'a running step is never planned');
  // A long step running past a call's time says so, and the session runs wait again.
  clock = T0.getTime();
  slept.length = 0;
  const long = fakeClient({ status: { ok: true, lines: [], running: [2] } });
  const part = await run(['wait', '2'], { client: long, ...timing });
  assert.deepEqual(JSON.parse(part.out), { step: 2, running: true });
  assert.equal(slept.reduce((a, b) => a + b, 0), WAIT_MOST_MS);
});

// The session's start goes to the helper with every request, when the command can tell it.
test('every request carries when the session started, when the command knows it', async () => {
  const started = '2026-10-17T01:02:03.000Z';
  const c = fakeClient({ plan: { ok: true, wait: 30000, why: 'x' } });
  await run(['plan', '10'], { client: c, started });
  assert.equal(c.calls[0][1].sessionStartedAt, started);
  const none = fakeClient({ plan: { ok: true, wait: 30000, why: 'x' } });
  await run(['plan', '10'], { client: none });
  assert.equal('sessionStartedAt' in none.calls[0][1], false);
});

// Step 10's own checks done: its plan is the session's part (the trials), not a wait to sit through.
test('wait 10 is over once step 10\'s own checks are done', async () => {
  let clock = T0.getTime();
  const timing = { now: () => clock, sleep: async (ms) => { clock += ms; } };
  const checked = fakeClient({ status: { ok: true, lines: ['Step 10, Health check: its own checks finished at x; the board isn\'t green yet'] }, plan: { ok: true, wait: 30000, why: 'step 10\'s own checks are done and its trial pull request, number 4, is open' } });
  const got = await run(['wait', '10'], { client: checked, ...timing });
  assert.deepEqual(JSON.parse(got.out), { step: 10, waited: true });
  assert.equal(clock, T0.getTime(), 'no time spent waiting');
  // Step 10 waiting for steps 7 and 8 is still a wait.
  const before = fakeClient({ status: { ok: true, lines: [] }, plan: { ok: true, wait: 5000, why: 'step 8 is still running', waitsFor: 8 } });
  const waiting = await run(['wait', '10'], { client: before, ...timing });
  assert.deepEqual(JSON.parse(waiting.out), { step: 10, waiting: 5000 });
});

const NOT_LISTENING = { ok: false, refused: 'the host helper could not be reached: is it running?', unsent: true };

test('a helper that is still starting on the first run is asked again, and the command then goes through', async () => {
  let asked = 0;
  const c = fakeClient({ status: () => { asked += 1; return asked < 4 ? NOT_LISTENING : { ok: true, lines: ['Setup has not started in this folder.'], next: 2 }; } });
  const pauses = [];
  const r = await run(['status'], { client: c, sleep: async (ms) => { pauses.push(ms); } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'Setup has not started in this folder.\n');
  assert.deepEqual(pauses, [HELPER_RETRY_MS, HELPER_RETRY_MS, HELPER_RETRY_MS]);
});

test('a helper that never answers is said to be starting, with what to do, after the retries', async () => {
  const c = fakeClient({ apply: NOT_LISTENING });
  let pauses = 0;
  const r = await run(['apply', '2', H], { client: c, sleep: async () => { pauses += 1; } });
  assert.equal(r.code, 1);
  assert.equal(pauses, HELPER_RETRIES);
  assert.equal(c.calls.length, HELPER_RETRIES + 1);
  assert.match(r.err, new RegExp(HELPER_NOT_UP.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(HELPER_NOT_UP, /run the same command again in a few seconds/);
  assert.match(HELPER_NOT_UP, /start a new session in this folder/);
});

test('a refusal, a sandbox\'s refusal or a helper that answered too slowly is not asked again', async () => {
  // The last is a connection dropped after the request went (no `unsent`): the helper may have acted on it.
  for (const refused of ['not expected', 'the host helper could not be reached: this command\'s sandbox kept it from the helper', 'the host helper did not answer in time', 'the host helper could not be reached: is it running?']) {
    const c = fakeClient({ apply: { ok: false, refused } });
    let pauses = 0;
    const r = await run(['apply', '2', H], { client: c, sleep: async () => { pauses += 1; } });
    assert.equal(r.code, 1);
    assert.equal(pauses, 0);
    assert.equal(c.calls.length, 1);
    assert.match(r.err, new RegExp(refused.slice(0, 20)));
  }
});
