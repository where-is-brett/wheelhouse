// tests/skills/front-matter.test.js
// Every playbook, agent and command file's front matter reads as YAML. A plain (unquoted) value holding ": " or
// " #", or ending in ":", is not valid YAML: Claude Code reads the file anyway, but Copilot logs it as broken and
// may drop the description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FOLDERS = ['skills', 'agents', 'commands', path.join('adapters', 'copilot', 'first-mate'), path.join('adapters', 'copilot', 'home')];

function markdownFiles(folder) {
  const found = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

// The front matter's lines, or null for a file that has none.
function frontMatter(file) {
  const text = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  return m === null ? null : m[1].split('\n');
}

// Whether one `key: value` line's value is a plain scalar YAML can't read.
function badPlainValue(line) {
  const m = /^\s*[A-Za-z0-9_-]+:[ \t]+(.*)$/.exec(line);
  if (m === null) return false;
  const value = m[1].trim();
  if (value === '' || /^["'|>[{&*!]/.test(value)) return false;
  return /: /.test(value) || / #/.test(value) || value.endsWith(':');
}

test('every front matter value that holds ": " is quoted', () => {
  const files = FOLDERS.flatMap((folder) => markdownFiles(path.join(ROOT, folder)));
  let checked = 0;
  for (const file of files) {
    const lines = frontMatter(file);
    if (lines === null) continue;
    checked += 1;
    for (const line of lines) assert.ok(!badPlainValue(line), `${path.relative(ROOT, file)}: ${line}`);
  }
  assert.ok(checked > 10, `front matter found in ${checked} files`);
});

test('the check finds an unquoted ": " and passes a quoted one', () => {
  assert.equal(badPlainValue('description: For a step: guidance'), true);
  assert.equal(badPlainValue('description: "For a step: guidance"'), false);
  assert.equal(badPlainValue('description: plain words'), false);
  assert.equal(badPlainValue('description: >'), false);
});
