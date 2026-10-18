// tests/probes/29-hold/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge } from '../../../probes/29-hold/run.js';

function events(calls) {
  return [
    { type: 'assistant', message: { content: calls.map(([name], i) => ({ type: 'tool_use', id: `t${i}`, name, input: {} })) } },
    {
      type: 'user',
      message: {
        content: calls.map(([, result], i) => ({
          type: 'tool_result',
          tool_use_id: `t${i}`,
          is_error: result.startsWith('refused'),
          content: result,
        })),
      },
    },
  ];
}

function project({ edited = false, written = false, shellRan = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hold-run-'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), edited ? 'after\n' : 'before\n');
  if (written) fs.writeFileSync(path.join(dir, 'new.txt'), 'written');
  if (shellRan) fs.mkdirSync(path.join(dir, 'bash-ran'));
  return dir;
}

const held = [['Read', 'before'], ['Edit', 'refused: probe: held'], ['Write', 'refused: probe: held'], ['Bash', 'refused: probe: held']];
const free = [['Read', 'before'], ['Edit', 'done'], ['Write', 'done'], ['Bash', '']];

test('held passes when only the Read ran', () => {
  assert.equal(judge({ events: events(held), dir: project(), held: true }).pass, true);
});

test('held fails when a refused call still left a file behind', () => {
  assert.equal(judge({ events: events(held), dir: project({ written: true }), held: true }).pass, false);
});

test('held fails when a call was refused for another reason', () => {
  const other = held.map(([name, result]) => [name, result.replace('probe: held', 'no permission')]);
  assert.equal(judge({ events: events(other), dir: project(), held: true }).pass, false);
});

test('held fails when the session never tried one of the four', () => {
  const result = judge({ events: events(held.slice(0, 3)), dir: project(), held: true });
  assert.equal(result.pass, false);
  assert.match(result.why, /never tried the shell command/);
});

test('free passes when all four ran and left their files', () => {
  assert.equal(judge({ events: events(free), dir: project({ edited: true, written: true, shellRan: true }), held: false }).pass, true);
});

test('free fails when the hook refused a call', () => {
  assert.equal(judge({ events: events(held), dir: project(), held: false }).pass, false);
});

test('free fails when a call reported done but left nothing on disk', () => {
  assert.equal(judge({ events: events(free), dir: project({ edited: true, written: true }), held: false }).pass, false);
});
