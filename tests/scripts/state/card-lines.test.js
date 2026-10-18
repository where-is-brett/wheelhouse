// tests/scripts/state/card-lines.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replyCode, replyCodeLine, setLineOf, SET_LINES, CODE_ALPHABET,
  approvalLine, confirmLine, LIFT_STOP, runbookLine, ciPushLine,
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
  assert.equal(SET_LINES.length, 5);
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
