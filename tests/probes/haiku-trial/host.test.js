// tests/probes/haiku-trial/host.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ghArgs, readGateWith, PICKED, startOf } from '../../../probes/haiku-trial/host.js';

const SLUG = 'trial-owner/haiku-trial-2026-11-08';

test('ghArgs fills the repository and scopes every command but api and repo', () => {
  assert.deepEqual(ghArgs(['pr', 'list', '--state', 'merged'], SLUG), ['pr', 'list', '--state', 'merged', '--repo', SLUG]);
  assert.deepEqual(ghArgs(['run', 'list', '--branch', 'main'], SLUG), ['run', 'list', '--branch', 'main', '--repo', SLUG]);
  assert.deepEqual(ghArgs(['api', 'repos/{owner}/{repo}/pulls'], SLUG), ['api', `repos/${SLUG}/pulls`]);
  assert.deepEqual(ghArgs(['api', 'repos/{owner}/{repo}/pulls'], SLUG).includes('--repo'), false);
  assert.deepEqual(ghArgs(['repo', 'create', SLUG, '--public'], SLUG), ['repo', 'create', SLUG, '--public']);
});

const DIFF = [
  'diff --git a/src/lib/categories.js b/src/lib/categories.js',
  '--- a/src/lib/categories.js',
  '+++ b/src/lib/categories.js',
  '@@ -1,2 +1,2 @@',
  "-  { key: 'eating_out', label: 'Eating out' },",
  "+  { key: 'dining', label: 'Dining' },",
  '',
].join('\n');

test('readGateWith passes the pull request files and diff through the gate and returns its reading', async () => {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (args[1].includes('/pulls?state=all')) return [{ number: 4, title: 'Rename', head: { ref: 'feature/rename-key' } }];
    if (args[1].endsWith('/files?per_page=100')) return [{ filename: 'src/lib/categories.js' }];
    return DIFF;
  };
  const reading = await readGateWith({ gh, change: 'rename-key' });
  assert.equal(reading.visible, true);
  assert.ok(reading.reasons.some((r) => /text|string|literal/i.test(r)), reading.reasons.join('; '));
  assert.deepEqual(calls.at(-1).slice(-2), ['-H', 'Accept: application/vnd.github.v3.diff']);
});

test('readGateWith is null when the change or its pull request is not known', async () => {
  assert.equal(await readGateWith({ gh: async () => [], change: 'x' }), null);
  assert.equal(await readGateWith({ gh: async () => [], change: undefined }), null);
});

test('a diff that could not be read leaves the gate unsure, not visible', async () => {
  const gh = async (args) => (args[1].includes('/pulls?state=all') ? [{ number: 4, head: { ref: 'rename-key' } }] : args[1].endsWith('/files?per_page=100') ? [{ filename: 'src/lib/categories.js' }] : null);
  const reading = await readGateWith({ gh, change: 'rename-key' });
  assert.equal(reading.unsure, true);
  assert.equal(reading.visible, false);
});

test('the stand-in answers setup cards as well as plan, approval and confirm cards, and never a decision or an undo', () => {
  for (const kind of ['setup', 'confirm-all', 'baseline', 'trust', 'approve-work', 'approval', 'confirm']) assert.ok(PICKED.includes(kind), kind);
  for (const kind of ['answer', 'undo', 'lift-stop', 'lift-incident']) assert.equal(PICKED.includes(kind), false, kind);
});

test('startOf reads a start time month first, as the helper records it, and day first, as ps prints it under en_AU', () => {
  const monthFirst = startOf('Mon Nov  9 00:36:26 2026');
  assert.equal(typeof monthFirst, 'number');
  assert.equal(startOf('Mon  9 Nov 00:36:26 2026'), monthFirst);
  assert.equal(startOf('Mon 19 Nov 00:36:26 2026'), startOf('Mon Nov 19 00:36:26 2026'));
  assert.equal(startOf('not a time'), null);
  assert.equal(startOf(undefined), null);
});
