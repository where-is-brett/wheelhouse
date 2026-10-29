// tests/probes/76-archon-merge/broker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, isMerge, callList, handle, mergeTarget } from '../../../probes/76-archon-merge/broker.js';

test('classify reads pr view as read', () => {
  assert.equal(classify(['pr', 'view', '3', '--json', 'headRefOid']), 'read');
  assert.equal(classify(['pr', 'checks', '3']), 'read');
  assert.equal(classify(['api', 'repos/o/r/pulls/3']), 'read');
});

test('classify reads pr create as create', () => {
  assert.equal(classify(['pr', 'create', '--title', 't', '--body', 'b']), 'create');
  assert.equal(classify(['api', 'repos/o/r/pulls', '-X', 'POST', '-f', 'title=t']), 'create');
});

test('classify reads comments and reviews as comment', () => {
  assert.equal(classify(['pr', 'comment', '3', '--body', 'x']), 'comment');
  assert.equal(classify(['pr', 'review', '3', '--approve']), 'comment');
  assert.equal(classify(['api', 'repos/o/r/issues/3/comments', '-f', 'body=x']), 'comment');
});

test('classify treats a field without a method as a POST, as gh does', () => {
  assert.equal(classify(['api', 'repos/o/r/pulls/3/merge', '-f', 'sha=abc']), 'other');
  assert.equal(classify(['api', 'repos/o/r/pulls/3/merge', '-X', 'PUT', '-f', 'sha=abc']), 'merge');
});

test('isMerge catches gh api repos/o/r/pulls/1/merge -X PUT', () => {
  assert.equal(isMerge(['api', 'repos/o/r/pulls/1/merge', '-X', 'PUT']), true);
  assert.equal(isMerge(['api', '--method', 'PUT', '/repos/o/r/pulls/1/merge', '-f', 'sha=abc']), true);
  assert.equal(isMerge(['api', '-XPUT', 'repos/o/r/pulls/1/merge']), true);
  assert.equal(isMerge(['api', 'repos/o/r/pulls/1/merge']), false, 'a GET only asks whether it was merged');
});

test('isMerge catches gh pr merge 1 --squash', () => {
  assert.equal(isMerge(['pr', 'merge', '1', '--squash']), true);
  assert.equal(isMerge(['-R', 'o/r', 'pr', 'merge', '1']), true);
  assert.equal(isMerge(['pr', 'view', '1']), false);
});

test('mergeTarget reads the pull request and the pinned head', () => {
  assert.deepEqual(mergeTarget(['api', 'repos/o/r/pulls/7/merge', '-X', 'PUT', '-f', 'sha=abc123', '-f', 'merge_method=squash']), { pr: '7', sha: 'abc123' });
  assert.deepEqual(mergeTarget(['pr', 'merge', '7', '--squash', '--match-head-commit', 'def456']), { pr: '7', sha: 'def456' });
  assert.deepEqual(mergeTarget(['pr', 'merge', '7']), { pr: '7', sha: null });
});

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-broker-test-'));
}

test('the broker refuses a merge with no permit and exits non-zero with a plain reason', async () => {
  const dir = tmp();
  const log = path.join(dir, 'calls.jsonl');
  let forwarded = false;
  const result = await handle(['pr', 'merge', '4', '--squash'], {
    log, permitsDir: dir, forward: async () => { forwarded = true; return { code: 0, stdout: '', stderr: '' }; }, headOf: async () => 'aaa111',
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /no permit/i);
  assert.equal(forwarded, false);
  assert.equal(callList(log)[0].kind, 'merge');
  assert.equal(callList(log)[0].refused, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the broker passes a merge whose head has a permit', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '4-aaa111'), '');
  let seen;
  const result = await handle(['api', 'repos/o/r/pulls/4/merge', '-X', 'PUT', '-f', 'sha=aaa111'], {
    log: path.join(dir, 'calls.jsonl'), permitsDir: dir, forward: async (argv) => { seen = argv; return { code: 0, stdout: '{"merged":true}', stderr: '' }; },
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{"merged":true}');
  assert.deepEqual(seen, ['api', 'repos/o/r/pulls/4/merge', '-X', 'PUT', '-f', 'sha=aaa111']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the broker refuses a merge whose permit is for another head', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '4-aaa111'), '');
  const result = await handle(['pr', 'merge', '4'], { log: path.join(dir, 'calls.jsonl'), permitsDir: dir, forward: async () => ({ code: 0, stdout: '', stderr: '' }), headOf: async () => 'bbb222' });
  assert.notEqual(result.code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the broker passes reads through unchanged', async () => {
  const dir = tmp();
  const result = await handle(['pr', 'view', '4'], { log: path.join(dir, 'calls.jsonl'), permitsDir: dir, forward: async () => ({ code: 3, stdout: 'out', stderr: 'err' }) });
  assert.deepEqual(result, { code: 3, stdout: 'out', stderr: 'err' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('callList reads one entry per logged line', () => {
  const dir = tmp();
  const log = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(log, [JSON.stringify({ argv: ['pr', 'view', '1'], kind: 'read' }), '', JSON.stringify({ argv: ['pr', 'create'], kind: 'create' })].join('\n') + '\n');
  const calls = callList(log);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.kind), ['read', 'create']);
  assert.deepEqual(callList(path.join(dir, 'missing.jsonl')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
