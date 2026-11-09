// tests/scripts/lib/start-time.test.js
// Reading process start times in every shape the system gives them: `ps`'s lstart month first (the C locale, en_US)
// or day first (en_AU and other day-first locales), and Windows' ISO time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LSTART, PS_ENV, sameStart, startSeconds } from '../../../scripts/lib/start-time.js';

test('startSeconds reads lstart month first and day first as the same moment', () => {
  const monthFirst = startSeconds('Mon Nov  9 08:06:12 2026');
  assert.equal(monthFirst, Math.floor(new Date(2026, 10, 9, 8, 6, 12).getTime() / 1000));
  assert.equal(startSeconds('Mon 9 Nov 08:06:12 2026'), monthFirst, 'day first, one space, as macOS prints it under en_AU');
  assert.equal(startSeconds('Mon  9 Nov 08:06:12 2026'), monthFirst, 'day first, padded');
  assert.equal(startSeconds('Mon Nov 9 08:06:12 2026'), monthFirst, 'month first, one space');
  assert.equal(startSeconds('  Mon 9 Nov 08:06:12 2026\n'), monthFirst, 'surrounding space');
  assert.equal(startSeconds('Thu 19 Nov 23:59:59 2026'), startSeconds('Thu Nov 19 23:59:59 2026'));
});

test('startSeconds still reads ISO times and refuses anything else', () => {
  assert.equal(startSeconds('2026-11-04T10:00:01.1234567Z'), Date.UTC(2026, 10, 4, 10, 0, 1) / 1000);
  for (const bad of [
    null, undefined, 5, '', 'yesterday', 'Tue Nov 31 10:00:01 2026', 'Tue 31 Nov 10:00:01 2026', 'Tue 4 Nov 4 10:00:01 2026',
    'Tue 4 Xyz 10:00:01 2026', '4 Nov 10:00:01 2026', 'Tue 4 Nov 10:00:01', 'Tue 4 Nov 10:00:01 2026; rm -rf /', 'x'.repeat(100),
  ]) {
    assert.equal(startSeconds(bad), null, String(bad));
  }
});

test('LSTART matches both orders inside a ps row, and nothing else', () => {
  const row = new RegExp(`^(\\S+)\\s+(${LSTART})\\s+(\\S.*)$`);
  assert.equal(row.exec('dir Mon 9 Nov 08:06:12 2026 /usr/local/bin/node x.js')?.[2], 'Mon 9 Nov 08:06:12 2026');
  assert.equal(row.exec('dir Mon Nov  9 08:06:12 2026 /usr/local/bin/node x.js')?.[2], 'Mon Nov  9 08:06:12 2026');
  assert.equal(row.exec('dir 9 Nov 08:06:12 2026 /usr/local/bin/node x.js'), null);
});

test('sameStart matches one moment recorded in one shape and read again in another', () => {
  assert.equal(sameStart('Mon 9 Nov 08:06:12 2026', 'Mon Nov  9 08:06:12 2026'), true);
  assert.equal(sameStart('Mon Nov  9 08:06:12 2026', 'Mon Nov  9 08:06:12 2026'), true);
  assert.equal(sameStart('Mon 9 Nov 08:06:12 2026', 'Mon Nov  9 08:06:13 2026'), false);
  assert.equal(sameStart('later', 'later'), true, 'the same text, even unread, is the same');
  assert.equal(sameStart('later', 'sooner'), false);
  assert.equal(sameStart(null, null), false);
  assert.equal(sameStart('Mon Nov  9 08:06:12 2026', null), false);
});

test('ps is run in the C locale', () => {
  assert.deepEqual({ ...PS_ENV }, { LC_ALL: 'C' });
});

test('LSTART captures nothing, so the groups around it keep their numbers', () => {
  assert.equal(new RegExp(`^(${LSTART})$`).exec('Mon 9 Nov 08:06:12 2026').length, 2);
});
