// tests/scripts/watcher/decision-batch.test.js
// The first tick after local midnight batches the previous day's decision records that belong to no piece (design section 6.6
// of the director's way of working), through the helper; it also keeps whether the repository is public for the decision messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeDecisionBatcher } from '../../../scripts/watcher/decision-batch.js';
import { runWatcher } from '../../../scripts/watcher/main.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const P = 'o__p';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function stand({ batch = { ok: true, step: 'none' }, pub = { ok: true, public: true } } = {}) {
  const calls = [];
  let t = at(2026, 11, 7, 23, 50);
  const client = {
    decisions: { batch: async (body) => { calls.push(['batch', body]); return typeof batch === 'function' ? batch(calls.length) : batch; } },
    host: { public: async (body) => { calls.push(['public', body]); if (pub instanceof Error) throw pub; return pub; } },
  };
  const logged = [];
  const batcher = makeDecisionBatcher({ project: P, client, now: () => new Date(t), log: (m) => logged.push(m) });
  return { calls, batcher, logged, at: (ms) => { t = ms; } };
}
const batches = (calls) => calls.filter((c) => c[0] === 'batch').map((c) => c[1]);

test('the first tick on a new day batches the previous day, once', async () => {
  const s = stand();
  // Before midnight on the 7th the 6th is the previous day: the first ever tick asks for it.
  await s.batcher.tick();
  assert.deepEqual(batches(s.calls), [{ project: P, date: '2026-11-06' }]);
  // Done for the day: later ticks ask nothing more.
  s.at(at(2026, 11, 7, 23, 59));
  await s.batcher.tick();
  assert.equal(batches(s.calls).length, 1);
  // The first tick after local midnight is a new day: the 7th is now the previous one.
  s.at(at(2026, 11, 8, 0, 1));
  await s.batcher.tick();
  assert.deepEqual(batches(s.calls).at(-1), { project: P, date: '2026-11-07' });
  assert.equal(batches(s.calls).length, 2);
  s.at(at(2026, 11, 8, 12));
  await s.batcher.tick();
  assert.equal(batches(s.calls).length, 2);
});

test('a change still opening or waiting is looked at again later, not every tick', async () => {
  const s = stand({ batch: { ok: true, step: 'waiting', pr: 8, why: 'CI has not passed' } });
  await s.batcher.tick();
  s.at(at(2026, 11, 7, 23, 55));
  await s.batcher.tick();
  assert.equal(batches(s.calls).length, 1, 'five minutes on, it is left alone');
  s.at(at(2026, 11, 8, 0, 2));
  await s.batcher.tick();
  assert.equal(batches(s.calls).length, 2, 'ten minutes on, it is asked again');
});

test('a refusal, an error or a helper that is down is noted and tried again later, never taken as done', async () => {
  for (const batch of [{ ok: false, refused: 'All stop is on' }, () => { throw new Error('the helper could not be reached'); }]) {
    const s = stand({ batch });
    await s.batcher.tick();
    assert.equal(s.logged.length, 1);
    s.at(at(2026, 11, 8, 0, 15));
    await s.batcher.tick();
    assert.equal(batches(s.calls).length, 2);
  }
});

test('whether the repository is public is read at the first tick and then every few hours', async () => {
  const s = stand();
  await s.batcher.tick();
  const publics = () => s.calls.filter((c) => c[0] === 'public').length;
  assert.equal(publics(), 1);
  s.at(at(2026, 11, 8, 1));
  await s.batcher.tick();
  assert.equal(publics(), 1);
  s.at(at(2026, 11, 8, 6));
  await s.batcher.tick();
  assert.equal(publics(), 2);
});

test('a visibility the host will not give does not stop the batch', async () => {
  const s = stand({ pub: new Error('the helper could not be reached') });
  await s.batcher.tick();
  assert.equal(batches(s.calls).length, 1);
});

// The watcher's own loop makes the tick: a stand-in helper sees the call.
test('the watcher loop asks the helper to batch on its tick', () => withHome(async () => {
  const main = tempFolder('wh-main-');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  if (!readProject(P)) {
    writeProject(P, { folder: main, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
  }
  const calls = [];
  const client = {
    config: async () => ({ ok: true, config: { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: { foreman: 'model-a' } } }),
    state: { write: async () => ({ ok: true }), record: async () => ({ ok: true }) },
    decisions: { batch: async (body) => { calls.push(body); return { ok: true, step: 'none' }; } },
    host: { public: async () => ({ ok: true, public: false }) },
  };
  const waker = { wakeForeman: async () => {}, wakeFeature: async () => {}, pump: async () => [], prune: async () => {}, waiting: () => [] };
  const observe = async ({ now, awake }) => ({ at: now().toISOString(), awake, events: [], features: {}, prs: {}, testMerges: [], stop: false, polled: {}, stateIds: [] });
  const config = readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: { foreman: 'model-a' } }));
  await runWatcher({ project: P, client, config, observe, waker, loops: 2, now: () => new Date(at(2026, 11, 8, 0, 5)), sleep: async () => {}, log: () => {}, recovery: { check: async () => [] }, resume: async () => {} });
  assert.deepEqual(calls, [{ project: P, date: '2026-11-07' }]);
}));
