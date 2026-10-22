// tests/scripts/agents/core-neutral.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Folders that may name Copilot: the adapters, the agents' folder, the editor add-on, the probes, the tests and the docs.
const ALLOWED_FOLDERS = ['adapters/', 'scripts/agents/', 'vscode/', 'probes/', 'tests/', 'docs/'];
// Tooling folders that are not the product.
const TOOLING_FOLDERS = ['node_modules/', '.git/', '.superpowers/', '.claude/'];
// Core files that name Copilot, each with why.
const ALLOWED_CORE_FILES = {
  'scripts/lib/copilot-numbers.js': 'the numbers of the Copilot design, named once',
  'scripts/lib/agent-control.js': 'the guardrail list names the folders and files that steer each agent, Copilot\'s among them (design section 6.5)',
  'HANDOVER.md': 'the handover says where the work stands, the Copilot build among it',
};

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter((f) => f !== '');
}

test('no file outside the allowed folders names Copilot', () => {
  const offenders = [];
  for (const file of trackedFiles()) {
    if (ALLOWED_FOLDERS.some((d) => file.startsWith(d)) || TOOLING_FOLDERS.some((d) => file.startsWith(d))) continue;
    if (Object.hasOwn(ALLOWED_CORE_FILES, file)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(REPO, file), 'utf8');
    } catch {
      continue;
    }
    if (/copilot/i.test(text) || /copilot/i.test(file)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'These core files name Copilot; move that into an adapter');
});
