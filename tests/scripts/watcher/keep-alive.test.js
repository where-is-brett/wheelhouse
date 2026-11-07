// tests/scripts/watcher/keep-alive.test.js
// DRAFT (part 5, task 1). Fails until scripts/watcher/keep-alive.js exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keepWatcherAlive, keepAllAlive } from '../../../scripts/watcher/keep-alive.js';

const config = (extra = {}) => ({ ok: true, config: { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], ...extra } });
const harness = ({ running = false, read = config() } = {}) => {
  const seen = { started: [], asked: 0 };
  return {
    seen,
    options: {
      client: { config: async () => { seen.asked += 1; return read; } },
      running: () => running,
      start: (project) => { seen.started.push(project); return { started: true }; },
    },
  };
};

test('a watcher that is not running is started', async () => {
  const h = harness();
  assert.equal(await keepWatcherAlive('p', h.options), 'started');
  assert.deepEqual(h.seen.started, ['p']);
});

test('a watcher that is running is left alone, and the configuration is not asked for', async () => {
  const h = harness({ running: true });
  assert.equal(await keepWatcherAlive('p', h.options), 'running');
  assert.deepEqual(h.seen.started, []);
  assert.equal(h.seen.asked, 0);
});

test('watcherShape 2 in the record is read as Shape 1: the watcher is started', async () => {
  const h = harness({ read: config({ watcherShape: 2 }) });
  assert.equal(await keepWatcherAlive('p', h.options), 'started');
});

test('a configuration that cannot be read starts nothing and does not throw', async () => {
  const h = harness({ read: { ok: false, why: 'no helper' } });
  assert.equal(await keepWatcherAlive('p', h.options), 'unread');
  assert.deepEqual(h.seen.started, []);
  const broken = harness();
  broken.options.client.config = async () => { throw new Error('down'); };
  assert.equal(await keepWatcherAlive('p', broken.options), 'unread');
});

test('a start that throws is answered as failed, not thrown', async () => {
  const h = harness();
  h.options.start = () => { throw new Error('no spawn'); };
  assert.equal(await keepWatcherAlive('p', h.options), 'failed');
});

test('the helper\'s tick keeps each project\'s watcher alive and leaves a skipped one alone', async () => {
  const started = [];
  const answers = await keepAllAlive({
    projects: ['a', 'b', 'c'],
    clientFor: () => ({ config: async () => config() }),
    skip: (p) => p === 'c',
    running: (p) => p === 'b',
    start: (p) => { started.push(p); return { started: true }; },
  });
  assert.deepEqual(answers, { a: 'started', b: 'running' });
  assert.deepEqual(started, ['a']);
});
