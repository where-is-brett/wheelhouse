// tests/scripts/lib/launch-words.test.js
// The launch command: split by a rule of its own, refusing everything a shell would act on, and checked again on every read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WORDS, checkLaunch, resolveWord, sayLaunch, splitLaunch, wordsFault } from '../../../scripts/lib/launch-words.js';

const found = () => ({ ok: true });
const onPath = (...names) => (word) => (names.includes(word) ? `/bin/${word}` : null);

test('each refused character is refused at typing, and named (review focus 1)', () => {
  for (const ch of ["'", '`', '$', ';', '|', '&', '<', '>', '(', ')', '%', '!', '^', '\n', '\r', '\0']) {
    const split = splitLaunch(`wrap${ch}claude`);
    assert.equal(split.ok, false, JSON.stringify(ch));
    assert.match(split.refused, /can't run a command with/);
  }
  assert.equal(splitLaunch('wrap $(rm -rf x)').ok, false);
  assert.equal(splitLaunch('wrap %PATH%').ok, false);
  assert.equal(splitLaunch('wrap\tclaude').ok, false, 'a tab is no space');
});

test('a quoted refused character is still refused', () => {
  assert.equal(splitLaunch('wrap "a & b"').ok, false);
  assert.equal(splitLaunch('wrap "a;b"').ok, false);
  assert.equal(splitLaunch('"wrap;x" claude').ok, false);
});

test('spaces separate words and double quotes group one word', () => {
  assert.deepEqual(splitLaunch('wrap claude'), { ok: true, words: ['wrap', 'claude'] });
  assert.deepEqual(splitLaunch('  wrap   claude  '), { ok: true, words: ['wrap', 'claude'] });
  assert.deepEqual(splitLaunch('"C:\\Program Files\\wrap.exe" claude'), { ok: true, words: ['C:\\Program Files\\wrap.exe', 'claude'] });
  assert.equal(splitLaunch('').ok, false);
  assert.equal(splitLaunch('   ').ok, false);
  assert.equal(splitLaunch('wrap "claude').ok, false);
  assert.equal(splitLaunch('wrap ""').ok, false);
  assert.equal(splitLaunch(42).ok, false);
});

test('a stored value that fails a check is named and not used (review focus 1)', () => {
  const bad = checkLaunch(['wrap;rm', 'claude'], { which: onPath('wrap;rm') });
  assert.equal(bad.ok, false);
  assert.match(bad.why, /character Wheelhouse never passes on/);
  for (const value of [['wrap', '$(x)'], ['wrap', 'a"b'], ['wrap', 'a\nb'], ['wrap', "it's"], ['wrap', '%PATH%'], ['wrap', '']]) {
    assert.equal(checkLaunch(value, { which: onPath('wrap') }).ok, false, JSON.stringify(value));
  }
  assert.equal(checkLaunch('wrap claude', { which: onPath('wrap') }).ok, false, 'a string is no list of words');
  assert.equal(checkLaunch([], { which: found }).ok, false);
});

test('nine words, a 200-character word, a later -p or --settings word, and a .ps1 first word are refused', () => {
  const which = onPath('wrap');
  assert.equal(checkLaunch(Array.from({ length: MAX_WORDS }, (_, i) => (i === 0 ? 'wrap' : 'a')), { which }).ok, true);
  assert.equal(checkLaunch(['wrap', ...Array.from({ length: MAX_WORDS }, () => 'a')], { which }).ok, false);
  assert.equal(checkLaunch(['wrap', 'a'.repeat(199)], { which }).ok, true);
  assert.equal(checkLaunch(['wrap', 'a'.repeat(200)], { which }).ok, false);
  for (const flag of ['-p', '--print', '--resume', '--resume=x', '--session-id', '--settings', '--permission-mode', '-pfoo']) {
    assert.equal(checkLaunch(['wrap', 'claude', flag], { which }).ok, false, flag);
  }
  assert.equal(checkLaunch(['wrap', 'claude', '--model', 'x'], { which }).ok, true);
  const ps1 = checkLaunch(['C:\\tools\\wrap.ps1', 'claude'], { platform: 'win32', which: found });
  assert.equal(ps1.ok, false);
  assert.match(ps1.why, /`\.cmd` or `\.exe`/);
  assert.equal(checkLaunch(['wrap.PS1'], { which: found }).ok, false);
});

test('the first word is a program name or a full path, and must be there', () => {
  assert.equal(checkLaunch(['./wrap', 'claude'], { which: found }).ok, false);
  assert.equal(checkLaunch(['-wrap'], { which: found }).ok, false);
  assert.equal(checkLaunch(['/opt/wrap/wrap', 'claude'], { platform: 'darwin', which: found }).ok, true);
  assert.equal(checkLaunch(['C:\\Program Files\\wrap.exe'], { platform: 'win32', which: found }).ok, true);
  const missing = checkLaunch(['wrap', 'claude'], { which: onPath() });
  assert.equal(missing.ok, false);
  assert.match(missing.why, /isn't on this computer's PATH/);
  assert.equal(wordsFault(['wrap', 'claude']), null);
});

test('a bare name is found in the PATH\'s full folders, and a full path must be a file', () => {
  const exists = (...files) => (file) => files.includes(file);
  assert.deepEqual(resolveWord('wrap', { platform: 'darwin', env: { PATH: 'bin:/opt/bin:/usr/bin' }, exists: exists('/usr/bin/wrap', 'bin/wrap') }), { kind: 'direct', file: '/usr/bin/wrap' });
  assert.equal(resolveWord('wrap', { platform: 'darwin', env: { PATH: '/usr/bin' }, exists: exists() }), null);
  assert.deepEqual(resolveWord('/opt/wrap', { platform: 'linux', env: { PATH: '' }, exists: exists('/opt/wrap') }), { kind: 'direct', file: '/opt/wrap' });
  const env = { Path: 'C:\\tools;C:\\bin' };
  assert.deepEqual(resolveWord('wrap', { platform: 'win32', env, exists: exists('C:\\bin\\wrap.cmd') }), { kind: 'cmd', file: 'C:\\bin\\wrap.cmd' });
  assert.deepEqual(resolveWord('wrap', { platform: 'win32', env, exists: exists('C:\\bin\\wrap.cmd', 'C:\\tools\\wrap.exe') }), { kind: 'direct', file: 'C:\\tools\\wrap.exe' });
  assert.deepEqual(resolveWord('wrap.cmd', { platform: 'win32', env, exists: exists('C:\\bin\\wrap.cmd') }), { kind: 'cmd', file: 'C:\\bin\\wrap.cmd' });
  assert.deepEqual(resolveWord('C:\\Program Files\\wrap.exe', { platform: 'win32', env, exists: exists('C:\\Program Files\\wrap.exe') }), { kind: 'direct', file: 'C:\\Program Files\\wrap.exe' });
});

test('the words are said back as the card says them', () => {
  assert.equal(sayLaunch(['wrap', 'claude']), 'Wheelhouse will run: `wrap` then `claude`');
});
