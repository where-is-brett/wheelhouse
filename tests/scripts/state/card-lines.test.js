// tests/scripts/state/card-lines.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replyCode, replyCodeLine, setLineOf, SET_LINES, CODE_ALPHABET,
  approvalLine, confirmLine, LIFT_STOP, runbookLine, ciPushLine,
  approveWorkLine, answerLine, amendLine, liftIncidentLine, incidentFixLine, setupLine, confirmAllLine, baselineLine, trustLine, dayOf, TRUST_LINE,
} from '../../../scripts/state/card-lines.js';

const FULL = 'abcdef1234567890abcdef1234567890abcdef12';

test('a reply code is four characters from the alphabet, the same for the same line', () => {
  const lines = [approvalLine(12, FULL), approvalLine(13, FULL), LIFT_STOP, runbookLine(1), ciPushLine('main', FULL)];
  for (const line of lines) {
    const code = replyCode(line);
    assert.equal(code.length, 4);
    assert.ok([...code].every((c) => CODE_ALPHABET.includes(c)), code);
    assert.equal(replyCode(line), code);
  }
  assert.notEqual(replyCode(approvalLine(12, FULL)), replyCode(approvalLine(13, FULL)));
  assert.equal(replyCodeLine('K7QD'), 'Reply code: K7QD');
});

test('setLineOf finds one set line and refuses a card with two', () => {
  const ruling = { kind: 'ruling', id: '0b9f2c1e-0000-4000-8000-000000000001', data: { words: 'Money is shown in dollars' } };
  const sets = [approvalLine(12, FULL), confirmLine(ruling), LIFT_STOP, ciPushLine('main', FULL), runbookLine(1), runbookLine(3, FULL)];
  for (const line of sets) {
    assert.equal(setLineOf(`Here is what changed.\n${line}\nReply code: ${replyCode(line)}`), line);
    assert.equal(setLineOf(line), line);
  }
  // Each pattern takes a whole line only.
  assert.equal(setLineOf(`${approvalLine(12, FULL)}? It changes the sign-in.`), null);
  assert.equal(setLineOf(`Please ${LIFT_STOP}`), null);
  assert.equal(setLineOf('Runbook step 9: Turn STOP on'), null);
  assert.equal(setLineOf('Shall I carry on?'), null);
  // Two set lines, of one kind or of two, are none.
  assert.equal(setLineOf(`${approvalLine(12, FULL)}\n${approvalLine(13, FULL)}`), null);
  assert.equal(setLineOf(`${approvalLine(12, FULL)}\n${LIFT_STOP}`), null);
  assert.equal(setLineOf(`${LIFT_STOP}\n${LIFT_STOP}`), null);
  assert.equal(setLineOf(undefined), null);
});

const BUILD_LINES = [
  approveWorkLine('export-csv', 'feature', FULL),
  approveWorkLine('fix-1', 'bug', FULL, { shownFirst: true }),
  approveWorkLine('tweak', 'quick', FULL),
  approveWorkLine('add-it', 'small', FULL),
  answerLine('q-export-csv-1'),
  amendLine('export-csv', FULL),
  liftIncidentLine('bad-total'),
  incidentFixLine('bad-total', 31),
];

test('each line the build loop writes is found by setLineOf, and matches exactly one set line pattern', () => {
  for (const line of BUILD_LINES) {
    assert.equal(setLineOf(`What this is.\n${line}\nReply code: ${replyCode(line)}`), line, line);
    assert.equal(setLineOf(line), line, line);
    assert.equal(SET_LINES.filter((p) => new RegExp(p.source, p.flags).test(line)).length, 1, line);
  }
  // Every set line pattern is used by a line function's output.
  const all = [
    ...BUILD_LINES, approvalLine(12, FULL), confirmLine({ kind: 'ruling', id: 'x', data: { words: 'w' } }),
    LIFT_STOP, ciPushLine('main', FULL), runbookLine(1), setupLine(10, FULL), confirmAllLine(FULL, 3), baselineLine(FULL),
    trustLine('0a1b2c3d', '2026-10-19T22:30:00.000Z', FULL),
  ];
  for (const pattern of SET_LINES) assert.ok(all.some((line) => new RegExp(pattern.source, pattern.flags).test(line)), String(pattern));
});

test('a trust card\'s line names the computer, the day its key was added and the key\'s fingerprint (ruling R80)', () => {
  const line = trustLine('0a1b2c3d', '2026-10-19T22:30:00.000Z', FULL);
  assert.equal(line, 'Trust your computer 0a1b2c3d, added 19 October 2026, key abcdef123456');
  assert.equal(dayOf('2026-01-05T23:59:59.000Z'), '5 January 2026', 'the day in UTC, day month year');
  assert.equal(dayOf('not a time'), null);
  assert.equal(setLineOf(`What this is.\n${line}`), line);
  assert.equal(SET_LINES.filter((p) => new RegExp(p.source, p.flags).test(line)).length, 1);
  assert.deepEqual(TRUST_LINE.exec(line).slice(1), ['0a1b2c3d', '19 October 2026', 'abcdef123456']);
  for (const near of [
    'Trust your computer 0A1B2C3D, added 19 October 2026, key abcdef123456',
    'Trust your computer 0a1b2c3d, added 19 Oct 2026, key abcdef123456',
    'Trust your computer 0a1b2c3d, added 19 October 2026, key abcdef12345',
    'Trust your computer 0a1b2c3d, added 2026-10-19, key abcdef123456',
    'Trust your computer 0a1b2c3d9, added 19 October 2026, key abcdef123456',
    'Trust your computer 0a1b2c3d, added 19 October 2026, key abcdef123456 now',
  ]) assert.equal(setLineOf(near), null, near);
});

test('a near miss of a build loop line is not a set line', () => {
  const near = [
    'Approve export-csv (feature lane) as written, abcdef1',
    'Approve export-csv (feature lane) as written, ABCDEF123456',
    'Approve export-csv (huge lane) as written, abcdef123456',
    'Approve export-csv (feature lane) as written, abcdef123456, and show it to me',
    'Approve export-csv (feature lane) as written, abcdef123456 now',
    `Approve ${'a'.repeat(41)} (feature lane) as written, abcdef123456`,
    'Approve Export (feature lane) as written, abcdef123456',
    'Answer question export-csv-1',
    'Answer question q-export-csv',
    'Answer question q-export-csv-1 please',
    'Answer question q--x',
    'Change the approved export-csv to this, abcdef1',
    'Change the approved export-csv to this, abcdef123456 today',
    'End incident bad-total and let merges carry on, please',
    'End incident Bad_Total and let merges carry on',
    'Merge pull request #031 as the fix for incident bad-total',
    'Merge pull request #31 as the fix for incident bad-total now',
    'Merge pull request #31 as the fix for incident',
  ];
  for (const line of near) assert.equal(setLineOf(line), null, line);
  // Two lines are none.
  assert.equal(setLineOf(`${answerLine('q-a-1')}\n${answerLine('q-a-2')}`), null);
  assert.equal(setLineOf(`${liftIncidentLine('a')}\n${incidentFixLine('a', 3)}`), null);
  assert.equal(setLineOf(`${approveWorkLine('a', 'bug', FULL)}\n${approvalLine(3, FULL)}`), null);
});

test('the line of setup\'s card of the rules found names how many rules and the list\'s hash, and nothing near it is one', () => {
  assert.equal(confirmAllLine(FULL, 3), `Confirm all 3 rules as listed, ${FULL.slice(0, 12)}`);
  assert.equal(confirmAllLine(FULL, 1), `Confirm all 1 rule as listed, ${FULL.slice(0, 12)}`);
  assert.equal(setLineOf(`What this is.\n${confirmAllLine(FULL, 12)}`), confirmAllLine(FULL, 12));
  for (const near of ['Confirm all 0 rules as listed, abcdef123456', 'Confirm all rules as listed, abcdef123456', 'Confirm all 3 rules as listed, abcdef12345', 'Confirm all 3 rules as listed, ABCDEF123456', 'Confirm all 3 rules, abcdef123456']) {
    assert.equal(setLineOf(near), null, near);
  }
  // It is not read as a confirm line for one event.
  assert.equal(SET_LINES.filter((p) => new RegExp(p.source, p.flags).test(confirmAllLine(FULL, 3))).length, 1);
});
