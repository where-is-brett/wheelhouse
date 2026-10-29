// tests/scripts/engine/words.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STEP_WORDS, stepWords, costWords, runLine, shippedLine, buildLines, shippedLines, runningLines } from '../../../scripts/engine/words.js';

const PACK = path.join(import.meta.dirname, '..', '..', '..', 'engine', 'archon', 'pack');
const LANES = ['wheelhouse-quick.yaml', 'wheelhouse-small.yaml', 'wheelhouse-small-task.yaml', 'wheelhouse-bug.yaml'];
const RUN_ID = '7f3c2a10-1111-4222-8333-444455556666';

const run = (over = {}) => ({ work: 'sale-banner', title: 'The sale banner', runId: RUN_ID, state: 'started', step: 'review-spec', minutes: 12, ...over });
const cost = (over = {}) => ({ runId: RUN_ID, work: 'sale-banner', tokens: 120000, dollars: 0.4, floorDollars: 0.4, premiumRequests: 0, minutes: 12, source: 'reported', byRole: { implement: { dollars: 0.3 }, 'review-spec': { dollars: 0.1 } }, ...over });

test('every step of each lane in the pack has plain words', () => {
  const ids = [...new Set(LANES.flatMap((lane) => [...fs.readFileSync(path.join(PACK, lane), 'utf8').matchAll(/"id": "([a-z-]+)"/g)].map((m) => m[1])))];
  assert.ok(ids.length > 10);
  for (const id of ids) assert.ok(Object.hasOwn(STEP_WORDS, id), `${id} has no words`);
  assert.equal(STEP_WORDS.implement, 'building it');
  assert.equal(STEP_WORDS['review-standards'], 'checking it against the project\'s standards');
  assert.equal(STEP_WORDS['review-spec'], 'checking it does what was asked');
  assert.equal(STEP_WORDS.preview, 'taking pictures');
  assert.equal(STEP_WORDS.approval, 'waiting for you');
  assert.equal(STEP_WORDS.merge, 'adding it to the product');
});

test('a step with no words of its own reads as working on it', () => {
  assert.equal(stepWords('something-new'), 'working on it');
});

test('the run line names the work, its step, its time and its cost', () => {
  assert.equal(runLine(run(), cost()), 'The sale banner: checking it does what was asked. 12 minutes so far, about $0.40.');
  assert.equal(runLine(run({ minutes: 1, step: null, state: 'paused' }), null), 'The sale banner: waiting for you. 1 minute so far.');
});

test('no line holds a run id, a step id or the word workflow', () => {
  const lines = [
    runLine(run(), cost()), shippedLine(run({ state: 'ended' }), cost()),
    ...buildLines({ runs: { 'sale-banner': [{ at: '2026-10-29T09:00:00.000Z', data: { work: 'sale-banner', runId: RUN_ID, state: 'ended', lane: 'quick', engine: 'archon', outcome: 'completed', pr: 9 } }] }, costs: { 'sale-banner': [{ at: '2026-10-29T09:30:00.000Z', data: cost() }] }, work: { 'sale-banner': { work: { data: { title: 'The sale banner' } } } } }),
  ];
  for (const line of lines) {
    assert.doesNotMatch(line, new RegExp(RUN_ID));
    assert.doesNotMatch(line, /review-spec|review-standards|\bimplement\b/);
    assert.doesNotMatch(line, /workflow/i);
  }
});

test('a cost with unknown dollars reads not reported', () => {
  assert.equal(costWords(cost({ dollars: null, floorDollars: 0, source: 'unknown' })), 'cost not reported');
  assert.equal(costWords(cost({ dollars: null, floorDollars: 0.25 })), 'at least $0.25');
  assert.equal(costWords(cost({ dollars: 0.004 })), 'less than a cent');
  assert.equal(runLine(run(), cost({ dollars: null, floorDollars: 0, source: 'unknown' })), 'The sale banner: checking it does what was asked. 12 minutes so far, cost not reported.');
});

test('the build tab lists a run\'s steps in order in plain words', () => {
  const lines = buildLines({
    work: { 'sale-banner': { work: { data: { title: 'The sale banner' } } } },
    runs: { 'sale-banner': [{ at: '2026-10-29T09:00:00.000Z', data: { work: 'sale-banner', runId: RUN_ID, state: 'ended', lane: 'quick', engine: 'archon', outcome: 'completed' } }] },
    costs: { 'sale-banner': [{ at: '2026-10-29T09:30:00.000Z', data: cost({ byRole: { implement: { dollars: 0.3 }, 'review-standards': { dollars: 0.05 }, 'review-spec': { dollars: 0.05 } } }) }] },
  });
  assert.deepEqual(lines, [
    'Runs',
    'The sale banner: finished, about $0.40.',
    '  Steps: building it; checking it against the project\'s standards; checking it does what was asked.',
  ]);
});

test('the build tab says nothing when there are no runs', () => {
  assert.deepEqual(buildLines({}), []);
});

test('the briefing names a shipped change with its cost', () => {
  assert.equal(shippedLine(run({ state: 'ended' }), cost()), 'Shipped: the sale banner, for about $0.40.');
  const views = {
    work: { 'sale-banner': { work: { data: { title: 'The sale banner' } } } },
    runs: { 'sale-banner': [{ at: '2026-10-29T09:00:00.000Z', data: { work: 'sale-banner', runId: RUN_ID, state: 'ended', lane: 'quick', engine: 'archon', outcome: 'completed', pr: 9 } }] },
    costs: { 'sale-banner': [{ at: '2026-10-29T09:30:00.000Z', data: cost() }] },
    reports: { 'sale-banner': { at: '2026-10-29T10:00:00.000Z', data: { outcome: 'merged', pr: 9 } } },
  };
  assert.deepEqual(shippedLines(views, { since: '2026-10-29T00:00:00.000Z' }), ['Shipped: the sale banner, for about $0.40.']);
  assert.deepEqual(shippedLines(views, { since: '2026-10-29T11:00:00.000Z' }), []);
});

test('the work view gains each running run\'s state', () => {
  const views = {
    work: { 'sale-banner': { work: { data: { title: 'The sale banner' } } } },
    runs: { 'sale-banner': [
      { at: '2026-10-29T09:00:00.000Z', data: { work: 'sale-banner', runId: RUN_ID, state: 'started', lane: 'quick', engine: 'archon' } },
      { at: '2026-10-29T09:10:00.000Z', data: { work: 'sale-banner', runId: RUN_ID, state: 'paused', lane: 'quick', engine: 'archon' } },
    ] },
  };
  assert.deepEqual(runningLines(views, { now: new Date('2026-10-29T09:30:00.000Z') }), ['The sale banner: waiting for you. 10 minutes so far.']);
});

test('a step inside a loop, or inside a task block, has its own step\'s words', () => {
  assert.equal(stepWords('review.fix'), 'fixing what the checks found');
  assert.equal(stepWords('build.implement'), 'building it');
  assert.equal(stepWords('__archon_fan_out__each__root__ca978112ca1bbdca__each__ca978112ca1bbdca__gate'), 'looking at the next task');
  assert.equal(stepWords('__archon_fan_out__each__root__ca978112ca1bbdca__each__ca978112ca1bbdca__build.implement'), 'building it');
  assert.equal(stepWords('review.unknown'), 'working on it');
});
