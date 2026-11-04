// tests/scripts/gate/release-approval.test.js
// The gate's rules for the update's reviewed change: its provenance kind is accepted only on a release or undo branch, and a
// release that is not pins-only is approved only by the director's signed answer to the card for that release at that commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { releaseApproved, releaseCardName, updateProvenance } from '../../../scripts/gate/release-approval.js';
import { gateDecision } from '../../../scripts/gate/conditions.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { RELEASE_LINE, releaseLine, setLinesOf } from '../../../scripts/state/card-lines.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { sweepDecision } from '../../../scripts/host/local/queue.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { releaseBranch, undoBranch } from '../../../scripts/lineage/release.js';
import { as, shortHome } from '../../helpers/homes.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const now = () => new Date('2026-11-04T01:00:00.000Z');

// A computer with a key, and a signed action answering the card for `release` at `commit`.
async function withKey(fn) {
  const home = shortHome();
  try {
    return await as(home, async () => {
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-11-04T00:00:00.000Z' });
      return fn({ enrolled: readEnrolled() });
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

const answer = ({ release = 'v1.2.0', commit = A, label = 'Approve', question } = {}) => makeEvent({
  kind: 'action',
  data: { action: 'approve-release', release, commit, label, question: question ?? `Some words.\n${releaseLine(release, commit)}` },
  now,
});

test('the card is named for the commit, and its line is a set line the prompt record reads', () => {
  assert.equal(releaseCardName(A), `release-${A}`);
  assert.deepEqual(setLinesOf(`words\n${releaseLine('v1.2.0', A)}\nmore`), [releaseLine('v1.2.0', A)]);
  assert.deepEqual(RELEASE_LINE.exec(releaseLine('v1.2.0', A)).slice(1), ['v1.2.0', A]);
  assert.equal(RELEASE_LINE.test(releaseLine('v1.2.0', 'abc')), false);
});

test('an update provenance counts only on a release or undo branch that names the same commit', () => {
  const recorded = { update: { release: 'v1.2.0', commit: A } };
  assert.deepEqual(updateProvenance({ recorded, headRef: releaseBranch(A) }), { matched: true, ok: true, release: 'v1.2.0', commit: A });
  assert.equal(updateProvenance({ recorded, headRef: undoBranch(A) }).ok, true);
  assert.equal(updateProvenance({ recorded, headRef: 'feature/sign-in' }).ok, false);
  assert.equal(updateProvenance({ recorded, headRef: releaseBranch(B) }).ok, false);
  assert.equal(updateProvenance({ recorded: { update: { release: 'v1.2.0', commit: A, extra: 1 } }, headRef: releaseBranch(A) }).ok, false);
  assert.equal(updateProvenance({ recorded: { ...recorded, wheelhouse: '1.0.0' }, headRef: releaseBranch(A) }).ok, false);
  // A session's provenance, or none, is not an update's.
  assert.deepEqual(updateProvenance({ recorded: { wheelhouse: '1.0.0' }, headRef: releaseBranch(A) }), { matched: false });
  assert.deepEqual(updateProvenance({ recorded: undefined, headRef: releaseBranch(A) }), { matched: false });
});

test('the state refuses an update provenance on any other branch, or for another commit', () => withKey(() => {
  const make = (branch, update) => makeEvent({ kind: 'provenance', data: { branch, provenance: { update } }, now });
  assert.ok(make(releaseBranch(A), { release: 'v1.2.0', commit: A }));
  assert.throws(() => make('feature/sign-in', { release: 'v1.2.0', commit: A }), /belongs to the release's or the undo's branch/);
  assert.throws(() => make(releaseBranch(B), { release: 'v1.2.0', commit: A }), /belongs to the release's or the undo's branch/);
  assert.throws(() => make(releaseBranch(A), { release: 'v1.2.0', commit: 'abc' }), /commit in full/);
  assert.throws(() => make(releaseBranch(A), { release: '../x', commit: A }), /plain tag/);
}));

test('the director\'s signed answer for the release at that commit counts, and nothing else does', () => withKey(({ enrolled }) => {
  const ok = answer();
  assert.equal(releaseApproved({ events: [ok], release: 'v1.2.0', commit: A, enrolled }), true);
  // An answer for another commit, or another tag, doesn't count.
  assert.equal(releaseApproved({ events: [answer({ commit: B })], release: 'v1.2.0', commit: A, enrolled }), false);
  assert.equal(releaseApproved({ events: [answer({ release: 'v1.2.1' })], release: 'v1.2.0', commit: A, enrolled }), false);
  // An approval of a pull request's head is not the release's card.
  const head = makeEvent({ kind: 'approval', data: { pr: 7, commit: A, words: 'Approve', question: 'Approve pull request #7' }, now });
  assert.equal(releaseApproved({ events: [head], release: 'v1.2.0', commit: A, enrolled }), false);
  // A record not signed by an enrolled key counts for nothing, nor does one whose words were changed after signing.
  const unsigned = { ...ok, sig: undefined };
  assert.equal(releaseApproved({ events: [unsigned], release: 'v1.2.0', commit: A, enrolled }), false);
  const altered = { ...ok, data: { ...ok.data, commit: B } };
  assert.equal(releaseApproved({ events: [altered], release: 'v1.2.0', commit: B, enrolled }), false);
  // A card-answer from a click in an agent's chat is unsigned and never counts.
  const chat = makeEvent({ kind: 'card-answer', data: { card: releaseCardName(A), label: 'Approve', hash: 'f'.repeat(64), proof: 'chat-click' }, now });
  assert.equal(releaseApproved({ events: [chat], release: 'v1.2.0', commit: A, enrolled }), false);
  assert.equal(releaseApproved({ events: [], release: 'v1.2.0', commit: A, enrolled }), false);
}));

test('the action must carry its tag, its commit and the release line as its question\'s one set line', () => {
  assert.throws(() => answer({ label: 'Not now' }), /Approve label/);
  assert.throws(() => answer({ question: 'no line here' }), /release line/);
  assert.throws(() => answer({ question: releaseLine('v1.2.0', B) }), /release line/);
  assert.throws(() => answer({ question: `${releaseLine('v1.2.0', A)}\n${releaseLine('v1.2.0', A)}` }), /release line/);
});

test('the prompt record earns the action from a click on the card, and from no other', async () => {
  const question = `Words.\n${releaseLine('v1.2.0', A)}`;
  const got = await earned({ project: 'p', question, label: 'Approve', client: {}, now, left: (p) => p });
  assert.deepEqual(got.made, { kind: 'action', data: { action: 'approve-release', release: 'v1.2.0', commit: A, question, label: 'Approve' } });
  assert.equal(await earned({ project: 'p', question, label: 'Not now', client: {}, now, left: (p) => p }), null);
  const two = `${question}\n${releaseLine('v1.2.1', B)}`;
  assert.equal(await earned({ project: 'p', question: two, label: 'Approve', client: {}, now, left: (p) => p }), null);
});

const base = (over = {}) => ({
  stop: false, bypass: false, holdsLock: true, headSha: A, ci: { sha: A, state: 'success' },
  reviewRequired: true, approvalRequired: true, touchesGuardrails: true, review: undefined, approval: undefined, enrolled: new Map(),
  upToDate: true, incident: { open: false }, provenance: { ok: true }, ...over,
});

test('the gate: for the update\'s change the approval is the release card\'s and no approval of the head stands in', () => withKey(({ enrolled }) => {
  const review = makeEvent({ kind: 'review', data: { pr: 7, commit: A, verdict: 'CLEAN' }, now });
  const headApproval = makeEvent({ kind: 'approval', data: { pr: 7, commit: A, words: 'Approve', question: 'Approve pull request #7' }, now });
  const input = (over) => base({ review, enrolled, ...over });
  const release = (approved) => ({ release: 'v1.2.0', commit: B, approved });
  // The ordinary rule: the head's approval counts.
  assert.equal(gateDecision(input({ approval: headApproval })).allow, true);
  // The update's change: the head's approval doesn't, the card's answer does.
  const without = gateDecision(input({ approval: headApproval, release: release(false) }));
  assert.equal(without.allow, false);
  assert.deepEqual(without.reasons, [`no approval of release v1.2.0 (${B.slice(0, 7)}) from the director's card for it`]);
  assert.equal(without.approvalMissing, true);
  assert.equal(gateDecision(input({ release: release(true) })).allow, true);
  // The answer lowers the approval and nothing else.
  assert.deepEqual(gateDecision(input({ release: release(true), review: undefined })).reasons, [`no CLEAN review of ${A.slice(0, 7)}`]);
  assert.deepEqual(gateDecision(input({ release: release(true), ci: { sha: A, state: 'failure' } })).reasons, [`CI has not passed on ${A.slice(0, 7)}`]);
  assert.equal(gateDecision(input({ release: release(true), stop: true })).allow, false);
  // Only an exact true counts.
  assert.equal(gateDecision(input({ release: { ...release(true), approved: 'yes' } })).allow, false);
}));

test('the local queue: the update\'s change waits for the card, and the usual approval is not asked of it', () => {
  const ready = { main: 'green', stopped: false, incident: { open: false }, check: 'green', review: true, clashes: false, permit: { allow: true } };
  assert.equal(sweepDecision({ ...ready, needsApproval: true, approval: false }).act, 'raise');
  // The change is the update's: its approval is the release card's, whatever the head's approval says.
  assert.deepEqual(sweepDecision({ ...ready, needsApproval: true, approval: true, release: { ok: true, pinsOnly: false, approved: false } }), { act: 'raise', reason: 'release' });
  assert.equal(sweepDecision({ ...ready, needsApproval: true, approval: false, release: { ok: true, pinsOnly: false, approved: true } }).act, 'merge');
  // A pins-only release is admitted on the review alone.
  assert.equal(sweepDecision({ ...ready, needsApproval: true, approval: false, release: { ok: true, pinsOnly: true, approved: false } }).act, 'merge');
  // A change that isn't what the update says it is waits.
  assert.equal(sweepDecision({ ...ready, needsApproval: false, release: { ok: false } }).act, 'wait');
});
