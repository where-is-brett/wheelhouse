// tests/probes/97-desktop-builders/run.test.js
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FINDINGS, notesFor, selfReport, parentFields, prepareScratch, mergeFindings, desktopRoots, defaultScratch, hookCommand } from '../../../probes/97-desktop-builders/run.js';

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
  const lines = notesFor({}, 'notes/x.md').split('\n');
  assert.equal(lines[0], '<!-- notes/x.md -->');
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
  assert.match(JSON.stringify(settings.hooks.SessionStart), /probe-hook\.js/);
  assert.match(fs.readFileSync(path.join(dir, '.claude', 'probe-hook.js'), 'utf8'), /hook-ran\.txt/);
  assert.ok(fs.existsSync(path.join(dir, '.git')));
});

test('parentFields finds a parent-like field on the record that names the title, and ignores others', () => {
  const store = { id: 'a', title: 'probe-builder', parentSessionId: 'f1', other: { title: 'x', parent: 'zzz' } };
  assert.deepEqual(parentFields(store, 'probe-builder'), [{ field: 'parentSessionId', value: 'f1' }]);
  assert.deepEqual(parentFields({ title: 'probe-builder', id: 'a' }, 'probe-builder'), []);
});

test('parentFields reads one level into a parent-like object, such as spawnedFrom and startChain, plain values only', () => {
  const store = {
    title: 'probe-cwd',
    originCwd: 'C:/x',
    spawnedFrom: { sessionId: 'local_f1', sideSession: true, deep: { parent: 'no' }, gone: null },
    startChain: { firstSessionId: 'local_f1', depth: 1 },
    other: { parent: 'zzz' },
  };
  assert.deepEqual(parentFields(store, 'probe-cwd'), [
    { field: 'originCwd', value: 'C:/x' },
    { field: 'spawnedFrom.sessionId', value: 'local_f1' },
    { field: 'spawnedFrom.sideSession', value: true },
    { field: 'startChain.firstSessionId', value: 'local_f1' },
    { field: 'startChain.depth', value: 1 },
  ]);
  assert.deepEqual(parentFields({ title: 'probe-cwd', spawnedFrom: ['local_f1'] }, 'probe-cwd'), []);
});

test('mergeFindings keeps earlier keys and ignores unknown ones', () => {
  assert.deepEqual(mergeFindings({ entrypoint: 'a' }, { pluginLoad: 'b', bogus: 1 }), { entrypoint: 'a', pluginLoad: 'b' });
});

test('desktopRoots on the Mac is the Application Support folder', () => {
  assert.deepEqual(desktopRoots({ platform: 'darwin', homedir: '/Users/x' }), [path.join('/Users/x', 'Library', 'Application Support', 'Claude')]);
});

test('desktopRoots on Windows reads %APPDATA% and any Store install copy', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'probe97-win-'));
  const local = path.join(home, 'Local');
  fs.mkdirSync(path.join(local, 'Packages', 'Claude_abc123'), { recursive: true });
  fs.mkdirSync(path.join(local, 'Packages', 'Other_zzz'), { recursive: true });
  const roots = desktopRoots({ platform: 'win32', homedir: home, env: { APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: local } });
  assert.deepEqual(roots, [path.join(home, 'Roaming', 'Claude'), path.join(local, 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude')]);
});

test('desktopRoots on Windows falls back to the home when the variables are unset, and copes with no Packages folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'probe97-win-'));
  assert.deepEqual(desktopRoots({ platform: 'win32', homedir: home, env: {} }), [path.join(home, 'AppData', 'Roaming', 'Claude')]);
});

test('the default scratch folder is under the home, with no tilde', () => {
  const dir = defaultScratch('/home/u');
  assert.equal(dir, path.join('/home/u', '.wheelhouse-trials', 'desktop-probe'));
  assert.ok(!dir.includes('~'));
});

test('the hook command is a quoted node command with forward slashes on both platforms', () => {
  assert.equal(hookCommand('C:\\Users\\<user>\\My Folder\\scratch', 'win32'), 'node "C:/Users/<user>/My Folder/scratch/.claude/probe-hook.js"');
  assert.equal(hookCommand('/Users/x/my dir/scratch', 'darwin'), 'node "/Users/x/my dir/scratch/.claude/probe-hook.js"');
});

test('the hook script runs and leaves the marker, from a folder with a space in its name', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'probe97-')), 'with space');
  prepareScratch(dir);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const command = settings.hooks.SessionStart[0].hooks[0].command;
  assert.match(command, /^node "/);
  execFileSync(process.execPath, [command.slice(6, -1)], { cwd: os.tmpdir() });
  assert.match(fs.readFileSync(path.join(dir, '.probe', 'hook-ran.txt'), 'utf8'), /^\d{4}-\d\d-\d\dT/);
});
