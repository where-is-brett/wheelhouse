// tests/scripts/gate/conditions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateDecision } from '../../../scripts/gate/conditions.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { tempFolder } from '../../helpers/homes.js';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const OLD = '1111111222222233333334444444555555566666';

async function withHome(fn) {
  const home = path.join(tempFolder('wh-gate-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

const review = (commit = SHA, verdict = 'CLEAN') => makeEvent({ kind: 'review', data: { pr: 7, commit, verdict } });
const findings = (findingsCount, blocking, commit = SHA) => makeEvent({
  kind: 'review', data: { pr: 7, commit, verdict: 'FINDINGS', findings: findingsCount, ...(blocking === undefined ? {} : { blocking }) },
});
const approval = (commit = SHA) => makeEvent({ kind: 'approval', data: { pr: 7, commit } });

const input = (extra = {}) => ({
  stop: false, bypass: false, holdsLock: true, headSha: SHA,
  ci: { sha: SHA, state: 'success' },
  reviewRequired: false, review: null, approvalRequired: false, approval: null,
  touchesGuardrails: false, enrolled: readEnrolled(),
  upToDate: true, provenance: { ok: true }, incident: { open: false }, ...extra,
});

test('everything in order is allowed', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: review(), approvalRequired: true, approval: approval() })),
      { allow: true, reasons: [] });
  });
});

test('STOP alone blocks', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ stop: true })), { allow: false, reasons: ['All stop is on'] });
  });
});

test('bypass alone blocks', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ bypass: true })), { allow: false, reasons: ['the session is in bypass mode'] });
  });
});

test('losing the lock alone blocks', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ holdsLock: false })), { allow: false, reasons: ['this computer no longer holds the lock'] });
  });
});

test('CI that is not success on the head commit blocks', async () => {
  await withHome(() => {
    const why = ['CI has not passed on abcdef1'];
    for (const ci of [{ sha: SHA, state: 'pending' }, { sha: SHA, state: 'failure' }, { sha: SHA, state: 'none' },
      { sha: OLD, state: 'success' }, null, undefined]) {
      assert.deepEqual(gateDecision(input({ ci })).reasons, why);
    }
  });
});

test('a required review that is missing blocks', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ reviewRequired: true })).reasons, ['no CLEAN review of abcdef1']);
  });
});

test('a required approval that is missing blocks', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ approvalRequired: true })).reasons, ['no approval of abcdef1']);
  });
});

test('a review or approval that is not required is not asked for', async () => {
  await withHome(() => {
    assert.equal(gateDecision(input()).allow, true);
  });
});

test('a review that is not CLEAN does not count', async () => {
  await withHome(() => {
    const d = gateDecision(input({ reviewRequired: true, review: review(SHA, 'ISSUES') }));
    assert.deepEqual(d.reasons, ['no CLEAN review of abcdef1']);
  });
});

test('a CLEAN review of an older commit does not count', async () => {
  await withHome(() => {
    const d = gateDecision(input({ reviewRequired: true, review: review(OLD), approvalRequired: true, approval: approval(OLD) }));
    assert.deepEqual(d.reasons, ['no CLEAN review of abcdef1', 'no approval of abcdef1']);
  });
});

test('a review with any field altered does not count', async () => {
  await withHome(() => {
    const r = review(OLD);
    const forged = { ...r, data: { ...r.data, commit: SHA } };
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: forged })).reasons, ['no CLEAN review of abcdef1']);
    const a = approval(OLD);
    const forgedA = { ...a, data: { ...a.data, commit: SHA } };
    assert.deepEqual(gateDecision(input({ approvalRequired: true, approval: forgedA })).reasons, ['no approval of abcdef1']);
  });
});

test('a record of the wrong kind, or signed by an unenrolled computer, does not count', async () => {
  await withHome(() => {
    assert.equal(gateDecision(input({ reviewRequired: true, review: approval() })).allow, false);
    assert.equal(gateDecision(input({ approvalRequired: true, approval: review() })).allow, false);
    assert.equal(gateDecision(input({ reviewRequired: true, review: review(), enrolled: [] })).allow, false);
  });
});

test('touching the guardrails needs both a review and an approval', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ touchesGuardrails: true })).reasons,
      ['no CLEAN review of abcdef1', 'no approval of abcdef1']);
    assert.equal(gateDecision(input({ touchesGuardrails: true, review: review(), approval: approval() })).allow, true);
  });
});

test('every reason is listed, not just the first', async () => {
  await withHome(() => {
    const d = gateDecision(input({
      stop: true, bypass: true, holdsLock: false, ci: { sha: SHA, state: 'failure' },
      reviewRequired: true, approvalRequired: true,
    }));
    assert.equal(d.allow, false);
    assert.deepEqual(d.reasons, [
      'All stop is on', 'the session is in bypass mode', 'this computer no longer holds the lock',
      'CI has not passed on abcdef1', 'no CLEAN review of abcdef1', 'no approval of abcdef1',
    ]);
  });
});

test('every reason is listed, the new conditions after the old', async () => {
  await withHome(() => {
    const d = gateDecision(input({
      stop: true, upToDate: false, provenance: { ok: false, why: 'the model is not in the routing table' },
      incident: { open: true, id: 'login-down', isFix: false },
    }));
    assert.deepEqual(d.reasons, [
      'All stop is on',
      'the branch is not up to date with the default branch',
      "what passed review is not what is on the pull request now: the model is not in the routing table",
      'incident login-down is open, so only its fix may merge',
    ]);
  });
});

test('a branch that is not up to date blocks, and only exactly true passes', async () => {
  await withHome(() => {
    const why = ['the branch is not up to date with the default branch'];
    for (const upToDate of [false, 'true', 1, undefined]) {
      assert.deepEqual(gateDecision(input({ upToDate })).reasons, why);
    }
    assert.deepEqual(gateDecision(input({ upToDate: true })), { allow: true, reasons: [] });
  });
});

test('an up-to-date check that could not be made blocks, and says so', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ upToDate: null })), { allow: false, reasons: ['whether the branch is up to date could not be checked'] });
  });
});

test('a missing approval of the head is marked, so the caller can ask for it', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ approvalRequired: true })), { allow: false, reasons: ['no approval of abcdef1'], approvalMissing: true });
    assert.equal(gateDecision(input({ touchesGuardrails: true, review: review() })).approvalMissing, true);
    // Any other condition alone leaves it unmarked.
    for (const extra of [{ reviewRequired: true }, { stop: true }, { upToDate: false }, { approvalRequired: true, approval: approval() }]) {
      assert.equal(Object.hasOwn(gateDecision(input(extra)), 'approvalMissing'), false, JSON.stringify(Object.keys(extra)));
    }
  });
});

test('provenance that does not match the manifest blocks with its reason', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ provenance: { ok: false, why: 'the block is missing' } })).reasons,
      ["what passed review is not what is on the pull request now: the block is missing"]);
  });
});

test('missing or malformed provenance blocks with a reason that still reads sensibly', async () => {
  await withHome(() => {
    const why = ["what passed review is not what is on the pull request now: it could not be checked"];
    for (const provenance of [{ ok: false }, { ok: 'true' }, { ok: false, why: '' }, { why: 'x' }, 'ok', true, null, undefined]) {
      const reasons = gateDecision(input({ provenance })).reasons;
      assert.equal(reasons.length, 1);
      assert.match(reasons[0], /^what passed review is not what is on the pull request now: .+/);
    }
    assert.deepEqual(gateDecision(input({ provenance: undefined })).reasons, why);
  });
});

test('an open incident blocks every merge but its fix, and the reason names it', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ incident: { open: true, id: 'login-down', isFix: false } })).reasons,
      ['incident login-down is open, so only its fix may merge']);
    assert.deepEqual(gateDecision(input({ incident: { open: true, id: 'login-down' } })).reasons,
      ['incident login-down is open, so only its fix may merge']);
    assert.deepEqual(gateDecision(input({ incident: { open: true, id: 'login-down', isFix: true } })),
      { allow: true, reasons: [] });
    assert.deepEqual(gateDecision(input({ incident: { open: false } })), { allow: true, reasons: [] });
  });
});

test('a fix still needs everything else', async () => {
  await withHome(() => {
    const d = gateDecision(input({ incident: { open: true, id: 'x', isFix: true }, reviewRequired: true }));
    assert.deepEqual(d.reasons, ['no CLEAN review of abcdef1']);
  });
});

test('missing or malformed incident input blocks, with or without an id', async () => {
  await withHome(() => {
    for (const incident of [undefined, null, 'none', true, {}, { open: 'false' }, { open: null }, { open: true },
      { open: true, isFix: 'true' }, { open: true, id: 7, isFix: false }]) {
      const d = gateDecision(input({ incident }));
      assert.equal(d.allow, false);
      assert.equal(d.reasons.length, 1);
      assert.match(d.reasons[0], /^(an incident|incident \S+) is open.*so only its fix may merge$/);
      assert.doesNotMatch(d.reasons[0], /undefined|null|\[object/);
    }
  });
});

test('a restore merge under an open incident is refused unless it is the incident\'s fix', async () => {
  await withHome(() => {
    // mergeAnswer passes reviewRequired: false for a restore; the incident condition still applies.
    const restore = { reviewRequired: false, approvalRequired: true, approval: approval() };
    assert.deepEqual(gateDecision(input({ ...restore, incident: { open: true, id: 'login-down', isFix: false } })).reasons,
      ['incident login-down is open, so only its fix may merge']);
    assert.deepEqual(gateDecision(input({ ...restore, incident: { open: true, id: 'login-down', isFix: true } })),
      { allow: true, reasons: [] });
    assert.deepEqual(gateDecision(input({ ...restore, incident: { open: false } })), { allow: true, reasons: [] });
  });
});

test('a carried CLEAN review of an earlier commit counts', async () => {
  await withHome(() => {
    const d = gateDecision(input({ reviewRequired: true, review: { carried: true, record: review(OLD) } }));
    assert.deepEqual(d, { allow: true, reasons: [] });
  });
});

test('an approval of an earlier commit never counts, carried or not: the director approves the head again', async () => {
  await withHome(() => {
    for (const given of [{ carried: true, record: approval(OLD) }, approval(OLD)]) {
      assert.deepEqual(gateDecision(input({ approvalRequired: true, approval: given })).reasons, ['no approval of abcdef1']);
    }
  });
});

test('a carried record that does not verify does not count', async () => {
  await withHome(() => {
    const r = review(OLD);
    const forged = { ...r, data: { ...r.data, verdict: 'CLEAN', pr: 8 } };
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: { carried: true, record: forged } })).reasons,
      ['no CLEAN review of abcdef1']);
    assert.equal(gateDecision(input({ reviewRequired: true, review: { carried: true, record: review(OLD) }, enrolled: [] })).allow, false);
  });
});

test('a carried review that is not CLEAN, or a carried record of the wrong kind, does not count', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: { carried: true, record: review(OLD, 'ISSUES') } })).reasons,
      ['no CLEAN review of abcdef1']);
    assert.equal(gateDecision(input({ reviewRequired: true, review: { carried: true, record: approval(OLD) } })).allow, false);
  });
});

test('a carried form that is malformed does not count, and a plain record still has to name the head', async () => {
  await withHome(() => {
    for (const carried of [{ carried: true }, { carried: true, record: null }, { carried: 'true', record: review(OLD) },
      { carried: false, record: review(OLD) }, { record: review(OLD) },
      { carried: true, record: { carried: true, record: review(OLD) } }]) {
      assert.deepEqual(gateDecision(input({ reviewRequired: true, review: carried })).reasons, ['no CLEAN review of abcdef1']);
    }
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: review(OLD) })).reasons, ['no CLEAN review of abcdef1']);
    assert.deepEqual(gateDecision(input({ approvalRequired: true, approval: approval(OLD) })).reasons, ['no approval of abcdef1']);
  });
});

test('a carried review does not stand in for an approval, nor the reverse', async () => {
  await withHome(() => {
    const d = gateDecision(input({ reviewRequired: true, approvalRequired: true,
      review: { carried: true, record: approval(OLD) }, approval: review(OLD) }));
    assert.deepEqual(d.reasons, ['no CLEAN review of abcdef1', 'no approval of abcdef1']);
  });
});

test('missing or malformed flags fail safe and nothing throws', async () => {
  await withHome(() => {
    const d = gateDecision({ headSha: SHA });
    assert.equal(d.allow, false);
    assert.equal(d.reasons.includes('All stop is on'), true);
    assert.equal(d.reasons.includes('the session is in bypass mode'), true);
    assert.equal(d.reasons.includes('this computer no longer holds the lock'), true);
    assert.doesNotThrow(() => gateDecision(undefined));
    assert.doesNotThrow(() => gateDecision(input({ review: 'x', approval: 5, reviewRequired: true, approvalRequired: true })));
    assert.equal(gateDecision(null).allow, false);
  });
});

// The window's click: a signed approval naming the proof window counts for a project with real users where that
// proof is taken, and a signed approval naming none does not.
test('a signed approval naming the proof window counts for a project with real users', () => withHome(() => {
  const added = makeEvent({ kind: 'approval', data: { pr: 7, commit: SHA, proof: 'window' } });
  const plain = approval();
  const taken = { approvalRequired: true, realUsers: true, approvalProofs: ['window', 'chat-click'] };
  assert.equal(gateDecision(input({ ...taken, approval: added })).allow, true);
  assert.equal(gateDecision(input({ ...taken, approval: plain })).allow, false);
  // A chat click never stands in for it.
  const click = { kind: 'card-answer', data: { label: 'Approve', commit: SHA, proof: 'chat-click' } };
  assert.equal(gateDecision(input({ ...taken, approval: click })).allow, false);
  // A click recorded under a proof no longer taken counts for nothing.
  const gone = { kind: 'card-answer', data: { label: 'Approve', commit: SHA, proof: 'hook-click' } };
  assert.equal(gateDecision(input({ approvalRequired: true, approvalProofs: ['chat-click'], approval: gone })).allow, false);
}));

test('a review whose findings are all minor counts; a blocking one, or one that does not say, does not', async () => {
  await withHome(() => {
    const allowed = (r) => gateDecision(input({ reviewRequired: true, review: r })).reasons;
    assert.deepEqual(allowed(findings(3, 0)), [], 'all MEDIUM or LOW');
    assert.deepEqual(allowed(findings(3, 1)), ['no CLEAN review of abcdef1'], 'a BLOCKER or HIGH holds');
    assert.deepEqual(allowed(findings(3)), ['no CLEAN review of abcdef1'], 'no blocking count: every finding holds');
    assert.deepEqual(allowed(findings(0, 0)), ['no CLEAN review of abcdef1'], 'no findings with a FINDINGS verdict is not a clear');
  });
});

test('the blocking count of a signed review cannot be lowered after it is signed', async () => {
  await withHome(() => {
    const r = findings(3, 2);
    const lowered = { ...r, data: { ...r.data, blocking: 0 } };
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: lowered })).reasons, ['no CLEAN review of abcdef1']);
    const unsigned = { kind: 'review', data: { pr: 7, commit: SHA, verdict: 'FINDINGS', findings: 3, blocking: 0 } };
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: unsigned })).reasons, ['no CLEAN review of abcdef1']);
  });
});

test('a review that holds a head stays its review when a clearing one is recorded after it', async () => {
  await withHome(async () => {
    const { buildViews } = await import('../../../scripts/state/views.js');
    let t = Date.parse('2026-11-06T00:00:00.000Z');
    const made = (data) => { t += 1000; return makeEvent({ kind: 'review', data: { pr: 7, commit: SHA, ...data }, now: () => new Date(t) }); };
    const viewsOf = (...events) => buildViews(events, readEnrolled());
    const verdictOf = (v) => v.reviews['7'][SHA].data.verdict;
    assert.equal(verdictOf(viewsOf(made({ verdict: 'FINDINGS', findings: 3, blocking: 1 }), made({ verdict: 'CLEAN' }))), 'FINDINGS', 'blocking, then clean');
    assert.equal(verdictOf(viewsOf(made({ verdict: 'FINDINGS', findings: 3 }), made({ verdict: 'CLEAN' }))), 'FINDINGS', 'no count, then clean');
    assert.equal(verdictOf(viewsOf(made({ verdict: 'FINDINGS', findings: 3, blocking: 0 }), made({ verdict: 'CLEAN' }))), 'CLEAN', 'minor, then clean takes its place');
  });
});

test('a review with only minor findings lets the gate merge and raises merge-ready, end to end', async () => {
  await withHome(async () => {
    const { buildViews } = await import('../../../scripts/state/views.js');
    const { diff } = await import('../../../scripts/watcher/core.js');
    const minor = findings(2, 0);
    assert.equal(gateDecision(input({ reviewRequired: true, review: minor })).allow, true, 'the gate merges');
    const views = buildViews([minor], readEnrolled());
    const verdict = views.reviews['7'][SHA].data;
    const obs = { prs: { 7: { work: 'w', head: SHA, ci: 'success', mergeable: 'yes', review: 'clean', findings: verdict.findings, blocking: verdict.blocking } }, events: [], features: {}, testMerges: [], stop: false, at: '2026-11-06T00:00:00.000Z' };
    assert.ok(diff({ prs: {} }, obs, {}).some((e) => e.type === 'merge-ready' && e.pr === 7), 'the watcher raises merge-ready');
    const blocked = findings(2, 1);
    assert.equal(gateDecision(input({ reviewRequired: true, review: blocked })).allow, false);
  });
});
