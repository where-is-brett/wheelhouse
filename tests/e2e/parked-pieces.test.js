// tests/e2e/parked-pieces.test.js
// Pieces waiting on the director, on the fake engine (delegated decisions design, section 8): other work goes on, answers
// come back at pace, and nothing is lost or doubled on the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { wayBack, asking, quiet, forever } from '../helpers/way-back.js';
import { TRY_AGAIN, STOP_HERE, LEAVE_IT } from '../../scripts/engine/dispatch-run.js';

test('three parked pieces with other work merging', async () => {
  const w = wayBack({ recordings: { a: asking('qa'), b: asking('qb'), c: asking('qc'), d: quiet(), e: quiet() } });
  for (const [n, id] of ['a', 'b', 'c', 'd', 'e'].entries()) w.put(id, { place: n });
  await w.tick();
  assert.deepEqual(w.starts.map((s) => s.order.work), ['a', 'b', 'c'], 'three start at pace');
  await w.tick(2);
  assert.deepEqual(w.starts.map((s) => s.order.work), ['a', 'b', 'c', 'd', 'e'], 'with all three parked, the rest goes on');
  assert.equal(w.answers().length, 0);
  for (const id of ['a', 'b', 'c']) assert.ok(w.cardOf(id), `${id} has its card`);
});

test('answers bringing runs back over pace', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const hold = Object.fromEntries(ids.map((id) => [id, asking(`q${id}`)]));
  const w = wayBack({ recordings: { ...hold, busy: asking('qbusy') }, pace: 2 });
  ids.forEach((id, n) => w.put(id, { place: n }));
  await w.tick(4);
  assert.equal(w.starts.length, 4, 'new work stops at twice pace, parked');
  for (const id of w.starts.map((s) => s.order.work)) w.answer(id, 'Do the whole page');
  await w.tick();
  assert.equal(w.answers().length, 0, 'the click only asks for a place');
  await w.tick();
  assert.equal(w.answers().length, 2, 'two come back, at pace');
  await w.tick(6);
  assert.equal(w.answers().length, 4, 'and the rest as places free');
  assert.equal(new Set(w.answers().map((c) => c.action.answer.ask)).size, 4, 'each once');
});

test('a waiting feature with a second one starting', async () => {
  const slices = (title) => ({ text: `# ${title}\n\n\`\`\`wheelhouse-slices\n${JSON.stringify({ goal: title, flag: { name: title }, demo: 'end', slices: [{ title: 'One', goal: 'One', done: [{ test: 'one' }] }, { title: 'Two', goal: 'Two', done: [{ test: 'two' }] }] })}\n\`\`\`\n` });
  const w = wayBack({ recordings: { first: asking('q1'), second: asking('q2') }, designOf: slices });
  w.put('first', { lane: 'feature', place: 0 });
  w.put('second', { lane: 'feature', place: 1 });
  await w.tick();
  assert.deepEqual(w.starts.map((s) => s.order.work), ['first']);
  await w.tick(2);
  assert.deepEqual(w.starts.map((s) => s.order.work), ['first', 'second'], 'the second starts while the first waits');
  w.answer('first', 'Do the whole page');
  await w.tick(2);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask), ['q1'], 'the second is parked too, so the feature place is free');
  assert.equal(w.stateOf('second'), 'paused', 'only one builds');
});

test('a start refused after admission', async () => {
  const w = wayBack({ recordings: { a: [asking('qa', { kind: 'blocked', options: [{ id: 'rework', label: 'Send it back' }, { id: 'stop', label: 'Stop' }], context: { question: 'Which?' } }), quiet()] } });
  w.put('a');
  await w.tick();
  w.answer('a', 'Send it back');
  w.refuse = () => 'the mirror could not be read';
  await w.tick(6);
  assert.equal(w.starts.length, 3, 'once at first, then a refusal and a second refusal');
  assert.equal(w.notes().filter((n) => /couldn't go back to work/.test(n)).length, 1, 'said once');
  assert.deepEqual(w.cardOf('a').options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
  assert.equal(w.dispatcher.admittedTo('a'), false, 'the place went back');
  w.refuse = null;
  await w.tick(2);
  assert.equal(w.starts.length, 3, 'nothing starts until the director says');
  w.answer('a', TRY_AGAIN);
  await w.tick();
  assert.equal(w.starts.length, 4);
  await w.tick(3);
  assert.equal(w.starts.length, 4, 'once');
});

test('All stop through an answer waiting for a place', async () => {
  const w = wayBack({ recordings: { a: asking('qa', { context: { question: 'Which?', branch: 'wh/a' } }), busy: asking('qbusy'), other: asking('qother') }, pace: 1 });
  w.put('a', { place: 0 });
  w.put('busy', { place: 1 });
  await w.tick(3);
  w.answer('a', 'Do the whole page');
  w.engine.act(w.runsOf('busy')[0], { cancel: { reason: 'it holds the place no more' } });
  w.stop = true;
  await w.engine.stopAll('All stop');
  await w.tick(2);
  assert.equal(w.answers().length, 0, 'nothing goes back under All stop');
  assert.equal(w.dispatcher.admittedTo('a'), false);
  assert.ok(w.notes().some((n) => /All stop was on when you answered/.test(n)));
  w.stop = false;
  w.work.a.work.at = '2026-10-29T12:00:00.000Z';
  w.work.a.since = w.work.a.work.at;
  w.refuse = () => 'the mirror could not be read';
  await w.tick();
  assert.equal(w.starts.at(-1).branch, 'wh/a');
  w.refuse = null;
  await w.tick();
  const last = w.starts.at(-1);
  assert.equal(last.carryOn, true);
  assert.equal(last.branch, 'wh/a');
  assert.deepEqual(last.order.answers, [{ question: 'Which?', answer: 'Do the whole page' }], 'a refused start lost neither');
});

test('a restart between admit and running keeps the place and delivers once', async () => {
  const w = wayBack({ recordings: { a: asking('qa'), b: asking('qb') }, pace: 1 });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(3);
  w.answer('a', 'Do the whole page');
  w.answer('b', 'Do the whole page');
  await w.pump();
  await w.runner.tick();
  await w.dispatcher.tick();
  const held = ['a', 'b'].filter((id) => w.dispatcher.admittedTo(id));
  assert.equal(held.length, 1, 'one has the place');
  w.restart();
  assert.equal(w.dispatcher.admittedTo(held[0]), true, 'and keeps it through the restart');
  await w.runner.tick();
  assert.equal(w.answers().length, 1);
  w.restart();
  await w.tick(4);
  assert.equal(new Set(w.answers().map((c) => c.action.answer.ask)).size, 2, 'both go, in turn');
  assert.equal(w.answers().length, 2, 'each once');
});

test('the running count never passes pace, at any pace, with answers coming back together', async () => {
  for (const pace of [1, 2, 3]) {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    // Each goes on running once answered, until the test ends it.
    const w = wayBack({ recordings: Object.fromEntries(ids.map((id) => [id, asking(`q${id}`).slice(0, 3)])), pace });
    ids.forEach((id, n) => w.put(id, { place: n }));
    await w.tick(6);
    const parked = w.starts.map((s) => s.order.work);
    assert.equal(parked.length, Math.min(6, 2 * pace), 'new work stops at twice pace');
    for (const id of parked) w.answer(id, 'Do the whole page');
    let most = 0;
    for (let n = 0; n < 14; n += 1) {
      await w.tick();
      const going = new Set([...ids.filter((id) => w.stateOf(id) === 'started'), ...ids.filter((id) => w.dispatcher.admittedTo(id))]);
      most = Math.max(most, going.size);
      assert.ok(going.size <= pace, `pace ${pace}: ${going.size} going`);
      // One ends every few ticks, so the rest come back through the places it leaves.
      if (n % 3 === 2) {
        const done = ids.find((id) => w.stateOf(id) === 'started');
        if (done) w.engine.act(w.runsOf(done).at(-1), { cancel: { reason: 'done' } });
      }
    }
    assert.equal(most, pace, 'the places were used');
    assert.equal(new Set(w.answers().map((c) => c.action.answer.ask)).size, w.answers().length, 'each answer once');
  }
});

test('alike questions on parked pieces, one click, and the top card rising past the budget', async () => {
  const same = { reason: 'Which page?' };
  const w = wayBack({ recordings: { a: asking('qa', same), b: asking('qb', same), c: asking('qc', { reason: 'Which colour?' }), held: quiet() }, pace: 2, settings: { cardsPerDay: 1 } });
  w.put('a', { files: ['one.js'], place: 0 });
  w.put('b', { files: ['two.js'], place: 1 });
  await w.tick(2);
  w.put('c', { files: ['three.js'], place: 2 });
  await w.tick(2);
  w.put('held', { files: ['three.js'], place: 3 });
  await w.tick(2);
  const [lead, joiner, third] = w.cards();
  assert.equal(joiner.joins, lead.id);
  assert.ok(third.id, 'a third question, past the budget');
  const top = w.written.filter((x) => x.kind === 'note' && x.data.about === 'top-card').at(-1).data;
  assert.equal(top.id, third.id, 'the card behind the hold');
  assert.equal(top.holdsUp, 1);
  assert.equal(w.views().cardsWaiting.ids.includes(third.id), false);
  w.answer('a', 'Do the whole page', { shown: ['b'] });
  await w.tick(6);
  assert.deepEqual(w.answers().map((c) => c.action.answer.ask).sort(), ['qa', 'qb']);
});

test('a restart is a real one: both sides are built anew from their files', async () => {
  const w = wayBack({ recordings: { a: quiet() } });
  const { dispatcher, runner } = w;
  w.restart();
  assert.notEqual(w.dispatcher, dispatcher);
  assert.notEqual(w.runner, runner);
});

const blocked = (id) => asking(id, { kind: 'blocked', options: [{ id: 'rework', label: 'Send it back' }, { id: 'stop', label: 'Stop' }], context: { question: 'Which?' } });
const kept = (w) => JSON.parse(fs.readFileSync(path.join(w.dir, 'dispatch.json'), 'utf8'));
const slices = (title) => ({ text: `# ${title}\n\n\`\`\`wheelhouse-slices\n${JSON.stringify({ goal: title, flag: { name: title }, demo: 'end', slices: [{ title: 'One', goal: 'One', done: [{ test: 'one' }] }, { title: 'Two', goal: 'Two', done: [{ test: 'two' }] }] })}\n\`\`\`\n` });

test('an answer takes no place from another entry of its own piece', async () => {
  const w = wayBack({ recordings: { z: [blocked('qz1'), asking('qz2').slice(0, 3)], a: asking('qa').slice(0, 3) }, pace: 1 });
  w.put('z', { place: 0 });
  w.put('a', { place: 1 });
  await w.tick(4);
  w.answer('z', 'Send it back');
  for (let n = 0; n < 12; n += 1) {
    await w.tick();
    if (w.cardOf('z')?.engine?.ask === 'qz2' && kept(w).admitted.some((e) => e.work === 'z')) break;
  }
  assert.equal(w.cardOf('z')?.engine?.ask, 'qz2', 'the fresh card is out while z still holds its place');
  w.answer('z', 'Do the whole page');
  w.answer('a', 'Do the whole page');
  for (let n = 0; n < 6; n += 1) {
    await w.tick();
    assert.ok(['z', 'a'].filter((id) => w.stateOf(id) === 'started').length <= 1, 'pace 1 holds');
  }
});

test('Stop here on an unsure first start starts nothing more', async () => {
  const w = wayBack({ recordings: { a: quiet() } });
  w.engine.liveRunOf = () => undefined;
  w.put('a');
  w.startAs = () => ({ ok: false, refused: 'no reply', uncertain: true });
  await w.tick(2);
  assert.match(w.cardOf('a').what, /Nothing more of it starts until you say/);
  w.startAs = null;
  await w.tick(2);
  assert.equal(w.starts.length, 1, 'not while the card waits');
  w.answer('a', STOP_HERE);
  await w.tick(3);
  assert.equal(w.starts.length, 1, 'nor after it');
  assert.equal(w.reports.a.data.outcome, 'closed');
  assert.deepEqual(w.dispatcher.reserved(), {});
});

test('Stop here tries to end an orphan the engine started, and starts no run beside it', async () => {
  const w = wayBack({ recordings: { a: forever() }, pace: 2 });
  w.put('a');
  let orphan = null;
  w.engine.liveRunOf = () => undefined;
  w.startAs = () => {
    orphan = w.engine.start({ work: 'a', lane: 'quick', recording: 'a' }).runId;
    return { ok: false, refused: 'no reply', uncertain: true };
  };
  await w.tick(2);
  w.startAs = null;
  w.engine.liveRunOf = () => ({ runId: orphan });
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => (action.cancel ? { ok: false, refused: 'the engine would not' } : act(runId, action));
  w.answer('a', STOP_HERE);
  await w.tick(3);
  assert.equal(w.starts.length, 1);
  assert.equal(w.notes().filter((n) => /may still be going in the build engine/.test(n)).length, 1, 'it says what it couldn\'t end');
});

const leftClashing = async (label = LEAVE_IT) => {
  const w = wayBack({ recordings: { a: [quiet(), quiet(), quiet()], z: quiet() }, pace: 1 });
  w.put('a', { files: ['one.js'], place: 0 });
  await w.tick(2);
  for (let n = 0; n < 2; n += 1) {
    w.runs.a.at(-1).data.pr = 7;
    w.dispatcher.sentBack('a');
    await w.tick(3);
  }
  assert.match(w.cardOf('a').what, /clashed/);
  assert.deepEqual(w.dispatcher.reserved().a, ['one.js']);
  w.answer('a', label);
  await w.tick();
  w.put('z', { files: ['one.js'], place: 1 });
  return w;
};

test('Leave it on a clash card brings a card once its files hold other work', async () => {
  const w = await leftClashing();
  await w.tick(3);
  const card = w.cardOf('a');
  assert.ok(card, 'a card stands behind the hold');
  assert.deepEqual(card.options.map((o) => o.label), [TRY_AGAIN, STOP_HERE]);
  const top = w.written.filter((x) => x.kind === 'note' && x.data.about === 'top-card').at(-1).data;
  assert.equal(top.id, card.id);
  await w.tick(2);
  assert.equal(w.cards().filter((c) => c.options.some((o) => o.label === STOP_HERE)).length, 1, 'once');
  w.answer('a', STOP_HERE);
  await w.tick(3);
  assert.ok(w.starts.some((s) => s.order.work === 'z'), 'Stop here frees the files');
});

test('a feature the director stopped at its cap gives its place up', async () => {
  const w = wayBack({ recordings: { f: forever(), g: quiet(), h: quiet() }, pace: 1, designOf: slices, settings: { capMinutes: { slice: 1 }, capTokens: {} } });
  w.put('f', { lane: 'feature', place: 0 });
  await w.tick(2);
  w.clock.now = new Date(w.clock.now.getTime() + 10 * 60000);
  await w.tick(2);
  w.answer('f', 'Stop');
  await w.tick(2);
  w.put('h', { place: 1 });
  await w.tick(3);
  assert.ok(w.starts.some((s) => s.order.work === 'h'));
});

test('a feature All stop cancelled gives its place up after the lift', async () => {
  const w = wayBack({ recordings: { f: forever(), h: quiet() }, pace: 1, designOf: slices });
  w.put('f', { lane: 'feature', place: 0 });
  await w.tick(2);
  w.stop = true;
  await w.engine.stopAll('All stop');
  w.stoppedIds = w.runsOf('f');
  await w.tick(2);
  w.stop = false;
  await w.tick(2);
  w.put('h', { place: 1 });
  await w.tick(3);
  assert.ok(w.starts.some((s) => s.order.work === 'h'));
  assert.equal(w.cards().length, 0, 'the First Mate\'s Carry on takes it up, as ever');
});

test('a feature run that failed with no pull request brings its card', async () => {
  const fail = [{ type: 'run-started', runId: 'x', at: '2026-10-29T02:00:00.000Z' }, { type: 'run-ended', runId: 'x', at: '2026-10-29T02:00:00.000Z', outcome: 'failed' }];
  const w = wayBack({ recordings: { f: fail, h: quiet() }, pace: 1, designOf: slices });
  w.put('f', { lane: 'feature', place: 0 });
  await w.tick(5);
  const card = w.cardOf('f');
  assert.match(card.what, /failed before it was added.*Nothing more of it starts until you say/);
  w.put('h', { place: 1 });
  await w.tick(2);
  assert.ok(w.starts.some((s) => s.order.work === 'h'), 'the card gives its place up');
  assert.equal(w.cards().length, 1, 'one card');
});
