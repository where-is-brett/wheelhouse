// tests/docs/checks-format.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const checksDir = fileURLToPath(new URL('../../docs/checks/', import.meta.url));
const headings = ['Question', 'Tested on', 'Method', 'Evidence', 'What it means for the design', 'Needs the director'];

function notes() {
  return fs.readdirSync(checksDir).filter((name) => /^\d\d-.+\.md$/.test(name));
}

test('every findings note has the required headings in order and a valid answer', () => {
  for (const name of notes()) {
    const text = fs.readFileSync(checksDir + name, 'utf8');
    const lines = text.split(/\r?\n/);
    assert.equal(lines[0], `<!-- docs/checks/${name} -->`, `${name}: path comment`);
    const answer = lines.find((line) => line.startsWith('**Answer:** '));
    assert.ok(answer, `${name}: no answer line`);
    assert.match(answer, /^\*\*Answer:\*\* (Yes|No|Partly|Deferred)\b/, `${name}: answer`);
    const found = lines.filter((line) => line.startsWith('## ')).map((line) => line.slice(3).trim());
    assert.deepEqual(found, headings, `${name}: headings`);
  }
});

test('the summary table lists every findings note', () => {
  const summary = fs.readFileSync(checksDir + 'README.md', 'utf8');
  for (const name of notes()) {
    assert.ok(summary.includes(name), `${name} missing from docs/checks/README.md`);
  }
});
