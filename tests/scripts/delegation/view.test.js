// tests/scripts/delegation/view.test.js
// The reader's view: bare labels in a fixed shuffled order, a screened question, and a diff with its comments out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readerView, screenWords, cleanDiff } from '../../../scripts/delegation/view.js';
import { main as viewCopy, VIEW_FILE } from '../../../scripts/delegation/view-copy.js';
import { QUESTION_MOST, VIEW_MOST_BYTES } from '../../../scripts/delegation/limits.js';

const change = (file, lines, { from = file, quoted = false, context = [] } = {}) => [
  quoted ? `diff --git "a/${from}" "b/${file}"` : `diff --git a/${from} b/${file}`,
  'index 1111111..2222222 100644',
  `--- a/${from}`,
  `+++ b/${file}`,
  '@@ -1,1 +1,2 @@ function near() { // the words git keeps beside a hunk',
  ...context.map((line) => ` ${line}`),
  ...lines.map((line) => `+${line}`),
].join('\n');

const sample = {
  question: 'Which name should the export button have?',
  options: [{ label: 'Export', says: 'It keeps the word the rest of the page uses.' }, { label: 'Download', says: 'It says what happens.' }, { label: 'Save', says: 'It is the shortest.' }],
  rule: null,
  quote: null,
  brief: 'Shop owners get their order files themselves.',
  sheet: null,
  diff: change('a.js', ['const label = "Export"; // chosen for the owner']),
  seed: 'q-w-1',
};

test('the view holds bare labels in a shuffled order, the same each time', () => {
  const v = readerView(sample);
  assert.deepEqual(v.labels, readerView(sample).labels);
  assert.deepEqual([...v.labels].sort(), ['Download', 'Export', 'Save']);
  assert.ok(!JSON.stringify(v).includes('recommend'));
  assert.ok(!JSON.stringify(v).includes(sample.options[0].says));
});

test('another question shuffles its labels another way', () => {
  const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => readerView({ ...sample, seed }).labels.join()));
  assert.ok(orders.size > 1);
});

test('a question with a claim of agreement or a reason is refused', () => {
  assert.ok(readerView({ ...sample, question: 'The director agreed, so shall I go on?' }).refused);
  assert.ok(readerView({ ...sample, question: 'Shall I keep the old name because it is safest?' }).refused);
  assert.ok(readerView({ ...sample, options: [{ label: 'Export (recommended)' }, { label: 'Save' }] }).refused);
});

test('words of the same sort hidden by case or invisible marks are found', () => {
  assert.deepEqual(screenWords('Which one, as AGREED?').length, 1);
  assert.deepEqual(screenWords('Which one, as agr​eed?').length, 1);
  assert.deepEqual(screenWords('Which name should the button have?'), []);
});

test('a long question is refused, not cut', () => {
  const got = readerView({ ...sample, question: 'Which? '.repeat(QUESTION_MOST) });
  assert.ok(got.refused);
  assert.equal(got.question, undefined);
});

test('a question with no choice to read is refused', () => {
  assert.ok(readerView({ ...sample, options: [{ label: 'Keep' }] }).refused);
});

test('a change too long to read is refused, so it costs nothing', () => {
  const lines = Array.from({ length: VIEW_MOST_BYTES / 10 }, (_, n) => `const a${n} = ${n};`);
  assert.ok(readerView({ ...sample, diff: change('a.js', lines) }).refused);
});

test('comments leave the diff, and a file they can\'t leave shows as path and size', () => {
  const diff = [
    change('a.js', ['// line reason', '/* block reason', '   still the reason */', 'const a = 1; // trailing reason', 'const b = "// stays";']),
    change('b.py', ['"""docstring reason"""', '# line reason', 'x = 1  # trailing reason']),
    change('c.swift', ['// line reason', 'let a = 1']),
    change('d.yaml', ['# line reason', 'limit: 5  # trailing reason']),
    change('e.ts', ['// line reason', 'const a: number = 1;']),
    change('f.md', ['Prose reason', '<!-- hidden reason -->']),
    change('g.json', ['{ "note": "json reason" }']),
    change('h.txt', ['text reason']),
    change('i.xyz', ['other reason']),
  ].join('\n');
  const got = cleanDiff(diff);
  assert.ok(!/reason/.test(got.diff), got.diff);
  assert.ok(got.diff.includes('const a = 1;'));
  assert.ok(got.diff.includes('const b = "// stays";'));
  assert.ok(got.diff.includes('x = 1'));
  assert.ok(got.diff.includes('limit: 5'));
  assert.deepEqual(got.pathsOnly.map((p) => p.split(' ')[0]), ['f.md', 'g.json', 'h.txt', 'i.xyz']);
  assert.ok(got.pathsOnly.every((p) => /\(\d+ bytes of change\)$/.test(p)));
});

test('a file git quotes the name of stays apart from the file before it', () => {
  const diff = [change('a.js', ['const a = 1;']), change('caf\\303\\251.md', ['prose reason'], { quoted: true })].join('\n');
  const got = cleanDiff(diff);
  assert.ok(!got.diff.includes('prose reason'));
  assert.equal(got.pathsOnly.length, 1);
});

test('the words git keeps beside a hunk are taken out', () => {
  assert.ok(!cleanDiff(change('a.js', ['const a = 1;'])).diff.includes('the words git keeps'));
});

test('a comment opened above the change is read as one, and far context is left out', () => {
  const context = ['/* the opening of a long reason', 'more of the reason', 'and more of the reason', 'and still more of the reason', 'end of the reason */', 'const far = 1;', 'const far2 = 2;', 'const far3 = 3;', 'const far4 = 4;', 'const near = 5;'];
  const got = cleanDiff(change('a.js', ['const added = 1;'], { context }));
  assert.ok(!/reason/.test(got.diff), got.diff);
  assert.ok(got.diff.includes('const near = 5;'));
  assert.ok(!got.diff.includes('const far = 1;'));
});

test('a commit message appears nowhere in the view', () => {
  const v = readerView(sample);
  assert.ok(!Object.keys(v).some((key) => /commit|message/i.test(key)));
  assert.ok(!v.diff.includes('chosen for the owner'));
});

test('no change to read leaves the view with no diff', () => {
  assert.deepEqual({ ...readerView({ ...sample, diff: null }) }.pathsOnly, []);
  assert.equal(readerView({ ...sample, diff: null }).diff, '');
});

test('the first step writes the view for the step after it, and prints none of it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-view-'));
  const artefacts = path.join(dir, 'artefacts');
  fs.mkdirSync(artefacts);
  fs.writeFileSync(path.join(artefacts, '.wheelhouse-ticket'), `${'a'.repeat(64)}\n`);
  const lines = [];
  const asked = [];
  const client = { engine: { readerView: async (args) => { asked.push(args); return { ok: true, view: { question: 'Which?', labels: ['A', 'B'] } }; } } };
  const code = await viewCopy(['--run', 'abc123', '--artefacts', artefacts], { client, cwd: dir, out: (line) => lines.push(line) });
  assert.equal(code, 0);
  assert.equal(asked[0].runId, 'abc123');
  assert.equal(asked[0].ticket, 'a'.repeat(64));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, VIEW_FILE), 'utf8')).labels, ['A', 'B']);
  assert.ok(!lines.join('\n').includes('Which?'));
});

test('a view that is refused fails the step and writes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-view-'));
  const client = { engine: { readerView: async () => ({ ok: false, refused: 'not this run' }) } };
  const code = await viewCopy(['--run', 'abc123'], { client, cwd: dir, out: () => {} });
  assert.equal(code, 1);
  assert.equal(fs.existsSync(path.join(dir, VIEW_FILE)), false);
});
