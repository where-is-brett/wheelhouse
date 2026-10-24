// tests/scripts/setup/best-model.test.js
// The front desk's model: what one of Claude Code's aliases stands for, read from a session's init
// event. Setup's alias is `opus`; `best`, the strongest model, is kept for the director's opt-in,
// which comes with the Thoroughness design. `claude` is a stand-in; no session is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRONT_DESK_ALIAS, STRONGEST_ALIAS, aliasModel, initModel } from '../../../scripts/setup/best-model.js';

const init = (model) => `${JSON.stringify({ type: 'system', subtype: 'init', model })}\n${JSON.stringify({ type: 'result', is_error: false })}\n`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('initModel reads the model from the first init event, past lines that are not JSON', () => {
  assert.equal(initModel(`warming up\n${init('model-top-1')}`), 'model-top-1');
  assert.equal(initModel(JSON.stringify({ type: 'result' })), null);
  assert.equal(initModel(''), null);
  assert.equal(initModel(undefined), null);
});

test('the front desk\'s alias is Claude Code\'s opus, and the strongest, kept for the director\'s opt-in, is best', () => {
  assert.equal(FRONT_DESK_ALIAS, 'opus');
  assert.equal(STRONGEST_ALIAS, 'best');
});

test('aliasModel asks claude for the alias in an empty scratch folder, and gives the full name it ran on', async () => {
  for (const alias of [FRONT_DESK_ALIAS, STRONGEST_ALIAS]) {
    const seen = [];
    const run = async (file, args, options) => {
      seen.push({ file, args, cwd: options.cwd, empty: fs.readdirSync(options.cwd).length === 0 });
      return { code: 0, stdout: init('model-top-1'), stderr: '' };
    };
    assert.equal(await aliasModel(alias, { run, claude: () => ({ kind: 'direct', file: 'claude' }) }), 'model-top-1');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].file, 'claude');
    assert.equal(seen[0].args[seen[0].args.indexOf('--model') + 1], alias);
    assert.equal(seen[0].args[seen[0].args.indexOf('--setting-sources') + 1], 'project', 'none of the director\'s own settings load');
    assert.ok(seen[0].empty, 'the folder holds nothing of the project\'s');
    assert.ok(!fs.existsSync(seen[0].cwd), 'the folder is removed afterwards');
  }
});

test('aliasModel gives null when claude is missing, fails to start, names no model, or names one that can\'t be passed back', async () => {
  const claude = () => ({ kind: 'direct', file: 'claude' });
  assert.equal(await aliasModel(FRONT_DESK_ALIAS, { claude: () => { throw new Error('no claude'); } }), null);
  assert.equal(await aliasModel(FRONT_DESK_ALIAS, { claude, run: async () => { throw new Error('ENOENT'); } }), null);
  assert.equal(await aliasModel(FRONT_DESK_ALIAS, { claude, run: async () => ({ code: 1, stdout: 'Not signed in\n', stderr: '' }) }), null);
  for (const alias of [FRONT_DESK_ALIAS, STRONGEST_ALIAS]) {
    assert.equal(await aliasModel(alias, { claude, run: async () => ({ code: 0, stdout: init(alias), stderr: '' }) }), null, 'the alias itself is no pin');
  }
  assert.equal(await aliasModel(FRONT_DESK_ALIAS, { claude, run: async () => ({ code: 0, stdout: init('-p'), stderr: '' }) }), null);
});

test('setup names no model of its own, only Claude Code\'s aliases', () => {
  for (const name of fs.readdirSync(path.join(ROOT, 'scripts', 'setup'))) {
    const text = fs.readFileSync(path.join(ROOT, 'scripts', 'setup', name), 'utf8');
    assert.doesNotMatch(text, /\bclaude-(opus|sonnet|haiku|fable)|\bfable\b/i, name);
  }
});
