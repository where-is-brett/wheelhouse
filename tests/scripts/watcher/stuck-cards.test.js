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
import { stuckQuestion, askExample } from '../../../scripts/foreman/ask-help.js';

const P = 'o__p';
const stuckBundle = (work = 'todo-cli') => ({
  to: 'foreman', events: [{ type: 'stuck', work, id: `stuck:${work}:1`, detail: { still: 35 * 60000, phase: 'pr-open' } }], digest: [], dropped: 0,
});
const clientWith = (views, writes) => ({
  state: {
    views: async () => ({ ok: true, views }),
    write: async (body) => { writes.push(body); return { ok: true }; },
  },
});
const views = (over = {}) => ({ work: {}, features: { 'todo-cli': { key: 'todo-cli', data: { step: 'building' } } }, reports: {}, questions: {}, ...over });

test('the stuck question is a card the composer accepts', () => {
  assert.equal(questionProblem({ id: 'q-todo-cli-1000001', work: 'todo-cli', ...stuckQuestion('todo-cli', { phase: 'pr-open', still: 2100000 }) }), null);
  assert.match(askExample('todo-cli'), /--recommend/);
});

test('a stuck wake the Bosun closed idle leads to a card for the director, once', () => withHome(async () => {
  const file = writeWake(P, stuckBundle());
  const copy = path.join(watcherDir(P), 'copy.json');
  fs.copyFileSync(file, copy);
  // The Bosun reads the wake from its own folder; the measure names the wake by its file name.
  recordDone({ file: copy, project: P, outcome: 'idle' });
  fs.copyFileSync(file, path.join(wakesDir(P), 'copy.json'));
  const writes = [];
  const client = clientWith(views(), writes);
  const first = await raiseStuckCards({ project: P, client });
  assert.equal(first.length, 1);
  assert.equal(writes[0].kind, 'question');
  assert.equal(writes[0].data.work, 'todo-cli');
  assert.ok(writes[0].data.options.length >= 2);
  assert.deepEqual(await raiseStuckCards({ project: P, client }), [], 'not again for the same wake');
  assert.equal(writes.length, 1);
}));

test('no card when the Bosun already asked, or the work has moved on', () => withHome(async () => {
  const file = writeWake(P, stuckBundle());
  fs.copyFileSync(file, path.join(wakesDir(P), 'copy.json'));
  recordDone({ file: path.join(wakesDir(P), 'copy.json'), project: P, outcome: 'idle' });
  const asked = views({ questions: { 'q-todo-cli-1000001': { question: { key: 'q', data: { id: 'q-todo-cli-1000001' } }, answer: null } } });
  const writes = [];
  assert.deepEqual(await raiseStuckCards({ project: P, client: clientWith(asked, writes) }), []);
  assert.equal(writes.length, 0);
}));
