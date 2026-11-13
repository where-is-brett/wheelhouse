// tests/probes/haiku-trial/signals.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS, KINDS, EVENT_KINDS, STEPS, SETUP_DONE, setupJournalDone, OWN_BRANCH, FULL_ONLY, PROOF_HEADINGS, checkAll, gatherContext } from '../../../probes/haiku-trial/signals.js';
import { FRONT_DESK_LINE } from '../../../scripts/hooks/session-start.js';
import { PLAIN_KINDS, PROTECTED_KINDS } from '../../../scripts/state/events.js';

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
  assert.deepEqual(smoke, [1, 2, 3, 4, 5, 7, 8, 9, 13, 16, 17, 18, 21, 22, 25, 26, 27, 28, 29, 31, 33, 44, 45]);
  assert.deepEqual(FULL_ONLY, [34, 41]);
});

const scriptsText = () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(root, 'scripts'));
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
};

test('every event kind a row reads is a kind the event log accepts, and there is no work-ready kind', () => {
  const accepted = new Set([...PLAIN_KINDS, ...PROTECTED_KINDS]);
  for (const kind of EVENT_KINDS) assert.ok(accepted.has(kind), `'${kind}' is not an event kind`);
  assert.equal(accepted.has('work-ready'), false, 'work-ready is the watcher\'s own event, never in the log');
  assert.equal(Object.values(KINDS).includes('work-ready'), false);
});

test('the action names and incident kinds the rows read are written in scripts', () => {
  const text = scriptsText();
  for (const name of [KINDS.approveWork, KINDS.liftStop, KINDS.liftIncident, KINDS.resumed, KINDS.lost]) assert.ok(text.includes(`'${name}'`), `no script writes '${name}'`);
});

test('the setup pattern matches what the engine says, and the engine still says it', () => {
  assert.match('Every step is done.', SETUP_DONE);
  assert.match('Setup is finished. Phone notifications come next, and are optional.', SETUP_DONE);
  assert.doesNotMatch('setup is not finished', SETUP_DONE);
  assert.doesNotMatch('Your request is kept until setup is finished, and I\'ll hand it on then. Setup is still unfinished.', SETUP_DONE);
  assert.ok(scriptsText().includes("'Every step is done.'"));
});

const workCtx = (merged) => ctxWith({
  pieces: { P6: { change: 'quick-ci', prs: [6] } },
  prs: [pr(6)],
  events: [ev('work', { id: 'quick-ci', title: 'ci', lane: 'quick', visible: false, dependsOn: [] }, '2026-11-08T01:00:00Z'), ev('self-merged', { pr: 6, commit: 'a'.repeat(40), reason: merged, work: 'quick-ci' }, '2026-11-08T02:00:00Z')],
});

const takeBack = () => ({ number: 9, title: 'Take back: money edge', head: 'wheelhouse/undo-0123456789ab-ba9876543210', mergedAt: '2026-11-08T05:00:00Z', commits: [] });
const EDGE = 'tests/money-edge.test.js';

const EDGE_NOTES = [
  'could answer decision 1 or 2', 'decision 1 was already answered', 'a reply that named an option decision 2 doesn\'t offer',
  'No decision 3 is waiting, so nothing was recorded', 'asked why about decision 1',
].join('\n');
const answer = (n, question, label = 'A') => ev('decision-answer', { n, question, label }, '2026-11-08T03:00:00Z');

test('row 19 counts one answer per decision, not per number: the same number in two works is two decisions', () => {
  const base = { panes: { replies: [EDGE_NOTES] } };
  const two = row(19).check(ctxWith({ ...base, events: [answer(1, 'q-import-1'), answer(1, 'q-export-1')] }));
  assert.equal(two.pass, true, two.evidence);
  const twice = row(19).check(ctxWith({ ...base, events: [answer(1, 'q-import-1'), answer(1, 'q-import-1')] }));
  assert.equal(twice.pass, false);
  assert.match(twice.evidence, /answered twice/);
});

const p6Ctx = (over = {}) => ctxWith({
  pieces: { P6: { change: 'money-edge', prs: [6] } },
  prs: [pr(6, { mergedAt: '2026-11-08T02:00:00Z' })],
  runLog: [{ at: '2026-11-08T01:00:00Z', step: 'work-ready', work: 'money-edge' }],
  ...over,
});

test('row 4 needs a merged pull request, not only a work that became ready', () => {
  assert.equal(row(4).check(p6Ctx()).pass, true);
  const open = row(4).check(p6Ctx({ prs: [pr(6)] }));
  assert.equal(open.pass, false);
  assert.match(open.evidence, /merged/);
});

test('row 2 judges finished replies, not a spinner or an empty capture', () => {
  const lineIn = (t) => ({ panes: { 'front-desk': [FRONT_DESK_LINE], replies: t } });
  const spinner = row(2).check(ctxWith(lineIn(['✻ Pondering… (3s · esc to interrupt)'])));
  assert.equal(spinner.pass, false);
  assert.match(spinner.evidence, /no finished front-desk reply/);
  assert.equal(row(2).check(ctxWith(lineIn(['Got it. I will plan that and ask you one thing.']))).pass, true);
});

test('rows 37, 38 and 40 are not covered, rather than failed, when the run never reached their faults', () => {
  for (const id of [37, 38, 40]) {
    const r = row(id).check(ctxWith({ runLog: [] }));
    assert.equal(r.pass, null, `row ${id}: ${r.evidence}`);
    assert.match(r.evidence, /not covered/);
  }
  const set = row(38).check(ctxWith({ runLog: [{ at: '2026-11-08T01:00:00Z', step: 'stop-set' }] }));
  assert.equal(set.pass, false);
});

test('row 44 asks for tests the builders wrote, not for points the seed gives for free', () => {
  const scores = (parts, points) => ({ detail: { ownTests: { points, parts } } });
  const free = row(44).check({ scores: scores({ written: 0, green: 3, kept: 2, bite: 0 }, 5) });
  assert.equal(free.pass, false);
  const wrote = row(44).check({ scores: scores({ written: 2, green: 3, kept: 2, bite: 0 }, 7) });
  assert.equal(wrote.pass, true);
  assert.equal(row(44).check({ scores: null }).pass, null);
});

test('row 36 passes when the take-back merged and main no longer holds the piece\'s file', () => {
  const ok = row(36).check({ prs: [takeBack()], mainFiles: { [EDGE]: null, 'package.json': '{}' } });
  assert.equal(ok.pass, true, ok.evidence);
  const still = row(36).check({ prs: [takeBack()], mainFiles: { [EDGE]: 'test()', 'package.json': '{}' } });
  assert.equal(still.pass, false);
  assert.match(still.evidence, /money-edge/);
});

test('row 36 reads the files of the target the runner chose for the undo', () => {
  const ctx = (held) => ({ prs: [takeBack()], undoFiles: ['src/a.js'], mainFiles: { 'package.json': '{}', 'src/a.js': held } });
  assert.equal(row(36).check(ctx(null)).pass, true);
  const still = row(36).check(ctx('x'));
  assert.equal(still.pass, false);
  assert.match(still.evidence, /src\/a\.js/);
});

test('row 36 is not covered when the run never reached the undo, and failed when it did and nothing merged', () => {
  assert.equal(row(36).check({ prs: [], runLog: [] }).pass, null);
  assert.equal(row(36).check({ prs: [], runLog: [{ step: 'F5a', at: '2026-11-08T04:00:00Z' }] }).pass, false);
});

test('row 36 does not read a failed read of main as a take-back that worked', () => {
  const r = row(36).check({ prs: [takeBack()], mainFiles: { [EDGE]: null, 'package.json': null } });
  assert.equal(r.pass, null);
  assert.equal(row(36).check({ prs: [takeBack()] }).pass, null);
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

test('row 25 does not take a heading word found only in prose', () => {
  const body = `${PROOF_HEADINGS.filter((h) => h !== 'Why' && h !== 'What changed').map((h) => `## ${h}\ntext`).join('\n')}\nI changed why the page loads, and what changed is small.`;
  const result = row(25).check(ctxWith({ prs: [pr(1, { mergedAt: '2026-11-08T01:00:00Z', body })] }));
  assert.equal(result.pass, false);
  assert.match(result.evidence, /Why/);
  assert.match(result.evidence, /What changed/);
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

test('row 34 reads P7 starting after F3b, and reports a lost row as a finding', () => {
  const ctx = ctxWith({
    pieces: { P7: { change: 'export', prs: [] } },
    events: [ev('run', { state: 'started', work: 'export', lane: 'small', runId: 'r1' }, '2026-11-08T01:06:00Z')],
    runLog: [{ at: '2026-11-08T01:00:00Z', step: 'F3b', note: 'killed' }],
    incidents: [{ kind: 'lost', project: 'p', work: 'w', at: '2026-11-08T01:40:00Z', key: 'k' }],
  });
  const result = row(34).check(ctx);
  assert.equal(result.pass, true);
  assert.match(result.evidence, /lost/);
  ctx.events[0].at = '2026-11-08T01:30:00Z';
  assert.equal(row(34).check(ctx).pass, false);
  ctx.events[0] = ev('run', { state: 'started', work: 'other', lane: 'small', runId: 'r2' }, '2026-11-08T01:02:00Z');
  assert.equal(row(34).check(ctx).pass, false, 'another piece starting is not the recovery');
});

test('row 10 passes on tests plus recorded review and tester roles, and is unknown, not failed, without them', () => {
  const pieces = {};
  const prs = [];
  PIECES_IDS.forEach((id, i) => {
    pieces[id] = { change: `w-${id}`, prs: [i + 1] };
    prs.push(pr(i + 1, { commits: [{ sha: 's', date: 'x', files: ['src/a.js', 'tests/a.test.js'] }] }));
  });
  const base = { pieces, prs };
  assert.equal(row(10).check(ctxWith(base)).pass, null);
  const costs = [ev('cost', { work: 'w-P1', runId: 'r', byRole: { reviewer: {}, 'tester-run': {} } }, '2026-11-08T01:00:00Z')];
  assert.equal(row(10).check(ctxWith({ ...base, events: costs })).pass, true);
  const bare = structuredClone(base);
  bare.prs[0].commits[0].files = ['src/a.js'];
  assert.equal(row(10).check(ctxWith({ ...bare, events: costs })).pass, false);
});

test('row 14 passes on exit 2 and a send-back, and reports P4\'s natural send-backs', () => {
  assert.equal(row(14).check(ctxWith()).pass, null);
  const ok = row(14).check(ctxWith({ faults: { F1: { code: 2, sentBack: true, naturalSendBacks: 1 } } }));
  assert.equal(ok.pass, true);
  assert.match(ok.evidence, /1 natural send-back/);
  assert.equal(row(14).check(ctxWith({ faults: { F1: { code: 0, sentBack: false } } })).pass, false);
});

test('row 15 looks for the why text the stuck command was given', () => {
  const faults = { F1b: { stuckAt: 3, why: 'the question keeps failing' } };
  assert.equal(row(15).check(ctxWith({ faults, panes: { 'front-desk': ['says: the question keeps failing'] } })).pass, true);
  assert.equal(row(15).check(ctxWith({ faults, panes: { 'front-desk': ['stuck somewhere unrelated'] } })).pass, false);
  assert.equal(row(15).check(ctxWith({ faults: { F1b: { stuckAt: 3 } }, panes: { 'front-desk': ['stuck'] } })).pass, false);
});

test('row 35 is unknown and keeps its reliability evidence', () => {
  const result = row(35).check(ctxWith({ incidents: [{ kind: 'resumed' }] }));
  assert.equal(result.pass, null);
  assert.match(result.evidence, /1 reliability row/);
});

test('row 25 leaves out the runner\'s own trial branch', () => {
  const full = PROOF_HEADINGS.map((h) => `## ${h}\ntext`).join('\n');
  const ctx = ctxWith({ prs: [pr(1, { mergedAt: 'x', body: full }), pr(2, { mergedAt: 'x', head: 'trial/spare-bug', body: 'plain' })] });
  assert.equal(row(25).check(ctx).pass, true);
  assert.ok(OWN_BRANCH.test('trial/spare-bug') && OWN_BRANCH.test('wheelhouse/undo-abc') && !OWN_BRANCH.test('feature/x'));
});

const withRoles = (roles) => roles.map((role) => ({ file: `${role}.jsonl`, role, session: role }));

test('row 45 is unknown with nothing to audit and passes when every role has a transcript', () => {
  const none = row(45).check(ctxWith());
  assert.equal(none.pass, null);
  assert.match(none.evidence, /front-desk, feature, foreman/);
  assert.equal(row(45).check(ctxWith({ transcripts: withRoles(['front-desk', 'feature']) })).pass, null);
  assert.equal(row(45).check(ctxWith({ transcripts: withRoles(['front-desk', 'feature', 'foreman']) })).pass, true);
});

test('row 45 fails on an offender and names its role', () => {
  const ctx = ctxWith({ audit: { models: { clean: false, offenders: [{ role: 'feature', session: 's', model: 'other-model', count: 2 }] }, peek: { clean: true, hits: [] } } });
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
  assert.equal(row(43).check(ctxWith({ ntfySetUp: true, ntfy: [{ at: '2026-11-08T01:00:00Z', text: '2 decisions wait in budget-app' }] })).pass, false);
  // The click that sets ntfy up is the director's: a run that never got it covers nothing here, and one that did, and still heard nothing, fails.
  assert.equal(row(43).check(ctxWith()).pass, null);
  assert.match(row(43).check(ctxWith()).evidence, /not covered/);
  assert.equal(row(43).check(ctxWith({ ntfySetUp: false })).pass, null);
  assert.equal(row(43).check(ctxWith({ ntfySetUp: true })).pass, false);
  assert.equal(row(43).check(ctxWith({ ntfySetUp: true, ntfy: [{ at: '2026-11-08T01:00:00Z', text: '1 decision waits in budget-app' }] })).pass, true);
  assert.equal(ROWS.find((r) => r.id === 43).smoke, false, 'a smoke run has no ntfy step');
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

test('row 1 checks the roles against the model the run was given', () => {
  const ctx = (model) => ctxWith({
    model,
    config: { routing: { frontDesk: 'claude-sonnet-4-5', foreman: 'claude-sonnet-4-5' }, tiers: { pins: { mostCapable: 'claude-sonnet-4-5', midSized: 'claude-sonnet-4-5' } } },
    panes: { setup: ['Every step is done.'] },
    runLog: [{ at: '2026-11-08T00:10:00Z', step: 'health', note: 'all pass' }],
  });
  assert.equal(row(1).check(ctx('sonnet')).pass, true, row(1).check(ctx('sonnet')).evidence);
  assert.equal(row(1).check(ctx('haiku')).pass, false);
});

test('row 45 reads "every model is <model>" for the run\'s model', () => {
  const ctx = ctxWith({ model: 'sonnet', transcripts: ['front-desk', 'feature', 'foreman'].map((role) => ({ role, file: `/${role}` })) });
  assert.match(row(45).check(ctx).evidence, /every model is sonnet/);
});

const PIECES_IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

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

test('setup counts as done when the journal\'s latest run for the folder has every step done', () => {
  const steps = [1, 2, 3];
  const done = (...ns) => Object.fromEntries(ns.map((n) => [n, { doneAt: '2026-11-09T01:00:00Z' }]));
  const journal = (runs) => ({ v: 1, runs });
  assert.equal(setupJournalDone(journal([{ folder: '/p', steps: done(1, 2, 3) }]), '/p', steps), true);
  assert.equal(setupJournalDone(journal([{ folder: '/p', steps: done(1, 2) }]), '/p', steps), false, 'a step without doneAt');
  assert.equal(setupJournalDone(journal([{ folder: '/p', steps: { ...done(1, 2), 3: { shownAt: 'x' } } }]), '/p', steps), false);
  assert.equal(setupJournalDone(journal([{ folder: '/other', steps: done(1, 2, 3) }]), '/p', steps), false, 'another folder');
  assert.equal(setupJournalDone(journal([{ folder: '/p', steps: done(1, 2, 3) }, { folder: '/p', steps: done(1) }]), '/p', steps), false, 'only the latest run counts');
  assert.equal(setupJournalDone(journal([{ folder: '/p', steps: {} }]), '/p', []), false, 'no step list is never done');
  for (const bad of [null, undefined, 'text', {}, { runs: 'x' }, { runs: [] }]) assert.equal(setupJournalDone(bad, '/p', steps), false);
});

test('rows 14, 15 and 23 read notExercised as not covered with the reason', () => {
  for (const [id, key] of [[14, 'F1'], [15, 'F1b'], [23, 'F1c']]) {
    const r = row(id).check(ctxWith({ faults: { [key]: { notExercised: 'no running feature session names P3' } } }));
    assert.equal(r.pass, null, `row ${id}`);
    assert.equal(r.evidence, 'not covered: no running feature session names P3');
  }
});

test('a row whose step failed says the step failed and why, rather than that the run stopped', () => {
  const r = row(36).check(ctxWith({ prs: [], runLog: [], findings: [{ step: 'f5a-undo-p6', what: 'boom' }] }));
  assert.equal(r.pass, null);
  assert.equal(r.evidence, 'not covered: f5a-undo-p6 failed (boom)');
  const sitting = row(40).check(ctxWith({ runLog: [], findings: [{ step: 'sitting-1', what: 'the click did not come' }] }));
  assert.equal(sitting.evidence, 'not covered: sitting-1 failed (the click did not come)');
  const f1 = row(14).check(ctxWith({ findings: [{ step: 'f1', what: 'boom' }] }));
  assert.equal(f1.evidence, 'not covered: f1 failed (boom)');
  assert.match(row(36).check(ctxWith({ prs: [], runLog: [] })).evidence, /the run stopped before/);
});
