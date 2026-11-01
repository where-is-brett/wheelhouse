// tests/probes/85-many-paused/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockErrors, tallyD1 } from '../../../probes/85-many-paused/run.js';

const ask = (runId) => ({ type: 'attention', item: { kind: 'attention', runId, node: 'ask' } });
const answered = (runId) => ({ type: 'answered', runId, node: 'ask' });
const good = () => ({
  expected: ['r1/ask', 'r2/ask'],
  events: [ask('r1'), ask('r2'), answered('r1'), answered('r2')],
  polls: [{ ok: true }, { ok: true }],
  finals: ['completed', 'completed'],
  loopsAlive: 6,
  loopsExpected: 6,
  lockCount: 0,
});

test('lockErrors counts outputs that mention a locked database', () => {
  assert.equal(lockErrors([{ stdout: 'fine', stderr: '' }, { stdout: '', stderr: 'SQLITE_BUSY: database is locked' }, null]), 1);
  assert.equal(lockErrors(undefined), 0);
});

test('tallyD1 passes only when everything was measured and clean', () => {
  assert.equal(tallyD1(good()).pass, true);
});

test('tallyD1 flags a lost answer, a doubled answer and a failed poll', () => {
  const lost = good();
  lost.events = [ask('r1'), ask('r2'), answered('r1')];
  assert.equal(tallyD1(lost).lost, 1);
  const doubled = good();
  doubled.events.push(answered('r1'));
  assert.equal(tallyD1(doubled).doubled, 1);
  const polls = good();
  polls.polls.push({ ok: false });
  const result = tallyD1(polls);
  assert.equal(result.failedPolls, 1);
  assert.equal(result.pass, false);
});

test('tallyD1 fails when nothing was measured', () => {
  assert.equal(tallyD1({}).pass, false);
  const noLockCount = good();
  delete noLockCount.lockCount;
  assert.equal(tallyD1(noLockCount).pass, false);
  const fewLoops = good();
  fewLoops.loopsAlive = 5;
  assert.equal(tallyD1(fewLoops).pass, false);
});
