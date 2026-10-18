// tests/scripts/lib/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';

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
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-run-')));
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
