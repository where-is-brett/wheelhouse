// tests/scripts/foreman/wake.test.js
// The foreman's reading of a wake (build-loop design, sections 8, 11 and 15):
// one short line per event, the digest counted, and the conclusions already
// worked out: the queue's answer, and for each plan the clash answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main, measures, measuresFile, readWakeLines, recordDone } from '../../../scripts/foreman/wake.js';
import { foremanCommands } from '../../../scripts/foreman/tools.js';
import { briefHash } from '../../../scripts/feature/files.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { writeCursor } from '../../../scripts/watcher/core.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import {
  P, T0, config, emptyViews, fakeClient, featureView, project, wakeFile, workView, worktree,
} from '../../helpers/foreman.js';

const now = () => new Date(T0);

// A document written in the checkout, named by the work and approved by its hash.
function approvedDoc(checkout, view, id, text = `# ${id}\n\nWhat it builds, its done lines and its appetite.\n`) {
  const rel = `docs/specs/${id}.md`;
  fs.mkdirSync(path.join(checkout, 'docs', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(checkout, rel), text);
  const hash = briefHash(text);
  view.work.data.doc = { path: rel, hash };
  if (view.approval) view.approval.hash = hash;
  return view;
}
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
  views.work['queued-a'] = approvedDoc(checkout, workView('queued-a', { since: '2026-10-19T08:00:00.000Z' }), 'queued-a');
  views.work['queued-b'] = workView('queued-b', { approved: false, since: '2026-10-19T08:10:00.000Z' });
  views.work['queued-c'] = approvedDoc(checkout, workView('queued-c', { dependsOn: ['e'], since: '2026-10-19T08:20:00.000Z' }), 'queued-c');
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
  assert.match(text, /^- plan-ready q: its plan can't be read: no plan is named in its brief or recorded with `plan`\./m);
  assert.match(text, /^Digest: none\.$/m);
}));

test('wake read: a next plan waits while the feature\'s own pull request is open', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.s = workView('s', { lane: 'feature' });
  const wt = worktree(checkout, 's', { plan: { path: 'plans/s2.md', files: ['src/s.js'] }, pr: { pr: 5, plan: 'plans/s1.md' } });
  views.features.s = featureView('s', { step: 'building', worktree: wt, plan: 'plans/s1.md', files: [] });
  views.work.t = workView('t');
  views.features.t = featureView('t', { step: 'planned', worktree: worktree(checkout, 't', { pr: 9 }), plan: 'p.md', files: [] });
  const { client } = fakeClient({ views });
  const file = wakeFile(path.join(checkout, 'w'), 'one', { events: [ev('plan-ready', 's', 'p1')] });
  const text = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  assert.match(text, /^- plan-ready s: plan plans\/s2\.md, 1 file\. It waits: its pull request #5 is still open; the next plan is checked once it merges\. Next: act plan-ready s$/m);
  assert.match(text, /^- build t: waits: its pull request #9 is still open; the next plan is checked once it merges\.$/m);
}));

test('wake read names the approved document each start reads from, and lists the rulings in force by id (R84)', () => withHome(async () => {
  const checkout = await project();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const views = emptyViews();
  views.work.a = approvedDoc(checkout, workView('a', { since: '2026-10-19T07:00:00.000Z' }), 'a');
  // A document given by its full path, outside the checkout, whose file has changed since it was approved (R97).
  const elsewhere = path.join(tempFolder('wh-doc-'), 'b.md');
  fs.writeFileSync(elsewhere, 'As approved.\n');
  views.work.b = workView('b', { doc: { path: elsewhere, hash: briefHash('As approved.\n') }, since: '2026-10-19T07:10:00.000Z' });
  views.work.b.approval.hash = briefHash('As approved.\n');
  fs.writeFileSync(elsewhere, 'Changed after the click.\n');
  views.work.c = workView('c', { since: '2026-10-19T07:20:00.000Z' });
  views.rulebook = [
    { id: 'r-one', words: 'Dates read\nday month year.', status: 'accepted' },
    { id: 'r-two', words: 'Not yet confirmed.', status: 'proposed' },
    { id: 'r-three', words: 'Gone.', status: 'superseded' },
  ];
  const { client } = fakeClient({ views });
  const file = wakeFile(path.join(checkout, 'w'), 'one', { events: [ev('work-ready', 'a', 'x', { lane: 'small' })] });
  const text = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  const a = esc(path.join(checkout, 'docs', 'specs', 'a.md'));
  assert.match(text, new RegExp(`^- start a \\(small\\): approved\\. Next: act start a --goal … --done … --appetite-sessions … --appetite-tokens … \\(from its approved document, ${a}\\)$`, 'm'));
  assert.match(text, new RegExp(`^- start b \\(small\\): approved\\. Its document ${esc(elsewhere)} is not the one approved: it has changed since\\. Ask the director: act ask$`, 'm'));
  assert.match(text, /^- start c \(small\): approved\. It names no document to read its goal from\. Ask the director: act ask$/m);
  assert.match(text, /^Rulings in force: 1; give each that applies with --ruling <id>\.$/m);
  assert.match(text, /^- ruling r-one: Dates read day month year\.$/m);
  assert.doesNotMatch(text, /r-two|r-three/);

  // A document that can't be read, and an extra plan, which names its title and parent (R99).
  // With no accepted ruling, the starts say there is none.
  const more = emptyViews();
  more.work.gone = workView('gone', { doc: { path: 'docs/specs/missing.md', hash: 'c'.repeat(64) } });
  more.work['mine-x2'] = approvedDoc(checkout, workView('mine-x2', { lane: 'feature' }), 'mine');
  more.work['mine-x2'].work.data.parent = 'mine';
  more.work['mine-x2'].work.data.title = 'Export as PDF too';
  more.rulebook = [{ id: 'r-two', words: 'Not yet confirmed.', status: 'proposed' }];
  const second = (await readWakeLines({ file, project: P, client: fakeClient({ views: more }).client, now })).lines.join('\n');
  assert.match(second, new RegExp(`^- start gone \\(small\\): approved\\. Its document ${esc(path.join(checkout, 'docs', 'specs', 'missing.md'))} can't be read\\. Ask the director: act ask$`, 'm'));
  assert.match(second, new RegExp(`^- start mine-x2 \\(feature\\): approved\\. It is an extra plan of mine, titled "Export as PDF too"\\. Next: act start mine-x2 --goal "<its title>" --done … --appetite-sessions … --appetite-tokens … \\(from the part of mine's approved document, ${esc(path.join(checkout, 'docs', 'specs', 'mine.md'))}, that its title names\\)$`, 'm'));
  assert.match(second, /^Rulings in force: none\.$/m);
  assert.doesNotMatch(second, /^- ruling /m);

  // With nothing to start, no rulings are listed.
  const quiet = emptyViews();
  quiet.rulebook = views.rulebook;
  const none = (await readWakeLines({ file, project: P, client: fakeClient({ views: quiet }).client, now })).lines.join('\n');
  assert.doesNotMatch(none, /Rulings in force/);
}));

test('wake read gives the two commands exactly as the allow rules match them, at the top of every bundle (R96)', () => withHome(async () => {
  const checkout = await project();
  const { client } = fakeClient({ views: emptyViews() });
  const file = wakeFile(path.join(checkout, 'w'), 'one', { events: [] });
  const { lines } = await readWakeLines({ file, project: P, client, now, pluginRoot: '/opt/wheel house', platform: 'linux' });
  const expected = foremanCommands('/opt/wheel house', { platform: 'linux' });
  assert.deepEqual(lines.slice(1, 3), [`Run wake as: ${expected.wake}`, `Run act as: ${expected.act}`]);
  // A root that can't be given says so, and the rest is still read.
  const bad = await readWakeLines({ file, project: P, client, now, pluginRoot: "/opt/it's", platform: 'linux' });
  assert.match(bad.lines[1], /^The commands can't be given: /);
  assert.ok(bad.lines.includes('Events:'));
}));

test('wake read: while STOP or an incident holds, it says so at the top, and nothing starts, builds or merges but the fix (R95)', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.a = approvedDoc(checkout, workView('a'), 'a');
  views.work.f = workView('f');
  views.features.f = featureView('f', { step: 'planned', worktree: worktree(checkout, 'f'), plan: 'p.md', files: ['src/f.js'] });
  views.work.p = workView('p');
  views.features.p = featureView('p', { step: 'started', worktree: worktree(checkout, 'p', { plan: { path: 'plans/p.md', files: ['src/p.js'] } }) });
  views.work.m = workView('m');
  views.features.m = featureView('m', { step: 'building', worktree: worktree(checkout, 'm'), files: [] });
  views.work.x = workView('x');
  views.features.x = featureView('x', { step: 'building', worktree: worktree(checkout, 'x'), files: [] });
  views.incidents = { open: [{ id: 'site-down', what: 'The site is down', at: '2026-10-19T08:00:00.000Z', fixes: [7] }] };
  const { client } = fakeClient({ views });
  const events = [
    ev('plan-ready', 'p', 'pr1'), ev('merge-ready', 'm', 'mr1', { head: 'a'.repeat(40) }, { pr: 6 }), ev('merge-ready', 'x', 'mr2', { head: 'b'.repeat(40) }, { pr: 7 }),
    ev('report', 'm', 'report:m:3', { phase: 'done' }),
  ];
  const file = wakeFile(path.join(checkout, 'w'), 'one', { events });
  const text = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  assert.match(text, /^Hold: incident site-down is open\. Start nothing and give no go-ahead: act start, plan-ready, build and resume wait or refuse, and no pull request merges but for #7, its fix\.$/m);
  assert.match(text, /^- start a \(small\): approved\. It waits: incident site-down is open\.$/m);
  assert.match(text, /^- build f: waits: incident site-down is open\.$/m);
  assert.match(text, /^- plan-ready p: plan plans\/p\.md, 1 file\. It waits: incident site-down is open\. Next: act plan-ready p$/m);
  assert.match(text, /^- merge-ready m: pull request #6 at aaaaaaaaaaaa\. It waits: incident site-down is open, and only an incident's fix merges$/m);
  assert.match(text, /^- merge-ready x: pull request #7 at bbbbbbbbbbbb\. Next: act merge x$/m);
  // A feature's end is closed, whatever holds (R94).
  assert.match(text, /^- report m: it has ended, and its report is written\. Next: act close m$/m);
  assert.doesNotMatch(text, /Next: act (start|build) /);

  // STOP holds everything, a fix's merge too.
  setStop({ by: 'prompt' });
  const stopped = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  assert.match(stopped, /^Hold: STOP is on\. Start nothing and give no go-ahead: act start, plan-ready, build and resume wait or refuse, and no pull request merges\.$/m);
  assert.match(stopped, /^- merge-ready x: pull request #7 at bbbbbbbbbbbb\. It waits: STOP is on, and nothing merges while it is$/m);
  // With neither, no hold line.
  const plain = (await readWakeLines({
    file, project: P, client: fakeClient({ views: emptyViews() }).client, now, stopped: () => false,
  })).lines.join('\n');
  assert.doesNotMatch(plain, /^Hold:/m);
}));

test('wake read lists every pull request ready to merge, so a merge held by an incident is offered again once its fix is recorded or it is lifted', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  for (const [w, pr] of [['m', 6], ['x', 7]]) {
    views.work[w] = workView(w);
    views.features[w] = featureView(w, { step: 'building', worktree: worktree(checkout, w, { pr: { pr, plan: 'a.md' } }) });
  }
  const ready = (work, head) => ({ work, head, ci: 'success', review: 'clean', mergeable: 'yes' });
  // The watcher's own cursor: #6 and #7 ready (their merge-ready went by during the incident), #8 not yet.
  writeCursor(P, {
    seen: [],
    prev: {
      seq: 4, features: {}, testMerges: [], prs: { 6: ready('m', 'a'.repeat(40)), 7: ready('x', 'b'.repeat(40)), 8: { ...ready('cart', 'c'.repeat(40)), ci: 'pending' } },
    },
    held: null,
  });
  let n = 0;
  const read = async (events, { incidents = [] } = {}) => {
    views.incidents = { open: incidents };
    n += 1;
    const file = wakeFile(path.join(checkout, 'w'), `wake-${n}`, { events });
    return (await readWakeLines({ file, project: P, client: fakeClient({ views }).client, now })).lines.join('\n');
  };
  const incident = (fixes) => [{ id: 'site-down', what: 'The site is down', at: '2026-10-19T08:00:00.000Z', fixes }];

  // During the incident, both wait.
  const during = await read([], { incidents: incident([]) });
  assert.match(during, /^- merge m: pull request #6 is ready to merge, but waits: incident site-down is open, and only an incident's fix merges\.$/m);
  assert.match(during, /^- merge x: pull request #7 is ready to merge, but waits: incident site-down is open, and only an incident's fix merges\.$/m);
  assert.doesNotMatch(during, /cart|#8/);

  // The fix's click comes after its merge-ready: the fix is offered, the other still waits.
  const fixed = await read([ev('incident-fix', null, 'ev-fix', { incident: 'site-down', pr: 7 }, { pr: 7 })], { incidents: incident([7]) });
  assert.match(fixed, /^- incident-fix: pull request #7 is the fix for incident site-down\. When it is ready to merge, the queue below lists it$/m);
  assert.match(fixed, /^- merge x: pull request #7 at bbbbbbbbbbbb is ready to merge\. Next: act merge x$/m);
  assert.match(fixed, /^- merge m: pull request #6 is ready to merge, but waits: /m);

  // Once lifted, every held merge is offered.
  const lifted = await read([ev('lift-incident', null, 'ev-lift', { incident: 'site-down' })]);
  assert.match(lifted, /^- lift-incident: incident site-down is over\. Pull requests ready to merge are listed in the queue below$/m);
  assert.match(lifted, /^- merge m: pull request #6 at aaaaaaaaaaaa is ready to merge\. Next: act merge m$/m);
  assert.match(lifted, /^- merge x: pull request #7 at bbbbbbbbbbbb is ready to merge\. Next: act merge x$/m);

  // A merge-ready line in the same wake isn't listed twice.
  const raised = await read([ev('merge-ready', 'm', 'mr', { head: 'a'.repeat(40) }, { pr: 6 })]);
  assert.equal(raised.match(/Next: act merge m/g).length, 1);
  assert.match(raised, /^- merge-ready m: /m);
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

test('wake read: an answer to the foreman\'s own question is the foreman\'s to act on; a director\'s pause is never offered back; held bug work waits', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  for (const w of ['b1', 'b2', 'b3']) {
    views.work[w] = workView(w, { since: '2026-10-19T06:00:00.000Z' });
    views.features[w] = featureView(w, { step: 'building', worktree: worktree(checkout, w), files: [] });
  }
  views.questions['q-b1-1000001'] = {
    question: {
      key: 'q-b1-1000001',
      data: {
        id: 'q-b1-1000001', work: 'b1', what: 'b1 is stuck: close it?', options: [{ label: 'Close it', says: 'act close b1' }, { label: 'Wait', says: 'waiting' }],
      },
    },
    answer: null,
  };
  views.questions['q-b3-1000001'] = { question: { key: 'q-b3-1000001', data: { id: 'q-b3-1000001', work: 'b3', what: 'Merge?' } }, answer: null };
  views.work.hers = workView('hers');
  views.features.hers = featureView('hers', { step: 'paused', pausedFor: 'director', worktree: worktree(checkout, 'hers'), files: [] });
  views.work.old = workView('old');
  views.features.old = featureView('old', { step: 'paused', worktree: worktree(checkout, 'old'), files: [] });
  views.work.mine = workView('mine');
  views.features.mine = featureView('mine', { step: 'paused', pausedFor: 'five-hour', worktree: worktree(checkout, 'mine'), files: [] });
  views.work['a-bug'] = workView('a-bug', { lane: 'bug', approved: false });
  const { client } = fakeClient({ views });
  const file = wakeFile(path.join(checkout, 'w'), 'one', {
    events: [
      ev('answer', 'b1', 'a1', { questionId: 'q-b1-1000001', label: 'Close it', foreman: true }), ev('answer', 'b2', 'a2', { questionId: 'q-b2-3', label: 'Yes' }),
      ev('answer', 'b3', 'a3', { questionId: 'q-b3-1000001', label: 'Yes', foreman: true }),
    ],
  });
  const text = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  // The chosen option's words go with it, so the foreman can run them.
  assert.match(text, /^- answer b1: the director answered your question q-b1-1000001 \("b1 is stuck: close it\?"\): "Close it", which says: act close b1\. Act on it\.$/m);
  assert.match(text, /^- answer b3: the director answered your question q-b3-1000001 \("Merge\?"\): "Yes", but that option's words can't be read\. Ask the director: act ask$/m);
  assert.doesNotMatch(text, /^- answer b3: .*Act on it/m);
  assert.match(text, /^- answer b2: q-b2-3 answered "Yes"\. Nothing to do: the watcher wakes its session\.$/m);
  assert.match(text, /^- resume mine: waits: no building slot is free \(pace\)\.$/m);
  assert.doesNotMatch(text, /^- resume (hers|old)/m);
  assert.match(text, /^Paused for the five-hour window: mine\.$/m);
  assert.match(text, /^Paused by the director: hers, old\. Only their amendment beginning "Resume" lifts it\.$/m);
  assert.match(text, /^- hold a-bug \(bug\): no building slot is free \(pace\)\.$/m);
}));

test('wake read with no configuration still lists the events, and says the queue and clash answers are unknown', () => withHome(async () => {
  const checkout = await project();
  const views = emptyViews();
  views.work.d = workView('d');
  views.features.d = featureView('d', { step: 'started', worktree: worktree(checkout, 'd', { plan: { path: 'p.md', files: ['a.js'] } }) });
  const { client } = fakeClient({ views, cfg: null });
  const file = wakeFile(path.join(checkout, 'w'), 'one', { events: [ev('plan-ready', 'd', 'p1'), ev('question', 'd', 'q-d-1')] });
  const text = (await readWakeLines({ file, project: P, client, now })).lines.join('\n');
  assert.match(text, /^- question d: q-d-1\. Next: act question d q-d-1$/m);
  assert.match(text, /^- plan-ready d: its plan is ready, but whether it may build is unknown until the project's configuration can't be read from its default branch: the helper could not be reached\. Nothing can be run for it now$/m);
  assert.doesNotMatch(text, /Next: act plan-ready/);
  assert.match(text, /^- unknown: the project's configuration can't be read from its default branch: the helper could not be reached\. Start and build nothing until it can be read\.$/m);
  assert.doesNotMatch(text, /^Building/m);
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
  // A feature's wake is not the foreman's to record.
  const theirs = path.join(dir, 'theirs.json');
  fs.writeFileSync(theirs, JSON.stringify({ v: 1, to: 'feature', work: 'x', at: new Date(T0).toISOString(), events: [], digest: [], dropped: 0 }));
  assert.throws(() => recordDone({ file: theirs, project: P, outcome: 'idle', now: at(3000) }), /for a feature session/);

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
