// tests/probes/haiku-trial/audit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HAIKU, findTranscripts, auditModels, auditPeek, PEEK_PATTERNS } from '../../../probes/haiku-trial/audit.js';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-audit-'));
const write = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
};
const turn = (model, extra = {}) => ({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'ok' }], ...extra } });
const asTranscripts = (file, role = 'feature', session = 's1') => [{ file, role, session }];

test('HAIKU matches Haiku model names only', () => {
  assert.ok(HAIKU.test('claude-haiku-4-5'));
  assert.ok(!HAIKU.test('claude-sonnet-4-5'));
  assert.equal(PEEK_PATTERNS.length, 3);
});

test('a clean run passes', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [turn('claude-haiku-4-5'), turn('claude-haiku-4-5-20251001')]);
  assert.deepEqual(auditModels(asTranscripts(file)), { clean: true, offenders: [] });
});

test('a sonnet entry fails and names the session and role', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'feat-1.jsonl'), [turn('claude-haiku-4-5'), turn('claude-sonnet-4-5')]);
  const result = auditModels(asTranscripts(file, 'feature', 'feat-1'));
  assert.equal(result.clean, false);
  assert.equal(result.offenders.length, 1);
  assert.equal(result.offenders[0].role, 'feature');
  assert.equal(result.offenders[0].session, 'feat-1');
  assert.equal(result.offenders[0].model, 'claude-sonnet-4-5');
  assert.equal(result.offenders[0].count, 1);
});

test('audit skips broken lines and synthetic entries', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [
    'not json',
    '',
    turn('<synthetic>'),
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { content: [] } },
    turn('claude-haiku-4-5'),
  ]);
  assert.deepEqual(auditModels(asTranscripts(file)), { clean: true, offenders: [] });
});

test('audit counts repeated offences by model', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [turn('claude-opus-4'), turn('claude-opus-4'), turn('claude-sonnet-4-5')]);
  const { offenders } = auditModels(asTranscripts(file));
  assert.deepEqual(offenders.map((o) => [o.model, o.count]).sort(), [['claude-opus-4', 2], ['claude-sonnet-4-5', 1]]);
});

test('audit skips a transcript file that cannot be read', () => {
  assert.deepEqual(auditModels(asTranscripts(path.join(scratch(), 'missing.jsonl'))), { clean: true, offenders: [] });
});

test('front desk transcripts are matched by cwd', () => {
  const home = scratch();
  const project = path.join(scratch(), 'trial-project');
  const other = path.join(scratch(), 'other-project');
  const mine = write(path.join(home, 'projects', 'slug-a', 'sess-a.jsonl'), [{ type: 'summary' }, { type: 'user', cwd: project }, turn('claude-haiku-4-5')]);
  write(path.join(home, 'projects', 'slug-b', 'sess-b.jsonl'), [{ type: 'user', cwd: other }, turn('claude-haiku-4-5')]);
  const sub = write(path.join(home, 'projects', 'slug-a', 'sess-a', 'subagents', 'agent-1.jsonl'), [{ type: 'user', cwd: project }, turn('claude-haiku-4-5')]);
  const found = findTranscripts({ project, claudeHome: home });
  assert.deepEqual(found.map((t) => t.file).sort(), [mine, sub].sort());
  assert.ok(found.every((t) => t.role === 'front-desk'));
  assert.equal(found.find((t) => t.file === mine).session, 'sess-a');
});

test('a cwd inside the project folder counts as the project', () => {
  const home = scratch();
  const project = path.join(scratch(), 'trial-project');
  const file = write(path.join(home, 'projects', 'slug', 'w.jsonl'), [{ type: 'user', cwd: path.join(project, '.worktrees', 'x') }]);
  assert.deepEqual(findTranscripts({ project, claudeHome: home }).map((t) => t.file), [file]);
  const sibling = `${project}-two`;
  write(path.join(home, 'projects', 'slug', 'v.jsonl'), [{ type: 'user', cwd: sibling }]);
  assert.equal(findTranscripts({ project, claudeHome: home }).length, 1);
});

test('engine transcripts take their role from the WHEELHOUSE_ROLE record or the folder name', () => {
  const home = scratch();
  const engine = scratch();
  const project = path.join(scratch(), 'p');
  const byRecord = write(path.join(engine, 'sessions', 'one.jsonl'), [{ type: 'system', env: { WHEELHOUSE_ROLE: 'foreman' } }, turn('claude-haiku-4-5')]);
  const byFolder = write(path.join(engine, 'feature', 'two.jsonl'), [turn('claude-haiku-4-5')]);
  const why = write(path.join(engine, 'why', 'three.jsonl'), [turn('claude-haiku-4-5')]);
  const found = findTranscripts({ project, claudeHome: home, engineDir: engine });
  const roleOf = (f) => found.find((t) => t.file === f)?.role;
  assert.equal(roleOf(byRecord), 'foreman');
  assert.equal(roleOf(byFolder), 'feature');
  assert.equal(roleOf(why), 'why');
});

test('findTranscripts copes with a missing claude home and engine folder', () => {
  const nowhere = path.join(scratch(), 'nope');
  assert.deepEqual(findTranscripts({ project: scratch(), claudeHome: nowhere, engineDir: nowhere }), []);
});

test('peek flags a Bash command naming the held-back folder', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [
    { type: 'assistant', message: { model: 'claude-haiku-4-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat ../probes/haiku-trial/held-back/held-back.js' } }] } },
  ]);
  const result = auditPeek(asTranscripts(file));
  assert.equal(result.clean, false);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].tool, 'Bash');
  assert.equal(result.hits[0].role, 'feature');
  assert.match(result.hits[0].text, /held-back/);
});

test('peek flags a Read of the reference app', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/reference-app/server.js' } }] } },
  ]);
  assert.equal(auditPeek(asTranscripts(file)).hits[0].tool, 'Read');
});

test('peek ignores the word in plain assistant text', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [
    { type: 'assistant', message: { model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'I will not open the held-back folder or reference-app.' }] } },
    'not json',
  ]);
  assert.deepEqual(auditPeek(asTranscripts(file)), { clean: true, hits: [] });
});
