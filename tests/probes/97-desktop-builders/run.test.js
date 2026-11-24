// tests/probes/97-desktop-builders/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FINDINGS, notesFor, selfReport, parentFields, prepareScratch, mergeFindings } from '../../../probes/97-desktop-builders/run.js';

test('every finding is named in the note, and a missing one is written "not tried"', () => {
  const note = notesFor({});
  for (const key of FINDINGS) assert.match(note, new RegExp(`\`${key}\``));
  assert.equal((note.match(/not tried/g) ?? []).length, FINDINGS.length);
});

test('nesting is reported plainly either way', () => {
  const no = notesFor({ nesting: { nested: false, how: null, sidebar: 'top-level row' } });
  assert.match(no, /Desktop did not nest/);
  assert.doesNotMatch(no, /nested under the foreman: yes/);
  const yes = notesFor({ nesting: { nested: true, how: 'parent_session_id', sidebar: 'child row' } });
  assert.match(yes, /nested under the foreman: yes, by `parent_session_id`/);
});

test('the note starts with its path comment and the date as day month year', () => {
  const lines = notesFor({}).split('\n');
  assert.equal(lines[0], '<!-- docs/specs/notes/2026-11-24-desktop-probe.md -->');
  assert.match(notesFor({}), /24 November 2026/);
});

test('a recorded finding is written with its value, not "not tried"', () => {
  const note = notesFor({ entrypoint: 'claude-desktop' });
  assert.match(note, /`entrypoint`: claude-desktop/);
  assert.equal((note.match(/not tried/g) ?? []).length, FINDINGS.length - 1);
});

test('selfReport reads cwd, branch, entrypoint and the hook marker from what the session sees', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe97-'));
  prepareScratch(dir);
  const bare = selfReport({ cwd: dir, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } });
  assert.equal(bare.entrypoint, 'claude-desktop');
  assert.equal(bare.cwd, fs.realpathSync(dir));
  assert.equal(bare.hookRan, false);
  fs.writeFileSync(path.join(dir, '.probe', 'hook-ran.txt'), 'x\n');
  assert.equal(selfReport({ cwd: dir, env: {} }).hookRan, true);
  assert.equal(selfReport({ cwd: dir, env: {} }).entrypoint, null);
});

test('prepareScratch makes a git project whose session-start hook leaves a marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe97-'));
  prepareScratch(dir);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.match(JSON.stringify(settings.hooks.SessionStart), /hook-ran\.txt/);
  assert.ok(fs.existsSync(path.join(dir, '.git')));
});

test('parentFields finds a parent-like field on the record that names the title, and ignores others', () => {
  const store = { id: 'a', title: 'probe-builder', parentSessionId: 'f1', other: { title: 'x', parent: 'zzz' } };
  assert.deepEqual(parentFields(store, 'probe-builder'), [{ field: 'parentSessionId', value: 'f1' }]);
  assert.deepEqual(parentFields({ title: 'probe-builder', id: 'a' }, 'probe-builder'), []);
});

test('mergeFindings keeps earlier keys and ignores unknown ones', () => {
  assert.deepEqual(mergeFindings({ entrypoint: 'a' }, { pluginLoad: 'b', bogus: 1 }), { entrypoint: 'a', pluginLoad: 'b' });
});
