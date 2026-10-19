// tests/scripts/lib/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import { tempFolder } from '../../helpers/homes.js';

test('run returns code, stdout and stderr, and never uses a shell', async () => {
  const ok = await run(process.execPath, ['-e', 'console.log("a b")']);
  assert.deepEqual(ok, { code: 0, stdout: 'a b\n', stderr: '' });

  const bad = await run(process.execPath, ['-e', 'console.error("oops"); process.exit(3)']);
  assert.equal(bad.code, 3);
  assert.equal(bad.stderr, 'oops\n');

  // With a shell, "$HOME; echo x" would expand or split; without one it arrives verbatim.
  const literal = await run(process.execPath, ['-e', 'console.log(process.argv[1])', '$HOME; echo x']);
  assert.equal(literal.stdout, '$HOME; echo x\n');
});

test('run merges env over process.env', async () => {
  process.env.WH_RUN_TEST_KEPT = 'kept';
  try {
    const r = await run(process.execPath, ['-e', 'console.log(process.env.WH_RUN_TEST_KEPT + process.env.WH_RUN_TEST_NEW)'], {
      env: { WH_RUN_TEST_NEW: '+new' },
    });
    assert.equal(r.stdout, 'kept+new\n');
  } finally {
    delete process.env.WH_RUN_TEST_KEPT;
  }
});

test('run writes input to stdin and closes it', async () => {
  const r = await run(process.execPath, ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.toUpperCase()))'], {
    input: 'hello',
  });
  assert.equal(r.stdout, 'HELLO\n');
});

test('run uses the given cwd', async () => {
  const dir = fs.realpathSync(tempFolder('wh-run-'));
  assert.notEqual(dir, fs.realpathSync(process.cwd()));
  const r = await run(process.execPath, ['-e', 'console.log(process.cwd())'], { cwd: dir });
  assert.equal(r.stdout.trim(), dir);
});

test('run rejects when the program cannot be started', async () => {
  await assert.rejects(run('wheelhouse-no-such-program', []));
});

test('run kills a program that outlives its timeout', async () => {
  const started = Date.now();
  const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.equal(r.code, 1);
  assert.ok(Date.now() - started < 5000);
  const quick = await run(process.execPath, ['-e', 'console.log("done")'], { timeoutMs: 10000 });
  assert.equal(quick.stdout, 'done\n');
  assert.equal(quick.timedOut, undefined);
});

test('run takes a base environment in place of process.env, and withoutGitVars drops GIT_*', async () => {
  const base = withoutGitVars({ PATH: process.env.PATH, GIT_DIR: '/x', git_ssh_command: 'y', HOME: 'h' });
  assert.deepEqual(base, { PATH: process.env.PATH, HOME: 'h' });
  const r = await run(process.execPath, ['-e', 'console.log(JSON.stringify([process.env.GIT_DIR ?? null, process.env.A]))'], { baseEnv: base, env: { A: 'b' } });
  assert.equal(r.stdout.trim(), '[null,"b"]');
});

test('run keeps at most about `limit` bytes of the newest output from each stream', async () => {
  const code = 'process.stdout.write("a".repeat(500000)); process.stdout.write("END"); process.stderr.write("b".repeat(500000)); process.stderr.write("FIN")';
  const capped = await run(process.execPath, ['-e', code], { limit: 64 * 1024 });
  assert.ok(capped.stdout.length <= 128 * 1024 && capped.stdout.endsWith('END'));
  assert.ok(capped.stderr.length <= 128 * 1024 && capped.stderr.endsWith('FIN'));
  const whole = await run(process.execPath, ['-e', code]);
  assert.equal(whole.stdout.length, 500003, 'with no limit everything is kept');
});

// ---- Task 16 ----

test('run can unset a variable', async () => {
  const show = ['-e', 'process.stdout.write(JSON.stringify([process.env.WH_SET, process.env.WH_OTHER ?? null]))'];
  const kept = await run(process.execPath, show, { baseEnv: { ...process.env, WH_SET: 'from-base', WH_OTHER: 'x' }, env: { WH_OTHER: 'y' } });
  assert.deepEqual(JSON.parse(kept.stdout), ['from-base', 'y']);
  for (const gone of [undefined, null]) {
    const result = await run(process.execPath, show, { baseEnv: { ...process.env, WH_SET: 'from-base' }, env: { WH_SET: gone } });
    assert.deepEqual(JSON.parse(result.stdout), [null, null], 'unset, not the string "undefined"');
  }
});

test('on Windows a timed-out command is killed with its children', async () => {
  const sent = [];
  const killer = (file, args) => { sent.push({ file, args }); };
  const sleeper = ['-e', 'setInterval(() => {}, 1000)'];
  const result = await run(process.execPath, sleeper, { timeoutMs: 100, platform: 'win32', killer });
  assert.equal(result.timedOut, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].file, 'taskkill');
  assert.deepEqual(sent[0].args.slice(0, 1), ['/pid']);
  assert.match(sent[0].args[1], /^\d+$/);
  assert.deepEqual(sent[0].args.slice(2), ['/T', '/F']);
  // Anywhere else the child alone is killed, and no taskkill is run.
  sent.length = 0;
  await run(process.execPath, sleeper, { timeoutMs: 100, platform: 'linux', killer });
  assert.deepEqual(sent, []);
});

test('run gives stdout as bytes with encoding buffer', async () => {
  const result = await run(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0, 255, 104, 105]))'], { encoding: 'buffer' });
  assert.equal(result.code, 0);
  assert.ok(Buffer.isBuffer(result.stdout));
  assert.deepEqual([...result.stdout], [0, 255, 104, 105]);
});

test('run ends a program when its signal is aborted, and says it was stopped', async () => {
  const started = Date.now();
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 100);
  const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 10000, signal: stop.signal });
  assert.equal(r.stopped, true);
  assert.equal(r.code, 1);
  assert.equal(r.timedOut, undefined);
  assert.ok(Date.now() - started < 5000);

  // A signal aborted before the start stops the program at once; one never aborted changes nothing.
  const early = await run(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeoutMs: 10000, signal: AbortSignal.abort() });
  assert.equal(early.stopped, true);
  const quiet = await run(process.execPath, ['-e', 'console.log("done")'], { signal: new AbortController().signal });
  assert.deepEqual(quiet, { code: 0, stdout: 'done\n', stderr: '' });
});

test('on Windows a stopped command is killed with its children', async () => {
  const sent = [];
  const killer = (file, args) => { sent.push({ file, args }); };
  const r = await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 10000, signal: AbortSignal.timeout(100), platform: 'win32', killer });
  assert.equal(r.stopped, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].file, 'taskkill');
  assert.deepEqual(sent[0].args.slice(2), ['/T', '/F']);
});
