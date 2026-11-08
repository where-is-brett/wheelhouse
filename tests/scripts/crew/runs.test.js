// tests/scripts/crew/runs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, findTranscript, findSubagents } from '../../../scripts/crew/runs.js';

function fakeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-runs-'));
  return { dir, env: { CLAUDE_CONFIG_DIR: dir } };
}

test('finds a transcript under any project folder', () => {
  const { dir, env } = fakeConfig();
  fs.mkdirSync(path.join(dir, 'projects', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'a', 'x.jsonl'), '{}\n');
  const found = findTranscript({ sessionId: 'x', env });
  assert.ok(found.endsWith(path.join('projects', 'a', 'x.jsonl')));
});

test('honours CLAUDE_CONFIG_DIR', () => {
  const { dir, env } = fakeConfig();
  assert.equal(configDir(env), dir);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'a'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'a', 'x.jsonl'), '{}\n');
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    assert.equal(findTranscript({ sessionId: 'x', env }), null);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
  }
});

test('returns null for an unknown session', () => {
  const { env } = fakeConfig();
  assert.equal(findTranscript({ sessionId: 'nope', env }), null);
});

test('refuses a link', () => {
  const { dir, env } = fakeConfig();
  fs.mkdirSync(path.join(dir, 'projects', 'a'), { recursive: true });
  const real = path.join(dir, 'real.jsonl');
  fs.writeFileSync(real, '{}\n');
  fs.symlinkSync(real, path.join(dir, 'projects', 'a', 'x.jsonl'));
  assert.equal(findTranscript({ sessionId: 'x', env }), null);
});

test('lists subagents oldest first', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(path.join(proj, 'x', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const newer = path.join(proj, 'x', 'subagents', 'agent-aaa.jsonl');
  const older = path.join(proj, 'x', 'subagents', 'agent-zzz.jsonl');
  fs.writeFileSync(newer, '{}\n');
  fs.writeFileSync(older, '{}\n');
  fs.utimesSync(older, new Date(1000 * 1000), new Date(1000 * 1000));
  fs.utimesSync(newer, new Date(2000 * 1000), new Date(2000 * 1000));
  const file = findTranscript({ sessionId: 'x', env });
  const subs = findSubagents(file);
  assert.deepEqual(subs.map((s) => s.agentId), ['zzz', 'aaa']);
  assert.equal(subs[0].file, older);
});

test('subagents: none when the folder is missing, links left out', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const file = findTranscript({ sessionId: 'x', env });
  assert.deepEqual(findSubagents(file), []);
  fs.mkdirSync(path.join(proj, 'x', 'subagents'), { recursive: true });
  const real = path.join(dir, 'real.jsonl');
  fs.writeFileSync(real, '{}\n');
  fs.symlinkSync(real, path.join(proj, 'x', 'subagents', 'agent-l.jsonl'));
  assert.deepEqual(findSubagents(file), []);
});

test('rejects a session id with a path separator or ..', () => {
  const { dir, env } = fakeConfig();
  fs.mkdirSync(path.join(dir, 'projects', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.jsonl'), '{}\n');
  assert.equal(findTranscript({ sessionId: '../x', env }), null);
  assert.equal(findTranscript({ sessionId: 'a/x', env }), null);
  assert.equal(findTranscript({ sessionId: 'a\\x', env }), null);
  assert.equal(findTranscript({ sessionId: '', env }), null);
});
