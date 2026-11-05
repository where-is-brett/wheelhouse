// tests/scripts/foreman/work-card.test.js
// The question a director's "fix it" or "ship it" puts to the Bosun: fixed words, never "ship it as it is" while a
// signed review holds the merge, and none without an open pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workCardFor, workQuestion, FIX_FINDINGS, RESTART_BUILDER } from '../../../scripts/foreman/ask-help.js';
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
    { label: 'Stop this work', says: 'act close mine' },
  ]);
  assert.match(data.what, /pull request #2\. Its signed review holds the merge, so it cannot go in as it is\./);
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

test('no card without the work, an open pull request, or when the Bosun has asked already', () => {
  assert.match(workCardFor(views(null), { work: 'other', pr: 2 }).skip, /no such work/);
  assert.match(workCardFor(views(null), { work: 'mine', pr: null }).skip, /no open pull request/);
  assert.match(workCardFor(views(null, { features: { mine: { data: { step: 'closed' } } } }), { work: 'mine', pr: 2 }).skip, /ended/);
  const asked = views(null, { questions: { 'q-mine-1000001': { question: { data: { id: 'q-mine-1000001', work: 'mine' } }, answer: null } } });
  assert.match(workCardFor(asked, { work: 'mine', pr: 2 }).skip, /already/);
});

test('the words are fixed: a work name is the only thing in them', () => {
  const q = workQuestion('mine', { pr: 7, findings: true });
  assert.equal(q.why, 'The director asked for it to be finished, and only the Bosun can move it.');
});
