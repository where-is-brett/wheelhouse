// tests/scripts/foreman/wake.test.js
// The foreman's reading of a wake (build-loop design, sections 8, 11 and 15):
// one short line per event, the digest counted, and the conclusions already
// worked out: the queue's answer, and for each plan the clash answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main, measures, measuresFile, readWakeLines, recordDone } from '../../../scripts/foreman/wake.js';
import { withHome } from '../../helpers/homes.js';
import {
  P, T0, config, emptyViews, fakeClient, featureView, project, wakeFile, workView, worktree,
} from '../../helpers/foreman.js';

const now = () => new Date(T0);
const ev = (type, work, id, detail = {}, more = {}) => ({ type, ...(work ? { work } : {}), id, detail, ...more });

// A project with work in each state the queue knows.
async function scene() {
  const checkout = await project();
  const views = emptyViews();
  // Building: e, whose recorded files include package.json.
  views.work.e = workView('e', { since: '2026-10-19T07:00:00.000Z' });
  views.features.e = featureView('e', { step: 'building', worktree: worktree(checkout, 'e'), branch: 'feature/e', files: ['package.json', 'src/e.js'] });
  // A plan that has just arrived and touches package.json: it clashes with e.
  views.work.d = workView('d', { since: '2026-10-19T07:10:00.000Z' });
  views.features.d = featureView('d', { step: 'started', worktree: worktree(checkout, 'd', { plan: { path: 'docs/plans/d.md', files: ['package.json', 'src/d.js'] } }), branch: 'feature/d' });
  // A plan recorded earlier that touches nothing running: it may build now.
  views.work.f = workView('f', { since: '2026-10-19T07:20:00.000Z' });
  views.features.f = featureView('f', { step: 'planned', worktree: worktree(checkout, 'f'), branch: 'feature/f', plan: 'docs/plans/f.md', files: ['src/f.js'] });
  // Still planning.
  views.work.g = workView('g', { since: '2026-10-19T07:30:00.000Z' });
  views.features.g = featureView('g', { step: 'started', worktree: worktree(checkout, 'g'), branch: 'feature/g' });
  // Work not started: one approved, one not, one waiting on another.
  views.work['queued-a'] = workView('queued-a', { since: '2026-10-19T08:00:00.000Z' });
  views.work['queued-b'] = workView('queued-b', { approved: false, since: '2026-10-19T08:10:00.000Z' });
  views.work['queued-c'] = workView('queued-c', { dependsOn: ['e'], since: '2026-10-19T08:20:00.000Z' });
  return { checkout, views };
}

test('wake read gives one line per event and a count for the digest', () => withHome(async () => {
  const { checkout, views } = await scene();
  const { client } = fakeClient({ views });
  const events = [
    ev('work-ready', 'queued-a', 'e1', { lane: 'small' }),
    ev('question', 'g', 'q-g-1'),
    ev('merge-ready', 'e', 'merge-ready:e:abc', { head: 'abcdef0123456789' }, { pr: 12 }),
    ev('incident', null, 'e2', { incident: 'site-down', what: 'The site\nis down' }),
    ev('plan-ready', 'd', 'plan-ready:d:4', { phase: 'ready-to-build', task: null, slice: null }),
    ev('answer', 'g', 'e3', { questionId: 'q-g-1', label: 'Yes' }),
  ];
  const digest = [
    ev('progress', 'e', 'p1'), ev('progress', 'e', 'p2'), ev('task-done', 'e', 't1'), ev('progress', 'g', 'p3'), ev('ci-running', 'e', 'c1', {}, { pr: 12 }),
  ];
  const file = wakeFile(path.join(checkout, '.wheelhouse', 'foreman', 'wakes'), '2026-10-19T09-00-00-000Z', { events, digest, dropped: 3 });
  const { lines } = await readWakeLines({ file, project: P, client, now });
  const text = lines.join('\n');

  // One line for each event, starting with its type and work, and nothing on two lines.
  for (const e of events) {
    const mine = lines.filter((l) => l.startsWith(`- ${e.type} `) || l.startsWith(`- ${e.type}:`));
    assert.equal(mine.length, 1, `${e.type}: ${text}`);
    if (e.work) assert.ok(mine[0].startsWith(`- ${e.type} ${e.work}`), mine[0]);
  }
  assert.ok(lines.every((l) => !/[\r\n]/.test(l)));
  assert.match(text, /^- incident: site-down: The site is down/m);
  assert.match(text, /^- merge-ready e: pull request #12 at abcdef012345\. Next: act merge e$/m);
  assert.match(text, /^- question g: q-g-1\. Next: act question g q-g-1$/m);
  assert.match(text, /^- answer g: q-g-1 answered "Yes"\. Nothing to do: the watcher wakes its session\.$/m);
  // The digest is counted, by type, not listed.
  assert.match(text, /^Digest: 5 events \(progress 3, ci-running 1, task-done 1\), and 3 older ones dropped\.$/m);
  for (const d of digest) assert.doesNotMatch(text, new RegExp(`\\b${d.id}\\b`));
  // The plan that arrived clashes with e on a hot file, and says so.
  assert.match(text, /^- plan-ready d: plan docs\/plans\/d\.md, 2 files\. It waits: its plan touches package\.json, which e is changing \(a hot file\)\. Next: act plan-ready d$/m);
  // The queue's answer, worked out.
  assert.match(text, /^- start queued-a \(small\): approved\. Next: act start queued-a/m);
  assert.match(text, /^- hold queued-b \(small\): not approved yet\.$/m);
  assert.match(text, /^- hold queued-c \(small\): waits for work it depends on to merge; it may open a session to plan\. Next: act start queued-c/m);
  assert.match(text, /^- build f: its plan clears the clash check and a slot is free\. Next: act build f$/m);
  // d's plan is ready, but until act plan-ready records it, d is still planning.
  assert.match(text, /^Planning: d, g\.$/m);
  assert.match(text, /^Building \(1 of 3\): e\.$/m);
  assert.match(text, /^Pause: none\./m);
  assert.match(text, /five-hour/);
}));

test('wake read: a plan that clears takes a free slot; one held for pace says so; an unreadable plan says why', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  for (const [w, at] of [['b1', '06'], ['b2', '07'], ['b3', '08']]) {
    views.work[w] = workView(w, { since: `2026-10-19T${at}:00:00.000Z` });
    views.features[w] = featureView(w, { step: 'building', worktree: worktree(checkout, w), files: [`src/${w}.js`] });
  }
  views.work.p = workView('p');
  views.features.p = featureView('p', { step: 'started', worktree: worktree(checkout, 'p', { plan: { path: 'plans/p.md', files: ['src/p.js'] } }) });
  views.work.q = workView('q');
  views.features.q = featureView('q', { step: 'started', worktree: worktree(checkout, 'q', { brief: {} }) });
  const { client } = fakeClient({ views });
  const file = wakeFile(path.join(checkout, 'w'), 'one', {
    events: [ev('plan-ready', 'p', 'pr1'), ev('plan-ready', 'q', 'pr2')],
  });
  const text = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  assert.match(text, /^- plan-ready p: plan plans\/p\.md, 1 file\. It waits: no building slot is free \(pace\)\. Next: act plan-ready p$/m);
  assert.match(text, /^- plan-ready q: its plan can't be read: the feature's brief names no plan\./m);
  assert.match(text, /^Digest: none\.$/m);
}));

test('wake read falls back to the views kept on disk when the helper gives none, and says so', () => withHome(async (home) => {
  const checkout = await project();
  const views = emptyViews();
  views.work.a = workView('a');
  const dir = path.join(home, 'projects', P, 'views');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(views)) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value));
  const { client } = fakeClient({ views });
  client.state.views = async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' });
  const file = wakeFile(path.join(checkout, 'w'), 'one', { events: [ev('work-ready', 'a', 'x', { lane: 'small' })] });
  const text = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  assert.match(text, /^The helper gave no views \(the host helper could not be reached: is it running\?\), so these are the last ones it wrote\.$/m);
  assert.match(text, /^- start a \(small\)/m);
}));

test('wake done records acted or idle, and measures gives the idle share', () => withHome(async () => {
  const checkout = await project();
  const dir = path.join(checkout, '.wheelhouse', 'foreman', 'wakes');
  const one = wakeFile(dir, 'one', {
    events: [ev('clash', null, 'c1', { a: 'x', b: 'y' }), ev('merge-ready', 'x', 'm1', {}, { pr: 3 })],
    digest: [ev('merge-ready', 'y', 'm2', {}, { pr: 4 }, { handled: true })],
  });
  const two = wakeFile(dir, 'two', { events: [ev('incident', null, 'i1', { incident: 'z', what: 'w' })] });
  const at = (ms) => () => new Date(T0 + ms);

  assert.deepEqual(recordDone({ file: one, project: P, outcome: 'acted', now: at(1000) }), { recorded: true, wake: 'one' });
  assert.deepEqual(recordDone({ file: two, project: P, outcome: 'idle', now: at(2000) }), { recorded: true, wake: 'two' });
  // A repeated done for the same wake adds nothing, whatever it says.
  assert.deepEqual(recordDone({ file: one, project: P, outcome: 'idle', now: at(3000) }), { recorded: false, wake: 'one' });

  const lines = fs.readFileSync(measuresFile(P), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { at: new Date(T0 + 1000).toISOString(), wake: 'one', outcome: 'acted', events: 2, conflicts: 1, merges: 2 },
    { at: new Date(T0 + 2000).toISOString(), wake: 'two', outcome: 'idle', events: 1, conflicts: 0, merges: 0 },
  ]);
  assert.deepEqual(measures(P), { idleShare: 0.5, conflictsPerMerge: 0.5 });

  // A damaged line is skipped.
  fs.appendFileSync(measuresFile(P), 'not json\n{"outcome":"nonsense"}\n');
  assert.deepEqual(measures(P), { idleShare: 0.5, conflictsPerMerge: 0.5 });
  // No merges: no conflicts per merge; no wakes: no idle share.
  const three = wakeFile(dir, 'three', {});
  recordDone({ file: three, project: P, outcome: 'idle', now: at(4000) });
  assert.deepEqual(measures(P), { idleShare: 2 / 3, conflictsPerMerge: 0.5 });
}));

test('measures of a project with no wakes are nothing', () => withHome(async () => {
  await project();
  assert.deepEqual(measures(P), { idleShare: 0, conflictsPerMerge: 0 });
}));

test('the command line reads, records and refuses in one plain line', () => withHome(async () => {
  const checkout = await project();
  const { client } = fakeClient({ views: emptyViews(), cfg: config() });
  const file = wakeFile(path.join(checkout, '.wheelhouse', 'foreman', 'wakes'), 'one', { events: [ev('stop', null, 'stop:1')] });
  const said = { out: '', err: '' };
  const io = { project: P, client, now, out: (t) => { said.out += t; }, err: (t) => { said.err += t; } };

  assert.equal(await main(['read', file], io), 0);
  assert.match(said.out, /^- stop: STOP is on\. Start no more work\.$/m);

  for (const argv of [['done', file], ['done', file, '--acted', '--idle'], ['done', file, '--busy'], ['read'], ['nonsense'], ['read', path.join(checkout, 'missing.json')]]) {
    said.err = '';
    assert.equal(await main(argv, io), 1, argv.join(' '));
    assert.equal(said.err.trim().split('\n').length, 1, said.err);
  }
  said.out = '';
  assert.equal(await main(['done', file, '--acted'], io), 0);
  assert.equal(said.out, 'Recorded wake one as acted.\n');
  said.out = '';
  assert.equal(await main(['done', file, '--acted'], io), 0);
  assert.equal(said.out, 'Wake one was recorded already.\n');
  said.out = '';
  assert.equal(await main(['measures'], io), 0);
  assert.equal(said.out, 'Idle wakes: 0 of 1 (0%). Conflicts per merge: 0.\n');
}));
