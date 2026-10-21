// tests/scripts/protection/locked-imports.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOCKED_FOLDERS } from '../../../scripts/protection/locked.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"\n;]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

// Every file the module reaches by relative imports, as paths under the repository, the module itself first.
function closure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const target = path.resolve(path.dirname(file), m[1] ?? m[2] ?? m[3]);
      if (target.endsWith('.js')) queue.push(target);
    }
  }
  return [...seen];
}

test('every file a hook script imports lies in a folder Locked copies, so the managed copy loads', () => {
  const hooks = fs.readdirSync(path.join(ROOT, 'scripts', 'hooks')).filter((f) => f.endsWith('.js'));
  assert.ok(hooks.length > 5);
  const outside = [];
  for (const hook of hooks) {
    for (const file of closure(path.join(ROOT, 'scripts', 'hooks', hook))) {
      const relative = path.relative(ROOT, file).split(path.sep).join('/');
      if (!LOCKED_FOLDERS.some((folder) => relative.startsWith(`${folder}/`))) outside.push(`${hook} reaches ${relative}`);
      else if (!fs.existsSync(file)) outside.push(`${hook} imports ${relative}, which does not exist`);
    }
  }
  assert.deepEqual(outside, []);
});

test('a hook script run from a scratch copy of only the Locked folders loads and answers', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-locked-copy-'));
  try {
    for (const folder of LOCKED_FOLDERS) fs.cpSync(path.join(ROOT, folder), path.join(scratch, folder), { recursive: true });
    const home = fs.mkdtempSync(path.join(scratch, 'home-'));
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: os.tmpdir(), session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    for (const hook of ['stop-guard.js', 'card-check.js', 'session-start.js']) {
      const run = spawnSync(process.execPath, [path.join(scratch, 'scripts', 'hooks', hook)], { input, encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: home } });
      assert.equal(run.status, 0, `${hook}: ${run.stderr}`);
      assert.ok(!/ERR_MODULE_NOT_FOUND/.test(run.stderr), `${hook} could not load its imports`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
