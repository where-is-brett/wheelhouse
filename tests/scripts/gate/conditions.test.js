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
    assert.deepEqual(gateDecision(input({ stop: true })), { allow: false, reasons: ['STOP is on'] });
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
      'STOP is on', 'the session is in bypass mode', 'this computer no longer holds the lock',
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
      'STOP is on',
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

test('a carried approval of an earlier commit counts', async () => {
  await withHome(() => {
    const d = gateDecision(input({ approvalRequired: true, approval: { carried: true, record: approval(OLD) } }));
    assert.deepEqual(d, { allow: true, reasons: [] });
  });
});

test('a carried record that does not verify does not count', async () => {
  await withHome(() => {
    const r = review(OLD);
    const forged = { ...r, data: { ...r.data, verdict: 'CLEAN', pr: 8 } };
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: { carried: true, record: forged } })).reasons,
      ['no CLEAN review of abcdef1']);
    const a = approval(OLD);
    const forgedA = { ...a, data: { ...a.data, pr: 8 } };
    assert.deepEqual(gateDecision(input({ approvalRequired: true, approval: { carried: true, record: forgedA } })).reasons,
      ['no approval of abcdef1']);
    assert.equal(gateDecision(input({ reviewRequired: true, review: { carried: true, record: review(OLD) }, enrolled: [] })).allow, false);
  });
});

test('a carried review that is not CLEAN, or a carried record of the wrong kind, does not count', async () => {
  await withHome(() => {
    assert.deepEqual(gateDecision(input({ reviewRequired: true, review: { carried: true, record: review(OLD, 'ISSUES') } })).reasons,
      ['no CLEAN review of abcdef1']);
    assert.equal(gateDecision(input({ reviewRequired: true, review: { carried: true, record: approval(OLD) } })).allow, false);
    assert.equal(gateDecision(input({ approvalRequired: true, approval: { carried: true, record: review(OLD) } })).allow, false);
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
      review: { carried: true, record: approval(OLD) }, approval: { carried: true, record: review(OLD) } }));
    assert.deepEqual(d.reasons, ['no CLEAN review of abcdef1', 'no approval of abcdef1']);
  });
});

test('missing or malformed flags fail safe and nothing throws', async () => {
  await withHome(() => {
    const d = gateDecision({ headSha: SHA });
    assert.equal(d.allow, false);
    assert.equal(d.reasons.includes('STOP is on'), true);
    assert.equal(d.reasons.includes('the session is in bypass mode'), true);
    assert.equal(d.reasons.includes('this computer no longer holds the lock'), true);
    assert.doesNotThrow(() => gateDecision(undefined));
    assert.doesNotThrow(() => gateDecision(input({ review: 'x', approval: 5, reviewRequired: true, approvalRequired: true })));
    assert.equal(gateDecision(null).allow, false);
  });
});
