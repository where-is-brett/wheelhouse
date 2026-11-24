// tests/scripts/host/local/undo.test.js
// The card asking to undo a merge on a project kept in git alone, and the click in the chat that decides it (ruling P5-50).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withKeyedHome } from '../../../helpers/local-home.js';
import { openProjectRecord } from '../../../../scripts/state/record.js';
import { makeEvent, writeEvent } from '../../../../scripts/state/events.js';
import { sign } from '../../../../scripts/state/signing.js';
import { UNDO_LINE, undoCard, undoCards, undoLine, chatClick } from '../../../../scripts/host/local/undo.js';

const P = 'shop';
const MERGE = 'e'.repeat(40);

test('the undo card says All stop, and its earlier words still name the same card', () => {
  const [now, earlier] = undoCards(MERGE);
  assert.deepEqual(now, undoCard(MERGE));
  assert.match(now.question, /works while All stop is on/);
  assert.match(earlier.question, /works while STOP is on/);
  assert.deepEqual({ ...earlier, question: undefined }, { ...now, question: undefined }, 'only the words differ');
});

test('the card carries exactly one line naming the merge in full', () => {
  const lines = [...undoCard(MERGE).question.matchAll(UNDO_LINE)];
  assert.equal(lines.length, 1);
  assert.equal(lines[0][1], MERGE);
  assert.equal(lines[0][0], undoLine(MERGE));
});

const click = (action, data, proof) => sign(makeEvent({ kind: 'action', data: { action, ...data, question: 'Take this merge back out?', label: 'Undo', ...(proof === undefined ? {} : { proof }) } }));

test('a signed click in the chat is found once, and an undo record that names it uses it up', async () => {
  await withKeyedHome(async () => {
    await openProjectRecord(P, {});
    assert.equal(chatClick(P, 'undo-merge', (d) => d.merge === MERGE), null, 'no click yet');
    const made = click('undo-merge', { merge: MERGE });
    await writeEvent({ project: P, event: made });
    assert.equal(chatClick(P, 'undo-merge', (d) => d.merge === MERGE).id, made.id);
    assert.equal(chatClick(P, 'undo-merge', (d) => d.merge === 'f'.repeat(40)), null, 'another merge');
    assert.equal(chatClick(P, 'undo-main', () => true), null, 'another action');
    const used = sign(makeEvent({ kind: 'note', data: { lean: 'undo', click: made.id, text: 'undone' } }));
    await writeEvent({ project: P, event: used });
    assert.equal(chatClick(P, 'undo-merge', (d) => d.merge === MERGE), null, 'one click undoes once');
  });
});

test('a click the helper signed from what a hook saw counts, and a click naming any other proof does not', async () => {
  await withKeyedHome(async () => {
    await openProjectRecord(P, {});
    const other = click('undo-merge', { merge: MERGE }, 'chat-click');
    await writeEvent({ project: P, event: other });
    assert.equal(chatClick(P, 'undo-merge', (d) => d.merge === MERGE), null, 'a chat click is no signed click');
    const seen = click('undo-merge', { merge: MERGE }, 'hook-click');
    await writeEvent({ project: P, event: seen });
    assert.equal(chatClick(P, 'undo-merge', (d) => d.merge === MERGE).id, seen.id);
  });
});
