// tests/scripts/agents/copilot/steps.test.js
// Thoroughness as a count of Copilot steps on an Auto-only plan (Copilot return design, section 5.3), and the
// foreman's script-only wakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsFor, levelFor, DEFAULT_LEVEL, OFFERED, LANES } from '../../../../scripts/agents/copilot/steps.js';
import { scriptWake } from '../../../../scripts/agents/copilot/script-wakes.js';

test('Lightest, the default on Copilot: a quick change is one session that builds and checks its own work', () => {
  assert.equal(DEFAULT_LEVEL, 'lightest');
  assert.deepEqual(stepsFor({ level: 'lightest', lane: 'quick' }), { level: 'lightest', plan: false, build: 1, reviewer: 'tests', tester: false, sessions: 1 });
  assert.equal(stepsFor({ level: 'lightest', lane: 'bug' }).sessions, 1);
});

test('Lightest: a feature is one plan, one build session and one review', () => {
  assert.deepEqual(stepsFor({ level: 'lightest', lane: 'feature' }), { level: 'lightest', plan: true, build: 1, reviewer: 'separate', tester: false, sessions: 3 });
  assert.equal(stepsFor({ level: 'lean', lane: 'small' }).sessions, 3);
});

test('Balanced: a separate reviewer for every piece, and a tester for a feature', () => {
  assert.deepEqual(stepsFor({ level: 'balanced', lane: 'quick' }), { level: 'balanced', plan: false, build: 1, reviewer: 'separate', tester: false, sessions: 2 });
  assert.equal(stepsFor({ level: 'balanced', lane: 'small' }).tester, false);
  assert.deepEqual(stepsFor({ level: 'balanced', lane: 'feature' }), { level: 'balanced', plan: true, build: 1, reviewer: 'separate', tester: true, sessions: 4 });
});

test('Thorough isn\'t offered on an Auto-only plan and is read as Balanced; other plans keep it', () => {
  assert.deepEqual(OFFERED, ['lightest', 'lean', 'balanced']);
  assert.equal(levelFor('thorough'), 'balanced');
  assert.equal(stepsFor({ level: 'thorough', lane: 'feature' }).level, 'balanced');
  assert.equal(levelFor('thorough', 'credits'), 'thorough');
  assert.equal(levelFor('nonsense'), 'lightest');
});

test('critical work keeps its own reviewer at every level, and a lane must be known', () => {
  for (const level of ['lightest', 'lean', 'balanced']) assert.equal(stepsFor({ level, lane: 'quick', critical: true }).reviewer, 'separate');
  assert.throws(() => stepsFor({ level: 'lightest', lane: 'epic' }));
  assert.throws(() => stepsFor());
  assert.deepEqual(LANES, ['quick', 'bug', 'small', 'feature']);
});

const HASH = 'a'.repeat(64);

test('a wake of merges, closes and forwarded records is settled by script and uses no Copilot session', () => {
  const wake = scriptWake([
    { type: 'merge-ready', work: 'shop-cart', pr: 12, detail: { head: 'abc' } },
    { type: 'report', work: 'shop-login' },
    { type: 'amended', work: 'shop-cart', detail: { hash: HASH } },
    { type: 'question', work: 'shop-cart', id: 'q-shop-cart-1' },
    { type: 'approval', work: 'shop-cart', detail: { pr: 12 } },
    { type: 'answer', work: 'shop-cart', detail: { questionId: 'q-shop-cart-1', label: 'Comma' } },
  ]);
  assert.equal(wake.script, true);
  assert.deepEqual(wake.needs, []);
  assert.deepEqual(wake.acts, [['merge', 'shop-cart'], ['close', 'shop-login'], ['amend', 'shop-cart', HASH], ['question', 'shop-cart', 'q-shop-cart-1']]);
});

test('a wake that needs judgement starts a session: a stuck piece, a clash, a foreman answer, a start, an unknown event', () => {
  for (const event of [
    { type: 'stuck', work: 'w', detail: { still: 1, phase: 'build' } },
    { type: 'clash', detail: { a: 'x', b: 'y' } },
    { type: 'work-ready', work: 'w', detail: { lane: 'quick' } },
    { type: 'answer', work: 'w', detail: { questionId: 'q-w-1000001', label: 'Go' } },
    { type: 'brand-new-kind', work: 'w' },
    { type: 'amended', work: 'w', detail: { hash: 'not-a-hash' } },
    { type: 'merge-ready', work: '../x' },
    null,
  ]) {
    const wake = scriptWake([{ type: 'report', work: 'done-one' }, event]);
    assert.equal(wake.script, false, JSON.stringify(event));
    assert.equal(wake.needs.length, 1);
  }
});

test('a merge held by STOP is neither run nor asked about, and an empty wake is script-only', () => {
  const held = scriptWake([{ type: 'merge-ready', work: 'w', pr: 1 }], { halted: true });
  assert.deepEqual([held.script, held.acts], [true, []]);
  assert.deepEqual(scriptWake([]), { script: true, acts: [], needs: [] });
  assert.equal(scriptWake('x').script, true);
});
