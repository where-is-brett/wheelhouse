// tests/scripts/delegation/record-only.test.js
// The seals beside the card router: a card waits for nothing, each card gets one line, and a failure here says nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordOnly, cardContext, historyOf } from '../../../scripts/delegation/record-only.js';
import { SEAL_TICK_MS, FACT_TRIES, SEAL_TRIES, SCORE_WAIT_DAYS } from '../../../scripts/delegation/limits.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeEvent, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { answerLine } from '../../../scripts/state/card-lines.js';
import { SUGGEST_LABEL } from '../../../scripts/engine/router.js';
import { withHome } from '../../helpers/homes.js';

const FACTS = { readable: true, head: 'a'.repeat(40), paths: [], lines: 0, testsChanged: false, depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false };
const question = { id: 'q-w-1', kind: 'question', work: 'w', runId: 'r', level: 3 };

function setUp({ factsOf = async () => FACTS, write, stop = false, contextOf, file } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seal-'));
  const writes = [];
  const world = { now: new Date('2026-11-01T02:00:00.000Z'), stop };
  const made = (over = {}) => recordOnly({
    file: file ?? path.join(dir, 'engine', 'shadow.json'),
    write: write ?? (async (kind, data) => { writes.push({ kind, data }); }),
    stopped: () => world.stop,
    now: () => world.now,
    factsOf,
    contextOf,
    stampOf: () => ({ models: {}, pack: null, rule: null, exclusions: null }),
    ...over,
  });
  return { seals: made(), made, writes, world, dir };
}

test('a question card gets one shadow line, once, and an approval is sealed with no reader', async () => {
  const { seals, writes } = setUp();
  seals.onCard(question);
  seals.onCard(question);
  seals.onCard({ id: '12:abc', kind: 'approval', work: 'w', runId: 'r', level: 3 });
  await seals.tick();
  seals.onCard(question);
  await seals.tick();
  assert.deepEqual(writes.map((w) => w.kind), ['shadow', 'shadow']);
  assert.equal(writes[0].data.card, 'q-w-1');
  assert.equal(writes[0].data.reader, true);
  assert.equal(writes[1].data.signed, 'approval');
  assert.equal(writes[1].data.reader, false);
});

test('a card waits for nothing: onCard returns before facts are read', () => {
  let read = 0;
  const { seals } = setUp({ factsOf: () => { read += 1; return new Promise(() => {}); } });
  assert.equal(seals.onCard(question), undefined);
  assert.equal(read, 0);
});

test('a level 4 card is sealed and marked as no rule can reach it', async () => {
  const { seals, writes } = setUp();
  seals.onCard({ ...question, level: 4 });
  await seals.tick();
  assert.equal(writes[0].data.signed, 'level-4');
  assert.equal(writes[0].data.reader, false);
});

test('facts that fail seal as unreadable, so the card still has its line', async () => {
  const { seals, writes } = setUp({ factsOf: async () => { throw new Error('no folder'); } });
  seals.onCard(question);
  await seals.tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.head, null);
  assert.equal(writes[0].data.candidates.land, null);
});

test('a card\'s context reaches its seal, and one that fails costs nothing', async () => {
  const told = setUp({ contextOf: () => ({ hostPrivate: true }) });
  told.seals.onCard(question);
  await told.seals.tick();
  assert.equal(told.writes[0].data.candidates['push-draft'], true);
  const failing = setUp({ contextOf: () => { throw new Error('no views'); } });
  failing.seals.onCard(question);
  await failing.seals.tick();
  assert.equal(failing.writes[0].data.candidates['push-draft'], null);
});

test('a seal that fails to write says nothing to the director', async () => {
  const writes = [];
  const { seals } = setUp({ write: async (kind) => { writes.push(kind); throw new Error('state is busy'); } });
  seals.onCard(question);
  await seals.tick();
  assert.deepEqual(writes, ['shadow']);
});

test('a seal that keeps failing is given up, and one that fails once is tried again', async () => {
  let fail = 1;
  const kept = [];
  const flaky = setUp({ write: async (kind, data) => { if (fail > 0) { fail -= 1; throw new Error('busy'); } kept.push(data); } });
  flaky.seals.onCard(question);
  await flaky.seals.tick();
  await flaky.seals.tick();
  assert.equal(kept.length, 1);
  let tries = 0;
  const never = setUp({ write: async () => { tries += 1; throw new Error('busy'); } });
  never.seals.onCard(question);
  for (let i = 0; i < SEAL_TRIES + 3; i += 1) await never.seals.tick();
  assert.equal(tries, SEAL_TRIES);
});

test('a tick that hangs holds up no delivery, and the next is skipped until it times out', async () => {
  let reads = 0;
  const { seals, world } = setUp({ factsOf: () => { reads += 1; return new Promise(() => {}); } });
  seals.onCard(question);
  const first = seals.tick();
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(reads, 1);
  assert.equal(await Promise.race([first.then(() => 'ended'), Promise.resolve('waiting')]), 'waiting');
  await seals.tick();
  assert.equal(reads, 1);
  world.now = new Date(world.now.getTime() + SEAL_TICK_MS + 1);
  seals.tick();
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(reads, 2);
});

test('facts that keep hanging seal as unreadable, so one card never blocks the rest', async () => {
  let reads = 0;
  const hanging = () => { reads += 1; return new Promise(() => {}); };
  const { seals, world, writes } = setUp({ factsOf: hanging });
  seals.onCard(question);
  for (let i = 0; i <= FACT_TRIES; i += 1) {
    seals.tick();
    await new Promise((resolve) => { setImmediate(resolve); });
    world.now = new Date(world.now.getTime() + SEAL_TICK_MS + 1);
  }
  assert.equal(reads, FACT_TRIES);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.head, null);
});

test('a tick that was given up writes nothing when it wakes', async () => {
  let wake;
  let reads = 0;
  const factsOf = () => { reads += 1; return reads === 1 ? new Promise((resolve) => { wake = resolve; }) : Promise.resolve(FACTS); };
  const { seals, world, writes } = setUp({ factsOf });
  seals.onCard(question);
  const stale = seals.tick();
  await new Promise((resolve) => { setImmediate(resolve); });
  world.now = new Date(world.now.getTime() + SEAL_TICK_MS + 1);
  await seals.tick();
  wake(FACTS);
  await stale;
  assert.equal(writes.length, 1);
});

test('nothing is read under All stop, and what waits is sealed after it', async () => {
  const { seals, writes, world } = setUp({ stop: true });
  seals.onCard(question);
  await seals.tick();
  assert.equal(writes.length, 0);
  world.stop = false;
  await seals.tick();
  assert.equal(writes.length, 1);
});

test('what waits outlives a restart, and a helper started again seals nothing twice', async () => {
  const { seals, made, writes } = setUp();
  seals.onCard(question);
  const again = made();
  await again.tick();
  assert.equal(writes.length, 1);
  const third = made();
  third.onCard(question);
  await third.tick();
  assert.equal(writes.length, 1);
});

test('a kept file that can\'t be read starts afresh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seal-'));
  const file = path.join(dir, 'shadow.json');
  fs.writeFileSync(file, 'not json');
  const { seals, writes } = setUp({ file });
  seals.onCard(question);
  await seals.tick();
  assert.equal(writes.length, 1);
});

test('a card that can\'t be queued throws nothing at the card router', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seal-'));
  const blocked = path.join(dir, 'a-file');
  fs.writeFileSync(blocked, '');
  const { seals } = setUp({ file: path.join(blocked, 'shadow.json') });
  assert.doesNotThrow(() => seals.onCard(question));
  assert.doesNotThrow(() => seals.onCard(null));
});

test('a card\'s context names the done check, and any other open question on the work', () => {
  const asked = (work, answer = null) => ({ question: { data: { work } }, answer });
  const views = { questions: { 'q-w-1': asked('w'), 'q-w-2': asked('w', { label: 'Yes' }), 'q-x-1': asked('x') } };
  assert.deepEqual(cardContext({ views, card: question, testCommand: 'npm test' }), { doneCheck: 'npm test', openDecision: false });
  const more = { questions: { ...views.questions, 'q-w-3': asked('w') } };
  assert.equal(cardContext({ views: more, card: question }).openDecision, true);
  assert.equal(cardContext({ views: {}, card: question }).doneCheck, undefined);
});

test('a change that can\'t be read yet is tried again, then sealed as unreadable', async () => {
  let reads = 0;
  const { seals, writes } = setUp({ factsOf: async () => { reads += 1; return { readable: false }; } });
  seals.onCard({ ...question, branch: 'wh/x', folder: '/w/x' });
  for (let i = 0; i < FACT_TRIES; i += 1) await seals.tick();
  assert.equal(writes.length, 0);
  await seals.tick();
  assert.equal(reads, FACT_TRIES);
  assert.equal(writes.length, 1);
});

test('facts a tick read aren\'t lost to failed writes', async () => {
  let fail = FACT_TRIES + 1;
  const kept = [];
  const { seals } = setUp({ write: async (kind, data) => { if (fail > 0) { fail -= 1; throw new Error('busy'); } kept.push(data); } });
  seals.onCard(question);
  for (let i = 0; i < FACT_TRIES + 2; i += 1) await seals.tick();
  assert.equal(kept[0].head, FACTS.head);
});

test('a slow write isn\'t raced by the look that takes over', async () => {
  let wake;
  let writes = 0;
  const { seals, world } = setUp({ write: () => { writes += 1; return new Promise((resolve) => { wake = resolve; }); } });
  seals.onCard(question);
  const first = seals.tick();
  await new Promise((resolve) => { setImmediate(resolve); });
  world.now = new Date(world.now.getTime() + SEAL_TICK_MS + 1);
  await seals.tick();
  assert.equal(writes, 1);
  wake();
  await first;
});

test('a look under way can be waited for', async () => {
  let wake;
  const { seals } = setUp({ factsOf: () => new Promise((resolve) => { wake = resolve; }) });
  seals.onCard(question);
  seals.tick();
  await new Promise((resolve) => { setImmediate(resolve); });
  let done = false;
  seals.settled().then(() => { done = true; });
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(done, false);
  wake(FACTS);
  await seals.settled();
});

// A world of signed lines as a helper's `history` gives them: a seal written by the fake `write` joins the lines.
function scoring({ write, file, stop = false } = {}) {
  const lines = new Map();
  const remember = (data) => {
    const line = lines.get(data.card) ?? {};
    line[data.line] ??= data;
    lines.set(data.card, line);
  };
  const made = setUp({
    file, stop,
    write: async (kind, data) => {
      await write?.(kind, data);
      remember(data);
      made.writes.push({ kind, data });
    },
  });
  const { world } = made;
  Object.assign(world, { answers: {}, reads: 0, broken: false });
  const history = () => {
    world.reads += 1;
    if (world.broken) throw new Error('no record');
    return { lines: (id) => lines.get(id) ?? {}, answer: (id) => world.answers[id] ?? null };
  };
  return { ...made, lines, history, seals: made.made, read: (id, pick) => lines.set(id, { ...lines.get(id), reading: { line: 'reading', card: id, pick } }) };
}

test('an answered card is scored in a third line, once', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.read(question.id, 'Keep');
  t.world.answers[question.id] = { answer: { label: 'Keep' }, steered: false };
  await seals.tick();
  await seals.tick();
  const scores = t.writes.filter((w) => w.data.line === 'score');
  assert.equal(scores.length, 1);
  assert.equal(scores[0].data.score, 'match');
  assert.equal(scores[0].data.card, question.id);
});

test('a card with no answer waits for one, and a reading that comes after the answer still counts', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.read(question.id, 'Keep');
  await seals.tick();
  assert.equal(t.writes.filter((w) => w.data.line === 'score').length, 0);
  t.lines.get(question.id).reading = undefined;
  t.world.answers[question.id] = { answer: { label: 'Remove' }, steered: false };
  await seals.tick();
  assert.equal(t.writes.filter((w) => w.data.line === 'score').length, 0);
  t.read(question.id, 'Keep');
  await seals.tick();
  assert.equal(t.writes.at(-1).data.score, 'miss');
});

test('a card steered and never answered is scored outside', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.read(question.id, 'Keep');
  t.world.answers[question.id] = { answer: null, steered: true };
  await seals.tick();
  assert.equal(t.writes.at(-1).data.score, 'outside');
});

test('a reader that gave nothing ends the wait with no score', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.read(question.id, null);
  t.world.answers[question.id] = { answer: { label: 'Keep' }, steered: false };
  await seals.tick();
  await seals.tick();
  assert.equal(t.writes.filter((w) => w.data.line === 'score').length, 0);
  const reads = t.world.reads;
  await seals.tick();
  assert.equal(t.world.reads, reads);
});

test('a card no reader reads is never waited on, so the record isn\'t read for it', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard({ id: '12:abc', kind: 'approval', work: 'w', level: 3 });
  seals.onCard({ ...question, id: 'q-w-2', level: 4 });
  await seals.tick();
  await seals.tick();
  assert.equal(t.world.reads, 0);
});

test('a helper started again writes no second score, and keeps the cards it waits on', async () => {
  const t = scoring();
  const first = t.seals({ history: t.history });
  first.onCard(question);
  await first.tick();
  t.read(question.id, 'Keep');
  const again = t.seals({ history: t.history });
  t.lines.get(question.id).score = { line: 'score', card: question.id, score: 'match' };
  t.world.answers[question.id] = { answer: { label: 'Keep' }, steered: false };
  await again.tick();
  assert.equal(t.writes.filter((w) => w.data.line === 'score').length, 0);
  const reads = t.world.reads;
  await again.tick();
  assert.equal(t.world.reads, reads);
});

test('a score that fails to write says nothing, is tried again, and is given up', async () => {
  let fail = true;
  const t = scoring({ write: async (kind, data) => { if (data.line === 'score' && fail) throw new Error('refused'); } });
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.read(question.id, 'Keep');
  t.world.answers[question.id] = { answer: { label: 'Keep' }, steered: false };
  await seals.tick();
  fail = false;
  await seals.tick();
  assert.equal(t.writes.filter((w) => w.data.line === 'score').length, 1);

  fail = true;
  const other = { ...question, id: 'q-w-2' };
  seals.onCard(other);
  await seals.tick();
  t.read(other.id, 'Keep');
  t.world.answers[other.id] = { answer: { label: 'Keep' }, steered: false };
  for (let i = 0; i < SEAL_TRIES + 2; i += 1) await seals.tick();
  const reads = t.world.reads;
  await seals.tick();
  assert.equal(t.world.reads, reads);
});

test('a card left open is let go after its wait, so the record isn\'t read for ever', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.world.now = new Date(t.world.now.getTime() + (SCORE_WAIT_DAYS * 24 * 60 * 60 * 1000) + 1000);
  await seals.tick();
  const reads = t.world.reads;
  await seals.tick();
  assert.equal(t.world.reads, reads);
});

test('a record that can\'t be read costs nothing, and the card is scored when it can', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.read(question.id, 'Keep');
  t.world.answers[question.id] = { answer: { label: 'Keep' }, steered: false };
  t.world.broken = true;
  await seals.tick();
  t.world.broken = false;
  await seals.tick();
  assert.equal(t.writes.at(-1).data.score, 'match');
});

test('under All stop nothing is scored, and the card is scored once it lifts', async () => {
  const t = scoring();
  const seals = t.seals({ history: t.history });
  seals.onCard(question);
  await seals.tick();
  t.read(question.id, 'Keep');
  t.world.answers[question.id] = { answer: { label: 'Keep' }, steered: false };
  t.world.stop = true;
  await seals.tick();
  assert.equal(t.writes.filter((w) => w.data.line === 'score').length, 0);
  t.world.stop = false;
  await seals.tick();
  assert.equal(t.writes.at(-1).data.score, 'match');
});

test('what was kept before scoring still seals what waits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seal-'));
  const file = path.join(dir, 'shadow.json');
  fs.writeFileSync(file, JSON.stringify({ waiting: [question], sealed: { 'q-w-0': true }, tries: {}, fails: {} }));
  const t = scoring({ file });
  const seals = t.seals({ history: t.history });
  await seals.tick();
  assert.equal(t.writes[0].data.card, question.id);
});

test('the signed record gives the first seal, the answer, and whether the card was steered', () => withHome(() => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
  const at = (n) => () => new Date(`2026-11-01T02:00:0${n}.000Z`);
  const data = { line: 'seal', card: 'q-w-1', work: 'w', head: null, signed: null, reader: true, candidates: {}, exclusions: { hit: [], unread: [] }, stamp: { models: null, pack: null, rule: null, exclusions: null }, at: 'x', hash: 'a'.repeat(64) };
  const question1 = { id: 'q-w-1', work: 'w', what: 'Which?', why: 'Because', options: [{ label: 'Keep', says: 'k' }, { label: 'Remove', says: 'r' }], recommendation: 'Keep', level: 3 };
  const card = (id) => makeEvent({ kind: 'card', data: { question: `Which ${id}?`, header: 'Which', kind: 'answer', level: 3, line: answerLine(id), options: ['Keep', 'Remove', SUGGEST_LABEL] }, now: at(3) });
  const steered = card('q-w-1');
  const events = [
    makeEvent({ kind: 'shadow', data: { ...data, head: 'b'.repeat(40) }, now: at(2) }),
    makeEvent({ kind: 'shadow', data: { ...data, head: 'c'.repeat(40) }, now: at(1) }),
    makeEvent({ kind: 'question', data: question1, now: at(1) }),
    steered,
    makeEvent({ kind: 'card-answer', data: { question: 'Which q-w-1?', label: SUGGEST_LABEL }, now: at(4) }),
    makeEvent({ kind: 'action', data: { action: 'answer', question: 'Which?', questionId: 'q-w-1', questionHash: dataHash(question1), label: 'Keep' }, now: at(5) }),
    { ...makeEvent({ kind: 'shadow', data: { ...data, card: 'q-w-2' }, now: at(1) }), sig: undefined },
  ];
  const enrolled = readEnrolled();
  const history = historyOf({ events, enrolled, views: buildViews(events, enrolled) });
  assert.equal(history.lines('q-w-1').seal.head, 'c'.repeat(40));
  assert.deepEqual(history.lines('q-w-2'), {});
  const got = history.answer('q-w-1');
  assert.equal(got.answer.label, 'Keep');
  assert.equal(got.steered, true);
  assert.equal(history.answer('q-w-9').steered, false);
}));

test('stepping out of a card\'s options by any way the record holds counts as steered', () => withHome(() => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
  const at = (n) => () => new Date(`2026-11-01T02:00:0${n}.000Z`);
  const card = (id, n = 1) => makeEvent({ kind: 'card', data: { question: `Which ${id}?`, header: 'Which', kind: 'answer', level: 3, line: answerLine(id), options: ['Keep', 'Remove', SUGGEST_LABEL, 'Not now'] }, now: at(n) });
  const answered = (question, label, n = 2) => makeEvent({ kind: 'card-answer', data: { question, label }, now: at(n) });
  const byId = card('q-byid');
  const told = card('q-told');
  const events = [
    card('q-typed'), answered('Which q-typed?', 'Keep it, but smaller'),
    byId, answered(byId.id, SUGGEST_LABEL),
    told, makeEvent({ kind: 'chat-steer', data: { card: told.id }, now: at(2) }),
    card('q-kept'), answered('Which q-kept?', 'Keep'),
    card('q-put-off'), answered('Which q-put-off?', 'Not now'), answered('Which q-put-off?', 'Explain more', 3),
    answered('Which q-later?', 'Something typed on an older card'), card('q-later', 3),
  ];
  const enrolled = readEnrolled();
  const history = historyOf({ events, enrolled, views: {} });
  for (const id of ['q-typed', 'q-byid', 'q-told']) assert.equal(history.answer(id).steered, true, id);
  for (const id of ['q-kept', 'q-put-off', 'q-later']) assert.equal(history.answer(id).steered, false, id);
}));
