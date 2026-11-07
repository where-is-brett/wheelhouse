// tests/scripts/host/helper-decision-status.test.js
// The commit status `wheelhouse/decision` marks a pull request as waiting on a decision (design section 6.4), through each
// host's adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAdapter } from '../../../scripts/host/adapter.js';
import { CLEARED_WORDS, decisionNumbers, setDecisionStatus, waitingWords } from '../../../scripts/host/decision-status.js';
import { DECISION_CONTEXT, STATUS_CONTEXT, isOwnContext } from '../../../scripts/checks/where.js';

const SHA = 'a'.repeat(40);
const ID = 'q-w-tide-1-1';

const recording = (answer = { ok: true }) => {
  const calls = [];
  return { calls, adapter: { setStatus: async (args) => { calls.push(args); return answer; } } };
};
const card = (id, line, n) => ({ id, kind: 'card', at: `2026-11-08T0${n}:00:00.000Z`, data: { kind: 'answer', line, question: `Question ${n}?`, options: ['Daily', 'Weekly'], recommend: 'Weekly' } });

test('a waiting decision sets the status pending, saying which, once for a commit', async () => {
  const { calls, adapter } = recording();
  const posted = new Map();
  const events = () => [card('c1', `Answer question ${ID}`, 1)];
  const got = await setDecisionStatus({ adapter, sha: SHA, waiting: [{ id: ID, why: 'open' }], any: true, events, enrolled: [], posted });
  assert.deepEqual(got, { state: 'pending', description: 'Waiting on decision 1' });
  assert.deepEqual(calls, [{ sha: SHA, state: 'pending', description: 'Waiting on decision 1', context: DECISION_CONTEXT }]);
  assert.equal(DECISION_CONTEXT, 'wheelhouse/decision');
  // Asked again with the same waiting: nothing new is posted.
  assert.equal(await setDecisionStatus({ adapter, sha: SHA, waiting: [{ id: ID, why: 'open' }], any: true, events, enrolled: [], posted }), null);
  assert.equal(calls.length, 1);
});

test('an answered, unapplied decision keeps its number, and nothing waiting clears the status', async () => {
  const { calls, adapter } = recording();
  const posted = new Map();
  const answeredCard = card('c1', `Answer question ${ID}`, 1);
  const events = () => [answeredCard];
  const numbers = decisionNumbers(events(), []);
  assert.equal(numbers.get(ID), 1);
  // A decision that waits on its rework is not "late": only an open or unapplied one marks the pull request.
  assert.equal(await setDecisionStatus({ adapter, sha: SHA, waiting: [{ id: ID, why: 'late' }], any: true, events, enrolled: [], posted }).then((r) => r?.state), 'success');
  assert.deepEqual(calls.at(-1), { sha: SHA, state: 'success', description: CLEARED_WORDS, context: DECISION_CONTEXT });
  // A piece with no decisions at all gets no status.
  assert.equal(await setDecisionStatus({ adapter, sha: 'b'.repeat(40), waiting: [], any: false, events, enrolled: [], posted }), null);
  assert.equal(calls.length, 1);
});

test('the words name several decisions, and fall back to the question\'s own number', () => {
  const numbers = new Map([['q-w-tide-1-1', 2], ['q-w-tide-1-2', 3]]);
  assert.equal(waitingWords(['q-w-tide-1-1'], numbers), 'Waiting on decision 2');
  assert.equal(waitingWords(['q-w-tide-1-2', 'q-w-tide-1-1'], numbers), 'Waiting on decisions 2 and 3');
  assert.equal(waitingWords(['q-w-tide-1-7'], new Map()), 'Waiting on decision 7');
});

test('a host that refuses the status is no error, and is tried again next time', async () => {
  const { calls, adapter } = recording({ refused: 'GitLab projects run their checks on the host' });
  const posted = new Map();
  assert.equal(await setDecisionStatus({ adapter, sha: SHA, waiting: [{ id: ID, why: 'open' }], any: true, events: () => [], enrolled: [], posted }), null);
  assert.equal(await setDecisionStatus({ adapter, sha: SHA, waiting: [{ id: ID, why: 'open' }], any: true, events: () => [], enrolled: [], posted }), null);
  assert.equal(calls.length, 2);
  const throwing = { setStatus: async () => { throw new Error('boom'); } };
  assert.equal(await setDecisionStatus({ adapter: throwing, sha: SHA, waiting: [{ id: ID, why: 'open' }], any: true, events: () => [], enrolled: [], posted }), null);
});

test('GitHub posts it under its own context, and a context of anyone else\'s is refused', async () => {
  const calls = [];
  const run = async (file, args) => { calls.push(args); return { code: 0, stdout: '{}', stderr: '' }; };
  const adapter = makeAdapter({ host: 'github', repo: 'o/p', run, env: {} });
  assert.deepEqual(await adapter.setStatus({ sha: SHA, state: 'pending', description: 'Waiting on decision 1', context: DECISION_CONTEXT }), { ok: true });
  assert.ok(calls[0].includes(`context=${DECISION_CONTEXT}`));
  // Without one it is the check's, as before.
  await adapter.setStatus({ sha: SHA, state: 'success', description: 'Passed' });
  assert.ok(calls[1].includes(`context=${STATUS_CONTEXT}`));
  await assert.rejects(adapter.setStatus({ sha: SHA, state: 'success', description: 'x', context: 'ci/other' }));
  assert.equal(calls.length, 2);
});

test('GitLab reads it as a refusal in plain words: the gate\'s hold is the rule there', async () => {
  const gitlab = makeAdapter({ host: 'gitlab', repo: 'o/p', run: async () => ({ code: 0, stdout: '{}', stderr: '' }), env: {} });
  assert.equal(typeof (await gitlab.setStatus({ sha: SHA, state: 'pending', description: 'Waiting on decision 1', context: DECISION_CONTEXT })).refused, 'string');
});

test('Wheelhouse\'s two contexts both count as its own, so neither reads as another check', () => {
  assert.equal(isOwnContext(STATUS_CONTEXT), true);
  assert.equal(isOwnContext(DECISION_CONTEXT), true);
  assert.equal(isOwnContext('ci/build'), false);
});
