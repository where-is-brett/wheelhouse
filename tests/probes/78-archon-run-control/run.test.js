// tests/probes/78-archon-run-control/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askLedger, tallyE5, disturbanceFor, cursorToSave } from '../../../probes/78-archon-run-control/run.js';

const attention = (runId, node, extra = {}) => ({ type: 'attention', cursor: 'sql:1', item: { kind: 'attention', runId, node, occurrence: `o-${node}`, ...extra } });
const answered = (runId, node) => ({ type: 'answered', runId, node });

test('askLedger counts an ask seen twice once in seen and flags a second answer', () => {
  const ledger = askLedger([
    attention('r1', 'ask-one'),
    attention('r1', 'ask-one'),
    { type: 'bookmark', cursor: 'sql:2' },
    { type: 'resolved', runId: 'r1' },
    answered('r1', 'ask-one'),
    answered('r1', 'ask-one'),
  ]);
  assert.equal(ledger.seen.size, 1);
  assert.equal(ledger.seen.get('r1/ask-one'), 2);
  assert.equal(ledger.answered.size, 1);
  assert.equal(ledger.answered.get('r1/ask-one'), 2);
});

test('askLedger ignores lines that are not asks (usage limits, gates, other types)', () => {
  const ledger = askLedger([
    { type: 'attention', item: { kind: 'usage_limit', runId: 'r1', node: 'n' } },
    { type: 'terminal', runId: 'r1' },
    { type: 'attention' },
    null,
  ]);
  assert.equal(ledger.seen.size, 0);
});

const good = (id) => ({ expected: [`${id}/ask-one`], seen: new Map([[`${id}/ask-one`, 1]]), answered: new Map([[`${id}/ask-one`, 1]]) });

test('tallyE5 passes clean ledgers with a good resume and no leftovers', () => {
  const t = tallyE5({ ledgers: [good('a'), good('b')], resumes: [{ ok: true }], leftovers: [] });
  assert.deepEqual({ lost: t.lost, doubled: t.doubled, resumeOk: t.resumeOk, survivors: t.survivors, pass: t.pass }, { lost: 0, doubled: 0, resumeOk: true, survivors: 0, pass: true });
});

test('tallyE5 counts an ask never seen as lost', () => {
  const l = { expected: ['a/ask-one', 'a/ask-two'], seen: new Map([['a/ask-one', 1]]), answered: new Map([['a/ask-one', 1]]) };
  const t = tallyE5({ ledgers: [l], resumes: [{ ok: true }], leftovers: [] });
  assert.equal(t.lost, 1);
  assert.equal(t.pass, false);
});

test('tallyE5 counts an ask seen but never answered as lost', () => {
  const l = { expected: ['a/ask-one'], seen: new Map([['a/ask-one', 1]]), answered: new Map() };
  assert.equal(tallyE5({ ledgers: [l], resumes: [{ ok: true }], leftovers: [] }).lost, 1);
});

test('tallyE5 counts an ask answered twice as doubled', () => {
  const l = { expected: ['a/ask-one'], seen: new Map([['a/ask-one', 3]]), answered: new Map([['a/ask-one', 2]]) };
  const t = tallyE5({ ledgers: [l], resumes: [{ ok: true }], leftovers: [] });
  assert.equal(t.doubled, 1);
  assert.equal(t.pass, false);
});

test('tallyE5 counts a process alive after cancel as a survivor', () => {
  const t = tallyE5({ ledgers: [good('a')], resumes: [{ ok: true }], leftovers: [{ pid: 123, command: 'sleep 300' }] });
  assert.equal(t.survivors, 1);
  assert.equal(t.pass, false);
});

test('tallyE5 reports a failed resume', () => {
  const t = tallyE5({ ledgers: [good('a')], resumes: [{ ok: false }], leftovers: [] });
  assert.equal(t.resumeOk, false);
  assert.equal(t.pass, false);
});

test('an empty event stream is a failure, not zero lost', () => {
  const empty = askLedger([]);
  const l = { expected: ['a/ask-one'], ...empty };
  assert.equal(tallyE5({ ledgers: [l], resumes: [{ ok: true }], leftovers: [] }).lost, 1);
  const none = tallyE5({ ledgers: [], resumes: [{ ok: true }], leftovers: [] });
  assert.equal(none.pass, false);
  assert.ok(none.lost > 0);
});

test('missing resume or leftover results are a failure, not a pass', () => {
  assert.equal(tallyE5({ ledgers: [good('a')], resumes: [], leftovers: [] }).resumeOk, false);
  assert.equal(tallyE5({ ledgers: [good('a')], resumes: [{ ok: true }] }).pass, false);
});

test('disturbanceFor cycles the three disturbances', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(disturbanceFor), ['follower', 'waker', 'cursor', 'follower', 'waker', 'cursor']);
});

test('cursorToSave keeps the cursor of the last finished event, never the one being handled', () => {
  assert.equal(cursorToSave({ previous: 'sql:3', line: { type: 'attention', cursor: 'sql:5' } }), 'sql:3');
  assert.equal(cursorToSave({ previous: 'sql:3', line: { type: 'bookmark', cursor: 'sql:5' } }), 'sql:5');
  assert.equal(cursorToSave({ previous: 'sql:3', line: { type: 'ready', cursor: 'sql:5' } }), 'sql:5');
  assert.equal(cursorToSave({ previous: null, line: { type: 'attention', cursor: 'sql:5' } }), null);
});
