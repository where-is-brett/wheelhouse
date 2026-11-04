// tests/scripts/update/readme-bootstrap.test.js
// The README's one-paste bootstrap lines (update design, section 13): both clone quietly, so the director sees no git advice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const README = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'README.md'), 'utf8');
const lines = README.split('\n').filter((l) => /update[/\\]bootstrap/.test(l) && l.includes('clone'));

test('readme: the macOS and the PowerShell bootstrap lines both clone quietly', () => {
  assert.equal(lines.length, 2, 'one line for each system');
  for (const line of lines) {
    assert.match(line, /git -c advice\.detachedHead=false clone -q --depth 1 --branch <tag> /, line);
  }
});
