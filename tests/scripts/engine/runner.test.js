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

const holding = (id) => asking(id, { level: 1, answer: 'hold', card: false, recommend: 'hold', line: 'The main line is red, so merges wait.', options: [{ id: 'hold', label: 'Hold' }], opens: 'red-main', suspect: 41 });

test('answering the red main line\'s hold writes one red-main incident', async () => {
  const t = setUp({ recordings: { hold: holding('h1') } });
  try {
    await t.ask('hold');
    const incidents = t.writes.filter((w) => w.kind === 'incident');
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].data.kind, 'red-main');
    assert.equal(incidents[0].data.suspect, 41);
    assert.match(incidents[0].data.work, /^fix-main-red-main-/);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 0, 'no card');
  } finally { t.cleanup(); }
});

test('a second hold while a red-main incident is open writes no second incident', async () => {
  const t = setUp({ recordings: { hold: holding('h1'), again: holding('h2') } });
  try {
    await t.ask('hold');
    const opened = t.writes.find((w) => w.kind === 'incident').data;
    t.views.incidents = { open: [{ ...opened, at: '2026-10-29T13:00:00.000Z', fixes: [] }] };
    await t.ask('again');
    assert.equal(t.writes.filter((w) => w.kind === 'incident').length, 1);
    assert.equal(acts(t.engine).length, 2, 'the second hold is still answered');
  } finally { t.cleanup(); }
});

test('a hold under All stop opens no incident until it is answered after the lift', async () => {
  const t = setUp({ recordings: { hold: holding('h1') }, stop: true });
  try {
    await t.ask('hold');
    assert.equal(t.writes.filter((w) => w.kind === 'incident').length, 0);
    t.world.stop = false;
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'incident').length, 1);
  } finally { t.cleanup(); }
});

test('a hold the engine refuses opens no incident', async () => {
  const t = setUp({ recordings: { hold: holding('h1') } });
  try {
    t.engine.act = () => ({ ok: false, refused: 'moved on' });
    await t.ask('hold');
    assert.equal(t.writes.filter((w) => w.kind === 'incident').length, 0);
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

test('a fix-main run at its cap is cancelled with a Logbook line, and its card is the dispatcher\'s', async () => {
  const t = setUp({ recordings: { big: spending(2500000) } });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started', { lane: 'fix-main' }]]);
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 0, 'no cap card');
    assert.ok(t.writes.some((w) => w.kind === 'note' && /fix for the red main line reached its cap/.test(w.data.words ?? '')));
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1, 'cancelled once');
  } finally { t.cleanup(); }
});

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

// A run Archon shows paused (spending recording's ask) past its token cap, its pause not yet in the record.
function pausedAtCap(extra = {}) {
  const ended = [];
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, endRun: async (runId) => { ended.push(runId); return { ended: [], survivors: [] }; }, ...extra });
  const { runId } = t.engine.start({ recording: 'big' });
  withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
  const event = t.engine.watch('0').events.filter((e) => e.runId === runId && e.type === 'ask').at(-1);
  return { t, runId, event, ended };
}
const capCard = (t) => t.writes.filter((w) => w.kind === 'question').find((w) => /reached its cap/.test(w.data.what)).data;
const answerCap = (t, label) => { const q = capCard(t); t.views.questions[q.id] = { question: { data: q }, answer: { label } }; };

test('a paused run at its cap is held, not cancelled: it spends nothing while it waits, and the card says so', async () => {
  const { t, runId, ended } = pausedAtCap();
  try {
    assert.equal(t.engine.inspect(runId).status, 'paused');
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0, 'Archon cancels only running runs, so none is asked for');
    assert.deepEqual(ended, [], 'a paused run has no processes to end');
    const q = capCard(t);
    assert.equal(q.level, 3);
    assert.match(q.what, /reached its cap of 1,000,000 tokens while it was waiting/);
    assert.match(q.what, /holding it/);
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'one card');
  } finally { t.cleanup(); }
});

test("a held run's answers wait: none reaches the build until Give it more, so it can't carry on past its cap", async () => {
  const { t, runId, event } = pausedAtCap();
  try {
    await t.runner.onAsk(event);
    const asked = t.writes.filter((w) => w.kind === 'question')[0].data;
    await t.runner.tick();
    t.views.questions[asked.id] = { question: { data: asked }, answer: { label: 'A' } };
    await t.runner.tick();
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0, 'held: the answer waits');
    answerCap(t, 'Give it more');
    await t.runner.tick();
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action), [{ answer: { ask: 'later', choice: 'a' } }], 'the answer goes once the hold is lifted, and nothing resumes past the open ask');
    assert.equal(acts(t.engine)[0].runId, runId);
    assert.deepEqual(t.runner.carried(runId), { raised: true, runs: [] }, 'the cap is raised once');
  } finally { t.cleanup(); }
});

test("an ask a held run raises waits for the hold, and Stop never sends it", async () => {
  const { t, event } = pausedAtCap();
  try {
    await t.runner.tick();
    await t.runner.onAsk(event);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'no card for a held run\'s ask yet');
    answerCap(t, 'Stop');
    await t.runner.tick();
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'its ask never becomes a card');
    assert.ok(t.writes.some((w) => w.kind === 'note' && /stays stopped/.test(w.data.words ?? '')));
  } finally { t.cleanup(); }
});

test('Stop on a held run ends it in the record, so it gives back its build slot, and nothing is sent to the engine', async () => {
  const { t, runId } = pausedAtCap();
  try {
    await t.runner.tick();
    answerCap(t, 'Stop');
    await t.runner.tick();
    const ended = t.writes.filter((w) => w.kind === 'run' && w.data.runId === runId);
    assert.equal(ended.length, 1);
    assert.deepEqual(ended[0].data, { work: 'sale-banner', lane: 'quick', engine: 'fake', runId, state: 'ended', outcome: 'stopped', branch: 'wh/sale-banner' });
    assert.equal(acts(t.engine).length, 0, 'a paused run is never abandoned, so its worktree is kept');
    assert.equal(t.engine.inspect(runId).status, 'paused');
    assert.ok(t.writes.some((w) => w.kind === 'note' && /no longer holds a build slot/.test(w.data.words ?? '')));
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'run').length, 1, 'once');
    await t.runner.onAsk({ ...t.engine.watch('0').events.filter((e) => e.runId === runId && e.type === 'ask').at(-1), id: 'again' });
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'an ask the stopped run shows again is no card');
  } finally { t.cleanup(); }
});

test("an answer to a stopped held run's own earlier card never reaches the engine, so it can't spend past the record's end", async () => {
  const { t, event } = pausedAtCap();
  try {
    await t.runner.onAsk(event);
    const asked = t.writes.filter((w) => w.kind === 'question')[0].data;
    await t.runner.tick();
    answerCap(t, 'Stop');
    await t.runner.tick();
    t.views.questions[asked.id] = { question: { data: asked }, answer: { label: 'A' } };
    await t.runner.tick();
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0, 'nothing is sent to the stopped run');
    assert.ok(t.writes.some((w) => w.kind === 'note' && /you stopped it at its cap/.test(w.data.words ?? '')));
  } finally { t.cleanup(); }
});

test('a held run is looked at against its raised cap once Give it more lifts the hold', async () => {
  const { t, runId } = pausedAtCap();
  try {
    await t.runner.tick();
    answerCap(t, 'Give it more');
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => Object.keys(c.action)[0]), ['resume']);
    // It carries on and spends past the raised cap (1.5 million tokens).
    const inspect = t.engine.inspect.bind(t.engine);
    t.engine.inspect = (id) => { const r = inspect(id); return { ...r, status: 'running', steps: [...r.steps, { ...r.steps[0], id: 'more', tokens: 600000 }] }; };
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1, 'stopped at the raised cap');
    assert.equal(t.writes.filter((w) => w.kind === 'question' && /reached its cap/.test(w.data.what)).length, 2);
  } finally { t.cleanup(); }
});

test('a held run that carries on all the same is stopped', async () => {
  const { t, runId } = pausedAtCap();
  try {
    await t.runner.tick();
    const inspect = t.engine.inspect.bind(t.engine);
    t.engine.inspect = (id) => ({ ...inspect(id), status: 'running' });
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).filter((c) => c.action.cancel).map((c) => c.runId), [runId]);
    assert.ok(t.writes.some((w) => w.kind === 'note' && /carried on past its cap while it was held, so it was stopped/.test(w.data.words ?? '')));
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1, 'once');
  } finally { t.cleanup(); }
});

test('Give it more on a held run with no ask open resumes it', async () => {
  const { t, runId } = pausedAtCap();
  try {
    await t.runner.tick();
    answerCap(t, 'Give it more');
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action), [{ resume: {} }]);
    assert.equal(acts(t.engine)[0].runId, runId);
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

// A run that stops at a blocked exit's wait. `options` are the wait's answers: the lane's own (Send it back, Stop)
// or the step's.
const blockedAsk = (id, { question = 'Should a part refund show as its own line?', options = [{ id: 'rework', label: 'Send it back for a fresh run' }, { id: 'stop', label: 'Stop this work' }] } = {}) => asking(id, {
  kind: 'blocked', recommend: options[0].id, options, context: { question },
});
const OWN = [{ id: 'own', label: 'Its own line' }, { id: 'within', label: 'Within the order' }, { id: 'stop', label: 'Stop this work' }];
const ended = (t, runId) => withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started'], ['2026-10-29T13:00:00.000Z', 'ended', { outcome: 'completed' }]]);

test('Send it back on a blocked card starts the work again on its branch once the run has ended, with the cap not raised', async () => {
  const started = [];
  const t = setUp({ recordings: { one: blockedAsk('q1') } });
  t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; });
  try {
    const { runId } = await t.ask();
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started'], ['2026-10-29T12:55:00.000Z', 'paused']]);
    t.sign('Send it back for a fresh run');
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action.answer?.choice), ['rework'], 'the engine has the answer');
    assert.deepEqual(started, [], 'nothing starts while the run is still going');
    ended(t, runId);
    await t.runner.tick();
    await t.runner.tick();
    assert.deepEqual(started, [{ work: 'sale-banner', lane: 'quick', branch: 'wh/sale-banner', carryOn: true, raised: false, answers: [] }], 'started once');
    assert.deepEqual(t.runner.carried('again-1'), { raised: false, runs: [runId] }, 'the spend so far still counts against the cap');
  } finally { t.cleanup(); }
});

test('an answer of the step\'s own starts the work again with the director\'s answers in its order', async () => {
  const started = [];
  const t = setUp({ recordings: { one: blockedAsk('q1', { options: OWN }) } });
  t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: `again-${started.length}` }; });
  try {
    const { runId } = await t.ask();
    t.sign('Within the order');
    ended(t, runId);
    await t.runner.tick();
    assert.deepEqual(started.map((s) => s.answers), [[{ question: 'Should a part refund show as its own line?', answer: 'Within the order' }]]);
  } finally { t.cleanup(); }
});

test('Stop on a blocked card ends the work: nothing starts again', async () => {
  for (const options of [undefined, OWN]) {
    const started = [];
    const t = setUp({ recordings: { one: blockedAsk('q1', { options }) } });
    t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; });
    try {
      const { runId } = await t.ask();
      t.sign('Stop this work');
      ended(t, runId);
      await t.runner.tick();
      await t.runner.tick();
      assert.deepEqual(started, []);
    } finally { t.cleanup(); }
  }
});

test('a bug found bigger than a bug goes back to the First Mate in the lane the director picked, and starts nothing again', async () => {
  const MOVE = [{ id: 'small', label: 'Make it a small change' }, { id: 'feature', label: 'Make it a feature' }, { id: 'stop', label: 'Stop this work' }];
  for (const [label, lane] of [['Make it a small change', 'a small change'], ['Make it a feature', 'a feature']]) {
    const started = [];
    const t = setUp({ recordings: { one: asking('q1', { kind: 'blocked', topic: 'bigger-than-a-bug', recommend: 'small', options: MOVE, context: { question: 'The fix changes 7 files. Should it go on as a small change?' } }) } });
    t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; });
    try {
      const { runId } = await t.ask();
      t.sign(label);
      withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started', { lane: 'bug' }], ['2026-10-29T13:00:00.000Z', 'ended', { outcome: 'completed', lane: 'bug' }]]);
      await t.runner.tick();
      await t.runner.tick();
      assert.equal(acts(t.engine).length, 1, 'the engine has the answer, so the run ends');
      assert.deepEqual(started, [], 'the bug lane doesn\'t start it again');
      const notes = t.writes.filter((w) => w.kind === 'note' && w.data.about === 'engine').map((w) => w.data.words);
      assert.ok(notes.includes(`The sale banner is bigger than a bug, so it stops in the bug lane; the First Mate records it as ${lane} and asks you to approve it.`), notes.join('\n'));
    } finally { t.cleanup(); }
  }
});

test('only the bug lane\'s card moves work up a lane: another lane\'s answer of the same words sends it back as before', async () => {
  const MOVE = [{ id: 'small', label: 'Make it a small change' }, { id: 'stop', label: 'Stop this work' }];
  const started = [];
  const t = setUp({ recordings: { one: asking('q1', { kind: 'blocked', topic: 'bigger-than-a-bug', recommend: 'small', options: MOVE, context: { question: 'Bigger?' } }) } });
  t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; });
  try {
    const { runId } = await t.ask();
    t.sign('Make it a small change');
    ended(t, runId);
    await t.runner.tick();
    await t.runner.tick();
    assert.equal(started.length, 1, 'a quick-lane run is started again, not moved');
    assert.ok(!t.writes.some((w) => w.kind === 'note' && /bigger than a bug/.test(w.data.words)));
  } finally { t.cleanup(); }
});

test('an answer to a question that isn\'t a blocked exit starts nothing again', async () => {
  const started = [];
  const t = setUp();
  t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; });
  try {
    const { runId } = await t.ask();
    t.sign('Keep it small');
    ended(t, runId);
    await t.runner.tick();
    assert.deepEqual(started, []);
  } finally { t.cleanup(); }
});

test('an answer the engine refuses starts nothing again', async () => {
  const started = [];
  const t = setUp({ recordings: { one: blockedAsk('q1') } });
  t.runner.onStart(async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; });
  try {
    const { runId } = await t.ask();
    t.engine.act(runId, { cancel: { reason: 'gone' } });
    t.sign('Send it back for a fresh run');
    ended(t, runId);
    await t.runner.tick();
    await t.runner.tick();
    assert.deepEqual(started, []);
  } finally { t.cleanup(); }
});

test('the fresh run asking the question the director answered is answered from that answer, with no second card', async () => {
  const t = setUp({ recordings: { one: blockedAsk('q1', { options: OWN }), two: blockedAsk('q2', { options: OWN }), three: blockedAsk('q3', { question: 'Another question?', options: OWN }) } });
  t.runner.onStart(async () => ({ ok: true, runId: 'again-1' }));
  try {
    const { runId } = await t.ask('one');
    t.sign('Its own line');
    ended(t, runId);
    await t.runner.tick();
    const cards = () => t.writes.filter((w) => w.kind === 'question').length;
    assert.equal(cards(), 1);
    const again = await t.ask('two');
    assert.equal(cards(), 1, 'no second card for the same question');
    const answered = acts(t.engine).filter((c) => c.runId === again.runId).map((c) => c.action.answer?.choice);
    assert.deepEqual(answered, ['own']);
    assert.ok(t.writes.some((w) => w.kind === 'note' && /Its own line/.test(w.data.words)), 'the Logbook says it was answered from the director\'s answer');
    await t.ask('three');
    assert.equal(cards(), 2, 'a new question still comes to the director');
  } finally { t.cleanup(); }
});
