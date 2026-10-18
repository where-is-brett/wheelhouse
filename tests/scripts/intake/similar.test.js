// tests/scripts/intake/similar.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similar, COMMON_WORDS } from '../../../scripts/intake/similar.js';

const T = (n) => `2026-10-18T02:00:${String(n).padStart(2, '0')}.000Z`;

const workItem = (id, title, n) => ({
  work: { key: id, id: `w${n}`, at: T(n), data: { id, title, lane: 'small', visible: true, dependsOn: [] } },
  since: T(n),
  approved: false,
});
const plain = (key, data, n) => ({ key, id: `e${n}`, at: T(n), data });

const views = {
  work: {
    'csv-export': workItem('csv-export', 'Export the change list as a spreadsheet', 1),
    'login-page': workItem('login-page', 'Sign-in page for returning customers', 2),
  },
  ideas: {
    'dark-mode': plain('dark-mode', { key: 'dark-mode', text: 'Add a dark mode to the dashboard' }, 3),
    'weekly-email': plain('weekly-email', { key: 'weekly-email', text: 'A weekly summary email for each customer' }, 4),
  },
  rejections: {
    ads: plain('ads', { key: 'ads', text: 'Show advertising banners', reason: 'It would cheapen the product' }, 5),
  },
};

test('a duplicate scores highest, and its line names the item', () => {
  const found = similar('Could we add a dark mode to the dashboard?', views);
  assert.ok(found.length >= 1);
  assert.deepEqual(Object.keys(found[0]).sort(), ['id', 'kind', 'score', 'title']);
  assert.equal(found[0].kind, 'idea');
  assert.equal(found[0].id, 'dark-mode');
  assert.equal(found[0].title, 'Add a dark mode to the dashboard');
  assert.equal(found[0].score, 1);
  for (const other of found.slice(1)) assert.ok(other.score < found[0].score);
});

test('an unrelated item scores zero and is left out', () => {
  const found = similar('Add a dark mode to the dashboard', views);
  assert.ok(!found.some((f) => f.id === 'login-page'));
  assert.ok(!found.some((f) => f.id === 'ads'));
  assert.deepEqual(similar('Fix the typo in the footer', views), []);
});

test('work, ideas and rejections are all checked, each by its title and text fields', () => {
  const work = similar('export the change list to a spreadsheet', views);
  assert.equal(work[0].kind, 'work');
  assert.equal(work[0].id, 'csv-export');
  assert.equal(work[0].title, 'Export the change list as a spreadsheet');

  const rejected = similar('put advertising banners on the home page', views);
  assert.equal(rejected[0].kind, 'rejection');
  assert.equal(rejected[0].id, 'ads');
  assert.equal(rejected[0].title, 'Show advertising banners');

  // A rejection's reason is one of its text fields.
  assert.equal(similar('would it cheapen the product?', views)[0].id, 'ads');
});

test('case, punctuation and common words do not count', () => {
  assert.ok(COMMON_WORDS.has('the') && COMMON_WORDS.has('please'));
  const a = similar('DARK MODE, please!', views);
  const b = similar('dark mode', views);
  assert.deepEqual(a, b);
  assert.deepEqual(similar('the a of to and please could we', views), []);
});

test('scores are between zero and one, highest first, with a stable order for ties', () => {
  const tied = {
    work: { 'customer-report': workItem('customer-report', 'Customer report', 1) },
    ideas: { 'customer-report': plain('customer-report', { key: 'customer-report', text: 'Customer report' }, 2) },
    rejections: { 'customer-report': plain('customer-report', { key: 'customer-report', text: 'Customer report' }, 3) },
  };
  const found = similar('customer report', tied);
  assert.deepEqual(found.map((f) => f.kind), ['work', 'idea', 'rejection']);
  for (const f of found) assert.ok(f.score > 0 && f.score <= 1);

  const mixed = similar('weekly customer summary email for the dashboard', views);
  for (let i = 1; i < mixed.length; i += 1) assert.ok(mixed[i - 1].score >= mixed[i].score);
  assert.deepEqual(similar('weekly customer summary email for the dashboard', views), mixed);
});

test('the limit caps the lines, five by default', () => {
  const many = { work: {}, ideas: {}, rejections: {} };
  for (let i = 1; i <= 8; i += 1) many.ideas[`idea-${i}`] = plain(`idea-${i}`, { text: `Invoice export option ${i}` }, i);
  assert.equal(similar('invoice export', many).length, 5);
  assert.equal(similar('invoice export', many, { limit: 2 }).length, 2);
  assert.equal(similar('invoice export', many, { limit: 20 }).length, 8);
});

test('only open work is checked: work whose report says merged or closed is left out', () => {
  const report = (work, outcome, n) => plain(work, { work, outcome, summary: 'done', rulings: [] }, n);
  const ended = {
    work: {
      'export-a': workItem('export-a', 'Invoice export', 1),
      'export-b': workItem('export-b', 'Invoice export', 2),
      'export-c': workItem('export-c', 'Invoice export', 3),
      'export-d': workItem('export-d', 'Invoice export', 4),
    },
    reports: {
      'export-a': report('export-a', 'merged', 5),
      'export-b': report('export-b', 'closed', 6),
      'export-c': report('export-c', 'blocked', 7),
    },
  };
  assert.deepEqual(similar('invoice export', ended).map((f) => f.id), ['export-c', 'export-d']);
  // Work recorded again after its report ended it is open once more (R102).
  ended.work['export-b'] = workItem('export-b', 'Invoice export', 8);
  assert.deepEqual(similar('invoice export', ended).map((f) => f.id), ['export-b', 'export-c', 'export-d']);
});

test('missing views and empty text give no lines', () => {
  assert.deepEqual(similar('dark mode', {}), []);
  assert.deepEqual(similar('', views), []);
  assert.deepEqual(similar('dark mode', { ideas: { odd: plain('odd', {}, 1) } }), []);
});
