// tests/scripts/desk/work-prs.test.js
// A work with a pull request open shows it in `views work`, with its signed review and what holds it, even
// when the record has no gate ask or report naming the pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workLines } from '../../../scripts/desk/views.js';
import { prsOfWork } from '../../../scripts/desk/work-prs.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = 'c'.repeat(40);
const words = { glossary: {}, explanations: 'on', known: [], protect: [], names: [] };
const base = (reviews = {}) => ({
  work: { 'todo-cli': { work: { key: 'todo-cli', at: '2026-11-05T18:18:00.000Z', data: { id: 'todo-cli', title: 'A to-do tool', lane: 'small', visible: true } }, since: '2026-11-05T18:18:00.000Z', approved: true } },
  features: { 'todo-cli': { at: '2026-11-05T18:20:00.000Z', data: { work: 'todo-cli', step: 'building' } } },
  reviews,
});
const review = (verdict, findings) => ({ 2: { [HEAD]: { data: { pr: 2, commit: HEAD, verdict, findings } } } });
const line = (views, prs) => workLines(views, [], words, prs).join('\n');

test('a pull request with a review that has findings is said to hold the merge, with the count', () => {
  const text = line(base(review('FINDINGS', 3)), { 'todo-cli': { pr: 2, head: HEAD } });
  assert.match(text, /pull request #2 is open, its review holds the merge: 3 findings to fix/);
});

test('a clean review, no review of this head, and a wait on the director each say so', () => {
  assert.match(line(base(review('CLEAN', 0)), { 'todo-cli': { pr: 2, head: HEAD } }), /pull request #2 is open, its review is clean; it merges once the checks pass/);
  assert.match(line(base(), { 'todo-cli': { pr: 2, head: HEAD } }), /pull request #2 is open, no signed review of its latest commit yet/);
  assert.match(line(base(review('FINDINGS', 3)), { 'todo-cli': { pr: 2, head: 'd'.repeat(40) } }), /no signed review of its latest commit yet/);
  assert.match(line(base(), { 'todo-cli': { pr: 2, head: HEAD, waitingOn: 'director' } }), /pull request #2 is open, waiting on the director/);
});

test('work with no pull request says none', () => {
  assert.doesNotMatch(line(base(), {}), /pull request/);
});

test('prsOfWork reads the pull request from the work\'s own status, only inside the worktrees folder', () => {
  const checkout = fs.realpathSync(tempFolder('wh-work-prs-'));
  const inside = path.join(checkout, '.claude', 'worktrees', 'todo-cli');
  const outside = path.join(checkout, 'elsewhere');
  const status = { v: 1, work: 'todo-cli', lane: 'small', phase: 'pr-open', task: null, fixRound: null, waitingOn: null, head: HEAD, pr: 2, slice: null, tokens: null, updatedAt: '2026-11-05T18:32:29.284Z' };
  for (const dir of [inside, outside]) {
    fs.mkdirSync(path.join(dir, '.wheelhouse', 'feature'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.wheelhouse', 'feature', 'status.json'), JSON.stringify(status));
  }
  const views = { features: { 'todo-cli': { data: { worktree: inside } }, stray: { data: { worktree: outside } } } };
  assert.deepEqual(prsOfWork(views, checkout), { 'todo-cli': { pr: 2, head: HEAD, phase: 'pr-open', waitingOn: null } });
});
