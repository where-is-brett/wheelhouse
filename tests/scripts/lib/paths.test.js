// tests/scripts/lib/paths.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  wheelhouseHome, computerId, stateDir, keysDir, profileDir, helperAddress, projectSlug,
} from '../../../scripts/lib/paths.js';

// Runs fn with WHEELHOUSE_HOME pointing at a fresh temporary folder.
function withHome(name, fn) {
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-paths-')), name);
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

test('wheelhouseHome follows WHEELHOUSE_HOME', () => {
  withHome('home', (home) => assert.equal(wheelhouseHome(), home));
});

test('wheelhouseHome defaults to .wheelhouse in the user home folder', () => {
  const before = process.env.WHEELHOUSE_HOME;
  delete process.env.WHEELHOUSE_HOME;
  try {
    assert.equal(wheelhouseHome(), path.join(os.homedir(), '.wheelhouse'));
  } finally {
    if (before !== undefined) process.env.WHEELHOUSE_HOME = before;
  }
});

test('computerId is made once, eight hex characters, and then kept', () => {
  withHome('home', (home) => {
    const first = computerId();
    assert.match(first, /^[0-9a-f]{8}$/);
    assert.equal(computerId(), first);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'computer.json'), 'utf8')), { id: first });
  });
});

test('computerId replaces a corrupt computer.json', () => {
  withHome('home', (home) => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'computer.json'), '{not json');
    const id = computerId();
    assert.match(id, /^[0-9a-f]{8}$/);
    assert.equal(computerId(), id);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'computer.json'), 'utf8')), { id });
  });
});

test('paths work under a home folder named "with space é"', () => {
  withHome('with space é', (home) => {
    assert.equal(keysDir(), path.join(home, 'keys'));
    assert.equal(profileDir(), path.join(home, 'profile'));
    assert.equal(stateDir('o__n'), path.join(home, 'projects', 'o__n', 'state'));
    assert.match(computerId(), /^[0-9a-f]{8}$/);
    assert.equal(helperAddress({ platform: 'darwin', user: 'jo' }), path.join(home, 'helper.sock'));
  });
});

test('helperAddress is a named pipe on Windows and a socket file elsewhere', () => {
  assert.equal(helperAddress({ platform: 'win32', user: 'Jo Smith' }), '\\\\.\\pipe\\wheelhouse-Jo_Smith-helper');
  assert.equal(helperAddress({ platform: 'win32', user: 'a.b-c_d' }), '\\\\.\\pipe\\wheelhouse-a.b-c_d-helper');
  withHome('home', (home) => {
    assert.equal(helperAddress({ platform: 'linux' }), path.join(home, 'helper.sock'));
  });
});

test('projectSlug joins owner and name, and refuses a name with a slash or ..', () => {
  assert.equal(projectSlug('my-org', 'of.interest_1'), 'my-org__of.interest_1');
  assert.throws(() => projectSlug('a/b', 'c'));
  assert.throws(() => projectSlug('a', 'b/c'));
  assert.throws(() => projectSlug('a', '..'));
  assert.throws(() => projectSlug('..', 'b'));
  assert.throws(() => projectSlug('a', 'b c'));
  assert.throws(() => projectSlug('', 'b'));
});

test('stateDir refuses a project that is not a safe slug', () => {
  withHome('home', () => {
    assert.throws(() => stateDir('../x'));
  });
});
