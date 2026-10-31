// tests/scripts/host/local/queue.test.js
// The local queue's table (spec 7.4), a row a test in its order, and the sweep around it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../../../../scripts/gate/guardrails.js';
import { GATE_ROWS, headReading, localSweep, needsApprovalOf, sweepDecision } from '../../../../scripts/host/local/queue.js';

const CLEAR = { main: 'green', stopped: false, incident: { open: false }, check: 'green', review: true, clashes: false, needsApproval: false, approval: false, permit: { allow: true } };
const decide = (more) => sweepDecision({ ...CLEAR, ...more });

test('a red main line merges nothing', () => {
  assert.deepEqual(decide({ main: 'red' }), { act: 'hold', reason: 'main-red' });
  assert.deepEqual(decide({ main: 'red', incident: { open: true, isFix: true } }), { act: 'hold', reason: 'main-red' }, 'a fix goes by the helper\'s own route');
});

test('All stop merges nothing', () => {
  assert.equal(decide({ stopped: true }).act, 'hold');
  assert.equal(decide({ stopped: undefined }).act, 'hold', 'not known to be off is on');
});

test('an incident merges only its fix', () => {
  assert.equal(decide({ incident: { open: true, isFix: false } }).act, 'hold');
  assert.equal(decide({ incident: { open: true, isFix: true } }).act, 'merge');
  assert.equal(decide({ incident: undefined }).act, 'hold', 'an incident that can\'t be read holds');
});

test('a main line whose check hasn\'t come back waits, so a red names one suspect', () => {
  assert.deepEqual(decide({ main: 'waiting' }), { act: 'wait', reason: 'main-waiting' });
});

test('a check pending or not started waits', () => {
  assert.deepEqual(decide({ check: 'waiting' }), { act: 'wait', reason: 'check-waiting' });
});

test('a red check goes back with reason red', () => {
  assert.deepEqual(decide({ check: 'red' }), { act: 'send-back', reason: 'red' });
});

test('no signed review of the head goes back', () => {
  assert.deepEqual(decide({ review: false }), { act: 'send-back', reason: 'stale' });
});

test('a head that no longer merges goes back with reason clash', () => {
  assert.deepEqual(decide({ clashes: true }), { act: 'send-back', reason: 'clash' });
});

test('a change needing an approval it lacks raises it, and one it has goes on', () => {
  assert.deepEqual(decide({ needsApproval: true }), { act: 'raise', reason: 'approval' });
  assert.equal(decide({ needsApproval: true, approval: true }).act, 'merge');
});

test('a refused permit waits and says why', () => {
  assert.deepEqual(decide({ permit: { allow: false, reason: 'the broker refused' } }), { act: 'wait', reason: 'the broker refused' });
  assert.equal(decide({ permit: undefined }).act, 'wait');
});

test('otherwise it merges', () => {
  assert.deepEqual(decide({}), { act: 'merge', reason: 'merge' });
});

test('the rows say which of Archon\'s files each copies, for the monthly reading', () => {
  assert.deepEqual(GATE_ROWS.map((r) => r.row), ['main-red', 'stopped', 'incident', 'main-waiting', 'check-waiting', 'check-red', 'review-stale', 'clash', 'approval', 'permit', 'merge']);
  for (const row of GATE_ROWS.filter((r) => r.row !== 'main-waiting')) assert.match(row.archon, /merge\.ts|sweep\.md|facts\.ts/);
});

const HEAD = 'a'.repeat(40);
const reading = (records, more = {}) => headReading({ records, head: HEAD, digest: 'd', ...more });
const check = (result, more = {}) => ({ commit: HEAD, command: 'd', result, ...more });

test('not-counted passes only while the project is not counting', () => {
  assert.equal(reading([check('not-counted')], { notCounting: true }), 'green');
  assert.equal(reading([check('not-counted')]), 'waiting');
  assert.equal(sweepDecision({ ...CLEAR, check: reading([check('not-counted')]) }).act, 'wait');
});

test('a head reads its newest check for this command', () => {
  assert.equal(reading([]), 'waiting');
  assert.equal(reading([check('passed', { command: 'old' })]), 'waiting', 'an old command stands for nothing');
  assert.equal(reading([check('failed'), check('passed')]), 'green');
  assert.equal(reading([check('passed'), check('timed-out')]), 'red');
  assert.equal(reading([check('could-not-run')]), 'waiting');
});

test('a change touching .archon needs the director\'s click', () => {
  const config = readConfig(null);
  assert.equal(needsApprovalOf({ paths: ['.archon/config.yaml'], config }), true);
  assert.equal(needsApprovalOf({ paths: ['src/a.js'], config }), false);
  assert.equal(needsApprovalOf({ paths: ['src/pay.js'], config: { ...config, criticalAreas: [{ name: 'money', paths: ['src/pay.js'], checks: [] }] } }), true);
  for (const permit of [{ shownFirst: true }, { level: 4 }, { guardrail: true }]) assert.equal(needsApprovalOf({ permit, paths: ['src/a.js'], config }), true);
});

const open = (n, head = HEAD) => ({ n, head, title: `t${n}` });
function sweep({ changes, ready, facts = {}, about = {} }) {
  const did = [];
  const log = (name) => async (change, reason) => { did.push([name, change.n, ...(typeof reason === 'string' ? [reason] : [])]); };
  return localSweep({
    project: 'shop', lock: (_, fn) => fn(),
    facts: { changes: () => changes, ready: () => ready, moved: async () => false, main: async () => 'green', stopped: () => false, about: async (c) => { const { main: _main, stopped: _stopped, ...rest } = CLEAR; return { ...rest, ...(about[c.n] ?? {}) }; }, ...facts },
    acts: { merge: log('merge'), sendBack: log('back'), raise: log('raise'), wait: log('wait') },
  }).then((done) => ({ done, did }));
}

test('the sweep takes the oldest first, each finding read as its turn comes', async () => {
  let main = 'green';
  const { did } = await sweep({
    changes: [open(1), open(2)], ready: { 1: { head: HEAD, work: 'a' }, 2: { head: HEAD, work: 'b' } },
    facts: { main: async () => { const was = main; main = 'waiting'; return was; } },
  });
  assert.deepEqual(did, [['merge', 1], ['wait', 2, 'main-waiting']]);
});

test('a change not ready, or moved since it was marked, is left to its run', async () => {
  const { did } = await sweep({ changes: [open(1), open(2)], ready: { 2: { head: 'b'.repeat(40), work: 'b' } } });
  assert.deepEqual(did, []);
});

test('a main version moved outside the helper merges nothing', async () => {
  const { did, done } = await sweep({ changes: [open(1)], ready: { 1: { head: HEAD, work: 'a' } }, facts: { moved: async () => true } });
  assert.deepEqual([did, done], [[], []]);
});

test('a hold ends the sweep', async () => {
  const { did, done } = await sweep({ changes: [open(1), open(2)], ready: { 1: { head: HEAD, work: 'a' }, 2: { head: HEAD, work: 'b' } }, facts: { main: async () => 'red' } });
  assert.deepEqual(did, []);
  assert.equal(done.length, 1);
});
