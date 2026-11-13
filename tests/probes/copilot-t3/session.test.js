// tests/probes/copilot-t3/session.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveRequests, startRun } from '../../../probes/copilot-t3/session.js';

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
