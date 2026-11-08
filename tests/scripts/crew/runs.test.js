// tests/scripts/crew/runs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, findTranscript, findSubagents, readTail } from '../../../scripts/crew/runs.js';

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
  // Where traversal from projects/a/ would land: projects/x.jsonl, and projects/a/x.jsonl for a/x.
  fs.writeFileSync(path.join(dir, 'projects', 'x.jsonl'), '{}\n');
  fs.mkdirSync(path.join(dir, 'projects', 'a', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'a', 'a', 'x.jsonl'), '{}\n');
  assert.equal(findTranscript({ sessionId: '../x', env }), null);
  assert.equal(findTranscript({ sessionId: 'a/x', env }), null);
  assert.equal(findTranscript({ sessionId: 'a\\x', env }), null);
  assert.equal(findTranscript({ sessionId: '', env }), null);
  assert.equal(findTranscript({ sessionId: '..', env }), null);
  assert.equal(findTranscript({ sessionId: '.', env }), null);
});

function ev(n) {
  return JSON.stringify({ type: 'assistant', n });
}

test('readTail reads only the tail', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  const lines = [];
  let size = 0;
  for (let n = 0; size < 1024 * 1024; n++) {
    const line = ev(n);
    lines.push(line);
    size += line.length + 1;
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const events = readTail(file, { max: 1024 });
  assert.ok(events.length > 0);
  // The oldest event that may appear starts within the last 1024 bytes.
  let tailBytes = 0;
  let firstAllowed = lines.length;
  while (firstAllowed > 0 && tailBytes + lines[firstAllowed - 1].length + 1 <= 1024) {
    firstAllowed--;
    tailBytes += lines[firstAllowed].length + 1;
  }
  for (const e of events) assert.ok(e.n >= firstAllowed, `event ${e.n} is older than the tail`);
  assert.equal(events[events.length - 1].n, lines.length - 1);
  assert.ok(events.length < 100);
});

test('readTail skips a half-written last line', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\n${ev(2)}\n{"type":"assist`);
  assert.deepEqual(readTail(file).map((e) => e.n), [1, 2]);
});

test('readTail skips a line that is not JSON', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\nnot json at all\n${ev(2)}\n`);
  assert.deepEqual(readTail(file).map((e) => e.n), [1, 2]);
});

test('readTail gives [] for a missing file', () => {
  const { dir } = fakeConfig();
  assert.deepEqual(readTail(path.join(dir, 'nope.jsonl')), []);
});

test('readTail gives [] for a link', () => {
  const { dir } = fakeConfig();
  const real = path.join(dir, 'real.jsonl');
  fs.writeFileSync(real, `${ev(1)}\n`);
  const link = path.join(dir, 'link.jsonl');
  fs.symlinkSync(real, link);
  assert.deepEqual(readTail(link), []);
});

test('readTail does not change the file', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\n${ev(2)}\n`);
  fs.utimesSync(file, new Date(1000 * 1000), new Date(1000 * 1000));
  const before = fs.statSync(file);
  readTail(file);
  const after = fs.statSync(file);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('subagents: a linked subagents directory is refused', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(path.join(proj, 'x'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const elsewhere = path.join(dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'agent-q.jsonl'), '{}\n');
  fs.symlinkSync(elsewhere, path.join(proj, 'x', 'subagents'));
  const file = findTranscript({ sessionId: 'x', env });
  assert.deepEqual(findSubagents(file), []);
});

test('subagents: a linked session directory is refused', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const elsewhere = path.join(dir, 'elsewhere');
  fs.mkdirSync(path.join(elsewhere, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(elsewhere, 'subagents', 'agent-q.jsonl'), '{}\n');
  fs.symlinkSync(elsewhere, path.join(proj, 'x'));
  const file = findTranscript({ sessionId: 'x', env });
  assert.deepEqual(findSubagents(file), []);
});

test('readTail skips parsed lines that are not plain objects', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\n1\nnull\n"s"\n[]\n${ev(2)}\n`);
  assert.deepEqual(readTail(file).map((e) => e.n), [1, 2]);
});
