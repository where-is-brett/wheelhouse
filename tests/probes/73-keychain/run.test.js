// tests/probes/73-keychain/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { denyReadsProfile, interactiveLine, main, parseOptions, parseSearchList, resultLine, searchListProblem, sameList } from '../../../probes/73-keychain/run.js';

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
  assert.equal(resultLine('plain', { code: 44, value: '' }), 'plain: refused (exit 44)');
  assert.equal(resultLine('x', { code: 71, value: 'secret' }), 'x: refused (exit 71)');
  assert.ok(!resultLine('plain', { code: 0, value: 'abcdef' }).includes('abcdef'));
});

const LOGIN = '/Users/x/Library/Keychains/login.keychain-db';
const LIST_OUT = `    "${LOGIN}"\n`;

test('an empty, odd or login-less search list is not safe to change, and an empty one never compares as the same', () => {
  assert.match(searchListProblem([]), /empty/);
  assert.match(searchListProblem(null), /empty/);
  assert.match(searchListProblem(['/Library/Keychains/System.keychain']), /login keychain/);
  assert.equal(searchListProblem([LOGIN]), null);
  assert.ok(!sameList([], []));
});

test('commands for security -i are quoted, one per line', () => {
  assert.equal(interactiveLine(['create-keychain', '-p', 'a b"c', '/t/x']), '"create-keychain" "-p" "a b\\"c" "/t/x"\n');
});

// A stand-in for every program: security -i commands are read from input and recorded.
function standIn({ list = LIST_OUT, onCommand } = {}) {
  const commands = [];
  const exec = async (file, args, { input } = {}) => {
    if (file === '/usr/bin/security' && args[0] === '-i') {
      const words = [...input.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      commands.push(words);
      if (onCommand) await onCommand(words);
      if (words[0] === 'list-keychains' && words.length === 3) return { code: 0, stdout: list, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: 'abcdef\n', stderr: '' };
  };
  return { exec, commands };
}
const quiet = async (fn) => {
  const out = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.log = out; console.error = err; }
};

test('the probe refuses before any change when the search list reads back empty, and never sets the list', async () => {
  const { exec, commands } = standIn({ list: '' });
  const code = await quiet(() => main(['--consent'], { exec, platform: 'darwin', proc: new EventEmitter(), exit() {} }));
  assert.equal(code, 1);
  assert.deepEqual(commands.map((c) => c[0]), ['list-keychains']);
});

test('a normal run makes the keychain, restores the same list and deletes the keychain', async () => {
  const { exec, commands } = standIn();
  const proc = new EventEmitter();
  const code = await quiet(() => main(['--consent'], { exec, platform: 'darwin', proc, exit() {} }));
  assert.equal(code, 0);
  const names = commands.map((c) => c[0]);
  assert.ok(names.indexOf('create-keychain') < names.indexOf('delete-keychain'));
  const set = commands.find((c) => c[0] === 'list-keychains' && c[3] === '-s');
  assert.deepEqual(set.slice(4), [LOGIN]);
  assert.equal(proc.listenerCount('SIGINT'), 0);
});

test('a signal partway through puts the list back, deletes the keychain and exits 130', async () => {
  const proc = new EventEmitter();
  const exits = [];
  const { exec, commands } = standIn({ onCommand: async (words) => { if (words[0] === 'add-generic-password') proc.emit('SIGINT'); } });
  const exited = new Promise((resolve) => { exits.push(resolve); });
  const done = quiet(() => main(['--consent'], { exec, platform: 'darwin', proc, exit: (c) => exits[0](c) }));
  assert.equal(await exited, 130);
  await done;
  const names = commands.map((c) => c[0]);
  assert.ok(names.includes('delete-keychain'));
  assert.ok(commands.some((c) => c[0] === 'list-keychains' && c[3] === '-s' && c[4] === LOGIN));
});
