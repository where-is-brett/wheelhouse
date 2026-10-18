// tests/scripts/lib/background.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBackground, weeklyDue } from '../../../scripts/lib/background.js';

const ROOT = '/plugin/root';
const NOW = new Date('2026-10-19T01:00:00.000Z');

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-bg-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const sessionFile = (home, id) => path.join(home, 'usage', 'sessions', `${id}.json`);
const recorded = (home, id) => JSON.parse(fs.readFileSync(sessionFile(home, id), 'utf8'));

// A receiver that comes up `delay` ms after it is spawned.
function fakeReceiver({ delay = 20, up = false } = {}) {
  const state = { up, spawns: [] };
  return {
    state,
    health: async () => state.up,
    spawn: (file, args, opts) => {
      state.spawns.push({ file, args, opts });
      setTimeout(() => { state.up = true; }, delay);
      return { unref() {}, on() {} };
    },
  };
}

function feature(home, branch) {
  const tree = path.join(home, 'tree');
  const gitdir = path.join(home, 'main', '.git', 'worktrees', 'tree');
  fs.mkdirSync(tree, { recursive: true });
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, 'HEAD'), `ref: refs/heads/${branch}\n`);
  return tree;
}

test('a session in a feature worktree is recorded as feature work, with its slug', async () => {
  await withHome(async (home) => {
    const tree = feature(home, 'feature/gift-cards');
    const r = fakeReceiver({ up: true });
    await startBackground({ pluginRoot: ROOT, session: 's-feature', cwd: tree, project: 'owner__name', env: {}, spawn: r.spawn, now: () => NOW, health: r.health });
    const part = recorded(home, 's-feature');
    assert.equal(part.role, 'feature');
    assert.equal(part.work, 'gift-cards');
    assert.equal(part.project, 'owner__name');
    assert.equal(part.at, NOW.toISOString());
  });
});

test('WHEELHOUSE_ROLE=foreman records the foreman; anything else is the front desk', async () => {
  await withHome(async (home) => {
    const tree = feature(home, 'main');
    const r = fakeReceiver({ up: true });
    const start = (session, env) => startBackground({ pluginRoot: ROOT, session, cwd: tree, project: 'owner__name', env, spawn: r.spawn, now: () => NOW, health: r.health });
    await start('s-foreman', { WHEELHOUSE_ROLE: 'foreman' });
    await start('s-desk', {});
    await start('s-other', { WHEELHOUSE_ROLE: 'builder' });
    assert.equal(recorded(home, 's-foreman').role, 'foreman');
    assert.equal(recorded(home, 's-foreman').work, undefined);
    assert.equal(recorded(home, 's-desk').role, 'front-desk');
    assert.equal(recorded(home, 's-other').role, 'front-desk');
    // The foreman is recorded as the foreman even in a feature's folder.
    const inFeature = feature(home, 'feature/x');
    await startBackground({ pluginRoot: ROOT, session: 's-both', cwd: inFeature, project: 'owner__name', env: { WHEELHOUSE_ROLE: 'foreman' }, spawn: r.spawn, now: () => NOW, health: r.health });
    assert.equal(recorded(home, 's-both').role, 'foreman');
  });
});

test('a session that can\'t be recorded does not stop the receiver being started', async () => {
  await withHome(async () => {
    const r = fakeReceiver();
    const out = await startBackground({ pluginRoot: ROOT, session: 'bad/id', cwd: '/x', project: 'owner__name', env: {}, spawn: r.spawn, now: () => NOW, health: r.health });
    assert.equal(out.receiver, 'started');
  });
});

test('the receiver is started only when its health check does not answer', async () => {
  await withHome(async (home) => {
    const answering = fakeReceiver({ up: true });
    const first = await startBackground({ pluginRoot: ROOT, session: 's1', cwd: '/x', project: 'owner__name', env: {}, spawn: answering.spawn, now: () => NOW, health: answering.health });
    assert.deepEqual(first, { receiver: 'running', weekly: 'not-due' });
    assert.equal(answering.state.spawns.length, 0);

    const silent = fakeReceiver();
    const second = await startBackground({ pluginRoot: ROOT, session: 's2', cwd: '/x', project: 'owner__name', env: {}, spawn: silent.spawn, now: () => NOW, health: silent.health });
    assert.deepEqual(second, { receiver: 'started', weekly: 'not-due' });
    assert.equal(silent.state.spawns.length, 1);
    const [call] = silent.state.spawns;
    assert.equal(call.file, process.execPath);
    assert.deepEqual(call.args, [path.join(ROOT, 'scripts', 'telemetry', 'main.js')]);
    assert.equal(call.opts.detached, true);
    assert.equal(call.opts.windowsHide, true);
    assert.equal(call.opts.stdio, 'ignore');
    assert.equal(call.opts.cwd, home);
    // The lock is not left behind.
    assert.equal(fs.existsSync(path.join(home, 'usage', 'receiver.lock')), false);
  });
});

test('the health check asks the port in usage/receiver.json, or the usual one', async () => {
  await withHome(async (home) => {
    const asked = [];
    const health = async (port) => { asked.push(port); return true; };
    await startBackground({ pluginRoot: ROOT, session: 's1', cwd: '/x', project: 'owner__name', env: {}, spawn: () => null, now: () => NOW, health });
    fs.writeFileSync(path.join(home, 'usage', 'receiver.json'), JSON.stringify({ port: 23456 }));
    await startBackground({ pluginRoot: ROOT, session: 's2', cwd: '/x', project: 'owner__name', env: {}, spawn: () => null, now: () => NOW, health });
    assert.deepEqual(asked, [14318, 23456]);
  });
});

test('two session starts at once start one receiver', async () => {
  await withHome(async () => {
    const r = fakeReceiver({ delay: 150 });
    const start = (session) => startBackground({ pluginRoot: ROOT, session, cwd: '/x', project: 'owner__name', env: {}, spawn: r.spawn, now: () => NOW, health: r.health });
    const results = await Promise.all([start('a'), start('b'), start('c')]);
    assert.equal(r.state.spawns.length, 1);
    assert.deepEqual(results.map((x) => x.receiver).sort(), ['running', 'running', 'started']);
  });
});

test('startBackground keeps within one second when spawning hangs', async () => {
  await withHome(async () => {
    // Nothing ever answers, and the child never reports anything.
    const began = Date.now();
    const out = await startBackground({
      pluginRoot: ROOT, session: 's1', cwd: '/x', project: 'owner__name', env: {},
      spawn: () => ({ unref() {}, on() {} }), now: () => NOW, health: () => new Promise(() => {}),
    });
    assert.ok(Date.now() - began < 1200, `took ${Date.now() - began} ms`);
    assert.equal(out.receiver, 'failed');
    assert.equal(out.weekly, 'not-due');
  });
});

test('a spawn that throws is a failure to start, not an error', async () => {
  await withHome(async () => {
    const out = await startBackground({
      pluginRoot: ROOT, session: 's1', cwd: '/x', project: 'owner__name', env: {},
      spawn: () => { throw new Error('no'); }, now: () => NOW, health: async () => false,
    });
    assert.equal(out.receiver, 'failed');
  });
});

test('the weekly job is started only when it is due; until it is built it never is', async () => {
  await withHome(async () => {
    assert.equal(weeklyDue(NOW), false);
    const r = fakeReceiver({ up: true });
    const base = { pluginRoot: ROOT, session: 's1', cwd: '/x', project: 'owner__name', env: {}, spawn: r.spawn, now: () => NOW, health: r.health };
    assert.equal((await startBackground(base)).weekly, 'not-due');
    assert.equal(r.state.spawns.length, 0);
    const out = await startBackground({ ...base, weeklyDue: () => true });
    assert.equal(out.weekly, 'started');
    assert.equal(r.state.spawns.length, 1);
    assert.deepEqual(r.state.spawns[0].args, [path.join(ROOT, 'scripts', 'jobs', 'weekly-main.js')]);
    assert.equal(r.state.spawns[0].opts.detached, true);
  });
});
