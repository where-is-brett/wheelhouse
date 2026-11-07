// tests/scripts/decisions/why-copy.test.js
// The kept copy of a why session, the run's limit and how a run that won't stop is ended. No test starts a real claude process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { askWhy, forkFile, runCall, WHY_LIMIT_MS } from '../../../scripts/decisions/why.js';
import { inHome, P, raiseBuildQuestion, keep } from '../../helpers/decisions-world.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { sessionFile, writeJsonFile } from '../../../scripts/watcher/waker.js';
import { composeCard, answerInput } from '../../../scripts/cards/compose.js';

const BUILDER = '11111111-2222-3333-4444-555555555555';
const FORK_1 = '66666666-7777-8888-9999-000000000001';
const FORK_2 = '66666666-7777-8888-9999-000000000002';
const AT = '2026-11-08T01:00:00.000Z';
const reply = (answer, fork) => ({ code: 0, stdout: JSON.stringify({ type: 'result', result: answer, session_id: fork }), stderr: '' });

function world(home) {
  const tree = fs.mkdtempSync(path.join(home, 'tree-'));
  const id = raiseBuildQuestion('q-w-tide-1-1', AT).id;
  fs.mkdirSync(path.dirname(sessionFile(P, 'w-tide-1')), { recursive: true });
  writeJsonFile(sessionFile(P, 'w-tide-1'), { sessionId: BUILDER, worktree: tree, at: AT });
  return { tree, id };
}

const resumed = (call) => call.args[call.args.indexOf('--resume') + 1];

test('the limit stays under the two minutes of the shell command that runs it', () => {
  assert.ok(WHY_LIMIT_MS <= 100 * 1000);
});

test('a piece with no session kept is told apart from one that has finished', async () => {
  await inHome(async () => {
    const id = raiseBuildQuestion('q-w-tide-1-1', AT).id;
    const none = await askWhy({ project: P, id, run: async () => reply('x', FORK_1) });
    assert.match(none.fallback, /No session is kept/);
    assert.doesNotMatch(none.fallback, /has finished/);
    keep(makeEvent({ kind: 'report', data: { work: 'w-tide-1', outcome: 'merged', summary: 'Done.', rulings: [], pr: 5 }, now: () => new Date('2026-11-08T03:00:00.000Z') }));
    const done = await askWhy({ project: P, id, run: async () => reply('x', FORK_1) });
    assert.match(done.fallback, /has finished/);
  });
});

test('the copy is kept by decision id and reused only for the session kept now', async () => {
  await inHome(async (home) => {
    const { tree, id } = world(home);
    const seen = [];
    await askWhy({ project: P, id, run: async (c) => { seen.push(c); return reply('First.', FORK_1); } });
    assert.equal(JSON.parse(fs.readFileSync(forkFile(P, id), 'utf8')).session, BUILDER);
    await askWhy({ project: P, id, run: async (c) => { seen.push(c); return reply('Again.', FORK_2); } });
    assert.equal(resumed(seen[1]), FORK_1, 'the same session: the copy is resumed');
    // The piece's session is replaced: the old copy is of a session that is gone, so a fresh copy of the new one starts.
    const NEW = 'aaaaaaaa-2222-3333-4444-555555555555';
    writeJsonFile(sessionFile(P, 'w-tide-1'), { sessionId: NEW, worktree: tree, at: AT });
    await askWhy({ project: P, id, run: async (c) => { seen.push(c); return reply('Fresh.', FORK_1); } });
    assert.equal(resumed(seen[2]), NEW);
  });
});

test('a copy of one decision is never used for another that has the same number', async () => {
  await inHome(async (home) => {
    const { id } = world(home);
    const seen = [];
    await askWhy({ project: P, id, run: async (c) => { seen.push(c); return reply('First.', FORK_1); } });
    const data = { id: 'q-w-tide-1-2', work: 'w-tide-1', what: 'Another?', why: 'Because.', options: [{ label: 'A', says: 'a' }, { label: 'B', says: 'b' }], recommendation: 'A', level: 3 };
    keep(makeEvent({ kind: 'question', data, now: () => new Date('2026-11-08T02:00:00.000Z') }));
    const { card } = composeCard(answerInput(data, 'w-tide-1'));
    const second = keep(makeEvent({ kind: 'card', data: card, now: () => new Date('2026-11-08T02:00:01.000Z') }));
    assert.notEqual(forkFile(P, second.id), forkFile(P, id));
    await askWhy({ project: P, id: second.id, run: async (c) => { seen.push(c); return reply('Other.', FORK_2); } });
    assert.equal(resumed(seen[1]), BUILDER, "another decision forks the building session, never the first one's copy");
  });
});

test('the copy\'s file goes once its decision no longer waits', async () => {
  await inHome(async (home) => {
    const { id } = world(home);
    await askWhy({ project: P, id, run: async () => reply('First.', FORK_1) });
    assert.equal(fs.existsSync(forkFile(P, id)), true);
    const got = await askWhy({ project: P, id, read: () => [], run: async () => reply('never', FORK_2) });
    assert.match(got.fallback, /isn't waiting any more/);
    assert.equal(fs.existsSync(forkFile(P, id)), false);
  });
});

test('runCall ends a child that ignores SIGTERM, with the process it started, and lets go', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'why-run-'));
  const pidFile = path.join(dir, 'grandchild.pid');
  const script = path.join(dir, 'stubborn.cjs');
  fs.writeFileSync(script, `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const g = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'inherit' });
    require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
    console.log('started');
    setInterval(() => {}, 1000);
  `);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const controller = new AbortController();
  const began = Date.now();
  const running = runCall({ file: process.execPath, args: [script], cwd: dir, env: process.env, input: '' }, { signal: controller.signal, graceMs: 200 });
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 50));
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(alive(grandchild));
  controller.abort();
  const got = await running;
  assert.equal(got.timedOut, true);
  assert.ok(Date.now() - began < 5000);
  for (let i = 0; i < 60 && alive(grandchild); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(grandchild), false, 'the process the child started was killed too');
  fs.rmSync(dir, { recursive: true, force: true });
});
