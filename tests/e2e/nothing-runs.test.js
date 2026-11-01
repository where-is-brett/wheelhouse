// tests/e2e/nothing-runs.test.js
// When nothing can run, the director is told (delegated decisions plan, invariant 6), on the fake engine: a start refused,
// a red main line with no test command, a merge queue that can't start, and work held for the plan's counted requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { wayBack, quiet, forever } from '../helpers/way-back.js';
import { redMainIncident } from '../../scripts/engine/fix-main.js';
import { TRY_AGAIN, STOP_HERE, LEAVE_IT, KEEP_OFF, ALLOW_SOME, FIX_FORWARD, LEAVE_RED, REFUSED_RETRY_MS, QUEUE_FAULT_MS } from '../../scripts/engine/dispatch-run.js';
import { REQUESTS_UNCONFIRMED_WORDS, startRefusedWords, startCardWords, QUEUE_PASSED_WORDS, cutOffStoppedWords, unmarkedPrWords } from '../../scripts/engine/words.js';

const MINUTE = 60 * 1000;
const ended = (over) => { const run = quiet(); run[1] = { ...run[1], ...over }; return run; };
const openCards = (w) => Object.values(w.questions).filter((q) => !q.answer).map((q) => q.question.data);
const labels = (card) => card.options.map((o) => o.label);
const lines = (w) => w.written.filter((x) => x.kind === 'note' && x.data.about === 'engine').map((x) => x.data.words);
const topNote = (w) => w.written.filter((x) => x.data.about === 'top-card').at(-1)?.data ?? null;
const slices = (title) => ({ text: `# ${title}\n\n\`\`\`wheelhouse-slices\n${JSON.stringify({ goal: title, flag: { name: title }, demo: 'end', slices: [{ title: 'One', goal: 'One', done: [{ test: 'one' }] }, { title: 'Two', goal: 'Two', done: [{ test: 'two' }] }] })}\n\`\`\`\n` });
const REFUSAL = 'the engine\'s copy of the project couldn\'t be brought up to date, so no run started';

// --- A start refused ---

test('new work refused stops going round: one line, a second try, then one card', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.refuse = () => REFUSAL;
  w.put('a');
  await w.tick(20);
  assert.equal(w.starts.length, 1, 'tried once, not once a tick');
  assert.deepEqual(lines(w), [startRefusedWords('a', REFUSAL)]);
  assert.equal(openCards(w).length, 0, 'a passing fault brings no card');
  await w.pass(REFUSED_RETRY_MS);
  assert.equal(w.starts.length, 2);
  assert.equal(openCards(w).length, 1);
  const card = w.cardOf('a');
  assert.equal(card.what, startCardWords('a', REFUSAL));
  assert.deepEqual(labels(card), [TRY_AGAIN, STOP_HERE]);
  await w.pass(60 * MINUTE);
  assert.equal(w.starts.length, 2, 'nothing more until the director says');
  assert.equal(w.cards().length, 1, 'one card, not one a tick');
});

test('a refusal cleared by the second try lets the work start, with no card', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.refuse = () => REFUSAL;
  w.put('a');
  await w.tick(2);
  w.refuse = null;
  await w.pass(REFUSED_RETRY_MS);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(w.cards().length, 0);
});

test('other work goes on beside a refused piece', async () => {
  const w = wayBack({ recordings: { a: quiet(), b: forever() }, pace: 1 });
  w.refuse = ({ order }) => (order.work === 'a' ? REFUSAL : null);
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(3);
  assert.deepEqual(w.runsOf('b').length, 1);
});

test('Try again starts refused work once the refusal has cleared, and asks again if it hasn\'t', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.refuse = () => REFUSAL;
  w.put('a');
  await w.tick(2);
  await w.pass(REFUSED_RETRY_MS);
  w.answer('a', TRY_AGAIN);
  await w.pass(REFUSED_RETRY_MS);
  await w.pass(REFUSED_RETRY_MS);
  assert.equal(w.cards().length, 2, 'still refused: one new card for the one click');
  w.refuse = null;
  w.answer('a', TRY_AGAIN);
  await w.tick(3);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(openCards(w).length, 0);
});

test('Stop here on work that never started says so, and keeps no files', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.refuse = () => REFUSAL;
  w.put('a', { files: ['one.js'] });
  await w.tick(2);
  await w.pass(REFUSED_RETRY_MS);
  assert.deepEqual(w.dispatcher.reserved(), {}, 'it has not begun, so it has no files to keep');
  assert.match(w.cardOf('a').options.find((o) => o.label === STOP_HERE).says, /nothing of it starts/i);
  w.answer('a', STOP_HERE);
  await w.tick(2);
  assert.equal(w.reports.a.data.outcome, 'closed');
  assert.ok(lines(w).includes(cutOffStoppedWords('a')));
});

test('a refused start survives a restart, with no card doubled', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.refuse = () => REFUSAL;
  w.put('a');
  await w.tick(2);
  w.restart();
  await w.tick(2);
  assert.equal(w.starts.length, 1);
  await w.pass(REFUSED_RETRY_MS);
  w.restart();
  await w.tick(3);
  assert.equal(w.starts.length, 2);
  assert.equal(w.cards().length, 1);
});

test('a feature whose design can\'t be read takes the same way, with its Logbook line once', async () => {
  let design = { problem: 'names no document' };
  const w = wayBack({ recordings: { f: quiet() }, pace: 1, designOf: () => design });
  w.put('f', { lane: 'feature' });
  await w.tick(5);
  assert.equal(w.starts.length, 0);
  assert.equal(lines(w).length, 1, 'the design\'s own line says it');
  await w.pass(REFUSED_RETRY_MS);
  assert.deepEqual(labels(w.cardOf('f')), [TRY_AGAIN, STOP_HERE]);
  await w.pass(30 * MINUTE);
  assert.equal(w.cards().length, 1);
  design = slices('f');
  w.answer('f', TRY_AGAIN);
  await w.tick(3);
  assert.equal(w.starts.length, 1);
});

// --- A red main line with no test command ---

function redNoTests(extra = {}) {
  const incident = redMainIncident({ id: 'x' });
  const w = wayBack({ recordings: { [incident.work]: forever(), a: quiet() }, pace: 2, ...extra });
  w.config = { routing: {}, testsNotCounting: true };
  w.green = false;
  w.incidents.open = [incident];
  w.put('a');
  return { w, incident };
}

test('a red main line with no test command is told to the director, once', async () => {
  const { w, incident } = redNoTests();
  await w.tick(12);
  assert.equal(w.starts.length, 0);
  const cards = openCards(w);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].work, incident.work);
  assert.match(cards[0].what, /tests/);
  assert.deepEqual(labels(cards[0]), [FIX_FORWARD, LEAVE_RED]);
});

test('with the test command added, the fix starts by itself', async () => {
  const { w, incident } = redNoTests();
  await w.tick(2);
  w.config = { routing: {}, testCommand: 'node --test' };
  await w.tick(2);
  assert.deepEqual(w.starts.map((s) => s.order.work), [incident.work]);
  assert.equal(w.starts.length, 1);
});

test('Fix it forward with still no test command brings a new card, once for the click', async () => {
  const { w, incident } = redNoTests();
  await w.tick(2);
  w.answer(incident.work, FIX_FORWARD);
  await w.tick(5);
  assert.equal(w.cards().length, 2);
  assert.equal(openCards(w).length, 1);
});

test('Leave it on that card starts nothing, even once the command is added', async () => {
  const { w, incident } = redNoTests();
  await w.tick(2);
  w.answer(incident.work, LEAVE_RED);
  w.config = { routing: {}, testCommand: 'node --test' };
  await w.tick(5);
  assert.equal(w.starts.length, 0);
  assert.equal(w.cards().length, 1);
});

// --- A merge queue that can't start ---

const queueOf = (fault) => ({
  queueFolder: async () => (fault.why ? { ok: false, refused: fault.why } : { ok: true, folder: 'qf' }),
  queuePlace: () => 'qf',
  repoOf: () => ({ host: 'h', path: 'o/r' }),
});

async function readyWorld({ pace = 2, recordings = {}, fault = { why: 'the host\'s branches couldn\'t be fetched' } } = {}) {
  const w = wayBack({ recordings: { merge: forever(), a: ended({ pr: 7 }), ...recordings }, pace, dispatchExtra: queueOf(fault) });
  const engineStart = w.engine.start.bind(w.engine);
  w.engine.start = (order) => engineStart(order.lane === 'merge' ? { ...order, recording: 'merge', work: 'merge' } : order);
  w.put('a');
  await w.tick(3);
  w.ready[7] = { head: 'abc', runId: w.runsOf('a')[0], work: 'a' };
  return { w, fault };
}
const mergeStarts = (w) => w.engine.calls.filter((c) => c.call === 'start' && c.order?.lane === 'merge').length;

test('a merge queue that stays unable to start reaches one card, and not before its time', async () => {
  const { w } = await readyWorld();
  await w.pass(QUEUE_FAULT_MS - 2 * MINUTE);
  assert.equal(openCards(w).length, 0, 'a passing fault gets its time');
  await w.pass(3 * MINUTE);
  const cards = openCards(w);
  assert.equal(cards.length, 1);
  assert.match(cards[0].what, /merge queue/);
  assert.match(cards[0].what, /fetched/);
  assert.deepEqual(labels(cards[0]), [TRY_AGAIN, LEAVE_IT]);
  await w.pass(60 * MINUTE);
  assert.equal(w.cards().length, 1, 'one card, not one a tick');
});

test('a fault that clears by itself brings no card', async () => {
  const { w, fault } = await readyWorld();
  await w.pass(5 * MINUTE);
  fault.why = null;
  await w.tick(2);
  await w.pass(QUEUE_FAULT_MS);
  assert.equal(mergeStarts(w), 1);
  assert.equal(w.cards().length, 0);
});

test('a laptop asleep past the time isn\'t a fault that lasted', async () => {
  const { w } = await readyWorld();
  await w.tick(2);
  w.clock.now = new Date(w.clock.now.getTime() + 8 * 60 * MINUTE);
  await w.tick(2);
  assert.equal(w.cards().length, 0);
});

test('a fault that clears with the card open says the card needs no answer', async () => {
  const { w, fault } = await readyWorld();
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  fault.why = null;
  await w.tick(2);
  assert.equal(mergeStarts(w), 1);
  assert.ok(lines(w).includes(QUEUE_PASSED_WORDS));
});

test('an engine that refuses the queue\'s start is the same fault', async () => {
  const { w } = await readyWorld({ fault: {} });
  const engineStart = w.engine.start;
  w.engine.start = (order) => (order.lane === 'merge' ? { ok: false, refused: 'the engine said no' } : engineStart(order));
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  assert.match(openCards(w)[0].what, /the engine said no/);
});

test('an engine that throws on the queue\'s start costs the tick nothing', async () => {
  const { w } = await readyWorld({ fault: {} });
  w.engine.start = () => { throw new Error('no reply'); };
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  assert.equal(openCards(w).length, 1);
});

test('an engine that can\'t say what is live is the same fault', async () => {
  const { w } = await readyWorld({ fault: {} });
  w.engine.queueRuns = () => null;
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  assert.equal(mergeStarts(w), 0);
  assert.equal(openCards(w).length, 1);
});

test('All stop holds the queue\'s card back, since nothing tries meanwhile', async () => {
  const { w } = await readyWorld();
  await w.tick(2);
  w.stop = true;
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  assert.equal(w.cards().length, 0);
});

test('ready pull requests don\'t count as going while the queue can\'t start', async () => {
  const { w } = await readyWorld();
  w.put('b', { place: 1 });
  w.work.b.work.data.dependsOn = ['a'];
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  assert.equal(topNote(w).id, openCards(w)[0].id, 'the queue\'s card rises as the top card');
  assert.equal(topNote(w).holdsUp, 1, 'and it names what it holds up');
});

test('Try again on the queue\'s card gives the fault its time again; Leave it asks no more', async () => {
  const { w } = await readyWorld();
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  w.answer('a', TRY_AGAIN);
  await w.pass(QUEUE_FAULT_MS - 2 * MINUTE);
  assert.equal(w.cards().length, 1);
  await w.pass(3 * MINUTE);
  assert.equal(w.cards().length, 2);
  w.answer('a', LEAVE_IT);
  await w.pass(60 * MINUTE);
  assert.equal(w.cards().length, 2);
});

// --- Work held for the plan's counted requests ---

function counted({ confirmed, cap = 0, recordings }) {
  const settings = { capRequests: cap };
  const w = wayBack({ recordings, pace: 2, settings });
  w.engine.countsRequests = () => true;
  w.engine.requestsConfirmed = confirmed;
  return { w, settings };
}

test('a later hold on requests brings a card of its own, in words that fit the cap', async () => {
  const { w, settings } = counted({ confirmed: true, recordings: { a: quiet(), b: quiet() } });
  w.put('a', { place: 0 });
  await w.tick(3);
  assert.deepEqual(labels(w.cardOf('a')), [KEEP_OFF, ALLOW_SOME]);
  w.answer('a', ALLOW_SOME);
  settings.capRequests = 5;
  await w.tick(3);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(openCards(w).length, 0);
  settings.capRequests = 0;
  w.put('b', { place: 1 });
  await w.tick(3);
  assert.equal(w.cards().length, 2);
  assert.equal(w.cardOf('b').work, 'b');
});

test('requests held at the cap after Allow some: a new card, and the words say the cap', async () => {
  let used = 0;
  const settings = { capRequests: 0 };
  const w = wayBack({ recordings: { a: quiet(), b: quiet() }, pace: 2, settings, dispatchExtra: { spentThisMonth: () => used } });
  w.engine.countsRequests = () => true;
  w.engine.requestsConfirmed = true;
  w.put('a', { place: 0 });
  await w.tick(3);
  w.answer('a', ALLOW_SOME);
  settings.capRequests = 5;
  await w.tick(3);
  used = 5;
  w.put('b', { place: 1 });
  await w.tick(5);
  assert.equal(w.cards().length, 2);
  const card = openCards(w)[0];
  assert.equal(card.work, 'b');
  assert.match(card.what, /5/);
});

test('Keep it off stays heard while the same hold goes on', async () => {
  const { w } = counted({ confirmed: true, recordings: { a: quiet(), b: quiet() } });
  w.put('a', { place: 0 });
  await w.tick(3);
  w.answer('a', KEEP_OFF);
  await w.tick(5);
  w.put('b', { place: 1 });
  await w.tick(5);
  assert.equal(w.cards().length, 1);
});

test('All stop ends no hold, so no second card follows it', async () => {
  const { w } = counted({ confirmed: true, recordings: { a: quiet() } });
  w.put('a');
  await w.tick(3);
  w.answer('a', KEEP_OFF);
  await w.tick(2);
  w.stop = true;
  await w.tick(2);
  w.stop = false;
  await w.tick(3);
  assert.equal(w.cards().length, 1);
});

test('with the count unconfirmed the card promises nothing a cap can do, and a cap brings no second card', async () => {
  const { w, settings } = counted({ confirmed: false, recordings: { a: quiet() } });
  w.put('a');
  await w.tick(3);
  const card = w.cardOf('a');
  assert.ok(!labels(card).includes(ALLOW_SOME));
  assert.deepEqual(labels(card), [KEEP_OFF, STOP_HERE]);
  assert.doesNotMatch(card.what, /until you allow/);
  settings.capRequests = 50;
  await w.tick(5);
  assert.equal(w.cards().length, 1);
  assert.equal(w.starts.length, 0);
});

test('the engine\'s own words go on the unconfirmed card', async () => {
  const { w } = counted({ confirmed: false, recordings: { a: quiet() } });
  w.engine.words = { requestsUnconfirmed: 'In the engine\'s own words.' };
  w.put('a');
  await w.tick(2);
  assert.equal(w.cardOf('a').what, 'In the engine\'s own words.');
});

test('Stop here with the count unconfirmed ends the work held', async () => {
  const { w } = counted({ confirmed: false, recordings: { a: quiet(), b: quiet() } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(3);
  w.answer('a', STOP_HERE);
  await w.tick(3);
  assert.equal(w.reports.a.data.outcome, 'closed');
  assert.equal(w.reports.b.data.outcome, 'closed');
  assert.equal(w.starts.length, 0);
  assert.equal(w.written.filter((x) => x.kind === 'report').length, 2);
});

test('the count confirmed later brings a card that can be acted on', async () => {
  const { w } = counted({ confirmed: false, recordings: { a: quiet() } });
  w.put('a');
  await w.tick(3);
  w.answer('a', KEEP_OFF);
  w.engine.requestsConfirmed = true;
  await w.tick(3);
  assert.equal(w.cards().length, 2);
  assert.deepEqual(labels(openCards(w)[0]), [KEEP_OFF, ALLOW_SOME]);
});

// --- A pull request nothing marked ready ---

test('a finished slice\'s pull request never marked ready gets a Logbook line, once, when other work waits for its place', async () => {
  const w = wayBack({ recordings: { f: ended({ pr: 7 }), b: quiet() }, pace: 1, designOf: slices });
  w.put('f', { lane: 'feature', place: 0 });
  w.put('b', { place: 1 });
  await w.tick(4);
  assert.equal(lines(w).length, 0, 'it may yet be marked');
  await w.pass(30 * MINUTE);
  assert.deepEqual(lines(w), [unmarkedPrWords('f', 7)]);
});

test('with nothing waiting for its place, a pull request not yet marked brings no line', async () => {
  const w = wayBack({ recordings: { f: ended({ pr: 7 }) }, pace: 1, designOf: slices });
  w.put('f', { lane: 'feature' });
  await w.pass(30 * MINUTE);
  assert.deepEqual(lines(w), []);
});

// --- What a first reading of the above left open ---

test('a refused piece on its card keeps no other work off its files', async () => {
  const w = wayBack({ recordings: { a: quiet(), b: forever() }, pace: 2 });
  w.refuse = ({ order }) => (order.work === 'a' ? REFUSAL : null);
  w.put('a', { place: 0, files: ['one.js'] });
  await w.tick(2);
  await w.pass(REFUSED_RETRY_MS);
  w.put('b', { place: 1, files: ['one.js'] });
  await w.tick(3);
  assert.equal(w.runsOf('b').length, 1);
});

test('a card from the version before, whatever its answer, doesn\'t stand for an unconfirmed count', async () => {
  for (const answer of [ALLOW_SOME, null]) {
    const { w } = counted({ confirmed: false, recordings: { a: quiet() } });
    w.put('a');
    fs.writeFileSync(path.join(w.dir, 'dispatch.json'), JSON.stringify({ requestsAsked: 'q-a-90000' }));
    w.questions['q-a-90000'] = { question: { data: { id: 'q-a-90000', work: 'a', what: 'old', options: [] } }, ...(answer ? { answer: { label: answer } } : {}) };
    w.restart();
    await w.tick(3);
    assert.equal(w.cards().length, 1, 'one new card');
    assert.equal(w.cards()[0].what, REQUESTS_UNCONFIRMED_WORDS);
  }
});

test('a cap changed under an open card brings a card with the true words', async () => {
  let used = 0;
  const settings = { capRequests: 0 };
  const w = wayBack({ recordings: { a: quiet() }, pace: 2, settings, dispatchExtra: { spentThisMonth: () => used } });
  w.engine.countsRequests = () => true;
  w.engine.requestsConfirmed = true;
  w.put('a');
  await w.tick(2);
  settings.capRequests = 5;
  used = 5;
  await w.tick(3);
  assert.equal(w.cards().length, 2);
  assert.match(w.cards()[1].what, /cap of 5/);
});

test('the last ready pull request leaving is no sign the queue can start', async () => {
  const { w } = await readyWorld();
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  w.answer('a', LEAVE_IT);
  await w.tick(2);
  delete w.ready[7];
  await w.tick(3);
  assert.ok(!lines(w).includes(QUEUE_PASSED_WORDS));
  w.ready[7] = { head: 'abc', runId: w.runsOf('a')[0], work: 'a' };
  await w.pass(QUEUE_FAULT_MS + 2 * MINUTE);
  assert.equal(w.cards().length, 1, 'Leave it holds');
});

test('a piece whose card stands open waits on it only while its pull request is ready', async () => {
  const { w } = await readyWorld();
  await w.pass(QUEUE_FAULT_MS + MINUTE);
  assert.ok(w.dispatcher.waitingWork().has('a'));
  delete w.ready[7];
  await w.tick(2);
  assert.ok(!w.dispatcher.waitingWork().has('a'));
});

test('a refusal then a start with no clear answer still says the work never started', async () => {
  const w = wayBack({ recordings: { a: quiet() }, pace: 2 });
  w.refuse = () => REFUSAL;
  w.put('a');
  await w.tick(2);
  w.refuse = null;
  w.startAs = () => ({ ok: false, refused: 'no reply', uncertain: true });
  await w.pass(REFUSED_RETRY_MS);
  await w.tick(3);
  const card = w.cardOf('a');
  assert.doesNotMatch(card.what, /go back to work/);
  assert.match(card.options.find((o) => o.label === STOP_HERE).says, /nothing of it starts/i);
});

test('Stop here on a feature that never started reports no slices', async () => {
  const w = wayBack({ recordings: { f: quiet() }, pace: 1, designOf: () => ({ problem: 'names no document' }) });
  w.put('f', { lane: 'feature' });
  await w.tick(2);
  await w.pass(REFUSED_RETRY_MS);
  w.answer('f', STOP_HERE);
  await w.tick(2);
  assert.equal(w.reports.f.data.outcome, 'closed');
  assert.equal(w.reports.f.data.summary, cutOffStoppedWords('f'));
});

test('the line for an unmarked pull request isn\'t said again after All stop', async () => {
  const w = wayBack({ recordings: { f: ended({ pr: 7 }), b: quiet() }, pace: 1, designOf: slices });
  w.put('f', { lane: 'feature', place: 0 });
  w.put('b', { place: 1 });
  await w.pass(30 * MINUTE);
  w.stop = true;
  await w.tick(2);
  w.stop = false;
  await w.pass(30 * MINUTE);
  assert.deepEqual(lines(w), [unmarkedPrWords('f', 7)]);
});
