// tests/probes/copilot-t3/session.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveRequests, readRun, startRun } from '../../../probes/copilot-t3/session.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-session.js');
const call = (dir) => ({ file: process.execPath, args: [FAKE, 'hang', path.join(dir, 'u.json'), '0'], env: process.env, input: '', verbatim: false, output: path.join(dir, 'o'), usageFile: path.join(dir, 'u.json'), sessionId: 's' });

test('on Windows the kill takes the run\'s whole process tree, by the id of the process the runner started', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-kill-'));
  const seen = [];
  const handle = startRun(call(dir), { cwd: dir, platform: 'win32', killTree: (pid) => { seen.push(pid); process.kill(pid, 'SIGKILL'); return true; } });
  handle.kill();
  const end = await handle.done;
  assert.deepEqual(seen, [handle.pid]);
  assert.equal(end.killed, true);
});

test('off Windows the kill ends the child itself and asks for no tree kill', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-kill-'));
  let asked = false;
  const handle = startRun(call(dir), { cwd: dir, platform: 'linux', killTree: () => { asked = true; return true; } });
  handle.kill();
  await handle.done;
  assert.equal(asked, false);
});

test('a run\'s spend is read from its latest checkpoint, or its result', () => {
  const line = (e) => `${JSON.stringify(e)}\n`;
  assert.equal(liveRequests(''), null);
  assert.equal(liveRequests(line({ type: 'session.usage_checkpoint', data: { accountingSnapshot: { totalPremiumRequestCost: 2 } } }) + line({ type: 'session.usage_checkpoint', data: { accountingSnapshot: { totalPremiumRequestCost: 3 } } })), 3);
  assert.equal(liveRequests(line({ type: 'result', usage: { premiumRequests: 5 } })), 5);
});

test('a run is settled on the larger of the result\'s count and the checkpoint\'s cost, the figure the cap reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-read-'));
  const lines = [{ type: 'session.usage_checkpoint', data: { accountingSnapshot: { totalPremiumRequestCost: 5 } } }, { type: 'result', usage: { premiumRequests: 3 } }];
  fs.writeFileSync(path.join(dir, 'o'), lines.map((e) => `${JSON.stringify(e)}\n`).join(''));
  const run = readRun({ read: () => fs.readFileSync(path.join(dir, 'o'), 'utf8'), usageFile: path.join(dir, 'none.json') });
  assert.equal(run.cumulative, 5);
  assert.equal(run.checkpoints, true);
  assert.equal(liveRequests(lines.map((e) => `${JSON.stringify(e)}\n`).join('')), 5);
});

const GRANDCHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'grandchild.js');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('off Windows the kill takes the run\'s grandchild too, and the run is done only once it has gone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-tree-'));
  const pidFile = path.join(dir, 'grandchild');
  const handle = startRun({ file: process.execPath, args: [GRANDCHILD, pidFile], env: process.env, input: '', verbatim: false, output: path.join(dir, 'o'), usageFile: path.join(dir, 'u.json'), sessionId: 's' }, { cwd: dir, platform: process.platform, graceMs: 200 });
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i += 1) await new Promise((r) => setTimeout(r, 50));
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(alive(grandchild));
  handle.kill();
  const end = await handle.done;
  assert.equal(end.killed, true);
  assert.equal(alive(grandchild), false);
});

test('a run that ignores SIGTERM is ended by SIGKILL after the grace', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-term-'));
  const script = path.join(dir, 'stubborn.js');
  fs.writeFileSync(script, "process.on('SIGTERM', () => {}); process.stdout.write('x\\n'); setInterval(() => {}, 1000);\n");
  const handle = startRun({ file: process.execPath, args: [script], env: process.env, input: '', verbatim: false, output: path.join(dir, 'o'), usageFile: path.join(dir, 'u.json'), sessionId: 's' }, { cwd: dir, platform: process.platform, graceMs: 200 });
  await new Promise((r) => setTimeout(r, 300));
  handle.kill();
  const end = await handle.done;
  assert.equal(end.signal, 'SIGKILL');
  assert.equal(alive(handle.pid), false);
});
