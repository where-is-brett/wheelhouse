// tests/scripts/lib/host-tools.test.js
// Whether `gh` or `glab` will start on this computer, and what counts as one that won't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolState, startFailure } from '../../../scripts/lib/host-tools.js';
import { tempFolder } from '../../helpers/homes.js';

// These tests name the bare tools, so they run with an empty tools folder.
process.env.WHEELHOUSE_HOME = tempFolder('wh-host-tools-');

const spawnError = (code) => Object.assign(new Error(`spawn glab ${code}`), { code });

test('a tool that is not there, or may not run, or prints a policy message, is a start failure', () => {
  assert.equal(startFailure(spawnError('ENOENT')), true);
  assert.equal(startFailure(spawnError('EACCES')), true);
  assert.equal(startFailure(spawnError('EPERM')), true);
  assert.equal(startFailure({ code: 1, stdout: '', stderr: 'This program is blocked by group policy. For more information, contact your system administrator.' }), true);
  assert.equal(startFailure({ code: 1, stdout: '', stderr: 'Windows cannot run this file. Blocked by policy.' }), true);
});

test('a signed-out tool, a refused request and a plain success are not start failures', () => {
  assert.equal(startFailure({ code: 1, stdout: '', stderr: 'glab: You are not logged in. Run glab auth login.' }), false);
  assert.equal(startFailure({ code: 1, stdout: '', stderr: 'GET https://gitlab.example.org/api/v4/projects/x: 404 (HTTP 404)' }), false);
  assert.equal(startFailure({ code: 0, stdout: 'glab 1.50.0', stderr: '' }), false);
  assert.equal(startFailure(new Error('some other failure')), false);
  assert.equal(startFailure(null), false);
});

test('toolState says works, missing or blocked from `<tool> version`', async () => {
  const seen = [];
  const answer = (outcome) => async (file, args, options) => {
    seen.push({ file, args, timeoutMs: options?.timeoutMs });
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  assert.equal(await toolState('glab', { run: answer({ code: 0, stdout: 'glab 1.50', stderr: '' }) }), 'works');
  assert.deepEqual(seen[0], { file: 'glab', args: ['version'], timeoutMs: 10000 });
  assert.equal(await toolState('gh', { run: answer(spawnError('ENOENT')) }), 'missing');
  assert.equal(await toolState('gh', { run: answer(spawnError('EACCES')) }), 'blocked');
  assert.equal(await toolState('glab', { run: answer({ code: 1, stdout: '', stderr: 'blocked by group policy' }) }), 'blocked');
  assert.equal(await toolState('glab', { run: answer({ code: 1, stdout: '', stderr: '', timedOut: true }) }), 'blocked');
  await assert.rejects(toolState('curl', { run: answer({ code: 0 }) }), /no host tool named curl/);
});
