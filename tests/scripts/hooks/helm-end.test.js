// tests/scripts/hooks/helm-end.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from '../../../scripts/hooks/helm-end.js';
import { takeHold, helmHeld, markOpened } from '../../../scripts/crew/hold.js';
import { readWake } from '../../../scripts/watcher/waker.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

const SCRIPT = fileURLToPath(new URL('../../../scripts/hooks/helm-end.js', import.meta.url));
const P = 'o__p';

async function withHome(fn) {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = path.join(tempFolder('wh-helm-end-'), 'home');
  try {
    await openTestRecord({ project: P });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

const input = (sessionId) => ({ hook_event_name: 'SessionEnd', session_id: sessionId, cwd: '/tmp/anywhere', reason: 'prompt_input_exit' });
const deps = (woken, over = {}) => ({
  find: () => ({ project: P }),
  roleOf: () => 'feature',
  env: {},
  wakerFor: () => ({ wakeFeature: async (work, file) => { woken.push({ work, wake: readWake(file) }); } }),
  ...over,
});

test('helm-end: hands back the held session', async () => {
  await withHome(async () => {
    await takeHold(P, { work: 'login', sessionId: 's-1' });
    const woken = [];
    await decide(input('s-1'), deps(woken));
    assert.equal(helmHeld(P, 'login'), false);
    assert.equal(woken.length, 1);
    assert.equal(woken[0].work, 'login');
  });
});

test('helm-end: leaves a hold whose helm process is alive, and hands back one whose helm process is gone', async () => {
  await withHome(async () => {
    await takeHold(P, { work: 'login', sessionId: 's-1' });
    markOpened(P, 'login', { pid: 4242, startTime: null, holder: 9999 });
    const woken = [];
    await decide(input('s-1'), deps(woken, { alive: (pid) => pid === 9999 }));
    assert.equal(helmHeld(P, 'login'), true);
    assert.equal(woken.length, 0);
    await decide(input('s-1'), deps(woken, { alive: () => false }));
    assert.equal(helmHeld(P, 'login'), false);
    assert.equal(woken.length, 1);
  });
});

test('helm-end: ignores another session', async () => {
  await withHome(async () => {
    await takeHold(P, { work: 'login', sessionId: 's-1' });
    const woken = [];
    await decide(input('s-2'), deps(woken));
    assert.equal(helmHeld(P, 'login'), true);
    assert.equal(woken.length, 0);
  });
});

test('helm-end: ignores a session that is not a feature session', async () => {
  await withHome(async () => {
    await takeHold(P, { work: 'login', sessionId: 's-1' });
    const woken = [];
    await decide(input('s-1'), deps(woken, { roleOf: () => 'front-desk' }));
    assert.equal(helmHeld(P, 'login'), true);
    assert.equal(woken.length, 0);
  });
});

test('helm-end: does nothing outside a project, for a why session, or on another event', async () => {
  await withHome(async () => {
    await takeHold(P, { work: 'login', sessionId: 's-1' });
    const woken = [];
    await decide(input('s-1'), deps(woken, { find: () => null }));
    await decide(input('s-1'), deps(woken, { env: { WHEELHOUSE_ROLE: 'why' } }));
    await decide({ ...input('s-1'), hook_event_name: 'Stop' }, deps(woken));
    assert.equal(helmHeld(P, 'login'), true);
    assert.equal(woken.length, 0);
  });
});

test('helm-end: an error does nothing and is not thrown', async () => {
  await withHome(async () => {
    await takeHold(P, { work: 'login', sessionId: 's-1' });
    const out = await decide(input('s-1'), deps([], { find: () => { throw new Error('boom'); } }));
    assert.equal(out, undefined);
    assert.equal(helmHeld(P, 'login'), true);
  });
});

test('helm-end: exits 0 on bad input', () => {
  const home = tempFolder('wh-helm-end-proc-');
  for (const stdin of ['{', '', '[]', '{"hook_event_name":"SessionEnd"}']) {
    const run = spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: home } });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '');
  }
  assert.ok(fs.existsSync(SCRIPT));
});
