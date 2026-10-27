// tests/scripts/jobs/weekly-main.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/jobs/weekly-main.js';

test('the process entry runs the weekly job with the fetch it is given, and answers 0', async () => {
  const seen = [];
  const fetch = () => {};
  const code = await main({ run: async (args) => { seen.push(args); }, fetch, now: () => new Date('2026-10-19T09:00:00Z') });
  assert.equal(code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].fetch, fetch);
  assert.equal('client' in seen[0], false, 'the job needs no helper');
  assert.equal(seen[0].now.toISOString(), '2026-10-19T09:00:00.000Z');
});

test('the process entry answers 0 when the jobs throw', async () => {
  assert.equal(await main({ run: async () => { throw new Error('no'); } }), 0);
});
