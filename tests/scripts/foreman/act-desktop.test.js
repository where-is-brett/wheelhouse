// tests/scripts/foreman/act-desktop.test.js
// `act start` on the Desktop route gives the foreman the builder's offer, and `act builder-started` records the worktree the
// builder adopted (builders and settings design, sections 7.3 and 12A.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../../scripts/foreman/act.js';
import { recordBuilder } from '../../../scripts/foreman/desktop-builders.js';
import { markerLine } from '../../../scripts/foreman/desktop-start.js';
import { BUILDER_PROMPT_LEAD } from '../../../scripts/foreman/prompt-lead.js';
import { briefHash, featurePaths } from '../../../scripts/feature/files.js';
import { sessionFile } from '../../../scripts/watcher/waker.js';
import { g } from '../../helpers/git-fixture.js';
import { withHome } from '../../helpers/homes.js';
import { P, T0, emptyViews, fakeClient, project, workView } from '../../helpers/foreman.js';

const now = () => new Date(T0);
const S = 'bbbbbbbb-1111-2222-3333-444444444444';
const F = 'ffffffff-1111-2222-3333-444444444444';
const START = ['start', 'add-export', '--goal', 'Export the report as CSV', '--done', 'A CSV file downloads', '--appetite-sessions', '1', '--appetite-tokens', '200000'];
const NO_CWD = { cwdOnOffer: false, nesting: { how: null } };

async function act(argv, deps) {
  const said = { out: '', err: '' };
  const code = await main(argv, { project: P, now, out: (t) => { said.out += t; }, err: (t) => { said.err += t; }, ...deps });
  return { code, ...said };
}
const views = () => {
  const v = emptyViews();
  v.work['add-export'] = workView('add-export', { shownFirst: true });
  return v;
};
const offerOf = (out) => {
  const lines = out.split('\n').filter((l) => l.startsWith('Desktop offer: '));
  assert.equal(lines.length, 1, out);
  return JSON.parse(lines[0].slice('Desktop offer: '.length));
};
const noWaker = (calls) => ({ wakerFor: () => ({ startFeature: async () => { calls.push('start'); return {}; } }) });

test('on desktop with no cwd on an offer, start makes no worktree and no record, and prints the offer once', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: views() });
  const calls = [];
  const r = await act([...START, '--foreman-session', F], { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker(calls) });
  assert.equal(r.code, 0, r.err);
  const offer = offerOf(r.out);
  assert.equal(offer.title, `Wheelhouse · ${P} · Title of add-export`);
  const lines = offer.prompt.split('\n');
  assert.ok(lines[0].startsWith(BUILDER_PROMPT_LEAD));
  assert.equal(lines[1], markerLine(P, 'add-export'));
  assert.match(offer.prompt, /Export the report as CSV/);
  assert.deepEqual({ i: offer.initiation, f: offer.freshContext, m: offer.permissionMode, w: offer.wakeWhenDone, wt: offer.worktree }, { i: 'offer', f: true, m: 'auto', w: true, wt: true });
  assert.equal('nest' in offer, false);
  assert.equal('cwd' in offer, false);
  assert.deepEqual(fake.writes, [], 'no feature record until the builder has adopted its worktree');
  assert.equal(fs.existsSync(path.join(checkout, '.claude', 'worktrees', 'add-export')), false);
  assert.deepEqual(calls, [], 'the waker started nothing');
  // Asked again before the builder has started: no second offer.
  const again = await act([...START], { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker(calls) });
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out.includes('Desktop offer: '), false);
  assert.match(again.out, /offered already/);
}));

test('on desktop where the probe found nesting, the offer carries the option, given the foreman\'s session', () => withHome(async () => {
  await project({ git: true });
  const fake = fakeClient({ views: views() });
  const r = await act([...START, '--foreman-session', F], { client: fake.client, route: () => 'desktop', findings: { cwdOnOffer: false, nesting: { how: 'parent_session' } }, ...noWaker([]) });
  const offer = offerOf(r.out);
  assert.deepEqual(offer.nest, { parent_session: F });
  assert.ok(offer.title.startsWith('Wheelhouse · ') && !offer.title.includes(P));
}));

test('on desktop where an offer takes cwd, Wheelhouse makes its own worktree as now and the offer names it', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: views() });
  const calls = [];
  const r = await act(START, { client: fake.client, route: () => 'desktop', findings: { cwdOnOffer: true, nesting: { how: null } }, ...noWaker(calls) });
  assert.equal(r.code, 0, r.err);
  const wt = path.join(checkout, '.claude', 'worktrees', 'add-export');
  assert.equal(offerOf(r.out).cwd, wt);
  assert.deepEqual(fake.writes.map((w) => w.data.step), ['started']);
  assert.ok(fs.existsSync(featurePaths(wt).brief));
  assert.deepEqual(calls, []);
}));

test('on the background route start still starts the session through the waker', () => withHome(async () => {
  await project({ git: true });
  const fake = fakeClient({ views: views() });
  const calls = [];
  const r = await act(START, { client: fake.client, route: () => 'background', findings: NO_CWD, ...noWaker(calls) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(calls, ['start']);
  assert.equal(r.out.includes('Desktop offer: '), false);
}));

// A linked worktree of the checkout inside .claude/worktrees/, as Desktop makes one.
async function desktopWorktree(checkout, name) {
  const tree = path.join(checkout, '.claude', 'worktrees', name);
  await g(checkout, 'worktree', 'add', '-q', '-b', `claude/${name}`, tree);
  return fs.realpathSync.native(tree);
}

test('builder-started records the piece from what the builder adopted, writes the brief into its worktree and keeps the session', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: views() });
  await act(START, { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  const tree = await desktopWorktree(checkout, 'add-export-1');
  recordBuilder(P, 'add-export', { sessionId: S, worktree: tree, branch: 'claude/add-export-1', now });
  const r = await act(['builder-started', 'add-export'], { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(r.code, 0, r.err);
  const text = fs.readFileSync(featurePaths(tree).brief, 'utf8');
  assert.deepEqual(fake.writes.map((w) => [w.kind, w.data]), [['feature', { work: 'add-export', step: 'started', worktree: tree, branch: 'claude/add-export-1', session: S, brief: briefHash(text) }]]);
  assert.equal(JSON.parse(fs.readFileSync(sessionFile(P, 'add-export'), 'utf8')).sessionId, S);
  // Again: nothing more.
  const again = await act(['builder-started', 'add-export'], { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(again.code, 0, again.err);
  assert.equal(fake.writes.length, 1);
}));

test('builder-started refuses with no adopted record, and a worktree outside .claude/worktrees', () => withHome(async () => {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: views() });
  await act(START, { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  const none = await act(['builder-started', 'add-export'], { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(none.code, 1);
  assert.match(none.err, /No builder has started/);
  const outside = path.join(fs.mkdtempSync(path.join(path.dirname(checkout), 'outside-')), 'wt');
  await g(checkout, 'worktree', 'add', '-q', '-b', 'claude/else', outside);
  recordBuilder(P, 'add-export', { sessionId: S, worktree: fs.realpathSync.native(outside), branch: 'claude/else', now });
  const r = await act(['builder-started', 'add-export'], { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(r.code, 1);
  assert.match(r.err, /inside .*\.claude.*worktrees/);
  assert.deepEqual(fake.writes, []);
}));
