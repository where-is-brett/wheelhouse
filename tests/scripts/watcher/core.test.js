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
  assert.equal(byType.stop, `stop:${iso(0)}`);
  assert.equal(byType.clash, `clash:login-page+search-box:${iso(0)}`);
  assert.equal(byType['task-done'], 'task-done:login-page:1');

  // Nothing changed is nothing to say, and unverified clicks count for nothing.
  assert.deepEqual(diff(next, next, { handled: new Set() }), []);
  const forged = observation({
    events: [
      action('ev-f1', { action: 'approve-work', work: 'new-footer', lane: 'small', hash: 'abcdefabcdef', shownFirst: false }, false),
      action('ev-f2', { action: 'amend', work: 'login-page', hash: 'abcdefabcdef' }, false),
      action('ev-f3', { action: 'answer', questionId: 'q-login-page-1', questionHash: 'abcdefabcdef', label: 'A' }, false),
      { id: 'ev-visible-quick', kind: 'work', data: { id: 'shown', title: 'Shown', lane: 'quick', visible: true, dependsOn: [] }, verified: false },
    ],
  });
  assert.deepEqual(diff(observation(), forged, { handled: new Set() }), []);

  // The first observation is the starting point: it wakes no one.
  assert.deepEqual(diff(null, next, { handled: new Set() }), []);
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
  assert.deepEqual(out.map((b) => b.to).sort(), ['foreman', 'login-page']);
  const foreman = out.find((b) => b.to === 'foreman');
  assert.deepEqual(foreman.events.map((e) => e.id), ['f1', 'f2']);
  assert.deepEqual(foreman.digest.map((e) => e.id), ['d1', 'd2']);
  const feat = out.find((b) => b.to === 'login-page');
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
  const red = { 7: prState({ ci: 'failure' }) };
  assert.deepEqual(run(idle(10 * MIN, { features: { 'login-page': open }, prs: red })), []);
  assert.equal(run(idle(10 * MIN, { features: { 'login-page': open }, prs: red })).length, 1);

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
    observation({ at: iso(30 * MIN), awake: 26 * MIN, events: [answerEvent()], features: asked, prs: red }),
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
        delivered.push(...b.events.map((e) => `${b.to} ${e.id}`), ...b.digest.map((e) => `digest ${e.id}`));
      }
    };
    observations.forEach((obs, i) => {
      clock = Date.parse(obs.at);
      const r = step(cursor, obs, { handled: new Set() });
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
  assert.equal(edited.foreman[0].id, 'brief-tampered:login-page:mine');
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
  assert.equal(written.features['login-page'][0].id, 'brief-changed:login-page:b2');

  // Two versions back is not the one before: tampered.
  const old = run(
    feature({ briefHash: 'b2', recordedBrief: 'b3', recordedBefore: 'b2' }),
    feature({ briefHash: 'b1', recordedBrief: 'b3', recordedBefore: 'b2' }),
  );
  assert.deepEqual(types(old.foreman), ['brief-tampered']);

  // A brief with no recorded hash at all is not the foreman's.
  const unrecorded = run(feature({ recordedBrief: null }), feature({ briefHash: 'b9', recordedBrief: null }));
  assert.deepEqual(types(unrecorded.foreman), ['brief-tampered']);

  // Tampered once is one wake, however long it stays so.
  const still = run(feature({ briefHash: 'mine' }), feature({ briefHash: 'mine' }));
  assert.deepEqual(still.foreman, []);
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
