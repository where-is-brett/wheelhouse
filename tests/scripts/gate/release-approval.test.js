// tests/scripts/gate/release-approval.test.js
// The gate's rules for the update's reviewed change: its provenance kind is accepted only on a release or undo branch, and a
// release that is not pins-only is approved only by the director's signed answer to the card for that move, made after the
// change was opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { baseRefOf, releaseApproved, releaseCardName, updateProvenance } from '../../../scripts/gate/release-approval.js';
import { gateDecision } from '../../../scripts/gate/conditions.js';
import { brokerDecision } from '../../../scripts/engine/broker/rules.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { RELEASE_LINE, releaseLine, setLinesOf } from '../../../scripts/state/card-lines.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { sweepDecision } from '../../../scripts/host/local/queue.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { releaseBranch, undoBranch } from '../../../scripts/lineage/release.js';
import { as, shortHome } from '../../helpers/homes.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const T = (n) => () => new Date(Date.parse('2026-11-04T01:00:00.000Z') + n * 1000);
const now = T(0);

// A computer with a key.
async function withKey(fn) {
  const home = shortHome();
  try {
    return await as(home, async () => {
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-11-04T00:00:00.000Z' });
      return fn({ enrolled: readEnrolled(), home });
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

// A signed action answering the card for the move `previous` to `release` at `commit`, `n` seconds in.
const answer = ({ previous = 'v1.1.0', release = 'v1.2.0', commit = A, label = 'Approve', question, n = 10 } = {}) => makeEvent({
  kind: 'action',
  data: { action: 'approve-release', previous, release, commit, label, question: question ?? `Some words.\n${releaseLine(previous, release, commit)}` },
  now: T(n),
});
// The helper's record that the update opened the change on `branch`, `n` seconds in.
const opened = (branch, release, commit, n = 0) => makeEvent({ kind: 'provenance', data: { branch, provenance: { update: { release, commit } } }, now: T(n) });

test('the card is named for the commit, and its line names both releases and is a set line the prompt record reads', () => {
  const line = releaseLine('v1.1.0', 'v1.2.0', A);
  assert.equal(line, `Move this project from Wheelhouse v1.1.0 to v1.2.0, commit ${A}`);
  assert.equal(releaseCardName(A), `release-${A}`);
  assert.deepEqual(setLinesOf(`words\n${line}\nmore`), [line]);
  assert.deepEqual(RELEASE_LINE.exec(line).slice(1), ['v1.1.0', 'v1.2.0', A]);
  assert.equal(RELEASE_LINE.test(releaseLine('v1.1.0', 'v1.2.0', 'abc')), false);
});

test('the release a change\'s base names is read from the base file', () => {
  assert.equal(baseRefOf(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { ref: 'v1.1.0' } } } })), 'v1.1.0');
  assert.equal(baseRefOf('{}'), null);
  assert.equal(baseRefOf('not json'), null);
  assert.equal(baseRefOf(undefined), null);
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

test('the director\'s signed answer for that move counts, and nothing else does', () => withKey(({ enrolled }) => {
  const branch = releaseBranch(A);
  const events = [opened(branch, 'v1.2.0', A)];
  const check = (list, over = {}) => releaseApproved({ events: [...events, ...list], previous: 'v1.1.0', release: 'v1.2.0', commit: A, branch, enrolled, ...over });
  const ok = answer();
  assert.equal(check([ok]), true);
  // An answer for another commit, another tag, or another starting point doesn't count.
  assert.equal(check([answer({ commit: B })]), false);
  assert.equal(check([answer({ release: 'v1.2.1' })]), false);
  assert.equal(check([answer({ previous: 'v1.0.0' })]), false);
  // An approval of a pull request's head is not the release's card.
  assert.equal(check([makeEvent({ kind: 'approval', data: { pr: 7, commit: A, words: 'Approve', question: 'Approve pull request #7' }, now: T(10) })]), false);
  // A record not signed by an enrolled key counts for nothing, nor does one whose words were changed after signing.
  assert.equal(check([{ ...ok, sig: undefined }]), false);
  assert.equal(check([{ ...ok, data: { ...ok.data, commit: B } }], { commit: B }), false);
  // A card-answer from a click in an agent's chat is unsigned and never counts.
  assert.equal(check([makeEvent({ kind: 'card-answer', data: { card: releaseCardName(A), label: 'Approve', hash: 'f'.repeat(64), proof: 'chat-click' }, now: T(10) })]), false);
  assert.equal(check([]), false);
  // With no record that the update opened the change, there is nothing for the answer to be after.
  assert.equal(releaseApproved({ events: [ok], previous: 'v1.1.0', release: 'v1.2.0', commit: A, branch, enrolled }), false);
}));

test('an old approval does not carry a later move back to that release: the replay', () => withKey(({ enrolled }) => {
  // The director approved v1.1.0 to v1.2.0 at the 10th second. Later the project is on v1.3.0.
  const old = answer({ previous: 'v1.1.0', release: 'v1.2.0', commit: A, n: 10 });
  const undo = undoBranch(A);
  // An agent opens the undo to v1.2.0 (the same commit) at the 100th second: the project's base names v1.3.0.
  const replay = [opened(undo, 'v1.2.0', A, 100), old];
  const asked = (events, previous) => releaseApproved({ events, previous, release: 'v1.2.0', commit: A, branch: undo, enrolled });
  // (a) The answer was for a move from v1.1.0, not from v1.3.0.
  assert.equal(asked(replay, 'v1.3.0'), false);
  // (b) Even for the same starting point, an answer from before the change was opened is not for it.
  assert.equal(asked(replay, 'v1.1.0'), false);
  // The card's own answer, from v1.3.0 and after the change opened, counts.
  assert.equal(asked([...replay, answer({ previous: 'v1.3.0', release: 'v1.2.0', commit: A, n: 120 })], 'v1.3.0'), true);
  // A change opened again later needs a new answer.
  assert.equal(asked([...replay, answer({ previous: 'v1.3.0', release: 'v1.2.0', commit: A, n: 120 }), opened(undo, 'v1.2.0', A, 200)], 'v1.3.0'), false);
}));

test('the action must carry its tags, its commit and the release line as its question\'s one set line', () => withKey(() => {
  assert.throws(() => answer({ label: 'Not now' }), /Approve label/);
  assert.throws(() => answer({ question: 'no line here' }), /release line/);
  assert.throws(() => answer({ question: releaseLine('v1.1.0', 'v1.2.0', B) }), /release line/);
  assert.throws(() => answer({ question: releaseLine('v1.0.0', 'v1.2.0', A) }), /release line/);
  assert.throws(() => answer({ question: `${releaseLine('v1.1.0', 'v1.2.0', A)}\n${releaseLine('v1.1.0', 'v1.2.0', A)}` }), /release line/);
}));

// The prompt record earns the action only from the card the update's job raised: the journal names it.
test('the prompt record earns the action only from the card the job raised', () => withKey(async () => {
  const line = releaseLine('v1.1.0', 'v1.2.0', A);
  const question = `Words.\n${line}`;
  const click = (q = question, label = 'Approve') => earned({ project: 'p', question: q, label, client: {}, now, left: (p) => p });
  // An approval card of any other kind with a release line added: no job raised it, so it earns nothing.
  assert.equal(await click(), null);
  const journal = openJournal('p');
  journal.mark('change', 'done', { pr: 7, approval: 'card', card: { previous: 'v1.1.0', release: 'v1.2.0', commit: A } });
  const got = await click();
  assert.deepEqual(got.made, { kind: 'action', data: { action: 'approve-release', previous: 'v1.1.0', release: 'v1.2.0', commit: A, question, label: 'Approve' } });
  // Not for another move than the one the job raised, nor for another button, nor for two lines.
  assert.equal(await click(`Words.\n${releaseLine('v1.0.0', 'v1.2.0', A)}`), null);
  assert.equal(await click(`Words.\n${releaseLine('v1.1.0', 'v1.2.1', A)}`), null);
  assert.equal(await click(question, 'Not now'), null);
  assert.equal(await click(`${question}\n${releaseLine('v1.1.0', 'v1.2.1', B)}`), null);
  // A card with a release line added to an ordinary approval's words earns no release approval.
  assert.equal(await click(`Approve pull request #7 at commit ${A.slice(0, 12)}\n${line}`), null);
}));

const base = (over = {}) => ({
  stop: false, bypass: false, holdsLock: true, headSha: A, ci: { sha: A, state: 'success' },
  reviewRequired: true, approvalRequired: true, touchesGuardrails: true, review: undefined, approval: undefined, enrolled: new Map(),
  upToDate: true, incident: { open: false }, provenance: { ok: true }, ...over,
});

test('the gate: for the update\'s change the approval is the release card\'s and no approval of the head stands in', () => withKey(({ enrolled }) => {
  const review = makeEvent({ kind: 'review', data: { pr: 7, commit: A, verdict: 'CLEAN' }, now });
  const headApproval = makeEvent({ kind: 'approval', data: { pr: 7, commit: A, words: 'Approve', question: 'Approve pull request #7' }, now });
  const input = (over) => base({ review, enrolled, ...over });
  const release = (approved) => ({ previous: 'v1.1.0', release: 'v1.2.0', commit: B, approved });
  // The ordinary rule: the head's approval counts.
  assert.equal(gateDecision(input({ approval: headApproval })).allow, true);
  // The update's change: the head's approval doesn't, the card's answer does.
  const without = gateDecision(input({ approval: headApproval, release: release(false) }));
  assert.equal(without.allow, false);
  assert.deepEqual(without.reasons, [`no approval of the move from v1.1.0 to v1.2.0 (${B.slice(0, 7)}) from the director's card for it`]);
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

test('the local queue: the broker\'s permit takes the release answer in the head approval\'s place, and keeps every other condition', () => withKey(({ enrolled }) => {
  const review = makeEvent({ kind: 'review', data: { pr: 7, commit: A, verdict: 'CLEAN' }, now });
  const call = { kind: 'merge', pr: 7, sha: A };
  // The settings file is a guardrail and the work is shown first, so the broker asks for a signed approval of the head.
  const permit = { stop: false, lockHeld: true, enrolled, review, guardrail: true, shownFirst: true, incident: { open: false } };
  assert.match(brokerDecision(call, permit).reason, /approval of aaaaaaa isn't signed/);
  // A change the helper found to be the update's, with its answer in: the head's approval is not asked for.
  assert.equal(brokerDecision(call, { ...permit, releaseApproved: true }).allow, true);
  // Without the answer it waits, and the head's own approval would still do for any other change.
  assert.equal(brokerDecision(call, { ...permit, releaseApproved: false }).allow, false);
  // Nothing else is lowered: All stop, a missing review and an open incident still refuse.
  assert.equal(brokerDecision(call, { ...permit, releaseApproved: true, stop: true }).allow, false);
  assert.equal(brokerDecision(call, { ...permit, releaseApproved: true, review: undefined }).allow, false);
  assert.equal(brokerDecision(call, { ...permit, releaseApproved: true, incident: { open: true, id: 'i-1' } }).allow, false);
  // And so a local update change merges with the card and waits without it, end to end through both tables.
  const ready = { main: 'green', stopped: false, incident: { open: false }, check: 'green', review: true, clashes: false, needsApproval: true, approval: false };
  const sweep = (approved) => sweepDecision({
    ...ready, release: { ok: true, pinsOnly: false, approved }, permit: { allow: brokerDecision(call, { ...permit, releaseApproved: approved }).allow === true },
  }).act;
  assert.equal(sweep(true), 'merge');
  assert.equal(sweep(false), 'raise');
}));
