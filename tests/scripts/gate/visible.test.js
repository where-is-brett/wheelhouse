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
  const paths = ['tests/scripts/tide.test.js', 'src/tide.spec.js', 'src/__tests__/a.js', 'docs/notes.md'];
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

// Text that users see in forms a quoted-literal reading misses: each is visible or unsure, never quietly internal.
test('text between tags, inside multi-line strings and behind a hash or slashes is not read as internal', () => {
  const cases = [
    ['src/App.js', ['<h1>Welcome</h1>'], ['<h1>Hello</h1>']],
    ['src/mail.js', ['  Welcome back to the tide chart'], ['  Hello and welcome to the tide chart']],
    ['src/mail.py', ['    Welcome back to the tide chart'], ['    Hello and welcome to the tide chart']],
    ['src/err.rs', ['#[error("Tide chart failed")]'], ['#[error("Tide chart could not load")]']],
    ['src/msg.c', ['#define MSG "Tide chart failed"'], ['#define MSG "Tide chart could not load"']],
    ['src/url.js', ['const m = "Tide // failed";'], ['const m = "Tide // could not load";']],
  ];
  for (const [file, remove, add] of cases) {
    const got = visibleFromChange({ paths: [file], diff: diff(file, { remove, add }) });
    assert.ok(got.visible || got.unsure, `${file}: ${JSON.stringify(got)}`);
  }
  // A string with a slash run in it that does not change is still not a change.
  const same = visibleFromChange({ paths: ['src/u.js'], diff: diff('src/u.js', { remove: ['a("x // y"); n = 1;'], add: ['a("x // y"); n = 2;'] }) });
  assert.equal(same.visible, false);
  assert.equal(same.unsure, false);
});

// A changed line with letters and no closed literal is unsure unless it plainly looks like code: with --unified=0 the middle line of a
// multi-line template or JSX arrives alone, as bare prose.
test('a bare line of prose in code is unsure, and a plain line of code is internal', () => {
  const prose = [
    ['src/lib/a.js', 'Welcome', 'Goodbye'],
    ['src/lib/a.js', 'Free shipping (today only)', 'Free shipping (this week only)'],
    ['src/lib/a.js', 'Price: $5 per month', 'Price: $6 per month'],
    ['src/lib/a.js', 'Save 20% today', 'Save 30% today'],
    ['src/lib/a.js', 'Terms & conditions apply', 'Terms & conditions may apply'],
    ['src/lib/a.js', 'and your receipt.', 'and your invoice.'],
    ['src/lib/a.js', 'new arrivals every week', 'new arrivals every day'],
    ['src/lib/a.js', 'or try again later.', 'or try again soon.'],
    ['src/lib/a.py', 'Thank you for your order (ref 12).', 'Thank you for your order (ref 13).'],
    ['src/lib/a.js', 'Hello {name}, welcome', 'Hello {name}, welcome back'],
  ];
  for (const [file, before, after] of prose) {
    const got = visibleFromChange({ paths: [file], diff: diff(file, { remove: [before], add: [after] }) });
    assert.ok(got.visible || got.unsure, `${before}: ${JSON.stringify(got)}`);
  }
  for (const line of ['const x = y + 1;', 'return foo(bar);', 'if (a) {', '}', 'def run(self):', 'export default App', 'import x from "./x.js";', 'else:', '});', '{ a: 1 }']) {
    const file = line.startsWith('def') ? 'src/lib/a.py' : 'src/lib/a.js';
    const got = visibleFromChange({ paths: [file], diff: diff(file, { add: [line] }) });
    assert.deepEqual([got.visible, got.unsure], [false, false], `${line}: ${JSON.stringify(got)}`);
  }
});

// The middle lines of a multi-line string or template can carry code punctuation and still be text users see.
test('prose and style declarations with code punctuation are unsure', () => {
  const text = [
    '  color: red;', '  font-size: 14px;', '  margin: 0 auto', 'You have 3 item(s) in your cart', 'Call us(9am to 5pm)',
    'Note: see below;', 'Total = $5', 'Thanks for shopping; come again soon', 'Your total = five dollars today',
  ];
  for (const file of ['src/lib/a.js', 'src/lib/a.ts']) {
    for (const line of text) {
      const got = visibleFromChange({ paths: [file], diff: diff(file, { add: [line] }) });
      assert.ok(got.visible || got.unsure, `${file} ${line}: ${JSON.stringify(got)}`);
    }
  }
});

test('ordinary code lines with no brackets or semicolons are internal', () => {
  const by = {
    'src/lib/a.py': ['if x:', 'for a in b:', 'for item in items:', 'else:', 'try:', 'finally:', 'except ValueError:', 'from x import y', 'from flask import Flask', '@property', 'print(x)', 'while True:', 'def f():'],
    'src/lib/a.rb': ['attr_reader :name'],
    'src/lib/a.js': ['return x;', 'break;', 'import foo;', 'x.y()', 'MAX = 5', 'const A = 1;', 'tags: [a, b],', '  ],', '});', '  foo: bar.baz,', '  size: 14,', '  ...rest,', '  snake_case,', '  x=1,', '  foo(a),', 'case 1:', 'const total = price + tax;', 'await foo();', 'new Foo();', 'throw new Error(1);'],
    'src/lib/a.ts': ['name: string', 'age?: number,', '@Component', 'export interface Tide {'],
    'src/lib/a.go': ['package main', 'func main() {'],
  };
  for (const [file, lines] of Object.entries(by)) {
    for (const line of lines) {
      const got = visibleFromChange({ paths: [file], diff: diff(file, { add: [line] }) });
      assert.deepEqual([got.visible, got.unsure], [false, false], `${file} ${line}: ${JSON.stringify(got)}`);
    }
  }
});

// The twin: lines of text that could be the middle of a template literal or a triple-quoted string, with a word, a comma, a keyword or
// a colon that code also uses. None of them is plainly code, so none reads internal.
test('prose that borrows the look of code is unsure', () => {
  const text = [
    'Thanks,', 'Regards,', 'Hi,', 'Yes,', 'No,', 'Cancel,', 'Monday,', 'Pro,', 'red,',
    'in the cart', 'for this harbour', 'from your account', 'import your data', 'new message', 'use code SAVE10', 'print receipt',
    'do not disturb', 'case closed', 'return policy', 'while you wait',
    'for example:', 'for more details:',
    'Name: Brett', 'Status: shipped', 'title: Welcome', 'label: Save', 'default: Premium', 'case: open',
    'Terms && conditions', '? Need help', ': see below', 'C++',
    'done', 'end', 'pass', 'default', 'return', 'new', 'raise', 'else',
    // Brackets that hold words, not code.
    'Note: (see below)', 'Hours: (closed Sunday)', 'Sizes: (S, M, L)', 'Tags: [new, sale]', 'Plan: [Pro plan]',
    // A capitalised ordinary word first, then a space, a colon or an equals sign.
    'Website: shop.com', 'Download: guide.pdf', 'Discount: None', 'Status: true', 'Answer: null', 'Size = large', 'Coupon = SAVE10',
    'Total = 5', 'Free shipping;', 'Pick one;',
    // Words and semicolons.
    'including taxes;', 'and more;', 'apples; pears',
    // Abbreviations and versions are not dotted names.
    'e.g.,', 'etc.,', 'v1.2,',
    // Amounts and counts with no letters.
    '100%', '50%', '$5', '£5', '€5', '#1', '42',
  ];
  for (const file of ['src/lib/a.js', 'src/lib/a.py']) {
    for (const line of text) {
      if (file.endsWith('.py') && line === '#1') continue; // a hash line is a comment in Python
      const got = visibleFromChange({ paths: [file], diff: diff(file, { add: [line] }) });
      assert.ok(got.visible || got.unsure, `${file} ${line}: ${JSON.stringify(got)}`);
    }
  }
});

test('hash lines are comments only where the language says so', () => {
  const py = visibleFromChange({ paths: ['src/a.py'], diff: diff('src/a.py', { add: ['# "A new note here"'] }) });
  assert.equal(py.visible, false);
  assert.equal(py.unsure, false);
  const c = visibleFromChange({ paths: ['src/a.c'], diff: diff('src/a.c', { add: ['#define MSG "A new note here"'] }) });
  assert.equal(c.visible, true);
});

test('package.json is unsure unless only development dependencies change; top-level notes are not internal by default', () => {
  const pkg = (lines) => visibleFromChange({ paths: ['package.json'], diff: diff('package.json', { add: lines }) });
  assert.equal(pkg(['  "name": "tide"']).unsure, true);
  assert.equal(pkg(['  "scripts": { "start": "node x.js" }']).unsure, true);
  const manifest = (devDeps, name = 'tide') => JSON.stringify({ name, dependencies: { a: '1' }, devDependencies: devDeps });
  const files = { 'package.json': { base: manifest({ eslint: '^8.0.0' }), head: manifest({ eslint: '^9.0.0' }) } };
  const dev = visibleFromChange({ paths: ['package.json'], diff: diff('package.json', { remove: ['    "eslint": "^8.0.0"'], add: ['    "eslint": "^9.0.0"'] }), files });
  assert.equal(dev.unsure, false);
  assert.equal(dev.visible, false);
  const both = { 'package.json': { base: manifest({ eslint: '^8.0.0' }), head: manifest({ eslint: '^9.0.0' }, 'tide2') } };
  assert.equal(visibleFromChange({ paths: ['package.json'], diff: diff('package.json', { add: ['x'] }), files: both }).unsure, true);
  assert.equal(visibleFromChange({ paths: ['README.md'], diff: diff('README.md', { add: ['x'] }) }).unsure, true);
  assert.equal(visibleFromChange({ paths: ['docs/a.md'], diff: diff('docs/a.md', { add: ['x'] }) }).unsure, false);
  const config = readConfig(JSON.stringify({ ...CONFIG, visibility: { paths: ['README.md'] } }));
  assert.equal(visibleFromChange({ paths: ['README.md'], diff: diff('README.md', { add: ['x'] }), config }).visible, true);
});
