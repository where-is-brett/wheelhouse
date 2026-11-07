// tests/scripts/state/old-records.test.js
// Records written before the core cut may hold what delegation, concept learning and blind cards wrote. They must
// still build the views, and nothing may act on them: no view shows them, and a known:* setting is never in force.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViews } from '../../../scripts/state/views.js';
import { effectiveSettings } from '../../../scripts/settings/effective.js';
import { checkSetting, definitionOf } from '../../../scripts/settings/catalogue.js';

const T = (n) => `2026-10-18T02:00:${String(n).padStart(2, '0')}.000Z`;
const now = () => new Date('2026-10-18T03:00:00.000Z');
const ev = (id, n, kind, data) => ({ v: 1, id, at: T(n), computer: 'aaaaaaaa', kind, data });

const work = ev('w1', 1, 'work', { id: 'export-csv', title: 'Export', lane: 'feature', doc: { path: 'd.md', hash: 'a'.repeat(64) }, visible: true, dependsOn: [] });
const question = ev('q1', 2, 'question', { id: 'q-export-csv-500001', work: 'export-csv', what: 'Which?', why: 'It matters.', options: [{ label: 'One', says: 'x' }, { label: 'Two', says: 'y' }], recommendation: 'One', level: 3 });

// What an earlier release wrote and this one no longer takes.
const OLD = [
  ev('o1', 3, 'rule', { id: 'rule-1', words: 'Take the recommendation on naming', hash: 'b'.repeat(64) }),
  ev('o2', 4, 'shadow', { question: 'q-export-csv-500001', would: 'One' }),
  ev('o3', 5, 'match', { question: 'q-export-csv-500001', rule: 'rule-1', same: true }),
  ev('o4', 6, 'chat-question', { at: T(6) }),
  ev('o5', 7, 'level', { topic: 'naming', from: 3, to: 2, because: 'always taken' }),
  ev('o6', 8, 'setting', { key: 'known:git', value: true, words: 'Knows "git": yes' }),
  ev('o7', 9, 'setting', { key: 'blindCards', value: false, words: 'Blind cards: off' }),
  ev('o8', 10, 'setting', { key: 'delegationReviewDays', value: 30, words: 'Days between delegation reviews: 30 days' }),
];

test('a record holding delegation, blind-card and concept events still builds the same views, and none shows them', () => {
  const plain = buildViews([work, question], [], { now });
  const old = buildViews([work, question, ...OLD], [], { now });
  assert.deepEqual(old.work, plain.work);
  assert.deepEqual(old.damaged, plain.damaged);
  assert.deepEqual(old.waiting, plain.waiting);
  for (const name of ['rules', 'shadows', 'matches', 'delegation', 'reviews']) assert.equal(name in old && !(name in plain), false, name);
});

test('an old profile holding known:git, blindCards or delegationReviewDays checks, and none is in force', () => {
  for (const [key, value] of [['known:git', true], ['known:feature-flags', false], ['blindCards', false], ['delegationReviewDays', 30]]) {
    assert.doesNotThrow(() => checkSetting(key, value), key);
    assert.equal(definitionOf(key).retired, true, key);
  }
  const settings = buildViews(OLD, [], { now }).settings;
  const e = effectiveSettings({ project: settings, profile: settings, now: now() });
  for (const key of ['known:git', 'blindCards', 'delegationReviewDays']) assert.equal(key in e, false, key);
});
