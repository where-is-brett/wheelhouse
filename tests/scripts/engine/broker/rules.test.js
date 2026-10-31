// tests/scripts/engine/broker/rules.test.js
// The broker's rules (Archon design, section 12.4): every gh call Archon makes is sorted by its allow list, which
// check 76 gave; reads pass, pushes and pull requests pass under the push rules, a verdict needs a signed CLEAN review
// of that head, a merge needs the permit, and anything not on the list is refused with a plain reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandDigest } from '../../../../scripts/checks/record.js';
import { classifyCall, brokerDecision, isOneQuery, BROKER_ALLOW } from '../../../../scripts/engine/broker/rules.js';
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

test("a pull request, issue or run named by its address is the project's own, or the call is refused", () => {
  for (const argv of [
    ['pr', 'view', 'https://github.com/acme/web/pull/14', '--json', 'body'],
    ['issue', 'view', 'https://github.com/ACME/web/issues/5', '--json', 'body'],
    ['pr', 'view', 'github.com/acme/web/pull/14'],
    ['pr', 'view', 'wheelhouse-slice-1'],
  ]) assert.equal(classifyCall(argv, { repo: 'acme/web' }).kind, 'read', argv.join(' '));
  for (const argv of [
    ['pr', 'view', 'https://github.com/other/repo/pull/14', '--json', 'body'],
    ['issue', 'view', 'https://github.com/other/repo/issues/5'],
    ['pr', 'diff', 'https://gitlab.com/acme/web/-/merge_requests/1'],
    ['issue', 'view', 'https://github.com/acme'],
  ]) assert.equal(classifyCall(argv, { repo: 'acme/web' }).kind, 'other', argv.join(' '));
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
  // A re-run of failed jobs is on the list, but only for a red main line (below); one of every job is not.
  for (const argv of [['repo', 'delete', 'acme/web', '--yes'], ['secret', 'set', 'X'], ['run', 'rerun', '5'], ['api', '-X', 'DELETE', 'repos/acme/web']]) {
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

test('where checks run here, a merge needs a signed passing check of that head and command', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const enrolled = [{ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' }];
    const digest = commandDigest('npm test');
    const review = makeEvent({ kind: 'review', data: { pr: 14, commit: HEAD, verdict: 'CLEAN', findings: 0 } });
    const signed = (commit, command = digest, result = 'passed') => makeEvent({ kind: 'check', data: { commit, command, result, minutes: 1, tail: '' } });
    const call = classifyCall(['pr', 'merge', '14', '--repo', R, '--squash', '--match-head-commit', HEAD]);
    const ctx = { stop: false, lockHeld: true, incident: { open: false }, enrolled, review, shownFirst: false, level: 1, guardrail: false, checksHere: true, digest };
    // A green status at the host gets a change past Archon's gate and is no check here: no record, no merge.
    assert.match(brokerDecision(call, ctx).reason, /no passing check on this computer/);
    assert.deepEqual(brokerDecision(call, { ...ctx, check: signed(HEAD) }), { allow: true });
    assert.match(brokerDecision(call, { ...ctx, check: signed('1'.repeat(40)) }).reason, /no passing check/, 'an old head\'s record doesn\'t stand in');
    assert.match(brokerDecision(call, { ...ctx, check: signed(HEAD, commandDigest('exit 0')) }).reason, /no passing check/, 'a changed command');
    assert.match(brokerDecision(call, { ...ctx, check: signed(HEAD, digest, 'failed') }).reason, /no passing check/);
    const planted = { ...signed(HEAD), sig: 'AAAA' };
    assert.match(brokerDecision(call, { ...ctx, check: planted }).reason, /no passing check/, 'a planted record');
    assert.deepEqual(brokerDecision(call, { ...ctx, check: null, checksHere: false }), { allow: true }, 'a project whose checks run on the host is unchanged');
    assert.deepEqual(brokerDecision(call, { stop: false, lockHeld: true, incident: { open: false }, enrolled, review, shownFirst: false, level: 1, guardrail: false }), { allow: true });
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

// The review's argv (30 October 2026): spellings gh reads one way that a loose parser read another.
const V = `<!-- archon-review-report -->\nReviewed commit: \`${HEAD}\`\nVerdict: ready`;
const OWN = { repo: 'acme/web' };
const open = { stop: false, lockHeld: true, defaultBranch: 'main' };

test('a call gh would read differently from the broker is never let through', () => {
  for (const [name, argv, stdin] of [
    ['two methods', ['api', '-X', 'GET', '-X', 'PUT', '-p', 'repos/acme/web/issues/1/comments', 'repos/acme/web/pulls/5/merge']],
    ['a preview flag hiding the path', ['api', '-X', 'PATCH', '-p', 'repos/acme/web/issues/comments/1', 'repos/acme/web/git/refs/heads/main', '-f', `sha=${HEAD}`]],
    ['a glued method', ['api', '-XPUT', 'repos/acme/web/pulls/5/merge']],
    ['a glued field', ['api', 'repos/acme/web/issues/5/comments', `-fbody=${V}`]],
    ['an input file', ['api', 'repos/acme/web/issues/5/comments', '--input=c.json']],
    ['a field from a file', ['api', '-X', 'PATCH', 'repos/acme/web/issues/comments/9', '-F', 'body=@v.md']],
    ['a comment body from a file', ['pr', 'comment', '5', '--body-file', 'v.md']],
    ['a short body flag glued to its text', ['pr', 'comment', '5', `-b${V}`]],
    ['a GraphQL mutation after a query', ['api', 'graphql', '-f', 'query=query A{viewer{login}} mutation B{mergePullRequest(input:{pullRequestId:"x"}){clientMutationId}}', '-f', 'operationName=B']],
    ['a GraphQL body from a file', ['api', 'graphql', '-f', 'query=query{viewer{login}}', '--input', 'm.json']],
    ['a GraphQL operation name', ['api', 'graphql', '-f', 'query=query A{viewer{login}}', '-f', 'operationName=A']],
    ['two GraphQL operations', ['api', 'graphql', '-f', 'query=query A{viewer{login}} query B{viewer{id}}']],
    ['a GraphQL query from a file', ['api', 'graphql', '-F', 'query=@q.graphql']],
    ['a ref path with a query', ['api', '-X', 'PATCH', 'repos/acme/web/git/refs/heads/main?x=1', '-f', `sha=${HEAD}`, '-F', 'force=true']],
    ['a ref path percent-encoded', ['api', '-X', 'PATCH', 'repos/acme/web/git/refs/heads/%6Dain', '-f', `sha=${HEAD}`]],
    ['another repository\'s branch', ['api', '-X', 'PATCH', 'repos/evil/x/git/refs/heads/develop', '-f', `sha=${HEAD}`]],
    ['another repository by flag', ['pr', 'comment', '5', '--repo', 'evil/x', '--body', 'hi']],
    ['another host', ['pr', 'view', '5', '--hostname', 'evil.example.com']],
    ['a base retargeted', ['pr', 'edit', '5', '--base', 'release']],
    ['a merge by admin', ['pr', 'merge', '5', '--admin', '--squash', '--match-head-commit', HEAD]],
    ['a merge left to auto-merge', ['pr', 'merge', '5', '--auto', '--squash', '--match-head-commit', HEAD]],
    ['a merge naming two pull requests', ['pr', 'merge', '--subject', '7', '12', '--match-head-commit', HEAD]],
    ['a pull request opened in a browser', ['pr', 'view', '5', '--web']],
  ]) {
    const decision = brokerDecision(classifyCall(argv, { stdin, ...OWN }), open);
    assert.equal(decision.allow, false, name);
  }
});

test('a verdict is found in every body a call can carry', () => {
  for (const [name, argv, stdin] of [
    ['a field', ['api', '-X', 'PATCH', 'repos/acme/web/issues/comments/9', '-f', `body=${V}`]],
    ['standard input', ['pr', 'comment', '5', '--body-file', '-'], V],
    ['standard input as JSON', ['api', '-X', 'PATCH', 'repos/acme/web/issues/comments/9', '--input', '-'], JSON.stringify({ body: V })],
    ['a long flag with its value glued', ['pr', 'comment', '5', `--body=${V}`]],
    ['a pull request\'s text', ['pr', 'edit', '5', '-b', V]],
  ]) {
    const call = classifyCall(argv, { stdin, ...OWN });
    assert.deepEqual([call.kind, call.sha], ['verdict', HEAD], name);
    assert.match(brokerDecision(call, open).reason, /signed CLEAN review/, name);
  }
  const twice = classifyCall(['pr', 'comment', '5', '--body', `${V}\nReviewed commit: \`${OTHER}\``], OWN);
  assert.match(brokerDecision(twice, open).reason, /names no reviewed commit/, 'a body naming two commits names none');
});

test('the calls Archon makes still pass, for the project\'s own repository', () => {
  for (const argv of [
    ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${QUERY}`, '-f', 'owner=acme', '-F', 'number=14'],
    ['api', 'graphql', '-f', 'query=fragment F on Repository{name} query{repository(owner:"acme",name:"web"){...F}}'],
    ['api', 'repos/acme/web/issues/14/comments?per_page=100&page=1', '--include', '--paginate'],
    ['pr', 'view', '14', '--repo', 'github.com/acme/web', '--json', 'body'],
    ['pr', 'list', '--repo', 'acme/web', '--state', 'open', '--json', 'number,headRefName'],
    ['pr', 'checks', '14', '--json', 'name,state'],
    ['run', 'view', '42', '--repo', 'acme/web', '--json', 'conclusion'],
    ['issue', 'list', '--repo', 'acme/web', '--label', 'wh', '--json', 'number'],
    ['repo', 'view', 'acme/web', '--json', 'defaultBranchRef'],
  ]) {
    const call = classifyCall(argv, OWN);
    assert.equal(call.kind, 'read', argv.join(' '));
  }
  const ref = classifyCall(['api', '-X', 'PATCH', 'repos/acme/web/git/refs/heads/wh/card-1', '-f', `sha=${HEAD}`], OWN);
  assert.deepEqual([ref.kind, ref.branch], ['push', 'wh/card-1']);
  const made = classifyCall(['api', 'repos/acme/web/git/refs', '-f', 'ref=refs/heads/wh/card-2', '-f', `sha=${HEAD}`], OWN);
  assert.deepEqual([made.kind, made.branch], ['push', 'wh/card-2']);
  assert.deepEqual(brokerDecision(made, open), { allow: true });
  const merge = classifyCall(['pr', 'merge', '14', '--squash', '--delete-branch', '--match-head-commit', HEAD], OWN);
  assert.deepEqual([merge.kind, merge.pr, merge.sha], ['merge', 14, HEAD]);
  const text = classifyCall(['pr', 'edit', '14', '--title', 'New title', '--body-file', '-'], { stdin: 'Plain body', ...OWN });
  assert.equal(text.kind, 'comment');
});

test('isOneQuery takes one query and nothing that could change anything', () => {
  for (const text of [QUERY, '{ viewer { login } }', 'query A { viewer { login } } fragment F on User { id }', 'query { a(s: "mutation {") }', '# mutation\nquery { a }']) {
    assert.equal(isOneQuery(text), true, text);
  }
  for (const text of ['mutation { x }', 'query { a } mutation { b }', 'query A { a } query B { b }', 'subscription { s }', 'query { a(s: "x) }', 'query { a', '}{', null]) {
    assert.equal(isOneQuery(text), false, String(text));
  }
});

// The fix-main lane's cheapest fix (Archon design, section 7.7): the main line's failed jobs run again, only for a run
// of the default branch while a red-main incident is open.
const RERUN_CTX = { stop: false, lockHeld: true, defaultBranch: 'main', redMain: true, runBranch: 'main' };

test('run rerun --failed is classed rerun, naming the run', () => {
  assert.deepEqual(classifyCall(['run', 'rerun', '77', '--failed']), { kind: 'rerun', name: 'workflow run, failed jobs again', run: 77 });
  assert.equal(classifyCall(['run', 'rerun', '77', '--failed', '--repo', 'acme/web'], { repo: 'acme/web' }).kind, 'rerun');
});

test('a rerun passes on the default branch while main is red', () => {
  assert.deepEqual(brokerDecision(classifyCall(['run', 'rerun', '77', '--failed']), RERUN_CTX), { allow: true });
});

test('a rerun is refused with no red-main incident', () => {
  assert.match(brokerDecision(classifyCall(['run', 'rerun', '77', '--failed']), { ...RERUN_CTX, redMain: false }).reason, /red main line/);
});

test('a rerun is refused for a feature branch\'s run, or one whose branch can\'t be read', () => {
  for (const runBranch of ['wh/card-1', null, undefined]) {
    assert.match(brokerDecision(classifyCall(['run', 'rerun', '77', '--failed']), { ...RERUN_CTX, runBranch }).reason, /default branch/, String(runBranch));
  }
});

test('a rerun is refused under All stop or without the lock', () => {
  const call = classifyCall(['run', 'rerun', '77', '--failed']);
  assert.match(brokerDecision(call, { ...RERUN_CTX, stop: true }).reason, /All stop/);
  assert.match(brokerDecision(call, { ...RERUN_CTX, lockHeld: false }).reason, /lock/);
});

test('a rerun without --failed, of every job, or of another repository is refused', () => {
  for (const argv of [['run', 'rerun', '77'], ['run', 'rerun', '77', '--failed', '--job', '5'], ['run', 'rerun', '--failed'], ['run', 'rerun', 'x7', '--failed'], ['run', 'rerun', '77', '--failed', '--repo', 'other/repo']]) {
    assert.equal(classifyCall(argv, { repo: 'acme/web' }).kind, 'other', argv.join(' '));
  }
});
