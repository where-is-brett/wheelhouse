// tests/scripts/engine/runner.test.js
// The helper's side of the card router over the fake engine: asks come in, cards are written within the budget, and
// the director's signed answers go back to the engine. Views are a stand-in the test controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { engineRunner } from '../../../scripts/engine/runner.js';
import { makeEvent } from '../../../scripts/state/events.js';

const HEAD = 'b'.repeat(40);
const ev = (over) => ({ runId: 'x', at: '2026-10-29T02:00:00.000Z', ...over });
// A recording that stops at one ask, then ends.
const asking = (id, over = {}) => [
  ev({ type: 'run-started' }),
  ev({ type: 'ask', id, kind: 'question', level: 3, recommend: 'b', options: [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }], ...over }),
  ev({ type: 'ask-resolved', id }),
  ev({ type: 'run-ended', outcome: 'completed' }),
];

function setUp({ recordings = { one: asking('q1') }, settings = {}, at = '2026-10-29T13:00:00.000Z', stop = false, slow = false, endRun } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-runner-'));
  const engine = fakeEngine({ recordings });
  const writes = [];
  const views = { levels: {}, questions: {}, approvals: {} };
  const world = { now: new Date(at), stop };
  const runner = engineRunner({
    engine,
    file: path.join(dir, 'router.json'),
    readViews: () => views,
    write: async (kind, data) => { if (slow) await new Promise((resolve) => setTimeout(resolve, 5)); writes.push({ kind, data }); },
    stopped: () => world.stop,
    now: () => world.now,
    settings: () => ({ cardsPerDay: 3, bundleApprovals: false, ...settings }),
    workOf: () => ({ work: 'sale-banner', lane: 'quick' }),
    titleOf: () => 'The sale banner',
    ...(endRun ? { endRun } : {}),
  });
  // Starts a run of `name` and hands the runner its open ask, as the host does.
  const ask = async (name = 'one') => {
    const { runId } = engine.start({ recording: name });
    const event = engine.watch('0').events.filter((e) => e.runId === runId && e.type === 'ask').at(-1);
    await runner.onAsk(event);
    return { runId, event };
  };
  // Signs an answer to the question the runner wrote, as the director's click does.
  const sign = (label, n = 0) => {
    const q = writes.filter((w) => w.kind === 'question')[n].data;
    views.questions[q.id] = { question: { data: q }, answer: { label, at: world.now.toISOString() } };
    return q;
  };
  return { engine, writes, views, world, runner, ask, sign, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const acts = (engine) => engine.calls.filter((c) => c.call === 'act');

test('a level-3 ask becomes a question card, with the recommendation first', async () => {
  const t = setUp();
  try {
    await t.ask();
    const questions = t.writes.filter((w) => w.kind === 'question');
    assert.equal(questions.length, 1);
    const q = questions[0].data;
    assert.match(q.id, /^q-sale-banner-5000\d\d$/);
    assert.equal(q.work, 'sale-banner');
    assert.equal(q.options[0].label, 'Do the whole page');
    assert.equal(q.recommendation, 'Do the whole page');
    assert.equal(acts(t.engine).length, 0, 'nothing is answered before the director');
  } finally { t.cleanup(); }
});

test('the engine is answered only after the signed record is written', async () => {
  const t = setUp();
  try {
    const { runId } = await t.ask();
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0);
    t.sign('Keep it small');
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action), [{ answer: { ask: 'q1', choice: 'a' } }]);
    assert.equal(acts(t.engine)[0].runId, runId);
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 1, 'an answer goes back once');
  } finally { t.cleanup(); }
});

test('an answer the engine refuses closes the card with one line', async () => {
  const t = setUp();
  try {
    const { runId } = await t.ask();
    t.engine.act(runId, { answer: { ask: 'q1', choice: 'b' } });
    t.sign('Keep it small');
    await t.runner.tick();
    const notes = t.writes.filter((w) => w.kind === 'note' && w.data.about === 'engine');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].data.words, 'Your answer about the sale banner wasn\'t needed: the build had already moved on.');
  } finally { t.cleanup(); }
});

test('under All stop no answer goes to the engine, and the question is asked again after the lift', async () => {
  const t = setUp();
  try {
    await t.ask();
    t.sign('Keep it small');
    t.world.stop = true;
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0);
    assert.match(t.writes.filter((w) => w.kind === 'note').at(-1).data.words, /All stop was on/);
    t.world.stop = false;
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0, 'the answer given under All stop never reaches the build');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 2, 'the question comes back');
  } finally { t.cleanup(); }
});

test('the table\'s own answer goes to the engine at once, with a Logbook line and no card', async () => {
  const t = setUp({ recordings: { hold: asking('h1', { level: 1, answer: 'hold', card: false, recommend: 'hold', line: 'The main line is red, so merges wait.', options: [{ id: 'hold', label: 'Hold' }] }) } });
  try {
    await t.ask('hold');
    assert.deepEqual(acts(t.engine).map((c) => c.action), [{ answer: { ask: 'h1', choice: 'hold' } }]);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 0);
    assert.deepEqual(t.writes.filter((w) => w.kind === 'note').map((w) => w.data.words), ['The main line is red, so merges wait.']);
  } finally { t.cleanup(); }
});

test('four level-3 asks in one afternoon: three cards today, the fourth tomorrow, and the count is noted', async () => {
  const recordings = Object.fromEntries([1, 2, 3, 4].map((n) => [`r${n}`, asking(`q${n}`)]));
  const t = setUp({ recordings });
  try {
    for (const n of [1, 2, 3, 4]) await t.ask(`r${n}`);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 3);
    assert.deepEqual(t.writes.filter((w) => w.kind === 'note' && w.data.about === 'cards-waiting').at(-1).data, { about: 'cards-waiting', count: 1 });
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 3, 'still three today');
    t.world.now = new Date('2026-10-30T21:00:00.000Z');
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 4);
    assert.equal(t.writes.filter((w) => w.kind === 'note' && w.data.about === 'cards-waiting').at(-1).data.count, 0);
  } finally { t.cleanup(); }
});

test('an approval ask is an approval card, and the signed approval answers the engine', async () => {
  const t = setUp({ recordings: { ok: asking('ap1', { kind: 'approval', recommend: 'approve', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Not this' }], setLine: { pr: 9, head: HEAD } }) } });
  try {
    await t.ask('ok');
    const cards = t.writes.filter((w) => w.kind === 'card');
    assert.equal(cards.length, 1);
    assert.match(cards[0].data.question, /^Approve pull request #9 at commit bbbbbbbbbbbb$/m);
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0);
    t.views.approvals = { 9: { [HEAD]: { data: { pr: 9, commit: HEAD } } } };
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action), [{ answer: { ask: 'ap1', choice: 'approve' } }]);
  } finally { t.cleanup(); }
});

test('the runner keeps what it did across a restart', async () => {
  const t = setUp();
  try {
    const { event } = await t.ask();
    const again = engineRunner({
      engine: t.engine, file: t.runner.file, readViews: () => t.views, write: async (kind, data) => { t.writes.push({ kind, data }); },
      stopped: () => false, now: () => t.world.now, settings: () => ({ cardsPerDay: 3 }), workOf: () => ({ work: 'sale-banner', lane: 'quick' }), titleOf: () => 'The sale banner',
    });
    await again.onAsk(event);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'an ask is routed once');
  } finally { t.cleanup(); }
});

test('the records the runner writes are well formed', async () => {
  const recordings = { q: asking('q1', { level: 4 }), ap: asking('ap1', { kind: 'approval', recommend: 'approve', options: [{ id: 'approve', label: 'Approve' }], setLine: { pr: 9, head: HEAD } }) };
  const t = setUp({ recordings });
  try {
    await t.ask('q');
    await t.ask('ap');
    assert.ok(t.writes.length >= 3);
    for (const { kind, data } of t.writes) assert.doesNotThrow(() => makeEvent({ kind, data }), `${kind} ${JSON.stringify(data)}`);
  } finally { t.cleanup(); }
});

// --- the caps and the cost record ---

const spending = (tokens) => [
  ev({ type: 'run-started' }),
  ev({ type: 'step-finished', step: 'implement', role: 'implement', provider: 'claude', model: 'mid', minutes: 4, spend: { tokens, dollars: 0.3, source: 'reported' } }),
  ev({ type: 'ask', id: 'later', kind: 'question', level: 3, options: [{ id: 'a', label: 'A' }] }),
];

function withRun(t, runId, records) {
  t.views.runs = { 'sale-banner': records.map(([at, state, extra = {}]) => ({ at, data: { work: 'sale-banner', lane: 'quick', engine: 'fake', runId, state, branch: 'wh/sale-banner', ...extra } })) };
}

test('a cap reached cancels the run and keeps its worktree, and raises a card', async () => {
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } } });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
    await t.runner.tick();
    const cancels = acts(t.engine).filter((c) => c.action.cancel);
    assert.equal(cancels.length, 1);
    assert.equal(cancels[0].runId, runId);
    assert.equal(t.engine.calls.filter((c) => c.call === 'abandon').length, 0, 'nothing removes the worktree');
    const q = t.writes.filter((w) => w.kind === 'question').at(-1).data;
    assert.deepEqual(q.options.map((o) => o.label), ['Give it more', 'Stop']);
    assert.match(q.what, /The sale banner reached its cap of 1,000,000 tokens/);
    assert.equal(q.level, 3);
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1, 'a run is stopped at its cap once');
  } finally { t.cleanup(); }
});

test('waiting at an ask does not use up the minutes cap', async () => {
  const t = setUp({ recordings: { small: spending(1000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } } });
  try {
    const { runId } = t.engine.start({ recording: 'small', running: true });
    withRun(t, runId, [['2026-10-29T09:00:00.000Z', 'started'], ['2026-10-29T09:05:00.000Z', 'paused'], ['2026-10-29T12:55:00.000Z', 'started']]);
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0, 'ten minutes running, four hours waiting: under the cap');
  } finally { t.cleanup(); }
});

test('Give it more on a cancelled run starts it again on its branch, with the cap raised once and the spend carried', async () => {
  const started = [];
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } } });
  t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
    await t.runner.tick();
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started'], ['2026-10-29T13:00:00.000Z', 'ended', { outcome: 'cancelled' }]]);
    const q = t.writes.filter((w) => w.kind === 'question').at(-1).data;
    t.views.questions[q.id] = { question: { data: q }, answer: { label: 'Give it more' } };
    await t.runner.tick();
    assert.deepEqual(started, [{ work: 'sale-banner', lane: 'quick', branch: 'wh/sale-banner', carryOn: true, raised: true }]);
    assert.deepEqual(t.runner.carried('again-1'), { raised: true, runs: [runId] });
  } finally { t.cleanup(); }
});

test('Give it more on a run that stopped on a failure resumes it, skipping finished steps', async () => {
  const t = setUp();
  const calls = [];
  const engine = { act: async (runId, action) => { calls.push({ runId, action }); return { ok: true }; }, inspect: async () => ({ status: 'ended', outcome: 'failed', steps: [] }) };
  const runner = engineRunner({ engine, file: path.join(path.dirname(t.runner.file), 'two.json'), readViews: () => t.views, write: async () => {}, now: () => t.world.now, workOf: () => ({ work: 'sale-banner', lane: 'quick' }) });
  try {
    await runner.capped({ runId: 'r9', work: 'sale-banner', lane: 'quick', branch: 'wh/x', reached: { cap: 'tokens', used: 2, limit: 1 } });
    const q = runner.questionOf('r9');
    t.views.questions[q] = { question: { data: { engine: { runId: 'r9', ask: 'cap:r9', options: { 'Give it more': 'more', Stop: 'stop' } } } }, answer: { label: 'Give it more' } };
    await runner.tick();
    assert.deepEqual(calls.map((c) => c.action), [{ resume: {} }]);
  } finally { t.cleanup(); }
});

test('a run that ended gets one cost record, with each role\'s share and unknown spend kept as unknown', async () => {
  const recordings = { done: [
    ev({ type: 'run-started' }),
    ev({ type: 'step-finished', step: 'implement', role: 'implement', minutes: 4, spend: { tokens: 100000, dollars: 0.3, source: 'reported' } }),
    ev({ type: 'step-finished', step: 'review-spec', role: 'review-spec', minutes: 1, spend: { tokens: null, dollars: null, source: 'unknown' } }),
    ev({ type: 'run-ended', outcome: 'completed' }),
  ] };
  const t = setUp({ recordings });
  try {
    const { runId } = t.engine.start({ recording: 'done' });
    withRun(t, runId, [['2026-10-29T12:00:00.000Z', 'started'], ['2026-10-29T12:10:00.000Z', 'ended', { outcome: 'completed' }]]);
    await t.runner.tick();
    await t.runner.tick();
    const costs = t.writes.filter((w) => w.kind === 'cost');
    assert.equal(costs.length, 1);
    const c = costs[0].data;
    assert.equal(c.runId, runId);
    assert.equal(c.dollars, null);
    assert.equal(c.floorDollars, 0.3);
    assert.equal(c.source, 'unknown');
    assert.deepEqual(Object.keys(c.byRole), ['implement', 'review-spec']);
    assert.doesNotThrow(() => makeEvent({ kind: 'cost', data: c }));
  } finally { t.cleanup(); }
});

test('an ask routed while a tick is showing cards is shown once', async () => {
  const t = setUp({ slow: true });
  try {
    const { runId } = t.engine.start({ recording: 'one' });
    const event = t.engine.watch('0').events.filter((e) => e.runId === runId && e.type === 'ask').at(-1);
    await Promise.all([t.runner.onAsk(event), t.runner.tick(), t.runner.tick()]);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1);
  } finally { t.cleanup(); }
});

test('a question that holds up all work is shown at once when the day\'s three cards are out', async () => {
  const recordings = { ...Object.fromEntries([1, 2, 3].map((n) => [`r${n}`, asking(`q${n}`)])), held: asking('q4', { level: 4, labels: { holds: 'all' } }) };
  const t = setUp({ recordings });
  try {
    for (const n of [1, 2, 3]) await t.ask(`r${n}`);
    await t.ask('held');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 4);
  } finally { t.cleanup(); }
});

test('an answer the engine couldn\'t take for a moment is sent again on the next tick, not dropped', async () => {
  const t = setUp();
  try {
    await t.ask();
    t.sign('Do the whole page');
    const real = t.engine.act.bind(t.engine);
    let down = true;
    t.engine.act = (runId, action) => {
      if (down && action.answer) throw new Error('archon: command timed out');
      return real(runId, action);
    };
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0, 'the failed call never reached the fake');
    assert.ok(!t.writes.some((w) => w.kind === 'note' && /moved on/.test(w.data.words ?? '')), 'nothing says the build moved on');
    down = false;
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action.answer.choice), ['b']);
  } finally { t.cleanup(); }
});

test('an engine that says the ask moved on closes the card with one line, and it isn\'t sent again', async () => {
  const t = setUp();
  try {
    const { runId, event } = await t.ask();
    t.engine.act(runId, { answer: { ask: event.id, choice: 'a' } });
    t.sign('Do the whole page');
    await t.runner.tick();
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 2, 'the other answer, then this one, once');
    assert.equal(t.writes.filter((w) => w.kind === 'note' && /moved on/.test(w.data.words ?? '')).length, 1);
  } finally { t.cleanup(); }
});

test('a cancel at the cap that fails is tried once more before the card', async () => {
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } } });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
    const real = t.engine.act.bind(t.engine);
    let fails = 1;
    t.engine.act = (id, action) => (action.cancel && fails-- > 0 ? { ok: false, unreachable: true, refused: 'timed out' } : real(id, action));
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1, 'the second try reached the engine');
    assert.match(t.writes.filter((w) => w.kind === 'question').at(-1).data.what, /so it was stopped/);
  } finally { t.cleanup(); }
});

test('a run the engine won\'t stop at its cap has its processes ended, and the card says so', async () => {
  const ended = [];
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, endRun: async (runId) => { ended.push(runId); return { ended: ['"node step" (process 101)'], survivors: [] }; } });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
    t.engine.act = (id, action) => (action.cancel ? { ok: false, refused: 'The engine refused to cancel the run' } : { ok: true });
    await t.runner.tick();
    assert.deepEqual(ended, [runId]);
    const q = t.writes.filter((w) => w.kind === 'question').at(-1).data;
    assert.equal(q.level, 3);
    assert.match(q.what, /didn't stop it/);
    assert.match(q.what, /ended its processes/);
    await t.runner.tick();
    assert.equal(ended.length, 1, 'once');
  } finally { t.cleanup(); }
});

test('a run already over when its cancel fails gets the usual card, and nothing is ended', async () => {
  const ended = [];
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, endRun: async (runId) => { ended.push(runId); return { ended: [], survivors: [] }; } });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
    const inspect = t.engine.inspect.bind(t.engine);
    let over = false;
    t.engine.act = (id, action) => { if (action.cancel) { over = true; return { ok: false, refused: 'The run isn\'t running' }; } return { ok: true }; };
    t.engine.inspect = (id) => ({ ...inspect(id), ...(over ? { status: 'ended' } : {}) });
    await t.runner.tick();
    assert.deepEqual(ended, []);
    assert.match(t.writes.filter((w) => w.kind === 'question').at(-1).data.what, /so it was stopped/);
  } finally { t.cleanup(); }
});
