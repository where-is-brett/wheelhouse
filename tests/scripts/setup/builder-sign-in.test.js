// tests/scripts/setup/builder-sign-in.test.js
// The builder sign-in check, the re-check that clears the fact, and the hourly look (builders design, sections 10.1 and 10.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builderSignInCheck, recheckRoute, makeHourlyRecheck, CHECK_WAIT_MS, CHECK_PROMPT } from '../../../scripts/setup/builder-sign-in.js';
import { writeSignInFact, readSignIn, gateFor } from '../../../scripts/lib/sign-in-gate.js';
import { tempFolder } from '../../helpers/homes.js';

const ROUTE = 'claude-code:background';
const fact = () => ({ kind: 'not-signed-in', since: new Date(2026, 10, 24, 14, 2).toISOString(), command: 'claude', excerpt: 'Not logged in', starts: 1 });
// A fake program that is found, so no real claude is looked for.
const FOUND = () => ({ kind: 'direct', file: '/usr/bin/fake-claude', command: '/usr/bin/fake-claude', args: [] });
const ran = (got) => async (file, args, opts) => { ran.last = { file, args, opts }; return { code: 0, stdout: '', stderr: '', ...got }; };
const check = (got, over = {}) => builderSignInCheck({ home: '/unused', run: ran(got), resolve: FOUND, env: {}, ...over });

test('a fake claude that prints ready and exits 0 passes, started the way the waker starts a builder', async () => {
  const got = await check({ stdout: 'ready\n' });
  assert.deepEqual(got, { ok: true });
  const { file, args, opts } = ran.last;
  assert.equal(file, '/usr/bin/fake-claude');
  assert.deepEqual(args, ['-p', CHECK_PROMPT, '--allowedTools', '', '--max-turns', '1']);
  assert.equal(opts.timeoutMs, CHECK_WAIT_MS);
  assert.equal(CHECK_WAIT_MS, 90_000);
  assert.equal(fs.existsSync(path.join(opts.cwd, '.git')), false, 'the folder is not a repository');
  assert.equal(fs.existsSync(opts.cwd), false, 'and it is removed after');
});

test('one that prints "Not logged in" fails as not-signed-in, and the line quotes the kind, never the raw output', async () => {
  const got = await check({ code: 1, stdout: 'Not logged in. sk-ant-api03-SECRETSECRETSECRET', stderr: '' });
  assert.equal(got.ok, false);
  assert.equal(got.kind, 'not-signed-in');
  assert.equal(got.line, "A builder started as `fake-claude` couldn't sign in: it said it isn't logged in.");
  assert.doesNotMatch(got.line, /SECRET|Not logged in/);
});

test('an exit 0 with no "ready", a missing program and a launch command that cannot be used each fail by kind', async () => {
  assert.equal((await check({ stdout: 'hello' })).kind, 'other');
  const gone = await builderSignInCheck({
    home: '/unused', resolve: FOUND, env: {}, run: async () => { throw Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }); },
  });
  assert.equal(gone.kind, 'no-program');
  const bad = await builderSignInCheck({ home: '/unused', env: {}, launch: ['definitely-not-a-program-xyz'], run: ran({}) });
  assert.equal(bad.kind, 'no-program');
});

test('a fake that never answers fails at 90 seconds', async () => {
  const got = await check({ code: 1, timedOut: true });
  assert.equal(got.ok, false);
  assert.equal(got.kind, 'other');
  assert.equal(ran.last.opts.timeoutMs, 90_000);
});

test('the desktop route is part 6\'s: not built yet', async () => {
  assert.deepEqual(await builderSignInCheck({ home: '/unused', route: 'desktop' }), { ok: false, kind: 'other', line: 'not built yet' });
});

test('a passing check clears the fact and opens the gate for the queued wakes; a failing one keeps it', async () => {
  const home = tempFolder('wh-bsi-');
  writeSignInFact(home, ROUTE, fact());
  const failed = await recheckRoute({ home, check: async () => ({ ok: false, kind: 'not-signed-in', line: 'x' }) });
  assert.equal(failed.ok, false);
  assert.equal(readSignIn(home).facts[ROUTE].starts, 1, 'kept as it was');
  assert.equal(gateFor(home, ROUTE).open, false);
  const passed = await recheckRoute({ home, check: async () => ({ ok: true }) });
  assert.deepEqual(passed, { ok: true, cleared: true });
  assert.deepEqual(readSignIn(home).facts, {});
  assert.equal(gateFor(home, ROUTE).open, true);
});

test('the hourly re-check runs only while a fact stands, at most once an hour, and not under STOP', async () => {
  const home = tempFolder('wh-bsi-');
  let clock = Date.parse('2026-11-24T10:00:00Z');
  let calls = 0;
  let stop = false;
  const seen = [];
  const tick = makeHourlyRecheck({
    home: () => home, now: () => new Date(clock), stopped: () => stop, launchFor: () => ['wrap', 'claude'],
    check: async (args) => { calls += 1; seen.push(args.launch); return { ok: false, kind: 'not-signed-in', line: 'x' }; },
  });
  assert.equal((await tick()).why, 'no fact');
  assert.equal(calls, 0);
  writeSignInFact(home, ROUTE, fact());
  stop = true;
  assert.equal((await tick()).why, 'stop');
  assert.equal(calls, 0, 'STOP freezes the re-check');
  stop = false;
  assert.equal((await tick()).ran, true);
  assert.equal(calls, 1);
  assert.deepEqual(seen[0], ['wrap', 'claude']);
  clock += 59 * 60 * 1000;
  assert.equal((await tick()).why, 'not due');
  clock += 2 * 60 * 1000;
  assert.equal((await tick()).ran, true);
  assert.equal(calls, 2);
  writeSignInFact(home, 'claude-code:desktop', fact());
  assert.equal(readSignIn(home).facts['claude-code:desktop'] !== undefined, true);
  const pass = makeHourlyRecheck({ home: () => home, now: () => new Date(clock), stopped: () => false, check: async () => ({ ok: true }) });
  const done = await pass();
  assert.equal(done.done[0].cleared, true);
  assert.equal(gateFor(home, ROUTE).open, true);
  assert.equal(gateFor(home, 'claude-code:desktop').open, false, 'a fact on another route is left alone');
});

test('a launch command that cannot be read keeps the fact and runs no check', async () => {
  const home = tempFolder('wh-bsi-');
  writeSignInFact(home, ROUTE, fact());
  let calls = 0;
  const tick = makeHourlyRecheck({
    home: () => home, stopped: () => false, launchFor: () => { throw new Error('unreadable'); }, check: async () => { calls += 1; return { ok: true }; },
  });
  const got = await tick();
  assert.equal(calls, 0);
  assert.equal(got.done[0].ok, false);
  assert.equal(gateFor(home, ROUTE).open, false);
});
