// tests/scripts/delegation/record-only.test.js
// The seals beside the card router: a card waits for nothing, each card gets one line, and a failure here says nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordOnly, cardContext } from '../../../scripts/delegation/record-only.js';
import { SEAL_TICK_MS, FACT_TRIES, SEAL_TRIES } from '../../../scripts/delegation/limits.js';

const FACTS = { readable: true, head: 'a'.repeat(40), paths: [], lines: 0, testsChanged: false, depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false };
const question = { id: 'q-w-1', kind: 'question', work: 'w', runId: 'r', level: 3 };

function setUp({ factsOf = async () => FACTS, write, stop = false, contextOf, file } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seal-'));
  const writes = [];
  const world = { now: new Date('2026-11-01T02:00:00.000Z'), stop };
  const made = () => recordOnly({
    file: file ?? path.join(dir, 'engine', 'shadow.json'),
    write: write ?? (async (kind, data) => { writes.push({ kind, data }); }),
    stopped: () => world.stop,
    now: () => world.now,
    factsOf,
    contextOf,
    stampOf: () => ({ models: {}, pack: null, rule: null, exclusions: null }),
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
