// tests/scripts/lib/standard-env.test.js
// The standard environment of the helper and the watchers (design 12A.1): built from scratch, one home each.
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempFolder } from '../../helpers/homes.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  standardEnv, homeOf, homeLabel, isDefaultHome, sameFolder, recordLastSession, touchLastSession, lastSessionAt, throwawayIdle, TOUCH_GAP_MS,
} from '../../../scripts/lib/standard-env.js';

const starting = {
  HOME: '/Users/someone', PATH: '/usr/bin:/bin', LANG: 'en_AU.UTF-8', ANTHROPIC_BASE_URL: 'https://x.invalid', CLAUDE_CODE_ENTRYPOINT: 'cli', FOO: 'bar', ANTHROPIC_API_KEY: 'k',
};

test('nothing of the starting session\'s environment comes with it', () => {
  const env = standardEnv({ home: '/h/wh', platform: 'darwin', env: starting, claudePath: null, exists: () => true });
  for (const name of ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_ENTRYPOINT', 'FOO', 'ANTHROPIC_API_KEY']) assert.equal(name in env, false, name);
  assert.equal(env.WHEELHOUSE_HOME, '/h/wh');
  assert.equal(env.HOME, '/Users/someone');
  assert.equal(env.LANG, 'en_AU.UTF-8');
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'PATH', 'WHEELHOUSE_HOME']);
});

test('PATH gets the folder of the recorded claude, and of node when none is on it', () => {
  const env = standardEnv({ home: '/h/wh', platform: 'darwin', env: starting, claudePath: '/opt/c/bin/claude', exists: () => false, execPath: '/opt/node/bin/node' });
  assert.deepEqual(env.PATH.split(':').slice(0, 2), ['/opt/node/bin', '/opt/c/bin']);
  assert.ok(env.PATH.endsWith('/usr/bin:/bin'));
});

test('the claude path is read from the home\'s record when not given', () => {
  const env = standardEnv({ home: '/no/such/home', platform: 'darwin', env: starting, exists: () => true });
  assert.equal(env.PATH, '/usr/bin:/bin');
});

test('the Windows set holds the five named variables and no others besides PATH, locale and WHEELHOUSE_HOME', () => {
  const win = {
    USERPROFILE: 'C:\\Users\\s', APPDATA: 'C:\\Users\\s\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\s\\AppData\\Local', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp',
    Path: 'C:\\Windows\\System32', LC_ALL: 'C', HOME: 'C:\\Users\\s', COMSPEC: 'cmd.exe', ANTHROPIC_BASE_URL: 'https://x.invalid', FOO: 'bar',
  };
  const env = standardEnv({ home: 'C:\\wh', platform: 'win32', env: win, claudePath: 'C:\\c\\claude.exe', exists: () => true });
  assert.deepEqual(Object.keys(env).sort(), ['APPDATA', 'LC_ALL', 'LOCALAPPDATA', 'Path', 'SystemRoot', 'TEMP', 'USERPROFILE', 'WHEELHOUSE_HOME']);
  assert.equal(env.Path, 'C:\\c;C:\\Windows\\System32');
  assert.equal(env.WHEELHOUSE_HOME, 'C:\\wh');
});

test('a home is required', () => {
  assert.throws(() => standardEnv({ env: starting }), /home/);
});

test('homeOf reads a lock\'s second line and a record\'s home', () => {
  assert.equal(homeOf('123\n/h/wh\n'), '/h/wh');
  assert.equal(homeOf('123\n'), null);
  assert.equal(homeOf({ pid: 1, home: '/h/x' }), '/h/x');
  assert.equal(homeOf({ pid: 1 }), null);
  assert.equal(homeOf(null), null);
});

test('the default home is .wheelhouse in the person\'s home folder', () => {
  assert.equal(isDefaultHome('/Users/s/.wheelhouse', { homedir: '/Users/s' }), true);
  assert.equal(isDefaultHome('/Users/s/trial', { homedir: '/Users/s' }), false);
});

test('a throwaway home is idle an hour after its last session; the default home and one with no record never are', () => {
  const home = path.join(tempFolder('wh-idle-'), 'trial');
  const at = new Date('2026-11-24T09:00:00.000Z');
  assert.equal(throwawayIdle(home, { now: () => new Date(at.getTime() + 5 * 3600 * 1000) }), false, 'no record');
  assert.equal(recordLastSession(home, { now: () => at }), true);
  assert.equal(throwawayIdle(home, { now: () => new Date(at.getTime() + 59 * 60 * 1000) }), false);
  assert.equal(throwawayIdle(home, { now: () => new Date(at.getTime() + 61 * 60 * 1000) }), true);
  const user = tempFolder('wh-user-');
  const usual = path.join(user, '.wheelhouse');
  recordLastSession(usual, { now: () => at });
  assert.equal(throwawayIdle(usual, { now: () => new Date(at.getTime() + 61 * 60 * 1000), homedir: user }), false, 'the default home');
  fs.writeFileSync(path.join(home, 'last-session.json'), '{ not json');
  assert.equal(throwawayIdle(home, { now: () => new Date(at.getTime() + 9 * 3600 * 1000) }), false, 'a record that does not read');
});

test('a home under the person\'s home folder is written from ~, so a lock or record names no user, and read back whole', () => {
  const user = path.join(path.sep, 'Users', 'someone');
  assert.equal(homeLabel(path.join(user, '.wheelhouse'), { homedir: user }), `~${path.sep}.wheelhouse`);
  assert.equal(homeLabel(user, { homedir: user }), '~');
  assert.equal(homeLabel(path.join(path.sep, 'srv', 'wh'), { homedir: user }), path.join(path.sep, 'srv', 'wh'));
  assert.equal(homeOf(`12\n${homeLabel(path.join(user, 'trial'), { homedir: user })}\n`, { homedir: user }), path.join(user, 'trial'));
  assert.equal(homeOf({ home: '~' }, { homedir: user }), user);
});

test('the default home is the same through a link to it or in another case on macOS and Windows', () => {
  const user = fs.realpathSync(tempFolder('wh-user-'));
  const usual = path.join(user, '.wheelhouse');
  fs.mkdirSync(usual);
  const link = path.join(user, 'linked');
  fs.symlinkSync(usual, link);
  assert.equal(isDefaultHome(link, { homedir: user }), true, 'a link to it');
  assert.equal(isDefaultHome(path.join(user, '.WheelHouse'), { homedir: user, platform: 'darwin' }), true);
  assert.equal(isDefaultHome(path.join(user, '.WheelHouse'), { homedir: user, platform: 'win32' }), true);
  assert.equal(sameFolder('/a/.WheelHouse', '/a/.wheelhouse', { platform: 'linux' }), false);
  recordLastSession(link, { now: () => new Date('2026-11-24T00:00:00.000Z') });
  assert.equal(throwawayIdle(link, { now: () => new Date('2026-11-25T00:00:00.000Z'), homedir: user }), false, 'never idle through a link');
});

test('a session\'s tool calls keep the last-session time, at most once in the gap, and never make a home again', () => {
  const home = path.join(tempFolder('wh-touch-'), 'trial');
  const t0 = new Date('2026-11-24T09:00:00.000Z').getTime();
  assert.equal(touchLastSession(home, { now: () => new Date(t0) }), false, 'no home');
  assert.equal(fs.existsSync(home), false);
  fs.mkdirSync(home);
  assert.equal(touchLastSession(home, { now: () => new Date(t0) }), true);
  assert.equal(touchLastSession(home, { now: () => new Date(t0 + TOUCH_GAP_MS - 1) }), false, 'within the gap');
  assert.equal(lastSessionAt(home), t0);
  assert.equal(touchLastSession(home, { now: () => new Date(t0 + TOUCH_GAP_MS) }), true);
  assert.equal(lastSessionAt(home), t0 + TOUCH_GAP_MS);
  assert.equal(touchLastSession(home, { now: () => new Date(t0 + TOUCH_GAP_MS + 1), gapMs: 0 }), true, 'a session end always writes');
  // A long session keeps a throwaway home from going idle.
  assert.equal(throwawayIdle(home, { now: () => new Date(t0 + TOUCH_GAP_MS + 59 * 60 * 1000) }), false);
});
