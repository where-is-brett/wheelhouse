// tests/scripts/engine/archon/adapter.test.js
// The adapter with a stood-in command line: `cli` answers from recorded Archon output and keeps every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { archonAdapter, archonStreamer, bindingsFor, cursorKeeper } from '../../../../scripts/engine/archon/adapter.js';
import { normaliseAsk } from '../../../../scripts/engine/archon/asks.js';
import { checkEngine, checkEvent } from '../../../../scripts/engine/contract.js';

const FIXTURES = path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'archon');
const text = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const json = (name) => ({ code: 0, json: JSON.parse(text(name)), stdout: text(name), stderr: '' });
const refusal = (name) => ({ code: 1, json: JSON.parse(text(name)), stdout: text(name), stderr: '' });
const plain = (name, code = 0) => ({ code, json: null, stdout: text(name), stderr: '' });
const items = JSON.parse(text('attention-items.json'));
const RUN = '5f3a9c1e8b2d4f6a9e0c7b1d2a3f4e5c';
const now = () => '2026-10-29T09:00:00.000Z';
const packDir = path.join(path.sep, 'wh', 'engine', 'pack');
const configFile = path.join(path.sep, 'wh', 'engine', 'archon-config.yaml');

// A stand-in for archonCli: `answers` maps the first two arguments (or a function of all of them) to a result.
function fakeCli(answers) {
  const calls = [];
  const cli = async (args, options = {}) => {
    calls.push({ args, options });
    const answer = answers[args.slice(0, 2).join(' ')];
    const result = typeof answer === 'function' ? answer(args) : answer;
    return result ?? { code: 1, json: null, stdout: '', stderr: `no stand-in for ${args.join(' ')}` };
  };
  cli.calls = calls;
  return cli;
}

const adapter = (cli, extra = {}) => archonAdapter({ cli, packDir, configFile, now, ...extra });

test('the adapter has every method of the engine interface', () => {
  assert.deepEqual(checkEngine(adapter(fakeCli({}))), []);
});

test("start passes the pack, the config and the work's id, and never the order's words", async () => {
  const cli = fakeCli({ 'workflow run': json('run-detach.json') });
  const order = {
    work: 'card-14', lane: 'quick', branch: 'wh/card-14', project: '/Users/director/Projects/web',
    goal: 'Make the header a calmer blue', done: ['the header test passes'],
    bindings: { tiers: { large: 'model-large' }, aliases: { implementer: 'model-implementer' } },
  };
  const result = await adapter(cli).start(order);
  assert.deepEqual(result, { ok: true, runId: RUN, branch: 'wh/card-14' });
  const { args, options } = cli.calls[0];
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.deepEqual(args.slice(0, 3), ['workflow', 'run', 'wheelhouse-quick']);
  assert.ok(args.includes('--detach'));
  assert.equal(options.json, true);
  assert.equal(after('--workflow-source'), packDir);
  assert.equal(after('--config'), configFile);
  assert.equal(after('--branch'), 'wh/card-14');
  assert.equal(after('--cwd'), order.project);
  assert.equal(after('--input'), 'work=card-14');
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '--model'), ['large=model-large', '@implementer=model-implementer']);
  const said = JSON.stringify(cli.calls);
  assert.doesNotMatch(said, /calmer blue|header test/);
});

test("start for carry on runs again on the same branch, saying to carry on from what's there", async () => {
  const cli = fakeCli({ 'workflow run': json('run-detach.json') });
  const engine = adapter(cli);
  assert.equal((await engine.start({ work: 'card-14', lane: 'quick', branch: 'wh/card-14', carryOn: true })).ok, true);
  const { args } = cli.calls[0];
  assert.equal(args[3], "Carry on from what's there.");
  assert.equal(args[args.indexOf('--branch') + 1], 'wh/card-14');
  const refused = await engine.start({ work: 'card-14', lane: 'quick', carryOn: true });
  assert.equal(refused.ok, false);
  assert.match(refused.refused, /branch/);
  assert.equal(cli.calls.length, 1);
});

test('start refuses a lane it has no workflow for, and passes on a refusal in plain words', async () => {
  const cli = fakeCli({ 'workflow run': { code: 1, json: { ok: false, error: 'Workflow already active on this path' }, stdout: '', stderr: '' } });
  const engine = adapter(cli);
  assert.equal((await engine.start({ work: 'card-1', lane: 'party' })).ok, false);
  const refused = await engine.start({ work: 'card-1', lane: 'quick', branch: 'b' });
  assert.equal(refused.ok, false);
  assert.match(refused.refused, /didn't start/);
});

test('a second answer is refused, not applied', async () => {
  let answered = 0;
  const cli = fakeCli({ 'workflow answer': () => (answered++ === 0 ? json('answer-ok.json') : refusal('answer-stale.json')) });
  const engine = adapter(cli);
  const ask = normaliseAsk(items.pack, { now });
  const first = await engine.act(RUN, { answer: { ask: ask.id, choice: 'approve' } });
  assert.deepEqual(first, { ok: true });
  const { args, options } = cli.calls[0];
  assert.deepEqual(args, ['workflow', 'answer', RUN, '--occurrence', items.pack.occurrence, '--choose', 'approve']);
  assert.equal(options.json, true);
  const second = await engine.act(RUN, { answer: { ask: ask.id, choice: 'approve' } });
  assert.equal(second.ok, false);
  assert.match(second.refused, /already been answered/);
  assert.equal(cli.calls.length, 1, 'the second answer never reached the engine');
});

test('an answer the engine refuses as moved on is refused in plain words, with the words passed as text', async () => {
  const cli = fakeCli({ 'workflow answer': refusal('answer-stale.json') });
  const engine = adapter(cli);
  const id = `${RUN}:${items.pack.occurrence}`;
  const result = await engine.act(RUN, { answer: { ask: id, choice: 'reject', words: 'Make it darker' } });
  assert.equal(result.ok, false);
  assert.match(result.refused, /already answered or has moved on/);
  assert.doesNotMatch(result.refused, /occurrence|gate/);
  assert.deepEqual(cli.calls[0].args.slice(-4), ['--choose', 'reject', '--text', 'Make it darker']);
  assert.equal((await engine.act(RUN, { answer: { ask: `other:${items.pack.occurrence}`, choice: 'approve' } })).ok, false);
});

test('cancel goes through; resume after cancel is refused in plain words; nothing abandons a run', async () => {
  const cli = fakeCli({ 'workflow cancel': json('cancel-ok.json'), 'workflow resume': refusal('resume-cancelled.json') });
  const engine = adapter(cli);
  assert.deepEqual(await engine.act(RUN, { cancel: { reason: 'All stop' } }), { ok: true });
  assert.deepEqual(cli.calls[0].args, ['workflow', 'cancel', RUN]);
  const resumed = await engine.act(RUN, { resume: {} });
  assert.equal(resumed.ok, false);
  assert.match(resumed.refused, /cancelled run can't be resumed/);
  assert.deepEqual(cli.calls[1].args, ['workflow', 'resume', RUN, '--detach']);
  assert.ok(cli.calls.every((c) => !c.args.includes('abandon')));
});

test('inspect reads the run record', async () => {
  const cli = fakeCli({ 'workflow get': json('get-verbose.json') });
  const record = await adapter(cli).inspect(RUN);
  assert.deepEqual(cli.calls[0].args, ['workflow', 'get', RUN, '--verbose']);
  assert.equal(cli.calls[0].options.json, true);
  assert.equal(record.status, 'ended');
  assert.equal(record.ownerPid, 48213);
  const missing = await adapter(fakeCli({ 'workflow get': { code: 1, json: { ok: false, error: 'not found' }, stdout: '', stderr: '' } })).inspect('nope');
  assert.equal(missing.status, 'unknown');
});

test("watch reads the queue once, through normaliseAsk, and keeps the cursor it was given", async () => {
  const cli = fakeCli({ 'workflow attention': json('attention-list.json') });
  const { events, cursor } = await adapter(cli).watch('sql:99');
  assert.deepEqual(cli.calls[0].args, ['workflow', 'attention', '--all']);
  assert.equal(cursor, 'sql:99');
  assert.deepEqual(events.map((e) => e.kind), ['approval', 'question', 'usage-limit']);
  for (const e of events) assert.equal(checkEvent(e), null);
});

// A stand-in streamer: each call gives the next list of lines.
function fakeStreamer(...rounds) {
  const calls = [];
  const streamer = (args) => {
    calls.push(args);
    const lines = rounds.shift() ?? [];
    return (async function* lines$() { for (const line of lines) yield line; })();
  };
  streamer.calls = calls;
  return streamer;
}

test('follow reads the stream into events, and saves the cursor by the rule', async () => {
  const streamer = fakeStreamer(text('attention-watch.jsonl').trim().split('\n'));
  const log = [];
  const events = [];
  for await (const event of adapter(fakeCli({}), { streamer }).follow('sql:100', { onCursor: (c) => log.push(`cursor ${c}`) })) {
    log.push(`event ${event.type}`);
    events.push(event);
  }
  assert.deepEqual(streamer.calls[0], ['workflow', 'attention', '--watch', '--json', '--all', '--after', 'sql:100']);
  for (const e of events) assert.equal(checkEvent(e), null, JSON.stringify(e));
  assert.deepEqual(events.map((e) => e.type), ['ask', 'ask', 'ask-resolved', 'run-ended', 'ask', 'ask-resolved', 'run-ended', 'ask']);
  const pack = events[0];
  assert.equal(events[2].id, pack.id);
  assert.equal(events[3].outcome, 'completed');
  assert.equal(events[5].id, events[4].id, 'a resolved line with no occurrence closes the open ask of its run');
  assert.equal(events[6].outcome, 'failed');
  assert.equal(events[7].kind, 'trouble');
  assert.deepEqual(log.filter((l) => l.startsWith('cursor')), ['sql:120', 'sql:124', 'sql:131', 'sql:133', 'sql:140', 'sql:152', 'sql:160'].map((c) => `cursor ${c}`));
  // A cursor is saved only once every line at it has been handled.
  assert.ok(log.indexOf('cursor sql:160') > log.lastIndexOf('event run-ended'));
  assert.ok(log.indexOf('cursor sql:124') > log.indexOf('event ask', 1));
});

test("follow starts the stream again without a cursor when the engine doesn't know it", async () => {
  const streamer = fakeStreamer(['{"type":"error","error":"cursor_invalid"}'], ['{"type":"ready","cursor":"sql:7"}']);
  const saved = [];
  for await (const event of adapter(fakeCli({}), { streamer }).follow('sql:999', { onCursor: (c) => saved.push(c) })) assert.fail(`no event expected: ${event.type}`);
  assert.equal(streamer.calls.length, 2);
  assert.ok(!streamer.calls[1].includes('--after'));
  assert.deepEqual(saved, ['sql:7']);
});

test("archonStreamer gives a command's output line by line, and stops the command when the read ends", async () => {
  let signal;
  let given;
  const cli = async (args, options) => {
    signal = options.signal;
    given = options;
    options.onStdout('{"type":"ready",');
    options.onStdout('"cursor":"sql:1"}\n{"type":"bookmark","cursor":"sql:2"}\n{"type":"book');
    options.onStdout('mark","cursor":"sql:3"}');
    return { code: 0, json: null, stdout: '', stderr: '' };
  };
  const lines = [];
  for await (const line of archonStreamer({ cli })(['workflow', 'attention', '--watch'])) lines.push(JSON.parse(line).cursor);
  assert.deepEqual(lines, ['sql:1', 'sql:2', 'sql:3']);
  // Standard output alone is read, and the command keeps only a little of what it said, however long it runs.
  assert.equal(given.onOutput, undefined);
  assert.ok(Number.isFinite(given.limit) && given.limit <= 64 * 1024, `limit ${given.limit}`);
  const endless = (args, options) => {
    signal = options.signal;
    options.onStdout('{"type":"ready","cursor":"sql:1"}\n');
    return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ code: 0, stopped: true })));
  };
  for await (const line of archonStreamer({ cli: endless })(['x'])) { assert.ok(line); break; }
  assert.equal(signal.aborted, true);
});

test('cursorKeeper saves a bookmark at once, and any other line once a later cursor arrives', () => {
  const keeper = cursorKeeper();
  assert.equal(keeper.see({ type: 'attention', cursor: 'a' }), null);
  assert.equal(keeper.see({ type: 'resolved', cursor: 'b' }), 'a');
  assert.equal(keeper.see({ type: 'terminal', cursor: 'b' }), null);
  assert.equal(keeper.see({ type: 'bookmark', cursor: 'c' }), 'c');
  assert.equal(keeper.see({ type: 'attention', cursor: 'd' }), null);
});

const WORKTREES = '/Users/director/Projects/web/.worktrees';

test('stopAll cancels every running run, leaving child runs to their parent', async () => {
  const cli = fakeCli({ 'workflow status': json('status-all.json'), 'workflow cancel': json('cancel-ok.json') });
  const seen = [];
  const result = await adapter(cli, { worktreeBases: [WORKTREES] }).stopAll('All stop', { beforeCancel: async (runs) => { seen.push({ runs, calls: cli.calls.length }); } });
  assert.deepEqual(cli.calls[0].args, ['workflow', 'status', '--all']);
  assert.deepEqual(cli.calls.slice(1).map((c) => c.args), [['workflow', 'cancel', RUN]]);
  assert.deepEqual(result, { cancelled: [RUN], survivors: [], paused: ['0a1b2c3d4e5f60718293a4b5c6d7e8f9'] });
  // The running runs are handed over before the first cancel, so their process trees are taken whole.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].calls, 1);
  assert.deepEqual(seen[0].runs[0], { id: RUN, folder: '/Users/director/Projects/web/.worktrees/wh/card-14' });
});

const row = (id, status, working_path) => ({ id, workflow_name: 'wheelhouse-quick', status, parent_run_id: null, working_path });
const status = (...runs) => ({ code: 0, json: { runs }, stdout: '', stderr: '' });

test('stopAll cancels a pending run as it does a running one, and a refused cancel is a survivor', async () => {
  const cli = fakeCli({
    'workflow status': status(row('run-a', 'pending', null), row('run-b', 'running', null), row('run-c', 'pending', null)),
    'workflow cancel': (args) => (args[2] === 'run-c' ? refusal('resume-cancelled.json') : json('cancel-ok.json')),
  });
  let handed = null;
  const result = await adapter(cli).stopAll('All stop', { beforeCancel: (runs) => { handed = runs.map((r) => r.id); } });
  assert.deepEqual(handed, ['run-a', 'run-b', 'run-c']);
  assert.deepEqual(cli.calls.slice(1).map((c) => c.args[2]), ['run-a', 'run-b', 'run-c']);
  assert.deepEqual(result, { cancelled: ['run-a', 'run-b'], survivors: ['run-c'], paused: [] });
});

test("stopAll hands over only a run's worktree folder, never the project folder or anything broader", async () => {
  const home = path.join(path.sep, 'wh-engine-home');
  const cli = fakeCli({
    'workflow status': status(
      row('in-home', 'running', path.join(home, 'workspaces', 'o', 'web', 'worktrees', 'card-1')),
      row('home-base', 'running', path.join(home, 'workspaces', 'o', 'web', 'worktrees')),
      row('home-other', 'running', path.join(home, 'workspaces', 'o', 'web', 'logs')),
      row('in-project', 'running', `${WORKTREES}/wh/card-2`),
      row('project', 'running', '/Users/director/Projects/web'),
      row('base', 'running', WORKTREES),
      row('elsewhere', 'running', '/Users/director'),
    ),
    'workflow cancel': json('cancel-ok.json'),
  });
  let handed = null;
  await adapter(cli, { home, worktreeBases: [WORKTREES] }).stopAll('All stop', { beforeCancel: (runs) => { handed = runs; } });
  assert.deepEqual(Object.fromEntries(handed.map((r) => [r.id, r.folder])), {
    'in-home': path.join(home, 'workspaces', 'o', 'web', 'worktrees', 'card-1'), 'home-base': null, 'home-other': null,
    'in-project': `${WORKTREES}/wh/card-2`, project: null, base: null, elsewhere: null,
  });
});

test("ownsProcess knows the pinned Bun and the launcher under the engine's folder, and nothing else", () => {
  const engine = path.join(path.sep, 'wh-engine');
  const owns = archonAdapter({ engine }).ownsProcess;
  const bun = path.join(engine, 'bun', 'bin', 'bun');
  const launcher = path.join(engine, 'archon', 'bin', 'archon');
  assert.equal(owns(`${bun} --no-env-file ${engine}/archon/src/packages/cli/src/cli.ts workflow run wheelhouse-quick`), true);
  assert.equal(owns(`/bin/sh ${launcher} workflow wake --watch --json`), true);
  assert.equal(owns(`${launcher} workflow get x`), true);
  assert.equal(owns('/opt/homebrew/bin/bun archon workflow run'), false);
  assert.equal(owns(`${bun}x something`), false);
  assert.equal(owns('/Applications/Editor.app/Contents/MacOS/Editor'), false);
  assert.equal(owns(undefined), false);
});

test('wakeCommand is the continuation host, with archonEnv as its whole environment', () => {
  const engine = path.join(path.sep, 'wh-engine');
  const wake = archonAdapter({ engine }).wakeCommand();
  assert.equal(wake.command, path.join(engine, 'archon', 'bin', process.platform === 'win32' ? 'archon.exe' : 'archon'));
  assert.deepEqual(wake.args, ['workflow', 'wake', '--watch', '--json']);
  assert.equal(wake.env.ARCHON_TELEMETRY_DISABLED, '1');
  assert.equal(wake.env.WHEELHOUSE_ENGINE_RUN, '1');
  assert.equal(wake.env.GH_TOKEN, undefined);
});

const pins = { archon: { tag: 'v0.13.0' }, bun: { version: '1.4.3' } };
const healthyCli = (overrides = {}) => fakeCli({
  'version': plain('version.txt'),
  'telemetry status': plain('telemetry-off.txt'),
  'ai tier': json('tier-list.json'),
  ...overrides,
});
const bunRun = (stdout = '1.4.3\n') => async () => ({ code: 0, stdout, stderr: '' });

test('health passes with the pinned version, Bun, Claude and telemetry off', async () => {
  const result = await adapter(healthyCli(), { pins, run: bunRun() }).health();
  assert.deepEqual(result, { ok: true, findings: [] });
});

test('health fails closed when telemetry reports on', async () => {
  const on = await adapter(healthyCli({ 'telemetry status': plain('telemetry-on.txt') }), { pins, run: bunRun() }).health();
  assert.equal(on.ok, false);
  assert.match(on.findings.join(' '), /usage reporting is on/);
  const silent = await adapter(healthyCli({ 'telemetry status': { code: 1, json: null, stdout: '', stderr: 'boom' } }), { pins, run: bunRun() }).health();
  assert.equal(silent.ok, false);
  assert.match(silent.findings.join(' '), /usage reporting/);
});

test('health names a wrong version, a missing Bun and a missing Claude', async () => {
  const cli = healthyCli({
    'version': { code: 0, json: null, stdout: 'Archon CLI v0.14.0\n', stderr: '' },
    'ai tier': { code: 0, json: { defaultAssistant: 'codex', tiers: [] }, stdout: '', stderr: '' },
  });
  const result = await adapter(cli, { pins, run: async () => ({ code: 127, stdout: '', stderr: 'not found' }) }).health();
  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 3);
  assert.match(result.findings[0], /0\.14\.0.*v0\.13\.0/);
  assert.match(result.findings[1], /Bun/);
  assert.match(result.findings[2], /Claude/);
});

test('bindingsFor turns tiers and aliases into model bindings, and refuses a bad one', () => {
  assert.deepEqual(bindingsFor({ tiers: { large: 'model-large', small: 'model-small' }, aliases: { '@reviewer': 'model-review', implementer: 'large' } }),
    ['large=model-large', 'small=model-small', '@reviewer=model-review', '@implementer=large']);
  assert.deepEqual(bindingsFor(undefined), []);
  assert.throws(() => bindingsFor({ tiers: { huge: 'model-x' } }), /tier/);
  assert.throws(() => bindingsFor({ aliases: { implementer: 'two words' } }), /model/);
});
