// tests/scripts/engine/archon/record.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readRecord, readOutputs } from '../../../../scripts/engine/archon/record.js';

const fixture = () => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'archon', 'get-verbose.json'), 'utf8'));

test("readRecord gives the run's state, branch, pull request, digest and owner", () => {
  const record = readRecord(fixture());
  assert.equal(record.status, 'ended');
  assert.equal(record.outcome, 'completed');
  assert.equal(record.branch, 'wh/card-14');
  assert.equal(record.pr, 'https://github.com/acme/web/pull/14');
  assert.equal(record.digest, 'sha256:3b0c9f2e7d1a4c6b8e5f0a9d2c7b1e4f6a3d8c0b5e2f7a1c9d4b6e8f0a2c5d7e');
  assert.equal(record.ownerPid, 48213);
});

test('readRecord reads reported spend from each step, and skips steps that only restate others', () => {
  const { steps } = readRecord(fixture());
  assert.deepEqual(steps.map((s) => s.id), ['read-order', 'implement', 'review', 'lesson']);
  const implement = steps[1];
  assert.equal(implement.provider, 'claude');
  assert.equal(implement.model, 'model-large-20261001');
  assert.equal(implement.tokens, 108675);
  assert.equal(implement.dollars, 0.1285);
  assert.equal(implement.minutes, 5.2);
  assert.equal(implement.source, 'reported');
  assert.deepEqual({ tokens: steps[0].tokens, dollars: steps[0].dollars, source: steps[0].source }, { tokens: 0, dollars: 0, source: 'reported' });
});

test('readRecord marks unavailable cost as unknown with null dollars', () => {
  const { steps, totals } = readRecord(fixture());
  const review = steps.find((s) => s.id === 'review');
  // A Copilot step: no cost reported, its request counted as an estimate.
  assert.equal(review.source, 'estimated');
  assert.equal(review.requests, 1);
  assert.equal(review.dollars, null);
  assert.equal(review.tokens, 20800);
  assert.equal(review.model, 'model-review');
  const lesson = steps.find((s) => s.id === 'lesson');
  assert.deepEqual({ tokens: lesson.tokens, dollars: lesson.dollars, source: lesson.source }, { tokens: null, dollars: null, source: 'unknown' });
  assert.deepEqual(totals, { dollars: 0.1285, tokens: null });
});

test('readRecord maps the run states the engine reports', () => {
  const at = (status, outcome = null) => readRecord({ ...fixture(), status, outcome });
  assert.deepEqual([at('running').status, at('pending').status, at('paused').status], ['running', 'running', 'paused']);
  assert.equal(at('completed', 'failed').outcome, 'failed');
  assert.equal(at('cancelled').outcome, 'cancelled');
  assert.equal(at('failed').outcome, 'failed');
  assert.equal(at('running').outcome, null);
});

test('readRecord copes with a run that has no record yet', () => {
  const bare = readRecord({ id: 'r1', status: 'pending', metadata: {}, terminal_record: null });
  assert.deepEqual(bare, { status: 'running', outcome: null, steps: [], branch: null, pr: null, head: null, digest: null, source: null, ownerPid: null, totals: { dollars: null, tokens: null } });
});

test('a step whose token count lacks the input or the output figure has unknown tokens, never a part counted as zero', () => {
  const node = (value, cost) => ({
    nodeId: 'implement',
    execution: { accounting: 'node', binding: { provider: 'claude' }, timing: {}, spend: { tokens: { source: 'provider', value }, costUsd: cost } },
  });
  const unavailable = { source: 'unavailable', reason: 'not_reported' };
  const { steps } = readRecord({ status: 'completed', metadata: {}, nodes: [
    node({ input: 1200 }, unavailable),
    node({ output: 300 }, { source: 'provider', value: 0.02 }),
    node({ input: 1200, output: 300 }, unavailable),
  ] });
  assert.deepEqual(steps.map((s) => [s.tokens, s.dollars, s.source]), [[null, null, 'unknown'], [null, 0.02, 'reported'], [1500, null, 'unknown']]);
});

test('readOutputs gives each finished step\'s whole output, the last time it finished', () => {
  const events = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'archon', 'get-events.json'), 'utf8'));
  const outputs = readOutputs(events);
  assert.equal(JSON.parse(outputs['review-standards']).verdict, 'CLEAN', 'a step run again reads as its last run');
  assert.equal(JSON.parse(outputs['open-pr']).pr, 14);
  assert.equal(outputs['review-security'], undefined, 'a skipped step has no output');
  assert.deepEqual(readOutputs(null), {});
  assert.equal(readRecord(events).source, events.metadata.workflow_source.root);
});

const loopEvents = () => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'archon', 'get-events-loop.json'), 'utf8'));
const completed = (step_name, node_output) => ({ event_type: 'node_completed', step_name, data: { node_output } });

test('a loop body step is given under its own id, from its last round', () => {
  const outputs = readOutputs(loopEvents());
  assert.equal(outputs['review-standards'], '{"round":2}');
  assert.equal(outputs['review.review-standards'], '{"round":2}');
  assert.equal(outputs.review, '{"round":2}');
});

test('a top-level step keeps its id over a body step of the same name', () => {
  const outputs = readOutputs({ events: [completed('lenses', '{"a":1}'), completed('review.lenses', '{"a":2}')] });
  assert.equal(outputs.lenses, '{"a":1}');
  assert.equal(readOutputs({ events: [completed('review.lenses', '{"a":2}'), completed('lenses', '{"a":1}')] }).lenses, '{"a":1}');
});

test('a fan-out instance step is not given a bare id', () => {
  const outputs = readOutputs(loopEvents());
  assert.equal(outputs.gate, undefined);
  assert.equal(outputs.tasks, '["a","b","c"]');
});

test('each step keeps its four kinds of token apart (check 79)', () => {
  const { steps } = readRecord({ status: 'completed', metadata: {}, nodes: [{
    nodeId: 'implement',
    execution: { accounting: 'node', binding: { provider: 'claude' }, timing: {}, spend: { tokens: { source: 'provider', value: { input: 22759, output: 18, cacheRead: 21000, cacheWrite: 577 } }, costUsd: { source: 'provider', value: 0.00124 } } },
  }] });
  assert.deepEqual(steps[0].kinds, { input: 22759, output: 18, cacheRead: 21000, cacheWrite: 577 });
  assert.equal(steps[0].requests, 0);
});

test('a Copilot step counts each prompt it sent as one request at the Auto rate, as an estimate (checks 74, 79)', () => {
  const copilot = (attempt) => ({
    nodeId: 'implement',
    execution: { accounting: 'node', attempt: { id: attempt }, binding: { provider: 'copilot', model: { requested: 'auto' } }, timing: {}, spend: { tokens: { source: 'provider', value: { input: 1000, output: 200 } }, costUsd: { source: 'unavailable', reason: 'not_reported' } } },
  });
  const { steps } = readRecord({ status: 'completed', metadata: {}, nodes: [copilot('a1'), copilot('a2')] });
  assert.deepEqual(steps.map((s) => [s.requests, s.dollars, s.source]), [[1, null, 'estimated'], [1, null, 'estimated']]);
});
