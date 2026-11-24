// tests/scripts/lib/paths.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  wheelhouseHome, computerId, stateDir, keysDir, profileDir, helperAddress, projectSlug,
  usageDir, sourcesDir, jobsDir, profileViewsDir, archonHome,
} from '../../../scripts/lib/paths.js';
import { tempFolder } from '../../helpers/homes.js';

// Runs fn with WHEELHOUSE_HOME pointing at a fresh temporary folder.
function withHome(name, fn) {
  const home = path.join(tempFolder('wh-paths-'), name);
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
    assert.equal(profileDir(), path.join(home, 'settings'));
    assert.equal(stateDir('o__n'), path.join(home, 'projects', 'o__n', 'record'));
    assert.match(computerId(), /^[0-9a-f]{8}$/);
    assert.equal(helperAddress({ platform: 'darwin', user: 'jo' }), path.join(home, 'helper.sock'));
  });
});

test('helperAddress is a named pipe on Windows and a socket file elsewhere', () => {
  const own = path.join(os.homedir(), '.wheelhouse');
  assert.equal(helperAddress({ platform: 'win32', user: 'Jo Smith', home: own }), '\\\\.\\pipe\\wheelhouse-Jo_Smith-helper');
  assert.equal(helperAddress({ platform: 'win32', user: 'a.b-c_d', home: own }), '\\\\.\\pipe\\wheelhouse-a.b-c_d-helper');
  withHome('home', (home) => {
    assert.equal(helperAddress({ platform: 'linux' }), path.join(home, 'helper.sock'));
  });
});

test('on Windows another home\'s pipe carries a hash of that home, so it is never the director\'s own', () => {
  const pipe = (home) => helperAddress({ platform: 'win32', user: 'jo', home });
  assert.match(pipe('C:\\runs\\one'), /^\\\\\.\\pipe\\wheelhouse-jo-[0-9a-f]{12}-helper$/);
  assert.notEqual(pipe('C:\\runs\\one'), pipe('C:\\runs\\two'));
  assert.equal(pipe('C:\\Runs\\One'), pipe('c:/runs/one'), 'one folder however it is spelt');
  withHome('home', () => assert.equal(helperAddress({ platform: 'win32', user: 'jo' }), pipe(process.env.WHEELHOUSE_HOME)));
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

test('the new folders sit under WHEELHOUSE_HOME', () => {
  withHome('home', (home) => {
    const folders = [usageDir(), sourcesDir(), jobsDir(), profileViewsDir()];
    for (const folder of folders) {
      assert.equal(path.dirname(folder), home);
    }
    assert.equal(new Set(folders).size, 4);
    assert.ok(!folders.includes(profileDir()));
  });
});

// Runs fn with WHEELHOUSE_HOME unset and the session markers given, restoring them after.
function withSession(env, fn) {
  const keys = ['WHEELHOUSE_HOME', 'CLAUDE_PROJECT_DIR', 'CLAUDECODE'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

function projectWith(settings) {
  const dir = tempFolder('wh-paths-project-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  for (const [name, body] of Object.entries(settings)) fs.writeFileSync(path.join(dir, '.claude', name), typeof body === 'string' ? body : JSON.stringify(body));
  return dir;
}

test('wheelhouseHome falls back to the project\'s local settings env where the process was not given the variable', () => {
  const home = path.join(tempFolder('wh-paths-'), 'second');
  const dir = projectWith({ 'settings.local.json': { env: { WHEELHOUSE_HOME: home } } });
  withSession({ CLAUDE_PROJECT_DIR: dir }, () => {
    assert.equal(wheelhouseHome(), home);
    assert.equal(archonHome(), `${home}-engine`);
  });
});

test('the process environment wins over the project settings', () => {
  const dir = projectWith({ 'settings.local.json': { env: { WHEELHOUSE_HOME: path.join(tempFolder('wh-paths-'), 'from-settings') } } });
  const given = path.join(tempFolder('wh-paths-'), 'from-env');
  withSession({ CLAUDE_PROJECT_DIR: dir, WHEELHOUSE_HOME: given }, () => assert.equal(wheelhouseHome(), given));
});

test('the settings fallback reads only the local file, only a full path, and only the session\'s own project', () => {
  const home = path.join(tempFolder('wh-paths-'), 'x');
  const committed = projectWith({ 'settings.json': { env: { WHEELHOUSE_HOME: home } } });
  const relative = projectWith({ 'settings.local.json': { env: { WHEELHOUSE_HOME: 'relative/home' } } });
  const broken = projectWith({ 'settings.local.json': '{ not json' });
  const local = projectWith({ 'settings.local.json': { env: { WHEELHOUSE_HOME: home } } });
  const inner = path.join(local, 'sub');
  fs.mkdirSync(inner);
  const fallback = path.join(os.homedir(), '.wheelhouse');
  for (const dir of [committed, relative, broken, inner]) withSession({ CLAUDE_PROJECT_DIR: dir }, () => assert.equal(wheelhouseHome(), fallback));
  // No session marker: a process Claude Code didn't start reads no project settings, whatever its working folder.
  const was = process.cwd();
  process.chdir(local);
  try {
    withSession({}, () => assert.equal(wheelhouseHome(), fallback));
    withSession({ CLAUDECODE: '1' }, () => assert.equal(wheelhouseHome(), home));
  } finally {
    process.chdir(was);
  }
});

test('a changed settings file is read again', () => {
  const first = path.join(tempFolder('wh-paths-'), 'first');
  const second = path.join(tempFolder('wh-paths-'), 'second-home');
  const dir = projectWith({ 'settings.local.json': { env: { WHEELHOUSE_HOME: first } } });
  withSession({ CLAUDE_PROJECT_DIR: dir }, () => {
    assert.equal(wheelhouseHome(), first);
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ env: { WHEELHOUSE_HOME: second, PAD: 'x' } }));
    assert.equal(wheelhouseHome(), second);
  });
});
