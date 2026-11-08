// tests/probes/haiku-trial/review-card.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewCard, stepsPage, writeTryMe, recommendation, REVIEW_TITLE } from '../../../probes/haiku-trial/review-card.js';
import { PHONE_LIMIT, shapeProblems } from '../../../scripts/cards/compose.js';

const given = {
  project: 'spending-tracker', date: '2026-11-08', decisionN: 3, stepsUrl: 'https://example.invalid/steps', address: 'https://tracker.example.invalid',
  score: { total: 84, pass: true }, rows: [{ id: 1, pass: true }, { id: 2, pass: false }, { id: 3, pass: null }],
};

test('card fits the phone limit', () => {
  const { text } = reviewCard(given);
  assert.ok(text.length <= PHONE_LIMIT.chars, `${text.length} characters`);
  assert.ok(text.split('\n').length <= PHONE_LIMIT.lines);
  assert.ok(reviewCard({ project: 'p', date: '2026-11-08', decisionN: 1 }).text.length <= 1400);
});

test('card has the title, three options, a recommendation and a meanwhile', () => {
  const card = reviewCard(given);
  assert.equal(card.title, 'Check the spending tracker Wheelhouse built on Haiku');
  assert.equal(card.title, REVIEW_TITLE);
  assert.deepEqual(card.options.map((o) => [o.key, o.label]), [['A', 'Tag it as working on Haiku'], ['B', 'Tag it without the claim and record the floors'], ['C', 'Hold the tag']]);
  assert.match(card.text, /I recommend B/);
  assert.match(card.text, /Meanwhile:/);
  assert.match(card.text, /decision 3/);
  assert.match(card.text, /8 November 2026/);
  assert.deepEqual(shapeProblems({ what: card.title, why: 'It is the director\'s call', options: card.options, recommend: card.options.find((o) => o.key === card.recommend).label, because: 'the score passed', meanwhile: 'nothing builds' }), []);
});

test('the recommendation follows section 11', () => {
  assert.equal(recommendation({ score: { pass: true }, rows: [{ pass: true }] }), 'A');
  assert.equal(recommendation({ score: { pass: true }, rows: [{ pass: false }] }), 'B');
  assert.equal(recommendation({ score: { pass: false }, rows: [] }), 'C');
  assert.equal(recommendation({}), 'C');
});

test('steps page has the nine steps with the import counts', () => {
  const md = stepsPage({ decisionN: 3 });
  assert.match(md, /Show the steps/);
  const steps = md.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.equal(steps.length, 9);
  steps.forEach((l, i) => assert.ok(l.startsWith(`${i + 1}. `)));
  assert.match(steps[2], /added 41, skipped 0/);
  assert.match(steps[3], /added 0, skipped 41/);
  assert.match(steps[6], /decision 3/);
});

test('try-me has 41 rows and no duplicates', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-tryme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rows = fs.readFileSync(writeTryMe(dir), 'utf8').trim().split(/\r?\n/);
  assert.equal(rows[0], 'Date,Description,Amount');
  assert.equal(rows.length - 1, 41);
  assert.equal(new Set(rows.slice(1)).size, 41);
});
