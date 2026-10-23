// tests/scripts/setup/best-model.test.js
// The front desk's model: what Claude Code's alias for its most capable model stands for, read from
// a session's init event. `claude` is a stand-in; no session is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BEST, bestModel, initModel } from '../../../scripts/setup/best-model.js';

const init = (model) => `${JSON.stringify({ type: 'system', subtype: 'init', model })}\n${JSON.stringify({ type: 'result', is_error: false })}\n`;

test('initModel reads the model from the first init event, past lines that are not JSON', () => {
  assert.equal(initModel(`warming up\n${init('model-top-1')}`), 'model-top-1');
  assert.equal(initModel(JSON.stringify({ type: 'result' })), null);
  assert.equal(initModel(''), null);
  assert.equal(initModel(undefined), null);
});

test('bestModel asks claude for its alias in an empty scratch folder, and gives the full name it ran on', async () => {
  const seen = [];
  const run = async (file, args, options) => {
    seen.push({ file, args, cwd: options.cwd, empty: fs.readdirSync(options.cwd).length === 0 });
    return { code: 0, stdout: init('model-top-1'), stderr: '' };
  };
  assert.equal(await bestModel({ run, claude: () => ({ kind: 'direct', file: 'claude' }) }), 'model-top-1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].file, 'claude');
  assert.equal(seen[0].args[seen[0].args.indexOf('--model') + 1], BEST);
  assert.equal(seen[0].args[seen[0].args.indexOf('--setting-sources') + 1], 'project', 'none of the director\'s own settings load');
  assert.ok(seen[0].empty, 'the folder holds nothing of the project\'s');
  assert.ok(!fs.existsSync(seen[0].cwd), 'the folder is removed afterwards');
});

test('bestModel gives null when claude is missing, fails to start, names no model, or names one that can\'t be passed back', async () => {
  const claude = () => ({ kind: 'direct', file: 'claude' });
  assert.equal(await bestModel({ claude: () => { throw new Error('no claude'); } }), null);
  assert.equal(await bestModel({ claude, run: async () => { throw new Error('ENOENT'); } }), null);
  assert.equal(await bestModel({ claude, run: async () => ({ code: 1, stdout: 'Not signed in\n', stderr: '' }) }), null);
  assert.equal(await bestModel({ claude, run: async () => ({ code: 0, stdout: init(BEST), stderr: '' }) }), null, 'the alias itself is no pin');
  assert.equal(await bestModel({ claude, run: async () => ({ code: 0, stdout: init('-p'), stderr: '' }) }), null);
});
