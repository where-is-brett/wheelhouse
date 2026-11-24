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

test('nothing recorded means nothing stopped and nothing running', () => {
  const home = tempFolder('wh-beats-');
  assert.deepEqual(stillRunning(home, P, { now, alive: alive([]) }), { stopped: [], running: [] });
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
  writeStopped(home, P, { at: new Date(NOW).toISOString(), works: ['login-page', 'search-box', 'foreman'] });
  write(home, `projects/${P}/watcher/running/feature-search-box.json`, { pid: 33 });
  const got = stillRunning(home, P, { now, alive: alive([33]) });
  assert.deepEqual(got.stopped, ['builder login-page', 'builder search-box', 'foreman']);
  assert.deepEqual(got.running, [{ name: 'builder search-box', why: 'still ending' }]);
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
