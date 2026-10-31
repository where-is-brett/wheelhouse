// tests/scripts/host/helper-desk.test.js
// The desk's three routes on the helper's socket (spec 5.4): /desk/read, /desk/act and /desk/watch,
// each with `v: 'desk/1'`, placed by `project` or `cwd`, for a project on a code host and a Lean one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { registerLean } from '../../../scripts/lean/project.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { eventPath, listEvents, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { hashOf, cardTextOf } from '../../../scripts/mod/status.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { CARD } from '../desk/fixture.js';
import { safekeepingFile } from '../../../scripts/safekeeping/readings.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const T0 = new Date('2026-10-29T01:00:00.000Z');
const at = (n) => () => new Date(T0.getTime() + n * 1000);
const P = 'o__p';
const v = 'desk/1';

async function project() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = path.join(home, 'repo');
  await as(home, async () => {
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeProject(P, { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: P, remoteUrl: remote.url });
  });
  return { home, folder, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); } };
}

function keep(project, event) {
  const file = path.join(stateDir(project), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

const cardEvent = () => makeEvent({ kind: 'card', data: CARD, now: at(1) });
const approve = () => makeEvent({ kind: 'action', data: { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: 'a'.repeat(64), shownFirst: false, question: CARD.question, label: 'Approve' }, now: at(2) });

async function withHelper(fn) {
  const helper = await startHelper({ run: hostGuard, address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}), now: at(10) });
  try {
    return await fn(helperClient({ address: helper.address }));
  } finally {
    await helper.close();
  }
}

const inProject = (fn) => async () => {
  const p = await project();
  try {
    await as(p.home, () => withHelper((client) => fn(client, p)));
  } finally { p.cleanup(); }
};

test('desk read returns the waiting view', inProject(async (client) => {
  const card = cardEvent();
  keep(P, card);
  const got = await client.desk.read({ v, project: P, view: 'waiting' });
  assert.equal(got.ok, true, got.refused);
  assert.equal(got.v, v);
  assert.deepEqual(got.data.numbered.map((i) => i.card), [card.id]);
  assert.match(got.lines[0], /^1\. /);
  assert.equal((await client.desk.read({ v: 'desk/2', project: P, view: 'waiting' })).ok, false);
}));

test('desk act answer records a signed click', inProject(async (client) => {
  const card = cardEvent();
  keep(P, card);
  const record = approve();
  const got = await client.desk.act({ v, project: P, command: 'answer', args: { card: card.id, option: 'Approve', hash: hashOf(cardTextOf(CARD)) }, evidence: { form: 'signed', records: [record] } });
  assert.equal(got.ok, true, got.refused);
  const events = listEvents(stateDir(P), { report: () => {} });
  assert.equal(events.filter((e) => e.id === record.id).length, 1);
  assert.equal(events.filter((e) => e.kind === 'card-answer' && e.data.label === 'Approve').length, 1);
}));

test('desk act with no evidence is refused and writes nothing', inProject(async (client) => {
  const card = cardEvent();
  keep(P, card);
  const before = listEvents(stateDir(P), { report: () => {} }).length;
  const got = await client.desk.act({ v, project: P, command: 'answer', args: { card: card.id, option: 'Approve', hash: hashOf(cardTextOf(CARD)) } });
  assert.equal(got.ok, false);
  const madeUp = await client.desk.act({ v, project: P, command: 'answer', args: { card: card.id, option: 'Approve' }, evidence: { form: 'client', client: 'never-paired', at: T0.toISOString(), sig: 'AAAA' } });
  assert.equal(madeUp.ok, false);
  assert.equal(listEvents(stateDir(P), { report: () => {} }).length, before);
}));

test('desk watch returns card-added for a new card, then nothing for the same cursor', inProject(async (client) => {
  const first = await client.desk.watch({ v, project: P, cursor: null });
  assert.equal(first.ok, true, first.refused);
  const card = cardEvent();
  keep(P, card);
  const second = await client.desk.watch({ v, project: P, cursor: first.cursor });
  assert.deepEqual(second.events.filter((e) => e.type.startsWith('card')).map((e) => [e.type, e.card]), [['card-added', card.id]]);
  const third = await client.desk.watch({ v, project: P, cursor: second.cursor });
  assert.deepEqual(third.events, []);
}));

test('under STOP, desk read answers and desk act answer is refused', inProject(async (client) => {
  const card = cardEvent();
  keep(P, card);
  setStop({ by: 'prompt', now: at(3) });
  assert.equal((await client.desk.read({ v, project: P, view: 'waiting' })).ok, true);
  const got = await client.desk.act({ v, project: P, command: 'answer', args: { card: card.id, option: 'Approve', hash: 'b'.repeat(64) }, evidence: { form: 'window' } });
  assert.equal(got.ok, false);
  assert.equal(got.refused, 'All stop is on');
  assert.equal((await client.desk.act({ v, project: P, command: 'not-now', args: { card: card.id } })).refused, 'All stop is on');
  assert.equal((await client.desk.act({ v, project: P, command: 'all-stop', args: { by: 'mod' } })).ok, true);
}));

test('a cwd inside the project is placed', inProject(async (client, p) => {
  keep(P, cardEvent());
  const inside = path.join(p.folder, 'src');
  fs.mkdirSync(inside, { recursive: true });
  const got = await client.desk.read({ v, cwd: inside, view: 'waiting' });
  assert.equal(got.ok, true, got.refused);
  assert.equal(got.data.numbered.length, 1);
}));

test('a Lean project is served', async () => {
  const home = shortHome();
  const folder = path.join(home, 'shop');
  try {
    await as(home, async () => {
      fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
      fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      registerLean({ project: 'shop', folder, now: () => T0 });
      const own = makeSigningKey();
      enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
      await withHelper(async (client) => {
        const got = await client.desk.read({ v, project: 'shop', view: 'waiting' });
        assert.equal(got.ok, true, got.refused);
        const asked = await client.desk.act({ v, project: 'shop', command: 'request', args: { words: 'Add a dark mode', via: 'app' } });
        assert.equal(asked.ok, true, asked.refused);
        assert.equal(listEvents(stateDir('shop'), { report: () => {} }).filter((e) => e.kind === 'request').length, 1);
      });
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('under STOP, a declared form doesn\'t let an act that needs no evidence write', inProject(async (client) => {
  setStop({ by: 'prompt', now: at(3) });
  const before = listEvents(stateDir(P), { report: () => {} }).length;
  const request = await client.desk.act({ v, project: P, command: 'request', args: { words: 'x' }, evidence: { form: 'signed' } });
  assert.equal(request.refused, 'All stop is on');
  const pair = await client.desk.act({ v, project: P, command: 'pair', args: { client: { id: 'app', name: 'App', publicKey: 'AAAA' } }, evidence: { form: 'signed' } });
  assert.equal(pair.refused, 'All stop is on');
  assert.equal(listEvents(stateDir(P), { report: () => {} }).length, before);
}));

// A press on the Safekeeping row, signed as the bridge signs it.
const safekeepingPress = (action, n = 5) => makeEvent({ kind: 'action', data: { action: 'safekeeping', press: action, question: 'Safekeeping', label: action }, now: at(n) });
const pressRow = (client, action, event = safekeepingPress(action)) => client.desk.act({ v, project: P, command: 'safekeeping', args: { action }, evidence: { form: 'signed', records: [{ event }] } });
function offer(project, actions, readings) {
  fs.writeFileSync(safekeepingFile(project), `${JSON.stringify({ status: { place: 'github', level: 'watch', line: 'x', detail: 'y', actions: actions.map((action) => ({ action, label: action })) }, readings })}\n`);
}

test('a press the status offers is recorded and done, and one it doesn\'t offer does nothing', inProject(async (client) => {
  offer(P, ['ask-save'], null);
  const refused = await pressRow(client, 'keep-online');
  assert.equal(refused.ok, false);
  assert.match(refused.refused, /isn't offered/);
  offer(P, ['ask-save'], null);
  const done = await pressRow(client, 'ask-save', safekeepingPress('ask-save', 6));
  assert.equal(done.ok, true);
  assert.match(done.submit[0], /^Wheelhouse pane: /);
  assert.equal(listEvents(stateDir(P)).filter((e) => e.data?.action === 'safekeeping').length, 2, 'each press is on the record');
}));

test('a press needs the signed press it names, and All stop holds it', inProject(async (client) => {
  offer(P, ['ask-save'], null);
  const other = await pressRow(client, 'ask-save', safekeepingPress('keep-online'));
  assert.equal(other.ok, false);
  assert.equal(listEvents(stateDir(P)).filter((e) => e.data?.action === 'safekeeping').length, 0);
  setStop({ by: 'prompt', now: at(7) });
  const held = await pressRow(client, 'ask-save');
  assert.equal(held.ok, false);
  assert.equal(held.submit, undefined);
}));
