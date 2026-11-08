// tests/probes/haiku-trial/signals.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, KINDS, FULL_ONLY, PROOF_HEADINGS, checkAll, gatherContext } from '../../../probes/haiku-trial/signals.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const row = (id) => ROWS.find((r) => r.id === id);

let counter = 0;
const ev = (kind, data, at, extra = {}) => ({ v: 1, id: `e${(counter += 1)}`, at, kind, data, ...extra });
const ctxWith = (over = {}) => ({
  events: [], views: { settings: {} }, prs: [], transcripts: [], audit: { models: { clean: true, offenders: [] }, peek: { clean: true, hits: [] } },
  panes: {}, runLog: [], incidents: [], pieces: {}, scores: null, previews: 'vercel', ...over,
});
const pr = (number, over = {}) => ({ number, title: `pr ${number}`, head: `feature/p${number}`, body: '', mergedAt: null, mergeSha: null, commits: [], statuses: [], ...over });

test('there are 45 rows, numbered 1 to 45, each with a check', () => {
  assert.equal(ROWS.length, 45);
  ROWS.forEach((r, i) => {
    assert.equal(r.id, i + 1);
    assert.equal(typeof r.check, 'function');
    assert.equal(typeof r.path, 'string');
    assert.ok(Array.isArray(r.pieces));
    assert.equal(typeof r.smoke, 'boolean');
  });
});

test('the smoke rows are exactly the listed ones', () => {
  const smoke = ROWS.filter((r) => r.smoke).map((r) => r.id);
  assert.deepEqual(smoke, [1, 2, 3, 4, 5, 7, 8, 9, 10, 13, 16, 17, 18, 19, 21, 22, 25, 26, 27, 28, 29, 31, 33, 35, 43, 44, 45]);
  assert.deepEqual(FULL_ONLY, [34, 41]);
});

test('every kind a row reads is written somewhere in scripts', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(root, 'scripts'));
  const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const kind of Object.values(KINDS)) assert.ok(text.includes(`'${kind}'`), `no script writes '${kind}'`);
});

const workCtx = (merged) => ctxWith({
  pieces: { P6: { change: 'quick-ci', prs: [6] } },
  prs: [pr(6)],
  events: [ev('work', { id: 'quick-ci', title: 'ci', lane: 'quick', visible: false, dependsOn: [] }, '2026-11-08T01:00:00Z'), ev('self-merged', { pr: 6, commit: 'a'.repeat(40), reason: merged, work: 'quick-ci' }, '2026-11-08T02:00:00Z')],
});

test('row 29 passes on a self-merge for internal and fails on another reason', () => {
  assert.equal(row(29).check(workCtx('internal')).pass, true);
  const bad = row(29).check(workCtx('decision-records'));
  assert.equal(bad.pass, false);
  assert.match(bad.evidence, /decision-records/);
});

const visibleCtx = (selfMerged) => {
  const pieces = {};
  const prs = [];
  const events = [];
  [['P1', 1], ['P2', 2], ['P3', 3], ['P7', 7]].forEach(([id, n]) => {
    pieces[id] = { change: `w-${n}`, prs: [n] };
    prs.push(pr(n, { mergedAt: '2026-11-08T05:00:00Z' }));
    const card = ev('card', { question: 'Approve?', header: 'Approve', options: ['Approve'], kind: 'approval', level: 3, line: `Approve pull request #${n} at commit abcdef123456` }, '2026-11-08T03:00:00Z');
    events.push(card, ev('card-answer', { card: card.id, label: 'Approve' }, '2026-11-08T04:00:00Z'));
  });
  if (selfMerged) events.push(ev('self-merged', { pr: 2, commit: 'b'.repeat(40), reason: 'internal', work: 'w-2' }, '2026-11-08T04:30:00Z'));
  return ctxWith({ pieces, prs, events });
};

test('row 28 fails when a visible piece self-merged', () => {
  assert.equal(row(28).check(visibleCtx(false)).pass, true);
  const bad = row(28).check(visibleCtx(true));
  assert.equal(bad.pass, false);
  assert.match(bad.evidence, /P2/);
});

const decisionCtx = ({ mergedAt = null, answerLabel = 'B', where = 'chat' } = {}) => ctxWith({
  pieces: { P4: { change: 'move-tx', prs: [4] } },
  prs: [pr(4, {
    mergedAt,
    statuses: [{ context: 'wheelhouse/decision', description: 'Waiting on decision 1', state: 'pending' }, { context: 'wheelhouse/decision', description: 'No decision waiting', state: 'success' }],
  })],
  events: [ev('decision-answer', { question: 'q', n: 1, label: answerLabel, option: 'x', words: '', where }, '2026-11-08T02:00:00Z')],
});

test('row 16 needs the waiting status and no merge', () => {
  assert.equal(row(16).check(decisionCtx()).pass, true);
  const merged = row(16).check(decisionCtx({ mergedAt: '2026-11-08T01:00:00Z' }));
  assert.equal(merged.pass, false);
  assert.match(merged.evidence, /merge/i);
  const none = decisionCtx();
  none.prs[0].statuses = [];
  assert.equal(row(16).check(none).pass, false);
});

test('row 18 needs where chat and label B', () => {
  assert.equal(row(18).check(decisionCtx({ mergedAt: '2026-11-08T03:00:00Z' })).pass, true);
  assert.equal(row(18).check(decisionCtx({ mergedAt: '2026-11-08T03:00:00Z', where: 'card' })).pass, false);
  assert.equal(row(18).check(decisionCtx({ mergedAt: '2026-11-08T03:00:00Z', answerLabel: 'A' })).pass, false);
  assert.equal(row(18).check(decisionCtx({ mergedAt: null })).pass, false);
});

test('row 25 lists the missing headings', () => {
  const body = PROOF_HEADINGS.filter((h) => h !== 'Decisions followed').map((h) => `## ${h}\ntext`).join('\n');
  const result = row(25).check(ctxWith({ prs: [pr(1, { mergedAt: '2026-11-08T01:00:00Z', body })] }));
  assert.equal(result.pass, false);
  assert.match(result.evidence, /Decisions followed/);
  const full = PROOF_HEADINGS.map((h) => `## ${h}\ntext`).join('\n');
  assert.equal(row(25).check(ctxWith({ prs: [pr(1, { mergedAt: '2026-11-08T01:00:00Z', body: full })] })).pass, true);
});

test('row 26 is not covered without previews', () => {
  const result = row(26).check(ctxWith({ previews: 'none' }));
  assert.equal(result.pass, null);
  assert.match(result.evidence, /preview/i);
});

test('row 26 wants two images in What it looks like', () => {
  const section = (images) => `## What it looks like\n${images}\n## The data before and after\nroute test`;
  const make = (body) => ctxWith({ pieces: { P1: { change: 'a', prs: [1] }, P3: { change: 'b', prs: [3] }, P4: { change: 'c', prs: [4] }, P7: { change: 'd', prs: [7] } }, prs: [1, 3, 4, 7].map((n) => pr(n, { mergedAt: 'x', body })) });
  assert.equal(row(26).check(make(section('![desktop](a.png) ![phone](b.png)'))).pass, true);
  assert.equal(row(26).check(make(section('![desktop](a.png)'))).pass, false);
});

test('row 34 reports a lost row as a finding', () => {
  const ctx = ctxWith({
    runLog: [{ at: '2026-11-08T01:00:00Z', step: 'F3b', note: 'killed' }, { at: '2026-11-08T01:06:00Z', step: 'work-ready', note: 'recovered', detail: { recovered: true } }],
    incidents: [{ kind: 'lost', project: 'p', work: 'w', at: '2026-11-08T01:40:00Z', key: 'k' }],
  });
  const result = row(34).check(ctx);
  assert.equal(result.pass, true);
  assert.match(result.evidence, /lost/);
  ctx.runLog[1].at = '2026-11-08T01:30:00Z';
  assert.equal(row(34).check(ctx).pass, false);
});

test('row 45 fails on an offender and names its role', () => {
  assert.equal(row(45).check(ctxWith()).pass, true);
  const ctx = ctxWith({ audit: { models: { clean: false, offenders: [{ role: 'feature', session: 's', model: 'claude-sonnet-4-5', count: 2 }] }, peek: { clean: true, hits: [] } } });
  const result = row(45).check(ctx);
  assert.equal(result.pass, false);
  assert.match(result.evidence, /feature/);
});

test('smoke checkAll leaves out full-only rows', () => {
  const smoke = checkAll(ctxWith({ previews: 'none' }), { smoke: true });
  const ids = smoke.map((r) => r.id);
  assert.ok(!ids.includes(34) && !ids.includes(41));
  assert.ok(!ids.includes(6));
  assert.deepEqual(ids, ROWS.filter((r) => r.smoke).map((r) => r.id));
  const full = checkAll(ctxWith(), { smoke: false });
  assert.equal(full.length, 45);
  for (const r of full) assert.ok('id' in r && 'path' in r && 'pass' in r && typeof r.evidence === 'string');
});

test('row 43 reads the ntfy message', () => {
  assert.equal(row(43).check(ctxWith({ ntfy: [{ at: '2026-11-08T01:00:00Z', text: '1 decision waits in budget-app' }] })).pass, true);
  assert.equal(row(43).check(ctxWith({ ntfy: [{ at: '2026-11-08T01:00:00Z', text: '2 decisions wait in budget-app' }] })).pass, false);
  assert.equal(row(43).check(ctxWith()).pass, false);
});

test('row 1 wants every role and both pins on haiku with premium off', () => {
  const good = ctxWith({
    config: { routing: { frontDesk: 'haiku', foreman: 'haiku' }, tiers: { pins: { mostCapable: 'haiku', midSized: 'haiku' } } },
    panes: { setup: ['Every step is done.'] },
    runLog: [{ at: '2026-11-08T00:10:00Z', step: 'health', note: 'all pass' }],
  });
  assert.equal(row(1).check(good).pass, true);
  const bad = structuredClone(good);
  bad.config.routing.foreman = 'sonnet';
  const result = row(1).check(bad);
  assert.equal(result.pass, false);
  assert.match(result.evidence, /foreman/);
});

test('row 3 compares the intake lane with the piece', () => {
  const pieces = {};
  const events = [];
  for (const id of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']) {
    pieces[id] = { change: `w-${id}`, prs: [] };
  }
  const lanes = { P1: 'feature', P2: 'small', P3: 'feature', P4: 'small', P5: 'bug', P6: 'quick', P7: 'small', P8: 'small' };
  for (const [id, lane] of Object.entries(lanes)) events.push(ev('work', { id: `w-${id}`, title: id, lane, visible: true, dependsOn: [] }, '2026-11-08T00:00:00Z'));
  assert.equal(row(3).check(ctxWith({ pieces, events })).pass, true);
  events.find((e) => e.data.id === 'w-P2').data.lane = 'quick';
  const bad = row(3).check(ctxWith({ pieces, events }));
  assert.equal(bad.pass, false);
  assert.match(bad.evidence, /P2/);
});

test('row 13 passes a decision with the right shape and fails one without undo', () => {
  const q = (undo) => ev('question', {
    id: 'q-move-tx-1', work: 'move-tx', what: 'Should moving one transaction also make a rule for that shop?', why: 'It changes what later imports do.',
    options: [{ label: 'Make a rule', says: 'Later imports follow it', cost: 'One more rule to keep', ...(undo ? { undo: 'Yes, delete the rule' } : {}) }, { label: 'Move just this one', says: 'No rule', cost: 'Nothing', ...(undo ? { undo: 'Yes' } : {}) }],
    recommendation: 'Move just this one', because: 'It is the smaller step.', meanwhile: 'Carry on with the edit page.', level: 3,
  }, '2026-11-08T00:00:00Z');
  const make = (undo) => ctxWith({ pieces: { P4: { change: 'move-tx', prs: [4] } }, events: [q(undo)] });
  assert.equal(row(13).check(make(true)).pass, true);
  assert.equal(row(13).check(make(false)).pass, false);
});

test('rows 7 and 8 read the plan card, its signed answer and the work-ready after', () => {
  const pieces = { P1: { change: 'import', prs: [] }, P3: { change: 'month', prs: [] } };
  const events = [];
  const runLog = [];
  for (const [work, hash] of [['import', 'a'.repeat(64)], ['month', 'b'.repeat(64)]]) {
    const card = ev('card', { question: 'Approve this work as written?', header: 'Plan', options: ['Approve'], kind: 'approve-work', level: 3, line: `Approve the work ${work}` }, '2026-11-08T01:00:00Z');
    events.push(card, ev('card-answer', { card: card.id, label: 'Approve', where: 'chat' }, '2026-11-08T01:05:00Z'));
    events.push(ev('action', { action: 'approve-work', question: 'q', label: 'Approve', work, lane: 'feature', hash, shownFirst: true }, '2026-11-08T01:05:00Z', { sig: { computer: 'c', value: 'v' } }));
    runLog.push({ at: '2026-11-08T01:06:00Z', step: 'work-ready', note: '', work });
  }
  const ctx = ctxWith({ pieces, events, runLog });
  assert.equal(row(7).check(ctx).pass, true);
  assert.equal(row(8).check(ctx).pass, true);
  ctx.events = ctx.events.map((e) => (e.kind === 'action' ? { ...e, sig: undefined } : e));
  assert.equal(row(8).check(ctx).pass, false);
  assert.equal(row(7).check(ctxWith({ pieces, events: events.filter((e) => e.kind !== 'card-answer'), runLog })).pass, false);
});

test('gatherContext reads the record and calls gh api for pulls, commits and statuses', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-gather-'));
  const saved = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const calls = [];
    const gh = async (args) => {
      calls.push(args.join(' '));
      const url = args[1];
      if (/pulls\?/.test(url)) return [{ number: 4, title: 'T', head: { ref: 'feature/x', sha: 'h1' }, body: 'B', merged_at: '2026-11-08T01:00:00Z', merge_commit_sha: 'm1', created_at: '2026-11-08T00:00:00Z' }];
      if (/pulls\/4\/commits/.test(url)) return [{ sha: 'c1', commit: { message: 'first', committer: { date: '2026-11-08T00:10:00Z' } } }];
      if (/commits\/c1\/statuses/.test(url)) return [{ context: 'wheelhouse/decision', description: 'Waiting on decision 1', state: 'pending', created_at: '2026-11-08T00:20:00Z' }];
      if (/commits\/c1$/.test(url)) return { files: [{ filename: 'src/a.js' }, { filename: 'tests/a.test.js' }] };
      if (/actions\/runs/.test(url)) return { workflow_runs: [] };
      throw new Error(`unexpected ${url}`);
    };
    const ctx = await gatherContext({ project: 'owner__repo', gh, runLog: [{ at: 'x', step: 's', note: '' }], panes: { a: ['t'] }, transcripts: [], enrolled: [], previews: 'tunnel' });
    assert.equal(ctx.prs.length, 1);
    assert.equal(ctx.prs[0].number, 4);
    assert.equal(ctx.prs[0].head, 'feature/x');
    assert.equal(ctx.prs[0].mergedAt, '2026-11-08T01:00:00Z');
    assert.deepEqual(ctx.prs[0].commits[0].files, ['src/a.js', 'tests/a.test.js']);
    assert.equal(ctx.prs[0].statuses[0].description, 'Waiting on decision 1');
    assert.equal(ctx.previews, 'tunnel');
    assert.deepEqual(ctx.events, []);
    assert.equal(ctx.audit.models.clean, true);
    assert.ok(calls.some((c) => /pulls\?/.test(c)) && calls.some((c) => /actions\/runs/.test(c)));
  } finally {
    if (saved === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = saved;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
