// tests/scripts/host/helper-retire.test.js
// The helper's running record (~/.wheelhouse/helper.json), /health's pid, an update's retire, and the previous release's
// client calls still being answered. No host tool and no network: the helper's runs go through a guard, and its
// adapter is a stand-in.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { startRealHelper } from '../../../scripts/host/helper-main.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { readHelperRecord, removeHelperRecord, writeHelperRecord } from '../../../scripts/host/helper-record.js';
import { helperRecordFile } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { until } from '../../helpers/until.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const PLUGIN = JSON.parse(fs.readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
const unix = process.platform !== 'win32';
const UPDATING = 'Wheelhouse is updating; try again in a minute';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeAdapter(overrides = {}) {
  return {
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: 'a'.repeat(40), mergeable: 'mergeable', state: 'open', body: '' }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async () => ({ merged: true }),
    openPr: async () => ({ number: 7, url: 'https://example.invalid/pr/7' }),
    updatePr: async () => ({ number: 7 }),
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
    ...overrides,
  };
}

async function withHelper(adapter, fn, extra = {}) {
  const helper = await startHelper({
    run: hostGuard,
    address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => adapter, envFor: async () => ({}), ...extra,
  });
  try {
    return await fn(helperClient({ address: helper.address }), helper);
  } finally {
    await helper.close();
  }
}

function inHome(fn) {
  const home = shortHome();
  return as(home, () => fn(home));
}

// ---- The running record ----

test('the record is written once the helper listens, and is gone after it closes', { skip: !unix && 'socket files exist only on macOS and Linux' }, () => inHome(async (home) => {
  const address = testAddress(home);
  const helper = await startRealHelper({ address, keepRecord: true, startTime: async (pid) => `start of ${pid}` });
  const record = readHelperRecord();
  assert.deepEqual(record, {
    pid: process.pid, startTime: `start of ${process.pid}`, version: PLUGIN.version,
    root: path.resolve(import.meta.dirname, '..', '..', '..'), address,
  });
  assert.equal(helperRecordFile(), path.join(home, 'helper.json'));
  assert.equal(fs.statSync(helperRecordFile()).mode & 0o077, 0, 'only the user can read it');
  await helper.close();
  assert.equal(fs.existsSync(helperRecordFile()), false);
}));

test('the record is gone after a retire closes the helper by its own stop', () => inHome(async (home) => {
  let stopped = null;
  const stoppedOnce = new Promise((resolve) => { stopped = resolve; });
  const release = openJournal('p').lock();
  assert.equal(typeof release, 'function', 'the update lock is taken');
  const helper = await startRealHelper({ address: testAddress(home), keepRecord: true, startTime: async () => 'now', onStop: (close) => close().then(stopped) });
  assert.equal((await helperClient({ address: helper.address }).retire({ forUpdate: true })).retired, true);
  await stoppedOnce;
  release();
  assert.equal(fs.existsSync(helperRecordFile()), false);
}));

test('no record is kept unless asked, so a test helper writes none', () => inHome(async (home) => {
  const helper = await startRealHelper({ address: testAddress(home) });
  try { assert.equal(readHelperRecord(), null); } finally { await helper.close(); }
}));

test('a helper whose start time cannot be had still runs, and keeps no record rather than a wrong one', () => inHome(async (home) => {
  const helper = await startRealHelper({ address: testAddress(home), keepRecord: true, startTime: async () => { throw new Error('no ps'); } });
  try { assert.equal(readHelperRecord(), null, 'no record at all is better than a wrong one'); } finally { await helper.close(); }
}));

test('a second helper that cannot bind leaves the first one\'s record alone', { skip: !unix && 'socket files exist only on macOS and Linux' }, () => inHome(async (home) => {
  const address = testAddress(home);
  const first = await startRealHelper({ address, keepRecord: true, startTime: async () => 'first' });
  try {
    await assert.rejects(startRealHelper({ address, keepRecord: true, startTime: async () => 'second' }));
    assert.equal(readHelperRecord().startTime, 'first');
  } finally { await first.close(); }
}));

test('a record is removed only by the process it names', () => inHome(() => {
  writeHelperRecord({ pid: 424242, startTime: 'then', version: '0.2.6', root: '/x', address: '/y' });
  assert.equal(removeHelperRecord(process.pid), false);
  assert.equal(readHelperRecord().pid, 424242);
  assert.equal(removeHelperRecord(424242), true);
  assert.equal(readHelperRecord(), null);
}));

test('a record that is not a record, or is a link, reads as none', { skip: !unix && 'links need rights on Windows' }, () => inHome((home) => {
  fs.writeFileSync(helperRecordFile(), '{not json');
  assert.equal(readHelperRecord(), null);
  fs.writeFileSync(helperRecordFile(), JSON.stringify({ pid: 'x' }));
  assert.equal(readHelperRecord(), null);
  fs.rmSync(helperRecordFile());
  const elsewhere = path.join(home, 'elsewhere.json');
  fs.writeFileSync(elsewhere, JSON.stringify({ pid: 5, startTime: null, version: null, root: '/x', address: '/y' }));
  fs.symlinkSync(elsewhere, helperRecordFile());
  assert.equal(readHelperRecord(), null);
  writeHelperRecord({ pid: 7, startTime: 't', version: null, root: '/x', address: '/y' });
  assert.equal(readHelperRecord().pid, 7, 'a write replaces the link, never follows it');
  assert.equal(JSON.parse(fs.readFileSync(elsewhere, 'utf8')).pid, 5);
}));

// ---- /health ----

test('/health gives the record\'s pid', () => inHome(async () => {
  await withHelper(fakeAdapter(), async (client) => {
    assert.deepEqual(await client.health(), { ok: true, pid: process.pid, version: PLUGIN.version });
  });
}));

// ---- Retire for an update ----

test('retire for an update on a busy helper answers at once, refuses new work, finishes the running request, then closes', () => inHome(async () => {
  const hold = { entered: false, release: null };
  const gate = new Promise((resolve) => { hold.release = resolve; });
  const adapter = fakeAdapter({ prState: async () => { hold.entered = true; await gate; return { headSha: 'b'.repeat(40), state: 'open' }; } });
  let stopCount = 0;
  await withHelper(adapter, async (client) => {
    const pending = client.prState({ project: 'o__p', number: 7 });
    await until(() => hold.entered, { what: 'the request to reach the adapter' });
    assert.deepEqual(await client.retire({ forUpdate: true }), { ok: true, retired: true });
    const refused = await client.openPr({ project: 'o__p', head: 'feature', title: 't', body: 'b', session: 's' });
    assert.deepEqual(refused, { ok: false, refused: UPDATING });
    assert.equal((await client.health()).ok, true, 'health still answers');
    assert.deepEqual(await client.retire({ forUpdate: true }), { ok: true, retired: true }, 'asked again, the same answer');
    await sleep(400);
    assert.equal(stopCount, 0, 'it does not close while the request is running');
    hold.release();
    const answer = await pending;
    assert.equal(answer.ok, true, 'the running request was answered');
    await until(() => stopCount === 1, { what: 'the helper to close' });
    await sleep(300);
    assert.equal(stopCount, 1, 'it closes once');
  }, { onStop: () => { stopCount += 1; }, updateHeld: () => true });
}));

test('retire for an update on an idle helper closes it once its answer has gone', () => inHome(async () => {
  let stops = 0;
  await withHelper(fakeAdapter(), async (client) => {
    assert.deepEqual(await client.retire({ forUpdate: true }), { ok: true, retired: true });
    await until(() => stops === 1, { what: 'the helper to close' });
  }, { onStop: () => { stops += 1; }, updateHeld: () => true });
}));

test('retire without forUpdate is as before: only the boolean true counts', () => inHome(async () => {
  const hold = { entered: false };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const adapter = fakeAdapter({ prState: async () => { hold.entered = true; await gate; return { state: 'open' }; } });
  let stops = 0;
  await withHelper(adapter, async (client) => {
    const pending = client.prState({ project: 'o__p', number: 7 });
    await until(() => hold.entered, { what: 'the request to reach the adapter' });
    // A string is not true: this is the ordinary retire, which stops at once (a request in flight is not what makes it busy).
    assert.deepEqual(await client.retire({ forUpdate: 'true' }), { ok: true, retired: true });
    const later = await client.openPr({ project: 'o__p', head: 'f', title: 't', body: 'b', session: 's' });
    assert.match(later.refused, /making way for a newer one; ask again/);
    release();
    await pending;
    await until(() => stops === 1, { what: 'the helper to close' });
  }, { onStop: () => { stops += 1; } });
}));

// ---- One release back ----

test('the previous release\'s client calls are all answered ok', () => inHome(async () => {
  const calls = JSON.parse(fs.readFileSync(new URL('../../fixtures/helper-client-v0.2.6-calls.json', import.meta.url), 'utf8'));
  writeProject('o__p', { folder: os.tmpdir(), remoteUrl: null, host: 'local', repo: 'local/o__p', connection: { mode: 'none' } });
  await openTestRecord({ project: 'o__p' });
  assert.ok(calls.length >= 6);
  await withHelper(fakeAdapter(), async (_client, helper) => {
    for (const { method, path: route, body } of calls) {
      const sent = await new Promise((resolve) => {
        const text = body === undefined ? '' : JSON.stringify(JSON.parse(JSON.stringify(body).replaceAll('PROJECT', 'o__p')));
        const req = http.request({ socketPath: helper.address, agent: false, method, path: route, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } }, (res) => {
          let out = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (out += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
        });
        req.end(text);
      });
      assert.equal(sent.status, 200, `${method} ${route}`);
      assert.equal(sent.body.ok, true, `${method} ${route}: ${JSON.stringify(sent.body)}`);
    }
  });
}));

// ---- Who may retire the helper for an update, how long it waits, and what goes through ----

test('retire for an update is refused when no update job holds the lock, and nothing is retired', () => inHome(async () => {
  let stops = 0;
  await withHelper(fakeAdapter(), async (client) => {
    const asked = await client.retire({ forUpdate: true });
    assert.equal(asked.ok, false);
    assert.match(asked.refused, /no update is under way/);
    const later = await client.openPr({ project: 'o__p', head: 'f', title: 't', body: 'b', session: 's' });
    assert.notEqual(later.refused, UPDATING);
    await sleep(300);
    assert.equal(stops, 0);
  }, { onStop: () => { stops += 1; } });
}));

test('a lock whose process has gone, or that cannot be read, does not let the retire through', () => inHome(async (home) => {
  await withHelper(fakeAdapter(), async (client) => {
    assert.equal((await client.retire({ forUpdate: true })).ok, false, 'no lock');
    fs.mkdirSync(path.join(home, 'update'), { recursive: true });
    fs.writeFileSync(path.join(home, 'update', 'lock'), JSON.stringify({ pid: 2 ** 22 + 12345, startTime: 1, project: 'p' }));
    assert.equal((await client.retire({ forUpdate: true })).ok, false, 'a dead holder');
    fs.writeFileSync(path.join(home, 'update', 'lock'), 'not json');
    assert.equal((await client.retire({ forUpdate: true })).ok, false, 'an unreadable lock');
  }, { onStop: () => {} });
}));

test('a helper that has not closed within the bound serves normally again', () => inHome(async () => {
  const hold = { entered: false };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const adapter = fakeAdapter({ prState: async () => { hold.entered = true; await gate; return { state: 'open' }; } });
  let stops = 0;
  const open = { project: 'o__p', head: 'f', title: 't', body: 'b', session: 's' };
  await withHelper(adapter, async (client) => {
    const pending = client.prState({ project: 'o__p', number: 7 });
    await until(() => hold.entered, { what: 'the request to reach the adapter' });
    assert.equal((await client.retire({ forUpdate: true })).retired, true);
    assert.equal((await client.openPr(open)).refused, UPDATING);
    await until(async () => (await client.openPr(open)).refused !== UPDATING, { what: 'the bound to lift the refusal' });
    release();
    await pending;
    await sleep(400);
    assert.equal(stops, 0, 'it did not close');
  }, { onStop: () => { stops += 1; }, updateHeld: () => true, updateBoundMs: 300 });
}));

test('All stop, the desk\'s stopping acts and the confirm window go through while the helper makes way for an update', () => inHome(async () => {
  writeProject('o__p', { folder: os.tmpdir(), remoteUrl: null, host: 'local', repo: 'local/o__p', connection: { mode: 'none' } });
  await openTestRecord({ project: 'o__p' });
  const hold = { entered: false };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const adapter = fakeAdapter({ prState: async () => { hold.entered = true; await gate; return { state: 'open' }; } });
  const act = (client, command) => client.desk.act({ v: 'desk/1', project: 'o__p', command, args: {} });
  await withHelper(adapter, async (client) => {
    const pending = client.prState({ project: 'o__p', number: 7 });
    await until(() => hold.entered, { what: 'the request to reach the adapter' });
    assert.equal((await client.retire({ forUpdate: true })).retired, true);
    assert.deepEqual(await client.stop(), { ok: true }, '/stop/set');
    assert.equal((await client.desk.act({ v: 'desk/1', project: 'o__p', command: 'all-stop', args: { by: 'mod' } })).ok, true, 'All stop from the desk');
    for (const command of ['lift-all-stop', 'end-goal', 'narrow-goal']) {
      assert.notEqual((await act(client, command)).refused, UPDATING, command);
    }
    assert.equal((await act(client, 'answer')).refused, UPDATING, 'other acts wait');
    assert.notEqual((await client.confirm({ project: 'o__p', card: 'none', hash: 'a'.repeat(64) })).refused, UPDATING, '/confirm');
    release();
    await pending;
  }, { onStop: () => {}, updateHeld: () => true });
}));

test('a retire whose caller has dropped still stops the helper', () => inHome(async () => {
  let stops = 0;
  await withHelper(fakeAdapter(), async (_client, helper) => {
    const req = http.request({ socketPath: helper.address, agent: false, method: 'POST', path: '/helper/retire', headers: { 'content-type': 'application/json', 'content-length': 2 } });
    req.on('error', () => {});
    req.on('finish', () => req.destroy());
    req.end('{}');
    await until(() => stops >= 1, { what: 'the helper to stop' });
    await sleep(200);
    assert.equal(stops, 1);
  }, { onStop: () => { stops += 1; } });
}));
