// tests/scripts/foreman/act.test.js
// The foreman's deterministic commands (ruling R63): each writes its state
// events through the helper, records each event's id as handled before writing
// it (R64), may be run again with nothing more done (R27), and refuses in one
// plain line. The helper and the waker are stand-ins; git is real, in a
// throwaway main checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main, FOREMAN_QUESTIONS, extraPlanId } from '../../../scripts/foreman/act.js';
import { briefHash, featurePaths, parseBrief } from '../../../scripts/feature/files.js';
import { branchOf } from '../../../scripts/hooks/session-start.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { eventPath, makeEvent } from '../../../scripts/state/events.js';
import { enrol, makeSigningKey } from '../../../scripts/state/signing.js';
import { makeWaker, sessionFile } from '../../../scripts/watcher/waker.js';
import { withHome } from '../../helpers/homes.js';
import {
  P, T0, HASH, config, emptyViews, fakeClient, featureView, project, reportText, workView, worktree,
} from '../../helpers/foreman.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const now = () => new Date(T0);

// A stand-in waker: keeps each start, and the session record a Shape 1 waker would keep.
function fakeWaker() {
  const starts = [];
  return {
    starts,
    wakerFor: () => ({
      async startFeature({ work, worktree: wt }) {
        starts.push({ work, worktree: wt });
        fs.mkdirSync(path.dirname(sessionFile(P, work)), { recursive: true });
        fs.writeFileSync(sessionFile(P, work), JSON.stringify({ sessionId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0', worktree: wt }));
        return { pid: 4242, sessionId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0' };
      },
    }),
  };
}

// Runs one command; resolves `{ code, out, err }`.
async function act(argv, deps) {
  const said = { out: '', err: '' };
  const code = await main(argv, {
    project: P, now, out: (t) => { said.out += t; }, err: (t) => { said.err += t; }, ...deps,
  });
  return { code, ...said };
}

const refusedInOneLine = (r) => {
  assert.equal(r.code, 1, r.out);
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
};

const everyWriteHandledFirst = (writes) => {
  for (const w of writes) {
    assert.match(w.id, UUID);
    assert.equal(w.handledFirst, true, `${w.kind} ${JSON.stringify(w.data)}`);
  }
};

// --- start ---

const START = ['start', 'add-export', '--goal', 'Export the report as CSV', '--done', 'A CSV file downloads', '--done', 'Its columns match the table',
  '--appetite-sessions', '1', '--appetite-tokens', '200000', '--ruling', 'r-1'];

function startViews() {
  const views = emptyViews();
  views.work['add-export'] = workView('add-export', { shownFirst: true });
  views.rulebook = [
    { id: 'r-1', words: 'Prices show two decimal places', status: 'accepted' },
    { id: 'r-2', words: 'Proposed only', status: 'proposed' },
  ];
  return views;
}

test('start makes the worktree on feature/<work>, writes the brief, records it, then starts the session', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: startViews() });
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  const brief = featurePaths(wt).brief;
  const briefAtWrite = [];
  const write = fake.client.state.write;
  fake.client.state.write = async (body) => {
    briefAtWrite.push(fs.existsSync(brief) ? briefHash(fs.readFileSync(brief, 'utf8')) : null);
    return write(body);
  };
  const waker = fakeWaker();
  const r = await act(START, { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(r.code, 0, r.err);

  assert.equal(branchOf(wt), 'feature/add-export');
  assert.match(fs.readFileSync(path.join(checkout, '.git', 'info', 'exclude'), 'utf8'), /^\.wheelhouse\/$/m);
  const text = fs.readFileSync(brief, 'utf8');
  const { fields } = parseBrief(text);
  assert.deepEqual(fields, {
    v: 1,
    work: 'add-export',
    lane: 'small',
    version: 1,
    goal: 'Export the report as CSV',
    done: ['A CSV file downloads', 'Its columns match the table'],
    appetite: { sessions: 1, tokens: 200000 },
    rulings: [{ id: 'r-1', words: 'Prices show two decimal places' }],
    routing: { foreman: 'model-a', builder: 'model-b', reviewer: 'model-c' },
    shownFirst: true,
  });

  // One record: started, with the brief's hash, written after the brief.
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['feature', {
    work: 'add-export', step: 'started', worktree: wt, branch: 'feature/add-export', brief: briefHash(text),
  }]]);
  assert.deepEqual(briefAtWrite, [briefHash(text)]);
  everyWriteHandledFirst(fake.writes);
  assert.deepEqual(waker.starts, [{ work: 'add-export', worktree: wt }]);
  assert.match(r.out, /^Made the worktree .*add-export on feature\/add-export\.$/m);
  assert.match(r.out, /^Started the add-export session\.$/m);

  // Again: nothing more.
  const again = await act(START, { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out, 'add-export was started already (it is at started).\n');
  assert.equal(fake.writes.length, 1);
  assert.equal(waker.starts.length, 1);
}));

test('start gives slices and a plan to the brief, and a feature started before its session began starts the session only', () => withHome(async () => {
  const checkout = await project({ git: true });
  const views = startViews();
  views.work['add-export'] = workView('add-export', { lane: 'feature' });
  const fake = fakeClient({ views });
  const r = await act([...START, '--plan', 'docs/plans/x.md', '--slices', '3'], { client: fake.client, wakerFor: () => ({ startFeature: async () => { throw new Error('STOP is on: no session is started'); } }) });
  refusedInOneLine(r);
  assert.match(r.err, /STOP is on/);
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  const { fields } = parseBrief(fs.readFileSync(featurePaths(wt).brief, 'utf8'));
  assert.equal(fields.plan, 'docs/plans/x.md');
  assert.equal(fields.slices, 3);
  assert.equal(fields.shownFirst, false);
  assert.deepEqual(fake.writes[0].data.slice, { n: 1, m: 3 });

  // Once STOP lifts, start again starts the session and records nothing more.
  const waker = fakeWaker();
  const again = await act(START, { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /^add-export was started already, but its session had not begun\.$/m);
  assert.deepEqual(waker.starts, [{ work: 'add-export', worktree: wt }]);
  assert.equal(fake.writes.length, 1);
}));

test('under Shape 2 start passes on the waker\'s START line', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: startViews(), cfg: config({ watcherShape: 2 }) });
  const r = await act(START, {
    client: fake.client,
    wakerFor: (cfg, print) => makeWaker({ shape: cfg.watcherShape, project: P, config: cfg, print, stopped: () => false }),
  });
  assert.equal(r.code, 0, r.err);
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  assert.match(r.out, new RegExp(`^START feature add-export ${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
}));

test('start reuses its worktree and branch when an earlier start stopped part-way', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: startViews() });
  // The worktree and branch made, then a stop before anything was recorded.
  const first = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor, run: undefined });
  assert.equal(first.code, 0, first.err);
  fake.views.features = {};
  fake.writes.length = 0;
  const again = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /^Using the worktree .* on feature\/add-export, made before\.$/m);
  assert.equal(fake.writes.length, 1);

  // A branch kept with no worktree is checked out again.
  const { run } = await import('../../../scripts/lib/run.js');
  await run('git', ['worktree', 'remove', '--force', path.join(checkout, '.claude', 'worktrees', 'add-export')], { cwd: checkout });
  fake.views.features = {};
  const third = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor });
  assert.equal(third.code, 0, third.err);
  assert.equal(branchOf(path.join(checkout, '.claude', 'worktrees', 'add-export')), 'feature/add-export');
}));

test('start refuses what it may not start, in one line, and writes nothing', () => withHome(async () => {
  await project({ git: true });
  const views = startViews();
  views.work.unapproved = workView('unapproved', { approved: false });
  views.work['quick-held'] = workView('quick-held', { lane: 'quick', approved: false });
  for (const w of ['b1', 'b2', 'b3']) {
    views.work[w] = workView(w, { lane: 'quick', approved: false, since: '2026-10-19T06:00:00.000Z' });
    views.features[w] = featureView(w, { step: 'building' });
  }
  const fake = fakeClient({ views });
  const cases = [
    [['start', 'Bad_Id', '--goal', 'g'], /work id/],
    [['start', 'missing', ...START.slice(2)], /no work named missing/],
    [['start', 'unapproved', ...START.slice(2, -2)], /not approved/],
    [['start', 'quick-held', ...START.slice(2, -2)], /no building slot is free/],
    [['start', 'add-export', ...START.slice(2, -2), '--ruling', 'r-2'], /r-2 is not an accepted ruling/],
    [['start', 'add-export', '--done', 'x', '--appetite-sessions', '1', '--appetite-tokens', '5'], /--goal is needed/],
    [['start', 'add-export', '--goal', 'g', '--appetite-sessions', '1', '--appetite-tokens', '5'], /--done/],
    [['start', 'add-export', '--goal', 'g', '--done', 'x', '--appetite-sessions', 'one', '--appetite-tokens', '5'], /--appetite-sessions/],
    [['start', 'add-export', '--goal', 'g', '--done', 'x', '--appetite-sessions', '1', '--appetite-tokens', '5', '--colour', 'red'], /--colour/],
  ];
  for (const [argv, why] of cases) {
    const r = await act(argv, { client: fake.client, wakerFor: fakeWaker().wakerFor });
    refusedInOneLine(r);
    assert.match(r.err, why, argv.join(' '));
  }
  assert.equal(fake.writes.length, 0);
}));

test('small work held for pace may open a session to plan (R60)', () => withHome(async () => {
  await project({ git: true });
  const views = startViews();
  for (const w of ['b1', 'b2', 'b3']) {
    views.work[w] = workView(w, { since: '2026-10-19T06:00:00.000Z' });
    views.features[w] = featureView(w, { step: 'building' });
  }
  const fake = fakeClient({ views });
  const r = await act(START, { client: fake.client, wakerFor: fakeWaker().wakerFor });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^It is held \(no building slot is free \(pace\)\), so its session plans and then waits\.$/m);
}));

// --- plan-ready, build, pause and resume ---

async function planScene({ otherFiles = ['src/other.js'], building = 1 } = {}) {
  const checkout = await project();
  const views = emptyViews();
  for (let n = 1; n <= building; n += 1) {
    const w = `other-${n}`;
    views.work[w] = workView(w, { since: '2026-10-19T06:00:00.000Z' });
    views.features[w] = featureView(w, { step: 'building', worktree: worktree(checkout, w), files: otherFiles });
  }
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine', { plan: { path: 'docs/plans/mine.md', files: ['src/mine.js', 'package.json'] } });
  views.features.mine = featureView('mine', { step: 'started', worktree: wt, branch: 'feature/mine', brief: HASH });
  return { checkout, views, wt };
}

test('plan-ready records the plan and, when it clears, the go-ahead to build', () => withHome(async () => {
  const { views, wt } = await planScene();
  const fake = fakeClient({ views });
  const r = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const carried = { work: 'mine', worktree: wt, branch: 'feature/mine', plan: 'docs/plans/mine.md', files: ['src/mine.js', 'package.json'] };
  assert.deepEqual(fake.writes.map((w) => w.data), [{ ...carried, step: 'planned' }, { ...carried, step: 'building' }]);
  assert.ok(fake.writes.every((w) => w.data.brief === undefined), 'no go-ahead carries a brief (R85)');
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, 'Recorded the plan of mine: docs/plans/mine.md, 2 files.\nmine may build: recorded building, so its session is woken with build.\n');

  // Again: it is building that plan already.
  const again = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out, 'mine is building this plan already.\n');
  assert.equal(fake.writes.length, 2);
}));

test('plan-ready records a plan that clashes, or has no slot, and says why it waits', () => withHome(async () => {
  const { views } = await planScene({ otherFiles: ['package.json'] });
  const fake = fakeClient({ views });
  const r = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['planned']);
  assert.match(r.out, /^mine waits: its plan touches package\.json, which other-1 is changing \(a hot file\)\.$/m);
  // Again: the plan is recorded already; it still waits.
  const again = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(fake.writes.length, 1);
  assert.match(again.out, /^mine waits: /m);

  const paced = await planScene({ building: 3 });
  const fake2 = fakeClient({ views: paced.views });
  const p = await act(['plan-ready', 'mine'], { client: fake2.client });
  assert.match(p.out, /^mine waits: no building slot is free \(pace\)\.$/m);
}));

test('build and resume give the go-ahead once a wait clears; pause records the pause; each again does nothing', () => withHome(async () => {
  const { views, wt } = await planScene({ building: 3 });
  views.features.mine = featureView('mine', { step: 'planned', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['src/mine.js'] });
  const fake = fakeClient({ views });
  const held = await act(['build', 'mine'], { client: fake.client });
  assert.equal(held.code, 0, held.err);
  assert.equal(held.out, 'mine waits: no building slot is free (pace).\n');
  assert.equal(fake.writes.length, 0);

  // A slot frees.
  fake.views.features['other-3'] = featureView('other-3', { step: 'closed' });
  const built = await act(['build', 'mine'], { client: fake.client });
  assert.equal(built.out, 'mine may build: recorded building, so its session is woken with build.\n');
  assert.deepEqual(fake.writes.at(-1).data, { work: 'mine', step: 'building', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['src/mine.js'] });
  assert.equal((await act(['build', 'mine'], { client: fake.client })).out, 'mine is building already.\n');

  const paused = await act(['pause', 'mine'], { client: fake.client });
  assert.equal(paused.out, 'Paused mine.\n');
  assert.deepEqual(fake.writes.at(-1).data, { work: 'mine', step: 'paused', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['src/mine.js'] });
  assert.equal((await act(['pause', 'mine'], { client: fake.client })).out, 'mine is paused already.\n');

  const resumed = await act(['resume', 'mine'], { client: fake.client });
  assert.equal(resumed.out, 'mine may build: recorded building, so its session is woken with build.\n');
  assert.equal(fake.writes.at(-1).data.step, 'building');
  assert.equal((await act(['resume', 'mine'], { client: fake.client })).out, 'mine is building already.\n');
  everyWriteHandledFirst(fake.writes);

  // Refusals.
  fake.views.features.planning = featureView('planning', { step: 'started', worktree: wt });
  fake.views.work.planning = workView('planning');
  refusedInOneLine(await act(['build', 'planning'], { client: fake.client }));
  refusedInOneLine(await act(['resume', 'planning'], { client: fake.client }));
  refusedInOneLine(await act(['build', 'nobody'], { client: fake.client }));
  refusedInOneLine(await act(['pause', 'nobody'], { client: fake.client }));
}));

test('a paused feature keeps its pause when its plan arrives, and one paused before it planned goes back to planning on resume', () => withHome(async () => {
  const { views, wt } = await planScene();
  views.features.mine = featureView('mine', { step: 'paused', worktree: wt, branch: 'feature/mine' });
  const fake = fakeClient({ views });
  const resumed = await act(['resume', 'mine'], { client: fake.client });
  assert.equal(resumed.out, 'Resumed mine: it had no plan yet, so it goes back to planning.\n');
  assert.deepEqual(fake.writes.at(-1).data, { work: 'mine', step: 'started', worktree: wt, branch: 'feature/mine' });

  fake.views.features.mine = featureView('mine', { step: 'paused', worktree: wt, branch: 'feature/mine' });
  const r = await act(['plan-ready', 'mine'], { client: fake.client });
  assert.equal(r.out, 'Recorded the plan of mine: docs/plans/mine.md, 2 files.\nmine is paused: its plan waits until it is resumed.\n');
  assert.deepEqual(fake.writes.at(-1).data, {
    work: 'mine', step: 'paused', worktree: wt, branch: 'feature/mine', plan: 'docs/plans/mine.md', files: ['src/mine.js', 'package.json'],
  });
  assert.equal((await act(['plan-ready', 'mine'], { client: fake.client })).out, 'mine is paused: its plan waits until it is resumed.\n');
  assert.equal(fake.writes.length, 2);

  // A slice number is checked against the feature's slices.
  fake.views.features.mine = featureView('mine', { step: 'building', worktree: wt, slice: { n: 1, m: 3 }, plan: 'old.md', files: [] });
  refusedInOneLine(await act(['plan-ready', 'mine', '--slice', '4'], { client: fake.client }));
  const sliced = await act(['plan-ready', 'mine', '--slice', '2'], { client: fake.client });
  assert.equal(sliced.code, 0, sliced.err);
  assert.deepEqual(fake.writes.at(-2).data.slice, { n: 2, m: 3 });
  assert.equal(fake.writes.at(-1).data.step, 'building');
}));

// --- questions ---

const QUESTION = {
  id: 'q-mine-1', kind: 'question', what: 'Which date format?', why: 'Users read it', options: [{ label: 'UK', says: '19 October 2026' }, { label: 'ISO', says: '2026-10-19' }], recommendation: 'UK', level: 3,
};
const EXTRA = {
  id: 'q-mine-2', kind: 'extra-plan', what: 'Export as PDF too', why: 'It is separate work', options: [{ label: 'queue', says: 'Queue it' }, { label: 'drop', says: 'Leave it out' }], recommendation: 'queue', level: 2, plan: 'docs/plans/pdf.md',
};

async function questionScene() {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine', { lane: 'feature', visible: true, doc: { path: 'docs/specs/mine.md', hash: HASH } });
  const wt = worktree(checkout, 'mine', {
    questions: [QUESTION, EXTRA, { ...QUESTION, id: `q-mine-${FOREMAN_QUESTIONS + 1}` }],
  });
  views.features.mine = featureView('mine', { step: 'building', worktree: wt });
  return { checkout, views, wt };
}

test('question copies the feature\'s question line into state unchanged, once', () => withHome(async () => {
  const { views } = await questionScene();
  const fake = fakeClient({ views });
  const r = await act(['question', 'mine', 'q-mine-1'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const { kind, ...asked } = QUESTION;
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['question', { ...asked, work: 'mine' }]]);
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, 'Recorded question q-mine-1 for the director.\n');
  assert.equal((await act(['question', 'mine', 'q-mine-1'], { client: fake.client })).out, 'Question q-mine-1 is recorded already.\n');
  assert.equal(fake.writes.length, 1);

  for (const argv of [['question', 'mine', 'q-mine-2'], ['question', 'mine', 'q-mine-9'], ['question', 'mine', `q-mine-${FOREMAN_QUESTIONS + 1}`], ['question', 'mine', 'q-other-1'], ['question', 'mine']]) {
    refusedInOneLine(await act(argv, { client: fake.client }));
  }
  assert.equal(fake.writes.length, 1);
}));

test('extra-plan queues the plan as work of its own, with the parent\'s lane, visibility and document', () => withHome(async () => {
  const { views } = await questionScene();
  const fake = fakeClient({ views });
  const r = await act(['extra-plan', 'mine', 'q-mine-2'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['work', {
    id: 'mine-x2', title: 'Export as PDF too', lane: 'feature', visible: true, dependsOn: [], doc: { path: 'docs/specs/mine.md', hash: HASH }, parent: 'mine',
  }]]);
  everyWriteHandledFirst(fake.writes);
  assert.match(r.out, /^Queued mine-x2 \(feature\), an extra plan of mine: Export as PDF too\.$/m);
  assert.match(r.out, /^Its plan is docs\/plans\/pdf\.md in mine's worktree\. It needs the director's approval to start\.$/m);
  assert.equal((await act(['extra-plan', 'mine', 'q-mine-2'], { client: fake.client })).out, 'mine-x2 is queued already.\n');
  assert.equal(fake.writes.length, 1);
  refusedInOneLine(await act(['extra-plan', 'mine', 'q-mine-1'], { client: fake.client }));

  // A long work id still makes a short slug of its own, the same each time.
  const long = 'a'.repeat(38);
  assert.ok(extraPlanId(long, `q-${long}-12`).length <= 40);
  assert.equal(extraPlanId(long, `q-${long}-12`), extraPlanId(long, `q-${long}-12`));
  assert.notEqual(extraPlanId(long, `q-${long}-12`), extraPlanId(`${'a'.repeat(37)}b`, `q-${'a'.repeat(37)}b-12`));
}));

test('ask records the foreman\'s own question with an id the feature can never use', () => withHome(async () => {
  const { views } = await questionScene();
  const fake = fakeClient({ views });
  const argv = ['ask', 'mine', '--what', 'mine has made no progress for 20 minutes', '--why', 'It may be stuck on a prompt',
    '--option', 'wait=Leave it a while', '--option', 'stop=Close it', '--recommend', 'wait', '--level', '2'];
  const r = await act(argv, { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const id = `q-mine-${FOREMAN_QUESTIONS + 1}`;
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['question', {
    id, work: 'mine', what: 'mine has made no progress for 20 minutes', why: 'It may be stuck on a prompt',
    options: [{ label: 'wait', says: 'Leave it a while' }, { label: 'stop', says: 'Close it' }], recommendation: 'wait', level: 2,
  }]]);
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, `Asked the director: ${id}.\n`);
  assert.equal((await act(argv, { client: fake.client })).out, `The director was asked this already: ${id}.\n`);
  const other = await act([...argv.slice(0, 3), 'Another question', ...argv.slice(4)], { client: fake.client });
  assert.equal(other.out, `Asked the director: q-mine-${FOREMAN_QUESTIONS + 2}.\n`);

  for (const bad of [
    ['ask', 'mine', '--what', 'x', '--why', 'y', '--option', 'a=1', '--recommend', 'a', '--level', '2'],
    ['ask', 'mine', '--what', 'x', '--why', 'y', '--option', 'a=1', '--option', 'b=2', '--recommend', 'c', '--level', '2'],
    ['ask', 'mine', '--what', 'x', '--why', 'y', '--option', 'a=1', '--option', 'b=2', '--recommend', 'a', '--level', '5'],
    ['ask', 'nobody', '--what', 'x', '--why', 'y', '--option', 'a=1', '--option', 'b=2', '--recommend', 'a', '--level', '2'],
  ]) refusedInOneLine(await act(bad, { client: fake.client }));
}));

// --- amend ---

// The director's signed amend click, and the amendment it names, in the state clone.
function recordAmend(work, change, hash, at) {
  try {
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
  } catch (error) {
    if (!/already exists/.test(error.message)) throw error; // made by an earlier call
  }
  const put = (event) => {
    const file = path.join(stateDir(P), eventPath(event));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(event));
  };
  put(makeEvent({ kind: 'amendment', data: { work, change, hash }, now: () => new Date(at - 1000) }));
  put(makeEvent({ kind: 'action', data: { action: 'amend', question: 'Change it?', label: `Change the approved ${work} to this, ${hash.slice(0, 12)}`, work, hash }, now: () => new Date(at) }));
}

test('amend records the amended brief\'s hash before it writes the brief, at the feature\'s own step', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine');
  const before = fs.readFileSync(featurePaths(wt).brief, 'utf8');
  views.features.mine = featureView('mine', { step: 'building', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['a.js'], brief: briefHash(before) });
  recordAmend('mine', 'Make the export CSV, not Excel', 'b'.repeat(64), T0 - 60000);
  const fake = fakeClient({ views });
  const fileAtWrite = [];
  const write = fake.client.state.write;
  fake.client.state.write = async (body) => {
    fileAtWrite.push(fs.readFileSync(featurePaths(wt).brief, 'utf8'));
    return write(body);
  };
  const r = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  const after = fs.readFileSync(featurePaths(wt).brief, 'utf8');
  assert.equal(parseBrief(after).fields.version, 2);
  assert.match(after, /^- 19 October 2026 \(version 2\): Make the export CSV, not Excel$/m);
  assert.deepEqual(fake.writes.map((w) => w.data), [{
    work: 'mine', step: 'building', worktree: wt, branch: 'feature/mine', plan: 'p.md', files: ['a.js'], brief: briefHash(after),
  }]);
  assert.deepEqual(fileAtWrite, [before], 'the hash was recorded while the file still held the brief before');
  everyWriteHandledFirst(fake.writes);
  assert.equal(r.out, `Amended mine's brief to version 2 (${briefHash(after).slice(0, 12)}); its session is woken with brief-changed.\n`);

  const again = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(again.out, 'mine\'s brief has this amendment already.\n');
  assert.equal(fake.writes.length, 1);
  assert.equal(fs.readFileSync(featurePaths(wt).brief, 'utf8'), after);
}));

test('an amendment that says to pause pauses the feature, and one that says to resume resumes it; none refuses', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const wt = worktree(checkout, 'mine');
  views.features.mine = featureView('mine', { step: 'building', worktree: wt, plan: 'p.md', files: [] });
  const fake = fakeClient({ views });
  refusedInOneLine(await act(['amend', 'mine'], { client: fake.client }));

  recordAmend('mine', 'Pause it until the pricing is settled', 'c'.repeat(64), T0 - 60000);
  const brief = fs.readFileSync(featurePaths(wt).brief, 'utf8');
  const r = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'The amendment says to pause: paused mine.\n');
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['paused']);
  assert.equal(fs.readFileSync(featurePaths(wt).brief, 'utf8'), brief, 'the brief is not changed');

  recordAmend('mine', 'Resume it', 'd'.repeat(64), T0 - 30000);
  const resumed = await act(['amend', 'mine'], { client: fake.client });
  assert.equal(resumed.out, 'The amendment says to resume: mine may build: recorded building, so its session is woken with build.\n');
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['paused', 'building']);
}));

// --- merge and close ---

test('merge brings the pull request up to date, then merges it; a refusal is one line for the director, never tried again', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  views.features.mine = featureView('mine', { step: 'building', worktree: worktree(checkout, 'mine', { pr: 12 }) });

  const refused = fakeClient({ views });
  const r = await act(['merge', 'mine'], { client: refused.client });
  refusedInOneLine(r);
  assert.match(r.err.trim(), /^Pull request #12 for mine couldn't be brought up to date: unknown request\. Ask the director; don't try again\.$/);
  assert.deepEqual(refused.calls.map(([name]) => name), ['prState', 'updateBranch']);

  const ok = fakeClient({ views, answers: { updateBranch: { ok: true } } });
  const merged = await act(['merge', 'mine'], { client: ok.client });
  assert.equal(merged.code, 0, merged.err);
  assert.equal(merged.out, 'Merged pull request #12 for mine at cccccccccccc.\n');
  assert.deepEqual(ok.calls.map(([name, body]) => [name, body]), [['prState', { project: P, number: 12 }], ['updateBranch', { project: P, number: 12 }], ['merge', { project: P, number: 12 }]]);

  const gate = fakeClient({ views, answers: { updateBranch: { ok: true }, merge: { ok: false, refused: 'no signed CLEAN review on the head commit' } } });
  const no = await act(['merge', 'mine'], { client: gate.client });
  refusedInOneLine(no);
  assert.match(no.err.trim(), /^Pull request #12 for mine was not merged: no signed CLEAN review on the head commit\. Ask the director; don't try again\.$/);

  const done = fakeClient({ views, answers: { prState: { ok: true, result: { state: 'merged' } } } });
  assert.equal((await act(['merge', 'mine'], { client: done.client })).out, 'Pull request #12 for mine is merged already.\n');

  views.features.nopr = featureView('nopr', { step: 'building', worktree: worktree(checkout, 'nopr') });
  refusedInOneLine(await act(['merge', 'nopr'], { client: ok.client }));
}));

test('close records the report with every ruling, then closes the feature and forgets its session', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine');
  const rulings = ['Ruling: dates show as day month year', 'Ruling: the export streams'];
  const wt = worktree(checkout, 'mine', { pr: 12, rulings, report: reportText('mine', { pr: 12, rulings }) });
  views.features.mine = featureView('mine', { step: 'building', worktree: wt, branch: 'feature/mine' });
  fs.mkdirSync(path.dirname(sessionFile(P, 'mine')), { recursive: true });
  fs.writeFileSync(sessionFile(P, 'mine'), '{}');
  const fake = fakeClient({ views, answers: { prState: { ok: true, result: { state: 'merged' } } } });
  const r = await act(['close', 'mine'], { client: fake.client });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [
    ['report', { work: 'mine', outcome: 'merged', summary: 'Shipped the export. Tests pass.', rulings, pr: 12 }],
    ['feature', { work: 'mine', step: 'closed', worktree: wt, branch: 'feature/mine' }],
  ]);
  everyWriteHandledFirst(fake.writes);
  assert.equal(fs.existsSync(sessionFile(P, 'mine')), false);
  assert.ok(fs.existsSync(featurePaths(wt).pr), 'pr.json is left as it is');
  assert.equal(r.out, 'Recorded mine\'s report (merged, 2 rulings) and closed it.\n');
  assert.equal((await act(['close', 'mine'], { client: fake.client })).out, 'mine is closed already.\n');
  assert.equal(fake.writes.length, 2);
}));

test('close works out the outcome, and refuses a report that is missing or incomplete, naming what is missing', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  const add = (work, opts) => {
    views.work[work] = workView(work);
    views.features[work] = featureView(work, { step: 'building', worktree: worktree(checkout, work, opts) });
  };
  add('blocked', { report: reportText('blocked', { status: 'blocked' }) });
  add('partial', { report: reportText('partial', { status: 'partial' }) });
  add('none', {});
  add('short', { report: '```json\n{"v":1,"work":"short","status":"done"}\n```\n\nText.\n' });
  add('unruled', { rulings: ['Ruling: kept'], report: reportText('unruled') });
  add('open', { pr: 7, report: reportText('open', { pr: 7 }) });
  const fake = fakeClient({ views });

  assert.equal((await act(['close', 'blocked'], { client: fake.client })).code, 0);
  assert.equal(fake.writes.at(-2).data.outcome, 'blocked');
  assert.equal((await act(['close', 'partial'], { client: fake.client })).code, 0);
  assert.equal(fake.writes.at(-2).data.outcome, 'closed');
  assert.equal((await act(['close', 'open'], { client: fake.client })).code, 0);
  assert.equal(fake.writes.at(-2).data.outcome, 'closed', 'an open pull request is not merged');

  const n = fake.writes.length;
  const none = await act(['close', 'none'], { client: fake.client });
  refusedInOneLine(none);
  assert.match(none.err, /report\.md is not there/);
  const short = await act(['close', 'short'], { client: fake.client });
  refusedInOneLine(short);
  assert.match(short.err, /lacks the fields: tests, assumptions, concerns, rulings/);
  const unruled = await act(['close', 'unruled'], { client: fake.client });
  refusedInOneLine(unruled);
  assert.match(unruled.err, /A ruling is missing from the report's rulings: Ruling: kept/);
  assert.equal(fake.writes.length, n);
}));

test('every command checks the work id, and an unknown command is refused', () => withHome(async () => {
  await project();
  const fake = fakeClient({ views: emptyViews() });
  for (const command of ['start', 'plan-ready', 'build', 'pause', 'resume', 'question', 'extra-plan', 'ask', 'amend', 'merge', 'close']) {
    const r = await act([command, '../x'], { client: fake.client });
    refusedInOneLine(r);
    assert.match(r.err, /work id/, command);
  }
  refusedInOneLine(await act(['launch', 'x'], { client: fake.client }));
  refusedInOneLine(await act([], { client: fake.client }));
  assert.equal(fake.writes.length, 0);
}));
