// tests/scripts/update/job.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openJournal, JOURNAL_SCHEMA } from '../../../scripts/update/journal.js';
import { runJob } from '../../../scripts/update/job.js';

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-uo-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
}

const names = ['checks', 'change', 'merged', 'idle', 'backup', 'catalogue', 'installs', 'verify', 'finish', 'done'];

function steps(calls, over = {}) {
  return names.map((name) => ({
    name,
    run: over[name] ?? (async () => { calls.push(name); }),
  }));
}

test('a job runs the steps in order and marks each done', () => withHome(async () => {
  const calls = [];
  const journal = openJournal('p');
  const out = await runJob({ project: 'p', target: 'v0.2.7', steps: steps(calls), journal });
  assert.equal(out.ok, true);
  assert.deepEqual(calls, names);
  assert.equal(journal.read().steps.done.state, 'done');
}));

test('a job stopped after catalogue carries on at installs and never runs catalogue twice', () => withHome(async () => {
  const calls = [];
  const journal = openJournal('p');
  const fail = async () => { calls.push('installs'); return { ok: false, line: 'The network dropped.' }; };
  const first = await runJob({ project: 'p', target: 'v0.2.7', steps: steps(calls, { installs: fail }), journal });
  assert.deepEqual({ ok: first.ok, line: first.line, step: first.step }, { ok: false, line: 'The network dropped.', step: 'installs' });
  assert.equal(journal.read().steps.installs.state, 'failed');
  const second = await runJob({ project: 'p', target: 'v0.2.7', steps: steps(calls), journal: openJournal('p') });
  assert.equal(second.ok, true);
  assert.equal(calls.filter((c) => c === 'catalogue').length, 1);
  assert.equal(calls.filter((c) => c === 'checks').length, 1);
  assert.equal(calls.filter((c) => c === 'installs').length, 2);
}));

test('a step that throws fails the job with a line, and stops there', () => withHome(async () => {
  const calls = [];
  const out = await runJob({
    project: 'p', target: 'v1', journal: openJournal('p'),
    steps: steps(calls, { merged: async () => { throw new Error('boom'); } }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.step, 'merged');
  assert.match(out.line, /boom/);
  assert.deepEqual(calls, ['checks', 'change']);
}));

test('a step left running by a crash runs again', () => withHome(async () => {
  const calls = [];
  const journal = openJournal('p');
  journal.mark('checks', 'running');
  await runJob({ project: 'p', target: 'v1', steps: steps(calls), journal });
  assert.equal(calls[0], 'checks');
}));

test('a step receives the target and what earlier steps recorded', () => withHome(async () => {
  let seen;
  const list = [
    { name: 'checks', run: async () => ({ data: { tag: 'v9' } }) },
    { name: 'change', run: async (ctx) => { seen = { target: ctx.target, checks: ctx.data.checks }; } },
  ];
  await runJob({ project: 'p', target: 'v9', steps: list, journal: openJournal('p') });
  assert.deepEqual(seen, { target: 'v9', checks: { tag: 'v9' } });
}));

test('a job whose lock is held says an update is under way and runs nothing', () => withHome(async () => {
  const calls = [];
  const held = openJournal('other').lock();
  const out = await runJob({ project: 'p', target: 'v1', steps: steps(calls), journal: openJournal('p') });
  assert.equal(out.ok, false);
  assert.match(out.line, /under way/);
  assert.deepEqual(calls, []);
  held();
}));

test('a job releases its lock when it ends', () => withHome(async () => {
  await runJob({ project: 'p', target: 'v1', steps: steps([]), journal: openJournal('p') });
  const again = openJournal('q').lock();
  assert.equal(typeof again, 'function');
  again();
}));

test('a journal from a newer version is not run and not rewritten', () => withHome(async () => {
  const journal = openJournal('p');
  fs.mkdirSync(journal.folder, { recursive: true });
  const text = JSON.stringify({ schema: JOURNAL_SCHEMA + 1, steps: {} });
  fs.writeFileSync(path.join(journal.folder, 'journal.json'), text);
  const calls = [];
  const out = await runJob({ project: 'p', target: 'v1', steps: steps(calls), journal });
  assert.equal(out.ok, false);
  assert.match(out.line, /newer Wheelhouse/);
  assert.deepEqual(calls, []);
  assert.equal(fs.readFileSync(path.join(journal.folder, 'journal.json'), 'utf8'), text);
}));

test('a step that waits stays running with its line, is asked again later, and a closed change still fails', () => withHome(async () => {
  const journal = openJournal('p');
  let ready = false;
  const waits = [{
    name: 'merged',
    run: async () => (ready ? { data: { merged: true } } : { ok: false, waiting: true, line: 'Waiting for the change naming v0.2.7 to be merged.' }),
  }];
  const first = await runJob({ project: 'p', target: 'v0.2.7', steps: waits, journal });
  assert.deepEqual([first.ok, first.waiting, first.step], [false, true, 'merged']);
  assert.deepEqual([journal.read().steps.merged.state, journal.read().steps.merged.data.line], ['running', 'Waiting for the change naming v0.2.7 to be merged.']);
  ready = true;
  const second = await runJob({ project: 'p', target: 'v0.2.7', steps: waits, journal });
  assert.equal(second.ok, true);
  assert.equal(journal.read().steps.merged.state, 'done');
  const closed = await runJob({ project: 'q', target: 'v0.2.7', steps: [{ name: 'merged', run: async () => ({ ok: false, line: 'The change was closed.' }) }], journal: openJournal('q') });
  assert.equal(closed.waiting, undefined);
  assert.equal(openJournal('q').read().steps.merged.state, 'failed');
}));
