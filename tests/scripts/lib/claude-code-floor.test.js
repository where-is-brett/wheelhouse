// tests/scripts/lib/claude-code-floor.test.js
// CI's validate job runs the mod's checks on the Claude Code it pins, which is to be the floor
// (scripts/lib/build-loop.js), so the checks run on the lowest Claude Code Wheelhouse runs on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLAUDE_CODE_FLOOR } from '../../../scripts/lib/build-loop.js';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

test('every Claude Code that CI installs is pinned at the floor', () => {
  const pins = [...fs.readFileSync(CI, 'utf8').matchAll(/@anthropic-ai\/claude-code@(\S+)/g)].map((m) => m[1]);
  assert.ok(pins.length > 0, 'ci.yml installs no pinned Claude Code');
  assert.deepEqual(pins, pins.map(() => CLAUDE_CODE_FLOOR));
});
