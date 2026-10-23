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
  assert.deepEqual(parseSearchList('security> "/a/login.keychain-db"\n'), ['/a/login.keychain-db']);
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

// A stand-in for every program. `security -i` input is parsed into words; direct calls are recorded as they are.
function standIn({ list = LIST_OUT, onCommand } = {}) {
  const commands = [];
  const exec = async (file, args, { input } = {}) => {
    if (file === '/usr/bin/security') {
      const words = args[0] === '-i' ? [...input.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]) : args;
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
const run = (deps) => quiet(() => main(['--consent'], { platform: 'darwin', fileSize: () => 1, ...deps }));

test('the probe refuses before any change when the search list reads back empty, and never sets the list', async () => {
  const { exec, commands } = standIn({ list: '' });
  assert.equal(await run({ exec, proc: new EventEmitter() }), 1);
  assert.deepEqual(commands.map((c) => c[0]), ['list-keychains']);
});

test('a login keychain name is matched at a path separator only', () => {
  assert.match(searchListProblem(['/x/mylogin.keychain-db']), /login keychain/);
  assert.equal(searchListProblem(['/x/login.keychain']), null);
});

test('a normal run makes the keychain, finds the item, restores the same list and deletes the keychain', async () => {
  const { exec, commands } = standIn();
  const proc = new EventEmitter();
  assert.equal(await run({ exec, proc }), 0);
  const names = commands.map((c) => c[0]);
  assert.ok(names.indexOf('create-keychain') < names.indexOf('find-generic-password'));
  assert.ok(names.indexOf('find-generic-password') < names.indexOf('delete-keychain'));
  assert.ok(commands.some((c) => c[0] === 'list-keychains' && c[3] === '-s' && c[4] === LOGIN));
  assert.equal(proc.listenerCount('SIGINT'), 0);
});

test('a keychain file that was not made stops the run before the item is added, and tidies up', async () => {
  const { exec, commands } = standIn();
  assert.equal(await run({ exec, proc: new EventEmitter(), fileSize: () => 0 }), 1);
  const names = commands.map((c) => c[0]);
  assert.ok(!names.includes('add-generic-password'));
  assert.ok(names.includes('delete-keychain'));
});

test('an item that is not found after add stops the run before any read', async () => {
  const { exec, commands } = standIn({ onCommand: () => {} });
  const failing = async (file, args, options) => (args[0] === 'find-generic-password' ? { code: 44, stdout: '', stderr: '' } : exec(file, args, options));
  assert.equal(await run({ exec: failing, proc: new EventEmitter() }), 1);
  assert.ok(commands.every((c) => !c.includes('-w') || c[0] === 'add-generic-password'), 'no read of the value');
  assert.ok(commands.some((c) => c[0] === 'delete-keychain'));
});

test('two signals partway through: no step begins after the first, the tidy-up runs once, and the run ends 130', async () => {
  const proc = new EventEmitter();
  const { exec, commands } = standIn({ onCommand: async (words) => {
    if (words[0] === 'add-generic-password') { proc.emit('SIGINT'); proc.emit('SIGTERM'); }
    if (words[0] === 'delete-keychain') proc.emit('SIGINT'); // a signal during the tidy-up
  } });
  assert.equal(await run({ exec, proc }), 130);
  const names = commands.map((c) => c[0]);
  assert.ok(!names.includes('find-generic-password'), 'no step after the signal');
  assert.equal(names.filter((n) => n === 'delete-keychain').length, 1);
  const restores = commands.filter((c) => c[0] === 'list-keychains' && c[3] === '-s');
  assert.equal(restores.length, 1);
  assert.deepEqual(restores[0].slice(4), [LOGIN]);
});

test('a SIGTERM while a step is pending waits for that step, then tidies', async () => {
  const proc = new EventEmitter();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { exec, commands } = standIn({ onCommand: async (words) => {
    if (words[0] === 'create-keychain') { proc.emit('SIGTERM'); await gate; }
  } });
  const done = run({ exec, proc });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!commands.some((c) => c[0] === 'delete-keychain'), 'not tidied while the step runs');
  release();
  assert.equal(await done, 130);
  const names = commands.map((c) => c[0]);
  assert.ok(names.indexOf('create-keychain') < names.indexOf('delete-keychain'));
});
