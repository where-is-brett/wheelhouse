// tests/probes/lib/copilot-hook-logger.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../helpers/homes.js';

const logger = fileURLToPath(new URL('../../../probes/lib/copilot-hook-logger.js', import.meta.url));

function lines(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('the Copilot hook logger appends the tag, event, folder and input to the file it is given, and prints nothing', () => {
  const dir = tempFolder('wh-hook-logger-');
  const file = path.join(dir, 'sub', 'hooks.jsonl');
  const first = spawnSync(process.execPath, [logger, file, 'plugin-agent', 'preToolUse'], {
    cwd: dir, input: '{"toolName":"view","toolArgs":{"path":"README.md"},"sessionId":"s1"}', encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, '');
  const second = spawnSync(process.execPath, [logger, file, 'home-hooks', 'sessionStart'], { cwd: dir, input: '{"source":"new"}', encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  const [a, b] = lines(file);
  assert.equal(a.tag, 'plugin-agent');
  assert.equal(a.event, 'preToolUse');
  assert.equal(a.input.toolName, 'view');
  assert.equal(fs.realpathSync(a.cwd), fs.realpathSync(dir));
  assert.ok(!Number.isNaN(Date.parse(a.at)));
  assert.equal(b.tag, 'home-hooks');
  assert.equal(b.input.source, 'new');
});

test('the Copilot hook logger keeps input that is not JSON, writes no secret and always exits 0', () => {
  const dir = tempFolder('wh-hook-logger-');
  const file = path.join(dir, 'hooks.jsonl');
  const odd = spawnSync(process.execPath, [logger, file, 't', 'e'], { input: 'not json', encoding: 'utf8' });
  assert.equal(odd.status, 0);
  const empty = spawnSync(process.execPath, [logger, file, 't', 'e'], { input: '', encoding: 'utf8' });
  assert.equal(empty.status, 0);
  const secret = spawnSync(process.execPath, [logger, file, 't', 'e'], { input: '{"githubToken":"ghp_abc","x":1}', encoding: 'utf8' });
  assert.equal(secret.status, 0);
  const [a, b, c] = lines(file);
  assert.deepEqual(a.input, { unparsed: 'not json' });
  assert.deepEqual(b.input, { unparsed: '' });
  assert.equal(c.input.githubToken, '[redacted]');
  assert.equal(c.input.x, 1);
  // No log file given: nothing to write, still a clean exit.
  assert.equal(spawnSync(process.execPath, [logger], { input: '{}', encoding: 'utf8' }).status, 0);
  // A log file that can't be written (its parent is a file): still a clean exit, never a denial.
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  assert.equal(spawnSync(process.execPath, [logger, path.join(blocker, 'hooks.jsonl'), 't', 'e'], { input: '{}', encoding: 'utf8' }).status, 0);
});
