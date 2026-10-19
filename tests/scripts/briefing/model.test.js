// tests/scripts/briefing/model.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHome } from '../../helpers/homes.js';
import { briefingModel } from '../../../scripts/briefing/model.js';
import { markRaised } from '../../../scripts/usage/figures.js';
import { NOT_NOW_STEP } from '../../../scripts/board/model.js';
import { WINDOWS_LINE, UNATTENDED_LINE, LOCKED_UNATTENDED_LINE } from '../../../scripts/lib/platform-lines.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const at = (day, hour = 0) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
const never = () => false;

// A board model as boardModel makes it, with only what a test names in it.
function board({ first = [], waiting = [], changed = [], health = [], features = [], pullRequests = [], missing = [] } = {}) {
  return {
    project: 'demo',
    builtAt: NOW.toISOString(),
    director: {
      first,
      waiting,
      launch: { phase: null, resolved: 0, total: 0, blockers: [], next: [] },
      inProgress: { quick: [], small: [], feature: [], bug: [] },
      changed,
      ideas: { now: [], next: [], later: [] },
      health,
      budget: { week: null, share: null, setting: 'report', unusual: [] },
      rulings: [],
    },
    build: { features, pullRequests, quality: { reviews: 0, withFindings: 0, findings: 0 }, decisions: [], risks: [], usage: {} },
    missing,
  };
}
const sourcesWith = (over = {}) => ({ at: at(18), sources: [], newModels: [], newLinks: [], retiring: [], releases: [], advisories: [], ...over });
const usageWith = (over = {}) => ({ week: { tokens: null, usd: null, share: null }, unusual: [], missing: [], ...over });

test('only what changed since the last briefing is in it', () => {
  const model = board({
    waiting: [{ n: 1, what: 'Choose the sign-up colour', since: at(10) }],
    changed: [
      { what: 'Sign-up works on phones', at: at(18) },
      { what: 'Pull request #7 merged', at: at(17) },
      { what: 'Prices show in dollars', at: at(10) },
    ],
    features: [
      { work: 'search', title: 'Search', lane: 'feature', step: 'building', slice: { n: 2, m: 5 }, pr: 12 },
      { work: 'dark', title: 'Dark mode', lane: 'small', step: 'building', slice: null, pr: null },
      { work: 'logo', title: 'Logo', lane: 'quick', step: 'planned', slice: null, pr: null },
    ],
    pullRequests: [
      { pr: 12, work: 'search', review: 'none', findings: null },
      { pr: 14, work: 'login', review: 'findings', findings: 2 },
      { pr: 15, work: null, review: 'findings', findings: null },
      { pr: 16, work: 'dark', review: 'clean', findings: 0 },
    ],
  });
  const since = briefingModel({ model, usage: usageWith(), sources: null, since: at(15), now: NOW, wasRaised: never });
  assert.deepEqual(since.changed, ['Sign-up works on phones']);
  assert.deepEqual(since.progress, [
    '2 pull requests merged',
    'Building Search, slice 2 of 5',
    'Building Dark mode',
    'Pull request #12 for Search is waiting on CI or review',
    'Pull request #14 for login is waiting on fixes: its review found 2 problems',
    'Pull request #15 is waiting on fixes: its review found problems',
  ]);
  // What waits is shown whenever it waits, not only when it is new.
  assert.deepEqual(since.waiting, ['Choose the sign-up colour']);

  const all = briefingModel({ model, usage: usageWith(), sources: null, since: null, now: NOW, wasRaised: never });
  assert.deepEqual(all.changed, ['Sign-up works on phones', 'Prices show in dollars']);
  assert.equal(all.progress[0], '3 pull requests merged');

  // A since that can't be read, or that is after now, counts as no since.
  for (const odd of ['yesterday', at(25), 42]) {
    assert.deepEqual(briefingModel({ model, usage: usageWith(), since: odd, now: NOW, wasRaised: never }).changed, all.changed);
  }
  const later = briefingModel({ model, usage: usageWith(), since: at(19, 6), now: NOW, wasRaised: never });
  assert.deepEqual(later.changed, []);
  assert.equal(later.progress.some((line) => line.includes('merged')), false);
});

test('an unusual item is in one briefing and not the next', () => withHome(() => {
  const usage = usageWith({
    unusual: [
      { kind: 'session', id: 'session:abc', tokens: 1200000, median: 300000, cause: 'a long test run', unit: 'tokens' },
      { kind: 'day', id: 'day:2026-10-18', tokens: 42, median: 9.5, cause: 'many reviews', unit: 'usd' },
      { kind: 'feature', id: 'feature:search', tokens: 'lots', median: 1, cause: 'x', unit: 'tokens' },
    ],
  });
  const lines = [
    'One session used 1.2M tokens, against a usual 300K: a long test run',
    '18 October 2026 used $42, against a usual $10: many reviews',
  ];
  const raised = new Set();
  const first = briefingModel({ model: board(), usage, sources: null, since: null, now: NOW, wasRaised: (id) => raised.has(id) });
  assert.deepEqual(first.watch, lines);
  assert.deepEqual(first.raise, ['session:abc', 'day:2026-10-18']);
  for (const id of first.raise) raised.add(id);
  const second = briefingModel({ model: board(), usage, sources: null, since: null, now: NOW, wasRaised: (id) => raised.has(id) });
  assert.deepEqual(second.watch, []);
  assert.deepEqual(second.raise, []);

  // The model only reports what it included; marking them raised is the caller's, through the real store.
  const real = briefingModel({ model: board(), usage, sources: null, since: null, now: NOW });
  assert.deepEqual(real.watch, lines);
  markRaised(real.raise, { now: NOW });
  const after = briefingModel({ model: board(), usage, sources: null, since: null, now: NOW });
  assert.deepEqual(after.watch, []);
  assert.deepEqual(after.raise, []);

  // Unusual use is news, so it opens `watch`, before the health lines that stand each time.
  const health = board({ health: [{ level: 'watch', text: 'The weekly allowance is 90% used' }] });
  const both = briefingModel({ model: health, usage, sources: null, since: null, now: NOW, wasRaised: never });
  assert.deepEqual(both.watch, [...lines, 'The weekly allowance is 90% used']);
  assert.deepEqual(both.raise, ['session:abc', 'day:2026-10-18']);

  // A check that throws leaves the item in: telling twice is better than not telling.
  const throws = briefingModel({ model: board(), usage, now: NOW, wasRaised: () => { throw new Error('no'); } });
  assert.deepEqual(throws.watch, lines);
}));

test('a routed model retiring soon, a new model and changed official pages are things to watch', () => {
  const retiring = 'Model X, a model your projects use, retires on 1 November 2026';
  const model = board({
    health: [
      { level: 'ok', text: 'Protection: Standard' },
      { level: 'watch', text: retiring },
      { level: 'stop', text: 'Incident i1 is open, so nothing merges: checkout down' },
      { level: 'watch', text: 'A security advisory for o/n: a bad parser' },
    ],
    missing: ['Usage counts aren\'t on yet', '2 records couldn\'t be read'],
  });
  const sources = sourcesWith({
    sources: [
      { id: 'models', ok: true, changed: true },
      { id: 'changelog', ok: true, changed: false },
      { id: 'deprecations', ok: true, changed: true },
      { id: 'prompting', ok: false, changed: false },
      { id: 'releases:o/n', ok: true, changed: true },
      { id: 'advisories:o/n', ok: true, changed: true },
    ],
    newModels: ['model-new'],
    retiring: [{ model: 'Model X', date: '2026-11-01', routed: true, soon: true }],
    advisories: [{ repo: 'o/n', id: 'GHSA-1', summary: 'a bad parser', at: at(17) }],
  });
  const since = briefingModel({ model, usage: usageWith(), sources, since: at(15), now: NOW, wasRaised: never });
  assert.deepEqual(since.watch, [
    retiring,
    'Incident i1 is open, so nothing merges: checkout down',
    'A security advisory for o/n: a bad parser',
    'A new model to test: model-new',
    'Anthropic\'s models overview page changed',
    'Anthropic\'s model deprecations page changed',
    'o/n has new releases',
    '2 records couldn\'t be read',
  ]);
  // The health lines already carry retirements and advisories, so they are said once.
  assert.equal(since.watch.filter((line) => line.includes('Model X')).length, 1);
  assert.equal(since.watch.filter((line) => line.includes('advisory')).length, 1);

  // A sources report from before the last briefing has nothing new in it.
  const later = briefingModel({ model, usage: usageWith(), sources, since: at(19, 6), now: NOW, wasRaised: never });
  assert.deepEqual(later.watch, [retiring, 'Incident i1 is open, so nothing merges: checkout down', 'A security advisory for o/n: a bad parser', '2 records couldn\'t be read']);
  // Text from a report is data: one plain line each.
  const odd = briefingModel({ model: board(), sources: sourcesWith({ newModels: ['[new](https://x.test)\n# model'] }), now: NOW, wasRaised: never });
  assert.deepEqual(odd.watch, ['A new model to test: new model']);
});

test('usage reads as tokens, dollars and the share, leaving out what is missing', () => {
  const usageLine = (week) => briefingModel({ model: board(), usage: usageWith({ week }), now: NOW, wasRaised: never }).usage;
  assert.equal(usageLine({ tokens: 1200000, usd: 84.3, share: 34.2 }), 'Usage this week: 1.2M tokens, about $84 at API prices, 34% of your weekly allowance.');
  assert.equal(usageLine({ tokens: 340000, usd: 0.4, share: null }), 'Usage this week: 340K tokens, about $0.40 at API prices.');
  assert.equal(usageLine({ tokens: 950 }), 'Usage this week: 950 tokens.');
  assert.equal(usageLine({ share: 34 }), 'Usage this week: 34% of your weekly allowance.');
  assert.equal(usageLine({ tokens: null, usd: 'lots', share: Number.NaN }), null);
  assert.equal(usageLine(null), null);
  assert.equal(briefingModel({ model: board(), usage: null, now: NOW, wasRaised: never }).usage, null);
});

test('unconfirmed changes and what waits come straight from the board model', () => {
  const model = board({
    first: ['A ruling: Never email on Sundays, not yet confirmed by you'],
    waiting: [{ n: 1, what: 'Choose the sign-up colour', since: at(10) }, { n: 2, what: 'Approve the plan', since: null }],
  });
  const b = briefingModel({ model, usage: null, sources: null, since: at(15), now: NOW, wasRaised: never });
  // The briefing's heading says they aren't confirmed, so the lines don't say it again.
  assert.deepEqual(b.first, ['A ruling: Never email on Sundays']);
  assert.deepEqual(b.waiting, ['Choose the sign-up colour', 'Approve the plan']);
  // Nothing in it throws, whatever it is given.
  for (const odd of [undefined, null, {}, { model: 'x' }, { model: { director: 7, build: [], missing: 'x' }, usage: 3, sources: [] }]) {
    assert.deepEqual(briefingModel(odd), { first: [], waiting: [], changed: [], progress: [], watch: [], usage: null, raise: [] });
  }
});

test('Unattended is repeated in the first briefing of each week, Monday in the director\'s time', () => {
  const health = [
    { level: 'ok', text: 'Protection: Standard' },
    { level: 'watch', text: WINDOWS_LINE },
    { level: 'watch', text: UNATTENDED_LINE },
    { level: 'watch', text: 'This project has no CI, so nothing can merge' },
  ];
  const model = board({ health });
  // NOW is Monday 19 October 2026, 12:00 in UTC.
  const watch = (since, timeZone) => briefingModel({ model, usage: null, since, now: NOW, wasRaised: never, timeZone }).watch;
  const every = [WINDOWS_LINE, UNATTENDED_LINE, 'This project has no CI, so nothing can merge'];
  const without = [WINDOWS_LINE, 'This project has no CI, so nothing can merge'];
  assert.deepEqual(watch(null, 'UTC'), every, 'no briefing before');
  assert.deepEqual(watch(at(18, 23), 'UTC'), every, 'the last was on Sunday');
  assert.deepEqual(watch(at(12, 9), 'UTC'), every, 'the last was a week ago');
  assert.deepEqual(watch(at(19, 0), 'UTC'), without, 'the last was this Monday');
  assert.deepEqual(watch(at(19, 11), 'UTC'), without);
  // In Sydney, 14:00 on Sunday in UTC is already Monday; in Los Angeles, 06:00 on Monday is still Sunday.
  assert.deepEqual(watch(at(18, 14), 'Australia/Sydney'), without);
  assert.deepEqual(watch(at(18, 14), 'UTC'), every);
  assert.deepEqual(watch(at(19, 6), 'America/Los_Angeles'), every);
  assert.deepEqual(watch(at(19, 6), 'UTC'), without);
  // A last briefing that can't be read, or is after now, counts as none.
  assert.deepEqual(watch('yesterday', 'UTC'), every);
  assert.deepEqual(watch(at(20), 'UTC'), every);
  // With no time zone given, it is this computer's own.
  const local = new Date(NOW);
  local.setHours(0, 0, 0, 0);
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  assert.deepEqual(watch(new Date(local.getTime() + 1000).toISOString()), without);
  assert.deepEqual(watch(new Date(local.getTime() - 1000).toISOString()), every);
});

test('the Locked line is weekly too, and with neither line the briefing carries nothing new', () => {
  const locked = board({ health: [{ level: 'watch', text: WINDOWS_LINE }, { level: 'watch', text: LOCKED_UNATTENDED_LINE }] });
  const watch = (model, since) => briefingModel({ model, usage: null, since, now: NOW, wasRaised: never, timeZone: 'UTC' }).watch;
  assert.deepEqual(watch(locked, at(18)), [WINDOWS_LINE, LOCKED_UNATTENDED_LINE]);
  assert.deepEqual(watch(locked, at(19, 1)), [WINDOWS_LINE]);
  const plain = board({ health: [{ level: 'watch', text: WINDOWS_LINE }, { level: 'ok', text: 'Build commands run at low integrity on this Windows computer: they can\'t change files outside the project, but can still use the network.' }] });
  assert.deepEqual(watch(plain, at(18)), [WINDOWS_LINE]);
  assert.deepEqual(watch(board(), null), []);
  // A time zone that isn't one leaves the rest of the briefing standing.
  const odd = briefingModel({ model: locked, usage: null, since: null, now: NOW, wasRaised: never, timeZone: 'Nowhere/Else' });
  assert.ok(odd.watch.includes(WINDOWS_LINE));
});

test('a feature held by Not now to its build commands reads as waiting on the director', () => {
  const model = board({
    features: [
      { work: 'login', title: 'Log in', lane: 'feature', step: NOT_NOW_STEP, slice: { n: 1, m: 3 }, pr: null },
      { work: 'search', title: 'Search', lane: 'feature', step: 'building', slice: null, pr: null },
    ],
  });
  const b = briefingModel({ model, usage: null, since: null, now: NOW, wasRaised: never });
  assert.deepEqual(b.progress, ['Log in is waiting on you to allow its build commands', 'Building Search']);
  assert.equal(NOT_NOW_STEP, 'waiting on you to allow its build commands');
});
