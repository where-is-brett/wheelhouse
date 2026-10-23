// tests/scripts/agents/copilot-wiring.test.js
// The watcher's sessions on Copilot (Part 8 Task 1, dispatch 1a; rulings P8-1 to P8-6 and P8-10 to P8-13): the
// project's adapter starts the foreman and the features, the waker keeps each run's output and settles it by what
// the output says, a first run's id is kept for its wakes, every feature call is given its level's inputs, a level
// that changes is recorded, the session's home is written before every start with the pinned kits' skills, and old
// activity is pruned. Copilot's sessions are switched off (BACKGROUND_SESSIONS_READY): the tests drive the waker with
// the same part built switched on, given to makeWaker as its `sessions`, which no other caller passes. No session
// runs: every start is a stand-in that writes a run's output by hand, and stand-ins for gh, glab and copilot come
// first on the PATH; the last test asserts none of them ran.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterFor } from '../../../scripts/agents/index.js';
import { checkAdapter, isPendingPart } from '../../../scripts/agents/contract.js';
import { sessionsOfProject } from '../../../scripts/agents/project-agent.js';
import { ensureKits, kitFolder, kitSkills } from '../../../scripts/agents/copilot/kits.js';
import { foremanSession } from '../../../scripts/foreman/start.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { fingerprintTree } from '../../../scripts/lineage/fingerprint.js';
import { BACKGROUND_SESSIONS_READY } from '../../../scripts/lib/copilot-numbers.js';
import { computerId, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { writeBaseline } from '../../../scripts/watcher/control-files.js';
import { levelFile, makeWaker, sessionFile, spawnDetached, writeWake } from '../../../scripts/watcher/waker.js';
import {
  NOT_SWITCHED_ON, activityFile, afterRun, pruneActivity, sessionHome, sessionsPart, writeSessionHome,
} from '../../../adapters/copilot/sessions.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { g } from '../../helpers/git-fixture.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { until } from '../../helpers/until.js';
import { P, T0, config as projectConfig, project, worktree as makeWorktree } from '../../helpers/foreman.js';

const stand = standInTools();
after(() => stand.restore());

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ID = 'b2c3d4e5-0000-4000-8000-00000000000a';
const WORK = 'login-page';

// Copilot's output, one JSON event a line, as `--output-format json` prints it (check 61).
const ev = {
  start: (id, toolName, command) => ({ type: 'tool.execution_start', data: { toolCallId: id, toolName, arguments: command === undefined ? {} : { command } } }),
  refused: (id, message, code = 'denied') => ({ type: 'tool.execution_complete', data: { toolCallId: id, success: false, error: { message, code } } }),
  answer: (content) => ({ type: 'assistant.message', data: { content } }),
  result: (sessionId = ID) => ({ type: 'result', sessionId, exitCode: 0, usage: { premiumRequests: 1 } }),
};
const lines = (...events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

// A person's Copilot home holding a sign-in.
function signedIn() {
  const dir = tempFolder('wh-copilot-person-');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'someone' }], trustedFolders: ['/x'] }));
  return dir;
}

// Copilot's sessions part switched on, with no kit to fetch and a scratch sign-in. Its versions are read with no
// program started, and the safety subset a new version runs (Part 8 Task 2) is a stand-in that passes.
const copilotOn = ({ kits = { manifest: { upstreams: [] } } } = {}) => sessionsPart({
  ready: true, kits, home: { signedInFrom: signedIn(), node: process.execPath, root: ROOT },
  versions: { run: async () => { throw new Error('no copilot is started here'); }, runSubset: async () => ({ ok: true }) },
});

const copilotConfig = (over = {}) => readConfig(JSON.stringify(projectConfig({ agents: { [computerId()]: 'copilot' }, ...over })));

// A stand-in start: each call kept; `finish(i, stdout, code)` appends the run's output to the file the waker handed
// it and ends the process with `code`.
function fakeRun() {
  const calls = [];
  const live = new Set();
  const run = (file, args, options) => {
    const pid = 100 + calls.length;
    let done;
    const exited = new Promise((resolve) => { done = resolve; });
    calls.push({ file, args, ...options, pid, done });
    live.add(pid);
    return { pid, exited };
  };
  const write = (i, stdout) => {
    if (typeof calls[i].output === 'string') fs.appendFileSync(calls[i].output, stdout);
    live.delete(calls[i].pid);
  };
  const finish = (i, stdout, code = 0) => {
    write(i, stdout);
    calls[i].done(code);
  };
  return { run, calls, alive: (pid) => live.has(pid), finish, write };
}

// The worktree a feature's wakes find (the features view isn't kept in these tests).
const where = { dir: null };

function copilotWaker({ part = copilotOn(), fake = fakeRun(), clock = { t: T0 }, ...over } = {}) {
  const raised = [];
  const errors = [];
  const w = makeWaker({
    shape: 1,
    project: P,
    config: copilotConfig(),
    sessions: part,
    run: fake.run,
    alive: fake.alive,
    startTimeOf: async () => null,
    now: () => new Date(clock.t),
    bootedAt: () => 0,
    baseEnv: { PATH: process.env.PATH ?? '', HOME: '/Users/someone' },
    foremanTools: ['Bash(node:*)'],
    print: () => { throw new Error('Shape 1 prints nothing'); },
    raise: async (record) => { raised.push(record); },
    onError: (message) => errors.push(message),
    windowsBuilds: () => ({ level: 'ask', grants: [], guardedCommand: null }),
    locate: () => where.dir,
    ...over,
  });
  return { w, fake, raised, errors, clock };
}

const foremanWake = (t = T0) => writeWake(P, { to: 'foreman', events: [{ type: 'incident', id: `e${t}`, detail: {} }], digest: [], dropped: 0 }, { now: () => new Date(t) });
const featureWake = (t = T0) => writeWake(P, { to: 'feature', work: WORK, events: [{ type: 'ci-red', id: `c${t}` }], digest: [], dropped: 0 }, { now: () => new Date(t) });
const keptId = () => JSON.parse(fs.readFileSync(sessionFile(P, WORK), 'utf8'));
const valueOf = (args, flag) => args[args.indexOf(flag) + 1];

// A feature worktree the waker accepts, with the record of its agent files the foreman's start keeps.
function feature(checkout) {
  const dir = makeWorktree(checkout, WORK);
  writeBaseline(P, WORK, dir);
  where.dir = dir;
  return dir;
}

test('a Copilot project\'s foreman and features are started by the Copilot adapter', () => withHome(async () => {
  const checkout = await project();
  // The project's agent here is Copilot: the waker's sessions part is the Copilot adapter's own, built, and it
  // refuses while its switch is off (P8-1).
  const copilot = adapterFor('copilot');
  assert.equal(sessionsOfProject(copilotConfig()), copilot.sessions);
  assert.equal(isPendingPart(copilot.sessions), false);
  assert.equal(BACKGROUND_SESSIONS_READY, false);
  assert.throws(() => makeWaker({ shape: 1, project: P, config: copilotConfig(), run: () => { throw new Error('nothing runs'); } }), (error) => error.message === NOT_SWITCHED_ON);

  // The same part switched on starts the foreman through Copilot's call, in the main checkout, with its own home.
  const { w, fake, raised } = copilotWaker();
  await w.wakeForeman(foremanWake());
  assert.equal(fake.calls.length, 1);
  const foreman = fake.calls[0];
  if (process.platform !== 'win32') assert.equal(foreman.file, 'copilot');
  assert.equal(valueOf(foreman.args, '--agent'), 'wheelhouse-foreman');
  assert.ok(foreman.args.includes('--allow-tool=shell(node:*)'));
  assert.ok(foreman.args.includes('--no-ask-user'));
  assert.equal(foreman.cwd, checkout);
  assert.equal(foreman.env.COPILOT_HOME, sessionHome(P, 'foreman'));
  assert.equal(path.dirname(foreman.output), path.join(wheelhouseHome(), 'projects', P, 'activity'));
  // The home was written before the start: the guards' file, the agents, and the sign-in only.
  const home = sessionHome(P, 'foreman');
  assert.ok(fs.existsSync(path.join(home, 'hooks', 'wheelhouse.json')));
  assert.ok(fs.existsSync(path.join(home, 'agents', 'wheelhouse-foreman.agent.md')));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'))), ['loggedInUsers']);
  fake.finish(0, lines(ev.answer('Handled.'), ev.result('f0000000-0000-4000-8000-000000000001')));
  await until(() => w.waiting().length === 0, { what: 'the foreman\'s wake to settle' });
  assert.equal(raised.filter((r) => r.kind === 'activity')[0].data.role, 'foreman');

  // A feature starts through Copilot's start call, in its worktree, with no session id until its run names one.
  const dir = feature(checkout);
  const started = await w.startFeature({ work: WORK, worktree: dir });
  assert.equal(started.sessionId, null);
  const start = fake.calls[1];
  assert.equal(start.cwd, dir);
  assert.equal(valueOf(start.args, '--agent'), 'wheelhouse-builder');
  assert.ok(!start.args.some((a) => a.startsWith('--resume')));
  assert.ok(start.args.includes('--deny-tool=shell(copilot:*)'));
  assert.equal(start.env.COPILOT_HOME, sessionHome(P, `feature-${WORK}`));
  assert.deepEqual({ ...keptId(), at: null }, { sessionId: null, worktree: dir, at: null, fromRun: true });
  const runOutput = start.output;

  // Its run ends: the id it gave is kept, its output takes the session's name, and what it did is recorded.
  fake.finish(1, lines(ev.start('t1', 'bash', 'npm test'), ev.answer('Done.'), ev.result(ID)));
  await until(() => keptId().sessionId === ID, { what: 'the first run\'s session id' });
  assert.equal(fs.existsSync(runOutput), false);
  assert.ok(fs.existsSync(activityFile(P, ID)));
  const activity = raised.filter((r) => r.kind === 'activity').at(-1).data;
  assert.equal(activity.session, ID);
  assert.equal(activity.role, 'builder');
  assert.equal(activity.work, WORK);
  assert.deepEqual(activity.commands, ['npm test']);
  assert.equal(activity.usage.premiumRequests, 1);

  // A wake resumes that session by id, in the same home, appending to its activity.
  await w.wakeFeature(WORK, featureWake(T0 + 1000));
  const wake = fake.calls[2];
  assert.equal(wake.args[0], `--resume=${ID}`);
  assert.equal(wake.output, activityFile(P, ID));
  assert.equal(wake.env.COPILOT_HOME, sessionHome(P, `feature-${WORK}`));
}));

test('a Copilot run with no result event is a failed wake whatever its exit code', () => withHome(async () => {
  await project();
  const clock = { t: T0 };
  const { w, fake, raised } = copilotWaker({ clock });
  await w.wakeForeman(foremanWake());
  // Exit 0, and no result: the wake failed, and waits to go again.
  fake.finish(0, lines(ev.answer('I could not go on.')), 0);
  await until(() => w.waiting()[0]?.failures === 1, { what: 'the wake to fail' });
  assert.equal(w.waiting()[0].lastError, 'its session ended without a result');
  assert.equal(raised.filter((r) => r.kind === 'activity')[0].data.session, null);

  // A result with refusals and exit 1 is done: the exit code proves nothing (check 61).
  clock.t += 2 * 60 * 1000;
  await w.pump();
  assert.equal(fake.calls.length, 2);
  fake.finish(1, lines(ev.start('t1', 'bash', 'rm x'), ev.refused('t1', 'Permission to run this tool was denied due to the following rules: `shell(rm:*)`'), ev.result()), 1);
  await until(() => w.waiting().length === 0, { what: 'the wake to settle done' });
  assert.deepEqual(raised.filter((r) => r.kind === 'activity').at(-1).data.refusals, [{ tool: 'bash', kind: 'rule', rule: 'shell(rm:*)' }]);
}));

test('a wake reads only what its own run appended to the session\'s output', () => withHome(async () => {
  const checkout = await project();
  const clock = { t: T0 };
  const { w, fake } = copilotWaker({ clock });
  const dir = feature(checkout);
  await w.startFeature({ work: WORK, worktree: dir });
  fake.finish(0, lines(ev.result(ID)));
  await until(() => keptId().sessionId === ID, { what: 'the id' });
  await w.wakeFeature(WORK, featureWake(T0 + 1000));
  // The earlier run's result is in the same file, and doesn't count for this one.
  fake.finish(1, lines(ev.answer('half way')), 0);
  await until(() => w.waiting()[0]?.failures === 1, { what: 'the wake to fail' });
  assert.equal(w.waiting()[0].lastError, 'its session ended without a result');
}));

test('a first run that gives no session id leaves no session to wake, and says so once', () => withHome(async () => {
  const checkout = await project();
  const { w, fake, errors } = copilotWaker();
  const dir = feature(checkout);
  await w.startFeature({ work: WORK, worktree: dir });
  fake.finish(0, lines(ev.answer('no result here')));
  await until(() => !fs.existsSync(sessionFile(P, WORK)), { what: 'the session record to go' });
  assert.equal(errors.filter((m) => /first run gave no session id/.test(m)).length, 1);
}));

test('a start whose exit the starter never saw is read by the watcher once its process has gone', () => withHome(async () => {
  const checkout = await project();
  const dir = feature(checkout);
  // The foreman's command starts the session and exits before it ends: its exit is never seen there.
  const fake = fakeRun();
  const starter = copilotWaker({ fake, run: (file, args, options) => { const r = fake.run(file, args, options); return { pid: r.pid }; } });
  await starter.w.startFeature({ work: WORK, worktree: dir });
  fake.write(0, lines(ev.start('t1', 'view'), ev.result(ID)));
  // The watcher's own waker finds the record ended, and reads the run's output.
  const watcher = copilotWaker({ fake });
  await watcher.w.pump();
  assert.equal(keptId().sessionId, ID);
  assert.equal(watcher.raised.filter((r) => r.kind === 'activity')[0].data.session, ID);
  assert.ok(fs.existsSync(activityFile(P, ID)));
  // Its wakes now resume it.
  await watcher.w.wakeFeature(WORK, featureWake(T0 + 1000));
  assert.equal(fake.calls.at(-1).args[0], `--resume=${ID}`);
}));

test('a first run\'s session record waits while its start may still be under way, and is cleared after (review Minor 4)', () => withHome(async () => {
  const checkout = await project();
  const dir = feature(checkout);
  const clock = { t: T0 };
  const { w, fake, errors } = copilotWaker({ clock });
  // A record with no id and no running record yet, as another process's start leaves it for a moment.
  fs.mkdirSync(path.dirname(sessionFile(P, WORK)), { recursive: true });
  fs.writeFileSync(sessionFile(P, WORK), JSON.stringify({ sessionId: null, fromRun: true, worktree: dir, at: new Date(T0).toISOString() }));
  clock.t = T0 + 1000;
  await w.wakeFeature(WORK, featureWake(clock.t));
  assert.equal(keptId().sessionId, null, 'kept while the start may still be made');
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(errors, []);
  // Past a start's own time with still no run recorded: there is no session to wake.
  clock.t = T0 + 3 * 60 * 1000;
  await w.pump();
  assert.equal(fs.existsSync(sessionFile(P, WORK)), false);
  assert.equal(errors.filter((m) => /first run gave no session id/.test(m)).length, 1);
}));

test('two wakers that see the same run end read it once (review Minor 4)', () => withHome(async () => {
  const checkout = await project();
  const dir = feature(checkout);
  const fake = fakeRun();
  const starter = copilotWaker({ fake });
  await starter.w.startFeature({ work: WORK, worktree: dir });
  // The run ends; another waker finds its record ended before the starter hears of the exit.
  fake.write(0, lines(ev.result(ID)));
  const watcher = copilotWaker({ fake });
  await watcher.w.pump();
  fake.calls[0].done(0);
  await until(() => keptId().sessionId === ID, { what: 'the id' });
  await starter.w.pump();
  const activities = [...starter.raised, ...watcher.raised].filter((r) => r.kind === 'activity');
  assert.equal(activities.length, 1);
}));

test('a start STOP refuses just before its run records no level (review Minor 7)', () => withHome(async () => {
  const checkout = await project();
  const dir = feature(checkout);
  let stop = false;
  const { w, fake, raised } = copilotWaker({
    stopped: () => stop,
    windowsBuilds: () => { stop = true; return { level: 'ask', grants: [], guardedCommand: null }; },
  });
  await assert.rejects(w.startFeature({ work: WORK, worktree: dir }), /STOP is on/);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(raised.filter((r) => r.kind === 'level'), []);
  assert.equal(fs.existsSync(levelFile(P)), false);
  assert.equal(fs.existsSync(sessionFile(P, WORK)), false);
}));

test('every feature call is given its level\'s inputs, and a level that changes is recorded once (P8-4, P8-5)', () => withHome(async () => {
  const checkout = await project();
  let answer = { level: 'unattended', grants: [], guardedCommand: null };
  const { w, fake, raised } = copilotWaker({ windowsBuilds: () => answer });
  const dir = feature(checkout);
  // Unattended asked for, with real users unknown: Ask runs (anything not plainly so fails closed).
  await w.startFeature({ work: WORK, worktree: dir });
  assert.ok(!fake.calls[0].args.includes('--allow-tool=shell'));
  fake.finish(0, lines(ev.result(ID)));
  await until(() => keptId().sessionId === ID, { what: 'the id' });
  const levels = () => raised.filter((r) => r.kind === 'level');
  assert.deepEqual(levels().map((r) => r.data.level), ['ask']);
  assert.deepEqual(JSON.parse(fs.readFileSync(levelFile(P), 'utf8')), { level: 'ask' });

  // The same level again is not recorded again.
  await w.wakeFeature(WORK, featureWake(T0 + 1000));
  fake.finish(1, lines(ev.result(ID)));
  await until(() => w.waiting().length === 0, { what: 'the wake' });
  assert.equal(levels().length, 1);

  // No real users and Unattended confirmed: the shell is allowed, and the change is recorded.
  answer = { level: 'unattended', grants: [], guardedCommand: null, realUsers: false };
  await w.wakeFeature(WORK, featureWake(T0 + 2000));
  assert.ok(fake.calls[2].args.includes('--allow-tool=shell'));
  assert.deepEqual(levels().map((r) => r.data.level), ['ask', 'unattended']);
  assert.ok(levels().every((r) => r.data.work === WORK && typeof r.data.at === 'string' && !('key' in r.data) && !('pr' in r.data)));

  // Such a record is no level the director set: the views keep it out of their levels and their unconfirmed.
  const views = buildViews(levels().map(({ kind, data }) => makeEvent({ kind, data, now: () => new Date(T0) })), []);
  assert.deepEqual(views.levels, {});
  assert.deepEqual(views.unconfirmed, []);
}));

test('a guard\'s refusal leaves one board note per run, and only a guard\'s own words count as one (P8-10)', () => {
  const quoted = lines(
    ev.start('a', 'bash'), ev.refused('a', 'Denied by preToolUse hook: The answer server said deny.'),
    ev.start('b', 'apply_patch'), ev.refused('b', 'Denied by preToolUse hook from "/h/hooks/wheelhouse.json" (hook errored)'),
    ev.start('c', 'bash'), ev.refused('c', 'Error: Denied by preToolUse hook: quoted by a tool'),
    ev.start('d', 'bash'), ev.refused('d', 'Denied by preToolUse hook: not a denial', 'failure'),
    ev.start('e', 'odd tool name!'), ev.refused('e', 'Denied by preToolUse hook: deny'),
    ev.result(),
  );
  const ran = afterRun({ stdout: quoted, target: `feature-${WORK}`, at: new Date(T0).toISOString() });
  assert.equal(ran.ok, true);
  const activity = ran.records.find((r) => r.kind === 'activity').data;
  assert.deepEqual(activity.refusals.map((r) => [r.tool, r.kind]), [['bash', 'guard'], ['apply_patch', 'guard'], ['bash', 'other'], ['bash', 'other'], ['other', 'guard']]);
  const notes = ran.records.filter((r) => r.kind === 'note');
  assert.equal(notes.length, 1);
  assert.match(notes[0].data.text, /refused 3 tool calls in the login-page session's run \(bash, apply_patch, other\)/);
  // No guard refusal, no note; and the activity record passes the state's own check.
  const quiet = afterRun({ stdout: lines(ev.result()), target: 'foreman', at: new Date(T0).toISOString() });
  assert.deepEqual(quiet.records.map((r) => r.kind), ['activity']);
  assert.doesNotThrow(() => makeEvent({ ...ran.records[0], now: () => new Date(T0) }));
});

test('the adapter\'s prepare runs before every start, and a refusal starts nothing (P7-27 a)', () => withHome(async () => {
  const checkout = await project();
  const dir = feature(checkout);
  // A kit whose fetched folder isn't the manifest's: the start is refused, and the lineage hold's card raised once.
  const upstream = { name: 'kit-a', plugin: 'kit-a', repo: 'https://example.invalid/kit-a.git', ref: 'v1', sha: 'a'.repeat(40), folders: [{ path: 'skills/one', hash: '0'.repeat(64) }], files: [] };
  const fetchTo = async (_, into) => {
    fs.mkdirSync(path.join(into, 'skills', 'one'), { recursive: true });
    fs.writeFileSync(path.join(into, 'skills', 'one', 'SKILL.md'), 'Not the pinned text.\n');
  };
  const { w, fake, raised } = copilotWaker({ part: copilotOn({ kits: { manifest: { upstreams: [upstream] }, fetchTo } }) });
  for (let n = 0; n < 2; n += 1) await assert.rejects(w.startFeature({ work: WORK, worktree: dir }), /don't match Wheelhouse's manifest/);
  assert.equal(fake.calls.length, 0, 'nothing was started');
  assert.equal(fs.existsSync(sessionFile(P, WORK)), false, 'no session record was written');
  const holds = raised.filter((r) => r.kind === 'lineage-hold');
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0].data.mismatches, [{ upstream: 'kit-a', path: 'skills/one' }]);
  assert.doesNotThrow(() => makeEvent({ ...holds[0], now: () => new Date(T0) }));
}));

test('Claude Code\'s adapter has none of the three optional members, and its runs settle by exit code as before (P8-2)', () => {
  const claude = adapterFor('claude-code').sessions;
  for (const member of ['prepare', 'afterRun', 'pruneActivity']) assert.equal(claude[member], undefined, member);
  assert.deepEqual(checkAdapter(adapterFor('claude-code')), []);
  assert.deepEqual(checkAdapter(adapterFor('copilot')), []);
});

test('the waker\'s prune removes old activity through the adapter', () => withHome(async () => {
  await project();
  const { w } = copilotWaker();
  const dir = path.join(wheelhouseHome(), 'projects', P, 'activity');
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'old.jsonl');
  fs.writeFileSync(old, '{}\n');
  const long = new Date(T0 - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, long, long);
  fs.writeFileSync(path.join(dir, 'new.jsonl'), '{}\n');
  await w.prune();
  assert.deepEqual(fs.readdirSync(dir), ['new.jsonl']);
}));

test('Copilot runs the watcher\'s first shape only, so the foreman\'s long session is refused (P8-6)', () => withHome(async () => {
  await project();
  const on = copilotOn();
  assert.throws(() => on.checkForeman({ watcherShape: 2 }), /second shape isn't offered/);
  assert.throws(() => foremanSession({ project: P, config: copilotConfig(), sessions: on }), /one wake at a time/);
}));

test('a link from Wheelhouse\'s home down to a session\'s home or its activity refuses the write (P8-12)', () => withHome(async () => {
  const elsewhere = tempFolder('wh-elsewhere-');
  fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'kept\n');
  const write = (target = 'foreman', signedInFrom = signedIn()) => writeSessionHome({ project: P, target, signedInFrom, node: process.execPath, root: ROOT });

  // A link at the session's home.
  fs.mkdirSync(path.dirname(sessionHome(P, 'foreman')), { recursive: true });
  fs.symlinkSync(elsewhere, sessionHome(P, 'foreman'), 'dir');
  assert.throws(() => write(), /a link or a file/);
  assert.deepEqual(fs.readdirSync(elsewhere), ['keep.txt']);
  // A link at a folder above it.
  fs.rmSync(path.dirname(sessionHome(P, 'foreman')), { recursive: true });
  fs.symlinkSync(elsewhere, path.dirname(sessionHome(P, 'foreman')), 'dir');
  assert.throws(() => write(`feature-${WORK}`), /a link or a file/);
  assert.deepEqual(fs.readdirSync(elsewhere), ['keep.txt']);
  fs.rmSync(path.dirname(sessionHome(P, 'foreman')));

  // A sign-in that fails leaves a home already there untouched.
  const home = write();
  fs.writeFileSync(path.join(home, 'session-store.db'), 'state');
  const before = fs.readdirSync(home).sort();
  assert.throws(() => write('foreman', tempFolder('wh-copilot-none-')), /isn't signed in/);
  assert.deepEqual(fs.readdirSync(home).sort(), before);
  assert.ok(fs.existsSync(path.join(home, 'hooks', 'wheelhouse.json')));

  // The activity folder as a link: nothing is pruned through it.
  const activity = path.join(wheelhouseHome(), 'projects', P, 'activity');
  const long = new Date(T0 - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(elsewhere, 'keep.txt'), long, long);
  fs.symlinkSync(elsewhere, activity, 'dir');
  assert.throws(() => pruneActivity({ project: P, now: () => new Date(T0) }), /a link or a file/);
  assert.deepEqual(fs.readdirSync(elsewhere), ['keep.txt']);
  // A link inside the activity folder is removed as a link, never followed.
  fs.rmSync(activity);
  fs.mkdirSync(activity);
  const link = path.join(activity, 'old.jsonl');
  fs.symlinkSync(path.join(elsewhere, 'keep.txt'), link);
  fs.lutimesSync(link, long, long);
  assert.deepEqual(pruneActivity({ project: P, now: () => new Date(T0) }), ['old.jsonl']);
  assert.ok(fs.existsSync(path.join(elsewhere, 'keep.txt')));
}));

test('the pinned kits are fetched once, checked, and copied into each session\'s home as its skills (P8-13)', () => withHome(async () => {
  // A local kit repository, never the network.
  const source = tempFolder('wh-kit-source-');
  await g(source, 'init', '-q', '-b', 'main');
  for (const [file, text] of [['skills/alpha/SKILL.md', 'Alpha.\n'], ['skills/alpha/notes/more.md', 'More.\n'], ['skills/beta/SKILL.md', 'Beta.\n'], ['README.md', 'Not used.\n']]) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), text);
  }
  await g(source, 'add', '.');
  await g(source, 'commit', '-q', '-m', 'Kit');
  const sha = await g(source, 'rev-parse', 'HEAD');
  const upstream = {
    name: 'kit-a', plugin: 'kit-a', repo: 'https://example.invalid/kit-a.git', ref: 'v1', sha,
    folders: ['skills/alpha', 'skills/beta'].map((f) => ({ path: f, hash: fingerprintTree(path.join(source, f)).hash })), files: [],
  };
  const manifest = { upstreams: [upstream] };
  const fetched = [];
  const fetchTo = async (u, dir) => {
    fetched.push(u.name);
    await g(dir, 'clone', '-q', source, '.');
    await g(dir, '-c', 'advice.detachedHead=false', 'checkout', '-q', u.sha);
  };

  assert.deepEqual(await ensureKits({ manifest, fetchTo }), ['kit-a']);
  assert.deepEqual(await ensureKits({ manifest, fetchTo }), [], 'fetched once');
  assert.deepEqual(fetched, ['kit-a']);
  // Only the used folders are kept.
  assert.deepEqual(fs.readdirSync(kitFolder(upstream)), ['skills']);
  const skills = kitSkills({ manifest });
  assert.deepEqual(skills.map((s) => s.name), ['alpha', 'beta']);

  const home = writeSessionHome({ project: P, target: `feature-${WORK}`, signedInFrom: signedIn(), node: process.execPath, root: ROOT, skills });
  assert.equal(fs.readFileSync(path.join(home, 'skills', 'alpha', 'notes', 'more.md'), 'utf8'), 'More.\n');
  assert.deepEqual(fs.readdirSync(path.join(home, 'skills')).sort(), ['alpha', 'beta']);

  // A kept copy changed since: the start is refused with the hold's record.
  fs.writeFileSync(path.join(kitFolder(upstream), 'skills', 'beta', 'SKILL.md'), 'Changed.\n');
  assert.throws(() => kitSkills({ manifest }), (error) => /don't match/.test(error.message)
    && error.records[0].kind === 'lineage-hold' && error.records[0].data.mismatches[0].path === 'skills/beta');
  // A link in a kept copy is never given to a session.
  fs.writeFileSync(path.join(kitFolder(upstream), 'skills', 'beta', 'SKILL.md'), 'Beta.\n');
  assert.equal(kitSkills({ manifest }).length, 2);
  fs.symlinkSync(path.join(source, 'README.md'), path.join(kitFolder(upstream), 'skills', 'alpha', 'linked.md'));
  assert.throws(() => kitSkills({ manifest }), /don't match/);
}));

test('a detached start keeps the run\'s output in the file it is given, appended to', async () => {
  const dir = tempFolder('wh-output-');
  const output = path.join(dir, 'run.jsonl');
  fs.writeFileSync(output, 'before\n');
  // The child is let go of (unref), so this test holds the event loop open while it waits.
  const hold = setInterval(() => {}, 50);
  let code;
  try {
    const started = await spawnDetached(process.execPath, ['-e', 'console.log("out"); console.error("err")'], { cwd: dir, env: { PATH: process.env.PATH ?? '' }, output });
    code = await started.exited;
  } finally {
    clearInterval(hold);
  }
  assert.equal(code, 0);
  const text = fs.readFileSync(output, 'utf8');
  assert.ok(text.startsWith('before\n'));
  assert.match(text, /out/);
  assert.match(text, /err/);
});

test('a Copilot builder\'s grants are asked for with the window\'s proof only, and Claude Code\'s as before (P8-8)', () => withHome(async () => {
  const checkout = await project();
  assert.deepEqual(copilotOn().grantProofs, ['window']);
  assert.deepEqual(adapterFor('copilot').sessions.grantProofs, ['window']);
  assert.equal(adapterFor('claude-code').sessions.grantProofs, undefined);

  // Copilot: windowsBuilds is asked with the proofs a grant must name.
  const asked = [];
  const { w, fake } = copilotWaker({ windowsBuilds: (...args) => { asked.push(args); return { level: 'ask', grants: [], guardedCommand: null }; } });
  await w.startFeature({ work: WORK, worktree: feature(checkout) });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(asked, [[WORK, { proofs: ['window'] }]]);

  // An adapter whose grantProofs aren't a list of names counts no grant: it is asked with none.
  const odd = [];
  const broken = Object.freeze({ ...copilotOn(), grantProofs: 'window' });
  await copilotWaker({ part: broken, windowsBuilds: (...args) => { odd.push(args); return { level: 'ask', grants: [], guardedCommand: null }; } })
    .w.startFeature({ work: WORK, worktree: feature(checkout) });
  assert.deepEqual(odd, [[WORK, { proofs: [] }]]);

  // Claude Code: asked with the work alone, exactly as before.
  const claudeAsked = [];
  const claude = makeWaker({
    shape: 1,
    project: P,
    config: readConfig(JSON.stringify(projectConfig())),
    sessions: adapterFor('claude-code').sessions,
    run: fakeRun().run,
    alive: () => false,
    startTimeOf: async () => null,
    now: () => new Date(T0),
    bootedAt: () => 0,
    baseEnv: { PATH: process.env.PATH ?? '', HOME: '/Users/someone' },
    foremanTools: ['Bash(node:*)'],
    print: () => { throw new Error('Shape 1 prints nothing'); },
    raise: async () => {},
    onError: () => {},
    windowsBuilds: (...args) => { claudeAsked.push(args); return { level: 'ask', grants: [], guardedCommand: null }; },
    locate: () => where.dir,
  });
  await claude.startFeature({ work: WORK, worktree: feature(checkout) });
  assert.deepEqual(claudeAsked, [[WORK]]);
}));

test('none of the real copilot, gh or glab ran', () => {
  assert.deepEqual(stand.calls(), []);
});
