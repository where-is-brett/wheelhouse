// tests/scripts/watcher/sources.test.js
// What the watcher reads: state from the clone, each running feature's files
// from its worktree, and the host through the helper (design section 11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { observe, plainWorktreePath, INTERVALS, LOOKBACK_MS } from '../../../scripts/watcher/sources.js';
import { step, diff, route } from '../../../scripts/watcher/core.js';
import { briefHash, featurePaths } from '../../../scripts/feature/files.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS } from '../../../scripts/protection/windows-builds.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const unix = process.platform !== 'win32';
const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const at = (ms) => () => new Date(T0 + ms);
const HEAD = 'c'.repeat(40);
const SEC = 1000;

const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const briefText = (work, goal = 'Let people sign in') => fence({
  v: 1,
  work,
  lane: 'feature',
  version: 1,
  goal,
  done: ['It works'],
  appetite: { sessions: 2, tokens: 400000 },
  rulings: [],
  routing: {},
  shownFirst: false,
}) + '\nThe brief.\n';

const status = (work, over = {}) => ({
  v: 1, work, lane: 'feature', phase: 'pr-open', task: { n: 2, m: 5 }, fixRound: null, waitingOn: null,
  head: HEAD, pr: 7, slice: null, tokens: 1000, updatedAt: '2026-10-19T08:59:00.000Z', ...over,
});

const question = (id, kind = 'question') => ({
  id, kind, what: 'Which?', why: 'It matters', options: [{ label: 'A', says: 'a' }], recommendation: 'A', level: 2,
  ...(kind === 'extra-plan' ? { plan: 'docs/plans/x.md' } : {}),
  ...(kind === 'build-command' ? { options: BUILD_QUESTION_OPTIONS, recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands: ['npm test'] } : {}),
});

function record(kind, data, ms) {
  const event = makeEvent({ kind, data, now: at(ms) });
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
  return event;
}

// A worktree with the feature folder and the given files in it.
// The project's main checkout, recorded for the home in use; feature worktrees are made in its .claude/worktrees/.
function checkout() {
  const found = readProject(P);
  if (found) return found.folder;
  const main = tempFolder('wh-main-');
  writeProject(P, {
    folder: main, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
  });
  return main;
}

function worktree(files) {
  const parent = path.join(checkout(), '.claude', 'worktrees');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'wt-'));
  const p = featurePaths(dir);
  fs.mkdirSync(p.dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(p[name], text);
  return dir;
}

// A stand-in for the helper's client, answering from `prs` and `merges`, and keeping every call.
// With `carried`, it answers /pr/carried with it (a function throws or answers in its place).
function fakeClient({ prs = {}, merges = {}, carried } = {}) {
  const calls = [];
  return {
    calls,
    ...(carried === undefined ? {} : {
      carried: async (args) => { calls.push(['carried', args]); return typeof carried === 'function' ? carried(args) : carried; },
    }),
    state: { sync: async (args) => { calls.push(['sync', args]); return { ok: true, pulled: 0, unpushed: 0 }; } },
    prState: async (args) => {
      calls.push(['prState', args]);
      const pr = prs[args.number];
      return pr ? { ok: true, result: pr } : { ok: false, refused: 'no such pull request' };
    },
    ci: async (args) => { calls.push(['ci', args]); return { ok: true, result: { sha: args.sha, state: 'failure' } }; },
    testMerge: async (args) => {
      calls.push(['testMerge', args]);
      return merges[`${args.a}+${args.b}`] ?? { ok: false, refused: 'fetching the branches failed' };
    },
  };
}
const names = (calls) => calls.map(([n]) => n);

function enrolHere() {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
}

test('observe reads state, feature files and PRs into one observation', () => withHome(async () => {
  enrolHere();
  const oldBrief = briefText('login-page', 'An older goal');
  const brief = briefText('login-page');
  const login = worktree({
    brief,
    status: JSON.stringify(status('login-page')),
    questions: [
      JSON.stringify(question('q-login-page-1')),
      'not json',
      JSON.stringify(question('q-login-page-2', 'extra-plan')),
      JSON.stringify(question('q-login-page-3', 'build-command')),
      '',
    ].join('\n'),
    report: '',
  });
  const search = worktree({ brief: briefText('search-box') });
  record('feature', { work: 'login-page', step: 'started', worktree: login, branch: 'login-page', brief: briefHash(oldBrief) }, -60 * SEC);
  record('feature', { work: 'login-page', step: 'building', worktree: login, branch: 'login-page', brief: briefHash(oldBrief) }, -50 * SEC);
  record('feature', { work: 'login-page', step: 'building', worktree: login, branch: 'login-page', brief: briefHash(brief) }, -40 * SEC);
  record('feature', { work: 'search-box', step: 'building', worktree: search, branch: 'feature/search' }, -30 * SEC);
  record('feature', { work: 'old-thing', step: 'closed', worktree: '/nowhere/at/all', branch: 'old-thing' }, -20 * SEC);
  record('review', { pr: 7, commit: HEAD, verdict: 'CLEAN' }, -10 * SEC);
  const past = record('incident', { id: 'outage', what: 'Down' }, -5 * SEC);

  const client = fakeClient({
    prs: { 7: { headSha: HEAD, headRef: 'login-page', mergeable: 'yes', state: 'open' } },
    merges: { 'login-page+feature/search': { ok: true, clean: false, conflicts: ['app.js'] } },
  });
  const first = await observe({ project: P, client, now: at(0), awake: 1234 });

  assert.equal(first.at, new Date(T0).toISOString());
  assert.equal(first.awake, 1234);
  assert.deepEqual(first.events, [], 'with no cursor, no past state events are sent');
  assert.ok(first.stateIds.includes(past.id));
  assert.equal(first.stop, false);
  assert.deepEqual(Object.keys(first.features).sort(), ['login-page', 'search-box'], 'a closed feature is not read');
  assert.deepEqual(first.features['login-page'], {
    status: status('login-page'),
    questions: ['q-login-page-1', 'q-login-page-3'],
    extraPlans: ['q-login-page-2'],
    skipped: 1,
    briefHash: briefHash(brief),
    recordedBrief: briefHash(brief),
    recordedBefore: briefHash(oldBrief),
    appetite: 400000,
    report: false,
    gone: false,
  });
  assert.deepEqual(first.features['search-box'], {
    status: null, questions: [], extraPlans: [], skipped: 0, briefHash: briefHash(briefText('search-box')),
    recordedBrief: null, recordedBefore: null, appetite: 400000, report: false, gone: false,
  });
  assert.deepEqual(first.prs, { 7: { work: 'login-page', head: HEAD, branch: 'login-page', ci: 'failure', mergeable: 'yes', review: 'clean' } });
  assert.deepEqual(first.testMerges, [{ a: 'login-page', b: 'search-box', clean: false, conflicts: ['app.js'] }]);
  assert.deepEqual(names(client.calls), ['prState', 'ci', 'testMerge']);
  assert.deepEqual(client.calls[2][1], { project: P, a: 'login-page', b: 'feature/search' });

  // What it gives core: a red CI, a question, an extra plan, a clash, and the lines skipped.
  let cursor = step({ seen: [], prev: null }, first).cursor;
  assert.ok(cursor.prev.stateIds.includes(past.id), 'the cursor keeps the state ids it has seen');

  // 15 seconds on: only the feature files are due. New state events after the cursor are sent, verified or not.
  const approve = record('action', { action: 'approve-work', question: 'Approve login-page?', label: 'Approve', work: 'login-page', lane: 'feature', hash: 'a'.repeat(12), shownFirst: false }, 10 * SEC);
  const incident = record('incident', { id: 'second', what: 'Down again' }, 11 * SEC);
  client.calls.length = 0;
  const second = await observe({ project: P, client, now: at(15 * SEC), prev: cursor.prev });
  assert.deepEqual(names(client.calls), [], 'nothing on the host is due yet');
  assert.deepEqual(second.events.map((e) => [e.id, e.kind, e.verified]), [[approve.id, 'action', true], [incident.id, 'incident', false]]);
  assert.deepEqual(second.events[0].data, approve.data);
  assert.deepEqual(second.prs, {});
  assert.deepEqual(second.testMerges, []);
  const woke = diff(cursor.prev, second, { seen: new Set(cursor.seen) }).map((e) => e.type);
  assert.deepEqual(woke, ['work-ready', 'incident']);
  cursor = step(cursor, second).cursor;

  // A minute on: the PRs are due, and pull request 7 has merged, so it is sent as null.
  client.calls.length = 0;
  const merged = fakeClient({ prs: { 7: { headSha: HEAD, headRef: 'login-page', mergeable: 'unknown', state: 'merged' } } });
  setStop({ by: 'prompt', now: at(60 * SEC) });
  const third = await observe({ project: P, client: merged, now: at(61 * SEC), prev: cursor.prev });
  assert.deepEqual(names(merged.calls), ['prState']);
  assert.deepEqual(third.prs, { 7: null });
  assert.deepEqual(third.events, [], 'events seen before are not sent again');
  assert.equal(third.stop, true);
}));

test('the intervals are the plan\'s, and a test merge waits for its own', () => withHome(async () => {
  assert.deepEqual(INTERVALS, { features: 15000, prs: 60000, testMerge: 600000 });
  const a = worktree({ brief: briefText('a') });
  const b = worktree({ brief: briefText('b') });
  record('feature', { work: 'a', step: 'building', worktree: a, branch: 'a' }, 0);
  record('feature', { work: 'b', step: 'building', worktree: b, branch: 'b' }, 0);
  const client = fakeClient({ merges: { 'a+b': { ok: true, clean: true, conflicts: [] } } });
  let prev = null;
  const tested = [];
  for (const s of [0, 60, 300, 599, 600, 700, 1200]) {
    client.calls.length = 0;
    const obs = await observe({ project: P, client, now: at(s * SEC), prev });
    if (names(client.calls).includes('testMerge')) tested.push(s);
    prev = step({ seen: [], prev }, obs).cursor.prev;
  }
  assert.deepEqual(tested, [0, 600, 1200]);
}));

test('an observation asks for no sync', () => withHome(async () => {
  const wt = worktree({ brief: briefText('w') });
  record('feature', { work: 'w', step: 'building', worktree: wt, branch: 'w' }, 0);
  const client = fakeClient();
  let prev = null;
  for (const s of [0, 30, 60, 600]) {
    const obs = await observe({ project: P, client, now: at(s * SEC), prev });
    assert.equal('state' in obs.polled, false, 'the record is read as it is: nothing to poll');
    prev = step({ seen: [], prev }, obs).cursor.prev;
  }
  assert.equal(names(client.calls).includes('sync'), false);
}));

test('a feature whose worktree is gone is reported, not thrown', () => withHome(async () => {
  const gone = path.join(checkout(), '.claude', 'worktrees', 'removed');
  record('feature', { work: 'gone-one', step: 'building', worktree: gone, branch: 'gone-one', brief: 'b'.repeat(64) }, 0);
  record('feature', { work: 'relative', step: 'building', worktree: 'some/where', branch: 'relative', brief: 'c'.repeat(64) }, 0);
  const obs = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  assert.deepEqual(obs.features['gone-one'], {
    status: null, questions: [], extraPlans: [], skipped: 0, briefHash: null,
    recordedBrief: 'b'.repeat(64), recordedBefore: null, appetite: null, report: false, gone: true,
  });
  // A relative path is refused: nothing is read through it, and it is not gone either.
  assert.equal(obs.features.relative.gone, false);
  assert.equal(obs.features.relative.briefHash, null);
  // A gone worktree is never judged a tampered brief.
  assert.deepEqual(diff(null, obs).filter((e) => e.type === 'brief-tampered').map((e) => e.work), ['relative']);
}));

test('the recorded briefs are the latest two distinct ones over all the feature\'s events', () => withHome(async () => {
  const h = (c) => c.repeat(64);
  const wt = worktree({});
  record('feature', { work: 'w', step: 'started', worktree: wt, brief: h('1') }, 0);
  record('feature', { work: 'w', step: 'planned', worktree: wt, brief: h('2') }, SEC);
  record('feature', { work: 'w', step: 'building', worktree: wt }, 2 * SEC);
  record('feature', { work: 'w', step: 'building', worktree: wt, brief: h('2') }, 3 * SEC);
  let obs = await observe({ project: P, client: fakeClient(), now: at(10 * SEC) });
  assert.equal(obs.features.w.recordedBrief, h('2'));
  assert.equal(obs.features.w.recordedBefore, h('1'));

  // A record kept since is read in the next observation, with the brief written beside it.
  const text = briefText('w', 'Changed');
  record('feature', { work: 'w', step: 'building', worktree: wt, brief: briefHash(text) }, 20 * SEC);
  fs.writeFileSync(featurePaths(wt).brief, text);
  obs = await observe({ project: P, client: fakeClient(), now: at(30 * SEC) });
  assert.equal(obs.features.w.briefHash, briefHash(text));
  assert.equal(obs.features.w.recordedBrief, briefHash(text));
  assert.equal(obs.features.w.recordedBefore, h('2'));
}));

test('feature files are read only from the feature folder, capped and never through a link', { skip: !unix }, () => withHome(async () => {
  // A brief over its cap reads as no brief.
  const big = worktree({ brief: 'x'.repeat(1024 * 1024 + 1), status: JSON.stringify(status('big')) });
  // A feature folder that is a link to another folder is not read.
  const elsewhere = worktree({ brief: briefText('linked'), status: JSON.stringify(status('linked')) });
  const linked = worktree({});
  fs.rmSync(featurePaths(linked).dir, { recursive: true });
  fs.symlinkSync(featurePaths(elsewhere).dir, featurePaths(linked).dir);
  // A worktree that is itself a link is not followed.
  const linkTree = path.join(checkout(), '.claude', 'worktrees', 'link');
  fs.symlinkSync(elsewhere, linkTree);
  // A status file that is a link is not read; one naming another work is not this feature's.
  const statusLink = worktree({ brief: briefText('status-link') });
  fs.symlinkSync(featurePaths(elsewhere).status, featurePaths(statusLink).status);
  const other = worktree({ status: JSON.stringify(status('someone-else')) });

  for (const [work, wt] of [['big', big], ['linked', linked], ['link-tree', linkTree], ['status-link', statusLink], ['other', other]]) {
    record('feature', { work, step: 'building', worktree: wt }, 0);
  }
  const obs = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  assert.equal(obs.features.big.briefHash, null);
  assert.equal(obs.features.big.status.work, 'big');
  for (const work of ['linked', 'link-tree']) {
    assert.equal(obs.features[work].status, null, work);
    assert.equal(obs.features[work].briefHash, null, work);
    assert.equal(obs.features[work].gone, false, work);
  }
  assert.equal(obs.features['status-link'].status, null);
  assert.notEqual(obs.features['status-link'].briefHash, null);
  assert.equal(obs.features.other.status, null);
}));

test('state events older than the look-back are taken as seen, and a late one inside it is sent', () => withHome(async () => {
  record('incident', { id: 'one', what: 'x' }, 0);
  const first = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  const prev = step({ seen: [], prev: null }, first).cursor.prev;
  // Pushed late from another computer: one written an hour ago, and one from before the look-back.
  const late = record('incident', { id: 'late', what: 'x' }, -60 * 60 * SEC);
  record('incident', { id: 'ancient', what: 'x' }, -LOOKBACK_MS - SEC);
  const next = await observe({ project: P, client: fakeClient(), now: at(20 * SEC), prev });
  assert.deepEqual(next.events.map((e) => e.id), [late.id]);
}));

test('a FIFO at any feature path is refused, not waited on', { skip: !unix }, () => withHome(async () => {
  const wt = worktree({});
  for (const name of ['brief', 'status', 'questions', 'report']) execFileSync('mkfifo', [featurePaths(wt)[name]]);
  record('feature', { work: 'fifo', step: 'building', worktree: wt, branch: 'fifo' }, 0);
  const obs = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  assert.deepEqual(obs.features.fifo, {
    status: null, questions: [], extraPlans: [], skipped: 0, briefHash: null,
    recordedBrief: null, recordedBefore: null, appetite: null, report: false, gone: false,
  });
}));

test('a feature\'s status never takes another feature\'s pull request', () => withHome(async () => {
  // bbb is recorded first and names aaa's pull request; the host says its head branch is aaa's.
  const bbb = worktree({ status: JSON.stringify(status('bbb', { pr: 7 })) });
  const aaa = worktree({ status: JSON.stringify(status('aaa', { pr: 7 })) });
  record('feature', { work: 'bbb', step: 'building', worktree: bbb, branch: 'bbb' }, 0);
  record('feature', { work: 'aaa', step: 'building', worktree: aaa, branch: 'aaa' }, SEC);
  const open = { 7: { headSha: HEAD, headRef: 'aaa', mergeable: 'yes', state: 'open' } };
  let obs = await observe({ project: P, client: fakeClient({ prs: open }), now: at(2 * SEC) });
  assert.equal(obs.prs[7].work, 'aaa');
  const prev = step({ seen: [], prev: null }, obs).cursor.prev;

  // With aaa's binding known, bbb's claim still does not move it, nor does aaa dropping it from its status.
  fs.writeFileSync(featurePaths(aaa).status, JSON.stringify(status('aaa', { pr: null })));
  obs = await observe({ project: P, client: fakeClient({ prs: open }), now: at(70 * SEC), prev });
  assert.equal(obs.prs[7].work, 'aaa');

  // Claimed by bbb alone, a pull request whose head branch is not bbb's is left out, not taken, and not closed.
  fs.writeFileSync(featurePaths(aaa).status, JSON.stringify(status('aaa', { pr: null })));
  obs = await observe({ project: P, client: fakeClient({ prs: open }), now: at(2 * SEC) });
  assert.deepEqual(obs.prs, {});
  const merged = { 7: { headSha: HEAD, headRef: 'aaa', mergeable: 'unknown', state: 'merged' } };
  obs = await observe({ project: P, client: fakeClient({ prs: merged }), now: at(2 * SEC) });
  assert.deepEqual(obs.prs, {});
}));

test('a head with no signed review of its own counts as reviewed when the helper says its review carried over', () => withHome(async () => {
  enrolHere();
  const wt = worktree({ status: JSON.stringify(status('login-page')) });
  record('feature', { work: 'login-page', step: 'building', worktree: wt, branch: 'login-page' }, 0);
  // The signed review names an earlier commit: the gate brought the branch up to date since.
  record('review', { pr: 7, commit: 'e'.repeat(40), verdict: 'CLEAN' }, SEC);
  const open = { 7: { headSha: HEAD, headRef: 'login-page', mergeable: 'yes', state: 'open' } };
  const ciIs = (client, state) => { client.ci = async (args) => ({ ok: true, result: { sha: args.sha, state } }); return client; };
  const review = async (carried, ci = 'success') => {
    const client = ciIs(fakeClient({ prs: open, carried }), ci);
    const obs = await observe({ project: P, client, now: at(2 * SEC) });
    return { review: obs.prs[7].review, calls: client.calls.filter(([n]) => n === 'carried').map(([, a]) => a) };
  };

  assert.deepEqual(await review({ ok: true, review: 'clean', upToDate: true, earlier: true }), { review: 'clean', calls: [{ project: P, number: 7 }] });
  // Any other answer, a refusal or a throw leaves it unreviewed.
  for (const answer of [{ ok: true, review: 'none', upToDate: true }, { ok: true, review: 'none', upToDate: true, earlier: false }, { ok: true, review: 'none', earlier: 'yes' },
    { ok: false, refused: 'no' }, { ok: true }, null, () => { throw new Error('down'); }]) {
    assert.equal((await review(answer)).review, 'none', JSON.stringify(answer));
  }
  // M4: /pr/carried changes what is raised only once CI has passed, so it is asked only then.
  for (const ci of ['pending', 'failure', 'none']) {
    assert.deepEqual(await review({ ok: true, review: 'clean', upToDate: true, earlier: true }, ci), { review: 'none', calls: [] }, ci);
  }
  // A green CI on the brought-up-to-date head, with the carried review, raises merge-ready.
  const green = ciIs(fakeClient({ prs: open, carried: { ok: true, review: 'clean', upToDate: true, earlier: true } }), 'success');
  const obs = await observe({ project: P, client: green, now: at(2 * SEC) });
  assert.ok(diff(null, obs, { seen: new Set() }).some((e) => e.type === 'merge-ready' && e.work === 'login-page'));

  // A head with its own signed review needs no asking.
  record('review', { pr: 7, commit: HEAD, verdict: 'FINDINGS' }, 2 * SEC);
  const own = ciIs(fakeClient({ prs: open, carried: { ok: true, review: 'clean', upToDate: true } }), 'success');
  assert.equal((await observe({ project: P, client: own, now: at(3 * SEC) })).prs[7].review, 'findings');
  assert.deepEqual(names(own.calls).filter((n) => n === 'carried'), []);
}));

test('a green head whose earlier CLEAN review did not carry over wakes its session to review it (R119)', () => withHome(async () => {
  enrolHere();
  const wt = worktree({ status: JSON.stringify(status('login-page')) });
  record('feature', { work: 'login-page', step: 'building', worktree: wt, branch: 'login-page' }, 0);
  record('review', { pr: 7, commit: 'e'.repeat(40), verdict: 'CLEAN' }, SEC);
  const open = { 7: { headSha: HEAD, headRef: 'login-page', mergeable: 'yes', state: 'open' } };
  const client = fakeClient({ prs: open, carried: { ok: true, review: 'none', upToDate: true, earlier: true } });
  client.ci = async (args) => ({ ok: true, result: { sha: args.sha, state: 'success' } });
  const obs = await observe({ project: P, client, now: at(2 * SEC) });
  assert.equal(obs.prs[7].review, 'needed');
  const events = diff(null, obs, { seen: new Set() });
  const raised = events.filter((e) => e.type === 'review-needed');
  assert.deepEqual(raised.map((e) => [e.work, e.pr, e.id]), [['login-page', 7, `review-needed:login-page:${HEAD}`]]);
  assert.equal(events.some((e) => e.type === 'merge-ready'), false);
  // Routed to the session, which pulls and dispatches the reviewer on the head.
  assert.deepEqual(route(raised).features['login-page'].map((e) => e.type), ['review-needed']);
  assert.match(raised[0].detail.next, new RegExp(`wheelhouse:reviewer with pr: 7 on ${HEAD}`));
}));

test('worktree paths from state are followed only inside the project\'s checkout', () => withHome(async () => {
  // Network and device paths are refused on every system; Windows needs a drive letter.
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(plainWorktreePath('\\\\server\\share\\wt', platform), false, platform);
    assert.equal(plainWorktreePath('//server/share/wt', platform), false, platform);
    assert.equal(plainWorktreePath('\\\\?\\C:\\wt', platform), false, platform);
    assert.equal(plainWorktreePath('relative/wt', platform), false, platform);
  }
  assert.equal(plainWorktreePath('C:\\work\\wt', 'win32'), true);
  assert.equal(plainWorktreePath('C:/work/wt', 'win32'), true);
  assert.equal(plainWorktreePath('C:wt', 'win32'), false);
  assert.equal(plainWorktreePath('/work/wt', 'win32'), false);
  assert.equal(plainWorktreePath('/work/wt', 'linux'), true);

  // A worktree with a sound feature folder, but outside the project's checkout.
  const outside = tempFolder('wh-outside-');
  fs.mkdirSync(featurePaths(outside).dir, { recursive: true });
  fs.writeFileSync(featurePaths(outside).status, JSON.stringify(status('outside')));
  fs.writeFileSync(featurePaths(outside).brief, briefText('outside'));
  // A worktree path that is a regular file.
  const file = path.join(checkout(), '.claude', 'worktrees', 'a-file');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  // A missing worktree outside the checkout is not gone: it is not one of the project's.
  const missing = path.join(tempFolder('wh-outside-'), 'removed');
  // Inside by its spelling, outside by its real path: a link, on Windows a junction (which needs no
  // administrator).
  fs.symlinkSync(outside, path.join(checkout(), '.claude', 'worktrees', 'up'), unix ? undefined : 'junction');
  // In the checkout, but not in its .claude/worktrees/; and that folder itself.
  const elsewhere = path.join(checkout(), 'src');
  fs.mkdirSync(featurePaths(elsewhere).dir, { recursive: true });
  fs.writeFileSync(featurePaths(elsewhere).status, JSON.stringify(status('elsewhere')));
  const folder = path.join(checkout(), '.claude', 'worktrees');
  fs.mkdirSync(featurePaths(folder).dir, { recursive: true });
  fs.writeFileSync(featurePaths(folder).status, JSON.stringify(status('the-folder')));
  const gonePlaces = [['missing-in-checkout', path.join(checkout(), 'removed')], ['missing-folder', path.join(checkout(), '.claude', 'worktrees-old', 'x')]];
  for (const [work, wt] of [
    ['outside', outside], ['a-file', file], ['missing', missing], ['escape', path.join(checkout(), '.claude', 'worktrees', 'up', '.')],
    ['elsewhere', elsewhere], ['the-folder', folder], ...gonePlaces,
  ]) {
    record('feature', { work, step: 'building', worktree: wt, branch: work }, 0);
  }
  const obs = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  for (const work of ['outside', 'a-file', 'missing', 'escape', 'elsewhere', 'the-folder', 'missing-in-checkout', 'missing-folder']) {
    assert.equal(obs.features[work].status, null, work);
    assert.equal(obs.features[work].briefHash, null, work);
    assert.equal(obs.features[work].gone, false, work);
  }
}));

test('a pull request that is closed or not answered is asked again only after its interval', () => withHome(async () => {
  const wt = worktree({ status: JSON.stringify(status('login-page', { pr: 7 })) });
  record('feature', { work: 'login-page', step: 'building', worktree: wt, branch: 'login-page' }, 0);
  for (const [answer, sent] of [
    [{ 7: { headSha: HEAD, headRef: 'login-page', mergeable: 'unknown', state: 'merged' } }, { 7: null }],
    [{}, {}],
  ]) {
    const client = fakeClient({ prs: answer });
    let prev = null;
    const asked = [];
    for (const s of [0, 15, 30, 45, 60, 75, 90, 105, 120]) {
      client.calls.length = 0;
      const obs = await observe({ project: P, client, now: at(s * SEC), prev });
      if (names(client.calls).includes('prState')) {
        asked.push(s);
        assert.deepEqual(obs.prs, sent, 'a refused /pr/state leaves the pull request out, never null');
      } else {
        assert.deepEqual(obs.prs, {});
      }
      prev = step({ seen: [], prev }, obs).cursor.prev;
    }
    assert.deepEqual(asked, [0, 60, 120]);
  }
}));

test('a pull request the helper can\'t answer for keeps its last known state', () => withHome(async () => {
  const wt = worktree({ status: JSON.stringify(status('login-page', { pr: 7 })) });
  record('feature', { work: 'login-page', step: 'building', worktree: wt, branch: 'login-page' }, 0);
  const open = { 7: { headSha: HEAD, headRef: 'login-page', mergeable: 'yes', state: 'open' } };
  const first = await observe({ project: P, client: fakeClient({ prs: open }), now: at(0) });
  let prev = step({ seen: [], prev: null }, first).cursor.prev;
  const refused = await observe({ project: P, client: fakeClient(), now: at(60 * SEC), prev });
  assert.deepEqual(refused.prs, {});
  prev = step({ seen: [], prev }, refused).cursor.prev;
  assert.deepEqual(prev.prs, first.prs);
}));

test('while git is changing the clone, the last read of it stands', () => withHome(async () => {
  const wt = worktree({});
  record('feature', { work: 'w', step: 'building', worktree: wt, branch: 'w' }, 0);
  const first = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  let prev = step({ seen: [], prev: null }, first).cursor.prev;
  const git = path.join(stateDir(P), '.git');
  fs.mkdirSync(git, { recursive: true });
  for (const busy of ['index.lock', 'rebase-merge', 'rebase-apply']) {
    const marker = path.join(git, busy);
    if (busy === 'index.lock') fs.writeFileSync(marker, ''); else fs.mkdirSync(marker);
    const late = record('incident', { id: `during-${busy.replace('.', '-')}`, what: 'x' }, 2 * SEC);
    const other = `other-${busy.replace('.', '-')}`;
    record('feature', { work: other, step: 'building', worktree: wt, branch: other }, 2 * SEC);
    const during = await observe({ project: P, client: fakeClient(), now: at(20 * SEC), prev });
    assert.deepEqual(during.events, [], busy);
    assert.equal(Object.hasOwn(during.features, other), false, busy);
    fs.rmSync(marker, { recursive: true });
    const after = await observe({ project: P, client: fakeClient(), now: at(40 * SEC), prev });
    assert.ok(after.events.some((e) => e.id === late.id), busy);
    assert.equal(Object.hasOwn(after.features, other), true, busy);
    prev = step({ seen: [], prev }, after).cursor.prev;
    fs.rmSync(path.join(stateDir(P), eventPath(late)));
  }
}));

test('intervals given are laid over the plan\'s', () => withHome(async () => {
  const a = worktree({});
  const b = worktree({});
  record('feature', { work: 'a', step: 'building', worktree: a, branch: 'a' }, 0);
  record('feature', { work: 'b', step: 'building', worktree: b, branch: 'b' }, 0);
  const client = fakeClient({ merges: { 'a+b': { ok: true, clean: true, conflicts: [] } } });
  let prev = null;
  const calls = [];
  for (const s of [0, 20, 40]) {
    client.calls.length = 0;
    const obs = await observe({ project: P, client, now: at(s * SEC), prev, intervals: { testMerge: 20 * SEC } });
    calls.push(names(client.calls).join(','));
    prev = step({ seen: [], prev }, obs).cursor.prev;
  }
  assert.deepEqual(calls, ['testMerge', 'testMerge', 'testMerge']);
}));

test('a chat-question count and a chat-steer never reach the watcher: they wake no session', () => withHome(async () => {
  enrolHere();
  record('incident', { id: 'one', what: 'x' }, 0);
  const first = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  const prev = step({ seen: [], prev: null }, first).cursor.prev;
  const lines = [record('chat-question', { at: new Date(0).toISOString() }, 2 * SEC), record('chat-steer', { card: 'a-card' }, 2 * SEC)];
  const next = await observe({ project: P, client: fakeClient(), now: at(3 * SEC), prev });
  for (const line of lines) {
    assert.equal(next.stateIds.includes(line.id), false);
    assert.equal((next.state ?? []).some((e) => e.kind === line.kind), false);
  }
}));

test('a seal never reaches the watcher: it is sent to no session', () => withHome(async () => {
  enrolHere();
  record('incident', { id: 'one', what: 'x' }, 0);
  const first = await observe({ project: P, client: fakeClient(), now: at(SEC) });
  const prev = step({ seen: [], prev: null }, first).cursor.prev;
  const seal = { line: 'seal', card: 'q-1', work: 'w', head: null, signed: null, reader: true, candidates: {}, exclusions: { hit: [], unread: [] }, stamp: {}, at: new Date(0).toISOString(), hash: 'a'.repeat(64) };
  const line = record('shadow', seal, 2 * SEC);
  const next = await observe({ project: P, client: fakeClient(), now: at(3 * SEC), prev });
  assert.equal(next.stateIds.includes(line.id), false);
  assert.equal((next.state ?? []).some((e) => e.kind === 'shadow'), false);
}));
