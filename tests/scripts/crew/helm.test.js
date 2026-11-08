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
import { PROMPTS, readWake, runningFile, sessionFile, wakesDir } from '../../../scripts/watcher/waker.js';
import { takeHold, helmHeld, holdFile } from '../../../scripts/crew/hold.js';
import { openHelm, handBack, isDirector } from '../../../scripts/crew/helm.js';

const claude = { kind: 'direct', file: 'claude' };
const tty = { isTTY: true };
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
  fs.writeFileSync(file, JSON.stringify({ sessionId: 's-1', worktree: tempFolder('wh-tree-') }));
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

const base = { env: {}, stdin: tty, claude, now, waitMs: 5, startTimeOf: async () => 'Sun Nov  8 02:00:00 2026', print: () => {} };
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
    setTimeout(() => fs.rmSync(running, { force: true }), 60);
    const out = await openHelm(p, 'login', { ...base, print: (l) => said.push(l), spawn: stubSpawn(spawned, { before: () => assert.equal(fs.existsSync(running), false) }) });
    assert.equal(out.code, 0);
    assert.equal(spawned.length, 1);
    assert.deepEqual(said, ["Waiting for the crew's current step on login to finish…"]);
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
