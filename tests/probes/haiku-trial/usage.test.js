// tests/probes/haiku-trial/usage.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readUsage, usageNote } from '../../../probes/haiku-trial/usage.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-usage-'));
const write = (name, lines) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
};
const turn = (usage) => ({ type: 'assistant', message: { model: 'haiku-test', usage } });

test('usage sums by role', () => {
  const a = write('a.jsonl', [
    turn({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }),
    'not json',
    turn({ input_tokens: 1, output_tokens: 2 }),
    { type: 'user', message: { usage: { input_tokens: 999 } } },
  ]);
  const b = write('b.jsonl', [turn({ input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 6 })]);
  const c = write('c.jsonl', [turn({ input_tokens: 2, output_tokens: 2 })]);
  const usage = readUsage([
    { file: a, role: 'feature', session: 'a' },
    { file: b, role: 'foreman', session: 'b' },
    { file: c, role: 'feature', session: 'c' },
  ]);
  assert.deepEqual(usage.byRole.feature, { input: 13, output: 9, cacheRead: 100, cacheWrite: 20 });
  assert.deepEqual(usage.byRole.foreman, { input: 7, output: 3, cacheRead: 4, cacheWrite: 6 });
  assert.deepEqual(usage.total, { input: 20, output: 12, cacheRead: 104, cacheWrite: 26 });
});

test('usage of nothing is zero', () => {
  assert.deepEqual(readUsage([]), { byRole: {}, total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
});

test('usageNote gives one line per role', () => {
  const note = usageNote({
    byRole: { foreman: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, feature: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8 } },
    total: { input: 6, output: 8, cacheRead: 10, cacheWrite: 12 },
  });
  const lines = note.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^foreman: .*input 1.*output 2.*cache read 3.*cache write 4/);
});
