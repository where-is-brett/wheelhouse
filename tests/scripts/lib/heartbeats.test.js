// tests/scripts/lib/heartbeats.test.js
// Who is still running after All stop, from heartbeats alone (builders and settings design, section 12A.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stillRunning, allStoppedWords, writeStopped, HEARTBEAT_FRESH_MS } from '../../../scripts/lib/heartbeats.js';
import { tempFolder } from '../../helpers/homes.js';

const P = 'o__p';
const NOW = Date.parse('2026-11-24T10:00:00.000Z');
const write = (home, rel, value) => {
  const file = path.join(home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
};
const now = () => new Date(NOW);
const alive = (pids) => (pid) => pids.includes(pid);
// The All stop now on, set at this time.
const STOP = '2026-11-24T09:59:00.000Z';
const stopAt = () => STOP;

test('nothing recorded means nothing stopped and nothing running', () => {
  const home = tempFolder('wh-beats-');
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt }), { stopped: [], running: [] });
});

test('the helper and a fresh watcher heartbeat are still running; a stale or dead one is not', () => {
  const home = tempFolder('wh-beats-');
  write(home, 'helper.json', { pid: 11 });
  write(home, `projects/${P}/watcher/health.json`, { pid: 22, at: new Date(NOW - 30 * 1000).toISOString() });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([11, 22]) }).running, [
    { name: 'the helper', why: 'holds your keys and refuses every change' },
    { name: 'the watcher', why: 'idle, making no changes' },
  ]);
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([22]) }).running.map((r) => r.name), ['the watcher']);
  write(home, `projects/${P}/watcher/health.json`, { pid: 22, at: new Date(NOW - HEARTBEAT_FRESH_MS - 1000).toISOString() });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([11, 22]) }).running.map((r) => r.name), ['the helper']);
});

test('a damaged heartbeat file reads as not running, never as a throw', () => {
  const home = tempFolder('wh-beats-');
  write(home, 'helper.json', '{ not json');
  write(home, `projects/${P}/watcher/health.json`, '[]');
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([1]) }), { stopped: [], running: [] });
});

test('the builders the watcher ended are stopped; one whose process is still there is still running', () => {
  const home = tempFolder('wh-beats-');
  writeStopped(home, P, { at: new Date(NOW).toISOString(), stop: STOP, works: ['login-page', 'search-box', 'foreman'] });
  write(home, `projects/${P}/watcher/running/feature-search-box.json`, { pid: 33 });
  const got = stillRunning(home, P, { now, alive: alive([33]), stopAt });
  assert.deepEqual(got.stopped, ['builder login-page', 'builder search-box', 'foreman']);
  assert.deepEqual(got.running, [{ name: 'builder search-box', why: 'still ending' }]);
});

test('a record of an earlier All stop is not read as this one\'s, and the next STOP replaces it', () => {
  const home = tempFolder('wh-beats-');
  writeStopped(home, P, { at: new Date(NOW).toISOString(), stop: '2026-11-20T08:00:00.000Z', works: ['login-page'] });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt }).stopped, [], 'an earlier STOP\'s builders are not shown');
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt: () => undefined }).stopped, []);
  writeStopped(home, P, { at: new Date(NOW).toISOString(), stop: STOP, works: [] });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt }).stopped, [], 'the new STOP starts empty');
  writeStopped(home, P, { at: new Date(NOW).toISOString(), stop: STOP, works: ['search-box'] });
  writeStopped(home, P, { at: new Date(NOW).toISOString(), stop: STOP, works: ['foreman', 'search-box'] });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt }).stopped, ['builder search-box', 'foreman'], 'the same STOP gains names');
});

test('only the foreman and work ids are shown: other words in the records never reach the card', () => {
  const home = tempFolder('wh-beats-');
  write(home, `projects/${P}/watcher/all-stopped.json`, { at: STOP, stop: STOP, stopped: ['login-page', '/Users/someone/secret', 'Run rm -rf', 'x'.repeat(200), 7] });
  write(home, `projects/${P}/watcher/running/feature-..%2Fodd name.json`, { pid: 33 });
  const got = stillRunning(home, P, { now, alive: alive([33]), stopAt });
  assert.deepEqual(got.stopped, ['builder login-page']);
  assert.deepEqual(got.running, []);
});

test('the All stopped card lists stopped and still-running parts from heartbeats, in the design\'s words', () => {
  assert.equal(allStoppedWords({
    stopped: ['builder a', 'builder b', 'builder c', 'foreman'],
    running: [{ name: 'the helper', why: 'holds your keys and refuses every change' }, { name: 'the watcher', why: 'idle, making no changes' }],
  }), [
    'Stopped: 3 builders, the foreman.',
    'Still running: the helper (holds your keys and refuses every change) and the watcher (idle, making no changes).',
    'To carry on: **Lift All stop**. Work picks up where it stopped.',
  ].join('\n'));
  assert.match(allStoppedWords({ stopped: [], running: [] }), /^Stopped: nothing was running\.\nStill running: nothing\./);
  assert.match(allStoppedWords({ stopped: ['builder a'], running: [] }), /^Stopped: 1 builder\./);
});

test('the Desktop foreman is running while its check-in is fresh; its Desktop builders until the foreman notes them ended', () => {
  const home = tempFolder('wh-beats-');
  write(home, `projects/${P}/watcher/foreman-check-in.json`, { sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', at: new Date(NOW - 30 * 1000).toISOString() });
  const rec = { sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', worktree: '/x/y', branch: 'claude/a', at: new Date(NOW - 600 * 1000).toISOString() };
  write(home, `projects/${P}/watcher/desktop-builders/alpha.json`, rec);
  write(home, `projects/${P}/watcher/desktop-builders/beta.json`, { ...rec, endedAt: new Date(NOW - 5 * 1000).toISOString() });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt }).running, [
    { name: 'the foreman', why: 'its Desktop session, ending on All stop' },
    { name: 'builder alpha', why: 'its Desktop session, not yet stopped' },
  ]);
  write(home, `projects/${P}/watcher/foreman-check-in.json`, { sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', at: new Date(NOW - HEARTBEAT_FRESH_MS - 1000).toISOString() });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt }).running.map((r) => r.name), ['builder alpha']);
});

test('the foreman and Desktop builders are listed as stopped, once recorded for the All stop now on', () => {
  const home = tempFolder('wh-beats-');
  writeStopped(home, P, { at: STOP, stop: STOP, works: ['foreman', 'alpha', 'beta'] });
  const got = stillRunning(home, P, { now, alive: alive([]), stopAt });
  assert.deepEqual(got.stopped, ['foreman', 'builder alpha', 'builder beta']);
  assert.match(allStoppedWords(got), /^Stopped: 2 builders, the foreman\./);
});

test('a malformed foreman check-in or builder record is not counted as running', () => {
  const home = tempFolder('wh-beats-');
  write(home, `projects/${P}/watcher/foreman-check-in.json`, '{nope');
  write(home, `projects/${P}/watcher/desktop-builders/alpha.json`, { sessionId: 'a b; x', worktree: '/x', branch: 'b', at: new Date(NOW).toISOString() });
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]), stopAt }).running, []);
});
