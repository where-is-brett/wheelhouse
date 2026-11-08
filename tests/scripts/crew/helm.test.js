// tests/scripts/crew/helm.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { stateDir } from '../../../scripts/lib/paths.js';
import { listEvents, makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { tempFolder } from '../../helpers/homes.js';
import { PROMPTS, firstPrompt, readWake, runningFile, sessionFile, wakesDir } from '../../../scripts/watcher/waker.js';
import { takeHold, readHold, markOpened, helmHeld, holdFile, claimHandBack } from '../../../scripts/crew/hold.js';
import { openHelm, handBack, isDirector, stopNow, takeAtDesk, backAtDesk, openCommand, steerRefusal, HELM_STILL_OPEN } from '../../../scripts/crew/helm.js';

const claude = { kind: 'direct', file: 'claude' };
const tty = { isTTY: true };
const treeOf = new Map();
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 8, 2, 0, tick++));

async function withHome(fn) {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = path.join(tempFolder('wh-helm-'), 'home');
  try {
    await openTestRecord({ project: 'o__p' });
    return await fn('o__p');
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

async function openPiece(project, work, step = 'building') {
  await writeEvent({ project, event: makeEvent({ kind: 'feature', data: { work, step }, now }), now });
  const file = sessionFile(project, work);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tree = tempFolder('wh-tree-');
  treeOf.set(work, tree);
  fs.writeFileSync(file, JSON.stringify({ sessionId: 's-1', worktree: tree }));
}

// A stand-in for the spawn: records its call and exits on the next turn.
function stubSpawn(calls, { pid = 4242, before = () => {} } = {}) {
  return (file, args, options) => {
    const child = new EventEmitter();
    child.pid = pid;
    calls.push({ file, args, options, held: null });
    before();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };
}

const locate = (w) => treeOf.get(w);
const base = { locate, env: {}, stdin: tty, claude, now, waitMs: 5, startTimeOf: async () => 'Sun Nov  8 02:00:00 2026', print: () => {} };
const wakesOf = (project) => {
  try {
    return fs.readdirSync(wakesDir(project)).filter((n) => n.endsWith('.json')).map((n) => readWake(path.join(wakesDir(project), n)));
  } catch {
    return [];
  }
};

test('helm: only a director at a terminal', () => {
  assert.equal(isDirector({}, tty), true);
  assert.equal(isDirector({ WHEELHOUSE_ROLE: 'feature' }, tty), false);
  assert.equal(isDirector({ CLAUDECODE: '1' }, tty), false);
  assert.equal(isDirector({}, { isTTY: false }), false);
});

test('helm: refuses when not the director', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const spawned = [];
    const out = await openHelm(p, 'login', { ...base, env: { WHEELHOUSE_ROLE: 'feature' }, spawn: stubSpawn(spawned) });
    assert.equal(out.code, 1);
    assert.equal(spawned.length, 0);
    assert.equal(fs.existsSync(holdFile(p, 'login')), false);
  });
});

test('helm: refuses a closed piece', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login', 'closed');
    const spawned = [];
    assert.equal((await openHelm(p, 'login', { ...base, spawn: stubSpawn(spawned) })).code, 1);
    assert.equal((await openHelm(p, 'nothing', { ...base, spawn: stubSpawn(spawned) })).code, 1);
    assert.equal(spawned.length, 0);
    assert.equal(fs.existsSync(holdFile(p, 'login')), false);
  });
});

test('helm: refuses a hold naming another session', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await takeHold(p, { work: 'login', sessionId: 's-other', now });
    const spawned = [];
    const out = await openHelm(p, 'login', { ...base, spawn: stubSpawn(spawned) });
    assert.equal(out.code, 1);
    assert.equal(spawned.length, 0);
    assert.equal(helmHeld(p, 'login'), true);
  });
});

test('helm: waits for a live run', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const running = runningFile(p, 'feature-login');
    fs.mkdirSync(path.dirname(running), { recursive: true });
    fs.writeFileSync(running, JSON.stringify({ state: 'running', pid: process.pid, at: now().toISOString() }));
    const said = [];
    const spawned = [];
    // The run ends while the helm waits, on the helm's own wait rather than a timer.
    const sleep = async () => { fs.rmSync(running, { force: true }); };
    const out = await openHelm(p, 'login', { ...base, sleep, print: (l) => said.push(l), spawn: stubSpawn(spawned, { before: () => assert.equal(fs.existsSync(running), false) }) });
    assert.equal(out.code, 0);
    assert.equal(spawned.length, 1);
    assert.deepEqual(said, ["Waiting for the crew's current step on login to finish…"]);
  });
});

test('helm: a lost race on the hold says the piece is at the helm in another terminal', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const spawned = [];
    // Another terminal takes the hold after this one looked and before it takes it: the clock is read just before the take.
    let raced = false;
    const racingNow = () => {
      if (!raced) {
        raced = true;
        fs.mkdirSync(path.dirname(holdFile(p, 'login')), { recursive: true });
        fs.writeFileSync(holdFile(p, 'login'), '{}\n');
      }
      return now();
    };
    const out = await openHelm(p, 'login', { ...base, now: racingNow, spawn: stubSpawn(spawned) });
    assert.equal(out.code, 1);
    assert.equal(out.why, 'login is already at the helm in another terminal.');
    assert.equal(spawned.length, 0);
  });
});

test('helm: hands back on exit', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const spawned = [];
    const out = await openHelm(p, 'login', { ...base, spawn: stubSpawn(spawned, { before: () => assert.equal(helmHeld(p, 'login'), true) }) });
    assert.equal(out.code, 0);
    assert.equal(spawned[0].args[0], '--resume');
    assert.equal(spawned[0].args[1], 's-1');
    assert.equal(spawned[0].options.stdio, 'inherit');
    assert.equal(helmHeld(p, 'login'), false);
    const kinds = listEvents(stateDir(p), { report: () => {} }).map((e) => e.kind);
    assert.ok(kinds.includes('helm') && kinds.includes('helm-ended'));
    const wakes = wakesOf(p);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].work, 'login');
    assert.equal(wakes[0].events[0].detail.next, PROMPTS.helmBack);
  });
});

test('helm: a second hand-back does nothing', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await openHelm(p, 'login', { ...base, spawn: stubSpawn([]) });
    assert.equal(await handBack(p, 'login', { now }), false);
    assert.equal(wakesOf(p).length, 1);
    assert.equal(listEvents(stateDir(p), { report: () => {} }).filter((e) => e.kind === 'helm-ended').length, 1);
  });
});

test('helm: a hold the front desk took is used, and its piece handed back', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    const out = await openHelm(p, 'login', { ...base, spawn: stubSpawn([]) });
    assert.equal(out.code, 0);
    assert.equal(helmHeld(p, 'login'), false);
    assert.equal(wakesOf(p).length, 1);
  });
});

test('helm: a hand-back reaches wakeFeature with the helmBack wake', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const woken = [];
    const wakerFor = () => ({ wakeFeature: async (work, file) => { woken.push({ work, wake: readWake(file), held: helmHeld(p, work) }); } });
    const out = await openHelm(p, 'login', { ...base, wakerFor, config: {}, spawn: stubSpawn([]) });
    assert.equal(out.code, 0);
    assert.equal(woken.length, 1);
    assert.equal(woken[0].work, 'login');
    assert.equal(woken[0].held, false);
    assert.equal(woken[0].wake.events[0].detail.next, PROMPTS.helmBack);
  });
});

test('helm: a wake that can\'t be delivered is removed and does not change the exit', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const wakerFor = () => ({ wakeFeature: async () => { throw new Error('stopped'); } });
    const out = await openHelm(p, 'login', { ...base, wakerFor, config: {}, spawn: stubSpawn([]) });
    assert.equal(out.code, 0);
    assert.equal(helmHeld(p, 'login'), false);
    assert.equal(wakesOf(p).length, 0);
  });
});

test('helm: Ctrl-C while waiting releases the hold and sends no wake', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const running = runningFile(p, 'feature-login');
    fs.mkdirSync(path.dirname(running), { recursive: true });
    fs.writeFileSync(running, JSON.stringify({ state: 'running', pid: process.pid, at: now().toISOString() }));
    const proc = new EventEmitter();
    const spawned = [];
    const out = await openHelm(p, 'login', { ...base, proc, print: () => proc.emit('SIGINT'), spawn: stubSpawn(spawned) });
    assert.equal(out.code, 1);
    assert.equal(spawned.length, 0);
    assert.equal(helmHeld(p, 'login'), false);
    assert.equal(wakesOf(p).length, 0);
    assert.equal(proc.listenerCount('SIGINT'), 0);
    assert.ok(listEvents(stateDir(p), { report: () => {} }).some((e) => e.kind === 'helm-ended'));
  });
});

test('helm: Ctrl-C while the session runs is left to the session', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const proc = new EventEmitter();
    const out = await openHelm(p, 'login', { ...base, proc, spawn: stubSpawn([], { before: () => proc.emit('SIGINT') }) });
    assert.equal(out.code, 0);
    assert.equal(wakesOf(p).length, 1);
  });
});

test('helm: refuses a worktree the waker does not name', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const spawned = [];
    assert.equal((await openHelm(p, 'login', { ...base, locate: () => null, spawn: stubSpawn(spawned) })).code, 1);
    assert.equal((await openHelm(p, 'login', { ...base, locate: () => tempFolder('wh-other-'), spawn: stubSpawn(spawned) })).code, 1);
    assert.equal(spawned.length, 0);
    assert.equal(fs.existsSync(holdFile(p, 'login')), false);
  });
});

test('helm: a second process handing back the same hold writes no wake and no record', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    const woken = [];
    const wakerFor = () => ({ wakeFeature: async (work) => { woken.push(work); } });
    // Another process is part-way through handing the piece back: it holds the claim.
    const release = claimHandBack(p, 'login');
    assert.equal(typeof release, 'function');
    assert.equal(await handBack(p, 'login', { now, wakerFor, config: {} }), false);
    assert.equal(helmHeld(p, 'login'), true);
    assert.equal(wakesOf(p).length, 0);
    assert.equal(listEvents(stateDir(p), { report: () => {} }).filter((e) => e.kind === 'helm-ended').length, 0);
    release();
    // Once it lets go, a hand-back goes through exactly once, and leaves no claim behind.
    assert.equal(await handBack(p, 'login', { now, wakerFor, config: {} }), true);
    assert.equal(await handBack(p, 'login', { now, wakerFor, config: {} }), false);
    assert.equal(woken.length, 1);
    assert.equal(listEvents(stateDir(p), { report: () => {} }).filter((e) => e.kind === 'helm-ended').length, 1);
    assert.equal(typeof claimHandBack(p, 'login'), 'function');
  });
});

test('helm: the first open starts the session', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await takeHold(p, { work: 'login', sessionId: 's-1', fromStart: true, now });
    const spawned = [];
    const out = await openHelm(p, 'login', { ...base, spawn: stubSpawn(spawned) });
    assert.equal(out.code, 0);
    assert.equal(spawned.length, 1);
    const { args } = spawned[0];
    assert.equal(args[args.indexOf('--session-id') + 1], 's-1');
    assert.equal(args.includes('--resume'), false);
    assert.equal(args.at(-1), firstPrompt(p, 'login'));
    assert.equal(args.at(-2), '--');
    assert.match(args.at(-1), /^Read \.wheelhouse\/feature\/brief\.md and follow it\./);
  });
});

test('helm: with a transcript, a steered piece is resumed', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const config = path.join(tempFolder('wh-claude-'), 'claude');
    fs.mkdirSync(path.join(config, 'projects', 'x'), { recursive: true });
    fs.writeFileSync(path.join(config, 'projects', 'x', 's-1.jsonl'), '{}\n');
    await takeHold(p, { work: 'login', sessionId: 's-1', fromStart: true, now });
    const spawned = [];
    const out = await openHelm(p, 'login', { ...base, env: { CLAUDE_CONFIG_DIR: config }, spawn: stubSpawn(spawned) });
    assert.equal(out.code, 0);
    const { args } = spawned[0];
    assert.equal(args[args.indexOf('--resume') + 1], 's-1');
    assert.equal(args.includes('--session-id'), false);
  });
});

test('helm: now asks the waker to end the held piece\'s run', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    const asked = [];
    const said = [];
    const out = await stopNow(p, 'login', { env: {}, stdin: tty, print: (l) => said.push(l), wakerFor: () => ({ stopRun: async (w) => { asked.push(w); return { stopped: true }; } }) });
    assert.equal(out.code, 0);
    assert.deepEqual(asked, ['login']);
    assert.equal(said.length, 1);
  });
});

test('helm: now refuses an agent, a piece not held, and a piece with no run', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const asked = [];
    const wakerFor = () => ({ stopRun: async () => { asked.push(1); return { stopped: false }; } });
    assert.equal((await stopNow(p, 'login', { env: { WHEELHOUSE_ROLE: 'feature' }, stdin: tty, wakerFor })).code, 1);
    assert.equal((await stopNow(p, 'login', { env: {}, stdin: tty, wakerFor })).code, 1, 'not held');
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    const out = await stopNow(p, 'login', { env: {}, stdin: tty, wakerFor });
    assert.equal(out.code, 1);
    assert.match(out.why, /no run/);
    assert.equal(asked.length, 1, 'only the held piece reached the waker');
  });
});

const idle = { alive: () => false, startTimeOf: async () => null, now };

test('helm: take prints the command when ready', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const out = await takeAtDesk(p, 'login', idle);
    assert.equal(out.code, 0);
    assert.deepEqual(out.lines, [
      'login is ready for you now. Run this to open it:',
      '```bash',
      'node <plugin root>/scripts/crew/helm.js open login',
      '```',
    ]);
    assert.equal(helmHeld(p, 'login'), true);
    assert.equal(readHold(p, 'login').sessionId, 's-1');
    assert.equal(listEvents(stateDir(p), { report: () => {} }).filter((e) => e.kind === 'helm').length, 1);
  });
});

test('helm: take quotes the script for cmd.exe on Windows', () => {
  assert.equal(openCommand('login', { platform: 'win32' }), 'node "<plugin root>/scripts/crew/helm.js" open login');
});

test('helm: take says when it will be ready while a run is live', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    const running = runningFile(p, 'feature-login');
    fs.mkdirSync(path.dirname(running), { recursive: true });
    fs.writeFileSync(running, JSON.stringify({ state: 'running', pid: process.pid, at: now().toISOString() }));
    const out = await takeAtDesk(p, 'login', { ...idle, alive: () => true });
    assert.equal(out.code, 0);
    assert.equal(out.lines[0], 'login will be ready when its current step ends. Run this once it is, or say "now" to stop the step:');
    assert.equal(out.lines[2], 'node <plugin root>/scripts/crew/helm.js open login');
    assert.equal(helmHeld(p, 'login'), true);
  });
});

test('helm: take refuses a closed piece, a held piece, the Bosun and a piece with no session', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'done', 'closed');
    assert.match((await takeAtDesk(p, 'done', idle)).why, /not an open piece/);
    assert.match((await takeAtDesk(p, 'foreman', idle)).why, /Bosun/);
    await writeEvent({ project: p, event: makeEvent({ kind: 'feature', data: { work: 'bare', step: 'building' }, now }), now });
    assert.match((await takeAtDesk(p, 'bare', idle)).why, /no session/);
    await openPiece(p, 'login');
    assert.equal((await takeAtDesk(p, 'login', idle)).code, 0);
    assert.match((await takeAtDesk(p, 'login', idle)).why, /already at the helm/);
    assert.equal(helmHeld(p, 'done'), false);
    assert.equal(helmHeld(p, 'bare'), false);
  });
});

test('helm: steer holds the piece from its start', async () => {
  await withHome(async (p) => {
    const sessions = { featureStartCall: () => ({ file: 'claude', args: [] }) };
    const out = await takeAtDesk(p, 'search', { ...idle, fromStart: true, sessions });
    assert.equal(out.code, 0);
    const hold = readHold(p, 'search');
    assert.equal(hold.fromStart, true);
    assert.equal(hold.sessionId, null);
    assert.equal(out.lines.at(-2), 'node <plugin root>/scripts/crew/helm.js open search');
  });
});

test('helm: steer refuses up front for an agent whose sessions name themselves', async () => {
  await withHome(async (p) => {
    const sessions = { featureStartCall: () => ({ file: 'agent', args: [], idFromRun: true }) };
    assert.equal(steerRefusal(p, 'search', {}, { sessions }), "This agent's sessions name themselves, so a piece can't be steered from its start");
    const out = await takeAtDesk(p, 'search', { ...idle, fromStart: true, sessions });
    assert.equal(out.code, 1);
    assert.match(out.why, /name themselves/);
    assert.equal(helmHeld(p, 'search'), false, 'no hold is left behind');
    assert.equal(listEvents(stateDir(p), { report: () => {} }).filter((e) => e.kind === 'helm').length, 0);
  });
});

test('helm: steer does not refuse the Claude Code agent', async () => {
  await withHome(async (p) => {
    assert.equal(steerRefusal(p, 'search', {}, { claude }), null);
  });
});

test('helm: back refuses while the session is open', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    markOpened(p, 'login', { pid: 4242, startTime: 'Sun Nov  8 02:00:00 2026' });
    const handed = [];
    const wakerFor = () => ({ wakeFeature: async (w) => { handed.push(w); } });
    const open = { alive: () => true, startTimeOf: async () => 'Sun Nov  8 02:00:00 2026', now, wakerFor, config: {} };
    const refused = await backAtDesk(p, 'login', open);
    assert.equal(refused.code, 1);
    assert.equal(refused.why, HELM_STILL_OPEN('login'));
    assert.equal(refused.why, "login's helm session is still open. Leave it with /exit first.");
    assert.equal(helmHeld(p, 'login'), true);
    // The pid is alive but is another process now: the session has gone.
    const reused = await backAtDesk(p, 'login', { ...open, startTimeOf: async () => 'Mon Nov  9 09:00:00 2026' });
    assert.equal(reused.code, 0);
    assert.equal(helmHeld(p, 'login'), false);
    assert.deepEqual(handed, ['login']);
  });
});

test('helm: back hands back a closed session, and releases a helm never opened with no wake', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await openPiece(p, 'search');
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    await takeHold(p, { work: 'search', sessionId: 's-1', now });
    markOpened(p, 'login', { pid: 4242, startTime: 'x' });
    const handed = [];
    const wakerFor = () => ({ wakeFeature: async (w) => { handed.push(w); } });
    const gone = { alive: () => false, startTimeOf: async () => null, now, wakerFor, config: {} };
    assert.equal((await backAtDesk(p, 'login', gone)).code, 0);
    assert.equal((await backAtDesk(p, 'search', gone)).code, 0);
    assert.deepEqual(handed, ['login'], 'only the opened helm is woken');
    assert.match((await backAtDesk(p, 'search', gone)).why, /not at the helm/);
    const ended = listEvents(stateDir(p), { report: () => {} }).filter((e) => e.kind === 'helm-ended').map((e) => e.data.work).sort();
    assert.deepEqual(ended, ['login', 'search']);
  });
});

test('helm: now at the front desk needs no terminal', async () => {
  await withHome(async (p) => {
    await openPiece(p, 'login');
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    const out = await stopNow(p, 'login', { env: { CLAUDECODE: '1' }, stdin: { isTTY: false }, atFrontDesk: true, print: () => {}, wakerFor: () => ({ stopRun: async () => ({ stopped: true }) }) });
    assert.equal(out.code, 0);
  });
});
