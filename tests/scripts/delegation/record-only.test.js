// tests/scripts/delegation/record-only.test.js
// The seals beside the card router: a card waits for nothing, each card gets one line, and a failure here says nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordOnly, cardContext, historyOf } from '../../../scripts/delegation/record-only.js';
import { closeMatch } from '../../../scripts/delegation/asked.js';
import { answerInput } from '../../../scripts/cards/compose.js';
import { SEAL_TICK_MS, FACT_TRIES, SEAL_TRIES, SCORE_WAIT_DAYS, READER_MS, READER_TOKENS, READER_UNKNOWN_MS, READERS_WAITING_MOST } from '../../../scripts/delegation/limits.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeEvent, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { answerLine, blindLine } from '../../../scripts/state/card-lines.js';
import { SUGGEST_LABEL } from '../../../scripts/engine/router.js';
import { READER_WORK } from '../../../scripts/delegation/reader.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
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

test('a seal names the rules behind it, and rules that can\'t be read cost nothing', async () => {
  const rule = { id: 'rule-1', hash: 'b'.repeat(64), conditions: [], lanes: ['small'], paths: ['a.js'], literal: null };
  const facts = { ...FACTS, paths: ['a.js'] };
  const named = setUp({ factsOf: async () => facts, contextOf: () => ({ lane: 'small' }) });
  const seals = named.made({ rulesOf: () => [rule] });
  seals.onCard(question);
  await seals.tick();
  assert.deepEqual(named.writes[0].data.stamp.rule, { 'rule-1': rule.hash });
  const broken = setUp({ factsOf: async () => facts });
  const quiet = broken.made({ rulesOf: () => { throw new Error('no'); } });
  quiet.onCard(question);
  await quiet.tick();
  assert.equal(broken.writes.length, 1);
  assert.equal(broken.writes[0].data.stamp.rule, null);
});

test('a card\'s context says its lane and its options', () => {
  const views = { work: { w: { work: { data: { lane: 'small', level: 4 } } } }, questions: { 'q-w-1': { question: { data: { work: 'w', options: ['Keep', 'Remove'] } } } } };
  const ctx = cardContext({ views, card: question });
  assert.equal(ctx.lane, 'small');
  assert.equal(ctx.workLevel, 4);
  assert.deepEqual(ctx.options, ['Keep', 'Remove']);
  assert.equal(cardContext({ views: {}, card: question }).lane, undefined);
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
  assert.deepEqual(cardContext({ views, card: question, testCommand: 'npm test' }), { doneCheck: 'npm test', openDecision: false, lane: undefined, workLevel: undefined, options: undefined });
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

// The reader's side: a card read on the fake engine.
const VIEW = { question: 'Which?', labels: ['Keep', 'Remove'], rule: null, quote: null, brief: null, sheet: null, diff: '', pathsOnly: [] };
const READING = { frame: 'sound', why: 'They fit.', kind: 'can-see', fits: 'no-rule', pick: 'Keep', tags: [{ label: 'Keep', leans: ['keep'] }, { label: 'Remove', leans: ['remove'] }] };
const spend = { tokens: 900, dollars: 0.01, source: 'reported' };
const finished = (output = JSON.stringify(READING)) => [
  { type: 'step-finished', at: 't', step: 'read', role: 'reader', spend, output },
  { type: 'run-ended', at: 't', outcome: 'completed', branch: null, pr: null },
];

function reading({ events = finished(), gate = () => ({ running: 0, pace: 3 }), startReader, viewOf = async () => VIEW, readViews = () => ({}), trusted, fake, stop = false, onMatch } = {}) {
  const engine = fake ?? fakeEngine({ recordings: { reader: events } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-read-'));
  const writes = [];
  const world = { now: new Date('2026-11-01T02:00:00.000Z'), stop };
  const seals = recordOnly({
    file: path.join(dir, 'shadow.json'), write: async (kind, data) => { writes.push({ kind, data }); }, stopped: () => world.stop, now: () => world.now,
    factsOf: async () => FACTS, stampOf: () => ({ models: {}, pack: null, rule: null, exclusions: null }),
    engine, viewOf, gate, readViews, trusted, onMatch,
    startReader: startReader ?? (async (card) => engine.start({ work: READER_WORK, lane: 'reader', card })),
  });
  const lines = () => writes.filter((w) => w.kind === 'shadow' && w.data.line === 'reading').map((w) => w.data);
  const later = async (ms) => {
    world.now = new Date(world.now.getTime() + ms);
    await seals.tick();
  };
  return { seals, engine, writes, world, lines, later };
}

test('a question card gains the reader\'s reading, with no card waiting and no question raised', async () => {
  const { seals, writes, lines, later } = reading();
  seals.onCard(question);
  await seals.tick();
  await later(1);
  const [line] = lines();
  assert.equal(line.reader, 'read');
  assert.equal(line.card, question.id);
  for (const key of Object.keys(READING)) assert.deepEqual(line[key], READING[key]);
  assert.equal(line.afterAnswer, false);
  assert.match(line.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual([...new Set(writes.map((w) => w.kind))].sort(), ['cost', 'shadow']);
});

test('an approval, a level 4 card and a refused view start no reader', async () => {
  const { seals, engine, writes } = reading({ viewOf: async () => ({ refused: 'it claims agreement' }) });
  seals.onCard({ id: '12:abc', kind: 'approval', work: 'w', level: 3 });
  seals.onCard({ ...question, id: 'q-w-2', level: 4 });
  seals.onCard(question);
  await seals.tick();
  assert.equal(engine.calls.length, 0);
  assert.equal(writes.find((w) => w.data.card === question.id).data.reader, 'refused');
});

test('a reader that fails leaves the seal whole and the card alone', async () => {
  const cases = [
    ['empty', () => reading({ events: finished('') })],
    ['bad shape', () => reading({ events: finished('{"frame":"fine"}') })],
    ['a failed run', () => reading({ events: [{ type: 'run-ended', at: 't', outcome: 'failed', branch: null, pr: null }] })],
    ['a refused start', () => reading({ startReader: async () => ({ ok: false, refused: 'no' }) })],
    ['a start that throws', () => reading({ startReader: async () => { throw new Error('no'); } })],
    ['another pack', () => reading({ trusted: () => false })],
    ['a view that throws', () => reading({ viewOf: async () => { throw new Error('no'); } })],
  ];
  for (const [name, made] of cases) {
    const { seals, writes, lines, later } = made();
    seals.onCard(question);
    await seals.tick();
    await later(1);
    assert.equal(writes.filter((w) => w.data.line === 'seal').length, 1, name);
    assert.ok(!writes.some((w) => ['question', 'note', 'card'].includes(w.kind)), name);
    if (name !== 'a view that throws') assert.deepEqual(lines().map((l) => l.reader), ['none'], name);
    if (name !== 'a view that throws') assert.equal(lines()[0].pick, null, name);
  }
});

test('a reader that never ends times out, is cancelled and leaves no card', async () => {
  const fake = fakeEngine({ recordings: { reader: [{ type: 'step-finished', at: 't', step: 'read', role: 'reader', spend, output: 'x' }] } });
  const { seals, writes, lines, later } = reading({ fake });
  seals.onCard(question);
  await seals.tick();
  await later(READER_MS - 1);
  assert.deepEqual(lines(), []);
  await later(2);
  assert.deepEqual(lines().map((l) => [l.reader, l.why]), [['none', 'past-its-limit']]);
  assert.ok(fake.calls.some((c) => c.action?.cancel));
  assert.ok(!writes.some((w) => w.kind === 'question'));
});

test('a reader past a cap is cancelled with no cap card', async () => {
  const fake = fakeEngine({ recordings: { reader: [{ type: 'step-finished', at: 't', step: 'read', role: 'reader', spend: { ...spend, tokens: READER_TOKENS + 1 }, output: 'x' }] } });
  const { seals, writes, lines, later } = reading({ fake });
  seals.onCard(question);
  await seals.tick();
  await later(1);
  assert.ok(fake.calls.some((c) => c.action?.cancel));
  assert.deepEqual(lines().map((l) => l.why), ['past-its-limit']);
  assert.ok(!writes.some((w) => ['question', 'card', 'note'].includes(w.kind)));
});

test('a reader\'s tokens fall under their own line and on no piece', async () => {
  const { seals, writes, later } = reading();
  seals.onCard(question);
  await seals.tick();
  await later(1);
  const costs = writes.filter((w) => w.kind === 'cost');
  assert.equal(costs.length, 1);
  assert.equal(costs[0].data.work, READER_WORK);
  assert.equal(costs[0].data.tokens, 900);
});

test('a reader\'s own trouble never becomes a card', async () => {
  const fake = fakeEngine({ recordings: { reader: [] } });
  const start = fake.start.bind(fake);
  fake.start = (order) => start({ ...order, running: true });
  const { seals, writes, lines, later } = reading({ fake });
  seals.onCard(question);
  await seals.tick();
  const { runId } = seals.reading();
  assert.deepEqual(seals.readerOf(runId), { work: READER_WORK, lane: 'reader', branch: null });
  seals.onReaderAsk({ runId, id: `${runId}:owner-lost` });
  await later(1);
  assert.ok(fake.calls.some((c) => c.action?.cancel));
  assert.deepEqual(lines().map((l) => [l.reader, l.why]), [['none', 'lost']]);
  assert.ok(!writes.some((w) => ['question', 'card', 'note'].includes(w.kind)));
  assert.equal(seals.readerOf(runId), null);
});

test('a run the engine has lost is given up, and not at once', async () => {
  const fake = { calls: [], start: () => ({ ok: true, runId: 'gone' }), inspect: () => ({ status: 'unknown', steps: [] }), outputs: () => ({}), act: () => ({ ok: true }) };
  const { seals, lines, later } = reading({ fake });
  seals.onCard(question);
  await seals.tick();
  await later(READER_UNKNOWN_MS - 1);
  assert.deepEqual(lines(), []);
  await later(2);
  assert.deepEqual(lines().map((l) => l.why), ['lost']);
});

test('no reader starts under All stop or an incident', async () => {
  const held = reading({ gate: () => ({ running: 0, pace: 3, incident: true }) });
  held.seals.onCard(question);
  await held.seals.tick();
  await held.later(1);
  assert.equal(held.engine.calls.length, 0);
  assert.deepEqual(held.lines(), []);
  const stopped = reading({ gate: () => ({ running: 9, pace: 3 }) });
  stopped.seals.onCard(question);
  await stopped.seals.tick();
  stopped.world.stop = true;
  await stopped.later(1);
  assert.equal(stopped.engine.calls.length, 0);
});

test('on a plan\'s counted requests the seal holds the script checks alone', async () => {
  const { seals, engine, lines, later } = reading({ gate: () => ({ running: 0, pace: 3, counted: true }) });
  seals.onCard(question);
  await seals.tick();
  await later(1);
  assert.equal(engine.calls.length, 0);
  assert.deepEqual(lines().map((l) => [l.reader, l.why]), [['none', 'counted']]);
});

test('a busy project keeps the card waiting, and it is read when there is room', async () => {
  const world = { running: 5 };
  const { seals, engine, lines, later } = reading({ gate: () => ({ running: world.running, pace: 3 }) });
  seals.onCard(question);
  await seals.tick();
  assert.equal(engine.calls.length, 0);
  world.running = 1;
  await later(1);
  await later(1);
  assert.deepEqual(lines().map((l) => l.reader), ['read']);
});

test('one reader at a time, in the order of the cards', async () => {
  const { seals, engine, lines, later } = reading();
  seals.onCard(question);
  seals.onCard({ ...question, id: 'q-w-2' });
  await seals.tick();
  assert.equal(engine.calls.filter((c) => c.call === 'start').length, 1);
  await later(1);
  await later(1);
  assert.deepEqual(lines().map((l) => l.card), [question.id, 'q-w-2']);
  assert.equal(engine.calls.filter((c) => c.call === 'start').length, 2);
});

test('the cards waiting for a reader are bounded, and a card past that has no reading', async () => {
  const { seals, lines } = reading({ gate: () => ({ running: 9, pace: 3 }) });
  for (let n = 0; n <= READERS_WAITING_MOST; n += 1) seals.onCard({ ...question, id: `q-w-${n}` });
  await seals.tick();
  assert.deepEqual(lines().map((l) => l.why), ['too-many-waiting']);
});

test('an answer before the reader ends is marked, and the reading kept', async () => {
  const world = { views: {} };
  const { seals, lines, later } = reading({ readViews: () => world.views });
  seals.onCard(question);
  await seals.tick();
  world.views = { questions: { [question.id]: { answer: { label: 'Keep' } } } };
  await later(1);
  assert.equal(lines()[0].afterAnswer, true);
  assert.equal(lines()[0].pick, READING.pick);
});

test('the view is frozen at the seal, and given only while that card is read', async () => {
  let built = 0;
  const { seals, later } = reading({ viewOf: async () => { built += 1; return VIEW; } });
  seals.onCard(question);
  await seals.tick();
  assert.deepEqual(seals.viewFor(question.id), VIEW);
  assert.equal(seals.viewFor('q-w-9'), null);
  await later(1);
  assert.equal(built, 1);
  assert.equal(seals.viewFor(question.id), null);
});

test('a helper started again carries on with the reader under way', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-read-'));
  const fake = fakeEngine({ recordings: { reader: finished() } });
  const writes = [];
  const made = () => recordOnly({
    file: path.join(dir, 'shadow.json'), write: async (kind, data) => { writes.push({ kind, data }); }, factsOf: async () => FACTS,
    stampOf: () => ({ models: {}, pack: null, rule: null, exclusions: null }),
    engine: fake, viewOf: async () => VIEW, gate: () => ({ running: 0, pace: 3 }), startReader: async () => fake.start({ work: READER_WORK, lane: 'reader' }),
  });
  const first = made();
  first.onCard(question);
  await first.tick();
  await made().tick();
  assert.equal(writes.filter((w) => w.data.line === 'reading').length, 1);
  assert.equal(fake.calls.filter((c) => c.call === 'start').length, 1);
});

test('a reading line that fails to write is tried again, and then given up', async () => {
  let fail = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-read-'));
  const fake = fakeEngine({ recordings: { reader: finished() } });
  const writes = [];
  const world = { now: new Date('2026-11-01T02:00:00.000Z') };
  const seals = recordOnly({
    file: path.join(dir, 'shadow.json'), now: () => world.now, factsOf: async () => FACTS, stampOf: () => ({ models: {}, pack: null, rule: null, exclusions: null }),
    write: async (kind, data) => {
      if (data.line === 'reading' && fail < 1) { fail += 1; throw new Error('no'); }
      writes.push({ kind, data });
    },
    engine: fake, viewOf: async () => VIEW, gate: () => ({ running: 0, pace: 3 }), startReader: async () => fake.start({ work: READER_WORK, lane: 'reader' }),
  });
  seals.onCard(question);
  await seals.tick();
  await seals.tick();
  await seals.tick();
  assert.equal(writes.filter((w) => w.data.line === 'reading').length, 1);
});

// A close match (delegated decisions design, section 7.4): the reader's reading helps the director, and answers nothing.
const OPTIONS = [{ label: 'Keep', says: 'It stays' }, { label: 'Remove', says: 'It goes' }];
const asked = (id, what, over = {}) => ({ question: { data: { id, work: 'w', what, why: 'It matters', options: OPTIONS, recommendation: 'Keep', level: 3, key: `key-${id}`, ...over } }, answer: null });
const cardC = 'q-w-2';
const cardL = 'q-w-1';
const pair = (lead = {}, card = {}, answer = null) => ({ questions: { [cardL]: { ...asked(cardL, 'Keep the banner?', lead), answer }, [cardC]: asked(cardC, 'Should the banner stay?', card) } });

test('a close match joins an open card only with the same options, and both wordings show', async () => {
  assert.deepEqual(closeMatch({ card: cardC, sameAs: cardL, views: pair() }), { join: cardL });
  const views = pair({ options: [{ label: 'Keep', says: 'x' }, { label: 'Hide', says: 'y' }] });
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views }), null);
  const { what } = answerInput(pair().questions[cardL].question.data, 'The banner', { joiners: [{ id: cardC, name: 'The banner', words: 'Should the banner stay?' }] });
  assert.match(what, /Keep the banner\?/);
  assert.match(what, /Should the banner stay\?/);
  const repeated = answerInput(pair().questions[cardL].question.data, 'The banner', { joiners: [{ id: cardC, name: 'The banner', words: 'keep the  banner' }] });
  assert.doesNotMatch(repeated.what, /also asked/);
});

test('a close match on an answered card adds the line and answers nothing', async () => {
  const answer = { label: 'Remove', at: '2026-11-01T01:00:00.000Z' };
  assert.deepEqual(closeMatch({ card: cardC, sameAs: cardL, views: pair({}, {}, answer) }), { line: 'Remove' });
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({}, {}, { ...answer, changed: true }) }), null, 'an answer changed since says nothing');
  const spoken = pair({}, {}, answer);
  spoken.work = { w: { work: { at: '2026-11-01T02:00:00.000Z' } } };
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: spoken }), null, 'nor one the director has moved on from');
  const other = pair({ options: [{ label: 'Remove', says: 'x' }, { label: 'Hide', says: 'y' }] }, {}, answer);
  assert.deepEqual(closeMatch({ card: cardC, sameAs: cardL, views: other }), { line: 'Remove' }, 'the line needs no same options');
});

test('with no reader, or no match, the card stands', async () => {
  const views = pair();
  assert.equal(closeMatch({ card: cardC, sameAs: null, views }), null);
  assert.equal(closeMatch({ card: cardC, sameAs: 'q-w-9', views }), null);
  assert.equal(closeMatch({ card: cardC, sameAs: cardC, views }), null);
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({ work: 'other' }) }), null, 'another piece');
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: {} }), null);
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({}, { key: undefined }) }), null, 'a fixed-word ask has no match');
  const lead = pair();
  lead.questions['q-w-3'] = { ...asked('q-w-3', 'Should the banner stay?'), joins: cardC };
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: lead }), null, 'a card others stand behind stays theirs');

  const matches = [];
  const none = reading({ startReader: async () => ({ ok: false, refused: 'no' }), viewOf: async () => VIEW });
  none.seals.onCard(question);
  await none.seals.tick();
  await none.later(1);
  const read = reading({ onMatch: async (m) => { matches.push(m); } });
  read.seals.onCard(question);
  await read.seals.tick();
  await read.later(1);
  assert.deepEqual(matches, [], 'a reading with no match asks nothing');
});

test('a close match can\'t answer, at any setting', async () => {
  for (const level of [4]) {
    assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({ level }) }), null);
    assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({}, { level }) }), null);
    assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({ level }, {}, { label: 'Keep', at: 't' }) }), null);
  }
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({}, { commands: ['npm ci'] }) }), null, 'a build command signs for itself');
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({}, { blind: true }) }), null, 'a blind card is asked for itself');
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: pair({ blind: true }) }), null);
  const answered = pair();
  answered.questions[cardC].answer = { label: 'Keep', at: 't' };
  assert.equal(closeMatch({ card: cardC, sameAs: cardL, views: answered }), null, 'a card answered first has nothing to join');
  for (const views of [pair(), pair({}, {}, { label: 'Remove', at: 't' })]) assert.equal(Object.hasOwn(closeMatch({ card: cardC, sameAs: cardL, views }), 'answer'), false);
});

test('the seals hand a reader\'s match on, try it again after a failure, and never hold up the reading', async () => {
  const matches = [];
  let fails = 1;
  const t = reading({
    events: finished(JSON.stringify({ ...READING, sameAs: cardL })),
    viewOf: async () => ({ ...VIEW, cards: [{ id: cardL, question: 'Keep the banner?', labels: ['Keep', 'Remove'], status: 'open' }] }),
    onMatch: async (m) => {
      if (fails-- > 0) throw new Error('not yet');
      matches.push(m);
    },
  });
  t.seals.onCard(question);
  await t.seals.tick();
  await t.later(1);
  assert.equal(t.lines()[0].reader, 'read');
  assert.equal(Object.hasOwn(t.lines()[0], 'sameAs'), false, 'the seal\'s line stays as it was');
  await t.later(SEAL_TICK_MS);
  assert.deepEqual(matches, [{ card: question.id, sameAs: cardL }]);
  await t.later(SEAL_TICK_MS);
  assert.equal(matches.length, 1);
});

test('words typed on a blind card count as stepping out, and a blind pick is what the record reads', async () => {
  await withHome(async () => {
    const id = 'q-w-1';
    const asked = makeEvent({ kind: 'question', data: { id, work: 'w', what: 'Which?', why: 'It matters.', options: [{ label: 'Keep', says: 'k' }, { label: 'Remove', says: 'r' }], recommendation: 'Keep', level: 3, blind: true }, now: () => new Date('2026-11-01T01:00:00.000Z') });
    const card = makeEvent({ kind: 'card', data: { question: 'Which?', header: 'First pick', kind: 'blind', level: 3, line: blindLine(id), options: ['Remove', 'Keep'] }, now: () => new Date('2026-11-01T01:00:01.000Z') });
    const said = (label) => makeEvent({ kind: 'card-answer', data: { card: card.id, label }, now: () => new Date('2026-11-01T01:00:02.000Z') });
    const record = (label) => {
      const events = [asked, card, said(label)];
      return historyOf({ events, enrolled: readEnrolled(), views: buildViews(events, readEnrolled()) });
    };
    assert.deepEqual(record('Remove').answer(id), { answer: null, steered: false, blindPick: 'Remove' });
    assert.deepEqual(record('Ask the supplier').answer(id), { answer: null, steered: true, blindPick: null });
  });
});

