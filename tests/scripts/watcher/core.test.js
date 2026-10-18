// tests/scripts/watcher/core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_MS, STUCK_MS } from '../../../scripts/lib/build-loop.js';
import {
  diff, route, makeBundler, readCursor, writeCursor, cursorFile, step, settle, SEEN_CAP,
} from '../../../scripts/watcher/core.js';
import { withHome } from '../../helpers/homes.js';

const unix = process.platform !== 'win32';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const iso = (ms) => new Date(T0 + ms).toISOString();
const MIN = 60 * 1000;

const status = (over = {}) => ({
  v: 1,
  work: 'login-page',
  lane: 'feature',
  phase: 'building',
  task: { n: 0, m: 4 },
  fixRound: null,
  waitingOn: null,
  head: 'aaa111',
  pr: null,
  slice: null,
  tokens: null,
  updatedAt: iso(0),
  ...over,
});

const feature = (over = {}) => ({
  status: status(),
  questions: [],
  extraPlans: [],
  skipped: 0,
  briefHash: 'b1',
  recordedBrief: 'b1',
  recordedBefore: null,
  appetite: 400000,
  report: false,
  ...over,
});

const prState = (over = {}) => ({
  work: 'login-page', head: 'aaa111', ci: 'pending', mergeable: 'unknown', review: 'none', ...over,
});

const observation = (over = {}) => ({
  at: iso(0),
  awake: 0,
  events: [],
  features: { 'login-page': feature() },
  prs: {},
  testMerges: [],
  stop: false,
  ...over,
});

const action = (id, data, verified = true) => ({ id, kind: 'action', data: { question: 'q', label: 'Yes', ...data }, verified });
const answerEvent = (id = 'ev-answer', questionId = 'q-login-page-1') => action(id, { action: 'answer', questionId, questionHash: 'abcdefabcdef', label: 'Option A' });

const types = (events) => events.map((e) => e.type).sort();

test('each kind of change goes to the foreman, the feature or the digest as section 11 lists', () => {
  const prev = observation({
    features: {
      'login-page': feature(),
      'search-box': feature({ status: status({ work: 'search-box', phase: 'pr-open', pr: 7, head: 'ccc333' }) }),
    },
    prs: {
      7: prState({ work: 'search-box', head: 'ccc333' }),
      8: prState({ work: 'login-page', head: 'ddd444', ci: 'success', review: 'clean', mergeable: 'unknown' }),
      9: prState({ work: 'cart', head: 'eee555', ci: 'success', review: 'none', mergeable: 'yes' }),
    },
    testMerges: [{ a: 'login-page', b: 'search-box', clean: true }],
  });
  const next = observation({
    at: iso(15000),
    awake: 15000,
    events: [
      { id: 'ev-work-quick', kind: 'work', data: { id: 'fix-typo', title: 'Fix a typo', lane: 'quick', visible: false, dependsOn: [] }, verified: false },
      { id: 'ev-work-small', kind: 'work', data: { id: 'new-footer', title: 'A footer', lane: 'small', visible: true, dependsOn: [] }, verified: false },
      action('ev-approve', { action: 'approve-work', work: 'new-footer', lane: 'small', hash: 'abcdefabcdef', shownFirst: false }),
      action('ev-amend', { action: 'amend', work: 'login-page', hash: 'abcdefabcdef' }),
      answerEvent('ev-answer', 'q-search-box-1'),
      { id: 'ev-incident', kind: 'incident', data: { id: 'bad-deploy', what: 'Login is down' }, verified: false },
    ],
    features: {
      'login-page': feature({
        status: status({ task: { n: 1, m: 4 }, head: 'bbb222', updatedAt: iso(10000) }),
        questions: ['q-login-page-1'],
        extraPlans: ['q-login-page-2'],
        skipped: 2,
      }),
      'search-box': feature({
        status: status({ work: 'search-box', phase: 'pr-open', pr: 7, head: 'ccc333' }),
        briefHash: 'b2',
        recordedBrief: 'b2',
        recordedBefore: 'b1',
      }),
    },
    prs: {
      7: prState({ work: 'search-box', head: 'ccc333', ci: 'failure', review: 'findings', mergeable: 'no' }),
      8: prState({ work: 'login-page', head: 'ddd444', ci: 'success', review: 'clean', mergeable: 'yes' }),
      9: prState({ work: 'cart', head: 'fff666', ci: 'pending', review: 'clean', mergeable: 'yes' }),
    },
    testMerges: [{ a: 'login-page', b: 'search-box', clean: false }],
    stop: true,
  });

  const routed = route(diff(prev, next, { handled: new Set() }));
  assert.deepEqual(types(routed.foreman), [
    'amended', 'answer', 'clash', 'extra-plan', 'incident', 'merge-ready', 'question', 'stop', 'work-ready', 'work-ready',
  ]);
  assert.deepEqual(
    routed.foreman.filter((e) => e.type === 'work-ready').map((e) => e.work).sort(),
    ['fix-typo', 'new-footer'],
  );
  assert.deepEqual(types(routed.features['search-box']), ['answer', 'brief-changed', 'ci-red', 'conflict', 'findings']);
  assert.equal(routed.features['login-page'], undefined);
  assert.deepEqual(types(routed.digest), ['ci-running', 'progress', 'pushed', 'review-passed', 'skipped-lines', 'task-done']);

  // The answer is one event, sent to both, with the state event's own id.
  const answers = [...routed.foreman, ...routed.features['search-box']].filter((e) => e.type === 'answer');
  assert.deepEqual(answers.map((e) => e.id), ['ev-answer', 'ev-answer']);
  assert.equal(answers[0].work, 'search-box');
  // Every other id is made from the inputs alone.
  const byType = Object.fromEntries([...routed.foreman, ...routed.features['search-box'], ...routed.digest].map((e) => [e.type, e.id]));
  assert.equal(byType['merge-ready'], 'merge-ready:login-page:ddd444');
  assert.equal(byType['ci-red'], 'ci-red:search-box:ccc333');
  assert.equal(byType.findings, 'findings:search-box:ccc333');
  assert.equal(byType.conflict, 'conflict:search-box:ccc333');
  assert.equal(byType.pushed, 'pushed:cart:fff666');
  assert.equal(byType.question, 'q-login-page-1');
  assert.equal(byType['extra-plan'], 'q-login-page-2');
  assert.equal(byType.amended, 'ev-amend');
  assert.equal(byType.incident, 'ev-incident');
  assert.equal(byType.stop, 'stop:0');
  assert.equal(byType.clash, 'clash:login-page+search-box:0');
  assert.equal(byType['brief-changed'], 'brief-changed:search-box:b2:0');
  assert.equal(byType['task-done'], 'task-done:login-page:1');

  // Nothing changed is nothing to say, and unverified clicks count for nothing.
  assert.deepEqual(diff(next, { ...next, events: [] }, { handled: new Set() }), []);
  const forged = observation({
    events: [
      action('ev-f1', { action: 'approve-work', work: 'new-footer', lane: 'small', hash: 'abcdefabcdef', shownFirst: false }, false),
      action('ev-f2', { action: 'amend', work: 'login-page', hash: 'abcdefabcdef' }, false),
      action('ev-f3', { action: 'answer', questionId: 'q-login-page-1', questionHash: 'abcdefabcdef', label: 'A' }, false),
      { id: 'ev-visible-quick', kind: 'work', data: { id: 'shown', title: 'Shown', lane: 'quick', visible: true, dependsOn: [] }, verified: false },
    ],
  });
  assert.deepEqual(diff(observation(), forged, { handled: new Set() }), []);

  // A question id naming another work is not this feature's: skipped and counted.
  const stray = diff(observation(), observation({
    features: { 'login-page': feature({ questions: ['q-login-page-1', 'q-search-box-9'], extraPlans: ['q-cart-2'], skipped: 1 }) },
  }), { handled: new Set() });
  assert.deepEqual(stray.map((e) => e.id).sort(), ['q-login-page-1', 'skipped-lines:login-page:3']);
});

test('an answer to the foreman\'s own question wakes the foreman, not the feature session', () => {
  const prev = observation();
  const own = answerEvent('ev-own', 'q-login-page-1000001');
  const theirs = answerEvent('ev-theirs', 'q-login-page-999999');
  const routed = route(diff(prev, observation({ at: iso(1000), awake: 1000, events: [own, theirs] })));
  assert.deepEqual(routed.foreman.map((e) => [e.id, e.work, e.detail.foreman ?? false]), [['ev-own', 'login-page', true], ['ev-theirs', 'login-page', false]]);
  assert.deepEqual(routed.features['login-page'].map((e) => e.id), ['ev-theirs']);
});

test('an event the foreman wrote while handling a wake does not wake it again', () => {
  const prev = observation();
  const quick = { id: 'ev-foreman-quick', kind: 'work', data: { id: 'fix-typo', title: 'Fix', lane: 'quick', visible: false, dependsOn: [] }, verified: false };
  const incident = { id: 'ev-foreman-incident', kind: 'incident', data: { id: 'bad', what: 'Down' }, verified: false };
  const next = observation({ at: iso(1000), awake: 1000, events: [quick, incident, answerEvent()] });

  const handled = new Set(['ev-foreman-quick', 'ev-foreman-incident', 'ev-answer']);
  const routed = route(diff(prev, next, { handled }));
  assert.deepEqual(routed.foreman, []);
  assert.deepEqual(routed.digest.map((e) => e.id).sort(), ['ev-answer', 'ev-foreman-incident', 'ev-foreman-quick']);
  // The feature still hears the director's answer.
  assert.deepEqual(routed.features['login-page'].map((e) => e.id), ['ev-answer']);

  // A wake loop needs one id to wake twice: once seen, an id never wakes again.
  const first = step({ seen: [], prev }, next, { handled: new Set() });
  assert.equal(route(first.events).foreman.length, 3);
  const again = step(first.cursor, { ...next, at: iso(2000) }, { handled: new Set() });
  assert.deepEqual(again.events, []);
  // Even with the cursor's last observation lost, the seen ids hold.
  assert.deepEqual(diff(prev, next, { handled: new Set(), seen: new Set(first.cursor.seen) }), []);
});

test('events within a minute arrive as one bundle; the digest rides with the next one', () => {
  let t = T0;
  const bundler = makeBundler({ now: () => new Date(t) });
  const ev = (type, id, work) => ({ type, id, work, detail: {} });

  // A digest on its own wakes no one.
  bundler.add({ foreman: [], features: {}, digest: [ev('task-done', 'd1', 'login-page')] });
  t += 5 * MIN;
  assert.deepEqual(bundler.due(), []);

  bundler.add({ foreman: [ev('question', 'f1', 'login-page')], features: { 'login-page': [ev('ci-red', 'c1', 'login-page')] }, digest: [] });
  t += 30 * 1000;
  bundler.add({ foreman: [ev('stuck', 'f2', 'search-box')], features: {}, digest: [ev('pushed', 'd2', 'search-box')] });
  t += 29 * 1000;
  assert.deepEqual(bundler.due(), [], 'the window runs from the first event');
  t += 1000;
  assert.equal(BUNDLE_MS, 60 * 1000);
  const out = bundler.due();
  assert.deepEqual(out.map((b) => `${b.to} ${b.work ?? ''}`).sort(), ['feature login-page', 'foreman ']);
  const foreman = out.find((b) => b.to === 'foreman');
  assert.deepEqual(foreman.events.map((e) => e.id), ['f1', 'f2']);
  assert.deepEqual(foreman.digest.map((e) => e.id), ['d1', 'd2']);
  assert.equal(foreman.dropped, 0);
  assert.equal(foreman.work, undefined);
  const feat = out.find((b) => b.to === 'feature');
  assert.equal(feat.work, 'login-page');
  assert.deepEqual(feat.events.map((e) => e.id), ['c1']);
  assert.deepEqual(feat.digest, []);
  assert.deepEqual(bundler.due(), [], 'each bundle goes out once');

  // An event after a bundle went out starts a new window, and the digest went with the last one.
  bundler.add({ foreman: [ev('stop', 'f3')], features: {}, digest: [] });
  t += BUNDLE_MS;
  const [later] = bundler.due();
  assert.deepEqual(later.events.map((e) => e.id), ['f3']);
  assert.deepEqual(later.digest, []);

  // The same id twice in a window is one event.
  let u = 0;
  const quick = makeBundler({ windowMs: 10, now: () => u });
  quick.add({ foreman: [ev('stop', 's')], features: {}, digest: [] });
  quick.add({ foreman: [ev('stop', 's')], features: {}, digest: [] });
  u = 10;
  const [one] = quick.due();
  assert.equal(one.events.length, 1);

  // A work called foreman is still a feature.
  quick.add({ foreman: [], features: { foreman: [ev('ci-red', 'x', 'foreman')] }, digest: [] });
  u = 20;
  assert.deepEqual(quick.due().map((b) => [b.to, b.work]), [['feature', 'foreman']]);

  // The digest keeps its newest 200 events and counts the rest, across a restart.
  let v = 0;
  const big = makeBundler({ now: () => v });
  big.add({ foreman: [], features: {}, digest: Array.from({ length: 250 }, (_, i) => ev('progress', `p${i}`, 'login-page')) });
  const again = makeBundler({ now: () => v, held: big.held() });
  again.add({ foreman: [ev('stop', 's')], features: {}, digest: [ev('pushed', 'p250', 'login-page')] });
  v = BUNDLE_MS;
  const [full] = again.due();
  assert.equal(full.digest.length, 200);
  assert.equal(full.digest[0].id, 'p51');
  assert.equal(full.digest.at(-1).id, 'p250');
  assert.equal(full.dropped, 51);
  again.add({ foreman: [ev('stop', 's2')], features: {}, digest: [] });
  v += BUNDLE_MS;
  assert.equal(again.due()[0].dropped, 0);
});

test('stuck counts awake time only, and never while waiting', () => {
  const idle = (awake, over = {}) => observation({ awake, ...over });
  let cursor = { seen: [], prev: observation() };
  const run = (obs) => {
    const r = step(cursor, obs, { handled: new Set() });
    cursor = r.cursor;
    return r.events.filter((e) => e.type === 'stuck');
  };

  // Ten awake minutes, then a night asleep: the observation after the sleep
  // reports only the seconds the watcher ran, so the night counts for nothing.
  assert.deepEqual(run(idle(10 * MIN)), []);
  assert.deepEqual(run(idle(5000, { at: iso(10 * 60 * MIN) })), []);
  assert.equal(cursor.prev.features['login-page'].still, 10 * MIN + 5000);
  assert.deepEqual(run(idle(9 * MIN)), []);
  assert.ok(cursor.prev.features['login-page'].still < STUCK_MS);
  const stuck = run(idle(MIN));
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].work, 'login-page');
  assert.equal(stuck[0].id, `stuck:login-page:${iso(0)}`);
  assert.equal(route(stuck).foreman.length, 1);
  assert.deepEqual(run(idle(30 * MIN)), [], 'stuck once for the same stillness');

  // A change to the status starts the clock again.
  assert.deepEqual(run(idle(MIN, { features: { 'login-page': feature({ status: status({ task: { n: 1, m: 4 }, updatedAt: iso(1) }) }) } })), []);
  assert.equal(cursor.prev.features['login-page'].still, 0);

  // Waiting on a question, an hour awake is not stuck, and waiting time never counts.
  const waiting = feature({ status: status({ phase: 'waiting', waitingOn: 'question', updatedAt: iso(2) }) });
  for (let i = 0; i < 6; i += 1) assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': waiting } })), []);
  assert.equal(cursor.prev.features['login-page'].still, 0);

  // A pull request waiting on CI is waiting; one with red CI the session should be fixing is not.
  const open = feature({ status: status({ phase: 'pr-open', pr: 7, updatedAt: iso(3) }) });
  const pending = { 7: prState({ ci: 'pending' }) };
  for (let i = 0; i < 3; i += 1) assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': open }, prs: pending })), []);
  // PRs are polled less often than features: an observation without the PR
  // keeps its last known state, so red CI every other observation still counts.
  const red = { 7: prState({ ci: 'failure' }) };
  assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': open }, prs: red })), []);
  assert.equal(run(idle(10 * MIN, { features: { 'login-page': open }, prs: {} })).length, 1);
  assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': open }, prs: red })), []);
  assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': open }, prs: {} })), []);

  // Three feature observations to each PR poll: a PR waiting on CI stays waiting in between.
  cursor = { seen: [], prev: observation() };
  assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': open }, prs: pending })), []);
  for (let i = 0; i < 3; i += 1) assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': open }, prs: {} })), []);
  assert.equal(cursor.prev.features['login-page'].still, 0);

  // A PR the watcher has never seen is unknown, not waiting.
  cursor = { seen: [], prev: observation() };
  const unseen = feature({ status: status({ phase: 'pr-open', pr: 99, updatedAt: iso(5) }) });
  assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': unseen } })), []);
  assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': unseen } })), []);
  assert.equal(run(idle(10 * MIN, { features: { 'login-page': unseen } })).length, 1);

  // A finished feature is never stuck.
  const done = feature({ status: status({ phase: 'done', updatedAt: iso(4) }), report: true });
  for (let i = 0; i < 4; i += 1) assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': done } })), []);

  // An awake figure that is not a number counts as nothing.
  assert.equal(settle(observation(), idle(Number.NaN)).features['login-page'].still, 0);
});

test('after a restart from the cursor, nothing is lost and nothing wakes twice', () => withHome(() => {
  // A question, CI going red, the director's answer and a feature gone still.
  const asked = { 'login-page': feature({ questions: ['q-login-page-1'] }) };
  const red = { 4: prState({ ci: 'failure' }) };
  const observations = [
    observation({ at: iso(1 * MIN), awake: MIN }),
    observation({ at: iso(2 * MIN), awake: MIN, features: asked }),
    observation({ at: iso(3 * MIN), awake: MIN, features: asked, prs: red }),
    observation({ at: iso(4 * MIN), awake: MIN, events: [answerEvent()], features: asked, prs: red }),
    observation({ at: iso(30 * MIN), awake: 26 * MIN, features: asked, prs: red }),
  ];
  const start = { seen: [], prev: observation(), held: null };

  // Runs the watcher over the observations, writing its cursor and starting
  // again from it after each observation listed in `restartAfter`.
  const deliveredBy = (restartAfter) => {
    let clock = 0;
    let cursor = start;
    let bundler = makeBundler({ now: () => clock });
    const delivered = [];
    const deliver = () => {
      for (const b of bundler.due()) {
        delivered.push(...b.events.map((e) => `${b.work ?? b.to} ${e.id}`), ...b.digest.map((e) => `digest ${e.id}`));
      }
    };
    observations.forEach((obs, i) => {
      clock = Date.parse(obs.at);
      const r = step(cursor, obs, { handled: new Set() });
      assert.equal('held' in r.cursor, false, 'the caller sets held from its bundler');
      bundler.add(route(r.events));
      deliver();
      cursor = { ...r.cursor, held: bundler.held() };
      if (restartAfter.has(i)) {
        writeCursor('acme__shop', cursor);
        cursor = readCursor('acme__shop');
        bundler = makeBundler({ now: () => clock, held: cursor.held });
      }
    });
    clock = Infinity;
    deliver();
    return delivered.sort();
  };

  const straight = deliveredBy(new Set());
  assert.ok(straight.includes('foreman q-login-page-1'));
  assert.ok(straight.includes('login-page ci-red:login-page:aaa111'));
  assert.ok(straight.includes('login-page ev-answer'));
  assert.ok(straight.includes('foreman ev-answer'));
  assert.ok(straight.some((x) => x.startsWith('foreman stuck:login-page:')));
  assert.equal(new Set(straight).size, straight.length, 'nothing twice');
  assert.deepEqual(deliveredBy(new Set([0, 1, 2, 3, 4])), straight);
  assert.deepEqual(deliveredBy(new Set([1, 3])), straight);

  // A watcher that stopped before it could write its cursor sees the same
  // changes again from the cursor it last wrote, with the same ids.
  const one = step(start, observations[1], { handled: new Set() });
  writeCursor('acme__shop', { ...one.cursor, held: null });
  const lost = step(readCursor('acme__shop'), observations[2], { handled: new Set() });
  const again = step(readCursor('acme__shop'), observations[3], { handled: new Set() });
  assert.deepEqual(lost.events.map((e) => e.id), ['ci-red:login-page:aaa111']);
  assert.deepEqual(again.events.map((e) => e.id).sort(), ['ci-red:login-page:aaa111', 'ev-answer']);
}));

test('the cursor is written whole, keeps the last 5,000 ids and refuses a link', () => withHome((home) => {
  assert.deepEqual(readCursor('acme__shop'), { seen: [], prev: null, held: null });
  assert.equal(cursorFile('acme__shop'), path.join(home, 'projects', 'acme__shop', 'watcher', 'cursor.json'));
  assert.throws(() => cursorFile('../x'));

  const seen = Array.from({ length: SEEN_CAP + 10 }, (_, i) => `id-${i}`);
  writeCursor('acme__shop', { seen, prev: observation(), held: null });
  const back = readCursor('acme__shop');
  assert.equal(SEEN_CAP, 5000);
  assert.equal(back.seen.length, 5000);
  assert.equal(back.seen[0], 'id-10');
  assert.equal(back.seen.at(-1), `id-${SEEN_CAP + 9}`);
  assert.deepEqual(back.prev, observation());
  const dir = path.dirname(cursorFile('acme__shop'));
  assert.deepEqual(fs.readdirSync(dir), ['cursor.json'], 'no temporary file is left');

  // A malformed cursor reads as a fresh one.
  fs.writeFileSync(cursorFile('acme__shop'), '{"seen": 5}');
  assert.deepEqual(readCursor('acme__shop'), { seen: [], prev: null, held: null });
  assert.throws(() => writeCursor('acme__shop', { seen: 'x', prev: null }), /cursor/);

  if (unix) {
    const elsewhere = path.join(home, 'elsewhere.json');
    fs.writeFileSync(elsewhere, 'keep');
    fs.rmSync(cursorFile('acme__shop'));
    fs.symlinkSync(elsewhere, cursorFile('acme__shop'));
    assert.throws(() => writeCursor('acme__shop', { seen: [], prev: null }), /cursor/);
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'keep');
    assert.deepEqual(readCursor('acme__shop'), { seen: [], prev: null, held: null });
  }
}));

test('a brief changed by anyone but the foreman is tampered, not amended', () => {
  const run = (prevF, nextF, events = []) => route(diff(
    observation({ features: { 'login-page': prevF } }),
    observation({ at: iso(1000), awake: 1000, events, features: { 'login-page': nextF } }),
    { handled: new Set() },
  ));

  // The session rewrites its own brief.
  const edited = run(feature(), feature({ briefHash: 'mine' }));
  assert.deepEqual(types(edited.foreman), ['brief-tampered']);
  assert.equal(edited.foreman[0].id, 'brief-tampered:login-page:mine:0');
  assert.equal(edited.features['login-page'], undefined, 'the session is not told its own edit is a change');
  assert.ok(![...edited.foreman, ...edited.digest].some((e) => e.type === 'amended'));

  // With the director's amend click at the same time: the click is amended, the file still tampered.
  const withClick = run(feature(), feature({ briefHash: 'mine' }), [action('ev-amend', { action: 'amend', work: 'login-page', hash: 'abcdefabcdef' })]);
  assert.deepEqual(types(withClick.foreman), ['amended', 'brief-tampered']);

  // The foreman records the new hash first, then writes the file: the file at
  // the hash before is no alarm, and the file catching up is a change for the session.
  const recorded = feature({ briefHash: 'b1', recordedBrief: 'b2', recordedBefore: 'b1' });
  const midway = run(feature(), recorded);
  assert.deepEqual([...midway.foreman, ...Object.values(midway.features).flat()], []);
  const written = run(recorded, feature({ briefHash: 'b2', recordedBrief: 'b2', recordedBefore: 'b1' }));
  assert.deepEqual(written.foreman, []);
  assert.deepEqual(types(written.features['login-page']), ['brief-changed']);
  assert.equal(written.features['login-page'][0].id, 'brief-changed:login-page:b2:0');

  // Two versions back is not the one before: tampered.
  const old = run(
    feature({ briefHash: 'b2', recordedBrief: 'b3', recordedBefore: 'b2' }),
    feature({ briefHash: 'b1', recordedBrief: 'b3', recordedBefore: 'b2' }),
  );
  assert.deepEqual(types(old.foreman), ['brief-tampered']);

  // A deleted brief is tampered too, unless the whole worktree is gone.
  assert.deepEqual(types(run(feature(), feature({ briefHash: null })).foreman), ['brief-tampered']);
  assert.equal(run(feature(), feature({ briefHash: null })).foreman[0].id, 'brief-tampered:login-page:none:0');
  assert.deepEqual(run(feature(), feature({ briefHash: null, gone: true, status: null })).foreman, []);

  // Tampered once is one wake, however long it stays so.
  const still = run(feature({ briefHash: 'mine' }), feature({ briefHash: 'mine' }));
  assert.deepEqual(still.foreman, []);
});

test('a brief is judged over time: every tampering wakes, and the hash before counts only until the file catches up', () => {
  let cursor = { seen: [], prev: observation() };
  let n = 0;
  const run = (f) => {
    n += 1;
    const r = step(cursor, observation({ at: iso(n * 1000), awake: 1000, features: { 'login-page': f } }), { handled: new Set() });
    cursor = r.cursor;
    const routed = route(r.events);
    return [...routed.foreman, ...Object.values(routed.features).flat()].filter((e) => e.type.startsWith('brief')).map((e) => e.type);
  };

  // Tamper, restore, the same tamper again: two wakes.
  assert.deepEqual(run(feature({ briefHash: 'mine' })), ['brief-tampered']);
  assert.deepEqual(run(feature({ briefHash: 'mine' })), []);
  assert.deepEqual(run(feature()), ['brief-changed']);
  assert.deepEqual(run(feature({ briefHash: 'mine' })), ['brief-tampered']);
  assert.deepEqual(run(feature()), ['brief-changed']);

  // An amendment: recorded first, then written. Going back to the earlier
  // hash once the file has caught up undoes the amendment, so it is tampering.
  const amended = { recordedBrief: 'b2', recordedBefore: 'b1' };
  assert.deepEqual(run(feature({ ...amended, briefHash: 'b1' })), []);
  assert.deepEqual(run(feature({ ...amended, briefHash: 'b1' })), []);
  assert.deepEqual(run(feature({ ...amended, briefHash: 'b2' })), ['brief-changed']);
  assert.deepEqual(run(feature({ ...amended, briefHash: 'b1' })), ['brief-tampered']);
  assert.deepEqual(run(feature({ ...amended, briefHash: 'b2' })), ['brief-changed']);

  // The foreman amends back to the earlier text: the session hears of it again.
  const back = { recordedBrief: 'b1', recordedBefore: 'b2' };
  assert.deepEqual(run(feature({ ...back, briefHash: 'b2' })), []);
  assert.deepEqual(run(feature({ ...back, briefHash: 'b1' })), ['brief-changed']);

  // With nothing recorded, nothing can be tampered, even on a feature's first appearance.
  cursor = { seen: [], prev: observation({ features: {} }) };
  assert.deepEqual(run(feature({ briefHash: 'b9', recordedBrief: null })), []);
  assert.deepEqual(run(feature({ briefHash: 'b8', recordedBrief: null })), []);
  assert.deepEqual(run(feature({ briefHash: null, recordedBrief: null })), []);
});

test('observations that leave out PRs and test merges are judged from their last known state', () => {
  const both = { 'login-page': feature(), 'search-box': feature({ status: status({ work: 'search-box' }) }) };
  let cursor = { seen: [], prev: observation({ features: both }) };
  const run = (over) => {
    const r = step(cursor, observation({ awake: 1000, features: both, ...over }), { handled: new Set() });
    cursor = r.cursor;
    return r.events.map((e) => e.id);
  };
  const clash = [{ a: 'search-box', b: 'login-page', clean: false }];
  const red = { 7: prState({ ci: 'failure' }) };

  assert.deepEqual(run({ testMerges: clash, prs: red }), ['ci-red:login-page:aaa111', 'clash:login-page+search-box:0']);
  assert.deepEqual(run({ testMerges: [], prs: {} }), []);
  assert.deepEqual(cursor.prev.prs, red, 'a PR left out keeps its last known state');
  assert.deepEqual(cursor.prev.testMerges, clash);
  assert.deepEqual(run({ testMerges: clash, prs: red }), [], 'the same clash and the same red CI wake once');

  // A clean run in between makes the next clash new.
  assert.deepEqual(run({ testMerges: [{ a: 'login-page', b: 'search-box', clean: true }] }), []);
  assert.deepEqual(run({ testMerges: clash }), ['clash:login-page+search-box:4']);

  // A PR named null is closed and forgotten.
  run({ prs: { 7: null } });
  assert.deepEqual(cursor.prev.prs, {});
  // The cursor keeps no events.
  assert.equal(cursor.prev.events, undefined);
});

test('a remembered test merge is dropped once either of its features is no longer observed', () => {
  const both = { 'login-page': feature(), 'search-box': feature({ status: status({ work: 'search-box' }) }) };
  const clash = [{ a: 'login-page', b: 'search-box', clean: false }];
  let prev = settle(null, observation({ features: both, testMerges: clash }));
  assert.deepEqual(prev.testMerges, clash);

  // Both features still observed, the pair left out of this observation: it is kept.
  prev = settle(prev, observation({ features: both }));
  assert.deepEqual(prev.testMerges, clash);

  // One of them gone from the observation: the pair goes with it.
  prev = settle(prev, observation({ features: { 'login-page': feature() } }));
  assert.deepEqual(prev.testMerges, []);

  // A pair named in an observation that does not name both features is not kept either.
  prev = settle(prev, observation({ features: { 'login-page': feature() }, testMerges: clash }));
  assert.deepEqual(prev.testMerges, []);

  // When both come back and still clash, the clash wakes again.
  const { events } = step({ seen: [], prev }, observation({ features: both, testMerges: clash }), { handled: new Set() });
  assert.deepEqual(events.map((e) => e.type), ['clash']);
});

test('with no cursor, the first observation is judged against an empty one', () => {
  const next = observation({
    features: { 'login-page': feature({ questions: ['q-login-page-1'] }) },
    prs: { 7: prState({ ci: 'failure' }) },
  });
  const { events } = step({ seen: [], prev: null }, next, { handled: new Set() });
  const routed = route(events);
  assert.deepEqual(types(routed.foreman), ['question']);
  assert.deepEqual(types(routed.features['login-page']), ['ci-red']);
  assert.deepEqual(diff(null, next, { handled: new Set() }).map((e) => e.id), events.map((e) => e.id));
});

test('a status with no tokens never counts as over appetite', () => {
  const withTokens = (tokens, appetite = 400000) => feature({ status: status({ tokens }), appetite });
  const over = (prevF, nextF) => diff(
    observation({ features: { 'login-page': prevF } }),
    observation({ at: iso(1000), awake: 1000, features: { 'login-page': nextF } }),
    { handled: new Set() },
  ).filter((e) => e.type === 'over-appetite');

  assert.deepEqual(over(withTokens(null), withTokens(null)), []);
  assert.deepEqual(over(withTokens(null, 0), withTokens(null, 0)), []);
  assert.deepEqual(over(feature({ status: null }), feature({ status: null, appetite: 0 })), []);
  assert.deepEqual(over(withTokens(100), withTokens(400000)), [], 'at the appetite is not over it');
  assert.deepEqual(over(withTokens(100), withTokens(120, null)), [], 'no appetite known, nothing to be over');

  const found = over(withTokens(100), withTokens(400001));
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'over-appetite:login-page:400000');
  assert.equal(route(found).foreman.length, 1);
  assert.deepEqual(over(withTokens(400001), withTokens(500000)), [], 'over once per appetite');
  assert.equal(over(withTokens(500000), withTokens(900001, 800000)).length, 1, 'a raised appetite can be passed again');
});

test('a plan that is ready wakes the foreman once per arrival, not at every observation', () => {
  const at = (phase, over = {}) => feature({ status: status({ phase, ...over }) });
  let cursor = { seen: [], prev: observation({ features: { 'login-page': at('planning') } }) };
  const run = (f, ms) => {
    const r = step(cursor, observation({ at: iso(ms), awake: 1000, features: { 'login-page': f } }), { handled: new Set() });
    cursor = r.cursor;
    return r.events.filter((e) => e.type === 'plan-ready');
  };

  const ready = run(at('ready-to-build', { task: { n: 0, m: 5 }, updatedAt: iso(1000) }), 1000);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].work, 'login-page');
  assert.equal(ready[0].id, 'plan-ready:login-page:0', 'the count of the observation before it');
  assert.deepEqual(ready[0].detail, { phase: 'ready-to-build', task: { n: 0, m: 5 }, slice: null });
  assert.deepEqual(route(ready).foreman.map((e) => e.id), ['plan-ready:login-page:0']);
  assert.deepEqual(route(ready).features, {});

  // Still ready, however often the status is rewritten: no second wake.
  assert.deepEqual(run(at('ready-to-build', { task: { n: 0, m: 5 }, updatedAt: iso(2000) }), 2000), []);
  assert.deepEqual(run(at('ready-to-build', { task: { n: 0, m: 5 }, updatedAt: iso(3000) }), 3000), []);

  // A phase that leaves and comes back (the next slice's plan) wakes again, with an id of its own.
  assert.deepEqual(run(at('building', { updatedAt: iso(4000) }), 4000), []);
  const slice2 = run(at('ready-to-build', { slice: { n: 2, m: 3 }, updatedAt: iso(5000) }), 5000);
  assert.equal(slice2.length, 1);
  assert.equal(slice2[0].id, 'plan-ready:login-page:4');
  assert.deepEqual(slice2[0].detail.slice, { n: 2, m: 3 });

  // A feature first seen with its plan ready wakes too; one first seen planning does not.
  const first = diff(observation({ features: {} }), observation({
    features: { 'login-page': at('ready-to-build'), 'search-box': feature({ status: status({ work: 'search-box', phase: 'planning' }) }) },
  }), { handled: new Set() });
  assert.deepEqual(first.filter((e) => e.type === 'plan-ready').map((e) => e.work), ['login-page']);
  // A status that can't be read is no plan.
  assert.deepEqual(diff(observation(), observation({ features: { 'login-page': feature({ status: null }) } })).filter((e) => e.type === 'plan-ready'), []);
});

test('a verified incident lift or incident fix wakes the foreman, with the click\'s own id; an unverified one does not', () => {
  const events = [
    action('ev-lift', { action: 'lift-incident', incident: 'bad-deploy' }),
    action('ev-fix', { action: 'incident-fix', incident: 'bad-deploy', pr: 9 }),
    action('ev-lift-forged', { action: 'lift-incident', incident: 'bad-deploy' }, false),
    action('ev-fix-forged', { action: 'incident-fix', incident: 'bad-deploy', pr: 9 }, false),
  ];
  const routed = route(diff(observation(), observation({ events }), { handled: new Set() }));
  assert.deepEqual(routed.foreman.map((e) => [e.type, e.id]), [['lift-incident', 'ev-lift'], ['incident-fix', 'ev-fix']]);
  assert.deepEqual(routed.foreman[0].detail, { incident: 'bad-deploy' });
  assert.equal(routed.foreman[1].pr, 9);
  assert.deepEqual(routed.foreman[1].detail, { incident: 'bad-deploy', pr: 9 });
  assert.deepEqual(routed.features, {});
  assert.deepEqual(routed.digest, []);
});

test('a feature whose phase arrives at done wakes the foreman once with report, to close it (R94)', () => {
  const at = (phase, over = {}) => feature({ status: status({ phase, ...over }) });
  let cursor = { seen: [], prev: observation({ features: { 'login-page': at('pr-open') } }) };
  const run = (f, ms) => {
    const r = step(cursor, observation({ at: iso(ms), awake: 1000, features: { 'login-page': f } }), { handled: new Set() });
    cursor = r.cursor;
    return r.events.filter((e) => e.type === 'report');
  };
  const done = run(at('done', { updatedAt: iso(1000) }), 1000);
  assert.deepEqual(done.map((e) => [e.work, e.id, e.detail.phase]), [['login-page', 'report:login-page:0', 'done']]);
  assert.deepEqual(route(done).foreman.map((e) => e.id), ['report:login-page:0']);
  assert.deepEqual(route(done).features, {});
  // Still done: no second wake.
  assert.deepEqual(run(at('done', { updatedAt: iso(2000) }), 2000), []);
  // A feature first seen done wakes too (a blocked one ends there with no pull request); one planning does not.
  const first = diff(observation({ features: {} }), observation({
    features: { 'login-page': at('done'), 'search-box': feature({ status: status({ work: 'search-box', phase: 'planning' }) }) },
  }), { handled: new Set() });
  assert.deepEqual(first.filter((e) => e.type === 'report').map((e) => e.work), ['login-page']);
});

test('plan-ready is not repeated after a restart from the cursor, and a handled one goes to the digest', () => withHome(() => {
  const at = (phase, ms) => observation({ at: iso(ms), awake: 1000, features: { 'login-page': feature({ status: status({ phase, updatedAt: iso(ms) }) }) } });
  const start = { seen: [], prev: settle(null, at('planning', 0)), held: null };

  const one = step(start, at('ready-to-build', 1000), { handled: new Set() });
  assert.deepEqual(one.events.filter((e) => e.type === 'plan-ready').map((e) => e.id), ['plan-ready:login-page:1']);
  writeCursor('acme__shop', { ...one.cursor, held: null });

  // Restarted from the cursor: still ready is no news.
  const again = step(readCursor('acme__shop'), at('ready-to-build', 2000), { handled: new Set() });
  assert.deepEqual(again.events.filter((e) => e.type === 'plan-ready'), []);

  // Stopped before the cursor was written: the same arrival comes again with the same id.
  const lost = step(start, at('ready-to-build', 1500), { handled: new Set() });
  assert.deepEqual(lost.events.filter((e) => e.type === 'plan-ready').map((e) => e.id), ['plan-ready:login-page:1']);
  // And once seen, never again, even judged against an older observation.
  assert.deepEqual(diff(start.prev, at('ready-to-build', 3000), { seen: new Set(one.cursor.seen) }).filter((e) => e.type === 'plan-ready'), []);

  // A plan-ready the foreman has handled goes to the digest, not to a wake.
  const handled = route(diff(start.prev, at('ready-to-build', 1000), { handled: new Set(['plan-ready:login-page:1']) }));
  assert.deepEqual(handled.foreman, []);
  assert.deepEqual(handled.digest.filter((e) => e.type === 'plan-ready').map((e) => e.id), ['plan-ready:login-page:1']);
}));

test('the foreman recording a feature as building wakes that session to build', () => {
  const featureEvent = (id, data) => ({ id, kind: 'feature', data: { work: 'login-page', ...data }, verified: false });
  const next = observation({
    at: iso(1000),
    awake: 1000,
    events: [
      featureEvent('ev-started', { step: 'started', brief: 'b1' }),
      featureEvent('ev-planned', { step: 'planned' }),
      featureEvent('ev-build', { step: 'building', slice: { n: 1, m: 2 } }),
      featureEvent('ev-paused', { step: 'paused' }),
      // An amendment's hash, recorded at the feature's current step (ruling R85), is not a go-ahead.
      featureEvent('ev-amended-hash', { step: 'building', brief: 'h' }),
    ],
  });
  const events = diff(observation(), next, { handled: new Set() });
  const builds = events.filter((e) => e.type === 'build');
  assert.deepEqual(builds.map((e) => [e.work, e.id]), [['login-page', 'ev-build']], 'only building with no brief, with the state event\'s own id');
  assert.deepEqual(diff(observation(), observation({ events: [featureEvent('ev-h', { step: 'building', brief: 'h' })] })).filter((e) => e.type === 'build'), []);
  assert.deepEqual(builds[0].detail, { slice: { n: 1, m: 2 } });

  const routed = route(builds);
  assert.deepEqual(routed.features['login-page'].map((e) => e.id), ['ev-build']);
  assert.deepEqual(routed.foreman, []);
  assert.deepEqual(routed.digest, []);

  // The foreman wrote it, so it is among the handled ids: it still reaches the session, and never the foreman.
  const handled = route(diff(observation(), next, { handled: new Set(['ev-started', 'ev-planned', 'ev-build', 'ev-paused', 'ev-amended-hash']) }));
  assert.deepEqual(handled.features['login-page'].map((e) => e.id), ['ev-build']);
  assert.deepEqual(handled.foreman, []);
  assert.deepEqual(handled.digest.filter((e) => e.type === 'build'), []);

  // A feature event with no work to wake is nothing.
  assert.deepEqual(diff(observation(), observation({ events: [{ id: 'ev-x', kind: 'feature', data: { step: 'building' } }] })).filter((e) => e.type === 'build'), []);
});

test('a bug no one is shown first starts as quick work does; a visible one waits for its approval', () => {
  const work = (id, over) => ({ id: `ev-${id}`, kind: 'work', data: { id, title: id, lane: 'bug', visible: false, dependsOn: [], ...over }, verified: false });
  const events = diff(observation(), observation({ events: [work('quiet-bug', {}), work('shown-bug', { visible: true })] }), { handled: new Set() });
  assert.deepEqual(events.map((e) => [e.type, e.work, e.id, e.detail]), [['work-ready', 'quiet-bug', 'ev-quiet-bug', { lane: 'bug' }]]);
  assert.deepEqual(route(events).foreman.map((e) => e.work), ['quiet-bug']);
  // Small and feature work still needs its signed approval.
  assert.deepEqual(diff(observation(), observation({ events: [work('a-small', { lane: 'small' }), work('a-feature', { lane: 'feature' })] })), []);
});
