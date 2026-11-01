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
import { READER_WORK } from '../../../scripts/delegation/reader.js';
import { alike } from '../../../scripts/delegation/words.js';
import { decisionKey } from '../../../scripts/delegation/asked.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { FIX_LANE } from '../../../scripts/engine/fix-main.js';
import { wayBack, asking as asks, forever, quiet } from '../../helpers/way-back.js';

const HEAD = 'b'.repeat(40);
const ev = (over) => ({ runId: 'x', at: '2026-10-29T02:00:00.000Z', ...over });
// A recording that stops at one ask, then ends.
const asking = (id, over = {}) => [
  ev({ type: 'run-started' }),
  ev({ type: 'ask', id, kind: 'question', level: 3, recommend: 'b', options: [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }], ...over }),
  ev({ type: 'ask-resolved', id }),
  ev({ type: 'run-ended', outcome: 'completed' }),
];

function setUp({ recordings = { one: asking('q1') }, settings = {}, at = '2026-10-29T13:00:00.000Z', stop = false, slow = false, refuse, endRun, onCard, workOf = () => ({ work: 'sale-banner', lane: 'quick' }), onReaderAsk, openedOf, mergeAsked, release, gate = {}, blindRoll } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-runner-'));
  const engine = fakeEngine({ recordings });
  if (mergeAsked) engine.mergeAsked = mergeAsked;
  const writes = [];
  const views = { levels: {}, questions: {}, approvals: {} };
  const world = { now: new Date(at), stop };
  const runner = engineRunner({
    engine,
    file: path.join(dir, 'router.json'),
    readViews: () => views,
    write: async (kind, data) => { if (slow) await new Promise((resolve) => setTimeout(resolve, 5)); if (refuse?.(kind, data)) throw new Error('the record was refused'); writes.push({ kind, data }); },
    stopped: () => world.stop,
    now: () => world.now,
    settings: () => ({ cardsPerDay: 3, bundleApprovals: false, ...settings }),
    workOf,
    titleOf: () => 'The sale banner',
    ...(endRun ? { endRun } : {}),
    ...(onCard ? { onCard } : {}),
    ...(onReaderAsk ? { onReaderAsk } : {}),
    ...(openedOf ? { openedOf } : {}),
    ...(release ? { release } : {}),
    ...(blindRoll ? { blindRoll } : {}),
    ...gate,
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

test('an ask of a run All stop cancelled never comes back, and its answer says so', async () => {
  const t = setUp();
  try {
    const { runId } = t.engine.start({ recording: 'one' });
    await t.runner.onAsk(t.engine.watch('0').events.find((e) => e.type === 'ask'));
    const q = t.writes.find((w) => w.kind === 'question').data;
    t.world.stop = true;
    await t.engine.stopAll('All stop');
    t.views.questions[q.id] = { question: { data: q }, answer: { label: q.options[0].label } };
    await t.runner.tick();
    assert.match(t.writes.filter((w) => w.kind === 'note').at(-1).data.words, /it had cancelled that work/);
    t.world.stop = false;
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'no new card for a run that has ended');
    assert.equal(t.engine.inspect(runId).status, 'ended');
    assert.equal(acts(t.engine).length, 0);
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

const fourAsks = () => Object.fromEntries([1, 2, 3, 4].map((n) => [`r${n}`, asking(`q${n}`)]));
const heldNote = (t) => t.writes.filter((w) => w.kind === 'note' && w.data.about === 'cards-waiting').at(-1)?.data;

test('every ask is a card at once, and past the budget it is listed as held back', async () => {
  const t = setUp({ recordings: fourAsks() });
  try {
    for (const n of [1, 2, 3, 4]) await t.ask(`r${n}`);
    const questions = t.writes.filter((w) => w.kind === 'question');
    assert.equal(questions.length, 4);
    assert.deepEqual(heldNote(t), { about: 'cards-waiting', count: 1, ids: [questions[3].data.id] });
  } finally { t.cleanup(); }
});

test('a held card is named as held before it is written, so no tick sees it pushed', async () => {
  const t = setUp({ recordings: fourAsks() });
  try {
    for (const n of [1, 2, 3, 4]) await t.ask(`r${n}`);
    const fourth = t.writes.filter((w) => w.kind === 'question')[3].data.id;
    const named = t.writes.findIndex((w) => w.kind === 'note' && w.data.ids?.includes(fourth));
    const written = t.writes.findIndex((w) => w.kind === 'question' && w.data.id === fourth);
    assert.ok(named !== -1 && named < written);
  } finally { t.cleanup(); }
});

test('a pull lifts it, spending no budget', async () => {
  const t = setUp({ recordings: fourAsks(), settings: { cardsPerDay: 2 } });
  try {
    for (const n of [1, 2, 3]) await t.ask(`r${n}`);
    const third = t.writes.filter((w) => w.kind === 'question')[2].data.id;
    t.views.cardsWaiting = { count: 1, ids: [third], pulled: [third] };
    await t.runner.tick();
    assert.deepEqual(heldNote(t).ids, []);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 3, 'nothing is written twice');
  } finally { t.cleanup(); }
});

test('a pull leaves the day\'s count as it was, so the next ask is still over budget', async () => {
  const t = setUp({ recordings: fourAsks(), settings: { cardsPerDay: 1 } });
  try {
    await t.ask('r1');
    await t.ask('r2');
    const second = t.writes.filter((w) => w.kind === 'question')[1].data.id;
    t.views.cardsWaiting = { count: 1, ids: [second], pulled: [second] };
    await t.runner.tick();
    await t.ask('r3');
    const third = t.writes.filter((w) => w.kind === 'question')[2].data.id;
    assert.deepEqual(heldNote(t).ids, [third]);
  } finally { t.cleanup(); }
});

test('a new day\'s budget lifts held cards, in order of importance', async () => {
  const recordings = { ...fourAsks(), urgent: asking('u1', { level: 4, recommend: 'a' }) };
  const t = setUp({ recordings, settings: { cardsPerDay: 1 } });
  try {
    await t.ask('r1');
    await t.ask('r2');
    await t.ask('urgent');
    const [, plain, urgent] = t.writes.filter((w) => w.kind === 'question').map((w) => w.data.id);
    assert.deepEqual(heldNote(t).ids, [plain, urgent]);
    t.world.now = new Date('2026-10-30T21:00:00.000Z');
    await t.runner.tick();
    assert.deepEqual(heldNote(t).ids, [plain], 'the level-4 card takes the new day\'s one place');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 3, 'nothing is written twice');
  } finally { t.cleanup(); }
});

test('a held card the director answers from the Logbook leaves the list', async () => {
  const t = setUp({ recordings: fourAsks(), settings: { cardsPerDay: 1 } });
  try {
    await t.ask('r1');
    await t.ask('r2');
    // The two cards are one piece's, and a piece's answers go together.
    t.sign('Keep it small');
    t.sign('Keep it small', 1);
    await t.runner.tick();
    assert.deepEqual(heldNote(t).ids, []);
    assert.equal(acts(t.engine).length, 2);
  } finally { t.cleanup(); }
});

test('a card over budget never ages into an answer', async () => {
  const t = setUp({ recordings: fourAsks(), settings: { cardsPerDay: 0 } });
  try {
    await t.ask('r1');
    for (let day = 1; day <= 30; day += 1) {
      t.world.now = new Date(Date.UTC(2026, 10, day, 12));
      await t.runner.tick();
    }
    assert.equal(acts(t.engine).length, 0, 'nothing is answered');
    assert.equal(heldNote(t).count, 1, 'still held, still open');
  } finally { t.cleanup(); }
});

test('an exempt card ignores the budget, as today', async () => {
  const t = setUp({ recordings: { ...fourAsks(), stops: asking('s1', { holdsAll: true, level: 4, recommend: 'a' }) }, settings: { cardsPerDay: 0 } });
  try {
    await t.ask('stops');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1);
    assert.deepEqual(heldNote(t).ids, []);
  } finally { t.cleanup(); }
});

test('a piece with a held card waits on the director all the same', async () => {
  const t = setUp({ recordings: fourAsks(), settings: { cardsPerDay: 0 } });
  try {
    await t.ask('r1');
    assert.equal(heldNote(t).count, 1);
    assert.deepEqual([...t.runner.waitingWork()], ['sale-banner']);
  } finally { t.cleanup(); }
});

const approvalAsk = (id, pr) => asking(id, { kind: 'approval', recommend: 'approve', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Not this' }], setLine: { pr, head: HEAD } });

test('bundled approvals still count as one', async () => {
  const recordings = { one: approvalAsk('a1', 9), two: approvalAsk('a2', 10), three: asking('q3') };
  const t = setUp({ recordings, settings: { cardsPerDay: 1, bundleApprovals: true } });
  try {
    await t.ask('three');
    await t.ask('one');
    await t.ask('two');
    assert.equal(t.writes.filter((w) => w.kind === 'card').length, 2, 'each approval is a card at once');
    assert.deepEqual(heldNote(t).ids, [`9:${HEAD}`, `10:${HEAD}`]);
    t.world.now = new Date('2026-10-30T21:00:00.000Z');
    await t.runner.tick();
    assert.deepEqual(heldNote(t).ids, [], 'the two lift together, for one of the day\'s places');
    assert.equal(t.writes.filter((w) => w.kind === 'card').length, 2, 'neither is written again');
  } finally { t.cleanup(); }
});

test('a card the record refuses says so once, and holds up no card behind it', async () => {
  const bad = new Set();
  const t = setUp({ recordings: fourAsks(), settings: { cardsPerDay: 1 }, refuse: (kind, data) => kind === 'question' && bad.has(data.id) });
  try {
    await t.ask('r1');
    bad.add('q-sale-banner-500002');
    await t.ask('r2');
    await t.ask('r3');
    await t.runner.tick();
    await t.runner.tick();
    const written = t.writes.filter((w) => w.kind === 'question').map((w) => w.data.id);
    assert.deepEqual(written, ['q-sale-banner-500001', 'q-sale-banner-500003']);
    assert.equal(t.writes.filter((w) => w.kind === 'note' && /couldn't be shown/.test(w.data.words ?? '')).length, 1);
    bad.clear();
    await t.runner.tick();
    assert.ok(t.writes.some((w) => w.kind === 'question' && w.data.id === 'q-sale-banner-500002'), 'it is tried again');
    assert.deepEqual([...heldNote(t).ids].sort(), ['q-sale-banner-500002', 'q-sale-banner-500003']);
  } finally { t.cleanup(); }
});

test('a bundle keeps the budget exemption of any card in it', async () => {
  const holding = approvalAsk('a1', 9);
  holding[1] = { ...holding[1], level: 4, holdsAll: true };
  const t = setUp({ recordings: { first: asking('q1'), hold: holding, plain: approvalAsk('a2', 10) }, settings: { cardsPerDay: 1, bundleApprovals: true } });
  try {
    await t.ask('first');
    await t.ask('plain');
    assert.deepEqual(heldNote(t).ids, [`10:${HEAD}`]);
    await t.ask('hold');
    assert.deepEqual(heldNote(t).ids, [], 'what holds up all work is never held back');
  } finally { t.cleanup(); }
});

test('a card held back keeps its place across a restart', async () => {
  const t = setUp({ recordings: fourAsks(), settings: { cardsPerDay: 0 } });
  try {
    await t.ask('r1');
    const again = engineRunner({
      engine: t.engine, file: t.runner.file, readViews: () => t.views, write: async (kind, data) => { t.writes.push({ kind, data }); },
      stopped: () => false, now: () => t.world.now, settings: () => ({ cardsPerDay: 0 }), workOf: () => ({ work: 'sale-banner', lane: 'quick' }), titleOf: () => 'The sale banner',
    });
    await again.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1);
    assert.equal(heldNote(t).count, 1);
  } finally { t.cleanup(); }
});

test('asks kept unwritten by the version before become cards on the first tick, once', async () => {
  const t = setUp({ settings: { cardsPerDay: 0 } });
  try {
    const { event, runId } = await t.ask();
    const kept = JSON.parse(fs.readFileSync(t.runner.file, 'utf8'));
    const q = t.writes.filter((w) => w.kind === 'question')[0].data;
    t.writes.length = 0;
    const entry = { ...kept.held[0] };
    delete entry.id;
    fs.writeFileSync(t.runner.file, JSON.stringify({ ...kept, held: undefined, waiting: [entry], questions: {}, noted: 1, next: {} }));
    const again = engineRunner({
      engine: t.engine, file: t.runner.file, readViews: () => t.views, write: async (kind, data) => { t.writes.push({ kind, data }); },
      stopped: () => false, now: () => t.world.now, settings: () => ({ cardsPerDay: 0 }), workOf: () => ({ work: 'sale-banner', lane: 'quick' }), titleOf: () => 'The sale banner',
    });
    await again.tick();
    await again.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1);
    assert.equal(t.writes.filter((w) => w.kind === 'note').at(-1).data.count, 1);
    assert.equal(event.runId, runId);
    assert.match(q.id, /^q-sale-banner-/);
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
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, gate: { startAdmitted: async (args) => { started.push(args); return { ok: true, runId: 'again-1' }; } } });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
    await t.runner.tick();
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started'], ['2026-10-29T13:00:00.000Z', 'ended', { outcome: 'cancelled' }]]);
    const q = t.writes.filter((w) => w.kind === 'question').at(-1).data;
    t.views.questions[q.id] = { question: { data: q }, answer: { label: 'Give it more' } };
    await t.runner.tick();
    assert.deepEqual(started, [{ work: 'sale-banner', key: q.id, lane: 'quick', branch: 'wh/sale-banner', carryOn: true, raised: true, carried: { raised: true, runs: [runId] } }]);
  } finally { t.cleanup(); }
});

test('Give it more on a run that stopped on a failure resumes it, skipping finished steps', async () => {
  const t = setUp();
  const calls = [];
  const engine = { act: async (runId, action) => { calls.push({ runId, action }); return { ok: true }; }, inspect: async () => ({ status: 'ended', outcome: 'failed', steps: [] }) };
  const runner = engineRunner({ engine, file: path.join(path.dirname(t.runner.file), 'two.json'), readViews: () => t.views, write: async () => {}, now: () => t.world.now, workOf: () => ({ work: 'sale-banner', lane: 'quick' }) });
  try {
    withRun(t, 'r9', [['2026-10-29T12:50:00.000Z', 'started'], ['2026-10-29T12:55:00.000Z', 'ended', { outcome: 'failed' }]]);
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
    assert.equal(acts(t.engine).length, 0, 'a paused run spends nothing, and Give it more can still carry it on, so it is held, not cancelled');
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
    assert.ok(acts(t.engine).every((c) => c.action.cancel), 'no answer goes to it');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'its ask never becomes a card');
    assert.ok(t.writes.some((w) => w.kind === 'note' && /stays stopped/.test(w.data.words ?? '')));
  } finally { t.cleanup(); }
});

test('Stop on a held run cancels it in the engine and ends it in the record, so it gives back its build slot', async () => {
  const { t, runId } = pausedAtCap();
  try {
    await t.runner.tick();
    answerCap(t, 'Stop');
    await t.runner.tick();
    const ended = t.writes.filter((w) => w.kind === 'run' && w.data.runId === runId);
    assert.equal(ended.length, 1);
    assert.deepEqual(ended[0].data, { work: 'sale-banner', lane: 'quick', engine: 'fake', runId, state: 'ended', outcome: 'stopped', branch: 'wh/sale-banner' });
    assert.deepEqual(acts(t.engine).map((c) => Object.keys(c.action)), [['cancel']], 'cancelled, never abandoned, so its worktree is kept');
    assert.equal(t.engine.inspect(runId).status, 'ended');
    assert.ok(t.writes.some((w) => w.kind === 'note' && /no longer holds a build slot/.test(w.data.words ?? '')));
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'run').length, 1, 'once');
    await t.runner.onAsk({ ...t.engine.watch('0').events.filter((e) => e.runId === runId && e.type === 'ask').at(-1), id: 'again' });
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'an ask the stopped run shows again is no card');
  } finally { t.cleanup(); }
});

test('Stop on a held run an engine built without the patch refuses to cancel leaves it paused, and the record still ends it', async () => {
  const { t, runId } = pausedAtCap();
  try {
    await t.runner.tick();
    const act = t.engine.act;
    t.engine.act = (id, action) => (action.cancel ? { ok: false, refused: "The run isn't running, so there is nothing to cancel" } : act(id, action));
    answerCap(t, 'Stop');
    await t.runner.tick();
    assert.equal(t.engine.inspect(runId).status, 'paused');
    assert.equal(t.writes.filter((w) => w.kind === 'run' && w.data.runId === runId).length, 1);
    assert.ok(t.writes.some((w) => w.kind === 'note' && /stays paused in the build engine/.test(w.data.words ?? '')));
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
    assert.ok(acts(t.engine).every((c) => c.action.cancel), 'no answer is sent to the stopped run');
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
  t.runner.onEnter((args) => { if (args.via !== 'answer') started.push(args); });
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
    assert.deepEqual(started, [{ work: 'sale-banner', lane: 'quick', via: 'rework', key: `rework:${runId}`, branch: 'wh/sale-banner', carryOn: true, raised: false, answers: [], carried: { raised: false, runs: [runId] } }], 'asked for once');
  } finally { t.cleanup(); }
});

test('an answer of the step\'s own starts the work again with the director\'s answers in its order', async () => {
  const started = [];
  const t = setUp({ recordings: { one: blockedAsk('q1', { options: OWN }) } });
  t.runner.onEnter((args) => { if (args.via !== 'answer') started.push(args); });
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
    t.runner.onEnter((args) => { if (args.via !== 'answer') started.push(args); });
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
    t.runner.onEnter((args) => { if (args.via !== 'answer') started.push(args); });
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
  t.runner.onEnter((args) => { if (args.via !== 'answer') started.push(args); });
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
  t.runner.onEnter((args) => { if (args.via !== 'answer') started.push(args); });
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
  t.runner.onEnter((args) => { if (args.via !== 'answer') started.push(args); });
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
  const t = setUp({ recordings: { one: blockedAsk('q1', { options: OWN }), two: blockedAsk('q2', { options: OWN }), three: blockedAsk('q3', { question: 'Another question?', options: OWN }) }, gate: { headOf: async () => 'a'.repeat(40), commitsSince: async () => 0, exclusionsOf: async () => [] } });
  t.runner.onEnter(() => {});
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

// The merge queue's question about a pull request, as the adapter gives it, and what its record step says it asked.
const ASKED_HEAD = 'c'.repeat(40);
const mergeAsk = (id) => ({ type: 'ask', id, kind: 'question', level: 3, recommend: null, card: true, holdsAll: true, mergeQuestion: { pr: 7 }, reason: 'The merge queue won\'t judge pull request #7 by itself.', options: [{ id: 'go', label: 'Merge at ccc' }, { id: 'back', label: 'Return it' }, { id: 'leave', label: 'Leave it' }] });
function mergeSetUp({ stop = false, title = 'Switch on the greeting', lane = 'feature', head = ASKED_HEAD, askedHead = ASKED_HEAD, merge = 'go', park = null, signed = true, act, known = true, handBack, file = null, takeBack, notReady, localChange } = {}) {
  const asked = (id) => [ev({ type: 'run-started' }), ev(mergeAsk(id)), ev({ type: 'ask-resolved', id }), ev({ type: 'run-ended', outcome: 'completed' })];
  const t = setUp({ recordings: { one: asked('q9'), two: asked('q10') }, stop });
  t.asked = { head: askedHead };
  t.engine.mergeAsked = async () => ({ pr: 7, head: t.asked.head, merge, park });
  if (act) t.engine.act = act;
  if (signed) t.views.approvals = { 7: { [head]: { kind: 'approval', data: { pr: 7, commit: head } } } };
  t.ruled = [];
  t.mergeFile = file ?? path.join(path.dirname(t.runner.file), 'merge.json');
  const runner = engineRunner({
    engine: t.engine, file: t.mergeFile, readViews: () => t.views, write: async (kind, data) => { t.writes.push({ kind, data }); },
    stopped: () => t.world.stop, now: () => t.world.now, settings: () => ({ cardsPerDay: 3 }), workOf: () => (known ? { work: 'merge-queue', lane: 'merge' } : null), titleOf: () => 'the changes waiting to be added',
    openedOf: (pr) => (pr === 7 ? { lane, work: 'card-81' } : null), prTitleOf: async () => title, handBack, takeBack, notReady, localChange,
  });
  runner.onMergeRuled(() => t.ruled.push(true));
  const ask = async (recording = 'one') => {
    const { runId } = t.engine.start({ recording });
    await runner.onAsk(t.engine.watch('0').events.filter((e) => e.runId === runId && e.type === 'ask').at(-1));
  };
  return { ...t, runner, ask };
}
const questions = (t) => t.writes.filter((w) => w.kind === 'question');

test('the merge queue\'s question about a switch-on already approved at its head is answered with that approval', async () => {
  const t = mergeSetUp();
  await t.ask();
  assert.equal(questions(t).length, 0, 'no second question');
  assert.equal(acts(t.engine).length, 1);
  assert.match(JSON.stringify(acts(t.engine)[0]), /"choice":"go"/);
  assert.equal(t.ruled.length, 1, 'the queue is due at once');
  const line = t.writes.find((w) => w.kind === 'note' && /approved/.test(w.data.words));
  assert.match(line.data.words, /#7/);
  assert.match(line.data.words, /ccccccc/);
  t.cleanup();
});

test('a head changed since the approval is asked about again', async () => {
  const t = mergeSetUp({ askedHead: 'd'.repeat(40) });
  await t.ask();
  assert.equal(questions(t).length, 1);
  assert.equal(acts(t.engine).length, 0);
  t.cleanup();
});

test('no signed approval, a pull request no feature run opened, or no merge choice is asked about', async () => {
  for (const over of [{ signed: false }, { lane: 'quick' }, { merge: null }]) {
    const t = mergeSetUp(over);
    await t.ask();
    assert.equal(questions(t).length, 1, JSON.stringify(over));
    assert.equal(acts(t.engine).length, 0, JSON.stringify(over));
    t.cleanup();
  }
});

test('under All stop the approved question waits, and goes back once it is lifted', async () => {
  const t = mergeSetUp({ stop: true });
  await t.ask();
  assert.equal(acts(t.engine).length, 0);
  assert.equal(questions(t).length, 0);
  t.world.stop = false;
  await t.runner.tick();
  assert.equal(acts(t.engine).length, 1);
  t.cleanup();
});

// The merge queue's question where the queue offers to leave the pull request alone.
const LEAVE = { park: 'leave', signed: false, lane: 'quick' };
const cardsOf = (t) => t.writes.filter((w) => w.kind === 'card');
const answers = (t) => acts(t.engine).map((a) => JSON.stringify(a));
const sign = (t, head = ASKED_HEAD, at = t.world.now.toISOString()) => { t.views.approvals = { ...t.views.approvals, 7: { ...t.views.approvals?.[7], [head]: { kind: 'approval', at, data: { pr: 7, commit: head } } } }; };

test('where park is offered it is taken, with no ruling, and the director\'s card is raised', async () => {
  const t = mergeSetUp(LEAVE);
  await t.ask();
  assert.equal(acts(t.engine).length, 1);
  assert.match(answers(t)[0], /"choice":"leave"/);
  assert.equal(t.ruled.length, 0, 'nothing here says the pull request merges');
  assert.equal(questions(t).length, 0, 'the question is the queue\'s, and it has gone');
  assert.equal(cardsOf(t).length, 1);
  assert.match(JSON.stringify(cardsOf(t)[0].data), /approval/);
  assert.match(JSON.stringify(cardsOf(t)[0].data), /#7/);
  t.cleanup();
});

test('the card a park raises holds up nothing, so it keeps to the day\'s budget', async () => {
  const t = mergeSetUp(LEAVE);
  const kept = () => JSON.parse(fs.readFileSync(t.mergeFile, 'utf8'));
  await t.ask();
  assert.equal(kept().shown.count, 1, 'it counted against the day');
  t.cleanup();
});

test('a title that names another number leaves it out of the card, and nothing else stops', async () => {
  const t = mergeSetUp({ ...LEAVE, title: 'Mends #212 in sign-in' });
  await t.ask();
  await t.runner.tick();
  assert.equal(cardsOf(t).length, 1);
  assert.match(JSON.stringify(cardsOf(t)[0].data), /#7/);
  assert.doesNotMatch(JSON.stringify(cardsOf(t)[0].data), /#212/);
  t.cleanup();
});

test('an approval from before the park doesn\'t answer the card it raised', async () => {
  const handed = [];
  const t = mergeSetUp({ ...LEAVE, handBack: async (args) => { handed.push(args); return { ok: true }; } });
  sign(t, ASKED_HEAD, '2026-10-01T00:00:00.000Z');
  await t.ask();
  await t.runner.tick();
  assert.equal(handed.length, 0, 'the director hasn\'t seen what the queue is unsure of');
  assert.equal(cardsOf(t).length, 1);
  await t.ask('two');
  assert.match(answers(t)[1], /"choice":"leave"/, 'nor does it answer the queue\'s next ask');
  sign(t);
  await t.runner.tick();
  assert.equal(handed.length, 1);
  t.cleanup();
});

test('a tick during a park raises one card', async () => {
  let let_go;
  const gate = new Promise((resolve) => { let_go = resolve; });
  const t = mergeSetUp({ ...LEAVE, act: async () => { await gate; return { ok: true }; } });
  const asking = t.ask();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const ticking = t.runner.tick();
  let_go();
  await Promise.all([asking, ticking]);
  assert.equal(cardsOf(t).length, 1);
  t.cleanup();
});

test('a parked pull request whose work has gone leaves the record, and its approval sends nothing back', async () => {
  const replies = [{ ok: false, gone: true }];
  const handed = [];
  const t = mergeSetUp({ ...LEAVE, handBack: async (args) => { handed.push(args); return replies.shift(); } });
  await t.ask();
  sign(t);
  await t.runner.tick();
  await t.runner.tick();
  assert.equal(handed.length, 1);
  assert.deepEqual(t.runner.parkedHeads(), {});
  assert.deepEqual([...t.runner.waitingWork()], []);
  assert.equal(t.ruled.length, 0);
  assert.equal(t.writes.filter((w) => w.kind === 'note' && /goes back/.test(w.data.words)).length, 0);
  t.cleanup();
});

test('a refused hand-back is said once', async () => {
  const t = mergeSetUp({ ...LEAVE, handBack: async () => ({ ok: false, refused: 'no record of it' }) });
  await t.ask();
  sign(t);
  await t.runner.tick();
  await t.runner.tick();
  assert.equal(t.writes.filter((w) => w.kind === 'note' && /no record of it/.test(w.data.words)).length, 1);
  t.cleanup();
});

test('where it isn\'t, the question stays a blocking card', async () => {
  const t = mergeSetUp({ ...LEAVE, park: null });
  await t.ask();
  assert.equal(acts(t.engine).length, 0);
  assert.equal(questions(t).length, 1);
  assert.equal(cardsOf(t).length, 0);
  t.cleanup();
});

test('a park id the question doesn\'t offer is not taken', async () => {
  const t = mergeSetUp({ ...LEAVE, park: 'gone' });
  await t.ask();
  assert.equal(acts(t.engine).length, 0);
  assert.equal(questions(t).length, 1);
  t.cleanup();
});

test('a park the engine won\'t take, with the run still paused, stays a blocking card', async () => {
  const t = mergeSetUp({ ...LEAVE, act: async () => ({ ok: false, refused: 'not now' }) });
  t.engine.inspect = async () => ({ status: 'paused' });
  await t.ask();
  assert.equal(questions(t).length, 1);
  assert.equal(cardsOf(t).length, 0);
  t.cleanup();
});

test('a park that couldn\'t be heard is tried again on the next tick, and raises one card', async () => {
  let up = false;
  const sent = [];
  const t = mergeSetUp({ ...LEAVE, act: async (runId, what) => { sent.push(what); return up ? { ok: true } : { ok: false, unreachable: true }; } });
  await t.ask();
  assert.equal(cardsOf(t).length, 0);
  up = true;
  await t.runner.tick();
  await t.runner.tick();
  assert.equal(sent.length, 2);
  assert.equal(cardsOf(t).length, 1);
  t.cleanup();
});

test('a restart between taking the park and raising its card still raises the card', async () => {
  const t = mergeSetUp({ ...LEAVE, act: async () => ({ ok: false, unreachable: true }) });
  await t.ask();
  const again = mergeSetUp({ ...LEAVE, file: t.mergeFile, act: async () => ({ ok: false, refused: 'already answered' }) });
  again.engine.inspect = async () => ({ status: 'ended' });
  await again.runner.tick();
  assert.equal(cardsOf(again).length, 1);
  assert.equal(questions(again).length, 0);
  again.cleanup();
  t.cleanup();
});

test('under All stop nothing is parked, and the question goes back once it is lifted', async () => {
  const t = mergeSetUp({ ...LEAVE, stop: true });
  await t.ask();
  assert.equal(acts(t.engine).length, 0);
  assert.equal(cardsOf(t).length, 0);
  t.world.stop = false;
  await t.runner.tick();
  assert.equal(acts(t.engine).length, 1);
  assert.equal(cardsOf(t).length, 1);
  t.cleanup();
});

test('a parked pull request\'s piece waits on the director, and others merge', async () => {
  const t = mergeSetUp(LEAVE);
  await t.ask();
  assert.deepEqual([...t.runner.waitingWork()], ['card-81']);
  assert.deepEqual(t.runner.parkedHeads(), { 7: ASKED_HEAD }, 'the dispatcher leaves it out of what the queue is due for');
  sign(t);
  assert.deepEqual([...t.runner.waitingWork()], [], 'answered, it no longer waits on the director');
  t.cleanup();
});

test('a second ask about a pull request parked at that head raises no second card', async () => {
  const t = mergeSetUp(LEAVE);
  await t.ask();
  await t.ask('two');
  assert.equal(acts(t.engine).length, 2);
  assert.match(answers(t)[1], /"choice":"leave"/);
  assert.equal(cardsOf(t).length, 1);
  t.cleanup();
});

test('Merge is a signed approval of that head, and the next ask merges on it, in any lane', async () => {
  const handed = [];
  const t = mergeSetUp({ ...LEAVE, handBack: async (args) => { handed.push(args); return { ok: true }; } });
  await t.ask();
  await t.runner.tick();
  assert.equal(handed.length, 0, 'no approval, nothing goes back');
  sign(t);
  await t.runner.tick();
  await t.runner.tick();
  assert.deepEqual(handed, [{ pr: 7 }], 'once');
  assert.equal(t.ruled.length, 1, 'the queue is due at once');
  assert.deepEqual(t.runner.parkedHeads(), {}, 'back in the queue');
  assert.equal(acts(t.engine).length, 1, 'the ended run is sent nothing');
  await t.ask('two');
  assert.equal(acts(t.engine).length, 2);
  assert.match(answers(t)[1], /"choice":"go"/);
  assert.equal(t.ruled.length, 2);
  assert.equal(cardsOf(t).length, 1, 'no second card');
  t.cleanup();
});

test('a hand-back that has to wait for the queue is tried again, and All stop holds it', async () => {
  const replies = [{ ok: false, waiting: true }, { ok: true }];
  const handed = [];
  const t = mergeSetUp({ ...LEAVE, handBack: async (args) => { handed.push(args); return replies.shift(); } });
  await t.ask();
  sign(t);
  t.world.stop = true;
  await t.runner.tick();
  assert.equal(handed.length, 0);
  assert.equal(t.writes.filter((w) => w.kind === 'note' && /All stop/.test(w.data.words)).length, 0, 'a signed approval outlasts All stop');
  t.world.stop = false;
  await t.runner.tick();
  await t.runner.tick();
  assert.equal(handed.length, 2);
  assert.equal(t.ruled.length, 1);
  t.cleanup();
});

test('a new head isn\'t covered by that approval', async () => {
  const t = mergeSetUp({ ...LEAVE, handBack: async () => ({ ok: true }) });
  await t.ask();
  sign(t);
  await t.runner.tick();
  t.asked.head = 'd'.repeat(40);
  await t.ask('two');
  assert.equal(acts(t.engine).length, 2);
  assert.match(answers(t)[1], /"choice":"leave"/, 'left alone again, not merged');
  assert.equal(cardsOf(t).length, 2, 'a card for the new head');
  assert.deepEqual(t.runner.parkedHeads(), { 7: 'd'.repeat(40) });
  t.cleanup();
});

test('a card for a head that moved on no longer counts as the piece waiting', async () => {
  const t = mergeSetUp(LEAVE);
  await t.ask();
  t.asked.head = 'd'.repeat(40);
  await t.ask('two');
  sign(t, 'd'.repeat(40));
  assert.deepEqual([...t.runner.waitingWork()], []);
  t.cleanup();
});

test('an approved question the engine won\'t take comes as a card', async () => {
  const t = mergeSetUp({ act: async () => ({ ok: false, refused: 'moved on' }) });
  await t.ask();
  assert.equal(questions(t).length, 1);
  assert.equal(t.ruled.length, 0);
  t.cleanup();
});

test('the merge queue\'s card names the pull request and its title', async () => {
  const t = mergeSetUp({ signed: false });
  await t.ask();
  assert.match(questions(t)[0].data.what, /pull request #7, "Switch on the greeting"/);
  t.cleanup();
});

test('the card names the number alone when the host gives no title', async () => {
  const t = mergeSetUp({ signed: false, title: null });
  await t.ask();
  assert.match(questions(t)[0].data.what, /pull request #7\b/);
  assert.doesNotMatch(questions(t)[0].data.what, /"/);
  t.cleanup();
});

test('the director\'s merge answer makes the queue due; any other answer doesn\'t', async () => {
  for (const [label, due] of [['Merge at ccc', 1], ['Return it', 0]]) {
    const t = mergeSetUp({ signed: false });
    await t.ask();
    const q = questions(t)[0].data;
    t.views.questions[q.id] = { question: { data: q }, answer: { label, at: t.world.now.toISOString() } };
    await t.runner.tick();
    assert.equal(t.ruled.length, due, label);
    t.cleanup();
  }
});

test('a question from a merge-queue run the helper didn\'t start still comes as a card', async () => {
  const t = mergeSetUp({ signed: false, known: false });
  await t.ask();
  assert.equal(questions(t).length, 1);
  assert.equal(questions(t)[0].data.work, 'merge-queue');
  t.cleanup();
});

test('a run that ended, cancelled or not, has its task reviews kept once, tried again until they are', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-runner-'));
  const views = { runs: { 'card-1': [{ data: { runId: 'run-1', lane: 'slice', state: 'started' } }, { data: { runId: 'run-1', lane: 'slice', state: 'ended', outcome: 'cancelled' } }] } };
  const kept = [];
  let answer = false;
  const runner = engineRunner({
    engine: fakeEngine(), file: path.join(dir, 'router.json'), readViews: () => views, write: async () => {}, stopped: () => true,
    keepReviews: async (runId) => { kept.push(runId); return answer; },
  });
  await runner.tick();
  assert.deepEqual(kept, ['run-1'], 'under All stop too');
  answer = true;
  await runner.tick();
  await runner.tick();
  assert.deepEqual(kept, ['run-1', 'run-1']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the card is written whether or not onCard throws', async () => {
  const t = setUp({ onCard: () => { throw new Error('the seal broke'); } });
  try {
    await t.ask();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1);
    assert.equal(t.writes.filter((w) => w.kind === 'note' && w.data.about === 'engine').length, 0, 'nothing is said');
  } finally { t.cleanup(); }
});

test('a question card is told to the seals after it is written, with its branch and folder', async () => {
  const seen = [];
  const t = setUp({
    recordings: { one: asking('q1', { context: { branch: 'wh/x', folder: '/w/x' } }) },
    onCard: (card) => { seen.push({ card, written: t.writes.filter((w) => w.kind === 'question').length }); },
  });
  try {
    const { runId } = await t.ask();
    const q = t.writes.find((w) => w.kind === 'question').data;
    assert.deepEqual(seen, [{ card: { id: q.id, kind: 'question', work: 'sale-banner', runId, level: 3, branch: 'wh/x', folder: '/w/x' }, written: 1 }]);
  } finally { t.cleanup(); }
});

test('a level 4 question is told with its level, and the merge queue\'s and trouble cards by what they are', async () => {
  const seen = [];
  const t = setUp({
    recordings: {
      one: asking('q1', { level: 4 }),
      two: asking('q2', { mergeQuestion: { pr: 7 } }),
      three: asking('q3', { kind: 'trouble', card: true, options: [] }),
    },
    onCard: (card) => { seen.push(card); },
  });
  try {
    await t.ask('one');
    await t.ask('two');
    await t.ask('three');
    assert.deepEqual(seen.map((c) => [c.kind, c.level]), [['question', 4], ['merge', 3], ['trouble', seen[2]?.level]]);
  } finally { t.cleanup(); }
});

test('an approval card and a cap card are told to the seals', async () => {
  const seen = [];
  const t = setUp({
    recordings: { one: asking('q1', { kind: 'approval', pr: 7, sha: HEAD, approve: 'b' }) },
    onCard: (card) => { seen.push(card); },
  });
  try {
    const { runId } = await t.ask();
    await t.runner.capped({ runId, work: 'sale-banner', lane: 'quick', branch: 'wh/x', reached: { cap: 'minutes', limit: 30 } });
    const kinds = seen.map((c) => c.kind);
    assert.ok(kinds.includes('cap'));
    assert.equal(seen.find((c) => c.kind === 'cap').branch, 'wh/x');
    assert.equal(seen.find((c) => c.kind === 'cap').level, 3);
  } finally { t.cleanup(); }
});

test('an ask on a reader\'s run never becomes a card, and goes to the seals', async () => {
  const told = [];
  const t = setUp({ workOf: () => ({ work: READER_WORK, lane: 'reader' }), onReaderAsk: (ask) => told.push(ask.id) });
  try {
    await t.runner.onAsk({ type: 'ask', runId: 'r-1', at: 't', id: 'r-1:owner-lost', kind: 'trouble', level: 3, work: null, recommend: 'stop', labels: {}, options: [], context: {}, card: true });
    assert.deepEqual(told, ['r-1:owner-lost']);
    assert.deepEqual(t.writes, []);
  } finally { t.cleanup(); }
});

test('no cap reads a reader\'s run, and the runner writes no cost for it', async () => {
  const t = setUp({ recordings: { big: spending(2500000) } });
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    t.views.runs = { [READER_WORK]: [{ at: '2026-10-29T12:50:00.000Z', data: { work: READER_WORK, lane: 'reader', engine: 'fake', runId, state: 'started' } }] };
    await t.runner.tick();
    t.views.runs[READER_WORK].push({ at: '2026-10-29T12:51:00.000Z', data: { work: READER_WORK, lane: 'reader', engine: 'fake', runId, state: 'ended' } });
    await t.runner.tick();
    assert.deepEqual(t.writes.filter((w) => ['cost', 'question', 'card'].includes(w.kind)), []);
    assert.equal(t.engine.calls.filter((c) => c.action?.cancel).length, 0);
  } finally { t.cleanup(); }
});

test('waitingWork names a piece with an open card, until the director answers', async () => {
  const t = setUp();
  try {
    assert.deepEqual([...t.runner.waitingWork()], []);
    await t.ask();
    assert.deepEqual([...t.runner.waitingWork()], ['sale-banner']);
    t.sign('Keep it small');
    assert.deepEqual([...t.runner.waitingWork()], []);
  } finally { t.cleanup(); }
});

test('waitingWork names the piece a merge card stands for, by the pull request the queue says it asked about', async () => {
  const t = setUp({
    recordings: { one: asking('q1', { mergeQuestion: { pr: null }, reason: 'Merge it?' }) },
    workOf: () => ({ work: 'merge-queue', lane: 'merge' }),
    mergeAsked: async () => ({ pr: 12, head: HEAD, merge: 'merge' }),
    openedOf: (pr) => (pr === 12 ? { lane: 'quick', work: 'sale-banner' } : null),
  });
  try {
    await t.ask();
    assert.deepEqual([...t.runner.waitingWork()], ['sale-banner']);
  } finally { t.cleanup(); }
});

test('waitingWork names no one when the views can\'t be read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-runner-'));
  try {
    const file = path.join(dir, 'router.json');
    fs.writeFileSync(file, JSON.stringify({ questions: { q1: { runId: 'r1', work: 'a' } } }));
    const runner = engineRunner({ engine: fakeEngine({}), file, readViews: () => { throw new Error('unreadable'); }, write: async () => {} });
    assert.deepEqual([...runner.waitingWork()], []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the director\'s Stop ends a reservation, at a blocked exit and at a cap', async () => {
  const released = [];
  const t = setUp({ recordings: { one: blockedAsk('q1') }, release: (work) => released.push(work) });
  try {
    await t.ask();
    t.sign('Stop this work');
    await t.runner.tick();
    assert.deepEqual(released, ['sale-banner']);
  } finally { t.cleanup(); }

  const held = [];
  const capped = pausedAtCap({ release: (work) => held.push(work) });
  try {
    await capped.t.runner.tick();
    answerCap(capped.t, 'Stop');
    await capped.t.runner.tick();
    assert.deepEqual(held, ['sale-banner']);
  } finally { capped.t.cleanup(); }
});

test('Stop ends a reservation even when the build had already moved on, and an unreachable engine waits', async () => {
  const released = [];
  const t = setUp({ recordings: { one: blockedAsk('q1') }, release: (work) => released.push(work) });
  try {
    await t.ask();
    t.sign('Stop this work');
    const act = t.engine.act;
    t.engine.act = () => { throw new Error('no answer'); };
    await t.runner.tick();
    assert.deepEqual(released, [], 'not delivered yet');
    t.engine.act = () => ({ ok: false, refused: 'it moved on' });
    await t.runner.tick();
    assert.deepEqual(released, ['sale-banner']);
    t.engine.act = act;
  } finally { t.cleanup(); }
});

test('Stop on an ask of any kind ends a reservation', async () => {
  const released = [];
  const t = setUp({ recordings: { one: asking('q1', { kind: 'trouble', recommend: 'stop', options: [{ id: 'stop', label: 'Stop this work' }] }) }, release: (work) => released.push(work) });
  try {
    await t.ask();
    t.sign('Stop this work');
    await t.runner.tick();
    assert.deepEqual(released, ['sale-banner']);
  } finally { t.cleanup(); }
});

test('Stop under All stop ends a reservation only when All stop cancelled the run', async () => {
  const released = [];
  const t = setUp({ recordings: { one: blockedAsk('q1') }, release: (work) => released.push(work) });
  try {
    await t.ask();
    t.world.stop = true;
    t.sign('Stop this work');
    await t.runner.tick();
    assert.deepEqual(released, [], 'the run still stands, and the question comes back');
  } finally { t.cleanup(); }

  const gone = [];
  const u = setUp({ recordings: { one: blockedAsk('q1') }, release: (work) => gone.push(work) });
  try {
    const { runId } = await u.ask();
    u.engine.act(runId, { cancel: { reason: 'All stop' } });
    u.world.stop = true;
    u.sign('Stop this work');
    await u.runner.tick();
    assert.deepEqual(gone, ['sale-banner']);
  } finally { u.cleanup(); }
});

test('Give it more and Send it back keep the reservation', async () => {
  const released = [];
  const t = setUp({ recordings: { one: blockedAsk('q1') }, release: (work) => released.push(work) });
  try {
    await t.ask();
    t.sign('Send it back for a fresh run');
    await t.runner.tick();
    assert.deepEqual(released, []);
  } finally { t.cleanup(); }

  const held = [];
  const capped = pausedAtCap({ release: (work) => held.push(work) });
  try {
    await capped.t.runner.tick();
    answerCap(capped.t, 'Give it more');
    await capped.t.runner.tick();
    assert.deepEqual(held, []);
  } finally { capped.t.cleanup(); }
});

test('a bug that moves lane releases the old id\'s reservation', async () => {
  const MOVE = [{ id: 'small', label: 'Make it a small change' }, { id: 'stop', label: 'Stop this work' }];
  const released = [];
  const t = setUp({ recordings: { one: asking('q1', { kind: 'blocked', topic: 'bigger-than-a-bug', recommend: 'small', options: MOVE, context: { question: 'Bigger?' } }) }, release: (work) => released.push(work) });
  try {
    const { runId } = await t.ask();
    t.sign('Make it a small change');
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started', { lane: 'bug' }]]);
    await t.runner.tick();
    assert.deepEqual(released, ['sale-banner']);
  } finally { t.cleanup(); }
});

test('trouble releasing costs nothing else', async () => {
  const t = setUp({ recordings: { one: blockedAsk('q1') }, release: () => { throw new Error('no disk'); } });
  try {
    await t.ask();
    t.sign('Stop this work');
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action.answer?.choice), ['stop']);
  } finally { t.cleanup(); }
});

// Delegated decisions design, section 8.3: the click counts at once, and delivery waits for a place.
const waitingAnswer = async (over = {}) => {
  const w = wayBack({ recordings: { a: asks('qa'), busy: forever() }, pace: 1, ...over });
  w.put('a', { place: 0 });
  w.put('busy', { place: 1 });
  await w.tick(3);
  return w;
};

test('an answer that stops the work goes at once, with no place', async () => {
  const w = await waitingAnswer({ recordings: { a: asks('qa', { options: [{ id: 'stop', label: 'Stop' }, { id: 'go', label: 'Go on' }] }), busy: forever() } });
  w.answer('a', 'Stop');
  await w.pump();
  await w.runner.tick();
  assert.equal(w.answers().length, 1);
  assert.equal(w.dispatcher.admittedTo('a'), false);
});

test('a refused answer is dropped', async () => {
  const w = await waitingAnswer();
  const q = w.cardOf('a');
  w.engine.act(w.runsOf('a')[0], { answer: { ask: 'qa', choice: 'a' } });
  w.engine.act(w.runsOf('busy')[0], { cancel: { reason: 'done' } });
  w.answer('a', q.options[0].label);
  await w.tick(4);
  assert.equal(w.dispatcher.admittedTo('a'), false, 'refused: nothing is left on the way back');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8')).returning, []);
});

test('an answer with nothing to send never enters', async () => {
  const t = setUp({ recordings: { ok: asking('ap1', { kind: 'approval', options: [], setLine: { pr: 9, head: HEAD } }) } });
  const entered = [];
  t.runner.onEnter((args) => entered.push(args));
  try {
    await t.ask('ok');
    t.views.approvals = { 9: { [HEAD]: { data: { pr: 9, commit: HEAD } } } };
    await t.runner.tick();
    assert.deepEqual(entered, []);
    assert.equal(acts(t.engine).length, 0);
  } finally { t.cleanup(); }
});

test('the fix lane and the merge queue never wait for admit', async () => {
  for (const lane of [FIX_LANE, 'merge']) {
    const t = setUp({ workOf: () => ({ work: 'sale-banner', lane }), gate: { admittedTo: () => false } });
    let entries = 0;
    t.runner.onEnter(() => { entries += 1; });
    try {
      await t.ask();
      t.sign('Do the whole page');
      await t.runner.tick();
      assert.equal(acts(t.engine).length, 1, lane);
      assert.equal(entries, 0, lane);
    } finally { t.cleanup(); }
  }
});

test('Give it more asks for a place, and a run that can\'t resume starts on that place', async () => {
  const entered = [];
  const fallback = [];
  const startAdmitted = async (args) => { fallback.push(args); return { ok: true, runId: 'again-1' }; };
  const gate = { admittedTo: () => entered.length > 0, startAdmitted };
  const t = setUp({ recordings: { big: spending(1200000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, gate });
  t.runner.onEnter((args) => entered.push(args));
  try {
    const { runId } = t.engine.start({ recording: 'big', running: true });
    withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started']]);
    await t.runner.tick();
    const q = t.writes.filter((w) => w.kind === 'question').at(-1).data;
    t.views.questions[q.id] = { question: { data: q }, answer: { label: 'Give it more' } };
    await t.runner.tick();
    assert.deepEqual(entered.map((e) => [e.via, e.key, e.runId]), [['more', q.id, runId]]);
    assert.deepEqual(fallback.map((f) => [f.key, f.carryOn, f.raised]), [[q.id, true, true]]);
  } finally { t.cleanup(); }
});

test('Give it more waits for its place, and a crash part way doesn\'t start a second run', async () => {
  const w = wayBack({ recordings: { a: asks('qa') }, pace: 1 });
  w.put('a');
  await w.tick();
  const runId = w.runsOf('a')[0];
  await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'tokens', limit: 10 }, paused: true });
  const q = w.cards().at(-1);
  w.questions[w.cards()[0].id].answer = { label: 'Do the whole page' };
  w.questions[q.id].answer = { label: 'Give it more' };
  await w.runner.tick();
  assert.equal(w.dispatcher.admittedTo('a'), false, 'it has asked, and has no place yet');
  const before = w.starts.length;
  await w.dispatcher.tick();
  assert.equal(w.dispatcher.admittedTo('a'), true);
  await w.runner.tick();
  w.restart();
  await w.tick(3);
  assert.equal(w.starts.length, before, 'the run was woken, so nothing started');
});

test('a piece with two open cards returns once both are answered', async () => {
  const w = wayBack({ recordings: { a: asks('qa') } });
  w.put('a');
  await w.tick();
  const runId = w.runsOf('a')[0];
  await w.runner.onAsk({ type: 'ask', id: 'qb', runId, at: '2026-10-29T02:00:00.000Z', kind: 'question', level: 3, recommend: 'b', options: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Other' }] });
  const [first, second] = w.cards();
  w.questions[first.id].answer = { label: 'Do the whole page' };
  await w.tick(2);
  assert.equal(w.answers().length, 0, 'the second card is still open');
  w.questions[second.id].answer = { label: 'Other' };
  await w.pump();
  await w.runner.tick();
  await w.dispatcher.tick();
  await w.runner.tick();
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask).sort(), ['qa', 'qb'], 'both go back, on the one place');
});

test('time on returning isn\'t running time, and meets no cap', async () => {
  const w = await waitingAnswer({ settings: { capMinutes: { quick: 1 }, capTokens: { quick: 1000000 } } });
  w.answer('a', 'Do the whole page');
  await w.tick();
  w.clock.now = new Date(w.clock.now.getTime() + 8 * 60 * 60 * 1000);
  const before = w.stateOf('a');
  await w.runner.tick();
  assert.equal(before, 'paused');
  assert.equal(w.cards().filter((c) => /reached its cap/.test(c.what) && c.work === 'a').length, 0);
});

test('under All stop the answer isn\'t used, the piece leaves returning, and Carry on has the answer and the branch, through a refused start', async () => {
  const w = await waitingAnswer({ recordings: { a: asks('qa', { context: { question: 'Which?', branch: 'wh/a' } }), busy: forever() } });
  w.answer('a', 'Do the whole page');
  await w.tick();
  w.stop = true;
  await w.engine.stopAll('All stop');
  await w.tick();
  assert.equal(w.answers().length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8')).returning, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8')).carryOver.a, { branch: 'wh/a', answers: [{ question: 'Which?', answer: 'Do the whole page' }] });
});

const wayBackAct = (w) => (runId, action) => { w.engine.calls.push({ call: 'act', runId, action }); return { ok: true }; };
// A piece on a run stopped at its cap, whose Give it more can't resume it.
const atCap = async () => {
  const w = wayBack({ recordings: { a: forever() }, pace: 1 });
  w.put('a');
  await w.tick();
  const runId = w.runsOf('a')[0];
  w.engine.act(runId, { cancel: { reason: 'its cap' } });
  await w.pump();
  await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'tokens', limit: 10 } });
  const q = w.cards().at(-1);
  w.questions[q.id].answer = { label: 'Give it more' };
  return { w, q, runId };
};
const ran = (w) => w.engine.calls.filter((c) => c.call === 'start').length;

test('Give it more refused once isn\'t lost: it stays on the way back and starts once', async () => {
  const { w } = await atCap();
  let refusals = 0;
  w.refuse = () => { refusals += 1; return refusals === 1 ? 'the mirror could not be read' : null; };
  await w.tick(4);
  assert.equal(refusals, 2);
  assert.equal(ran(w), 2, 'tried again, and started');
  assert.equal(w.runsOf('a').filter((id) => w.engine.inspect(id).status === 'running').length, 1);
  assert.deepEqual(w.runner.carried(w.runsOf('a').at(-1)).runs, [w.runsOf('a')[0]], 'with its spend carried');
});

test('a crash during Give it more\'s start doesn\'t start a second run', async () => {
  const { w } = await atCap();
  await w.runner.tick();
  await w.dispatcher.tick();
  // The engine starts the run, and the helper stops before it hears.
  w.startAs = async (args, real) => { await real(args); return new Promise(() => {}); };
  w.runner.tick();
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  w.startAs = null;
  assert.equal(ran(w), 2);
  w.restart();
  await w.tick(3);
  assert.equal(ran(w), 2);
});

test('a cap card answered after the work was queued again starts nothing beside the new run', async () => {
  const { w } = await atCap();
  w.work.a.work.at = '2026-10-29T12:00:00.000Z';
  w.clock.now = new Date('2026-10-29T12:00:01.000Z');
  await w.tick(3);
  assert.equal(ran(w), 2, 'only the new queueing\'s run');
  assert.ok(w.notes().some((n) => /wasn't used: the work was queued again/.test(n)));
});

test('an answer the engine took with no reply still brings the fresh run', async () => {
  const blocked = asks('qa', { kind: 'blocked', options: [{ id: 'rework', label: 'Send it back' }, { id: 'stop', label: 'Stop' }], context: { question: 'Which?' } });
  const w = wayBack({ recordings: { a: [blocked, forever()] } });
  w.put('a');
  await w.tick();
  w.answer('a', 'Send it back');
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => {
    act(runId, action);
    w.engine.act = act;
    return { ok: false, unreachable: true };
  };
  await w.tick(5);
  assert.equal(w.runsOf('a').length, 2, 'the second try was refused, since the first was taken, and the rework follows');
});

test('an approval signed under All stop on a run that survives goes back after the lift', async () => {
  const w = wayBack({ recordings: { a: asks('qa', { kind: 'approval', recommend: 'approve', options: [{ id: 'approve', label: 'Approve' }], setLine: { pr: 9, head: HEAD } }) } });
  w.put('a');
  await w.tick();
  w.stop = true;
  w.approvals[9] = { [HEAD]: { data: { pr: 9, commit: HEAD } } };
  await w.tick();
  assert.equal(w.answers().length, 0);
  w.stop = false;
  await w.tick(3);
  assert.equal(w.answers().length, 1);
});

test('under All stop with the engine unheard, the answer is looked at again', async () => {
  const w = await waitingAnswer({ recordings: { a: asks('qa', { context: { question: 'Which?', branch: 'wh/a' } }), busy: forever() } });
  w.answer('a', 'Do the whole page');
  w.stop = true;
  await w.engine.stopAll('All stop');
  const inspect = w.engine.inspect;
  w.engine.inspect = () => null;
  await w.tick();
  assert.equal(w.notes().filter((n) => /All stop was on/.test(n)).length, 0);
  w.engine.inspect = inspect;
  await w.tick();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8')).carryOver.a.answers, [{ question: 'Which?', answer: 'Do the whole page' }]);
});

test('a Stop at a held cap that a crash cut short is finished on the next tick', async () => {
  const w = wayBack({ recordings: { a: asks('qa') } });
  w.put('a');
  await w.tick();
  const runId = w.runsOf('a')[0];
  await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'tokens', limit: 10 }, paused: true });
  w.questions[w.cards().at(-1).id].answer = { label: 'Stop' };
  w.engine.act = () => new Promise(() => {});
  w.runner.tick();
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  delete w.engine.act;
  w.engine.act = wayBackAct(w);
  w.restart();
  await w.runner.tick();
  assert.equal(w.stateOf('a'), 'ended');
});

const ALIKE = { what: 'Which page should it open on?', options: [{ label: 'The first' }, { label: 'The last' }], level: 3 };

test('only the same words and options at level 3 bundle', () => {
  assert.equal(alike(ALIKE, { ...ALIKE, what: '  which PAGE should it​ open on ', options: [{ label: 'the last.' }, { label: 'THE FIRST' }] }), true);
  assert.equal(alike({ ...ALIKE, what: 'どのページを開きますか？' }, { ...ALIKE, what: 'どのページを開きますか' }), true, 'in a non-Latin script');
  assert.equal(alike({ ...ALIKE, what: 'どのページを開きますか' }, { ...ALIKE, what: 'どのページを閉じますか' }), false);
  assert.equal(alike(ALIKE, { ...ALIKE, options: [{ label: 'The first' }, { label: 'The middle' }] }), false, 'different labels');
  assert.equal(alike(ALIKE, { ...ALIKE, level: 4 }), false, 'a level 4');
  assert.equal(alike({ ...ALIKE, level: 2 }, { ...ALIKE, level: 2 }), false, 'nothing but level 3');
  assert.equal(alike(ALIKE, { ...ALIKE, what: 'Which page should it close on?', topic: 'pages' }), false, 'a matching topic with different words');
  assert.equal(alike(ALIKE, { ...ALIKE, commands: ['npm i'] }), false, 'a build command is signed for itself');
  assert.equal(alike(ALIKE, { approval: { pr: 1 } }), false, 'an approval');
  assert.equal(alike({ ...ALIKE, what: '...' }, { ...ALIKE, what: '...' }), false, 'nothing left of the words');
});

const OTHER_IDS = [{ id: 'x', label: 'keep it small' }, { id: 'y', label: 'Do the whole page' }];
const twoAlike = () => wayBack({ recordings: { a: asks('qa', { reason: 'Which page?' }), b: asks('qb', { reason: 'which page', options: OTHER_IDS, recommend: 'y' }) } });

test('an alike question joins the open card, in any lane, and raises no card of its own', async () => {
  const w = wayBack({ recordings: { a: asks('qa', { reason: 'Which page?' }), b: asks('qb', { reason: 'which page' }) } });
  w.put('a', { place: 0 });
  w.put('b', { lane: 'bug', place: 1 });
  await w.tick(2);
  const [lead, joiner] = w.cards();
  assert.equal(lead.joins, undefined);
  assert.equal(joiner.joins, lead.id);
  assert.equal(w.written.filter((x) => x.kind === 'note' && x.data.about === 'cards-waiting' && x.data.ids.includes(joiner.id)).length, 0);
});

test('two questions of one piece stay two cards', async () => {
  const w = wayBack({ recordings: { a: [...asks('q1', { reason: 'Which page?' }).slice(0, 3), ...asks('q2', { reason: 'Which page?' }).slice(1)] } });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.deepEqual(w.cards().map((q) => q.joins), [undefined, undefined]);
});

test('a question at level 4, a merge question and trouble never join', async () => {
  const w = wayBack({ recordings: { a: asks('qa', { reason: 'Which page?' }), b: asks('qb', { reason: 'Which page?', level: 4 }), c: asks('qc', { reason: 'Which page?', kind: 'trouble' }) } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  w.put('c', { place: 2 });
  await w.tick(2);
  assert.deepEqual(w.cards().map((q) => q.joins), [undefined, undefined, undefined]);
});

test('the answer goes to each piece, once, by each one\'s own option ids', async () => {
  const w = twoAlike();
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  w.answer('a', 'Do the whole page', { shown: ['b'] });
  await w.tick(4);
  const sent = w.answers().map((c) => c.action.answer);
  assert.deepEqual(sent.map((x) => x.ask).sort(), ['qa', 'qb']);
  assert.equal(sent.find((x) => x.ask === 'qa').choice, 'b');
  assert.equal(sent.find((x) => x.ask === 'qb').choice, 'y');
});

test('a joined piece waits until the lead is answered, and only for what its card showed', async () => {
  const w = twoAlike();
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  assert.deepEqual([...w.runner.waitingWork()].sort(), ['a', 'b']);
  w.answer('a', 'Do the whole page');
  await w.tick(4);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask), ['qa'], 'the card never showed b, so b is still asked');
  assert.deepEqual([...w.runner.waitingWork()], ['b']);
});

test('a piece that ended leaves the bundle, and the rest are answered', async () => {
  const w = wayBack({ recordings: { a: asks('qa', { reason: 'Which page?' }), b: asks('qb', { reason: 'Which page?' }), c: asks('qc', { reason: 'Which page?' }) } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  w.put('c', { place: 2 });
  await w.tick(2);
  w.endRun('a');
  w.endRun('c');
  w.answer('a', 'Keep it small', { shown: ['b', 'c'] });
  await w.tick(4);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask), ['qb']);
  assert.equal(w.notes().filter((n) => /wasn't needed/.test(n)).length, 0, 'an ended piece is said of nowhere');
});

test('a lead the record refused keeps its joiner back, and a lead dropped frees it', async () => {
  const w = wayBack({ recordings: { a: asks('qa', { reason: 'Which page?' }), b: asks('qb', { reason: 'Which page?' }) } });
  let refusing = true;
  w.refuseWrite = (kind) => refusing && kind === 'question';
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  assert.equal(w.cards().length, 0);
  refusing = false;
  await w.tick();
  assert.equal(w.cards().length, 2);
  assert.equal(w.cards()[1].joins, w.cards()[0].id);
});

const BLOCKED = { kind: 'blocked', reason: 'Which page?', options: [{ id: 'rework', label: 'Send it back' }, { id: 'stop', label: 'Stop' }] };

test('a joiner\'s answer goes by the ask and options it was routed with, whatever its record says now', async () => {
  const w = twoAlike();
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  const joiner = w.cards()[1];
  w.questions[joiner.id].question.data = { ...joiner, engine: { ...joiner.engine, ask: 'forged', options: { 'keep it small': 'forged', 'Do the whole page': 'forged' } } };
  w.answer('a', 'Do the whole page', { shown: ['b'] });
  await w.tick(4);
  assert.deepEqual(w.answers().map((c) => c.action.answer).find((x) => x.ask !== 'qa'), { ask: 'qb', choice: 'y' });
});

test('a bundled answer the engine took, with its reply lost, still carries its piece on', async () => {
  const w = wayBack({ recordings: { a: [asks('qa', BLOCKED), quiet()], b: [asks('qb', BLOCKED), quiet()] } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  const act = w.engine.act.bind(w.engine);
  let lost = false;
  w.engine.act = async (runId, action) => {
    const got = await act(runId, action);
    if (action.answer?.ask !== 'qa' || lost) return got;
    lost = true;
    return { ok: false, unreachable: true };
  };
  w.answer('a', 'Send it back', { shown: ['b'] });
  await w.tick(8);
  assert.equal(w.runsOf('a').length, 2, 'it starts again, as it does alone');
  assert.equal(w.runsOf('b').length, 2);
});

test('Stop on a bundle whose lead has ended still ends its reservation', async () => {
  const w = wayBack({ recordings: { a: asks('qa', BLOCKED), b: asks('qb', BLOCKED) } });
  w.put('a', { files: ['x.js'], place: 0 });
  w.put('b', { place: 1 });
  await w.tick(3);
  assert.deepEqual(w.dispatcher.reserved().a, ['x.js']);
  w.endRun('a');
  w.answer('a', 'Stop', { shown: ['b'] });
  await w.tick(3);
  assert.equal(w.dispatcher.reserved().a, undefined);
});

test('asks with no words of their own never bundle, whatever their options', async () => {
  const w = wayBack({ recordings: { a: asks('qa'), b: asks('qb') } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  assert.deepEqual(w.cards().map((q) => q.joins), [undefined, undefined]);
});

test('a feature joined to a card whose run was cancelled still gets its stall card', async () => {
  const slices = (title) => ({ text: `# ${title}\n\n\`\`\`wheelhouse-slices\n${JSON.stringify({ goal: title, flag: { name: title }, demo: 'end', slices: [{ title: 'One', goal: 'One', done: [{ test: 'one' }] }, { title: 'Two', goal: 'Two', done: [{ test: 'two' }] }] })}\n\`\`\`\n` });
  const same = { reason: 'Which page?' };
  const w = wayBack({ recordings: { a: asks('qa', same), f: asks('qf', same) }, designOf: slices });
  w.put('a', { place: 0 });
  w.put('f', { lane: 'feature', place: 1 });
  await w.tick(3);
  assert.equal(w.cards().at(-1).joins, w.cards()[0].id);
  w.endRun('f');
  await w.tick(2);
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.ok([...w.dispatcher.waitingWork()].includes('f'), 'its stall card asks what next');
});

test('a joiner left open goes by its own card once its lead is answered', async () => {
  const w = wayBack({ recordings: { a: asks('qa', { reason: 'Which page?' }), b: asks('qb', { reason: 'Which page?' }) } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  const joiner = w.cards()[1];
  assert.deepEqual(w.runner.openCards().map((c) => c.id), [w.cards()[0].id, w.cards()[0].id]);
  w.answer('a', 'Keep it small');
  w.views();
  assert.deepEqual(w.runner.openCards().map((c) => c.id), [joiner.id]);
});

test('a Give it more with no place yet stays to be carried out', async () => {
  let place = 0;
  const started = [];
  const t = setUp({ recordings: { one: forever() }, gate: {
    admittedTo: () => true,
    startAdmitted: async (args) => {
      place += 1;
      if (place === 1) return { ok: false, refused: 'it has no place yet', noPlace: true };
      started.push(args);
      return { ok: true, runId: 'next' };
    },
  } });
  try {
    const { runId } = await t.ask();
    await t.runner.capped({ runId, work: 'sale-banner', lane: 'quick', branch: 'wh/x', reached: { cap: 'minutes', limit: 1 } });
    t.engine.act(runId, { cancel: { reason: 'cap' } });
    const q = t.writes.filter((w) => w.kind === 'question').at(-1).data;
    t.views.questions[q.id] = { question: { data: q }, answer: { label: 'Give it more', at: t.world.now.toISOString() } };
    await t.runner.tick();
    assert.equal(started.length, 0);
    await t.runner.tick();
    assert.equal(started.length, 1, 'tried again on the next tick');
    await t.runner.tick();
    assert.equal(started.length, 1, 'and once');
  } finally {
    t.cleanup();
  }
});

// Part 3a: a piece asking what it has already asked (delegated decisions design, section 7.4).
const AT_HEAD = 'a'.repeat(40);
const CLEAR = { headOf: async () => AT_HEAD, commitsSince: async () => 0, exclusionsOf: async () => [] };
const OPTS = [{ id: 'a', label: 'Keep it small' }, { id: 'b', label: 'Do the whole page' }];
const WHERE = { branch: 'wh/a', folder: '/tmp/a' };
const repeat = (id, over = {}) => asks(id, { reason: 'Which page?', context: WHERE, ...over });
const again = (first, second = first) => [...repeat('q1', first).slice(0, 3), ...repeat('q2', second).slice(1)];

test('a question records its key and the head it was asked at', async () => {
  const w = wayBack({ recordings: { a: repeat('q1') }, reads: CLEAR });
  w.put('a');
  await w.tick();
  assert.equal(w.cards()[0].key, decisionKey('a', 'which page'));
  assert.equal(w.cards()[0].head, AT_HEAD);
});

test('an ask with no words of its own, the merge queue\'s or trouble has no key', async () => {
  const w = wayBack({ recordings: { a: asks('q1', { context: WHERE }), b: asks('q2', { kind: 'trouble', reason: 'Which page?' }) }, reads: CLEAR });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  assert.deepEqual(w.cards().map((q) => q.key), [undefined, undefined]);
});

test('a repeat with nothing changed takes the earlier answer, and the note says which', async () => {
  const w = wayBack({ recordings: { a: again() }, reads: CLEAR });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.deepEqual(w.answers().map((c) => c.action.answer), [{ ask: 'q1', choice: 'a' }, { ask: 'q2', choice: 'a' }]);
  assert.equal(w.cards().length, 1);
  assert.ok(w.notes().includes('The build asked again about a, and was given your earlier answer: Keep it small.'));
});

test('commits since the answer give a card with that answer first, and nothing goes back', async () => {
  const seen = [];
  const w = wayBack({ recordings: { a: again() }, reads: { ...CLEAR, commitsSince: async (place, head) => { seen.push([place, head]); return 2; } } });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask), ['q1']);
  assert.equal(w.cards()[1].saidBefore, 'Keep it small');
  assert.deepEqual(seen, [[WHERE, AT_HEAD]]);
});

test('commits that can\'t be read, or a read that never ends, give a card', async () => {
  const w = wayBack({ recordings: { a: again() }, reads: { ...CLEAR, commitsSince: async () => { throw new Error('no such branch'); } } });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.equal(w.cards().length, 2);
  assert.equal(w.cards()[1].saidBefore, 'Keep it small');
});

test('an exclusion hit gives a card', async () => {
  const w = wayBack({ recordings: { a: again() }, reads: { ...CLEAR, exclusionsOf: async () => ['data-model'] } });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.equal(w.cards().length, 2);
});

test('an earlier answer with no head recorded gives a card', async () => {
  const w = wayBack({ recordings: { a: again() }, reads: { ...CLEAR, headOf: async () => null } });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.equal(w.cards().length, 2);
  assert.equal(w.cards()[0].head, undefined);
});

test('the same words with other options is a card that says what was said', async () => {
  const w = wayBack({ recordings: { a: again({}, { options: [{ id: 'a', label: 'Keep it small' }, { id: 'c', label: 'A new page' }], recommend: 'c' }) }, reads: CLEAR });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.equal(w.cards()[1].saidBefore, 'Keep it small');
  assert.equal(w.answers().length, 1);
});

test('a level 4 repeat is asked plainly, and nothing moves it', async () => {
  const w = wayBack({ recordings: { a: again({ level: 4 }) }, reads: CLEAR });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(4);
  assert.equal(w.answers().length, 1);
  assert.equal(w.cards()[1].saidBefore, undefined);
});

test('a stale answer asks plainly: the director has spoken on the piece since', async () => {
  const w = wayBack({ recordings: { a: [...repeat('q1').slice(0, 3), ...repeat('q9', { reason: 'Which colour?' }).slice(1, 3), ...repeat('q2').slice(1)] }, reads: CLEAR });
  w.put('a');
  await w.tick();
  w.answer('a', 'Keep it small');
  await w.tick(3);
  w.answer('a', 'Do the whole page');
  await w.tick(4);
  assert.equal(w.cards().length, 3);
  assert.equal(w.cards()[2].saidBefore, undefined);
});

test('an answer the build never got is not an answer to reuse', async () => {
  const w = wayBack({ recordings: { a: forever(), b: repeat('q1') }, reads: CLEAR });
  w.put('b');
  await w.tick();
  w.stop = true;
  w.answer('b', 'Keep it small');
  await w.tick();
  w.stop = false;
  await w.tick(2);
  assert.equal(w.answers().length, 0);
  assert.equal(w.cards().length, 2, 'it comes back as a card');
  assert.equal(w.cards()[1].saidBefore, undefined);
});

test('a repeat under All stop waits, and is answered once it lifts', async () => {
  const t = setUp({ recordings: { one: repeat('q1'), two: repeat('q2') }, gate: CLEAR });
  try {
    const first = await t.ask('one');
    t.sign('Keep it small');
    await t.runner.tick();
    t.world.stop = true;
    const second = await t.ask('two');
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.runId === second.runId).length, 0);
    assert.notEqual(first.runId, second.runId);
    t.world.stop = false;
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).filter((c) => c.runId === second.runId).map((c) => c.action.answer), [{ ask: 'q2', choice: 'a' }]);
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1);
  } finally { t.cleanup(); }
});

const BLOCKS = { kind: 'blocked', recommend: 'pick', options: [{ id: 'stop', label: 'Stop here' }, { id: 'rework', label: 'Send it back' }, { id: 'pick', label: 'Use the first' }] };

test('a blocked ask answered from before starts its rework, and the piece doesn\'t strand', async () => {
  const w = wayBack({ recordings: { a: again(BLOCKS) }, reads: CLEAR });
  w.put('a');
  await w.tick();
  w.answer('a', 'Use the first');
  await w.tick(8);
  assert.deepEqual(w.answers().map((c) => c.action.answer), [{ ask: 'q1', choice: 'pick' }, { ask: 'q2', choice: 'pick' }]);
  assert.equal(w.runsOf('a').length, 2, 'the piece starts again after the reused answer');
});

test('an answer is reused once: a piece that asks a third time gets a card, so it can\'t go round for ever', async () => {
  const t = setUp({ recordings: { one: repeat('q1', BLOCKS), two: repeat('q2', BLOCKS), three: repeat('q3', BLOCKS) }, gate: CLEAR });
  t.runner.onEnter(() => {});
  try {
    await t.ask('one');
    t.sign('Use the first');
    await t.runner.tick();
    await t.ask('two');
    await t.ask('three');
    assert.deepEqual(acts(t.engine).map((c) => c.action.answer.ask), ['q1', 'q2']);
    const cards = t.writes.filter((w) => w.kind === 'question').map((w) => w.data);
    assert.equal(cards.length, 2);
    assert.equal(cards[1].saidBefore, 'Use the first');
  } finally { t.cleanup(); }
});

test('Stop is never taken from before', async () => {
  const w = wayBack({ recordings: { a: again(BLOCKS) }, reads: CLEAR });
  w.put('a');
  await w.tick();
  w.answer('a', 'Stop here');
  await w.tick(4);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask), ['q1']);
  assert.equal(w.cards().length, 2);
});

test('an engine that refuses the earlier answer leaves a card, with no rework', async () => {
  const w = wayBack({ recordings: { a: again(BLOCKS) }, reads: CLEAR });
  w.put('a');
  await w.tick();
  w.answer('a', 'Use the first');
  await w.tick();
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => (action.answer?.ask === 'q2' ? { ok: false, refused: 'moved on' } : act(runId, action));
  await w.tick(4);
  assert.equal(w.cards().length, 2);
  assert.equal(w.cards()[1].saidBefore, 'Use the first');
  assert.equal(w.runsOf('a').length, 1);
});

// The views as the helper builds them once the first card is on the record.
const open = (t) => {
  const q = t.writes.find((w) => w.kind === 'question').data;
  t.views.questions[q.id] = { question: { data: q }, answer: null };
};

test('an open key with the same options joins the card and raises no other', async () => {
  const t = setUp({ recordings: { one: asking('q1', { reason: 'Which page?' }), two: asking('q2', { reason: 'which  page' }) } });
  try {
    await t.ask('one');
    open(t);
    await t.ask('two');
    await t.runner.tick();
    const [lead, joiner] = t.writes.filter((w) => w.kind === 'question').map((w) => w.data);
    assert.equal(lead.joins, undefined);
    assert.equal(joiner.joins, lead.id);
    assert.equal(t.writes.filter((w) => w.kind === 'note' && w.data.about === 'cards-waiting' && w.data.ids.includes(joiner.id)).length, 0);
  } finally { t.cleanup(); }
});

test('an open key with other options stays a card of its own', async () => {
  const t = setUp({ recordings: { one: asking('q1', { reason: 'Which page?' }), two: asking('q2', { reason: 'Which page?', options: [{ id: 'c', label: 'Neither' }], recommend: 'c' }) } });
  try {
    await t.ask('one');
    open(t);
    await t.ask('two');
    await t.runner.tick();
    assert.deepEqual(t.writes.filter((w) => w.kind === 'question').map((w) => w.data.joins), [undefined, undefined]);
  } finally { t.cleanup(); }
});

test('a lost reply keeps the earlier answer going, with no card, and the piece still starts again', async () => {
  const t = setUp({ recordings: { one: repeat('q1', BLOCKS), two: repeat('q2', BLOCKS) }, gate: CLEAR });
  const entered = [];
  t.runner.onEnter((args) => entered.push(args));
  try {
    await t.ask('one');
    t.sign('Use the first');
    await t.runner.tick();
    const act = t.engine.act.bind(t.engine);
    let lost = 0;
    t.engine.act = (runId, action) => {
      if (action.answer?.ask !== 'q2') return act(runId, action);
      lost += 1;
      if (lost === 1) { act(runId, action); throw new Error('timed out'); }
      return { ok: false, refused: 'already answered' };
    };
    const second = await t.ask('two');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, 'no card for an answer that may have landed');
    await t.runner.tick();
    assert.equal(lost, 2, 'tried again on the tick');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1);
    assert.ok(t.writes.some((w) => w.kind === 'note' && /your earlier answer: Use the first/.test(w.data.words)));
    ended(t, second.runId);
    await t.runner.tick();
    assert.equal(entered.filter((e) => e.via === 'rework' && e.key === `rework:${second.runId}`).length, 1);
  } finally { t.cleanup(); }
});

test('an earlier answer is not sent again under All stop', async () => {
  const t = setUp({ recordings: { one: repeat('q1'), two: repeat('q2') }, gate: CLEAR });
  try {
    await t.ask('one');
    t.sign('Keep it small');
    await t.runner.tick();
    const act = t.engine.act.bind(t.engine);
    t.engine.act = (runId, action) => { if (action.answer?.ask === 'q2') throw new Error('timed out'); return act(runId, action); };
    await t.ask('two');
    const before = t.engine.calls.length;
    t.world.stop = true;
    await t.runner.tick();
    assert.equal(t.engine.calls.filter((c, n) => n >= before && c.call === 'act').length, 0);
  } finally { t.cleanup(); }
});

test('a restart while the branch is read routes the ask again, so it is never lost', async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-repeat-'));
  const file = path.join(dir, 'router.json');
  const engine = fakeEngine({ recordings: { one: repeat('q1'), two: repeat('q2') } });
  const writes = [];
  const views = { levels: {}, questions: {}, approvals: {} };
  const build = (reads) => engineRunner({ engine, file, readViews: () => views, write: async (kind, data) => { writes.push({ kind, data }); }, workOf: () => ({ work: 'sale-banner', lane: 'quick' }), now: () => new Date('2026-10-29T13:00:00.000Z'), ...reads });
  try {
    const first = build(CLEAR);
    engine.start({ recording: 'one' });
    await first.onAsk(engine.watch('0').events.find((e) => e.type === 'ask' && e.id === 'q1'));
    const q = writes.find((w) => w.kind === 'question').data;
    views.questions[q.id] = { question: { data: q }, answer: { label: 'Keep it small', at: '2026-10-29T13:00:00.000Z' } };
    await first.tick();
    const gone = build({ ...CLEAR, commitsSince: () => slow });
    engine.start({ recording: 'two' });
    const reading = gone.onAsk(engine.watch('0').events.find((e) => e.type === 'ask' && e.id === 'q2'));
    await new Promise((resolve) => setImmediate(resolve));
    const again = build(CLEAR);
    await again.tick();
    assert.deepEqual(engine.calls.filter((c) => c.call === 'act').map((c) => c.action.answer.ask), ['q1', 'q2']);
    release(0);
    await reading;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a card saying You said this before is never drawn blind', async () => {
  const settings = { blindCards: false };
  const t = setUp({ recordings: { one: repeat('q1'), two: repeat('q2') }, gate: CLEAR, blindRoll: () => 0, settings });
  try {
    await t.ask('one');
    t.sign('Keep it small');
    await t.runner.tick();
    t.views.incidents = { open: [{ id: 'i1', kind: 'red-main' }] };
    settings.blindCards = true;
    await t.ask('two');
    const last = t.writes.filter((w) => w.kind === 'question').at(-1).data;
    assert.equal(last.saidBefore, 'Keep it small');
    assert.equal(last.blind, undefined);
  } finally { t.cleanup(); }
});

test('an open incident gives a card, whose answer waits as any answer does', async () => {
  const t = setUp({ recordings: { one: repeat('q1'), two: repeat('q2') }, gate: CLEAR });
  try {
    await t.ask('one');
    t.sign('Keep it small');
    await t.runner.tick();
    t.views.incidents = { open: [{ id: 'i1', kind: 'red-main' }] };
    await t.ask('two');
    assert.equal(acts(t.engine).filter((c) => c.action.answer.ask === 'q2').length, 0);
    assert.equal(t.writes.filter((w) => w.kind === 'question').at(-1).data.saidBefore, 'Keep it small');
  } finally { t.cleanup(); }
});

test('a piece waiting for a place gives a card: nothing wakes it past its pace', async () => {
  const t = setUp({ recordings: { one: repeat('q1'), two: repeat('q2') }, gate: { ...CLEAR, comingBack: () => true } });
  try {
    await t.ask('one');
    t.sign('Keep it small');
    await t.runner.tick();
    await t.ask('two');
    assert.equal(acts(t.engine).filter((c) => c.action.answer.ask === 'q2').length, 0);
    assert.equal(t.writes.filter((w) => w.kind === 'question').at(-1).data.saidBefore, 'Keep it small');
  } finally { t.cleanup(); }
});

test('a click made while the branch is read is seen', async () => {
  const views = [];
  const t = setUp({ recordings: { one: repeat('q1'), two: repeat('q2') }, gate: { ...CLEAR, commitsSince: async () => { views[0]?.(); return 0; } } });
  try {
    await t.ask('one');
    t.sign('Keep it small');
    await t.runner.tick();
    views[0] = () => { t.views.questions[Object.keys(t.views.questions)[0]].answer.changed = true; };
    await t.ask('two');
    assert.equal(acts(t.engine).filter((c) => c.action.answer.ask === 'q2').length, 0);
  } finally { t.cleanup(); }
});

test('Stop is never taken from before, whatever the case of its label', async () => {
  const t = setUp({ recordings: { one: repeat('q1', BLOCKS), two: repeat('q2', { ...BLOCKS, options: [{ id: 'stop', label: 'stop HERE' }, { id: 'rework', label: 'Send it back' }, { id: 'pick', label: 'Use the first' }] }) }, gate: CLEAR });
  t.runner.onEnter(() => {});
  try {
    await t.ask('one');
    t.sign('Stop here');
    await t.runner.tick();
    await t.ask('two');
    assert.equal(acts(t.engine).filter((c) => c.action.answer.ask === 'q2').length, 0);
  } finally { t.cleanup(); }
});

// A close match: the card is on the record, so all that changes is who stands behind whom.
function matchRunner({ views, questions = {}, held = [], write = async () => {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-match-'));
  const file = path.join(dir, 'router.json');
  fs.writeFileSync(file, JSON.stringify({ questions, held }));
  const writes = [];
  const runner = engineRunner({ file, readViews: () => views, write: async (kind, data) => { writes.push({ kind, data }); await write(kind, data); } });
  return { runner, writes, state: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}
const closeViews = (answer = null) => {
  const q = (id, what) => ({ question: { data: { id, work: 'w', what, why: 'y', options: [{ label: 'A' }, { label: 'B' }], recommendation: 'A', level: 3, key: `k${id}`, engine: { runId: 'r', ask: id, options: { A: 'a', B: 'b' } } } }, answer: null });
  return { questions: { 'q-w-1': { ...q('q-w-1', 'One way?'), answer }, 'q-w-2': q('q-w-2', 'Another way?') } };
};
const OPEN = { 'q-w-1': { work: 'w', runId: 'r', ask: { id: 'q-w-1' } }, 'q-w-2': { work: 'w', runId: 'r2', ask: { id: 'q-w-2' } } };

test('a close match records its join, lets a held card go, and sends the engine nothing', async () => {
  const t = matchRunner({ views: closeViews(), questions: OPEN, held: [{ id: 'q-w-2' }] });
  await t.runner.onMatch({ card: 'q-w-2', sameAs: 'q-w-1' });
  assert.deepEqual(t.writes, [{ kind: 'match', data: { card: 'q-w-2', work: 'w', joins: 'q-w-1' } }]);
  assert.equal(t.state().questions['q-w-2'].joins, 'q-w-1');
  assert.deepEqual(t.state().questions['q-w-2'].options, { A: 'a', B: 'b' });
  assert.deepEqual(t.state().held, []);
  assert.equal(t.state().delivered?.['q-w-2'], undefined);
});

test('a close match on an answered card records the line alone, and a failed write is the seals\' to try again', async () => {
  const answered = matchRunner({ views: closeViews({ label: 'B', at: 't' }), questions: OPEN });
  await answered.runner.onMatch({ card: 'q-w-2', sameAs: 'q-w-1' });
  assert.deepEqual(answered.writes, [{ kind: 'match', data: { card: 'q-w-2', work: 'w', saidBefore: 'B', from: 'q-w-1' } }]);
  assert.equal(answered.state().questions['q-w-2'].joins, undefined);
  const refused = matchRunner({ views: closeViews(), questions: OPEN, write: async () => { throw new Error('no'); } });
  await assert.rejects(refused.runner.onMatch({ card: 'q-w-2', sameAs: 'q-w-1' }));
  assert.equal(refused.state().questions['q-w-2'].joins, undefined);
  const unknown = matchRunner({ views: closeViews(), questions: {} });
  await unknown.runner.onMatch({ card: 'q-w-2', sameAs: 'q-w-1' });
  assert.deepEqual(unknown.writes, [], 'a card the router never kept stands');
});

test('a question drawn blind says so, at most one a day; a joiner and a turned-off setting draw none', async () => {
  const drawn = (t) => t.writes.filter((w) => w.kind === 'question').map((w) => w.data.blind);
  const never = setUp();
  try {
    await never.ask();
    assert.deepEqual(drawn(never), [undefined], 'by default nothing is drawn');
  } finally { never.cleanup(); }
  const t = setUp({ blindRoll: () => 0, recordings: { one: asking('q1'), two: asking('q2') } });
  try {
    await t.ask('one');
    await t.ask('two');
    assert.equal(drawn(t)[0], true);
    assert.equal(drawn(t).filter(Boolean).length, 1, 'one a day');
  } finally { t.cleanup(); }
  const off = setUp({ blindRoll: () => 0, settings: { blindCards: false } });
  try {
    await off.ask();
    assert.deepEqual(drawn(off), [undefined]);
  } finally { off.cleanup(); }
});

test('a Stop the engine refuses keeps the piece\'s files', async () => {
  const released = [];
  const t = setUp({ recordings: { one: blockedAsk('q1') }, release: (work) => released.push(work) });
  try {
    await t.ask();
    t.engine.act = () => ({ ok: false, refused: 'moved on' });
    t.sign('Stop this work');
    await t.runner.tick();
    assert.deepEqual(released, []);
  } finally { t.cleanup(); }
});

test('an answer refused after an unreachable try isn\'t taken from before', async () => {
  const t = setUp({ recordings: { one: repeat('q1'), two: repeat('q2') }, gate: CLEAR });
  try {
    await t.ask('one');
    const act = t.engine.act.bind(t.engine);
    let tries = 0;
    t.engine.act = (runId, action) => {
      if (action.answer?.ask !== 'q1') return act(runId, action);
      tries += 1;
      if (tries === 1) throw new Error('no answer from the engine');
      return { ok: false, refused: 'moved on' };
    };
    t.sign('Keep it small');
    await t.runner.tick();
    await t.runner.tick();
    assert.equal(tries, 2);
    await t.ask('two');
    assert.equal(acts(t.engine).filter((a) => a.action.answer?.ask === 'q2').length, 0, 'it may never have reached the build');
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 2);
  } finally { t.cleanup(); }
});

test('a reused blocked rework keeps the files the piece reserved at its first card', async () => {
  const w = wayBack({ recordings: { a: [again(BLOCKS), forever()], b: quiet() }, pace: 2, reads: CLEAR, branchPaths: async () => ['built.js'] });
  w.put('a', { place: 0 });
  await w.tick();
  w.answer('a', 'Use the first');
  w.put('b', { place: 1, files: ['built.js'] });
  for (let n = 0; n < 6; n += 1) {
    await w.tick();
    assert.equal(w.runsOf('b').length, 0, `tick ${n}`);
  }
  assert.equal(w.runsOf('a').length, 2);
});

test('a park at a new head takes the place of the card for the old head', async () => {
  const t = mergeSetUp(LEAVE);
  await t.ask('one');
  const first = cardsOf(t)[0];
  t.views.waiting = [{ id: 'card-old', at: t.world.now.toISOString(), data: first.data }];
  t.asked.head = 'd'.repeat(40);
  await t.ask('two');
  assert.equal(cardsOf(t).length, 2);
  assert.equal(cardsOf(t)[1].data.revises, 'card-old');
  assert.match(cardsOf(t)[1].data.parts?.changed ?? cardsOf(t)[1].data.changed, /head|commit/i);
  t.cleanup();
});

// --- Send it back (delegated decisions design, section 8.1) ---
const sendBack = (t, { head = ASKED_HEAD, at = t.world.now.toISOString(), id = `sb-${at}` } = {}) => {
  t.views.sendBacks = [...(t.views.sendBacks ?? []), { id, at, pr: 7, sha: head }];
};
const later = (t, ms = 1000) => { t.world.now = new Date(t.world.now.getTime() + ms); };
const pieceRan = (t, state = 'ended') => { t.views.runs = { 'card-81': [{ at: '2026-10-28T00:00:00.000Z', data: { runId: 'build-1', lane: 'quick', state, branch: 'wh/card-81' } }] }; };
function backSetUp(over = {}) {
  const left = [];
  const entered = [];
  const t = mergeSetUp({ ...LEAVE, takeBack: async () => ({ ok: true }), notReady: (pr) => left.push(pr), ...over });
  t.runner.onEnter((args) => entered.push(args));
  pieceRan(t);
  return { ...t, left, entered };
}
const said = (t, words) => t.writes.filter((w) => w.kind === 'note' && words.test(w.data.words));

test('Send it back ends the park, retires the card and asks for ordinary rework on the piece\'s own branch', async () => {
  const t = backSetUp();
  await t.ask();
  assert.deepEqual([...t.runner.waitingWork()], ['card-81']);
  later(t);
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), {}, 'it has left the parked set');
  assert.deepEqual([...t.runner.waitingWork()], [], 'and waits on nothing');
  assert.equal(t.entered.length, 1);
  const [entry] = t.entered;
  assert.deepEqual({ work: entry.work, lane: entry.lane, via: entry.via, branch: entry.branch, carryOn: entry.carryOn, raised: entry.raised }, { work: 'card-81', lane: 'quick', via: 'rework', branch: 'wh/card-81', carryOn: true, raised: false });
  assert.deepEqual(entry.carried, { raised: false, runs: ['build-1'] }, 'its spend still counts against it');
  assert.match(entry.answers.at(-1).question, /#7/);
  assert.match(entry.answers.at(-1).answer, /Send it back/);
  assert.deepEqual(t.left, [7], 'the queue no longer has it as ready');
  assert.equal(said(t, /#7/).length, 1);
  assert.equal(acts(t.engine).filter((a) => a.action.answer?.choice === 'go').length, 0, 'nothing merges');
  await t.runner.tick();
  assert.equal(t.entered.length, 1, 'once');
  t.cleanup();
});

test('a piece keeps its files until its rework has begun: it is named as reworking from the click', async () => {
  const t = backSetUp();
  pieceRan(t, 'paused');
  await t.ask();
  later(t);
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(t.runner.reworkWork(), ['card-81']);
  assert.equal(t.entered.length, 0, 'a run still going is left to end first');
  pieceRan(t, 'ended');
  await t.runner.tick();
  assert.equal(t.entered.length, 1);
  assert.deepEqual(t.runner.reworkWork(), []);
  t.cleanup();
});

test('under All stop a Send it back waits for the lift, and moves nothing', async () => {
  const t = backSetUp();
  await t.ask();
  later(t);
  t.world.stop = true;
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), { 7: ASKED_HEAD });
  assert.deepEqual([t.entered.length, t.left.length], [0, 0]);
  t.world.stop = false;
  await t.runner.tick();
  assert.equal(t.entered.length, 1);
  assert.deepEqual(t.runner.parkedHeads(), {});
  t.cleanup();
});

test('a helper started again acts on a Send it back once', async () => {
  const t = backSetUp();
  await t.ask();
  later(t);
  sendBack(t);
  const again = engineRunner({
    engine: t.engine, file: t.mergeFile, readViews: () => t.views, write: async (kind, data) => { t.writes.push({ kind, data }); }, stopped: () => false, now: () => t.world.now,
    openedOf: (pr) => (pr === 7 ? { lane: 'quick', work: 'card-81' } : null), takeBack: async () => ({ ok: true }), notReady: () => {},
  });
  const entered = [];
  again.onEnter((args) => entered.push(args));
  await again.tick();
  assert.equal(entered.length, 1);
  const third = engineRunner({
    engine: t.engine, file: t.mergeFile, readViews: () => t.views, write: async () => {}, stopped: () => false, now: () => t.world.now,
    openedOf: (pr) => (pr === 7 ? { lane: 'quick', work: 'card-81' } : null), takeBack: async () => ({ ok: true }), notReady: () => {},
  });
  third.onEnter((args) => entered.push(args));
  await third.tick();
  assert.equal(entered.length, 1, 'once, across restarts');
  t.cleanup();
});

test('a Send it back for an older head does nothing to the park at the new head, and says so once', async () => {
  const t = backSetUp();
  await t.ask();
  const newer = 'd'.repeat(40);
  t.asked.head = newer;
  later(t);
  await t.ask('two');
  later(t);
  sendBack(t, { head: ASKED_HEAD });
  await t.runner.tick();
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), { 7: newer });
  assert.equal(t.entered.length, 0);
  assert.equal(said(t, /moved on/).length, 1);
  t.cleanup();
});

test('a Send it back from before the park doesn\'t answer the card it raised', async () => {
  const t = backSetUp();
  const before = t.world.now.toISOString();
  later(t);
  await t.ask();
  sendBack(t, { at: before });
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), { 7: ASKED_HEAD });
  assert.equal(t.entered.length, 0);
  t.cleanup();
});

test('a Send it back after the approval went to the queue is not used, and says so', async () => {
  const t = backSetUp({ handBack: async () => ({ ok: true }) });
  await t.ask();
  later(t);
  sign(t);
  await t.runner.tick();
  later(t);
  sendBack(t);
  await t.runner.tick();
  assert.equal(t.entered.length, 0);
  assert.equal(said(t, /approval/).filter((w) => /wasn't used/.test(w.data.words)).length, 1);
  t.cleanup();
});

test('a Send it back and an approval together: nothing goes to the queue', async () => {
  const handed = [];
  const t = backSetUp({ handBack: async (args) => { handed.push(args); return { ok: true }; } });
  await t.ask();
  later(t);
  sign(t);
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(handed, []);
  assert.equal(t.entered.length, 1);
  t.cleanup();
});

test('a Send it back whose work has ended or pull request has closed leaves the record, and starts nothing', async () => {
  const t = backSetUp({ takeBack: async () => ({ ok: false, gone: true }) });
  await t.ask();
  later(t);
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), {});
  assert.deepEqual([...t.runner.waitingWork()], []);
  assert.deepEqual([t.entered.length, t.left.length], [0, 0]);
  assert.equal(said(t, /wasn't used/).length, 1);
  t.cleanup();
});

test('a Send it back the host can\'t answer for is tried again on the next tick', async () => {
  const answers = [{ ok: false }, { ok: true }];
  const t = backSetUp({ takeBack: async () => answers.shift() });
  await t.ask();
  later(t);
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), { 7: ASKED_HEAD });
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), {});
  assert.equal(t.entered.length, 1);
  t.cleanup();
});

test('a pull request no piece of Wheelhouse\'s opened has nothing to go back to, and says so', async () => {
  const t = backSetUp();
  await t.ask();
  later(t);
  t.views.runs = {};
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(t.runner.parkedHeads(), {});
  assert.equal(t.entered.length, 0);
  assert.equal(said(t, /close it|nothing to go back/).length, 1);
  t.cleanup();
});

test('on a project in git alone a Send it back goes by the change marked ready, with no park', async () => {
  const change = { work: 'card-81', head: ASKED_HEAD, runId: 'build-1' };
  const t = backSetUp({ localChange: (pr) => (pr === 7 ? change : null) });
  later(t);
  sendBack(t);
  await t.runner.tick();
  assert.equal(t.entered.length, 1);
  assert.equal(t.entered[0].work, 'card-81');
  assert.deepEqual(t.left, [7]);
  t.cleanup();
});

test('in git alone a Send it back for a head no longer the one marked ready isn\'t used', async () => {
  const t = backSetUp({ localChange: () => ({ work: 'card-81', head: 'd'.repeat(40), runId: 'build-2' }) });
  later(t);
  sendBack(t);
  await t.runner.tick();
  assert.equal(t.entered.length, 0);
  assert.equal(said(t, /wasn't used/).length, 1);
  t.cleanup();
});

test('the card a park raises offers Send it back and says what each option does', async () => {
  const t = mergeSetUp(LEAVE);
  await t.ask();
  const [card] = cardsOf(t).map((c) => c.data);
  assert.deepEqual(card.options, ['Approve', 'Send it back', 'Suggest a change…', 'Show me']);
  assert.match(card.descriptions[0], /merge queue/);
  assert.match(card.descriptions[1], /reworked/);
  assert.match(card.descriptions[1], /nothing of it is added/i);
  t.cleanup();
});

test('a Send it back the host can\'t answer for yet keeps an approval beside it from going to the queue', async () => {
  const handed = [];
  const t = backSetUp({ takeBack: async () => ({ ok: false }), handBack: async (args) => { handed.push(args); return { ok: true }; } });
  await t.ask();
  later(t);
  sign(t);
  sendBack(t);
  await t.runner.tick();
  assert.deepEqual(handed, []);
  t.cleanup();
});

test('a run asleep six hours passes no cap', async () => {
  const t = setUp({ recordings: { small: spending(1000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } } });
  try {
    const { runId } = t.engine.start({ recording: 'small', running: true });
    withRun(t, runId, [['2026-10-29T06:50:00.000Z', 'started']]);
    t.views.slept = [{ from: '2026-10-29T07:00:00.000Z', to: '2026-10-29T12:55:00.000Z' }];
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0, 'fifteen minutes awake: under the cap');
    t.views.slept = [];
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1, 'the same run with no sleep on the record is over it');
  } finally { t.cleanup(); }
});

test('a sleep in the middle of a tick cancels nothing', async () => {
  const t = setUp({ recordings: { small: spending(1000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } } });
  try {
    const { runId } = t.engine.start({ recording: 'small', running: true });
    withRun(t, runId, [['2026-10-29T12:55:00.000Z', 'started']]);
    // The tick has read the record and is waiting on the engine when the computer sleeps; the span isn't written yet.
    const inspect = t.engine.inspect.bind(t.engine);
    t.engine.inspect = async (id) => { t.world.now = new Date('2026-10-29T19:00:00.000Z'); return inspect(id); };
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0);
  } finally { t.cleanup(); }
});

test('a run that slept leaves its cost record awake, so a carry-on is not charged for the night', async () => {
  const t = setUp({ recordings: { long: [ev({ type: 'step-finished', step: 'implement', role: 'implement', minutes: 370, spend: { tokens: 1000, dollars: 0.3, source: 'reported' } }), ev({ type: 'run-ended', outcome: 'failed' })] } });
  try {
    const { runId } = t.engine.start({ recording: 'long' });
    withRun(t, runId, [['2026-10-29T06:50:00.000Z', 'started'], ['2026-10-29T13:00:00.000Z', 'ended']]);
    t.views.slept = [{ from: '2026-10-29T07:00:00.000Z', to: '2026-10-29T12:50:00.000Z' }];
    await t.runner.tick();
    const cost = t.writes.find((w) => w.kind === 'cost');
    assert.equal(cost.data.minutes, 20);
  } finally { t.cleanup(); }
});

test('a look at the caps first asks for a sleep the tick fell into', async () => {
  const t = setUp({ recordings: { small: spending(1000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, gate: { noteSleep: async () => { t.views.slept = [{ from: '2026-10-29T07:00:00.000Z', to: '2026-10-29T12:55:00.000Z' }]; return true; } } });
  try {
    const { runId } = t.engine.start({ recording: 'small', running: true });
    withRun(t, runId, [['2026-10-29T06:50:00.000Z', 'started']]);
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0);
  } finally { t.cleanup(); }
});

test('a sleep that could not be written holds the caps and the cost until it is', async () => {
  let written = false;
  const t = setUp({ recordings: { small: spending(1000) }, settings: { capMinutes: { quick: 20 }, capTokens: { quick: 1000000 } }, gate: { noteSleep: async () => written } });
  try {
    const { runId } = t.engine.start({ recording: 'small', running: true });
    withRun(t, runId, [['2026-10-29T06:50:00.000Z', 'started']]);
    await t.runner.tick();
    assert.equal(acts(t.engine).length, 0);
    written = true;
    await t.runner.tick();
    assert.equal(acts(t.engine).filter((c) => c.action.cancel).length, 1, 'with no sleep on the record, the cap reads it as running');
  } finally { t.cleanup(); }
});

// A recording with two legs: it fails, and a resume plays on from there.
const legs = (...ends) => ends.flatMap((outcome, i) => [
  ev({ type: 'step-finished', step: `step-${i}`, role: 'implement', spend: { source: 'reported', tokens: 100, dollars: 0.1 }, minutes: 1 }),
  ev({ type: 'run-ended', outcome, ...(outcome === 'failed' ? { failure: 'connection' } : {}) }),
]);
const costs = (t) => t.writes.filter((w) => w.kind === 'cost');
// A failed run with a cap card waiting on it, its record in the views.
async function failedAtCap(t, recording = 'two') {
  const { runId } = t.engine.start({ recording });
  withRun(t, runId, [['2026-10-29T12:50:00.000Z', 'started'], ['2026-10-29T12:55:00.000Z', 'ended', { outcome: 'failed', failure: 'connection' }]]);
  await t.runner.capped({ runId, work: 'sale-banner', lane: 'quick', branch: 'wh/x', reached: { cap: 'tokens', used: 2, limit: 1 } });
  return { runId, card: t.runner.questionOf(runId) };
}
// Keeps the views' records as the runner writes them, as the record does.
function recordRuns(t) {
  const push = t.writes.push.bind(t.writes);
  t.writes.push = (entry) => {
    if (entry.kind === 'run') t.views.runs[entry.data.work].push({ at: t.world.now.toISOString(), data: entry.data });
    return push(entry);
  };
}
const giveMore = (t, card) => { t.views.questions[card] = { question: { data: { engine: { runId: t.views.runs['sale-banner'][0].data.runId, ask: `cap:x`, options: { 'Give it more': 'more', Stop: 'stop' } } } }, answer: { label: 'Give it more' } }; };

test('Give it more on a failed run goes through resumeRun, its cost not written while the card waits', async () => {
  const t = setUp({ recordings: { two: legs('failed', 'completed') } });
  try {
    const { runId, card } = await failedAtCap(t);
    recordRuns(t);
    await t.runner.tick();
    assert.deepEqual(costs(t), [], 'the card still waits');
    giveMore(t, card);
    await t.runner.tick();
    assert.deepEqual(acts(t.engine).map((c) => c.action), [{ resume: {} }]);
    const started = t.writes.filter((w) => w.kind === 'run').at(0).data;
    assert.equal(started.state, 'started');
    assert.equal(started.resume, 1);
    assert.equal(started.runId, runId);
  } finally { t.cleanup(); }
});

test('a resumed run is costed once, at its true end', async () => {
  const t = setUp({ recordings: { two: legs('failed', 'failed', 'completed') } });
  try {
    const { runId, card } = await failedAtCap(t);
    recordRuns(t);
    giveMore(t, card);
    await t.runner.tick();
    assert.deepEqual(costs(t), [], 'a run on its way again has no cost yet');
    t.views.runs['sale-banner'].push({ at: '2026-10-29T13:00:00.000Z', data: { work: 'sale-banner', lane: 'quick', engine: 'fake', runId, state: 'ended', resume: 1, outcome: 'completed' } });
    await t.runner.tick();
    await t.runner.tick();
    assert.equal(costs(t).length, 1);
    assert.equal(costs(t)[0].data.tokens, 200);
  } finally { t.cleanup(); }
});

test('a Stop on the cap card of a failed run settles it', async () => {
  const t = setUp({ recordings: { two: legs('failed') } });
  try {
    const { card } = await failedAtCap(t);
    await t.runner.tick();
    assert.deepEqual(costs(t), []);
    t.views.questions[card] = { question: { data: { engine: { ask: 'cap:x', options: { 'Give it more': 'more', Stop: 'stop' } } } }, answer: { label: 'Stop' } };
    await t.runner.tick();
    assert.equal(costs(t).length, 1);
  } finally { t.cleanup(); }
});

test('the minutes of a resumed run are its legs, not its last steps', async () => {
  const t = setUp({ recordings: { two: legs('failed', 'completed') } });
  try {
    const { runId } = t.engine.start({ recording: 'two' });
    withRun(t, runId, [
      ['2026-10-29T12:00:00.000Z', 'started'], ['2026-10-29T12:10:00.000Z', 'ended', { outcome: 'failed' }],
      ['2026-10-29T12:30:00.000Z', 'started', { resume: 1 }], ['2026-10-29T12:50:00.000Z', 'ended', { resume: 1, outcome: 'completed' }],
    ]);
    t.engine.act(runId, { resume: {} });
    await t.runner.tick();
    assert.equal(costs(t)[0].data.minutes, 30);
  } finally { t.cleanup(); }
});

test("a resumed slice's reviews are kept again", async () => {
  const kept = [];
  const t = setUp({ recordings: { two: legs('failed', 'completed') }, gate: { keepReviews: async (runId) => { kept.push(runId); return true; } } });
  try {
    const { runId, card } = await failedAtCap(t);
    recordRuns(t);
    await t.runner.tick();
    assert.deepEqual(kept, [], 'a failed run waiting on its card keeps none yet');
    t.views.runs['sale-banner'].at(-1).data = { ...t.views.runs['sale-banner'].at(-1).data, outcome: 'cancelled' };
    await t.runner.tick();
    assert.deepEqual(kept, [runId]);
    t.views.runs['sale-banner'].at(-1).data = { ...t.views.runs['sale-banner'].at(-1).data, outcome: 'failed' };
    giveMore(t, card);
    await t.runner.tick();
    t.views.runs['sale-banner'].push({ at: '2026-10-29T13:00:00.000Z', data: { work: 'sale-banner', lane: 'quick', engine: 'fake', runId, state: 'ended', resume: 1, outcome: 'completed' } });
    await t.runner.tick();
    assert.deepEqual(kept, [runId, runId]);
  } finally { t.cleanup(); }
});

test('a refused resume leaves the run ended, and it is costed once', async () => {
  const started = [];
  const t = setUp({ recordings: { two: legs('failed') }, gate: { startAdmitted: async (args) => { started.push(args); return { ok: true }; } } });
  try {
    const { runId, card } = await failedAtCap(t);
    recordRuns(t);
    giveMore(t, card);
    await t.runner.tick();
    const latest = t.views.runs['sale-banner'].at(-1).data;
    assert.equal(latest.state, 'ended');
    assert.equal(latest.resume, 1);
    assert.equal(latest.failure, 'resume-refused');
    assert.equal(started.length, 1, 'it carries on from its branch instead');
    assert.deepEqual(started[0].carried.runs, [runId]);
    await t.runner.tick();
    assert.equal(costs(t).length, 1);
  } finally { t.cleanup(); }
});

test('a crash after started is reconciled against the engine', async () => {
  const t = setUp({ recordings: { two: legs('failed') } });
  try {
    const { runId } = t.engine.start({ recording: 'two' });
    withRun(t, runId, [['2026-10-29T12:00:00.000Z', 'started'], ['2026-10-29T12:10:00.000Z', 'ended', { outcome: 'failed' }], ['2026-10-29T12:30:00.000Z', 'started', { resume: 1 }]]);
    await t.runner.tick();
    const ended = t.writes.find((w) => w.kind === 'run').data;
    assert.equal(ended.state, 'ended');
    assert.equal(ended.resume, 1);
    assert.equal(ended.outcome, 'failed');
    assert.equal(ended.failure, 'connection');
    assert.equal(ended.branch, 'wh/sale-banner');
  } finally { t.cleanup(); }
});

test('a run just resumed is left to the engine, which may not have moved yet', async () => {
  const t = setUp({ recordings: { two: legs('failed') } });
  try {
    const { runId } = t.engine.start({ recording: 'two' });
    withRun(t, runId, [['2026-10-29T12:00:00.000Z', 'started'], ['2026-10-29T12:10:00.000Z', 'ended', { outcome: 'failed' }], ['2026-10-29T12:59:30.000Z', 'started', { resume: 1 }]]);
    await t.runner.tick();
    assert.deepEqual(t.writes.filter((w) => w.kind === 'run'), []);
  } finally { t.cleanup(); }
});

test('a resumed run still going is not ended by the look', async () => {
  const t = setUp({ recordings: { two: [...legs('failed'), ev({ type: 'step-finished', step: 'more', role: 'implement', spend: { source: 'reported', tokens: 1, dollars: 0 } })] } });
  try {
    const { runId } = t.engine.start({ recording: 'two' });
    assert.equal(t.engine.act(runId, { resume: {} }).ok, true);
    withRun(t, runId, [['2026-10-29T12:00:00.000Z', 'started'], ['2026-10-29T12:10:00.000Z', 'ended', { outcome: 'failed' }], ['2026-10-29T12:30:00.000Z', 'started', { resume: 1 }]]);
    await t.runner.tick();
    assert.deepEqual(t.writes.filter((w) => w.kind === 'run'), []);
  } finally { t.cleanup(); }
});

test('a resumed run counts against its cap again', async () => {
  const t = setUp({ settings: { capMinutes: { quick: 30 } }, recordings: { two: [...legs('failed'), ev({ type: 'step-finished', step: 'more', role: 'implement', spend: { source: 'reported', tokens: 1, dollars: 0 } })] } });
  try {
    const { runId } = t.engine.start({ recording: 'two' });
    t.engine.act(runId, { resume: {} });
    withRun(t, runId, [['2026-10-29T12:00:00.000Z', 'started'], ['2026-10-29T12:20:00.000Z', 'ended', { outcome: 'failed' }], ['2026-10-29T12:40:00.000Z', 'started', { resume: 1 }]]);
    await t.runner.tick();
    assert.equal(t.writes.filter((w) => w.kind === 'question').length, 1, '20 minutes and 20 minutes pass a cap of 30');
    assert.ok(acts(t.engine).some((c) => c.action.cancel));
  } finally { t.cleanup(); }
});
