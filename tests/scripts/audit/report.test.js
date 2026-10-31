// tests/scripts/audit/report.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { auditReport, renderAudit, GAP_KINDS, main } from '../../../scripts/audit/report.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { leanToEvents } from '../../../scripts/state/lean-record.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { HOST_UNREACHABLE } from '../../../scripts/host/company-ca.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { protectionLogFile } from '../../../scripts/audit/protection-log.js';
import { tempFolder } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';

const SINCE = '2026-10-01T00:00:00.000Z';
const NOW = '2026-10-22T00:00:00.000Z';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);

// Signed events need a signing key of this test's own.
async function withHome(fn) {
  const home = path.join(tempFolder('wh-audit-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-01T00:00:00.000Z' });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

const at = (iso) => () => new Date(iso);
const approval = (pr, commit, extra = {}, when = '2026-10-10T01:00:00.000Z') => makeEvent({ kind: 'approval', data: { pr, commit, ...extra }, now: at(when) });
const review = (pr, commit, extra = {}, when = '2026-10-10T00:30:00.000Z') => makeEvent({ kind: 'review', data: { pr, commit, verdict: 'CLEAN', findings: 0, ...extra }, now: at(when) });
const plain = (kind, data, when = '2026-10-10T00:00:00.000Z') => makeEvent({ kind, data, now: at(when) });

const merged = (number, sha, extra = {}) => ({
  number, title: `Change ${number}`, url: null, mergedAt: '2026-10-10T02:00:00.000Z', mergedBy: 'wh-maintainer', author: 'wh-bot', target: 'main', sha, mergeCommit: null, ...extra,
});
const run = (id, source, status = 'success') => ({ id, status, source, ref: 'refs/heads/work', sha: null });

// A stand-in for the adapter's history calls. `pipelines` and `states` are by commit and by number.
function stub({ requests = [], pipelines = {}, states = {}, protection = { source: 'audit-events', events: [] }, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    async mergedRequests(args) { calls.push(['mergedRequests', args]); if (fail.merged) throw fail.merged; return requests; },
    async pipelinesFor(sha, options) { calls.push(['pipelinesFor', sha, options]); if (fail.pipelines) throw fail.pipelines; return pipelines[sha] ?? [run(1, 'merge_request_event')]; },
    async protectionEvents(args) { calls.push(['protectionEvents', args]); if (fail.protection) throw fail.protection; return protection; },
    async prState(number) {
      calls.push(['prState', number]);
      const state = states[number];
      if (state instanceof Error) throw state;
      return { state: state ?? 'open' };
    },
  };
}

const report = (events, host, extra = {}) => auditReport({ events, host, since: SINCE, now: NOW, enrolled: readEnrolled(), ...extra });
const kinds = (r) => r.gaps.map((g) => g.kind);

// --- the report's shape ---

test('a change approved, reviewed and passed at the merged commit is a row and no gap', async () => {
  await withHome(async () => {
    const events = [
      approval(7, A, { proof: 'chat-click' }),
      review(7, A, { reviewKind: 'clean-session' }),
      plain('level', { level: 'guarded', pr: 7 }),
      plain('level', { pr: 7, level: 'ask', allowance: 'npm run build' }, '2026-10-10T00:10:00.000Z'),
      plain('report', { work: 'welcome-page', outcome: 'merged', pr: 7, summary: 's', rulings: [], provenance: { wheelhouse: 'v1', claudeCode: '2.1.0', models: ['model-a'] } }),
    ];
    const r = await report(events, stub({ requests: [merged(7, A)], pipelines: { [A]: [run(5, 'merge_request_event')] } }));
    assert.deepEqual(r.gaps, []);
    assert.equal(r.complete, true);
    assert.equal(r.rows.length, 1);
    const [row] = r.rows;
    assert.equal(row.number, 7);
    assert.equal(row.commit, A);
    assert.equal(row.mergedBy, 'wh-maintainer');
    assert.deepEqual(row.approvals.map((x) => [x.commit, x.proof, x.at]), [[A, 'chat-click', '2026-10-10T01:00:00.000Z']]);
    assert.deepEqual(row.reviews.map((x) => [x.commit, x.kind, x.verdict]), [[A, 'clean-session', 'CLEAN']]);
    assert.equal(row.ci.status, 'success');
    assert.equal(row.ci.source, 'merge_request_event');
    assert.equal(row.level, 'guarded');
    assert.deepEqual(row.allowances.map((x) => x.what), ['npm run build']);
    assert.deepEqual(row.versions, { wheelhouse: 'v1', claudeCode: '2.1.0', models: ['model-a'] });
    const text = renderAudit(r);
    assert.match(text, /No gaps/);
    assert.match(text, /chat-click/);
    assert.match(text, /clean-session/);
  });
});

test('a signed approval with no proof named is Claude Code\'s own record: signed-hook', async () => {
  await withHome(async () => {
    const r = await report([approval(7, A)], stub({ requests: [merged(7, A)] }));
    assert.equal(r.rows[0].approvals[0].proof, 'signed-hook');
    assert.deepEqual(r.gaps, []);
  });
});

test('what the record does not hold is shown as not recorded, never as none', async () => {
  await withHome(async () => {
    const r = await report([approval(7, A)], stub({ requests: [merged(7, A)] }));
    const [row] = r.rows;
    assert.equal(row.level, null);
    assert.equal(row.versions, null);
    assert.equal(row.reviews.length, 0);
    const text = renderAudit(r);
    assert.match(text, /Level: not recorded/);
    assert.match(text, /Versions: not recorded/);
    assert.match(text, /Review: not recorded/);
  });
});

test('the report asks the host for the period it was given, and names no model', async () => {
  await withHome(async () => {
    const host = stub({ requests: [] });
    await report([], host);
    assert.deepEqual(host.calls.find((c) => c[0] === 'mergedRequests')[1], { since: SINCE });
    assert.deepEqual(host.calls.find((c) => c[0] === 'protectionEvents')[1], { since: SINCE });
  });
});

test('the gap kinds are named once', () => {
  assert.deepEqual([...GAP_KINDS].sort(), ['approval-not-merged', 'external-pipeline', 'merge-not-on-host', 'no-approval', 'other-commit', 'protection-change']);
});

// --- one test for each kind of gap ---

test('a merge with no approval is a gap', async () => {
  await withHome(async () => {
    const r = await report([review(7, A)], stub({ requests: [merged(7, A)] }));
    assert.deepEqual(kinds(r), ['no-approval']);
    assert.equal(r.gaps[0].pr, 7);
    assert.match(r.gaps[0].text, /#7/);
    assert.match(renderAudit(r), /Gaps \(1\)/);
  });
});

test('a record that does not verify is not an approval', async () => {
  await withHome(async () => {
    const forged = approval(7, A);
    forged.sig.value = Buffer.from('not the signature').toString('base64');
    const unsigned = approval(8, B);
    delete unsigned.sig;
    const r = await report([forged, unsigned], stub({ requests: [merged(7, A), merged(8, B)] }));
    assert.deepEqual(kinds(r), ['no-approval', 'no-approval']);
    assert.match(r.gaps[0].text, /does not verify|not signed/);
    assert.equal(r.rows[0].approvals.length, 0);
    assert.match(renderAudit(r), /Approval: none on record \(1 record does not verify/);
  });
});

test('an approval that names a proof Wheelhouse does not know is not an approval', async () => {
  await withHome(async () => {
    const r = await report([approval(7, A, { proof: 'a-made-up-proof' })], stub({ requests: [merged(7, A)] }));
    assert.deepEqual(kinds(r), ['no-approval']);
  });
});

test('an approval for a pull request closed without merging is a gap; one still waiting is not', async () => {
  await withHome(async () => {
    const events = [approval(9, C), approval(10, D)];
    const host = stub({ requests: [], states: { 9: 'closed', 10: 'open' } });
    const r = await report(events, host);
    assert.deepEqual(kinds(r), ['approval-not-merged']);
    assert.equal(r.gaps[0].pr, 9);
    assert.deepEqual(r.waiting, [10]);
    assert.match(renderAudit(r), /#10/);
  });
});

test('an approval for a pull request the host has no record of is a gap', async () => {
  await withHome(async () => {
    const host = stub({ requests: [], states: { 11: new Error('glab mr view failed: 404 Not Found') } });
    const r = await report([approval(11, C)], host);
    assert.deepEqual(kinds(r), ['approval-not-merged']);
    assert.equal(r.complete, true);
  });
});

test('a record of a merge the host does not show is a gap', async () => {
  await withHome(async () => {
    const events = [plain('report', { work: 'a-thing', outcome: 'merged', pr: 12, summary: 's', rulings: [] }), plain('merge', { pr: 13, commit: C, forUsers: 'x' })];
    const host = stub({ requests: [], states: { 12: 'open', 13: 'closed' } });
    const r = await report(events, host);
    assert.deepEqual(kinds(r), ['merge-not-on-host', 'merge-not-on-host']);
  });
});

test('a merged commit other than the approved one is a gap (a Merge click that names no commit)', async () => {
  await withHome(async () => {
    // The person approved A; a commit B pushed just before the click is what merged (check 71, step 6).
    const r = await report([approval(7, A), review(7, A)], stub({ requests: [merged(7, B)] }));
    assert.deepEqual(kinds(r), ['other-commit']);
    assert.match(r.gaps[0].text, new RegExp(A.slice(0, 12)));
    assert.match(r.gaps[0].text, new RegExp(B.slice(0, 12)));
    assert.equal(r.rows[0].approvals[0].matchesMerged, false);
  });
});

test('a merged commit other than the reviewed one is a gap', async () => {
  await withHome(async () => {
    // Approved at the merged commit, but the only review is of an earlier one.
    const r = await report([approval(7, B), review(7, A)], stub({ requests: [merged(7, B)] }));
    assert.deepEqual(kinds(r), ['other-commit']);
    assert.match(r.gaps[0].text, /review/);
    assert.equal(r.rows[0].reviews[0].matchesMerged, false);
  });
});

test('a merge whose head pipeline was a posted status is a gap (check 71)', async () => {
  await withHome(async () => {
    const host = stub({ requests: [merged(7, A)], pipelines: { [A]: [run(9, 'external'), run(4, 'merge_request_event', 'failed')] } });
    const r = await report([approval(7, A), review(7, A)], host);
    assert.deepEqual(kinds(r), ['external-pipeline']);
    assert.match(r.gaps[0].text, /posted/);
    assert.equal(r.rows[0].ci.source, 'external');
  });
});

test('a pipeline that ran after an earlier posted status is not a gap', async () => {
  await withHome(async () => {
    const host = stub({ requests: [merged(7, A)], pipelines: { [A]: [run(9, 'merge_request_event'), run(4, 'external')] } });
    const r = await report([approval(7, A)], host);
    assert.deepEqual(r.gaps, []);
    assert.equal(r.rows[0].ci.id, 9);
  });
});

test('a protection change is a gap, whether audit events or a comparison found it', async () => {
  await withHome(async () => {
    const audit = await report([], stub({ protection: { source: 'audit-events', events: [{ at: '2026-10-12T03:00:00.000Z', by: 'wh-maintainer', what: 'Changed the protected branch main' }] } }));
    assert.deepEqual(kinds(audit), ['protection-change']);
    assert.match(audit.gaps[0].text, /2026-10-12T03:00:00.000Z/);
    assert.match(audit.gaps[0].text, /wh-maintainer/);

    const compared = await report([], stub({ protection: { source: 'compared', first: false, events: [{ at: null, by: null, what: 'main: who may merge changed from Maintainers to Developers + Maintainers', between: ['2026-10-05T00:00:00.000Z', '2026-10-22T00:00:00.000Z'] }] } }));
    assert.deepEqual(kinds(compared), ['protection-change']);
    assert.match(compared.gaps[0].text, /between 2026-10-05T00:00:00.000Z and 2026-10-22T00:00:00.000Z/);
    assert.match(renderAudit(compared), /compared/i);
  });
});

test('on Free, the first look has no earlier reading and says so, without calling it a gap', async () => {
  await withHome(async () => {
    const r = await report([], stub({ protection: { source: 'compared', first: true, events: [] } }), { protectionKept: 'projects/p/audit/protection.json' });
    assert.deepEqual(r.gaps, []);
    assert.ok(r.limits.some((l) => /no earlier/i.test(l)));
    const text = renderAudit(r);
    assert.match(text, /projects\/p\/audit\/protection\.json/);
    assert.match(text, /Premium/);
  });
});

// --- Lean ---

const lean = (pr, kind, data, when) => ({ ...plain(kind, data, when), tier: 'lean' });

test('Lean\'s entries are marked, not gaps', async () => {
  await withHome(async () => {
    const events = [
      // Made at Lean, before the project moved up: a merge the host does not list.
      lean(3, 'report', { work: 'old-thing', outcome: 'merged', pr: 3, summary: 's', rulings: [] }),
      lean(3, 'approval', { pr: 3, commit: C }),
    ];
    const host = stub({ requests: [], states: { 3: 'closed' } });
    const r = await report(events, host);
    assert.deepEqual(r.gaps, [], 'no gap against the host for a Lean entry the host does not list');
    assert.deepEqual(host.calls.filter((c) => c[0] === 'prState'), [], 'Lean\'s entries are not looked up on the host');
    assert.equal(r.lean.length, 2);
    const three = r.rows.find((x) => x.number === 3);
    assert.equal(three.lean, true);
    assert.equal(three.onHost, false);
    const text = renderAudit(r);
    assert.match(text, /Lean's/);
    assert.match(text, /not compared with the host/i);
  });
});

test('a Lean mark on a change the host lists only labels the row: every check still runs', async () => {
  await withHome(async () => {
    // Unsigned records carrying a Lean mark: an approval and a review of C for a change that merged D.
    // Anyone who can write a record can add the mark, so it removes no gap.
    const events = [lean(4, 'approval', { pr: 4, commit: C }), lean(4, 'review', { pr: 4, commit: C, verdict: 'CLEAN' })];
    const r = await report(events, stub({ requests: [merged(4, D)] }));
    assert.deepEqual(kinds(r), ['no-approval']);
    const row = r.rows[0];
    assert.equal(row.lean, true, 'still labelled');
    assert.equal(row.approvals.length, 0, 'never counted');
    assert.equal(row.reviews.length, 0);
    assert.equal(row.leanApprovals[0].commit, C);
    const text = renderAudit(r);
    assert.match(text, /\(Lean's\)/);
    assert.match(text, /Lean's approval \(not counted\)/);
    assert.match(text, /no-approval/);
  });
});

test('a forged Lean entry does not hide a merged commit other than the approved one, or an external pipeline', async () => {
  await withHome(async () => {
    const events = [approval(5, A), lean(5, 'approval', { pr: 5, commit: B }), lean(6, 'approval', { pr: 6, commit: C })];
    const host = stub({ requests: [merged(5, B), merged(6, C)], pipelines: { [C]: [run(9, 'external')] } });
    const r = await report(events, host);
    assert.deepEqual(r.gaps.map((g) => [g.kind, g.pr]), [['other-commit', 5], ['no-approval', 6], ['external-pipeline', 6]]);
  });
});

test('a Lean entry does not cover a change that has records of its own at the merged commit', async () => {
  await withHome(async () => {
    const mark = { ...approval(4, C), tier: 'lean' };
    const r = await report([mark, approval(4, D)], stub({ requests: [merged(4, D)] }));
    assert.deepEqual(r.gaps, []);
    assert.equal(r.rows[0].lean, false);
  });
});

test('events made from Lean\'s own record lines list as Lean\'s approvals and reviews, labelled and never counted', async () => {
  await withHome(async () => {
    const line = { card: null, choice: null, commit: C.slice(0, 12), proof: 'chat-click', by: 'chat', tier: 'lean' };
    // leanToEvents turns an approval and a review into notes that carry Lean's kind in data.lean; moveUp writes them with
    // the change they are about, so the pull request is added here as it will be there.
    const made = leanToEvents([
      { ...line, at: '2026-10-10T00:10:00Z', kind: 'review', choice: 'clean', proof: 'chat-review' },
      { ...line, at: '2026-10-10T00:20:00Z', kind: 'approval', card: 'merge-thing', choice: 'Approve' },
    ], { project: 'owner-name' });
    assert.deepEqual(made.map((e) => [e.kind, e.data.lean]), [['note', 'review'], ['note', 'approval']]);
    const events = made.map((e) => ({ ...e, data: { ...e.data, pr: 9 } }));
    const r = await report(events, stub({ requests: [merged(9, D)] }));
    // Listed as Lean's, but they carry no signature to check: the change still lacks every real record.
    assert.deepEqual(kinds(r), ['no-approval']);
    const row = r.rows[0];
    assert.equal(row.lean, true);
    assert.equal(row.approvals.length, 0, 'never counted');
    assert.equal(row.reviews.length, 0, 'never counted');
    assert.deepEqual(row.leanApprovals.map((a) => a.commit), [C.slice(0, 12)]);
    assert.deepEqual(row.leanReviews.map((x) => [x.commit, x.verdict]), [[C.slice(0, 12), 'clean']]);
    assert.deepEqual(r.lean.map((e) => e.kind), ['review', 'approval'], 'the entries Lean kept are named by Lean\'s kind, not "note"');
    const text = renderAudit(r);
    assert.match(text, /Lean's approval \(not counted\)/);
    assert.match(text, /Lean's review \(not counted\)/);
    assert.match(text, /- approval for #9 at 2026-10-10T00:20:00/);
    assert.doesNotMatch(text, /- note\b/);
  });
});

// --- gaps never silently disappear ---

test('a host that cannot be reached gives an incomplete report with a plain line, not "no gaps"', async () => {
  await withHome(async () => {
    const down = Object.assign(new Error(HOST_UNREACHABLE('https://git.example.org')), { code: 'HOST_UNREACHABLE' });
    const r = await report([approval(7, A)], stub({ fail: { merged: down, protection: down } }));
    assert.equal(r.complete, false);
    assert.ok(r.incomplete.some((l) => l.includes('can\'t be reached')));
    const text = renderAudit(r);
    assert.match(text, /incomplete/i);
    assert.match(text, /can't be reached/);
    assert.ok(!/No gaps/.test(text), 'never "no gaps" for a report that could not be made whole');
  });
});

test('a pipeline that cannot be read leaves the report incomplete, and the other checks still run', async () => {
  await withHome(async () => {
    const down = Object.assign(new Error(HOST_UNREACHABLE('https://git.example.org')), { code: 'HOST_UNREACHABLE' });
    const r = await report([], stub({ requests: [merged(7, A)], fail: { pipelines: down } }));
    assert.equal(r.complete, false);
    assert.deepEqual(kinds(r), ['no-approval']);
    assert.equal(r.rows[0].ci, null);
    assert.match(renderAudit(r), /#7/);
  });
});

test('a host call that fails in some other way is told in our words, not the host\'s', async () => {
  await withHome(async () => {
    const odd = new Error('glab api failed: <html>secret page body glpat-abcdefghijklmnop</html>');
    const r = await report([], stub({ fail: { merged: odd } }));
    assert.equal(r.complete, false);
    const text = renderAudit(r);
    assert.ok(!text.includes('secret page body'));
    assert.ok(!text.includes('glpat'));
  });
});

test('records that could not be read leave the report incomplete', async () => {
  await withHome(async () => {
    const r = await report([], stub(), { damagedRecords: 2 });
    assert.equal(r.complete, false);
    assert.ok(r.incomplete.some((l) => /2 records/.test(l)));
  });
});

test('a merged request whose merged commit the host did not give is incomplete, not matched', async () => {
  await withHome(async () => {
    const r = await report([approval(7, A)], stub({ requests: [merged(7, null)] }));
    assert.equal(r.complete, false);
    assert.deepEqual(r.gaps, []);
  });
});

test('the merging request is named when the pipelines are asked for', async () => {
  await withHome(async () => {
    const host = stub({ requests: [merged(7, A)] });
    await report([approval(7, A)], host);
    assert.deepEqual(host.calls.find((x) => x[0] === 'pipelinesFor').slice(1), [A, { number: 7 }]);
  });
});

test('a posted status on the merged commit is still the head pipeline when another request ran the commit again, newer', async () => {
  await withHome(async () => {
    const other = { ...run(12, 'merge_request_event'), head: false };
    const head = { ...run(9, 'external'), head: true };
    const r = await report([approval(7, A)], stub({ requests: [merged(7, A)], pipelines: { [A]: [other, head] } }));
    assert.deepEqual(kinds(r), ['external-pipeline']);
    assert.equal(r.rows[0].ci.id, 9);
  });
});

test('a record of a merge that names no pull request makes the report incomplete, and is not dropped', async () => {
  await withHome(async () => {
    const events = [plain('report', { work: 'a-thing', outcome: 'merged', summary: 's', rulings: [] }, '2026-10-10T00:00:00.000Z')];
    const r = await report(events, stub());
    assert.equal(r.complete, false);
    assert.ok(r.incomplete.some((l) => /does not say which pull request/.test(l)));
    assert.ok(!/No gaps/.test(renderAudit(r)));
  });
});

test('on Free\'s first look the report does not say the protection has not changed', async () => {
  await withHome(async () => {
    const r = await report([], stub({ protection: { source: 'compared', compared: true, first: true, events: [] } }));
    const text = renderAudit(r);
    assert.match(text, /No gaps: /);
    assert.match(text, /nothing to compare the protection with yet/);
    assert.ok(!/protection has not changed/.test(text));
    const later = await report([], stub({ protection: { source: 'compared', compared: true, first: false, events: [] } }));
    assert.match(renderAudit(later), /the protection has not changed/);
  });
});

test('a kept reading that was damaged makes the report incomplete', async () => {
  await withHome(async () => {
    const r = await report([], stub({ protection: { source: 'compared', compared: true, first: true, damaged: true, events: [] } }));
    assert.equal(r.complete, false);
    assert.ok(r.incomplete.some((l) => /protection reading kept/.test(l)));
    assert.ok(!/No gaps/.test(renderAudit(r)));
  });
});

test('the limits say what the comparison does not cover', async () => {
  await withHome(async () => {
    const text = renderAudit(await report([], stub({ protection: { source: 'compared', compared: true, first: false, events: [] } })));
    for (const word of ['protected tags', 'merge method', 'discussions', 'member']) assert.match(text, new RegExp(word));
  });
});

// --- the arguments ---

test('since and now are times, and a change merged outside the period is left out', async () => {
  await withHome(async () => {
    const early = merged(1, A, { mergedAt: '2026-09-01T00:00:00.000Z' });
    const late = merged(2, B, { mergedAt: '2026-11-01T00:00:00.000Z' });
    const r = await report([approval(2, B)], stub({ requests: [early, merged(3, C), late] }));
    assert.deepEqual(r.rows.map((x) => x.number), [3]);
    await assert.rejects(auditReport({ events: [], host: stub(), since: 'last week', now: NOW, enrolled: [] }), /time/);
    await assert.rejects(auditReport({ events: [], host: stub(), since: SINCE, now: 'soon', enrolled: [] }), /time/);
  });
});

test('the output holds no key and nothing the host sent beyond the fields the report needs', async () => {
  await withHome(async () => {
    const odd = merged(7, A, { title: 'Fix | the `table`\nsecond line', body: 'GITLAB SAID THIS', token: 'glpat-abcdefghijklmnop' });
    const r = await report([approval(7, A)], stub({ requests: [odd] }));
    const text = renderAudit(r);
    assert.ok(!text.includes('GITLAB SAID THIS'));
    assert.ok(!text.includes('glpat'));
    assert.ok(!/Fix \| the/.test(text), 'a pipe in a title does not break the table');
    assert.ok(!/\nsecond line/.test(text));
    assert.ok(!JSON.stringify(r).includes('GITLAB SAID THIS'));
  });
});

// --- the command: node scripts/audit/report.js --project <p> --since <date> ---

const tools = standInTools();
const KEY = ['glpat', 'abcdefghijklmnopqrstuv'].join('-');

function sink() {
  const chunks = [];
  return { write: (t) => { chunks.push(t); return true; }, text: () => chunks.join('') };
}

// A project of its own in a home of its own. The adapter, the key and the state's records are
// stand-ins; nothing real is reached.
async function inProject(fn, { host = 'gitlab', events = () => [], adapter = {}, damaged = 0 } = {}) {
  return withHome(async () => {
    const folder = tempFolder('wh-audit-project-');
    writeProject('shop', {
      folder, remoteUrl: 'https://git.example.org/team/shop.git', host, repo: 'team/shop',
      connection: { host, mode: 'narrow', project: 'team/shop', projectId: 5, baseUrl: 'https://git.example.org' },
    });
    const made = [];
    const out = sink();
    const err = sink();
    const history = stub({ requests: [] });
    const stand = {
      mergedRequests: history.mergedRequests, pipelinesFor: history.pipelinesFor, prState: history.prState,
      protectionEvents: async ({ last, now }) => ({ source: 'compared', first: last === null, snapshot: { at: now.toISOString(), branches: {}, pipelinesMustSucceed: true, skippedPipelineCounts: false }, events: [] }),
      ...adapter,
    };
    const options = {
      out, err, now: () => new Date(NOW),
      envFor: async () => ({ GITLAB_TOKEN: KEY }),
      adapterFor: (record, env) => { made.push({ record, env }); return stand; },
      eventsFor: (project, skipped) => { skipped.push(...Array.from({ length: damaged }, (_, i) => `damaged-${i}`)); return events(); },
      enrolledFor: () => readEnrolled(),
    };
    return fn({ options, out, err, made, folder });
  });
}

test('the command writes the report as Markdown to standard output and nothing else', async () => {
  await inProject(async ({ options, out, err, made, folder }) => {
    const code = await main(['--project', 'shop', '--since', '2026-10-01'], options);
    assert.equal(code, 0);
    assert.match(out.text(), /^<!-- the audit report -->\n\n# Audit report/);
    assert.match(out.text(), /Period: 2026-10-01T00:00:00.000Z to 2026-10-22T00:00:00.000Z/);
    assert.equal(err.text(), '');
    assert.equal(made.length, 1);
    assert.equal(made[0].record.repo, 'team/shop', 'the project\'s own connection is used');
    assert.deepEqual(fs.readdirSync(folder), [], 'nothing is written in the project\'s folder');
    assert.deepEqual(tools.calls(), [], 'no real gh or glab ran');
  });
});

test('the key reaches the adapter in its environment, and is in no output', async () => {
  await inProject(async ({ options, out, err, made }) => {
    await main(['--project=shop', '--since=2026-10-01'], options);
    assert.equal(made[0].env.GITLAB_TOKEN, KEY);
    assert.ok(!out.text().includes(KEY));
    assert.ok(!err.text().includes(KEY));
  });
});

test('on Free the protection read is kept in the Wheelhouse folder, never in the project, and a second run still shows the change', async () => {
  let level = 40;
  const adapter = {
    protectionEvents: async ({ last, now }) => {
      const snapshot = { at: now.toISOString(), branches: { main: { push: [0], merge: [level], force: false } }, pipelinesMustSucceed: true, skippedPipelineCounts: false };
      const changed = last !== null && last.branches.main.merge[0] !== level;
      return { source: 'compared', first: last === null, snapshot, events: changed ? [{ at: null, by: null, what: 'main: who may merge changed from Maintainers to Developers + Maintainers', between: [last.at, snapshot.at] }] : [] };
    },
  };
  await inProject(async ({ options, out, folder }) => {
    await main(['--project', 'shop', '--since', '2026-10-01'], options);
    assert.match(out.text(), /no earlier reading/i);
    assert.ok(fs.existsSync(protectionLogFile('shop')));
    assert.ok(protectionLogFile('shop').startsWith(process.env.WHEELHOUSE_HOME));
    assert.deepEqual(fs.readdirSync(folder), []);

    level = 30;
    const second = sink();
    await main(['--project', 'shop', '--since', '2026-10-01'], { ...options, out: second, now: () => new Date('2026-10-23T00:00:00.000Z') });
    assert.match(second.text(), /protection-change/);
    assert.match(second.text(), /who may merge changed/);
    assert.match(second.text(), /projects\/shop\/audit\/protection\.json/, 'the report says where the reading is kept');

    const third = sink();
    await main(['--project', 'shop', '--since', '2026-10-01'], { ...options, out: third, now: () => new Date('2026-10-24T00:00:00.000Z') });
    assert.match(third.text(), /who may merge changed/, 'a change is shown again, not lost by running the report twice');
  }, { adapter });
});

test('an unreachable host gives an incomplete report, a plain line, and a non-zero exit', async () => {
  const down = Object.assign(new Error(HOST_UNREACHABLE('https://git.example.org')), { code: 'HOST_UNREACHABLE' });
  await inProject(async ({ options, out }) => {
    const code = await main(['--project', 'shop', '--since', '2026-10-01'], options);
    assert.equal(code, 1);
    assert.match(out.text(), /incomplete/i);
    assert.match(out.text(), /can't be reached/);
    assert.ok(!/No gaps/.test(out.text()));
  }, { adapter: { mergedRequests: async () => { throw down; }, protectionEvents: async () => { throw down; } } });
});

test('records in the project that could not be read make the report incomplete', async () => {
  await inProject(async ({ options, out }) => {
    assert.equal(await main(['--project', 'shop', '--since', '2026-10-01'], options), 1);
    assert.match(out.text(), /3 records/);
  }, { damaged: 3 });
});

test('a GitHub project is told plainly that the report is for GitLab, and no tool is asked', async () => {
  await inProject(async ({ options, out, err, made }) => {
    assert.equal(await main(['--project', 'shop', '--since', '2026-10-01'], options), 1);
    assert.equal(out.text(), '');
    assert.match(err.text(), /for GitLab in this version/);
    assert.equal(made.length, 0);
  }, { host: 'github' });
});

test('the audit says there is no second record, and still compares with the home', async () => {
  const record = { mergedRequests: async () => [{ number: 1, title: 'A', url: null, mergedAt: '2026-10-02T00:00:00.000Z', mergedBy: 'this computer', author: null, target: 'main', sha: 'a'.repeat(40), mergeCommit: 'b'.repeat(40) }], pipelinesFor: async () => [], prState: async () => ({}), protectionEvents: async () => ({ source: 'none', compared: false, events: [] }) };
  const report = await auditReport({ events: [], host: record, since: SINCE, now: NOW, enrolled: [] });
  assert.ok(report.limits.includes('This project is kept on this computer, so there is no second record to compare with.'));
  assert.equal(report.rows.length, 1, 'the home\'s merges are still compared');
  assert.ok(report.gaps.length > 0, 'a merge the record doesn\'t hold is a gap');
  assert.equal(report.protection.compared, false);
});

test('a project kept on this computer gets a report, and no tool is asked', async () => {
  await inProject(async ({ options, out, made, folder }) => {
    writeProject('shop', { folder, remoteUrl: null, host: 'local', repo: 'local/shop', connection: { mode: 'none' } });
    await main(['--project', 'shop', '--since', '2026-10-01'], options);
    assert.match(out.text(), /no second record to compare with/);
    assert.equal(made.length, 0);
  });
});

test('the command refuses wrong arguments, an unknown project and a bad date, each in a line', async () => {
  await inProject(async ({ options, out, err }) => {
    for (const argv of [[], ['--project', 'shop'], ['--since', '2026-10-01'], ['--project', 'shop', '--since', '2026-10-01', '--now', 'x'], ['--project', 'shop', '--since']]) {
      assert.equal(await main(argv, options), 2, argv.join(' '));
    }
    assert.match(err.text(), /Usage/);
    assert.equal(await main(['--project', 'nowhere', '--since', '2026-10-01'], options), 1);
    assert.match(err.text(), /has not been set up/);
    assert.equal(await main(['--project', 'shop', '--since', 'last week'], options), 1);
    assert.match(err.text(), /must be a time/);
    assert.equal(out.text(), '');
  });
});

test('the command never repeats an error\'s own message, which could carry a key', async () => {
  await inProject(async ({ options, out, err }) => {
    const leaky = { ...options, envFor: async () => { throw new Error(`connection failed with ${KEY}`); } };
    assert.equal(await main(['--project', 'shop', '--since', '2026-10-01'], leaky), 1);
    assert.ok(!err.text().includes(KEY));
    assert.match(err.text(), /could not be read/);
    const down = Object.assign(new Error(HOST_UNREACHABLE('https://git.example.org')), { code: 'HOST_UNREACHABLE' });
    const away = sink();
    assert.equal(await main(['--project', 'shop', '--since', '2026-10-01'], { ...options, err: away, envFor: async () => { throw down; } }), 1);
    assert.match(away.text(), /can't be reached/);
    assert.equal(out.text(), '');
  });
});
