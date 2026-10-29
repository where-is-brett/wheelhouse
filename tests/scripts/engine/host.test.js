// tests/scripts/engine/host.test.js
// The continuation host over the fake engine: a stand-in `spawn` whose children are only event emitters, and a
// `write` that keeps what it was given. Nothing real is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { startEngineHost, readCursorFile } from '../../../scripts/engine/host.js';
import { until } from '../../helpers/until.js';

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));
const now = () => new Date('2026-10-29T09:00:00.000Z');

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-engine-host-'));
  return { file: path.join(dir, 'engine', 'cursor.json'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// A spawn whose children end when killed, or when the test ends them.
function stubSpawn() {
  const children = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 4000 + children.length;
    child.killed = false;
    child.kill = (signal = 'SIGTERM') => {
      child.killed = signal;
      setImmediate(() => child.emit('exit', null, signal));
      return true;
    };
    children.push({ command, args, options, child });
    return child;
  };
  return { spawn, children };
}

// Every write, and the writer that keeps them.
function writes() {
  const kept = [];
  const write = async (kind, data) => { kept.push({ kind, data }); };
  return { kept, write };
}

const quick = { restartMs: 5, backstopMs: 60 * 60 * 1000, now };
const keyOf = ({ kind, data }) => (kind === 'ask' ? `ask ${data.id}` : `run ${data.runId} ${data.state}`);

test('a restarted host resumes from the saved cursor and writes nothing twice', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    const asked = [];
    const follow = engine.follow.bind(engine);
    engine.follow = (cursor, options) => { asked.push(cursor); return follow(cursor, options); };
    const { runId } = engine.start({ recording: 'quick-approved' });
    const { kept, write } = writes();
    // The work a run is for, read back from what was written, as the helper reads it from the record.
    const workOf = (id) => kept.find((w) => w.kind === 'run' && w.data.runId === id)?.data ?? null;
    const { spawn } = stubSpawn();
    const first = startEngineHost({ engine, spawn, write, cursorFile: f.file, workOf, ...quick });
    await until(() => kept.some((w) => w.kind === 'ask'), { what: 'the ask to be written' });
    await first.stop();
    const saved = readCursorFile(f.file);
    assert.equal(saved.cursor, '4');
    assert.ok(saved.written.includes('ask:rec-quick-1:approve:1'), saved.written.join(', '));

    // The ask is answered while no host runs; the next host picks up after the saved cursor.
    assert.equal(engine.act(runId, { answer: { ask: 'rec-quick-1:approve:1', choice: 'approve' } }).ok, true);
    const before = kept.length;
    const second = startEngineHost({ engine, spawn, write, cursorFile: f.file, workOf, ...quick });
    await until(() => kept.some((w) => w.kind === 'run' && w.data.state === 'ended'), { what: 'the end of the run' });
    await second.stop();
    assert.equal(asked.find((cursor, i) => i > 0 && cursor !== null), '4');
    // Started, asked and paused before the restart; carried on (the ask resolved) and ended after it.
    assert.deepEqual(kept.map(keyOf), [`run ${runId} started`, 'ask rec-quick-1:approve:1', `run ${runId} paused`, `run ${runId} started`, `run ${runId} ended`]);
    assert.equal(before, 3);
    assert.deepEqual(kept.at(-1).data, { work: 'card-12', lane: 'quick', engine: 'fake', runId, state: 'ended', branch: 'wh/card-12', pr: 12, outcome: 'merged' });
  } finally { f.cleanup(); }
});

test('an ask seen twice is written once, and a host restarted with its cursor lost writes it no more', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    const { runId } = engine.start({ recording: 'quick-blocked' });
    const follow = engine.follow.bind(engine);
    // The stream gives every line twice, as at-least-once delivery may.
    engine.follow = async function* twice(cursor, options) {
      for await (const event of follow(cursor, options)) { yield event; yield event; }
    };
    const { kept, write } = writes();
    const heard = [];
    const { spawn } = stubSpawn();
    const host = startEngineHost({ engine, spawn, write, cursorFile: f.file, onAsk: (ask) => heard.push(ask.id), ...quick });
    await until(() => kept.some((w) => w.kind === 'ask'), { what: 'the ask to be written' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await host.stop();
    const asks = kept.filter((w) => w.kind === 'ask');
    assert.equal(asks.length, 1);
    assert.deepEqual(heard, ['rec-blocked-1:blocked:1']);
    assert.deepEqual(asks[0].data, {
      id: 'rec-blocked-1:blocked:1', runId, work: 'card-13', kind: 'blocked', level: 3,
      options: [{ id: 'stop', label: 'Stop the work' }, { id: 'retry', label: 'Try again' }],
    });

    // The cursor is lost (put back to the start); the ids written are kept beside it, so nothing is written again.
    const saved = readCursorFile(f.file);
    fs.writeFileSync(f.file, JSON.stringify({ cursor: null, written: saved.written }));
    const count = kept.length;
    const again = startEngineHost({ engine, spawn, write, cursorFile: f.file, ...quick });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await again.stop();
    assert.equal(kept.length, count);
  } finally { f.cleanup(); }
});

test('a wake process that ends is started again', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    const { spawn, children } = stubSpawn();
    const host = startEngineHost({ engine, spawn, write: async () => {}, cursorFile: f.file, ...quick });
    await until(() => children.length === 1, { what: 'the wake process' });
    assert.deepEqual(children[0].args, engine.wakeCommand().args);
    children[0].child.emit('exit', 1, null);
    await until(() => children.length === 2, { what: 'the wake process to be started again' });
    const listed = host.processes();
    assert.deepEqual(listed.map((p) => p.pid), [children[1].child.pid]);
    assert.equal(listed[0].startedAt, now().toISOString());
    assert.match(listed[0].name, /continuation/);
    await host.stop();
  } finally { f.cleanup(); }
});

test('the backstop writes an ask the stream missed', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    const { runId } = engine.start({ recording: 'quick-approved' });
    // A stream that delivers nothing and waits until it is stopped.
    engine.follow = async function* silent(_cursor, { signal } = {}) {
      await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
    };
    const { kept, write } = writes();
    const host = startEngineHost({ engine, spawn: stubSpawn().spawn, write, cursorFile: f.file, workOf: () => ({ work: 'card-12', lane: 'quick' }), ...quick, backstopMs: 10 });
    await until(() => kept.some((w) => w.kind === 'ask'), { what: 'the backstop to write the ask' });
    await host.stop();
    assert.deepEqual(kept.filter((w) => w.kind === 'ask').map((w) => w.data.id), ['rec-quick-1:approve:1']);
    assert.equal(kept.find((w) => w.kind === 'ask').data.runId, runId);
  } finally { f.cleanup(); }
});

test('a stream silent for the stuck limit is started again', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    let follows = 0;
    engine.follow = async function* silent(_cursor, { signal } = {}) {
      follows += 1;
      await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
    };
    const host = startEngineHost({ engine, spawn: stubSpawn().spawn, write: async () => {}, cursorFile: f.file, ...quick, stuckMs: 20 });
    await until(() => follows >= 2, { what: 'the stream to be started again' });
    await host.stop();
  } finally { f.cleanup(); }
});

test('the host stops both processes on stop()', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    let aborted = false;
    engine.follow = async function* waiting(_cursor, { signal } = {}) {
      await new Promise((resolve) => signal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    };
    const { spawn, children } = stubSpawn();
    const host = startEngineHost({ engine, spawn, write: async () => {}, cursorFile: f.file, ...quick });
    await until(() => children.length === 1, { what: 'the wake process' });
    await host.stop();
    assert.equal(children[0].child.killed, 'SIGTERM');
    assert.equal(aborted, true);
    assert.deepEqual(host.processes(), []);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(children.length, 1, 'nothing is started after stop');
  } finally { f.cleanup(); }
});

test('while held, the wake process is ended and not started; once the hold is lifted it starts again', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    let held = false;
    const { spawn, children } = stubSpawn();
    const host = startEngineHost({ engine, spawn, write: async () => {}, cursorFile: f.file, held: () => held, ...quick });
    await until(() => children.length === 1, { what: 'the wake process' });
    held = true;
    host.check();
    assert.equal(children[0].child.killed, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(children.length, 1, 'no wake while held');
    held = false;
    await until(() => children.length === 2, { what: 'the wake process once the hold is lifted' });
    await host.stop();
    assert.deepEqual(engine.calls.filter((c) => c.call === 'start'), [], 'nothing is started');
  } finally { f.cleanup(); }
});

test('a host without the wake keeps only the stream', async () => {
  const f = folder();
  try {
    const engine = fakeEngine({ recordings });
    const { spawn, children } = stubSpawn();
    const host = startEngineHost({ engine, spawn, write: async () => {}, cursorFile: f.file, wake: false, ...quick });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await host.stop();
    assert.equal(children.length, 0);
  } finally { f.cleanup(); }
});
