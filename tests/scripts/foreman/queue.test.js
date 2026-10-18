// tests/scripts/foreman/queue.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileMapOf, clashCheck, nextWork } from '../../../scripts/foreman/queue.js';
import { PACE } from '../../../scripts/lib/build-loop.js';

const HOT = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '**/migrations/**'];
const T = (n) => `2026-10-18T02:00:${String(n).padStart(2, '0')}.000Z`;
const NOW = '2026-10-19T00:00:00.000Z';

test('fileMapOf reads the plan\'s Files lists', () => {
  const plan = [
    '# A plan',
    '',
    '### Task 1: One',
    '',
    '**Files:**',
    '- Create: `scripts/a.js`',
    '- Modify: `scripts/b.js:10-20`, `package.json`',
    '- Test: `tests/a.test.js`',
    '',
    '- [ ] **Step 1: Write it.** Edit `scripts/not-a-file.js` and run `npm test`.',
    '- Create: `scripts/stray.js`',
    '',
    '### Task 2: Two',
    '**Files:**',
    '- Modify: `scripts/b.js:3`',
    '- Modify: `scripts/c.js:1-2,40-50`',
    '- Test: `tests/c.test.js`',
    '',
    'Some prose naming `scripts/prose.js`.',
  ].join('\n');
  assert.deepEqual(fileMapOf(plan), ['scripts/a.js', 'scripts/b.js', 'package.json', 'tests/a.test.js', 'scripts/c.js', 'tests/c.test.js']);
  assert.deepEqual(fileMapOf(''), []);
  assert.deepEqual(fileMapOf('- Create: `scripts/x.js`'), [], 'a line outside a Files list is not read');
});

test('two plans changing the same hot file clash; the second waits with its plan ready', () => {
  const running = [{ work: 'export-csv', files: ['src/export.js', 'package.json'] }];
  const found = clashCheck({ files: ['src/login.js', 'package.json'], running, hotFiles: HOT });
  assert.equal(found.ok, false);
  assert.deepEqual(found.clashes, [{ work: 'export-csv', file: 'package.json', hot: true }]);
  // A shared file that is not hot clashes too, but is not marked hot.
  const plain = clashCheck({ files: ['src/export.js'], running, hotFiles: HOT });
  assert.deepEqual(plain.clashes, [{ work: 'export-csv', file: 'src/export.js', hot: false }]);
  // Nothing in common.
  assert.deepEqual(clashCheck({ files: ['src/login.js'], running, hotFiles: HOT }), { ok: true, clashes: [] });
  assert.deepEqual(clashCheck({ files: ['src/login.js'], running: [], hotFiles: HOT }), { ok: true, clashes: [] });
  // One clash per work and file, however many ways it is found.
  const many = clashCheck({ files: ['package.json'], running: [{ work: 'a', files: ['package.json'] }, { work: 'b', files: ['package.json'] }], hotFiles: HOT });
  assert.deepEqual(many.clashes, [{ work: 'a', file: 'package.json', hot: true }, { work: 'b', file: 'package.json', hot: true }]);
});

test('two new migrations clash by the hot pattern', () => {
  const running = [{ work: 'export-csv', files: ['db/migrations/0004_exports.sql'] }];
  const found = clashCheck({ files: ['db/migrations/0005_logins.sql'], running, hotFiles: HOT });
  assert.equal(found.ok, false);
  assert.deepEqual(found.clashes, [{ work: 'export-csv', file: 'db/migrations/0005_logins.sql', hot: true }]);
  // Matching different patterns is no clash.
  assert.equal(clashCheck({ files: ['yarn.lock'], running: [{ work: 'x', files: ['package.json'] }], hotFiles: HOT }).ok, true);
  // With no hot patterns only a shared file clashes.
  assert.equal(clashCheck({ files: ['db/migrations/0005_logins.sql'], running, hotFiles: [] }).ok, true);
  // Case is ignored, as on the machines the director's files live on.
  assert.equal(clashCheck({ files: ['SRC/Export.js'], running: [{ work: 'x', files: ['src/export.js'] }], hotFiles: [] }).ok, false);
});

// Work, features and reports as the views hold them.
const mkWork = (id, lane, n, extra = {}) => ({
  work: { key: id, id: `w-${id}`, at: T(n), data: { id, title: id, lane, visible: false, dependsOn: [], ...extra } },
  approved: lane !== 'quick',
});
const worksOf = (...list) => Object.fromEntries(list.map((w) => [w.work.key, w]));
const mkFeature = (id, step, n) => ({ key: id, id: `f-${id}-${n}`, at: T(n), data: { work: id, step } });
const featuresOf = (...list) => Object.fromEntries(list.map((f) => [f.key, f]));
const merged = (id) => ({ [id]: { key: id, id: `r-${id}`, at: T(1), data: { work: id, outcome: 'merged', summary: 's', rulings: [] } } });
const next = (input) => nextWork({ work: {}, features: {}, reports: {}, now: NOW, fiveHourTight: false, ...input });

test('pace allows three building, one in the feature lane', () => {
  assert.deepEqual(PACE, { building: 3, featureLane: 1 });
  const work = worksOf(
    mkWork('f1', 'feature', 1, { place: 1 }), mkWork('f2', 'feature', 2, { place: 2 }),
    mkWork('s1', 'small', 3, { place: 3 }), mkWork('b1', 'bug', 4, { place: 4 }), mkWork('s2', 'small', 5, { place: 5 }),
  );
  // Nothing building: the first feature, then the others up to three slots.
  const fresh = next({ work });
  assert.deepEqual(fresh.start, ['f1', 's1', 'b1']);
  assert.deepEqual(fresh.hold, [{ work: 'f2', why: 'pace' }, { work: 's2', why: 'pace' }]);
  assert.deepEqual(fresh.pause, []);
  // A feature already building takes the feature lane's slot and one of the three.
  const busy = next({ work, features: featuresOf(mkFeature('f1', 'building', 6)) });
  assert.deepEqual(busy.start, ['s1', 'b1']);
  assert.deepEqual(busy.hold, [{ work: 'f2', why: 'pace' }, { work: 's2', why: 'pace' }]);
  // Three building: nothing more starts.
  const full = next({ work, features: featuresOf(mkFeature('f1', 'building', 6), mkFeature('s1', 'building', 7), mkFeature('b1', 'building', 8)) });
  assert.deepEqual(full.start, []);
  assert.deepEqual(full.hold, [{ work: 'f2', why: 'pace' }, { work: 's2', why: 'pace' }]);
  // Pace counts slots, not sessions: a session that has only started and not yet planned holds none.
  const planning = next({ work, features: featuresOf(mkFeature('f1', 'started', 6), mkFeature('s1', 'planned', 7), mkFeature('b1', 'paused', 8)) });
  assert.deepEqual(planning.start, ['f1', 's1', 'b1']);
  // Quick work started holds a slot at once; closed work and work that holds a slot are in neither list.
  const quickWork = worksOf(mkWork('q1', 'quick', 1), mkWork('s1', 'small', 2), mkWork('s2', 'small', 3), mkWork('s3', 'small', 4), mkWork('s4', 'small', 5));
  const quick = next({ work: quickWork, features: featuresOf(mkFeature('q1', 'started', 6), mkFeature('s4', 'closed', 7)) });
  assert.deepEqual(quick.start, ['s1', 's2']);
  assert.deepEqual(quick.hold, [{ work: 's3', why: 'pace' }]);
  // A feature-lane item held back by the lane's limit does not hold up later work.
  const lane = next({ work: worksOf(mkWork('f1', 'feature', 1), mkWork('f2', 'feature', 2), mkWork('s1', 'small', 3)) });
  assert.deepEqual(lane.start, ['f1', 's1']);
  assert.deepEqual(lane.hold, [{ work: 'f2', why: 'pace' }]);
});

test('work is taken in order of place, then age', () => {
  const work = worksOf(
    mkWork('late', 'small', 1), mkWork('b', 'small', 3, { place: 2 }), mkWork('a', 'small', 5, { place: 1 }), mkWork('c', 'small', 2, { place: 2 }),
  );
  const found = next({ work });
  assert.deepEqual(found.start, ['a', 'c', 'b']);
  assert.deepEqual(found.hold, [{ work: 'late', why: 'pace' }]);
});

test('small and feature work never starts without an approval; quick work and bugs need one only when shown first', () => {
  const unapproved = (w) => ({ ...w, approved: false });
  const work = worksOf(
    unapproved(mkWork('s1', 'small', 1)), unapproved(mkWork('f1', 'feature', 2)), unapproved(mkWork('b-quiet', 'bug', 3)),
    unapproved(mkWork('q-quiet', 'quick', 4)), unapproved(mkWork('q-seen', 'quick', 5, { visible: true })),
    unapproved(mkWork('b-seen', 'bug', 6, { visible: true })),
  );
  const found = next({ work });
  assert.deepEqual(found.start, ['b-quiet', 'q-quiet']);
  assert.deepEqual(found.hold, [
    { work: 's1', why: 'unapproved' }, { work: 'f1', why: 'unapproved' }, { work: 'q-seen', why: 'unapproved' }, { work: 'b-seen', why: 'unapproved' },
  ]);

  // Approved, each starts in its turn.
  const approved = worksOf(mkWork('s2', 'small', 1), { ...mkWork('b-seen', 'bug', 2, { visible: true }), approved: true });
  assert.deepEqual(next({ work: approved }).start, ['s2', 'b-seen']);
});

test('work whose dependencies have not merged waits', () => {
  const work = worksOf(
    mkWork('a', 'small', 1, { dependsOn: ['base'] }), mkWork('b', 'small', 2, { dependsOn: ['base', 'other'] }),
    mkWork('c', 'small', 3, { dependsOn: ['gone'] }), mkWork('d', 'small', 4),
  );
  const found = next({ work, reports: { ...merged('base'), other: { key: 'other', id: 'r', at: T(1), data: { work: 'other', outcome: 'closed', summary: 's', rulings: [] } } } });
  assert.deepEqual(found.start, ['a', 'd']);
  assert.deepEqual(found.hold, [{ work: 'b', why: 'dependency' }, { work: 'c', why: 'dependency' }]);
  // An unapproved item says so before its dependency.
  const first = next({ work: worksOf({ ...mkWork('a', 'small', 1, { dependsOn: ['base'] }), approved: false }) });
  assert.deepEqual(first.hold, [{ work: 'a', why: 'unapproved' }]);
});

test('under five-hour pressure the newest work pauses first', () => {
  const work = worksOf(mkWork('a', 'small', 1), mkWork('b', 'small', 2), mkWork('c', 'small', 3), mkWork('d', 'small', 4));
  const features = featuresOf(mkFeature('a', 'building', 10), mkFeature('b', 'building', 12), mkFeature('c', 'paused', 14));
  const tight = next({ work, features, fiveHourTight: true });
  assert.deepEqual(tight.pause, ['b']);
  assert.deepEqual(tight.start, []);
  assert.deepEqual(tight.hold, [{ work: 'c', why: 'pace' }, { work: 'd', why: 'pace' }]);
  // A quick item that has started holds a slot and can be the one to pause.
  const quick = next({ work: worksOf(mkWork('a', 'small', 1), mkWork('q', 'quick', 2)), features: featuresOf(mkFeature('a', 'building', 5), mkFeature('q', 'started', 9)), fiveHourTight: true });
  assert.deepEqual(quick.pause, ['q']);
  // Nothing building: nothing to pause, and nothing starts.
  const idle = next({ work, fiveHourTight: true });
  assert.deepEqual(idle.pause, []);
  assert.deepEqual(idle.start, []);
  assert.equal(idle.hold.length, 4);
  // Without the pressure nothing pauses.
  assert.deepEqual(next({ work, features, fiveHourTight: false }).pause, []);
});

test('fileMapOf leaves out identifiers in a parenthetical note', () => {
  const plan = [
    '**Files:**',
    '- Create: `scripts/foreman/queue.js`',
    '- Modify: `scripts/gate/guardrails.js` (`hotFiles` and `flagFiles` in `Config`)',
    '- Modify: `src/(admin)/page.js:4-9`, `LICENSE` (see `mergeAnswer`)',
    '- Test: `tests/scripts/foreman/queue.test.js`',
  ].join('\n');
  assert.deepEqual(fileMapOf(plan), ['scripts/foreman/queue.js', 'scripts/gate/guardrails.js', 'src/(admin)/page.js', 'LICENSE', 'tests/scripts/foreman/queue.test.js']);
  const other = ['**Files:**', '- Modify: `scripts/state/views.js` (`Config` too)'].join('\n');
  assert.equal(clashCheck({ files: fileMapOf(plan), running: [{ work: 'b', files: fileMapOf(other) }], hotFiles: HOT }).ok, true, 'the same identifier in two notes is no clash');
});

test('work whose report says merged or closed is not queued again; a blocked one is', () => {
  const report = (id, outcome) => ({ [id]: { key: id, id: `r-${id}`, at: T(1), data: { work: id, outcome, summary: 's', rulings: [] } } });
  const work = worksOf(mkWork('a', 'small', 1), mkWork('b', 'small', 2), mkWork('c', 'small', 3), mkWork('d', 'small', 4));
  const reports = { ...report('a', 'merged'), ...report('b', 'closed'), ...report('c', 'blocked') };
  const found = next({ work, reports });
  assert.deepEqual(found.start, ['c', 'd']);
  assert.deepEqual(found.hold, []);
});

test('work is ordered by when it was first recorded, not by its latest event', () => {
  const rerecorded = { ...mkWork('a', 'small', 9), since: T(1) };
  const work = worksOf(rerecorded, mkWork('b', 'small', 5), mkWork('c', 'small', 6), mkWork('d', 'small', 7));
  const found = next({ work });
  assert.deepEqual(found.start, ['a', 'b', 'c']);
  assert.deepEqual(found.hold, [{ work: 'd', why: 'pace' }]);
});
