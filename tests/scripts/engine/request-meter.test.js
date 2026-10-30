// tests/scripts/engine/request-meter.test.js
// One account's meter across its projects, on stand-ins: no provider is asked anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestMeter, requestsThisMonth } from '../../../scripts/engine/request-meter.js';
import { checkRequests, CHECK_EVERY_MS } from '../../../scripts/engine/archon/copilot-meter.js';

const fileIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-meter-')), 'meter', 'account.json');
const cost = (premiumRequests, at = '2026-10-30T09:00:00Z', byRole = {}) => ({ at, data: { premiumRequests, byRole } });
const project = (costs = [], going = []) => ({ costs: () => costs, going: () => going });

test('the month adds up every project on the account', async () => {
  const projects = [project([cost(4), cost(9, '2026-09-30T09:00:00Z')]), project([cost(3)])];
  assert.equal(await requestsThisMonth({ projects, month: '2026-10', inspect: async () => null }), 7);
});

test('a cost record that counts null is never read as 0', async () => {
  const roles = { build: {}, 'review-spec': {}, 'review-standards': {} };
  const projects = [project([cost(null, undefined, roles), cost(null), cost(0)])];
  assert.equal(await requestsThisMonth({ projects, month: '2026-10', inspect: async () => null }), 4, 'one for each step it names, and at least one');
});

test('a run that has not ended counts from the engine\'s record, and one that can\'t be read counts as unknown', async () => {
  const records = { paused: { status: 'paused', steps: [{ source: 'estimated', requests: 2 }, { source: 'unknown', requests: 1 }] } };
  const got = await requestsThisMonth({
    projects: [project([], ['paused', 'lost', 'throws'])], month: '2026-10',
    inspect: async (id) => { if (id === 'throws') throw new Error('no engine'); return id === 'lost' ? { status: 'unknown', steps: [] } : records[id]; },
  });
  assert.equal(got, 5, 'three steps, and one each for the two it can\'t read');
});

test('two projects share one meter: one reading of the provider, one line, and the same count', async () => {
  const file = fileIn();
  const lines = [];
  let reads = 0;
  const read = async () => { reads += 1; return { used: 50, entitlement: 200, remaining: 150, resets: '2026-11-01' }; };
  const start = new Date('2026-10-30T09:00:00Z');
  const first = requestMeter({ file, estimate: () => 0, look: ({ kept, estimate }) => checkRequests({ read, estimate, kept, now: start }) });
  await first.used();
  assert.equal(reads, 1);
  const later = new Date(start.getTime() + CHECK_EVERY_MS);
  const meter = requestMeter({ file, estimate: () => 2, note: (line) => lines.push(line), look: ({ kept, estimate }) => checkRequests({ read: async () => ({ ...(await read()), used: 60 }), estimate, kept, now: later }) });
  const [a, b] = await Promise.all([meter.used(), meter.used()]);
  assert.deepEqual([a, b], [10, 10], 'GitHub\'s ten, for both projects');
  assert.equal(reads, 2, 'read once for the two looks');
  assert.equal(lines.length, 1, 'one Logbook line');
});

test('a look that fails gives the estimate', async () => {
  const meter = requestMeter({ file: fileIn(), estimate: () => 7, look: async () => { throw new Error('no'); } });
  assert.equal(await meter.used(), 7);
});
