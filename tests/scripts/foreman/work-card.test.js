// tests/scripts/foreman/work-card.test.js
// The question a director's "fix it" or "ship it" puts to the Bosun: fixed words, never "ship it as it is" while a
// signed review holds the merge, and with no pull request it offers to wake the session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stuckAskCommand, workCardFor, workQuestion, FIX_FINDINGS, RESTART_BUILDER } from '../../../scripts/foreman/ask-help.js';
import { questionProblem } from '../../../scripts/cards/compose.js';

const COMMIT = 'c'.repeat(40);
const views = (verdict, over = {}) => ({
  features: { mine: { data: { work: 'mine', step: 'building' } } },
  questions: {},
  reviews: verdict ? { 2: { [COMMIT]: { at: '2026-11-05T18:35:00.000Z', data: { pr: 2, commit: COMMIT, verdict, findings: 3 } } } } : {},
  ...over,
});

test('a review that holds the merge gives fix-the-findings or stop, and never ship-as-it-is', () => {
  const { data } = workCardFor(views('FINDINGS'), { work: 'mine', pr: 2 });
  assert.deepEqual(data.options, [
    { label: FIX_FINDINGS, says: 'act restart mine' },
    { label: 'Leave it for now', says: 'Nothing to do now; the pull request waits as it is' },
  ]);
  assert.equal(data.what, 'mine has pull request #2 open. Its signed review holds the merge. What should happen?');
  assert.ok(!data.options.some((o) => /act close/.test(o.says)), 'close needs a report, so it is not offered');
  assert.equal(data.recommendation, FIX_FINDINGS);
  assert.match(data.id, /^q-mine-\d+$/);
  assert.equal(questionProblem(data), null);
  assert.ok(!data.options.some((o) => /ship|merge/i.test(o.label)));
});

test('with no review that holds it, the builder is restarted where it left off', () => {
  const { data } = workCardFor(views('CLEAN'), { work: 'mine', pr: 2 });
  assert.equal(data.options[0].label, RESTART_BUILDER);
  assert.doesNotMatch(data.what, /holds the merge/);
});

test('no card without the work, or when the Bosun has asked already', () => {
  assert.match(workCardFor(views(null), { work: 'other', pr: 2 }).skip, /no such work/);
  assert.match(workCardFor(views(null, { features: { mine: { data: { step: 'closed' } } } }), { work: 'mine', pr: 2 }).skip, /ended/);
  const asked = views(null, { questions: { 'q-mine-1000001': { question: { at: '2026-11-05T10:00:00.000Z', data: { id: 'q-mine-1000001', work: 'mine' } }, answer: null } } });
  assert.match(workCardFor(asked, { work: 'mine', pr: 2 }).skip, /already/);
});

test('a work with no pull request is offered the restart card, so a held session can be woken', () => {
  const { data } = workCardFor(views(null), { work: 'mine', pr: null });
  assert.equal(data.what, 'mine has no pull request yet, and its session may be holding for something that has since happened. What should happen?');
  assert.deepEqual(data.options, [
    { label: RESTART_BUILDER, says: 'act restart mine' },
    { label: 'Leave it for now', says: 'Nothing to do now; the work waits as it is' },
  ]);
  assert.equal(questionProblem(data), null);
  assert.match(workCardFor(views(null), { work: 'mine', pr: null, merged: true }).skip, /merged/);
  assert.match(workCardFor(views(null, { features: { mine: { data: { step: 'closed' } } } }), { work: 'mine', pr: null }).skip, /ended/);
  assert.match(workCardFor(views(null), { work: 'mine', pr: null, stuck: true }).skip, /stuck card/);
});

test('the words are fixed: a work name is the only thing in them', () => {
  const q = workQuestion('mine', { pr: 7, findings: true });
  assert.equal(q.why, 'Only the Bosun can move it.');
  assert.doesNotMatch(q.what, /director/);
});

test('no card for a stuck work, a merged pull request, or within 30 minutes of the last card or its answer', () => {
  assert.match(workCardFor(views(null), { work: 'mine', pr: 2, stuck: true }).skip, /stuck card/);
  assert.match(workCardFor(views(null), { work: 'mine', pr: 2, merged: true }).skip, /merged/);
  const answered = (at) => views(null, { questions: { 'q-mine-1000001': { question: { at: '2026-11-05T10:00:00.000Z', data: { id: 'q-mine-1000001', work: 'mine' } }, answer: { at } } } });
  const now = new Date('2026-11-05T10:40:00.000Z');
  assert.ok(workCardFor(answered('2026-11-05T10:20:00.000Z'), { work: 'mine', pr: 2, now }).skip.match(/30 minutes/));
  assert.ok(workCardFor(answered('2026-11-05T10:05:00.000Z'), { work: 'mine', pr: 2, now }).data);
});

test('the stuck wake\'s command matches the stuck card: fix the findings when a review holds, else restart', () => {
  assert.match(stuckAskCommand('mine', { phase: 'pr-open', still: 20 * 60000, findings: true }), /--option 'Have the builder fix the findings=act restart mine' --option 'Wait=.+' --recommend 'Have the builder fix the findings' --level 2$/);
  assert.match(stuckAskCommand('mine', { findings: false }), /--option 'Restart the builder on where it left off=act restart mine'/);
});
