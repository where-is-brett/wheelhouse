// tests/scripts/engine/archon/adapter.test.js
// The adapter with a stood-in command line: `cli` answers from recorded Archon output and keeps every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { archonAdapter, archonStreamer, bindingsFor, cursorKeeper } from '../../../../scripts/engine/archon/adapter.js';
import { CANCEL_PATCH_MARK, enginePaths, launcherText } from '../../../../scripts/engine/archon/build.js';
import { tempFolder } from '../../../helpers/homes.js';
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
  // Started outside the project, so Bun reads nothing of the project's (a bunfig.toml's preload); --cwd names it.
  assert.equal(options.cwd, undefined);
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
  // The worktree the run works in, so a run the engine won't stop can be ended by its processes; null outside one.
  assert.equal(record.folder, null);
  const inBase = await adapter(fakeCli({ 'workflow get': json('get-verbose.json') }), { worktreeBases: ['/Users/director/Projects/web/.worktrees'] }).inspect(RUN);
  assert.equal(inBase.folder, '/Users/director/Projects/web/.worktrees/wh/card-14');
  const missing = await adapter(fakeCli({ 'workflow get': { code: 1, json: { ok: false, error: 'not found' }, stdout: '', stderr: '' } })).inspect('nope');
  assert.equal(missing.status, 'unknown');
  assert.equal(missing.folder, null);
});

test('outputs reads each step\'s whole output from the run\'s events', async () => {
  const cli = fakeCli({ 'workflow get': json('get-events.json') });
  const outputs = await adapter(cli).outputs(RUN);
  assert.deepEqual(cli.calls[0].args, ['workflow', 'get', RUN, '--verbose', '--events']);
  assert.equal(JSON.parse(outputs['review-spec']).verdict, 'CLEAN');
  assert.deepEqual(await adapter(fakeCli({ 'workflow get': { code: 1, json: { ok: false }, stdout: '', stderr: '' } })).outputs('nope'), {});
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

test('stopAll cancels every run, a paused one too, leaving child runs to their parent', async () => {
  const cli = fakeCli({ 'workflow status': json('status-all.json'), 'workflow cancel': json('cancel-ok.json') });
  const seen = [];
  const result = await adapter(cli, { worktreeBases: [WORKTREES] }).stopAll('All stop', { beforeCancel: async (runs) => { seen.push({ runs, calls: cli.calls.length }); } });
  assert.deepEqual(cli.calls[0].args, ['workflow', 'status', '--all']);
  assert.deepEqual(cli.calls.slice(1).map((c) => c.args), [['workflow', 'cancel', RUN], ['workflow', 'cancel', '0a1b2c3d4e5f60718293a4b5c6d7e8f9']]);
  assert.deepEqual(result, { cancelled: [RUN, '0a1b2c3d4e5f60718293a4b5c6d7e8f9'], survivors: [], paused: [] });
  // The runs are handed over before the first cancel, so their process trees are taken whole.
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

test('a paused run an engine built without the patch refuses stays listed as paused, never a survivor', async () => {
  const refused = { code: 1, json: { ok: false, error: "Cannot cancel run with status 'paused'. Only a running run has live work to stop; abandon a paused or failed run instead." }, stdout: '', stderr: '' };
  const cli = fakeCli({ 'workflow status': status(row('run-a', 'running', null), row('run-b', 'paused', null)), 'workflow cancel': (args) => (args[2] === 'run-b' ? refused : json('cancel-ok.json')) });
  assert.deepEqual(await adapter(cli).stopAll('All stop'), { cancelled: ['run-a'], survivors: [], paused: ['run-b'] });
});

test('stopAll reads each run the helper knows that the list left out, and cancels one just started', async () => {
  const got = { 'run-new': 'pending', 'run-going': 'running', 'run-waits': 'paused', 'run-done': 'completed' };
  const cli = fakeCli({
    // A run started under about a second ago isn't listed yet.
    'workflow status': status(row('run-listed', 'running', null)),
    'workflow get': (args) => (got[args[2]] ? { code: 0, json: { id: args[2], status: got[args[2]], parent_run_id: null, working_path: `${WORKTREES}/wh/${args[2]}` }, stdout: '', stderr: '' } : { code: 1, json: { ok: false, error: 'not found' }, stdout: '', stderr: '' }),
    'workflow cancel': json('cancel-ok.json'),
  });
  let handed = null;
  const result = await adapter(cli, { worktreeBases: [WORKTREES] }).stopAll('All stop', {
    known: ['run-listed', 'run-new', 'run-going', 'run-waits', 'run-done', 'run-gone'],
    beforeCancel: (runs) => { handed = runs; },
  });
  // A listed run isn't read again.
  assert.deepEqual(cli.calls.filter((c) => c.args[1] === 'get').map((c) => c.args[2]), ['run-new', 'run-going', 'run-waits', 'run-done', 'run-gone']);
  assert.deepEqual(handed.map((r) => r.id), ['run-listed', 'run-new', 'run-going', 'run-waits']);
  assert.equal(handed[1].folder, `${WORKTREES}/wh/run-new`);
  assert.deepEqual(result, { cancelled: ['run-listed', 'run-new', 'run-going', 'run-waits'], survivors: [], paused: [] });
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

// An engine folder as the build leaves it: the source launcher, and the provider with Wheelhouse's patch in it.
// The broker's launcher as setup writes it: this Node.js and the broker's script in this checkout.
const SOUND_BROKER = `#!/bin/sh\nexec '${process.execPath}' '${path.resolve('scripts', 'engine', 'broker', 'gh.js')}' "$@"\n`;
function builtEngine({ launcher, provider = "permissionMode: process.env.ARCHON_CLAUDE_PERMISSION_MODE === 'acceptEdits'", cancelOperation = CANCEL_PATCH_MARK, broker = SOUND_BROKER } = {}) {
  const engine = tempFolder('wh-archon-health-');
  const p = enginePaths(engine);
  if (broker !== null) {
    fs.mkdirSync(path.join(engine, 'broker', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(engine, 'broker', 'bin', 'gh'), broker);
  }
  fs.mkdirSync(path.dirname(p.launcher), { recursive: true });
  fs.writeFileSync(p.launcher, launcher ?? launcherText(engine));
  const file = path.join(p.src, 'packages', 'providers', 'src', 'claude', 'provider.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (provider !== null) fs.writeFileSync(file, provider);
  if (cancelOperation !== null) {
    fs.mkdirSync(path.dirname(p.cancelOperation), { recursive: true });
    fs.writeFileSync(p.cancelOperation, cancelOperation);
  }
  return engine;
}

test('health passes with the pinned version, Bun, Claude, the patch and telemetry off', async () => {
  const result = await adapter(healthyCli(), { pins, run: bunRun(), engine: builtEngine() }).health();
  assert.deepEqual(result, { ok: true, findings: [] });
});

test('health fails closed on an engine built before the patch for paused runs', async () => {
  const stale = await adapter(healthyCli(), { pins, run: bunRun(), engine: builtEngine({ cancelOperation: 'if (run.status !== "running")' }) }).health();
  assert.equal(stale.ok, false);
  assert.match(stale.findings.join(' '), /built before Wheelhouse's patch for paused runs/);
});

test("health fails closed on an engine that isn't the patched source build", async () => {
  const unpatched = await adapter(healthyCli(), { pins, run: bunRun(), engine: builtEngine({ provider: 'permissionMode: "bypassPermissions"' }) }).health();
  assert.equal(unpatched.ok, false);
  assert.match(unpatched.findings.join(' '), /patch.*sandbox|sandbox.*patch/);
  const release = await adapter(healthyCli(), { pins, run: bunRun(), engine: builtEngine({ launcher: '\x7fELF release binary' }) }).health();
  assert.equal(release.ok, false);
  assert.match(release.findings.join(' '), /sandbox/);
  const nothing = await adapter(healthyCli(), { pins, run: bunRun(), engine: tempFolder('wh-archon-health-') }).health();
  assert.equal(nothing.ok, false);
});

test("health fails closed when the broker's launcher names a Node.js or a Wheelhouse that is gone, as after an update", async () => {
  const gone = path.join(tempFolder('wh-gone-'), 'plugins', 'cache', 'wheelhouse', '0.1.2', 'scripts', 'engine', 'broker', 'gh.js');
  for (const broker of [
    `#!/bin/sh\nexec '${process.execPath}' '${gone}' "$@"\n`,
    `#!/bin/sh\nexec '/usr/local/Cellar/node/20.0.0/bin/node-gone' '${path.resolve('scripts', 'engine', 'broker', 'gh.js')}' "$@"\n`,
    'not a launcher',
    null,
  ]) {
    const got = await adapter(healthyCli(), { pins, run: bunRun(), engine: builtEngine({ broker }) }).health();
    assert.equal(got.ok, false, String(broker));
    assert.match(got.findings.join(' '), /broker/);
    assert.match(got.findings.join(' '), /setup/);
  }
});

test("start refuses while the broker's launcher names a program that is gone, so no step runs without the broker", async () => {
  const gone = `#!/bin/sh\nexec '${process.execPath}' '/nowhere/wheelhouse/0.1.2/scripts/engine/broker/gh.js' "$@"\n`;
  const cli = healthyCli();
  const got = await adapter(cli, { pins, run: bunRun(), engine: builtEngine({ broker: gone }) }).start({ work: 'w', lane: 'quick' });
  assert.equal(got.ok, false);
  assert.match(got.refused, /broker/);
});

test('health fails closed when telemetry reports on', async () => {
  const engine = builtEngine();
  const on = await adapter(healthyCli({ 'telemetry status': plain('telemetry-on.txt') }), { pins, run: bunRun(), engine }).health();
  assert.equal(on.ok, false);
  assert.match(on.findings.join(' '), /usage reporting is on/);
  const silent = await adapter(healthyCli({ 'telemetry status': { code: 1, json: null, stdout: '', stderr: 'boom' } }), { pins, run: bunRun(), engine }).health();
  assert.equal(silent.ok, false);
  assert.match(silent.findings.join(' '), /usage reporting/);
});

test('health names a wrong version, a missing Bun and a missing Claude', async () => {
  const cli = healthyCli({
    'version': { code: 0, json: null, stdout: 'Archon CLI v0.14.0\n', stderr: '' },
    'ai tier': { code: 0, json: { defaultAssistant: 'codex', tiers: [] }, stdout: '', stderr: '' },
  });
  const result = await adapter(cli, { pins, run: async () => ({ code: 127, stdout: '', stderr: 'not found' }), engine: builtEngine() }).health();
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

test('handOver writes the pull request\'s ready work item over the revision there', async () => {
  const cli = fakeCli({ 'state get': { code: 0, json: { revision: 3 }, stdout: '', stderr: '' }, 'state put': { code: 0, json: { ok: true }, stdout: '', stderr: '' } });
  const done = await adapter(cli).handOver({ project: '/p', repo: 'acme/web', pr: 14, url: 'https://github.com/acme/web/pull/14', runId: RUN, at: '2026-10-30T00:00:00.000Z' });
  assert.deepEqual(done, { ok: true });
  assert.deepEqual(cli.calls[1].args, ['state', 'put', 'work/14', '--if-revision', '3']);
  assert.equal(cli.calls[1].options.cwd, '/p');
  const item = JSON.parse(cli.calls[1].options.input);
  assert.equal(item.facts.build.status, 'ready');
  assert.deepEqual(item.subject, { repo: { host: 'github.com', path: 'acme/web' }, number: 14 }, 'the queue passes over a repository given by name alone (check 90)');
  assert.equal((await adapter(cli).handOver({ project: '/p' })).ok, false);
});

test('artefactsOf is the run\'s own artefacts folder in the engine\'s home, and nothing for a name that isn\'t one', () => {
  const home = '/engine/home';
  const a = adapter(fakeCli({}), { home });
  // Archon names a project's workspace after its remote, which is the fetch mirror <engine>/mirrors/<owner>__<name>.git
  // (seen in check 80), so its runs' artefacts are under workspaces/mirrors/<owner>__<name>/.
  assert.equal(a.artefactsOf(RUN, 'acme/web'), path.join(home, 'workspaces', 'mirrors', 'acme__web', 'artifacts', 'runs', RUN));
  assert.equal(a.artefactsOf(RUN, 'shop'), path.join(home, 'workspaces', 'mirrors', 'shop', 'artifacts', 'runs', RUN), 'a project in git alone is named after its own mirror');
  assert.equal(a.artefactsOf(RUN, 'acme/web', { folder: '/engine/readers/ab12' }), path.join(home, 'workspaces', '_folder', 'ab12', 'artifacts', 'runs', RUN), 'a reader\'s folder is a folder project of its own');
  for (const [runId, repo] of [['../x', 'acme/web'], [RUN, '../web'], [RUN, 'acme/web/x'], [RUN, null], ['', 'acme/web']]) {
    assert.equal(a.artefactsOf(runId, repo), null, `${runId} ${repo}`);
  }
});

test('an answer Archon gave no reply to is unreachable, so it is tried again; one it refused is not', async () => {
  const id = `${RUN}:${items.pack.occurrence}`;
  const silent = adapter(fakeCli({ 'workflow answer': () => ({ code: 1, json: null, stdout: '', stderr: 'timed out' }) }));
  const lost = await silent.act(RUN, { answer: { ask: id, choice: 'approve' } });
  assert.equal(lost.ok, false);
  assert.equal(lost.unreachable, true);
  const stale = await adapter(fakeCli({ 'workflow answer': refusal('answer-stale.json') })).act(RUN, { answer: { ask: id, choice: 'approve' } });
  assert.equal(stale.unreachable, undefined);
});

test('a run whose models are all on Copilot starts the workflow\'s Copilot twin, and a run that mixes providers is refused', async () => {
  const cli = fakeCli({ 'workflow run': json('run-detach.json') });
  const engine = adapter(cli, { copilotProblem: () => null });
  const all = { tiers: { small: 'copilot/auto', medium: 'copilot/auto', large: 'copilot/auto' } };
  assert.equal((await engine.start({ work: 'card-14', lane: 'small', branch: 'b', bindings: all })).ok, true);
  assert.deepEqual(cli.calls[0].args.slice(0, 3), ['workflow', 'run', 'wheelhouse-small-copilot']);
  assert.equal((await engine.start({ work: 'card-14', lane: 'quick', branch: 'b' })).ok, true);
  assert.deepEqual(cli.calls[1].args.slice(0, 3), ['workflow', 'run', 'wheelhouse-quick'], 'no bindings, the Claude form');
  const mixed = await engine.start({ work: 'card-14', lane: 'quick', branch: 'b', bindings: { tiers: { small: 'copilot/auto', medium: 'claude-model', large: 'copilot/auto' } } });
  assert.equal(mixed.ok, false);
  assert.match(mixed.refused, /one provider/);
  // A Copilot run binds every tier: an unbound one would fall back to Claude's own model.
  const part = await engine.start({ work: 'card-14', lane: 'quick', branch: 'b', bindings: { tiers: { medium: 'copilot/auto' } } });
  assert.equal(part.ok, false);
  assert.match(part.refused, /every tier/);
  assert.equal(cli.calls.length, 2);
  // The merge queue is Archon's own workflow, with no twin, and is told the repository it merges in (check 81).
  assert.equal((await engine.start({ lane: 'merge', bindings: all, repo: { host: 'github.com', path: 'o/p' } })).ok, true);
  assert.deepEqual(cli.calls[2].args.slice(0, 3), ['workflow', 'run', 'archon-merge-queue']);
  const inputs = cli.calls[2].args.flatMap((a, i, all) => (a === '--input' ? [all[i + 1]] : []));
  assert.deepEqual(inputs, ['repo_host=github.com', 'repo_path=o/p']);
  assert.equal(cli.calls[2].args.includes('--project'), false, 'started in no folder of its own, it binds no project');
  // Started in Wheelhouse's own checkout, it is bound to the project the runs registered, named after its fetch mirror.
  assert.equal((await engine.start({ lane: 'merge', project: '/engine/queues/o__p', repo: { host: 'github.com', path: 'o/p' } })).ok, true);
  const bound = cli.calls[3].args;
  assert.equal(bound[bound.indexOf('--cwd') + 1], '/engine/queues/o__p');
  assert.equal(bound[bound.indexOf('--project') + 1], 'mirrors/o__p');
  // With no repository, its first step would fail every time: nothing starts.
  const bare = await engine.start({ lane: 'merge' });
  assert.equal(bare.ok, false);
  assert.match(bare.refused, /repository/);
  assert.equal(cli.calls.length, 4);
});

test('a Copilot run doesn\'t start while Copilot\'s program or its clean home isn\'t in the engine as it should be: its guards would not stand', async () => {
  const all = { tiers: { small: 'copilot/auto', medium: 'copilot/auto', large: 'copilot/auto' } };
  // An engine folder with neither: refused, and Archon is never asked.
  const cli = fakeCli({ 'workflow run': json('run-detach.json') });
  const bare = adapter(cli, { engine: tempFolder('wh-archon-copilot-') });
  const got = await bare.start({ work: 'card-14', lane: 'quick', branch: 'b', bindings: all });
  assert.equal(got.ok, false);
  assert.match(got.refused, /Copilot's command-line program isn't in the build engine's folder/);
  assert.equal(cli.calls.length, 0);
  // The program there but the home gone or stale: refused with the home's own reason.
  const stale = adapter(cli, { copilotProblem: () => 'Wheelhouse\'s guards aren\'t registered in Copilot\'s clean home as they should be, so no Copilot step can start' });
  assert.match((await stale.start({ work: 'card-14', lane: 'quick', branch: 'b', bindings: all })).refused, /guards aren't registered/);
  assert.equal(cli.calls.length, 0);
  // A Claude run never asks.
  const claude = adapter(cli, { copilotProblem: () => assert.fail('not asked for a Claude run') });
  assert.equal((await claude.start({ work: 'card-14', lane: 'quick', branch: 'b' })).ok, true);
});

test('a Copilot run doesn\'t start on an engine built without the Copilot patch: the SDK\'s own runtime would run, not the pinned program', async () => {
  const { copilotEngineProblem } = await import('../../../../scripts/engine/archon/adapter.js');
  const { CLI_PATCH_MARK } = await import('../../../../scripts/engine/archon/build.js');
  const { copilotCliPaths } = await import('../../../../scripts/engine/archon/copilot-cli.js');
  const engine = builtEngine();
  const { bin } = copilotCliPaths(engine);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, 'copilot', { mode: 0o755 });
  const resolver = enginePaths(engine).cliResolver;
  fs.mkdirSync(path.dirname(resolver), { recursive: true });
  fs.writeFileSync(resolver, '  if (!BUNDLED_IS_BINARY) return undefined;\n');
  assert.match(copilotEngineProblem(engine), /built before Wheelhouse's Copilot patch/);
  fs.writeFileSync(resolver, `  // ${CLI_PATCH_MARK}\n  if (!BUNDLED_IS_BINARY && !process.env.COPILOT_BIN_PATH) return undefined;\n`);
  assert.doesNotMatch(copilotEngineProblem(engine) ?? '', /Copilot patch/, 'past the patch, the clean home is what is checked next');
});

// What the merge queue's record step asked, as Archon keeps it.
const recordOutput = (asked) => ({ 'workflow get': { code: 0, json: { ok: true, events: [{ event_type: 'node_completed', step_name: 'record', data: { node_output: JSON.stringify({ merged: [], summary: '', attention: 'a', options: [], class: 'pr', asked }) } }] }, stdout: '', stderr: '' } });

test('mergeAsked reads the pull request, head and merge choice from the record step, not the question\'s words', async () => {
  const asked = { by: 'pr', pr: { number: 7 }, head: 'a'.repeat(40), attention: { choices: [{ id: 'keep', effect: 'return' }, { id: 'go-ahead', effect: 'merge' }] } };
  assert.deepEqual(await adapter(fakeCli(recordOutput(asked))).mergeAsked(RUN), { pr: 7, head: 'a'.repeat(40), merge: 'go-ahead', park: null });
});

test('mergeAsked reads the park id by its effect, wherever it comes among the choices', async () => {
  const asked = { by: 'pr', pr: { number: 7 }, head: 'a'.repeat(40), attention: { choices: [{ id: 'send-back', effect: 'return' }, { id: 'leave-alone', effect: 'park' }, { id: 'merge', effect: 'merge' }, { id: 'other', effect: 'return' }] } };
  assert.deepEqual(await adapter(fakeCli(recordOutput(asked))).mergeAsked(RUN), { pr: 7, head: 'a'.repeat(40), merge: 'merge', park: 'leave-alone' });
});

test('mergeAsked gives null for anything but a pull request\'s question', async () => {
  assert.equal(await adapter(fakeCli(recordOutput({ by: 'base', attention: { choices: [] } }))).mergeAsked(RUN), null);
  assert.equal(await adapter(fakeCli(recordOutput(null))).mergeAsked(RUN), null);
  assert.equal(await adapter(fakeCli({ 'workflow get': { code: 1, json: { ok: false }, stdout: '', stderr: '' } })).mergeAsked(RUN), null);
  const none = await adapter(fakeCli(recordOutput({ by: 'pr', pr: { number: 7 }, head: 'a'.repeat(40), attention: { choices: [{ id: 'park', effect: 'park' }] } }))).mergeAsked(RUN);
  assert.equal(none.merge, null);
});

// A task's step in Archon's record: `<fan-out>__<the task's identity>__<step>`, the identity the first 16 hex of the
// SHA-256 of the item (fan-out-identity.ts, v0.13.0).
const stepOf = (task, step) => {
  const id = crypto.createHash('sha256').update(task).digest('hex').slice(0, 16);
  return `__archon_fan_out__each__root__${id}__each__${id}__${step}`;
};
const stepRow = (step_name, node_output) => ({ event_type: 'node_completed', step_name, data: { node_output } });

test('taskReviews gives each task\'s last review from the record, with no task-record step needed, as in a cancelled run', async () => {
  const events = [
    stepRow('tasks', '["2","3"]'),
    stepRow(stepOf('2', 'build.task-review'), 'round one'),
    stepRow(stepOf('3', 'build.implement'), 'built'),
    stepRow(stepOf('2', 'build.task-review'), 'round two'),
  ];
  assert.deepEqual(await adapter(fakeCli({ 'workflow get': { code: 0, json: { ok: true, events }, stdout: '', stderr: '' } })).taskReviews(RUN), { 2: 'round two' });
});

test('taskReviews gives null when the engine has no such run, and nothing for a run that reached no task', async () => {
  assert.equal(await adapter(fakeCli({ 'workflow get': { code: 1, json: { ok: false }, stdout: '', stderr: '' } })).taskReviews(RUN), null);
  assert.deepEqual(await adapter(fakeCli({ 'workflow get': { code: 0, json: { ok: true, events: [] }, stdout: '', stderr: '' } })).taskReviews(RUN), {});
});

test('queueRuns lists the live merge-queue runs in the project\'s queue folder, whoever started them', async () => {
  const QUEUE = '/engine/queues/o__p';
  const runs = [
    { id: 'mine', workflow_name: 'archon-merge-queue', status: 'running', working_path: QUEUE },
    { id: 'waiting', workflow_name: 'archon-merge-queue', status: 'paused', working_path: `${QUEUE}/sub` },
    { id: 'just-begun', workflow_name: 'archon-merge-queue', status: 'pending', working_path: QUEUE },
    { id: 'over', workflow_name: 'archon-merge-queue', status: 'completed', working_path: QUEUE },
    { id: 'other-project', workflow_name: 'archon-merge-queue', status: 'running', working_path: '/engine/queues/o__q' },
    { id: 'a-build', workflow_name: 'wheelhouse-quick', status: 'running', working_path: QUEUE },
  ];
  assert.deepEqual(await adapter(fakeCli({ 'workflow status': { code: 0, json: { runs }, stdout: '', stderr: '' } })).queueRuns({ folder: QUEUE }), ['mine', 'waiting', 'just-begun']);
});

test('queueRuns gives null when the engine can\'t list its runs', async () => {
  assert.equal(await adapter(fakeCli({ 'workflow status': { code: 1, json: null, stdout: '', stderr: 'locked' } })).queueRuns({ folder: '/q' }), null);
});

test('a run on Copilot names the agent whose steps read Wheelhouse\'s own copies; a Claude run names none', () => {
  const engine = adapter(fakeCli({}));
  const tiers = (model) => ({ tiers: { small: model, medium: model, large: model } });
  assert.equal(engine.stepAgent(tiers('copilot/auto')), 'copilot');
  assert.equal(engine.stepAgent(tiers('claude-big')), null);
  assert.equal(engine.stepAgent({ tiers: { small: 'copilot/auto', medium: 'claude-big', large: 'claude-big' } }), null, 'a mixed run starts nothing');
  assert.equal(engine.stepAgent(undefined), null);
});

test('the meter\'s file is one for the account signed in to the engine\'s clean home', () => {
  const engine = tempFolder('wh-archon-meter-');
  const unknown = adapter(fakeCli({}), { engine }).requestsFile();
  const home = path.join(engine, 'copilot', 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ lastLoggedInUser: { host: 'https://github.com', login: 'ann' } }));
  const ann = adapter(fakeCli({}), { engine }).requestsFile();
  assert.notEqual(ann, unknown);
  assert.equal(path.dirname(ann), path.join(engine, 'requests'));
});

test('a reader runs in place in its own folder, with its card and no branch or work', async () => {
  const cli = fakeCli({ 'workflow run': json('run-detach.json') });
  const engine = adapter(cli);
  assert.equal((await engine.start({ work: 'reader', lane: 'reader', card: 'q-w-1', project: '/engine/readers/ab12', bindings: { tiers: { medium: 'm' } } })).ok, true);
  const { args } = cli.calls[0];
  assert.deepEqual(args.slice(0, 3), ['workflow', 'run', 'wheelhouse-reader']);
  assert.equal(args[args.indexOf('--cwd') + 1], '/engine/readers/ab12');
  assert.ok(args.includes('--folder'));
  assert.equal(args[args.indexOf('--input') + 1], 'card=q-w-1');
  assert.equal(args.includes('--branch'), false);
  assert.equal(args.includes('--project'), false);
  assert.equal(args.some((a) => a.startsWith('work=')), false);
  assert.equal((await engine.start({ work: 'reader', lane: 'reader', project: '/engine/readers/ab12' })).ok, false);
  assert.equal((await engine.start({ work: 'reader', lane: 'reader', card: 'q-w-1' })).ok, false);
});

test('a start with no reply in time is uncertain, and any other refusal isn\'t', async () => {
  const timedOut = { code: -1, timedOut: true, stdout: '', stderr: '' };
  const got = await adapter(fakeCli({ 'workflow run': timedOut })).start({ work: 'w1', lane: 'quick', project: '/p' });
  assert.equal(got.ok, false);
  assert.equal(got.uncertain, true);
  const refused = await adapter(fakeCli({ 'workflow run': { code: 1, json: { ok: false, error: 'No' }, stdout: '', stderr: '' } })).start({ work: 'w1', lane: 'quick', project: '/p' });
  assert.equal(refused.uncertain, undefined);
});

test('liveRunOf tells a run by the work it was given, never by a branch it may not have yet', async () => {
  const since = '2026-11-01T02:00:00.000Z';
  const row = (id, work, over = {}) => ({ id, workflow_name: 'wheelhouse-quick', status: 'pending', started_at: '2026-11-01T02:00:01.000Z', working_path: null, metadata: work ? { inputs: { work } } : {}, ...over });
  const listing = (...runs) => fakeCli({ 'workflow status': { code: 0, json: { runs }, stdout: '', stderr: '' } });
  const ask = (cli) => adapter(cli).liveRunOf({ work: 'w1', since });
  assert.deepEqual(await ask(listing(row('r1', 'w1'), row('r2', 'w2'))), { runId: 'r1' });
  assert.equal(await ask(listing(row('r2', 'w2'))), null, 'another piece\'s run');
  assert.equal(await ask(listing(row('r1', 'w1', { started_at: '2026-11-01T01:00:00.000Z' }))), null, 'older than the start');
  assert.equal(await ask(listing(row('r1', 'w1', { status: 'cancelled' }))), null, 'ended');
  assert.deepEqual(await ask(listing(row('r1', 'w1', { workflow_name: 'wheelhouse-slice' }))), { runId: 'r1' }, 'whichever lane the piece runs in');
  assert.equal(await ask(listing(row('r2', null, { workflow_name: 'archon-merge-queue' }))), null, 'the merge queue has no work to name');
  assert.equal(await ask(listing(row('r1', null))), undefined, 'a pending run with nothing to tell it by');
  assert.equal(await ask(listing(row('r1', 'w1'), row('r2', 'w1'))), undefined, 'two matches');
  assert.equal(await ask(fakeCli({ 'workflow status': { code: 1, stdout: '', stderr: '' } })), undefined, 'the engine can\'t list');
});

test('a start only counts as refused when the engine says so in words; anything else may have begun', async () => {
  for (const reply of [{ code: null, json: null, stdout: '', stderr: '' }, { code: 0, json: null, stdout: 'not json', stderr: '' }, { code: 0, json: { ok: true }, stdout: '', stderr: '' }, { code: 1, json: null, stdout: '', stderr: 'crashed' }, { code: 1, json: { ok: false, error: 'late' }, stdout: '', stderr: '', timedOut: true }]) {
    const got = await adapter(fakeCli({ 'workflow run': reply })).start({ work: 'card-1', lane: 'quick', branch: 'b' });
    assert.equal(got.ok, false, JSON.stringify(reply));
    assert.equal(got.uncertain, true, JSON.stringify(reply));
  }
  const said = await adapter(fakeCli({ 'workflow run': { code: 1, json: { ok: false, error: 'Workflow already active on this path' }, stdout: '', stderr: '' } })).start({ work: 'card-1', lane: 'quick', branch: 'b' });
  assert.equal(said.uncertain, undefined);
});

test('a run\'s record that couldn\'t be read says so, apart from a run the engine doesn\'t have', async () => {
  const silent = await adapter(fakeCli({ 'workflow get': { code: 1, json: null, stdout: '', stderr: 'timed out' } })).inspect('r');
  assert.equal(silent.status, 'unknown');
  assert.equal(silent.unread, true);
  const missing = await adapter(fakeCli({ 'workflow get': { code: 1, json: { ok: false, error: 'not found' }, stdout: '', stderr: '' } })).inspect('r');
  assert.equal(missing.unread, undefined);
});
