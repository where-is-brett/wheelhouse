// tests/scripts/agents/copilot-versions.test.js
// isTested reads docs/copilot/tested-versions.md: a row counts only when its Result says it passed (Part 4 Task 5).
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTested } from '../../../scripts/agents/copilot/versions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TABLE = path.join(ROOT, 'docs', 'copilot', 'tested-versions.md');

// Made-up versions, so no real release is named.
const TEXT = [
  '<!-- docs/copilot/tested-versions.md -->',
  '',
  '# Tested versions',
  '',
  'Some words that mention | a pipe | in a line that is not a row.',
  '',
  '| VS Code | Copilot runtime | Tested on | Result |',
  '|---|---|---|---|',
  '| 9.1.0 | 2.3.4 | 1 January 2030 | passed |',
  '| 9.1.0 | 2.3.5 | 1 January 2030 | failed |',
  '| 9.2.0 | 2.3.4 | 2 January 2030 | Passed on both systems |',
  '| `9.3.0` | `2.4.0` | 3 January 2030 | passed |',
  '| 9.4.0 | 2.5.0 | 4 January 2030 | did not pass |',
  '| 9.5.0 | 2.6.0 | 5 January 2030 | not tested |',
  '| 9.6.0 | 2.7.0 | 6 January 2030 |  |',
  '',
].join('\n');

test('isTested reads the table', () => {
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.4' }, TEXT), true, 'a row that passed');
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.5' }, TEXT), false, 'a row that failed');
  assert.equal(isTested({ vscode: '9.2.0', runtime: '2.3.4' }, TEXT), true, 'Result begins with passed, in any case');
  assert.equal(isTested({ vscode: '9.3.0', runtime: '2.4.0' }, TEXT), true, 'versions in backticks');
  assert.equal(isTested({ vscode: '9.4.0', runtime: '2.5.0' }, TEXT), false, '"did not pass" is not a pass');
  assert.equal(isTested({ vscode: '9.5.0', runtime: '2.6.0' }, TEXT), false, 'not tested');
  assert.equal(isTested({ vscode: '9.6.0', runtime: '2.7.0' }, TEXT), false, 'no result');
});

test('both versions have to match a row, exactly', () => {
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.4.0' }, TEXT), false, 'the VS Code of one row and the runtime of another');
  assert.equal(isTested({ vscode: '9.1', runtime: '2.3.4' }, TEXT), false, 'a prefix is not a match');
  assert.equal(isTested({ vscode: ' 9.1.0 ', runtime: '2.3.4\n' }, TEXT), true, 'spaces around a version are not part of it');
  assert.equal(isTested({ vscode: '', runtime: '' }, TEXT), false);
  assert.equal(isTested({ vscode: '9.1.0' }, TEXT), false, 'a missing runtime');
  assert.equal(isTested({ runtime: '2.3.4' }, TEXT), false, 'a missing VS Code');
  assert.equal(isTested({ vscode: null, runtime: undefined }, TEXT), false);
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.4' }, ''), false, 'an empty file');
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.4' }, undefined), false, 'no file');
});

test('a file with Windows line endings reads the same', () => {
  assert.equal(isTested({ vscode: '9.1.0', runtime: '2.3.4' }, TEXT.replaceAll('\n', '\r\n')), true);
});

test('the table the repository holds starts with no passed rows', () => {
  const text = fs.readFileSync(TABLE, 'utf8').replaceAll('\r\n', '\n');
  assert.match(text, /^<!-- docs\/copilot\/tested-versions\.md -->\n/);
  assert.ok(text.includes('| VS Code | Copilot runtime | Tested on | Result |'), 'the table\'s header');
  assert.doesNotMatch(text, /^\|.*\|\s*passed/im, 'nothing has been tested in VS Code yet');
  assert.equal(isTested({ vscode: '1.142.0', runtime: '1.0.101' }, text), false);
  assert.doesNotMatch(text, /\b(enhanced|improved|fixed)\b/i);
});
