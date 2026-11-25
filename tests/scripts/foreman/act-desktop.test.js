// tests/scripts/foreman/act-desktop.test.js
// `act start` on the Desktop route gives the foreman the builder's offer, and `act builder-started` records the worktree the
// builder adopted (builders and settings design, sections 7.3 and 12A.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../../scripts/foreman/act.js';
import { readResume, recordBuilder } from '../../../scripts/foreman/desktop-builders.js';
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

// A piece started on Desktop and recorded, whose session then stopped (Desktop quit).
async function stoppedPiece() {
  const checkout = await project({ git: true });
  const fake = fakeClient({ views: views() });
  await act(START, { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  const tree = await desktopWorktree(checkout, 'add-export-1');
  recordBuilder(P, 'add-export', { sessionId: S, worktree: tree, branch: 'claude/add-export-1', now });
  await act(['builder-started', 'add-export'], { client: fake.client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  const recorded = emptyViews();
  recorded.work['add-export'] = workView('add-export', { shownFirst: true });
  recorded.features['add-export'] = { key: 'add-export', id: 'f1', at: new Date(T0).toISOString(), data: { work: 'add-export', step: 'started', worktree: tree, branch: 'claude/add-export-1', session: S, brief: briefHash(fs.readFileSync(featurePaths(tree).brief, 'utf8')) } };
  const after = fakeClient({ views: recorded });
  return { checkout, tree, client: after.client, writes: after.writes };
}

test('resume-offer gives a fresh start in the same worktree, with the resume brief, and starts nothing itself', () => withHome(async () => {
  const { tree, client } = await stoppedPiece();
  const r = await act(['resume-offer', 'add-export', '--foreman-session', F], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(r.code, 0, r.err);
  const offer = offerOf(r.out);
  assert.equal(offer.cwd, tree, 'the same worktree');
  assert.equal(offer.worktree, false, 'Desktop makes no worktree of its own');
  assert.deepEqual({ i: offer.initiation, f: offer.freshContext, m: offer.permissionMode, w: offer.wakeWhenDone }, { i: 'offer', f: true, m: 'auto', w: true });
  const lines = offer.prompt.split('\n');
  assert.ok(lines[0].startsWith(BUILDER_PROMPT_LEAD));
  assert.match(lines[0], /resuming/);
  assert.equal(lines[1], markerLine(P, 'add-export'));
  assert.match(offer.prompt, /Export the report as CSV/, 'the brief is in it');
}));

test('resume-offer refuses on the background route, for a piece that never started, and for a piece at the director\'s helm', () => withHome(async () => {
  const { client, tree } = await stoppedPiece();
  const bg = await act(['resume-offer', 'add-export'], { client, route: () => 'background', findings: NO_CWD, ...noWaker([]) });
  assert.equal(bg.code, 1);
  assert.match(bg.err, /Desktop route/);
  const never = emptyViews();
  never.work['add-export'] = workView('add-export', { shownFirst: true });
  const none = await act(['resume-offer', 'add-export'], { client: fakeClient({ views: never }).client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(none.code, 1);
  assert.match(none.err, /never started|no session/i);
  const { holdFile } = await import('../../../scripts/crew/hold.js');
  fs.mkdirSync(path.dirname(holdFile(P, 'add-export')), { recursive: true });
  fs.writeFileSync(holdFile(P, 'add-export'), '{}\n');
  const held = await act(['resume-offer', 'add-export'], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(held.out.includes('Desktop offer: '), false);
  assert.match(held.out, /helm/);
  assert.ok(tree);
}));

test('builder-started after a resume keeps the new session for the same worktree, and refuses a builder in another worktree', () => withHome(async () => {
  const { checkout, tree, client } = await stoppedPiece();
  const NEW = 'cccccccc-1111-2222-3333-444444444444';
  recordBuilder(P, 'add-export', { sessionId: NEW, worktree: tree, branch: 'claude/add-export-1', now });
  const r = await act(['builder-started', 'add-export'], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /resumed/);
  assert.equal(JSON.parse(fs.readFileSync(sessionFile(P, 'add-export'), 'utf8')).sessionId, NEW);
  // A builder that came up in a worktree Desktop made afresh is not the same piece's.
  const elsewhere = await desktopWorktree(checkout, 'add-export-2');
  recordBuilder(P, 'add-export', { sessionId: F, worktree: elsewhere, branch: 'claude/add-export-2', now });
  const bad = await act(['builder-started', 'add-export'], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /another worktree/);
  assert.equal(JSON.parse(fs.readFileSync(sessionFile(P, 'add-export'), 'utf8')).sessionId, NEW);
}));

test('a resume offer is made once: a second is nothing to do while the first is fresh, and the prompt asks the builder to check its folder', () => withHome(async () => {
  const { tree, client } = await stoppedPiece();
  const first = await act(['resume-offer', 'add-export', '--foreman-session', F], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(first.code, 0, first.err);
  assert.ok(offerOf(first.out).prompt.split('\n')[0].includes(`working folder is ${tree}`), 'the builder checks it opened in the piece\'s folder');
  const second = await act(['resume-offer', 'add-export', '--foreman-session', F], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(second.code, 0, second.err);
  assert.equal(second.out.includes('Desktop offer: '), false);
  assert.match(second.out, /^Nothing to do: a fresh start for add-export was offered/m);
  // Once the offer is old, one more is made.
  const later = await act(['resume-offer', 'add-export', '--foreman-session', F], { client, route: () => 'desktop', findings: NO_CWD, now: () => new Date(T0 + 31 * 60 * 1000), ...noWaker([]) });
  assert.ok(later.out.includes('Desktop offer: '), later.err);
  // A fresh start in the piece's own folder is kept, and the offer is done with.
  const NEW = 'cccccccc-1111-2222-3333-444444444444';
  recordBuilder(P, 'add-export', { sessionId: NEW, worktree: tree, branch: 'claude/add-export-1', now });
  const ok = await act(['builder-started', 'add-export'], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.match(ok.out, /resumed/);
  assert.equal(readResume(P, 'add-export'), null);
}));

test('a fresh start Desktop opened outside the piece\'s folder is not kept: the director is told once, and no fresh start is offered again', () => withHome(async () => {
  const { tree, client, writes } = await stoppedPiece();
  const before = JSON.parse(fs.readFileSync(sessionFile(P, 'add-export'), 'utf8')).sessionId;
  await act(['resume-offer', 'add-export', '--foreman-session', F], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  // Desktop ignored the folder and opened the session in the main checkout: its hook recorded nothing new.
  const r = await act(['builder-started', 'add-export'], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(r.code, 0, 'not a refusal, so the foreman doesn\'t turn it into a question');
  assert.match(r.out, /not kept/);
  assert.match(r.out, /--ended add-export/);
  const notes = writes.filter((w) => w.kind === 'note' && w.data.about === 'engine');
  assert.equal(notes.length, 1);
  assert.match(notes[0].data.words, /take the helm of add-export/);
  assert.equal(notes[0].data.words.includes(tree), false, 'no path in the director\'s words');
  assert.equal(JSON.parse(fs.readFileSync(sessionFile(P, 'add-export'), 'utf8')).sessionId, before, 'the kept session is unchanged');
  // Asked again, nothing is offered and nothing more is said to the director.
  const again = await act(['resume-offer', 'add-export', '--foreman-session', F], { client, route: () => 'desktop', findings: NO_CWD, now: () => new Date(T0 + 2 * 60 * 60 * 1000), ...noWaker([]) });
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out.includes('Desktop offer: '), false);
  assert.match(again.out, /^Nothing to do: add-export couldn't be carried on/m);
  const twice = await act(['builder-started', 'add-export'], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.match(twice.out, /recorded as started already/);
  assert.equal(writes.filter((w) => w.kind === 'note' && w.data.about === 'engine').length, 1);
}));

test('a fresh start Desktop opened in a worktree of its own is a missed resume too', () => withHome(async () => {
  const { checkout, client, writes } = await stoppedPiece();
  await act(['resume-offer', 'add-export', '--foreman-session', F], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  const elsewhere = await desktopWorktree(checkout, 'add-export-2');
  const STRAY = 'dddddddd-1111-2222-3333-444444444444';
  recordBuilder(P, 'add-export', { sessionId: STRAY, worktree: elsewhere, branch: 'claude/add-export-2', now });
  const r = await act(['builder-started', 'add-export'], { client, route: () => 'desktop', findings: NO_CWD, ...noWaker([]) });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /another worktree/);
  assert.notEqual(JSON.parse(fs.readFileSync(sessionFile(P, 'add-export'), 'utf8')).sessionId, STRAY);
  assert.equal(writes.filter((w) => w.kind === 'note' && w.data.about === 'engine').length, 1);
}));
