// tests/probes/76-archon-merge/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verdictBody,
  readyWorkItem,
  readiedAgain,
  callShape,
  callSummary,
  launcherScript,
  tallyE3,
  LEGS,
} from '../../../probes/76-archon-merge/run.js';

const SHA = 'a'.repeat(40);
const REPO = { host: 'github.com', path: 'o/r' };

test('verdictBody writes the form the pinned gate reads', () => {
  const body = verdictBody(SHA, { report: 'All good.' });
  const lines = body.split('\n');
  assert.equal(lines[0], '<!-- archon-review-report -->');
  assert.equal(lines[1], `Reviewed commit: \`${SHA}\``);
  assert.equal(lines[2], 'Verdict: ready');
  assert.equal(lines[3], 'Contract: complete');
  assert.equal(lines[4], '');
  assert.equal(lines.slice(5).join('\n'), 'All good.');
});

test('verdictBody can say not ready and open', () => {
  const lines = verdictBody(SHA, { ready: false, contract: 'open', report: 'x' }).split('\n');
  assert.equal(lines[2], 'Verdict: not ready');
  assert.equal(lines[3], 'Contract: open');
});

test('verdictBody refuses a head that is not a commit id', () => {
  assert.throws(() => verdictBody('main', { report: 'x' }), /commit/);
});

test('readyWorkItem is a version 1 work item the merge queue picks up', () => {
  const doc = readyWorkItem({ repo: REPO, pr: 7, url: 'https://github.com/o/r/pull/7', at: '2026-10-29T01:00:00.000Z', runId: 'r1' });
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.subject, { repo: REPO, number: 7 });
  assert.equal(doc.claim, null);
  assert.equal(doc.facts.build.status, 'ready');
  assert.equal(doc.facts.build.rounds.at(-1).pr_url, 'https://github.com/o/r/pull/7');
  assert.equal(doc.facts.build.at, '2026-10-29T01:00:00.000Z');
  assert.equal(doc.facts.merge, undefined);
  assert.deepEqual(doc.links.runs, []);
  assert.deepEqual(doc.history, []);
});

test('readiedAgain hands a returned item back as ready, later than the merge decision, keeping its record', () => {
  const returned = {
    ...readyWorkItem({ repo: REPO, pr: 7, url: 'https://github.com/o/r/pull/7', at: '2026-10-29T01:00:00.000Z', runId: 'r1' }),
    facts: {
      build: { status: 'next', brief: 'bring it up to date', rounds: [{ run_id: 'r1', pr_url: 'https://github.com/o/r/pull/7' }], decisions: [], at: '2026-10-29T02:00:00.000Z' },
      merge: { status: 'returned', pr: { repo: REPO, number: 7 }, approval: null, decisions: [{ decision: 'returned' }], at: '2026-10-29T02:00:00.000Z' },
    },
  };
  const doc = readiedAgain(returned, { url: 'https://github.com/o/r/pull/7', at: '2026-10-29T03:00:00.000Z', runId: 'r2' });
  assert.equal(doc.facts.build.status, 'ready');
  assert.equal(doc.facts.build.brief, '');
  assert.equal(doc.facts.build.rounds.length, 2);
  assert.equal(doc.facts.build.rounds.at(-1).run_id, 'r2');
  assert.ok(doc.facts.build.at > doc.facts.merge.at);
  assert.equal(doc.facts.merge.status, 'returned');
  assert.equal(doc.claim, null);
});

test('readiedAgain refuses a time not later than the merge decision', () => {
  const doc = { ...readyWorkItem({ repo: REPO, pr: 7, url: 'u', at: '2026-10-29T01:00:00.000Z', runId: 'r1' }) };
  doc.facts = { ...doc.facts, merge: { status: 'returned', at: '2026-10-29T05:00:00.000Z', decisions: [] } };
  assert.throws(() => readiedAgain(doc, { url: 'u', at: '2026-10-29T04:00:00.000Z', runId: 'r2' }), /later/);
});

test('callShape names a call without its values', () => {
  assert.equal(callShape(['api', 'graphql', '--hostname', 'github.com', '-f', 'query=query($owner: String!) { x }', '-f', 'owner=o']), 'api graphql (query)');
  assert.equal(callShape(['api', 'graphql', '-f', 'query=mutation { y }']), 'api graphql (mutation)');
  assert.equal(callShape(['api', '--hostname', 'github.com', 'repos/o/r/issues/12/comments?per_page=100&page=1', '--include']), 'api GET repos/{o}/{r}/issues/{n}/comments');
  assert.equal(callShape(['api', '-X', 'PATCH', 'repos/o/r/issues/comments/991', '-f', 'body=x']), 'api PATCH repos/{o}/{r}/issues/comments/{n}');
  assert.equal(callShape(['pr', 'merge', '3', '--repo', 'github.com/o/r', '--squash', '--match-head-commit', SHA]), 'pr merge');
  assert.equal(callShape(['pr', 'list', '--repo', 'github.com/o/r', '--state', 'open']), 'pr list');
  assert.equal(callShape(['run', 'list', '-R', 'o/r']), 'run list');
  assert.equal(callShape(['api', 'repos/o/r/commits/5b6743d/status']), 'api GET repos/{o}/{r}/commits/{sha}/status');
  assert.equal(callShape(['api', 'repos/o/r/issues/comments/6495531552']), 'api GET repos/{o}/{r}/issues/comments/{n}');
});

test('callSummary counts each shape under its kind, refusals apart', () => {
  const summary = callSummary([
    { argv: ['pr', 'view', '1'], kind: 'read' },
    { argv: ['pr', 'view', '2'], kind: 'read' },
    { argv: ['pr', 'merge', '1', '--squash'], kind: 'merge', refused: true },
    { argv: ['pr', 'merge', '1', '--squash'], kind: 'merge' },
  ]);
  assert.deepEqual(summary, [
    { kind: 'merge', shape: 'pr merge', count: 2, refused: 1 },
    { kind: 'read', shape: 'pr view', count: 2, refused: 0 },
  ]);
});

test('callSummary of nothing is an empty list', () => {
  assert.deepEqual(callSummary([]), []);
  assert.deepEqual(callSummary(undefined), []);
});

test('launcherScript starts the broker with absolute paths and passes every argument', () => {
  const text = launcherScript('/opt/node/bin/node', '/x/broker.js');
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.match(text, /exec '\/opt\/node\/bin\/node' '\/x\/broker\.js' "\$@"/);
  assert.throws(() => launcherScript('node', '/x/broker.js'), /absolute/);
});

test('tallyE3 passes only when every leg ran and passed', () => {
  const all = Object.fromEntries(LEGS.map((leg) => [leg, { ok: true }]));
  assert.equal(tallyE3(all).pass, true);
  const one = { ...all, [LEGS[2]]: { ok: false } };
  assert.equal(tallyE3(one).pass, false);
  assert.deepEqual(tallyE3(one).failed, [LEGS[2]]);
});

test('tallyE3 treats a leg that never ran as a failure', () => {
  const missing = Object.fromEntries(LEGS.slice(1).map((leg) => [leg, { ok: true }]));
  const result = tallyE3(missing);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failed, [LEGS[0]]);
  assert.equal(tallyE3({}).pass, false);
  assert.equal(tallyE3(undefined).pass, false);
});
