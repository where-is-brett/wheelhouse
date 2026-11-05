// tests/scripts/watcher/stuck-cards.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { raiseStuckCards } from '../../../scripts/watcher/stuck-cards.js';
import { watcherDir, wakesDir, writeWake } from '../../../scripts/watcher/waker.js';
import { recordDone } from '../../../scripts/foreman/wake.js';
import { withHome } from '../../helpers/homes.js';
import { questionProblem } from '../../../scripts/cards/compose.js';
import { stuckQuestion, askExample, stuckCardFor } from '../../../scripts/foreman/ask-help.js';

const P = 'o__p';
const stuckBundle = (work = 'todo-cli') => ({
  to: 'foreman', events: [{ type: 'stuck', work, id: `stuck:${work}:1`, detail: { still: 35 * 60000, phase: 'pr-open' } }], digest: [], dropped: 0,
});
const clientWith = (writes) => ({ state: { stuckCard: async (body) => { writes.push(body); return { ok: true, id: 'q-todo-cli-1000001' }; } } });

test('the stuck question is a card the composer accepts', () => {
  assert.equal(questionProblem({ id: 'q-todo-cli-1000001', work: 'todo-cli', ...stuckQuestion('todo-cli', { phase: 'pr-open', still: 2100000 }) }), null);
  assert.match(askExample('todo-cli'), /--recommend/);
});

const idleWake = () => {
  const file = writeWake(P, stuckBundle());
  fs.copyFileSync(file, path.join(wakesDir(P), 'copy.json'));
  recordDone({ file: path.join(wakesDir(P), 'copy.json'), project: P, outcome: 'idle' });
};

test('a stuck wake the Bosun closed idle leads to a card through the helper, once', () => withHome(async () => {
  idleWake();
  const writes = [];
  const client = clientWith(writes);
  assert.deepEqual(await raiseStuckCards({ project: P, client }), ['q-todo-cli-1000001']);
  assert.deepEqual(writes, [{ project: P, work: 'todo-cli' }]);
  assert.deepEqual(await raiseStuckCards({ project: P, client }), [], 'not again for the same wake');
  assert.equal(writes.length, 1);
}));

test('a card the helper refuses is asked for again at the next loop', () => withHome(async () => {
  idleWake();
  let ok = false;
  const client = { state: { stuckCard: async () => (ok ? { ok: true, id: 'q-todo-cli-1000001' } : { ok: false, refused: 'busy' }) } };
  assert.deepEqual(await raiseStuckCards({ project: P, client }), []);
  ok = true;
  assert.deepEqual(await raiseStuckCards({ project: P, client }), ['q-todo-cli-1000001']);
}));

test('the helper makes no card when the Bosun asked already or the work has ended', () => {
  const q = (id, answer = null) => ({ [id]: { question: { key: id, data: { id } }, answer } });
  const base = { features: { 'todo-cli': { data: { step: 'building' } } }, questions: {} };
  assert.equal(stuckCardFor(base, { work: 'todo-cli', phase: 'pr-open', still: 1 }).data.id, 'q-todo-cli-1000001');
  assert.equal(stuckCardFor({ ...base, questions: q('q-todo-cli-1000001') }, { work: 'todo-cli' }).data, undefined);
  assert.equal(stuckCardFor({ ...base, questions: q('q-todo-cli-1000001', { label: 'Wait' }) }, { work: 'todo-cli' }).data.id, 'q-todo-cli-1000002');
  assert.equal(stuckCardFor({ features: {} }, { work: 'ghost' }).skip, 'there is no such work');
  assert.equal(stuckCardFor(base, { work: 'todo-cli', phase: 'x"; act close' }).data.what.includes('step called'), false);
  assert.ok(stuckCardFor({ features: { 'todo-cli': { data: { step: 'closed' } } } }, { work: 'todo-cli' }).skip);
});
