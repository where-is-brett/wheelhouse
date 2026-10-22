// tests/probes/73-keychain/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { denyReadsProfile, main, parseOptions, parseSearchList, resultLine, sameList } from '../../../probes/73-keychain/run.js';

test('the probe refuses to run without --consent, and knows no other option', async () => {
  assert.deepEqual(parseOptions(['--consent']), { consent: true });
  assert.deepEqual(parseOptions([]), { consent: false });
  assert.throws(() => parseOptions(['--now']), /Unknown option/);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await main([]), 2);
  } finally {
    console.error = original;
  }
});

test('the search list is read from the quoted lines and compared in order', () => {
  const out = '    "/Users/x/Library/Keychains/login.keychain-db"\n    "/Library/Keychains/System.keychain"\n';
  const list = parseSearchList(out);
  assert.deepEqual(list, ['/Users/x/Library/Keychains/login.keychain-db', '/Library/Keychains/System.keychain']);
  assert.ok(sameList(list, [...list]));
  assert.ok(!sameList(list, [...list].reverse()));
  assert.ok(!sameList(list, list.slice(1)));
});

test('the profile denies reads under one folder and quotes it', () => {
  assert.equal(denyReadsProfile('/tmp/a b'), '(version 1)(allow default)(deny file-read* (subpath "/tmp/a b"))');
  assert.match(denyReadsProfile('/tmp/a"b'), /"\/tmp\/a\\"b"/);
});

test('a result line holds only a count or the word refused, never the value', () => {
  assert.equal(resultLine('plain', { code: 0, value: 'abcdef\n' }), 'plain: read 6 characters');
  assert.equal(resultLine('plain', { code: 44, value: '' }), 'plain: refused');
  assert.equal(resultLine('x', { code: 71, value: 'secret' }), 'x: refused');
  assert.ok(!resultLine('plain', { code: 0, value: 'abcdef' }).includes('abcdef'));
});
