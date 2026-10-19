// tests/scripts/lib/clean.test.js
// Keeping secrets out of what the helper says: an address's sign-in and a connection's own
// secrets are hidden, in a string or anywhere inside a value, and cleaning twice changes nothing,
// so a card cleaned before it is stored is the card the helper sends (ruling R33).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREDENTIAL_URL, hide, cleanDeep } from '../../../scripts/lib/clean.js';

test('an address\'s sign-in is hidden, and a connection\'s secrets wherever they are', () => {
  assert.equal(hide('clone ssh://git@github.com/o/r.git now', []), 'clone ssh://[hidden]@github.com/o/r.git now');
  assert.equal(hide('https://jo:s3cret@bitbucket.org/o/r.git', []), 'https://[hidden]@bitbucket.org/o/r.git');
  assert.equal(hide('the key abcdefgh12345678 was refused', ['abcdefgh12345678']), 'the key [hidden] was refused');
  assert.equal(hide('git@github.com:o/r.git and https://github.com/o/r', []), 'git@github.com:o/r.git and https://github.com/o/r');
  assert.equal(hide(42, []), '42');
  assert.ok(CREDENTIAL_URL.global, 'every address in a text is cleaned');
  const value = { a: ['ssh://git@x/y', { b: 'https://u@z/w' }], n: 3, nothing: null, yes: true };
  assert.deepEqual(cleanDeep(value, []), { a: ['ssh://[hidden]@x/y', { b: 'https://[hidden]@z/w' }], n: 3, nothing: null, yes: true });
});

test('cleaning twice gives the same text as cleaning once', () => {
  const texts = [
    'ssh://git@github.com/o/r.git',
    'https://jo:pa55word@bitbucket.org/o/r.git, then https://other@gitlab.com/g/p',
    'What this is: Setup step 3 found ssh://git@github.com/o/r.git.\nSet up step 3 as listed, abababababab',
  ];
  for (const text of texts) {
    const once = hide(text, ['pa55word']);
    assert.equal(hide(once, ['pa55word']), once, text);
    assert.deepEqual(cleanDeep(cleanDeep({ text }, []), []), cleanDeep({ text }, []), text);
  }
});
