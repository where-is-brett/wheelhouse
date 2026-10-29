// tests/scripts/engine/broker/rules.test.js
// The broker's rules (Archon design, section 12.4): every gh call Archon makes is sorted by its allow list, which
// check 76 gave; reads pass, pushes and pull requests pass under the push rules, a verdict needs a signed CLEAN review
// of that head, a merge needs the permit, and anything not on the list is refused with a plain reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCall, brokerDecision, BROKER_ALLOW } from '../../../../scripts/engine/broker/rules.js';
import { makeEvent } from '../../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../../scripts/state/signing.js';
import { withHome } from '../../../helpers/homes.js';

const R = 'github.com/acme/web';
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const QUERY = 'query($owner:String!){repository(owner:$owner){name}}';

test('a pull-request read passes', () => {
  for (const argv of [
    ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${QUERY}`, '-f', 'owner=acme'],
    ['api', '--hostname', 'github.com', 'repos/acme/web/issues/14/comments?per_page=100&page=1', '--include'],
    ['pr', 'view', '14', '--repo', R, '--json', 'body'],
    ['pr', 'view', '14', '--repo', R, '--json', 'body,state'],
    ['run', 'list', '--repo', 'acme/web', '--json', 'conclusion'],
    ['api', 'repos/acme/web/commits/abc123/check-runs', '--jq', '.check_runs'],
    ['api', 'repos/acme/web/commits/abc123/status', '--jq', '.state'],
  ]) {
    const call = classifyCall(argv);
    assert.equal(call.kind, 'read', argv.join(' '));
    assert.deepEqual(brokerDecision(call, { stop: true }), { allow: true }, 'a read passes even under All stop');
  }
  assert.equal(classifyCall(['api', 'graphql', '-f', 'query=mutation{mergePullRequest(input:{}){clientMutationId}}']).kind, 'other', 'a mutation is not a read');
  assert.ok(BROKER_ALLOW.length >= 10);
});

test('a push to the default branch is refused', () => {
  const ctx = { stop: false, lockHeld: true, defaultBranch: 'main' };
  const onMain = classifyCall(['api', '-X', 'PATCH', 'repos/acme/web/git/refs/heads/main', '-f', `sha=${HEAD}`]);
  assert.equal(onMain.kind, 'push');
  assert.match(brokerDecision(onMain, ctx).reason, /never the default branch/);
  const create = classifyCall(['pr', 'create', '--repo', R, '--head', 'main', '--base', 'main', '--title', 't', '--body-file', '-']);
  assert.match(brokerDecision(create, ctx).reason, /never the default branch/);
  const fine = classifyCall(['pr', 'create', '--repo', R, '--head=wh/card-1', '--base=main', '--title=t', '--body-file', '-']);
  assert.equal(fine.kind, 'create');
  assert.deepEqual(brokerDecision(fine, ctx), { allow: true });
  assert.match(brokerDecision(fine, { ...ctx, stop: true }).reason, /All stop/);
  assert.match(brokerDecision(fine, { ...ctx, lockHeld: false }).reason, /lock/);
});

test('a call not on the list is refused with a plain reason', () => {
  for (const argv of [['repo', 'delete', 'acme/web', '--yes'], ['secret', 'set', 'X'], ['run', 'rerun', '5', '--failed'], ['api', '-X', 'DELETE', 'repos/acme/web']]) {
    const decision = brokerDecision(classifyCall(argv), { stop: false, lockHeld: true });
    assert.equal(decision.allow, false);
    assert.match(decision.reason, /isn't on Wheelhouse's list/);
  }
});

test('a comment reading as the verdict passes only with a signed CLEAN review of that head', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const enrolled = [{ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' }];
    const body = `<!-- archon-review-report -->\nReviewed commit: \`${HEAD}\`\nVerdict: ready\n`;
    const call = classifyCall(['pr', 'comment', '14', '--repo', R, '--body', body]);
    assert.deepEqual([call.kind, call.pr, call.sha], ['verdict', 14, HEAD]);
    const ctx = { stop: false, lockHeld: true, enrolled };
    assert.match(brokerDecision(call, ctx).reason, /signed CLEAN review/);
    const review = makeEvent({ kind: 'review', data: { pr: 14, commit: HEAD, verdict: 'CLEAN', findings: 0 } });
    assert.deepEqual(brokerDecision(call, { ...ctx, review }), { allow: true });
    const plain = classifyCall(['pr', 'comment', '14', '--repo', R, '--body', 'Looks good']);
    assert.equal(plain.kind, 'comment');
    const edit = classifyCall(['api', '-X', 'PATCH', 'repos/acme/web/issues/comments/901', '--input', '-'], { stdin: JSON.stringify({ body }) });
    assert.deepEqual([edit.kind, edit.sha], ['verdict', HEAD]);
    const text = classifyCall(['pr', 'edit', '14', '--repo', R, '--body', 'Prices show two decimals.']);
    assert.equal(text.kind, 'comment', 'a pull request\'s text, edited by number, names no branch and passes as text');
    assert.deepEqual(brokerDecision(text, ctx), { allow: true });
    const marked = classifyCall(['pr', 'edit', '14', '--body', body]);
    assert.deepEqual([marked.kind, marked.pr, marked.sha], ['verdict', 14, HEAD], 'a body carrying the verdict is a verdict');
  });
});

test('a merge without a signed CLEAN review of that head is refused', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const enrolled = [{ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' }];
    const call = classifyCall(['pr', 'merge', '14', '--repo', R, '--squash', '--match-head-commit', HEAD]);
    assert.deepEqual([call.kind, call.pr, call.sha], ['merge', 14, HEAD]);
    const ctx = { stop: false, lockHeld: true, incident: { open: false }, enrolled };
    assert.match(brokerDecision(call, ctx).reason, /no signed CLEAN review/);
    const stale = makeEvent({ kind: 'review', data: { pr: 14, commit: OTHER, verdict: 'CLEAN', findings: 0 } });
    assert.match(brokerDecision(call, { ...ctx, review: stale }).reason, /no signed CLEAN review/, 'a review of another head');
    const review = makeEvent({ kind: 'review', data: { pr: 14, commit: HEAD, verdict: 'CLEAN', findings: 0 } });
    assert.deepEqual(brokerDecision(call, { ...ctx, review }), { allow: true });
    const unpinned = classifyCall(['pr', 'merge', '14', '--repo', R, '--squash']);
    assert.match(brokerDecision(unpinned, { ...ctx, review }).reason, /names no head/);
    const rest = classifyCall(['api', '-X', 'PUT', 'repos/acme/web/pulls/14/merge', '-f', `sha=${HEAD}`]);
    assert.deepEqual([rest.kind, rest.pr, rest.sha], ['merge', 14, HEAD]);
  });
});

test('a merge of a shown-first change without the director\'s approval of that head is refused', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const enrolled = [{ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' }];
    const call = classifyCall(['pr', 'merge', '14', '--repo', R, '--squash', '--match-head-commit', HEAD]);
    const review = makeEvent({ kind: 'review', data: { pr: 14, commit: HEAD, verdict: 'CLEAN', findings: 0 } });
    const ctx = { stop: false, lockHeld: true, incident: { open: false }, enrolled, review, shownFirst: true };
    assert.match(brokerDecision(call, ctx).reason, /director's approval/);
    for (const need of [{ shownFirst: false, level: 4 }, { shownFirst: false, guardrail: true }]) {
      assert.match(brokerDecision(call, { ...ctx, ...need }).reason, /director's approval/);
    }
    const approval = makeEvent({ kind: 'approval', data: { pr: 14, commit: HEAD, proof: 'signed-hook' } });
    assert.deepEqual(brokerDecision(call, { ...ctx, approval }), { allow: true });
  });
});

test('a merge during an incident is refused unless it is the fix', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const enrolled = [{ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' }];
    const call = classifyCall(['pr', 'merge', '14', '--repo', R, '--squash', '--match-head-commit', HEAD]);
    const review = makeEvent({ kind: 'review', data: { pr: 14, commit: HEAD, verdict: 'CLEAN', findings: 0 } });
    const ctx = { stop: false, lockHeld: true, enrolled, review };
    assert.match(brokerDecision(call, { ...ctx, incident: { open: true, id: 'inc-1', isFix: false } }).reason, /incident inc-1 is open/);
    assert.deepEqual(brokerDecision(call, { ...ctx, incident: { open: true, id: 'inc-1', isFix: true } }), { allow: true });
    assert.match(brokerDecision(call, { ...ctx, stop: true, incident: { open: false } }).reason, /All stop/);
  });
});
