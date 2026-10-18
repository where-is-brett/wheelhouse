// tests/scripts/state/secret-scan.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanText, scanFiles, scanContent } from '../../../scripts/state/secret-scan.js';

// Every sample is assembled at runtime from fragments, so this file holds no real-looking secret.
const rep = (ch, n) => ch.repeat(n);
const b62 = (n) => rep('aB3', Math.ceil(n / 3)).slice(0, n);

const cases = [
  { pattern: 'github-token', hit: ['gh', 'p_', b62(36)].join(''), miss: ['gh', 'p_', b62(35)].join('') },
  { pattern: 'github-token', hit: ['github', '_pat_', b62(22)].join(''), miss: ['github', '_pat_', b62(21)].join('') },
  { pattern: 'gitlab-token', hit: ['gl', 'pat-', b62(20)].join(''), miss: ['gl', 'pat-', b62(19)].join('') },
  { pattern: 'anthropic-key', hit: ['sk', '-ant-', b62(24)].join(''), miss: ['sk', '-ant-', b62(5)].join('') },
  { pattern: 'openai-key', hit: ['sk', '-', b62(40)].join(''), miss: ['sk', '-', b62(20)].join('') },
  { pattern: 'aws-access-key', hit: ['AK', 'IA', rep('Q7', 8)].join(''), miss: ['AK', 'IA', rep('Q7', 7)].join('') },
  { pattern: 'slack-token', hit: ['xo', 'xb-', rep('1', 12)].join(''), miss: ['xo', 'xz-', rep('1', 12)].join('') },
  { pattern: 'stripe-live-key', hit: ['sk', '_live_', b62(24)].join(''), miss: ['sk', '_test_', b62(24)].join('') },
  { pattern: 'private-key-block', hit: ['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join(''), miss: ['-----BEGIN ', 'PUBLIC', ' KEY-----'].join('') },
  { pattern: 'database-url', hit: ['postgres', '://app:', 'hunter2', '@db.example.com/x'].join(''), miss: ['postgres', '://app@db.example.com:5432/x'].join('') },
  { pattern: 'jwt', hit: ['ey', 'J', rep('a', 12), '.', rep('b', 12), '.', rep('c', 12)].join(''), miss: ['ey', 'J', rep('a', 12), '.', rep('b', 12)].join('') },
];

for (const c of cases) {
  test(`${c.pattern}: found, and a near-miss is not`, () => {
    const found = scanText(`x = ${c.hit}\n`);
    assert.ok(found.some((f) => f.pattern === c.pattern && f.line === 1), JSON.stringify(found));
    assert.deepEqual(scanText(`x = ${c.miss}\n`).filter((f) => f.pattern === c.pattern), []);
  });
}

test('an Anthropic key is not also reported as OpenAI-style', () => {
  const found = scanText(['sk', '-ant-', b62(40)].join(''));
  assert.deepEqual(found.map((f) => f.pattern), ['anthropic-key']);
});

test('scanText names the pattern and line, never the text', () => {
  const secret = ['gh', 'p_', b62(40)].join('');
  const found = scanText(`line one\nline two\ntoken: ${secret}\n`);
  assert.deepEqual(found, [{ pattern: 'github-token', line: 3 }]);
  assert.ok(!JSON.stringify(found).includes(secret));
});

test('results are ordered by line then pattern, one per pattern per line', () => {
  const a = ['sk', '_live_', b62(24)].join('');
  const b = ['AK', 'IA', rep('Q7', 8)].join('');
  const found = scanText(`${a} ${a} ${b}\nclean\n${b}`);
  assert.deepEqual(found, [
    { pattern: 'aws-access-key', line: 1 },
    { pattern: 'stripe-live-key', line: 1 },
    { pattern: 'aws-access-key', line: 3 },
  ]);
});

test('a postgres URL with a password is found; one without is not', () => {
  const withPw = ['postgres', '://u:', 'pw', '@h/db'].join('');
  const without = ['postgres', '://u@h:5432/db'].join('');
  assert.equal(scanText(withPw).length, 1);
  assert.equal(scanText(without).length, 0);
});

test('scanFiles reports file, pattern and line; unreadable files fail closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-scan-'));
  const secret = ['gh', 'p_', b62(40)].join('');
  const dirty = path.join(dir, 'dirty.txt');
  const clean = path.join(dir, 'clean.txt');
  const gone = path.join(dir, 'gone.txt');
  fs.writeFileSync(dirty, `a\n${secret}\n`);
  fs.writeFileSync(clean, 'nothing here\n');
  const found = scanFiles([dirty, clean, gone]);
  assert.deepEqual(found, [
    { file: dirty, pattern: 'github-token', line: 2 },
    { file: gone, pattern: 'unreadable', line: 0 },
  ]);
  assert.ok(!JSON.stringify(found).includes(secret));
});

test('a key glued on after an underscore or punctuation is found', () => {
  for (const c of cases.filter((x) => !['private-key-block', 'database-url'].includes(x.pattern))) {
    for (const before of ['MY_', '_', '(', '"', '=']) {
      assert.ok(scanText(`${before}${c.hit}`).some((f) => f.pattern === c.pattern), `${before} ${c.pattern}`);
    }
  }
});

test('a key after a newline or tab in a JSON string is found in the decoded string', () => {
  for (const c of cases) {
    for (const sep of ['\n', '\t', '\r\n']) {
      const text = JSON.stringify({ v: 1, data: { text: `my token:${sep}${c.hit}` } }, null, 2);
      assert.ok(scanContent(text).includes(c.pattern), `${JSON.stringify(sep)} ${c.pattern}`);
    }
  }
  // Keys of objects and strings in arrays count too.
  const key = cases[0].hit;
  assert.deepEqual(scanContent(JSON.stringify({ [`x\n${key}`]: 1 })), ['github-token']);
  assert.deepEqual(scanContent(JSON.stringify({ list: ['a', `b\t${key}`] })), ['github-token']);
});

test('scanContent reads plain text too, and names patterns only', () => {
  const key = cases[0].hit;
  assert.deepEqual(scanContent(`not json\n${key}\n`), ['github-token']);
  assert.deepEqual(scanContent('{"text":"nothing here"}'), []);
  assert.ok(!JSON.stringify(scanContent(key)).includes(key));
});
