// tests/scripts/desk/seam.test.js
// The seam holds (spec 5.5): the front ends read and change Wheelhouse through the desk alone. None
// imports the readers of ~/.wheelhouse or calls the helper's views routes; those live in scripts/desk/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRONT_ENDS = [
  'scripts/frontdesk/cli.js', 'scripts/hooks/board-context.js', 'scripts/mod/bridge.js', 'scripts/mod/status.js', 'scripts/mod/press.js',
  'scripts/mod/reply.js', 'scripts/mod/settings-pane.js', 'scripts/mod/courier.js', 'scripts/lean/cli.js', 'scripts/agents/copilot/hook-entry.js',
];
const READERS = ['localViews', 'listEvents', 'readProfileViews', 'loadBoardInputs'];

// The names a file imports, from every import statement in it.
function imported(source) {
  const names = [];
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']+'/g)) {
    for (const part of m[1].split(',')) names.push(part.trim().split(/\s+as\s+/)[0]);
  }
  return names.filter(Boolean);
}

test('no front end reads ~/.wheelhouse or the helper\'s views itself', () => {
  for (const file of FRONT_ENDS) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const found = imported(source).filter((name) => READERS.includes(name));
    assert.deepEqual(found, [], `${file} imports ${found.join(', ')}`);
    assert.doesNotMatch(source, /\bstate\.views\s*\(|\bstate\?\.views\b|\bprofile\.views\s*\(|\bprofile\?\.views\b/, `${file} calls the helper's views routes`);
  }
});

test('each front end goes through the desk', () => {
  // The courier is handed what it follows by the bridge; the Copilot entry loads the desk only when the stop word is typed.
  for (const file of FRONT_ENDS.filter((f) => f !== 'scripts/mod/courier.js')) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /(?:from |import\()'(?:\.\.\/)+desk\/[a-z-]+\.js'/, `${file} uses the desk`);
  }
});
