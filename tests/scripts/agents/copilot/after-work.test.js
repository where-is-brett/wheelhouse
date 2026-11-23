// tests/scripts/agents/copilot/after-work.test.js
// What Copilot's sessions part (adapters/copilot/sessions.js) does with a feature run's worktree once the run has ended: it
// commits it itself, for the work the target names, and checks a commit the report names against the worktree's head. And
// the builder's report check, which needs no commit line of a builder whose commit is made for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sessions from '../../../../adapters/copilot/sessions.js';
import { parseReport } from '../../../../scripts/hooks/report-check.js';

const line = (event) => JSON.stringify(event);
const REPORT = (commit) => ['Built it.', '', 'WHEELHOUSE REPORT', 'role: builder', 'pr: none', ...(commit === null ? [] : [`commit: ${commit}`]), 'status: done', 'tests: ok', 'assumptions: none', 'concerns: none'].join('\n');
const runWith = (text) => [line({ type: 'assistant.message', data: { content: text } }), line({ type: 'result', sessionId: 'sess-1', exitCode: 0 })].join('\n');
const HEAD = 'a'.repeat(40);

test('a feature run that finished has its worktree committed, for the work the target names', async () => {
  const asked = [];
  const commit = async (options) => { asked.push(options); return { head: HEAD, commit: HEAD }; };
  const result = await sessions.afterWork({ stdout: runWith(REPORT(null)), target: 'feature-login', worktree: '/w/login', commit });
  assert.deepEqual(asked, [{ worktree: '/w/login', work: 'login' }]);
  assert.deepEqual(result, { records: [], commit: HEAD, head: HEAD });
});

test('a run with no result, a foreman\'s run and a run with no worktree commit nothing', async () => {
  const commit = async () => { throw new Error('committed'); };
  for (const given of [
    { stdout: line({ type: 'assistant.message', data: { content: 'Half' } }), target: 'feature-login', worktree: '/w/login' },
    { stdout: runWith(REPORT(null)), target: 'foreman', worktree: '/w/login' },
    { stdout: runWith(REPORT(null)), target: 'feature-login' },
  ]) assert.deepEqual(await sessions.afterWork({ ...given, commit }), { records: [] });
});

test('a commit that fails leaves a note saying the changes are still in the worktree, and never throws', async () => {
  for (const commit of [async () => ({ failed: 'git made no commit' }), async () => { throw new Error('boom'); }]) {
    const { records } = await sessions.afterWork({ stdout: runWith(REPORT(null)), target: 'feature-login', worktree: '/w/login', commit });
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, 'note');
    assert.match(records[0].data.text, /The login session's changes could not be committed: .*They are still in its worktree\./);
  }
});

test('a report that names a commit is checked against the worktree\'s head', async () => {
  const commit = async () => ({ head: HEAD, commit: HEAD });
  const same = await sessions.afterWork({ stdout: runWith(REPORT(HEAD.slice(0, 12))), target: 'feature-login', worktree: '/w/login', commit });
  assert.deepEqual(same.records, []);
  const other = await sessions.afterWork({ stdout: runWith(REPORT('b'.repeat(40))), target: 'feature-login', worktree: '/w/login', commit });
  assert.equal(other.records.length, 1);
  assert.match(other.records[0].data.text, /names commit b{12}, but its worktree's head is a{12}/);
});

test('a builder\'s report needs no commit line where its commit is made for it, and a reviewer\'s always does', () => {
  assert.deepEqual(parseReport(REPORT(null), 'builder', { commitNamed: false }).missing, []);
  assert.deepEqual(parseReport(REPORT(null), 'builder').missing, ['commit'], 'Claude Code\'s builder still names its commit');
  assert.deepEqual(parseReport(REPORT('not a hash'), 'builder', { commitNamed: false }).missing, ['commit'], 'one given must be a hash');
  const review = ['WHEELHOUSE REPORT', 'role: reviewer', 'pr: none', 'verdict: CLEAN'].join('\n');
  assert.deepEqual(parseReport(review, 'reviewer', { commitNamed: false }).missing, ['commit']);
});
