// tests/scripts/gate/visible.test.js
// Whether a change shows something users see, judged from the change itself (design section 8 of the director's way of working):
// by the files it touches and by the text it changes in code. A change the detectors can't judge is unsure, and unsure waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleFromChange } from '../../../scripts/gate/visible.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';

// A unified diff of one file: the lines taken out and the lines put in.
const diff = (file, { remove = [], add = [] } = {}) => [
  `diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@',
  ...remove.map((l) => `-${l}`), ...add.map((l) => `+${l}`), '',
].join('\n');

const CONFIG = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };

test('a page or template change is visible', () => {
  for (const file of ['src/pages/pricing.js', 'templates/mail.hbs', 'src/components/Button.jsx', 'public/site.css', 'locales/en.json', 'bin/tide', 'src/api/routes.js', 'src/flags.js', 'src/settings.js', 'index.html']) {
    const got = visibleFromChange({ paths: [file], diff: diff(file, { add: ['x'] }) });
    assert.equal(got.visible, true, file);
    assert.ok(got.reasons.some((r) => r.includes(file)), file);
  }
});

test('a test-only change is not visible', () => {
  const paths = ['tests/scripts/tide.test.js', 'src/tide.spec.js', 'src/__tests__/a.js', 'docs/notes.md', 'README.md'];
  const text = paths.map((p) => diff(p, { remove: ["const a = 'Tide chart failed';"], add: ["const a = 'Tide chart could not load';"] })).join('');
  assert.deepEqual(visibleFromChange({ paths, diff: text }), { visible: false, unsure: false, reasons: [] });
});

test('a changed string literal in source is visible', () => {
  const file = 'src/tide.js';
  const changed = visibleFromChange({ paths: [file], diff: diff(file, { remove: ["throw new Error('Tide chart failed');"], add: ["throw new Error('Tide chart could not load');"] }) });
  assert.equal(changed.visible, true);
  assert.equal(changed.unsure, false);
  // The same text moved, a comment, an import and a change with no literal are not text users see.
  const same = visibleFromChange({ paths: [file], diff: diff(file, { remove: ["a('One one');", "b('Two two');"], add: ["b('Two two');", "a('One one');"] }) });
  assert.equal(same.visible, false);
  assert.equal(visibleFromChange({ paths: [file], diff: diff(file, { remove: ["import x from './a.js';"], add: ["import x from './b.js';", '// "A new note"'] }) }).visible, false);
  assert.equal(visibleFromChange({ paths: [file], diff: diff(file, { remove: ['const n = 1;'], add: ['const n = 2;'] }) }).visible, false);
});

test('an unknown file kind in source is unsure and waits', () => {
  for (const file of ['src/model.xyz', 'src/data/tides.bin', 'content/post.md', 'src/data/tides.json']) {
    const got = visibleFromChange({ paths: [file], diff: diff(file, { add: ['x'] }) });
    assert.equal(got.unsure, true, file);
    assert.equal(got.visible, false, file);
  }
});

test('a config path override is honoured', () => {
  const file = 'src/billing/rates.js';
  const text = diff(file, { remove: ['const r = 1;'], add: ['const r = 2;'] });
  assert.equal(visibleFromChange({ paths: [file], diff: text }).visible, false);
  const config = readConfig(JSON.stringify({ ...CONFIG, visibility: { paths: ['src/billing/**'] } }));
  assert.equal(visibleFromChange({ paths: [file], diff: text, config }).visible, true);
  assert.throws(() => readConfig(JSON.stringify({ ...CONFIG, visibility: { paths: 'src' } })));
  assert.throws(() => readConfig(JSON.stringify({ ...CONFIG, visibility: { other: [] } })));
});

test('a diff or paths that can\'t be read are unsure, never not visible', () => {
  const file = 'src/tide.js';
  const text = diff(file, { add: ['const n = 2;'] });
  for (const input of [{ paths: [file] }, { paths: [file], diff: null }, { paths: [], diff: text }, { paths: null, diff: text }, { paths: [file, 7], diff: text }, { diff: text }, undefined]) {
    const got = visibleFromChange(input);
    assert.equal(got.unsure, true, JSON.stringify(input));
    assert.ok(got.reasons.length > 0);
  }
  // A code file the diff doesn't cover can't be judged, nor can a binary change to code.
  assert.equal(visibleFromChange({ paths: [file, 'src/other.js'], diff: text }).unsure, true);
  assert.equal(visibleFromChange({ paths: [file], diff: `diff --git a/${file} b/${file}\nBinary files a/${file} and b/${file} differ\n` }).unsure, true);
});
