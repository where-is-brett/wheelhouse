// tests/probes/haiku-trial/results.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFolder, writeRaw, writeSummary, LABELS } from '../../../probes/haiku-trial/results.js';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-results-'));

const rows = [
  { id: 1, path: 'Setup', pass: true, evidence: 'fine' },
  { id: 2, path: 'Front desk', pass: false, evidence: 'reply too long' },
  { id: 3, path: 'Intake', pass: false, evidence: 'wrong lane' },
  { id: 4, path: 'Quick lane', pass: null, evidence: 'not run' },
];
const score = { total: 82, parts: { heldBack: 36, reconcile: 15, acceptance: 12, ownTests: 12, a11y: 8, health: 5 }, pass: true, why: [] };
const audit = { models: { clean: true, offenders: [] }, peek: { clean: true, hits: [] } };
const usage = { byRole: { feature: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 } }, total: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 } };

test('runFolder is under .wheelhouse-trials', () => {
  assert.equal(runFolder('2026-11-08', '/home/x'), path.join('/home/x', '.wheelhouse-trials', 'haiku-2026-11-08'));
  assert.match(runFolder('2026-11-08'), /\.wheelhouse-trials[\\/]haiku-2026-11-08$/);
  assert.deepEqual(LABELS, ['kit fault', 'Wheelhouse fault', 'Haiku floor']);
});

test('writeSummary has the six sections and labels each failure', () => {
  const dir = scratch();
  const file = path.join(dir, 'docs', 'trials', '2026-11-08-haiku-trial-results.md');
  const md = writeSummary({ file, date: '2026-11-08', rows, score, audit, usage, labels: { 2: 'Haiku floor', 3: 'kit fault' }, verdict: 'A' });
  for (const heading of ['Result', 'Score', 'Paths', 'Model audit', 'Usage', "What's next"]) assert.match(md, new RegExp(`^## ${heading}$`, 'm'));
  assert.ok(md.startsWith('<!-- docs/trials/2026-11-08-haiku-trial-results.md -->'));
  assert.match(md, /8 November 2026/);
  assert.match(md, /\| 2 \| Front desk \| fail \| Haiku floor \|/);
  assert.match(md, /\| 3 \| Intake \| fail \| kit fault \|/);
  assert.match(md, /\| 1 \| Setup \| pass \| /);
  assert.match(md, /\| 4 \| Quick lane \| not covered \| /);
  assert.equal(fs.readFileSync(file, 'utf8'), md);
});

test('writeSummary shows a failure with no label as still to sort', () => {
  const dir = scratch();
  const md = writeSummary({ file: path.join(dir, 's.md'), date: '2026-11-08', rows, score, audit, usage, labels: {}, verdict: 'A' });
  assert.match(md, /\| 2 \| Front desk \| fail \| to sort \|/);
});

test('writeSummary leaves out transcript text and paths outside the repository', () => {
  const dir = scratch();
  const dirty = rows.map((r) => ({ ...r, evidence: `${r.evidence} see /Users/someone/x and the line "I will now read the held-back folder"` }));
  const offending = { models: { clean: false, offenders: [{ file: '/Users/someone/.claude/projects/x/s.jsonl', role: 'feature', session: 's1', model: 'other-model', count: 3 }] }, peek: { clean: false, hits: [{ file: '/Users/someone/y.jsonl', role: 'builder', tool: 'Bash', text: 'cat probes/haiku-trial/held-back/x' }] } };
  const md = writeSummary({ file: path.join(dir, 's.md'), date: '2026-11-08', rows: dirty, score, audit: offending, usage, labels: {}, verdict: 'B, see /Users/someone/notes' });
  assert.ok(!md.includes('/Users/'));
  assert.ok(!md.includes('someone'));
  assert.ok(!md.includes('I will now read'));
  assert.ok(!md.includes('cat probes'));
  assert.match(md, /feature/);
  assert.match(md, /other-model/);
});

test('writeRaw copies transcripts and writes events, panes, signals and usage', () => {
  const dir = scratch();
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  const a = path.join(src, 'a.jsonl');
  fs.writeFileSync(a, '{"type":"assistant"}\n');
  const folder = path.join(dir, 'out');
  writeRaw({
    folder,
    transcripts: [{ file: a, role: 'front-desk', session: 'a' }],
    events: [{ id: 'e1', kind: 'work' }, { id: 'e2', kind: 'card' }],
    panes: { 'front desk': ['one', 'two'] },
    runLog: [{ at: 'x', step: 's', note: 'n' }],
    usage,
  });
  const files = (d) => fs.readdirSync(path.join(folder, d));
  assert.equal(files('transcripts').length >= 1, true);
  const copied = path.join(folder, 'transcripts', fs.readdirSync(path.join(folder, 'transcripts'))[0]);
  assert.ok(fs.statSync(copied).isDirectory() || fs.statSync(copied).isFile());
  assert.equal(fs.readFileSync(path.join(folder, 'events.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(files('panes').length, 1);
  assert.match(fs.readFileSync(path.join(folder, 'panes', files('panes')[0]), 'utf8'), /one\ntwo/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'signals.jsonl'), 'utf8').trim()).step, 's');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'usage.json'), 'utf8')).total.input, 10);
});
