// tests/scripts/state/lean-record.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { gateDecision } from '../../../scripts/gate/conditions.js';
import { verify } from '../../../scripts/state/signing.js';
import { parseLeanRecord, readLeanRecord, leanToEvents } from '../../../scripts/state/lean-record.js';

// The lines the Lean playbook shows for each kind (adapters/copilot/skills/lean/SKILL.md, "The record").
const LINES = {
  card: { at: '2026-10-23T01:10:02Z', kind: 'card', card: 'orders-spreadsheet', choice: 'Not now', commit: null, proof: 'chat-click', by: 'chat', tier: 'lean' },
  review: { at: '2026-10-23T01:18:30Z', kind: 'review', card: null, choice: 'clean', commit: '3f9a1c7d02be', proof: 'chat-review', by: 'chat', tier: 'lean' },
  approval: { at: '2026-10-23T01:20:41Z', kind: 'approval', card: 'merge-export-orders', choice: 'Approve', commit: '3f9a1c7d02be', proof: 'chat-click', by: 'chat', tier: 'lean' },
  merge: { at: '2026-10-23T01:21:05Z', kind: 'merge', card: 'merge-export-orders', choice: null, commit: 'b81e44c9a0d5', proof: 'chat-click', by: 'chat', tier: 'lean' },
  copy: { at: '2026-10-23T01:21:19Z', kind: 'copy', card: null, choice: 'pushed', commit: 'e5d70b3a96c1', proof: 'chat-click', by: 'chat', tier: 'lean' },
  undo: { at: '2026-10-23T03:02:48Z', kind: 'undo', card: 'undo-export-orders', choice: 'Undo', commit: '7ac20e5d19f4', proof: 'chat-click', by: 'chat', tier: 'lean' },
  stop: { at: '2026-10-23T03:05:12Z', kind: 'stop', card: null, choice: null, commit: null, proof: 'chat-click', by: 'chat', tier: 'lean' },
  'lift-stop': { at: '2026-10-23T03:09:50Z', kind: 'lift-stop', card: 'lift-stop', choice: 'Lift STOP', commit: null, proof: 'chat-click', by: 'chat', tier: 'lean' },
};
const text = (...lines) => `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`;
const FILE = '.wheelhouse/record/2026-10-23.jsonl';
const entriesOf = (...lines) => parseLeanRecord(text(...lines), { file: FILE }).entries;

// No real host program runs in these tests, and no signing key exists: a signature would throw.
function withStandIns(fn) {
  const shims = standInTools();
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = tempFolder('wh-lean-home-');
  try {
    fn();
    assert.deepEqual(shims.calls(), []);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
    shims.restore();
  }
}

test('each kind becomes the matching event', () => {
  withStandIns(() => {
    const kinds = Object.keys(LINES);
    const events = leanToEvents(entriesOf(...kinds.map((k) => LINES[k])), { project: 'owner-name' });
    assert.equal(events.length, kinds.length);
    const by = Object.fromEntries(kinds.map((k, i) => [k, events[i]]));

    // The two kinds with an unsigned state event that means the same.
    assert.equal(by.card.kind, 'card-answer');
    assert.equal(by.card.data.question, 'orders-spreadsheet');
    assert.equal(by.card.data.label, 'Not now');
    assert.equal(by.merge.kind, 'merge');
    assert.equal(by.merge.data.commit, 'b81e44c9a0d5');
    assert.equal(by.merge.data.card, 'merge-export-orders');
    assert.equal(by.merge.data.forUsers, 'export orders was merged');

    // The others are notes that name their Lean kind (their signed counterparts are never used).
    for (const k of ['approval', 'review', 'undo', 'stop', 'lift-stop', 'copy']) {
      assert.equal(by[k].kind, 'note', k);
      assert.equal(by[k].data.lean, k);
      assert.equal(typeof by[k].data.text, 'string');
    }
    assert.equal(by.approval.data.commit, '3f9a1c7d02be');
    assert.equal(by.approval.data.choice, 'Approve');
    assert.equal(by.review.data.choice, 'clean');
    assert.equal(by.copy.data.choice, 'pushed');
    assert.equal(by.undo.data.commit, '7ac20e5d19f4');

    // Every event says it is Lean's and keeps the proof as recorded, at the time the line gave.
    kinds.forEach((k, i) => {
      assert.equal(events[i].data.tier, 'lean', k);
      assert.equal(events[i].data.proof, LINES[k].proof, k);
      assert.equal(events[i].data.by, 'chat', k);
      assert.equal(events[i].at, new Date(LINES[k].at).toISOString(), k);
      assert.deepEqual(events[i].data.source, { file: FILE, line: i + 1 }, k);
    });
    // A review is a chat review, not a click.
    assert.equal(by.review.data.proof, 'chat-review');
    assert.equal(by.review.data.clicked, false);
    assert.equal(by.approval.data.clicked, true);
    assert.equal(by['lift-stop'].data.clicked, true);
    assert.equal(by.card.data.clicked, true);
    assert.equal(by.merge.data.clicked, false);
    assert.equal(by.stop.data.clicked, false);
  });
});

test('an undo with no choice is not a click, and its event says so', () => {
  withStandIns(() => {
    const noClick = { ...LINES.undo, card: null, choice: null };
    const [event] = leanToEvents(entriesOf(noClick), { project: 'owner-name' });
    assert.equal(event.data.clicked, false);
    assert.equal(event.data.proof, 'chat-click');
    assert.equal(event.data.choice, null);
    assert.match(event.data.text, /no click behind it/);
    const [clicked] = leanToEvents(entriesOf(LINES.undo), { project: 'owner-name' });
    assert.equal(clicked.data.clicked, true);
  });
});

test('a lift-stop with no choice is not a click, and its event says so', () => {
  withStandIns(() => {
    const [none, clicked] = leanToEvents(entriesOf({ ...LINES['lift-stop'], choice: null }, LINES['lift-stop']), { project: 'owner-name' });
    assert.equal(none.data.clicked, false);
    assert.match(none.data.text, /no click behind it/);
    assert.doesNotMatch(none.data.text, /by a click/);
    assert.equal(clicked.data.clicked, true);
    assert.match(clicked.data.text, /by a click in the chat/);
    // The entry check holds as well for an entry not read through the parser.
    assert.throws(() => leanToEvents([{ ...LINES['lift-stop'], choice: 'Not now' }], { project: 'owner-name' }), /cannot become an event/);
    assert.throws(() => leanToEvents([{ ...LINES.card, file: FILE, at: '2026-10-24T00:00:00Z' }], { project: 'owner-name' }), /day of the file/);
  });
});

test('a broken line is a problem, not lost', () => {
  const good = LINES.approval;
  const broken = [
    ['{not json', /not JSON/],
    ['[1,2]', /not a JSON object/],
    [{ ...good, card: undefined }, /lacks card/],
    [{ ...good, extra: 1 }, /has extra/],
    [{ ...good, kind: 'deploy' }, /"deploy" is not one Lean writes/],
    [{ ...good, kind: undefined }, /lacks kind|not one Lean writes/],
    [{ ...good, at: '23 October 2026' }, /time is not UTC/],
    [{ ...good, at: '2026-10-23T01:20:41+10:00' }, /time is not UTC/],
    [{ ...good, at: '2026-02-31T01:20:41Z' }, /time is not UTC/],
    [{ ...good, at: null }, /time is not UTC/],
    [{ ...good, proof: 'chat-review' }, /proof of approval must be chat-click/],
    [{ ...LINES.review, proof: 'chat-click' }, /proof of review must be chat-review/],
    [{ ...good, proof: 'signed-hook' }, /proof of approval/],
    [{ ...good, by: 'agent' }, /by must be chat/],
    [{ ...good, by: null }, /by must be chat/],
    [{ ...good, tier: 'full' }, /tier must be lean/],
    [{ ...good, choice: 'Not now' }, /an approval names/],
    [{ ...good, card: '' }, /neither text nor null/],
    [{ ...LINES.merge, commit: null }, /merge names/],
    [{ ...LINES.review, choice: 'maybe' }, /review names/],
    [{ ...LINES.copy, choice: null }, /copy line names/],
    [{ ...LINES.card, choice: null }, /card line names/],
    [{ ...LINES.undo, choice: 'Redo' }, /undo names/],
    [{ ...LINES.stop, choice: 'Stop' }, /a stop line has no choice/],
    [{ ...LINES['lift-stop'], choice: 'Not now' }, /lift-stop line names Lift STOP, or nothing/],
    [{ ...LINES['lift-stop'], choice: 'Approve' }, /lift-stop line names/],
    [{ ...LINES.card, at: '2026-10-22T23:59:59Z' }, /not on the day of the file/],
  ];
  const lines = [LINES.card, ...broken.map(([l]) => l), LINES.merge];
  const { entries, problems } = parseLeanRecord(text(...lines), { file: FILE });
  // The good lines are kept, and every broken one is a problem naming its file and line, with the line.
  assert.deepEqual(entries.map((e) => e.line), [1, lines.length]);
  assert.equal(problems.length, broken.length);
  broken.forEach(([l, why], i) => {
    const p = problems[i];
    assert.equal(p.file, FILE);
    assert.equal(p.line, i + 2);
    assert.equal(p.text, typeof l === 'string' ? l : JSON.stringify(l));
    assert.match(p.why, why, p.text);
  });
});

test('a blank line, a byte order mark and Windows line ends are read', () => {
  const body = `﻿${JSON.stringify(LINES.card)}\r\n\r\n${JSON.stringify(LINES.stop)}\r\n`;
  const { entries, problems } = parseLeanRecord(body, { file: FILE });
  assert.deepEqual(problems, []);
  assert.deepEqual(entries.map((e) => [e.kind, e.line]), [['card', 1], ['stop', 3]]);
  assert.deepEqual(parseLeanRecord('', { file: FILE }), { entries: [], problems: [] });
});

test('readLeanRecord reads every day oldest first and names what it cannot read', () => {
  const folder = tempFolder('wh-lean-project-');
  assert.deepEqual(readLeanRecord(folder), { entries: [], problems: [] });
  const dir = path.join(folder, '.wheelhouse', 'record');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-24.jsonl'), text({ ...LINES.stop, at: '2026-10-24T00:30:00Z' }, 'broken'));
  fs.writeFileSync(path.join(dir, '2026-10-23.jsonl'), text(LINES.card, LINES.approval));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(dir, '2026-13-40.jsonl'), '');
  fs.mkdirSync(path.join(dir, '2026-10-22.jsonl'));
  const got = readLeanRecord(folder);
  assert.deepEqual(got.entries.map((e) => [e.file, e.line, e.kind]), [
    ['.wheelhouse/record/2026-10-23.jsonl', 1, 'card'],
    ['.wheelhouse/record/2026-10-23.jsonl', 2, 'approval'],
    ['.wheelhouse/record/2026-10-24.jsonl', 1, 'stop'],
  ]);
  const named = got.problems.map((p) => [p.file, p.line]);
  assert.deepEqual(named, [
    ['.wheelhouse/record/2026-10-22.jsonl', null],
    ['.wheelhouse/record/2026-10-24.jsonl', 2],
    ['.wheelhouse/record/2026-13-40.jsonl', null],
    ['.wheelhouse/record/notes.txt', null],
  ]);
  assert.equal(got.problems[1].text, 'broken');
  assert.match(got.problems[3].why, /not named for a day/);
});

test('no event from Lean is signed', () => {
  withStandIns(() => {
    // The home above has no signing key, so a signature would have thrown. None was tried.
    const events = leanToEvents(entriesOf(...Object.values(LINES)), { project: 'owner-name' });
    for (const e of events) {
      assert.equal(e.sig, undefined, e.kind);
      assert.equal(PROTECTED_KINDS.includes(e.kind), false, e.kind);
      assert.equal(verify(e, [{ computer: e.computer, publicKey: 'x' }]), false);
    }
    assert.equal(fs.existsSync(path.join(process.env.WHEELHOUSE_HOME, 'keys')), false);
  });
});

test('a Lean approval or review does not count where the gate wants a signed one', () => {
  withStandIns(() => {
    const head = '3f9a1c7d02be'.padEnd(40, '0');
    const base = { stop: false, bypass: false, holdsLock: true, headSha: head, ci: { sha: head, state: 'success' }, upToDate: true, provenance: { ok: true }, incident: { open: false } };
    const [approval, review] = leanToEvents(entriesOf(LINES.approval, LINES.review), { project: 'owner-name' });
    const ask = { ...base, approvalRequired: true, reviewRequired: true };

    // As they are: not an approval, not a review.
    let decision = gateDecision({ ...ask, approval, review });
    assert.equal(decision.allow, false);
    assert.deepEqual(decision.reasons.map((r) => r.replace(/ of .*/, '')), ['no CLEAN review', 'no approval']);
    assert.equal(decision.approvalMissing, true);

    // Relabelled as the signed kinds, naming the head in full, they still carry no signature.
    const forgedApproval = { ...approval, kind: 'approval', data: { ...approval.data, commit: head } };
    const forgedReview = { ...review, kind: 'review', data: { ...review.data, commit: head, verdict: 'CLEAN' } };
    const enrolled = [{ computer: approval.computer, publicKey: 'AAAA' }];
    decision = gateDecision({ ...ask, approval: forgedApproval, review: forgedReview, enrolled });
    assert.equal(decision.allow, false);
    assert.equal(decision.approvalMissing, true);
    assert.equal(decision.reasons.length, 2);

    // And a carried one, the form for an earlier head, fares no better.
    decision = gateDecision({ ...ask, approval: { carried: true, record: forgedApproval }, review: { carried: true, record: forgedReview }, enrolled });
    assert.equal(decision.allow, false);
  });
});

test('an approval names its 12-character commit', () => {
  withStandIns(() => {
    const [event] = leanToEvents(entriesOf(LINES.approval), { project: 'owner-name' });
    assert.match(event.data.commit, /^[0-9a-f]{12}$/);
    assert.equal(event.data.commit, '3f9a1c7d02be');
    for (const commit of [null, '3f9a1c7', '3f9a1c7d02be0', '3F9A1C7D02BE', '3f9a1c7d02bg', 'a'.repeat(40), 123456789012]) {
      const { entries, problems } = parseLeanRecord(text({ ...LINES.approval, commit }), { file: FILE });
      assert.deepEqual(entries, [], String(commit));
      assert.equal(problems.length, 1, String(commit));
      // leanToEvents refuses an entry that was not read through the parser as well.
      assert.throws(() => leanToEvents([{ ...LINES.approval, commit }], { project: 'owner-name' }), /cannot become an event/, String(commit));
    }
  });
});
