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
const review = (verdict, findings, commit = HEAD) => ({ 2: { [commit]: { at: '2026-11-05T18:35:00.000Z', data: { pr: 2, commit, verdict, findings } } } });
const line = (views, prs) => workLines(views, [], words, prs).join('\n');

test('a pull request with a review that has findings is said to hold the merge, with the count', () => {
  const text = line(base(review('FINDINGS', 3)), { 'todo-cli': { pr: 2, head: HEAD } });
  assert.match(text, /pull request #2 is open, its review holds the merge: 3 findings to fix/);
});

test('a clean review, no review, a review of an earlier commit: each says so, and the status is only a hint', () => {
  assert.match(line(base(review('CLEAN', 0)), { 'todo-cli': { pr: 2, head: HEAD } }), /pull request #2 is open, its review is clean; it merges once the checks pass/);
  assert.match(line(base(), { 'todo-cli': { pr: 2, head: HEAD } }), /pull request #2 is open, no signed review yet/);
  assert.match(line(base(review('FINDINGS', 3)), { 'todo-cli': { pr: 2, head: 'd'.repeat(40) } }), /its signed review is of an earlier commit, so the newest has none yet/);
  // A status that says it waits on the director changes nothing: the record decides.
  assert.doesNotMatch(line(base(review('FINDINGS', 3)), { 'todo-cli': { pr: 2, head: HEAD, waitingOn: 'director' } }), /waiting on the director/);
});

test('the record\'s pull request number wins over the status\'s', () => {
  const views = base(review('FINDINGS', 1));
  views.reports = { 'todo-cli': { at: '2026-11-05T19:00:00.000Z', data: { pr: 2 } } };
  assert.match(line(views, { 'todo-cli': { pr: 9, head: HEAD } }), /pull request #2, its review holds the merge: 1 finding to fix/);
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
  assert.deepEqual(prsOfWork(views, checkout), { 'todo-cli': { pr: 2, head: HEAD, phase: 'pr-open', merged: false } });
});

test('ask-bosun says what the helper did, and refuses nothing it was not given', async () => {
  const { askBosun } = await import('../../../scripts/frontdesk/cli.js');
  const calls = [];
  const client = (answer) => ({ state: { workCard: async (body) => { calls.push(body); return answer; } } });
  const made = await askBosun({ client: client({ ok: true, id: 'abc' }), cwd: '/p', work: 'mine' });
  assert.deepEqual(calls[0], { cwd: '/p', work: 'mine' });
  assert.match(made.say, /^Asked: the Bosun decides/);
  const none = await askBosun({ client: client({ ok: true, skipped: 'the work has no open pull request' }), cwd: '/p', work: 'mine' });
  assert.equal(none.say, 'Nothing was asked: the work has no open pull request.');
  await assert.rejects(askBosun({ client: client({ ok: false, refused: 'no' }), cwd: '/p', work: 'mine' }));
});

// ---- finished work takes no amendment, and stranded work is seen ----
import { FINISHED_WORDS, builderFinished, workFinished } from '../../../scripts/desk/work-prs.js';
import { isOpen } from '../../../scripts/desk/views.js';

function worktreeWith(status, pr) {
  const checkout = fs.realpathSync(tempFolder('wh-finished-'));
  const wt = path.join(checkout, '.claude', 'worktrees', 'todo-cli');
  fs.mkdirSync(path.join(wt, '.wheelhouse', 'feature'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.wheelhouse', 'feature', 'status.json'), JSON.stringify({ v: 1, work: 'todo-cli', lane: 'small', phase: 'building', task: null, fixRound: null, waitingOn: null, head: HEAD, pr: null, slice: null, tokens: null, updatedAt: '2026-11-05T18:32:29.284Z', ...status }));
  if (pr) fs.writeFileSync(path.join(wt, '.wheelhouse', 'feature', 'pr.json'), JSON.stringify(pr));
  return { checkout, wt };
}
const open = (wt) => ({ ...base(), features: { 'todo-cli': { at: '2026-11-05T18:20:00.000Z', data: { work: 'todo-cli', step: 'building', worktree: wt } } } });

test('work whose builder reads done, or whose pull request merged, has finished; one still building has not', () => {
  const done = worktreeWith({ phase: 'done' });
  assert.equal(workFinished(open(done.wt), 'todo-cli', done.checkout, isOpen), true);
  const merged = worktreeWith({ phase: 'pr-open', pr: 2 }, { pr: 2, plan: 'p.md', merged: true });
  assert.equal(workFinished(open(merged.wt), 'todo-cli', merged.checkout, isOpen), true);
  const live = worktreeWith({ phase: 'building' });
  assert.equal(workFinished(open(live.wt), 'todo-cli', live.checkout, isOpen), false);
  // A merged piece with later pieces to build has not finished.
  const sliced = open(merged.wt);
  sliced.features['todo-cli'].data.slice = { n: 1, m: 3 };
  assert.equal(workFinished(sliced, 'todo-cli', merged.checkout, isOpen), false);
  assert.equal(builderFinished(path.join(live.checkout, 'nowhere')), false);
  assert.match(FINISHED_WORDS, /becomes a new work/);
});

test('a closed work that still has a pull request not recorded as merged is named in views work', () => {
  const views = { ...base(), features: { 'todo-cli': { at: '2026-11-05T19:00:00.000Z', data: { work: 'todo-cli', step: 'closed' } } } };
  const text = workLines(views, [], words, { 'todo-cli': { pr: 6, head: HEAD, phase: 'waiting', merged: false } }).join('\n');
  assert.match(text, /todo-cli: A to-do tool: finished, but pull request #6 is not recorded as merged/);
  assert.deepEqual(workLines(views, [], words, { 'todo-cli': { pr: 6, merged: true } }), ['No work is open: nothing is running or waiting.']);
});
