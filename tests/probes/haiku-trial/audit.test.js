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
  assert.ok(HAIKU.test('haiku-test'));
  assert.ok(!HAIKU.test('other-model'));
  assert.equal(PEEK_PATTERNS.length, 3);
});

test('a clean run passes', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [turn('haiku-test'), turn('haiku-test-b')]);
  assert.deepEqual(auditModels(asTranscripts(file)), { clean: true, offenders: [] });
});

test('a sonnet run is clean on sonnet and fails on haiku', () => {
  const dir = scratch();
  const file = write(path.join(dir, 's.jsonl'), [turn('claude-sonnet-4-5'), turn('claude-haiku-4-5')]);
  assert.deepEqual(auditModels(asTranscripts(file), { model: 'sonnet' }).offenders.map((o) => o.model), ['claude-haiku-4-5']);
  assert.deepEqual(auditModels(asTranscripts(file), { model: 'haiku' }).offenders.map((o) => o.model), ['claude-sonnet-4-5']);
});

test('a sonnet entry fails and names the session and role', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'feat-1.jsonl'), [turn('haiku-test'), turn('other-model')]);
  const result = auditModels(asTranscripts(file, 'feature', 'feat-1'));
  assert.equal(result.clean, false);
  assert.equal(result.offenders.length, 1);
  assert.equal(result.offenders[0].role, 'feature');
  assert.equal(result.offenders[0].session, 'feat-1');
  assert.equal(result.offenders[0].model, 'other-model');
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
    turn('haiku-test'),
  ]);
  assert.deepEqual(auditModels(asTranscripts(file)), { clean: true, offenders: [] });
});

test('audit counts repeated offences by model', () => {
  const dir = scratch();
  const file = write(path.join(dir, 'a.jsonl'), [turn('other-model-b'), turn('other-model-b'), turn('other-model')]);
  const { offenders } = auditModels(asTranscripts(file));
  assert.deepEqual(offenders.map((o) => [o.model, o.count]).sort(), [['other-model', 1], ['other-model-b', 2]]);
});

test('a call to the advisor tool inside a haiku turn fails the audit', () => {
  const dir = scratch();
  const advised = { type: 'assistant', message: { model: 'haiku-test', content: [{ type: 'server_tool_use', id: 'a1', name: 'advisor', input: {} }] } };
  const otherTool = { type: 'assistant', message: { model: 'haiku-test', content: [{ type: 'server_tool_use', id: 'w1', name: 'web_search', input: {} }] } };
  const file = write(path.join(dir, 'a.jsonl'), [turn('haiku-test'), advised, otherTool, advised]);
  const { clean, offenders } = auditModels(asTranscripts(file, 'setup', 's9'));
  assert.equal(clean, false);
  assert.deepEqual(offenders.map((o) => [o.role, o.session, o.model, o.count]), [['setup', 's9', 'advisor', 2]]);
});

test('audit skips a transcript file that cannot be read', () => {
  assert.deepEqual(auditModels(asTranscripts(path.join(scratch(), 'missing.jsonl'))), { clean: true, offenders: [] });
});

test('front desk transcripts are matched by cwd', () => {
  const home = scratch();
  const project = path.join(scratch(), 'trial-project');
  const other = path.join(scratch(), 'other-project');
  const mine = write(path.join(home, 'projects', 'slug-a', 'sess-a.jsonl'), [{ type: 'summary' }, { type: 'user', cwd: project }, turn('haiku-test')]);
  write(path.join(home, 'projects', 'slug-b', 'sess-b.jsonl'), [{ type: 'user', cwd: other }, turn('haiku-test')]);
  const sub = write(path.join(home, 'projects', 'slug-a', 'sess-a', 'subagents', 'agent-1.jsonl'), [{ type: 'user', cwd: project }, turn('haiku-test')]);
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

test('a worktree session is a feature, the project folder is the front desk, and a session found twice is counted once under the engine role', () => {
  const home = scratch();
  const engine = scratch();
  const project = path.join(scratch(), 'p');
  const desk = write(path.join(home, 'projects', 'slug', 'desk.jsonl'), [{ type: 'user', cwd: project }]);
  const feat = write(path.join(home, 'projects', 'slug', 'feat.jsonl'), [{ type: 'user', cwd: path.join(project, '.wheelhouse', 'worktrees', 'p1-import') }]);
  const fore = write(path.join(home, 'projects', 'slug', 'fore.jsonl'), [{ type: 'user', cwd: project }]);
  write(path.join(engine, 'sessions', 'fore.jsonl'), [{ type: 'system', env: { WHEELHOUSE_ROLE: 'foreman' } }]);
  const found = findTranscripts({ project, claudeHome: home, engineDir: engine });
  assert.equal(found.length, 3, 'one entry per session');
  const roleOf = (session) => found.find((t) => t.session === session)?.role;
  assert.equal(roleOf('desk'), 'front-desk');
  assert.equal(roleOf('feat'), 'feature');
  assert.equal(roleOf('fore'), 'foreman');
  assert.ok(desk && feat && fore);
});

test('engine transcripts take their role from the WHEELHOUSE_ROLE record or the folder name', () => {
  const home = scratch();
  const engine = scratch();
  const project = path.join(scratch(), 'p');
  const byRecord = write(path.join(engine, 'sessions', 'one.jsonl'), [{ type: 'system', env: { WHEELHOUSE_ROLE: 'foreman' } }, turn('haiku-test')]);
  const byFolder = write(path.join(engine, 'feature', 'two.jsonl'), [turn('haiku-test')]);
  const why = write(path.join(engine, 'why', 'three.jsonl'), [turn('haiku-test')]);
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
    { type: 'assistant', message: { model: 'haiku-test', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat ../probes/haiku-trial/held-back/held-back.js' } }] } },
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
    { type: 'assistant', message: { model: 'haiku-test', content: [{ type: 'text', text: 'I will not open the held-back folder or reference-app.' }] } },
    'not json',
  ]);
  assert.deepEqual(auditPeek(asTranscripts(file)), { clean: true, hits: [] });
});

test('a session in the front desk\'s worktree folder (.claude/worktrees/<work>) is a feature session, and one in the folder itself is not', () => {
  const home = scratch();
  const project = path.join(scratch(), 'trial-project');
  const feature = write(path.join(home, 'projects', 'slug', 'f.jsonl'), [{ type: 'user', cwd: path.join(project, '.claude', 'worktrees', 'import-csv') }, turn('haiku-test')]);
  const deeper = write(path.join(home, 'projects', 'slug', 'g.jsonl'), [{ type: 'user', cwd: path.join(project, '.claude', 'worktrees', 'export-year', 'src') }, turn('haiku-test')]);
  const folder = write(path.join(home, 'projects', 'slug', 'h.jsonl'), [{ type: 'user', cwd: path.join(project, '.claude', 'worktrees') }, turn('haiku-test')]);
  const roles = Object.fromEntries(findTranscripts({ project, claudeHome: home }).map((t) => [t.file, t.role]));
  assert.equal(roles[feature], 'feature');
  assert.equal(roles[deeper], 'feature');
  assert.equal(roles[folder], 'front-desk');
});

test('a session in the project folder that records its own role (the foreman) is labelled by it', () => {
  const home = scratch();
  const project = path.join(scratch(), 'trial-project');
  const foreman = write(path.join(home, 'projects', 'slug', 'fm.jsonl'), [{ type: 'user', cwd: project, message: { content: 'env WHEELHOUSE_ROLE=foreman WHEELHOUSE_SESSION=foreman-x' } }, turn('haiku-test')]);
  const desk = write(path.join(home, 'projects', 'slug', 'fd.jsonl'), [{ type: 'user', cwd: project, message: { content: 'This is the First Mate.' } }, turn('haiku-test')]);
  const roles = Object.fromEntries(findTranscripts({ project, claudeHome: home }).map((t) => [t.file, t.role]));
  assert.equal(roles[foreman], 'foreman');
  assert.equal(roles[desk], 'front-desk');
});
