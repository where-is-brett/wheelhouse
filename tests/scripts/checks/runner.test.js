// tests/scripts/checks/runner.test.js
// A check's life (spec 4.3): from a new head to its report, with the run stood in, so these hold on any system. What is
// reported rests on the signed record, and what can't run stops running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkRunner, CHECK_TRY_AGAIN as TRY_AGAIN, CHECK_LEAVE_IT as LEAVE_IT, KEEP_REPORTING } from '../../../scripts/checks/runner.js';
import { commandDigest } from '../../../scripts/checks/record.js';
import { checksStanding, keepQueue, readQueue } from '../../../scripts/checks/standing.js';
import { enrol, makeSigningKey } from '../../../scripts/state/signing.js';
import { tempFolder } from '../../helpers/homes.js';
import { RUN_CHECKS_HERE, LEAVE_THEM } from '../../../scripts/state/card-lines.js';
import { answerInput, composeCard, questionProblem } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';

const COMMAND = 'npm test';
const DIGEST = commandDigest(COMMAND);
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const NEXT = 'c'.repeat(40);

async function withHome(fn) {
  const home = path.join(tempFolder('wh-runner-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-31T00:00:00.000Z' });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

// One project: `w` holds what the host says, the records and everything that happened, in order.
function world({ word = () => 'passed', status = () => ({ ok: true }), ...given } = {}) {
  const w = {
    log: [], calls: [], posts: [], events: [], cards: [], reds: [], ran: [], answers: {}, stopped: false, ended: [], time: Date.parse('2026-10-31T01:00:00.000Z'),
    facts: { setting: null, host: 'github', contexts: [], hasWorkflows: false, main: MAIN, settings: { testCommand: COMMAND, prepare: null, minutes: 20, network: false }, digest: DIGEST },
    ...given,
  };
  const runner = checkRunner({
    project: 'p',
    repo: 'o/p',
    permissionLink: 'https://github.com/settings/installations/7',
    adapter: new Proxy({
      setStatus: async (post) => { w.log.push(`status ${post.state}`); w.posts.push(post); return status(post); },
      checkContexts: async (sha) => w.contextsOf?.(sha) ?? [],
    }, { get: (host, name) => { w.calls.push(name); return host[name]; } }),
    facts: async () => (w.factsThen ? w.factsThen() : w.facts),
    source: async () => '/mirror',
    results: () => w.events.map((e) => e.data),
    write: async ({ event }) => {
      if (w.refuseWrites) throw new Error('the record is damaged');
      w.log.push('record');
      w.events.push(event);
    },
    onRed: async (head, work, tail) => { w.log.push('red'); w.reds.push({ head, work, tail }); },
    card: async (data) => { w.log.push('card'); w.cards.push(data); },
    answerOf: (id) => w.answers[id] ?? null,
    ended: (work) => w.ended.includes(work),
    stopped: () => w.stopped,
    openHeads: async () => { if (w.openFails) throw new Error('unreachable'); return w.open ?? []; },
    now: () => new Date(w.time),
    run: async ({ commit, main, signal }) => {
      w.log.push('check');
      w.ran.push({ commit, main });
      if (w.hold) await w.hold(signal);
      const result = signal?.aborted ? 'could-not-run' : word(commit);
      return { commit, command: DIGEST, result, minutes: 1, tail: `${result} output`, ...(main ? { clean: true } : {}) };
    },
    turn: async (fn) => { if (w.stopBeforeTurn) w.stopped = true; return fn(); },
  });
  return { w, runner };
}

const settled = async (runner) => { await runner.tick(); await runner.idle(); };
const until = async (met) => { for (let i = 0; i < 500 && !met(); i += 1) await new Promise((resolve) => { setImmediate(resolve); }); };

test('a new head posts pending before the check starts', () => withHome(async () => {
  const { w, runner } = world();
  await runner.took(HEAD, 'w-1');
  assert.deepEqual(w.posts.map((p) => [p.sha, p.state]), [[HEAD, 'pending']]);
  assert.deepEqual(w.ran, []);
}));

test('a head nothing told the helper of is found on the host, and checked', () => withHome(async () => {
  const { w, runner } = world({ open: [{ head: HEAD, work: 'card-1' }] });
  await settled(runner);
  await settled(runner);
  assert.deepEqual(w.ran.map((r) => r.commit), [MAIN, HEAD]);
  assert.equal(w.posts.filter((p) => p.sha === HEAD && p.description === 'Checking on this computer').length, 2, 'once found, once started');
  w.open = [{ head: NEXT, work: 'card-1' }];
  await settled(runner);
  assert.equal(w.ran.at(-1).commit, NEXT, 'the work\'s newest head takes its place');
  w.openFails = true;
  await settled(runner);
}));

test('a head taken again keeps its result', () => withHome(async () => {
  const { w, runner } = world();
  await runner.took(HEAD, 'card-1');
  await settled(runner);
  await settled(runner);
  assert.equal(w.posts.filter((p) => p.sha === HEAD).at(-1).state, 'success');
  await runner.took(HEAD, 'card-1');
  await settled(runner);
  assert.equal(w.posts.filter((p) => p.sha === HEAD).at(-1).state, 'success');
  assert.equal(w.ran.filter((r) => r.commit === HEAD).length, 1);
}));

test('a red head reopened with nothing changed goes back again, and stays red', () => withHome(async () => {
  const { w, runner } = world({ word: (commit) => (commit === HEAD ? 'failed' : 'passed') });
  await runner.took(HEAD, 'card-1');
  await settled(runner);
  await settled(runner);
  assert.equal(w.reds.length, 1);
  await runner.took(HEAD, 'card-1');
  await settled(runner);
  assert.equal(w.reds.length, 2);
  assert.equal(w.posts.filter((p) => p.sha === HEAD).at(-1).state, 'failure');
  assert.equal(w.ran.filter((r) => r.commit === HEAD).length, 1);
}));

test('two open changes of one work don\'t take turns: the newest stays, reported once', () => withHome(async () => {
  const { w, runner } = world({ open: [{ head: NEXT, work: 'card-1' }, { head: HEAD, work: 'card-1' }] });
  await settled(runner);
  await settled(runner);
  await settled(runner);
  await settled(runner);
  assert.deepEqual(w.ran.map((r) => r.commit), [MAIN, HEAD]);
  assert.equal(w.posts.filter((p) => p.sha === HEAD).at(-1).state, 'success');
  assert.equal(w.posts.filter((p) => p.sha === NEXT).length, 1);
}));

test('an ended work\'s open change isn\'t taken', () => withHome(async () => {
  const { w, runner } = world({ open: [{ head: HEAD, work: 'card-1' }], ended: ['card-1'] });
  await settled(runner);
  assert.deepEqual(w.posts.filter((p) => p.sha === HEAD), []);
}));

test('All stop while the tick reads the host starts no check', () => withHome(async () => {
  const { w, runner } = world();
  const read = w.facts;
  w.factsThen = () => { w.stopped = true; return read; };
  await settled(runner);
  assert.deepEqual(w.ran, []);
  assert.deepEqual(w.posts, []);
}));

test('All stop on the way to its turn starts no check', () => withHome(async () => {
  const { w, runner } = world();
  w.stopBeforeTurn = true;
  await settled(runner);
  assert.deepEqual(w.ran, []);
}));

test('a red that lands during All stop still goes back, and its report waits', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'failed' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'card-1');
  w.hold = async () => { w.stopped = true; };
  await settled(runner);
  assert.equal(w.reds.length, 1);
  assert.equal(w.posts.filter((p) => p.state === 'failure').length, 0);
  w.stopped = false;
  w.hold = null;
  await settled(runner);
  assert.equal(w.posts.filter((p) => p.state === 'failure').length, 1);
  assert.equal(w.reds.length, 1);
}));

test('the signed record is written before the status', () => withHome(async () => {
  const { w, runner } = world();
  await runner.took(HEAD, 'w-1');
  w.log.length = 0;
  await settled(runner);
  await settled(runner);
  const head = w.log.slice(w.log.lastIndexOf('check'));
  assert.deepEqual(head.slice(0, 3), ['check', 'record', 'status success']);
}));

test('what is reported comes from the signed record, not the run\'s answer', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'failed' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  assert.deepEqual(w.posts.at(-1), { sha: HEAD, state: 'failure', description: 'The tests failed on this computer' });
}));

test('a refused status keeps the result and tries again', () => withHome(async () => {
  let refuse = true;
  const { w, runner } = world({ status: () => (refuse ? { refused: 'GitHub did not take the report' } : { ok: true }) });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  assert.equal(w.events.length, 1);
  refuse = false;
  await settled(runner);
  assert.equal(w.events.length, 1, 'no second check');
  assert.equal(w.posts.at(-1).state, 'success');
  w.posts.length = 0;
  await settled(runner);
  assert.deepEqual(w.posts, [], 'nothing left to post');
}));

test('a status that throws is tried again the same way', () => withHome(async () => {
  let fail = true;
  const { w, runner } = world({ status: () => { if (fail) throw new Error('no network'); return { ok: true }; } });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  fail = false;
  await settled(runner);
  assert.equal(w.posts.at(-1).state, 'success');
}));

test('permission raises one card', () => withHome(async () => {
  const { w, runner } = world({ status: () => ({ refused: 'permission' }) });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  await settled(runner);
  assert.equal(w.cards.length, 1);
  assert.match(w.cards[0].what, /settings\/installations\/7/);
  assert.equal(w.cards[0].level, 3);
  assert.doesNotMatch(JSON.stringify(w.cards[0]), /commit status/i);
  assert.equal(checksStanding('p', { now: new Date(w.time) }).waitingForPermission, true);
}));

test('the permission card goes once a status posts', () => withHome(async () => {
  let refuse = true;
  const { w, runner } = world({ status: () => (refuse ? { refused: 'permission' } : { ok: true }) });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  refuse = false;
  await settled(runner);
  assert.equal(checksStanding('p', { now: new Date(w.time) }).waitingForPermission, false);
}));

test('the main line\'s head with no result gets a check', () => withHome(async () => {
  const { w, runner } = world();
  await settled(runner);
  assert.deepEqual(w.ran, [{ commit: MAIN, main: true }]);
  assert.deepEqual(w.posts.map((p) => [p.sha, p.state]), [[MAIN, 'pending'], [MAIN, 'success']]);
  assert.equal(w.events[0].data.clean, true);
}));

test('a head\'s pass doesn\'t stand in for the main line once it lands there', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  assert.equal(w.events[0].data.clean, undefined);
  w.facts = { ...w.facts, main: HEAD };
  await settled(runner);
  assert.deepEqual(w.ran.at(-1), { commit: HEAD, main: true });
}));

test('a project whose checks run on the host starts nothing and posts nothing', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, hasWorkflows: true };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  assert.deepEqual([w.posts, w.ran, w.events], [[], [], []]);
}));

test('with no test command nothing runs', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, settings: { ...w.facts.settings, testCommand: null }, digest: null };
  await settled(runner);
  assert.deepEqual(w.ran, []);
}));

test('one check at a time: a tick during a run starts nothing', () => withHome(async () => {
  let release;
  const { w, runner } = world({ hold: () => new Promise((resolve) => { release = resolve; }) });
  await runner.took(HEAD, 'w-1');
  await runner.tick();
  await until(() => w.ran.length === 1);
  await runner.tick();
  assert.equal(w.ran.length, 1);
  release();
  await runner.idle();
}));

test('a stopped check is could-not-run and runs after All stop lifts', () => withHome(async () => {
  const { w, runner } = world({ hold: (signal) => new Promise((resolve) => { signal.addEventListener('abort', resolve, { once: true }); }) });
  await runner.tick();
  await until(() => w.ran.length === 1);
  assert.equal(w.ran.length, 1);
  w.stopped = true;
  await runner.stop();
  assert.equal(w.events[0].data.result, 'could-not-run');
  w.posts.length = 0;
  await settled(runner);
  assert.equal(w.ran.length, 1, 'nothing runs under All stop');
  assert.deepEqual(w.posts, [], 'nothing is reported under All stop');
  assert.equal(w.cards.length, 0, 'All stop is no fault');
  w.stopped = false;
  w.hold = null;
  await settled(runner);
  assert.equal(w.ran.length, 2);
  assert.equal(w.events.at(-1).data.result, 'passed');
}));

test('a record that can\'t be written counts as a try, so it can\'t loop', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  w.refuseWrites = true;
  for (let i = 0; i < 4; i += 1) await settled(runner);
  assert.equal(w.ran.length, 2);
  assert.equal(w.cards.length, 1);
}));

test('a head whose work ended is dropped', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'could-not-run' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  w.ended = ['w-1'];
  await settled(runner);
  assert.deepEqual(w.ran, []);
}));

test('a newer head of the same work takes the old one\'s place', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await runner.took(NEXT, 'w-1');
  await settled(runner);
  await settled(runner);
  assert.deepEqual(w.ran.map((r) => r.commit), [NEXT]);
}));

test('a head changed under an old command is due again and reported pending first', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  const other = commandDigest('npm run test:all');
  w.facts = { ...w.facts, settings: { ...w.facts.settings, testCommand: 'npm run test:all' }, digest: other };
  w.posts.length = 0;
  await runner.tick();
  assert.equal(w.posts[0].state, 'pending');
  await runner.idle();
  assert.equal(w.ran.length, 2);
}));

test('a failed head goes back with its tail, once for each result', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'failed' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  await settled(runner);
  assert.deepEqual(w.reds, [{ head: HEAD, work: 'w-1', tail: 'failed output' }]);
}));

test('a head out of time is red as well', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'timed-out' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  assert.equal(w.posts.at(-1).state, 'failure');
  assert.equal(w.reds.length, 1);
}));

test('a red main line sends nothing back: the host\'s red holds the queue', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'failed' });
  await settled(runner);
  assert.equal(w.posts.at(-1).state, 'failure');
  assert.deepEqual(w.reds, []);
}));

test('could-not-run raises no red, and stays pending', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'could-not-run' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  assert.deepEqual(w.reds, []);
  assert.equal(w.posts.at(-1).state, 'pending');
}));

test('could-not-run twice raises one card, and the head stops running', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'could-not-run' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  for (let i = 0; i < 6; i += 1) await settled(runner);
  assert.equal(w.ran.length, 2, 'a head that keeps failing doesn\'t keep running');
  assert.equal(w.cards.length, 1);
  assert.deepEqual(w.cards[0].options.map((o) => o.label), [TRY_AGAIN, LEAVE_IT]);
  assert.equal(w.events.length, 2, 'nor keeps adding to the record');
}));

test('Try again on that card runs it once more, and a pass ends it', () => withHome(async () => {
  let word = 'could-not-run';
  const { w, runner } = world({ word: () => word });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  await settled(runner);
  word = 'passed';
  w.answers[w.cards[0].id] = TRY_AGAIN;
  await settled(runner);
  assert.equal(w.ran.length, 3);
  assert.equal(w.posts.at(-1).state, 'success');
}));

test('Leave it keeps the head where it is', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'could-not-run' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  await settled(runner);
  await settled(runner);
  w.answers[w.cards[0].id] = LEAVE_IT;
  await settled(runner);
  assert.equal(w.ran.length, 2);
}));

test('a new head gets its own tries, under the one card', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'could-not-run' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  for (let i = 0; i < 3; i += 1) await settled(runner);
  await runner.took(NEXT, 'w-2');
  for (let i = 0; i < 3; i += 1) await settled(runner);
  assert.deepEqual(w.ran.map((r) => r.commit), [HEAD, HEAD, NEXT, NEXT]);
  assert.equal(w.cards.length, 1);
}));

test('a changed command gives a held head its tries back', () => withHome(async () => {
  const { w, runner } = world({ word: () => 'could-not-run' });
  w.facts = { ...w.facts, main: null };
  await runner.took(HEAD, 'w-1');
  for (let i = 0; i < 3; i += 1) await settled(runner);
  w.facts = { ...w.facts, digest: commandDigest('npm run other'), settings: { ...w.facts.settings, testCommand: 'npm run other' } };
  await settled(runner);
  assert.equal(w.ran.length, 3);
}));

test('the pane\'s standing says while a check runs, and an old mark doesn\'t count', () => withHome(async () => {
  let release;
  const { w, runner } = world({ hold: () => new Promise((resolve) => { release = resolve; }) });
  await runner.tick();
  await until(() => w.ran.length === 1);
  assert.equal(checksStanding('p', { now: new Date(w.time) }).checking, true);
  assert.equal(checksStanding('p', { now: new Date(w.time + 24 * 60 * 60 * 1000) }).checking, false, 'a helper that went away leaves no check running');
  release();
  await runner.idle();
  assert.equal(checksStanding('p', { now: new Date(w.time) }).checking, false);
}));

// The host's checks that never report.
const stuck = [{ name: 'build', state: 'queued', startedAt: null, app: 'github-actions' }];
const MINUTE = 60000;

async function brokenCi() {
  const got = world();
  got.w.facts = { ...got.w.facts, hasWorkflows: true, contexts: stuck };
  got.w.contextsOf = () => stuck;
  await got.runner.took(HEAD, 'w-1');
  await got.runner.tick();
  got.w.time += 31 * MINUTE;
  await got.runner.tick();
  await got.runner.took(NEXT, 'w-2');
  await got.runner.tick();
  got.w.time += 31 * MINUTE;
  await got.runner.tick();
  return got;
}

test('the broken-CI card says the checks aren\'t running, and no word of billing', () => withHome(async () => {
  const { w, runner } = await brokenCi();
  await runner.tick();
  assert.equal(w.cards.length, 1, 'one card');
  const [card] = w.cards;
  assert.equal(card.level, 3);
  assert.deepEqual(card.options.map((o) => o.label), [RUN_CHECKS_HERE, LEAVE_THEM]);
  assert.equal(card.recommendation, RUN_CHECKS_HERE);
  assert.match(card.what, /aren't running/);
  assert.match(JSON.stringify(card), /github\.com\/o\/p\/settings\/actions/);
  assert.doesNotMatch(JSON.stringify(card), /bill|minutes|money|pay|spend/i);
}));

test('the card\'s press changes nothing on the host', () => withHome(async () => {
  const { w, runner } = await brokenCi();
  w.answers[w.cards[0].id] = RUN_CHECKS_HERE;
  await settled(runner);
  assert.deepEqual(w.calls.filter((name) => name !== 'setStatus' && name !== 'checkContexts'), [], 'only the project\'s own reports reach the host');
}));

test('Wheelhouse carries on once the host\'s checks stop', () => withHome(async () => {
  const { w, runner } = await brokenCi();
  w.answers[w.cards[0].id] = RUN_CHECKS_HERE;
  // The workflows stay in the project with the host's switch off, and old heads keep their dead checks.
  await settled(runner);
  assert.deepEqual(w.ran[0], { commit: MAIN, main: true });
  assert.equal(w.posts.at(-1).state, 'success');
}));

test('Leave them keeps waiting', () => withHome(async () => {
  const { w, runner } = await brokenCi();
  w.answers[w.cards[0].id] = LEAVE_THEM;
  await settled(runner);
  assert.deepEqual([w.ran, w.posts], [[], []]);
  assert.equal(w.cards.length, 1);
}));

test('a real job on the main line after the press takes the checks back to the host', () => withHome(async () => {
  const { w, runner } = await brokenCi();
  w.answers[w.cards[0].id] = RUN_CHECKS_HERE;
  w.facts = { ...w.facts, contexts: [{ name: 'build', state: 'running', startedAt: '2026-10-31T03:00:00Z', app: 'github-actions' }] };
  await settled(runner);
  assert.deepEqual(w.ran, []);
}));

// A card from the runner as the front desk asks it: the real composer, and the real check of the words.
function asAsked(card) {
  assert.equal(questionProblem(card), null);
  const composed = composeCard(answerInput(card, 'the checks'));
  assert.deepEqual(cardProblems(composed.question), []);
}

// --- a project protected with our check that later adds a workflow ---

const withWorkflow = (more) => ({ hasWorkflows: true, contexts: [{ name: 'ci', state: 'success', startedAt: 'x' }], ...more });

test('a project whose rules name our check keeps reporting after it adds a workflow', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, ...withWorkflow({ required: ['wheelhouse/checks'] }) };
  await runner.took(HEAD, 'w');
  await runner.tick();
  await runner.idle();
  assert.ok(w.posts.some((p) => p.state === 'pending'));
  assert.ok(w.ran.some((r) => r.commit === MAIN));
  assert.equal(w.cards.length, 0);
}));

test('a project whose rules can\'t be read by anyone gets one card, with no merge stopped silently', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, ...withWorkflow({ required: null }) };
  for (let i = 0; i < 8; i += 1) await runner.tick();
  assert.equal(w.cards.length, 1);
  const [card] = w.cards;
  assert.equal(card.level, 3);
  assert.equal(card.recommendation, KEEP_REPORTING);
  assert.equal(card.options[0].label, KEEP_REPORTING);
  assert.doesNotMatch(`${card.what} ${card.why} ${card.options.map((o) => o.says).join(' ')}`, /commit status|bare repository|\bremote\b|\bforge\b/i);
  asAsked(card);
  assert.equal(w.ran.length, 0);
  w.answers[card.id] = KEEP_REPORTING;
  await runner.tick();
  await runner.idle();
  assert.ok(w.ran.some((r) => r.commit === MAIN));
}));

test('one unreadable look raises nothing, and a read that comes back clears the count', () => withHome(async () => {
  const { w, runner } = world();
  w.facts = { ...w.facts, ...withWorkflow({ required: null }) };
  await runner.tick();
  await runner.tick();
  w.facts = { ...w.facts, required: ['ci'] };
  await runner.tick();
  w.facts = { ...w.facts, required: null };
  await runner.tick();
  await runner.tick();
  assert.equal(w.cards.length, 0);
}));

test('setup\'s record answers for a host that can\'t be read', () => withHome(async () => {
  keepQueue('p', { ...readQueue('p'), required: ['wheelhouse/checks'] });
  const { w, runner } = world();
  w.facts = { ...w.facts, ...withWorkflow({ required: null }) };
  await runner.tick();
  await runner.idle();
  assert.equal(w.cards.length, 0);
  assert.ok(w.ran.some((r) => r.commit === MAIN));
}));
