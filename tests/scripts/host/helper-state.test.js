// tests/scripts/host/helper-state.test.js
// State and the lock through the helper (Ruling 19): the helper alone holds the
// connection's key, so these work against a private repository (a stand-in
// host that refuses any request without the key) from a computer whose own
// code has no key at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startHelper, PUSH_REFUSALS } from '../../../scripts/host/helper.js';
import { startRealHelper } from '../../../scripts/host/helper-main.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject, readProject } from '../../../scripts/lib/projects.js';
import { computerId, stateDir } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, confirmationFor } from '../../../scripts/state/events.js';
import { keep, taken } from '../../../scripts/hooks/pending.js';
import { makeSigningKey, enrol, sign } from '../../../scripts/state/signing.js';
import { makeBareRemote, LOOPBACK_HTTP } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { startHttpHost } from '../../helpers/http-host.js';
import { hostKeyEnv } from '../../helpers/host-key.js';
import { decide as promptRecord } from '../../../scripts/hooks/prompt-record.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { startRun } from '../../../scripts/setup/journal.js';
import { noteAsked, keepClick, keepAnswer, copySetupRecords } from '../../../scripts/setup/clicks.js';
import { questionsStep } from '../../../scripts/setup/questions.js';
import { rulesStep } from '../../../scripts/setup/rules.js';
import { REAL_USERS } from '../../../scripts/setup/host.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { listHash } from '../../../scripts/lib/setup-writes.js';
import { listEvents } from '../../../scripts/state/events.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';

// These tests run the real helper and check what reaches it, however loaded the computer is.
waitLongerOnTheHelper();

const PROJECT = 'o__p';
const TOKEN = 'ghs_STANDINTOKEN0123456789abcdef';
const HEADER_VALUE = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`;
const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const fakeAdapter = () => ({
  defaultBranch: async () => 'main',
  prState: async () => ({ state: 'closed' }),
  ciState: async () => ({ state: 'pending' }),
  merge: async () => ({ merged: false }),
  openPr: async () => ({ number: 1 }),
  updatePr: async () => ({ number: 1 }),
  issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
});

const record = (remoteUrl, mode = 'narrow') => ({
  folder: path.join(shortHome(), 'work'),
  remoteUrl,
  host: 'github',
  repo: 'o/p',
  connection: { host: 'github', mode, project: 'o/p' },
});

// A private repository: a bare one behind the stand-in host.
async function privateRepo() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const host = await startHttpHost({ root: remote.root, token: TOKEN });
  return {
    remote, host, url: `${host.url}/o/p.git`,
    cleanup: async () => { await host.close(); remote.cleanup(); },
  };
}

// One computer: its own home, an enrolled signing key, a project record, and a
// helper whose connection is the key. (In this process, so one call at a time.)
async function computer(repo, { adapter = fakeAdapter(), envFor } = {}) {
  const home = shortHome();
  const entry = await as(home, async () => {
    const made = makeSigningKey();
    const e = { ...made, enrolledAt: '2026-10-18T00:00:00.000Z' };
    enrol(e);
    writeProject(PROJECT, record(repo.url));
    return e;
  });
  let tick = 0; // each call to now() is a second later, so a touch is never the same as the take before it
  const helper = await as(home, () => startHelper({
    address: testAddress(home),
    adapterFor: async () => adapter,
    envFor: envFor ?? (async () => ({ mode: 'narrow', env: hostKeyEnv(repo.host.url, TOKEN) })),
    now: () => new Date(T0.getTime() + 1000 * (tick += 1)),
  }));
  return {
    home, entry, helper,
    client: helperClient({ address: helper.address }),
    as: (fn) => as(home, fn),
    // Closed inside the home: work still queued then would otherwise reach the real one.
    close: async () => { await as(home, () => helper.close()); fs.rmSync(home, { recursive: true, force: true }); },
  };
}

const remoteFiles = async (remoteUrl, branch, folder = '.') => (await run('git', ['ls-tree', '-r', '--name-only', branch, folder], { cwd: remoteUrl }))
  .stdout.split('\n').filter(Boolean);

test('narrow on a private repository: clone, write, sync and the lock all work through the helper', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    const answers = [];
    const ask = async (p) => { const a = await p; answers.push(a); return a; };
    await c.as(async () => {
      assert.deepEqual(await ask(c.client.state.clone({ project: PROJECT })), { ok: true });
      const wrote = await ask(c.client.state.write({ project: PROJECT, kind: 'ruling', data: { words: 'Prices show two decimal places', reason: 'the director asked', scope: 'project' } }));
      assert.equal(wrote.ok, true);
      assert.equal(wrote.pushed, true);
      assert.match(wrote.id, /^[0-9a-f-]{36}$/);
      assert.deepEqual(await ask(c.client.lock.take({ project: PROJECT })), { ok: true, result: { taken: true, counter: 1 } });
      assert.deepEqual(await ask(c.client.state.sync({ project: PROJECT })), { ok: true, pulled: true, unpushed: 0 });
      const read = await ask(c.client.lock.read({ project: PROJECT }));
      assert.equal(read.result.counter, 1);
      assert.equal(read.result.computer, computerId());
      assert.deepEqual(await ask(c.client.lock.touch({ project: PROJECT })), { ok: true, result: { touched: true } });
      const views = await ask(c.client.state.views({ project: PROJECT }));
      assert.equal(views.ok, true);
      assert.equal(views.views.rulebook.find((r) => r.id === wrote.id)?.words, 'Prices show two decimal places');
    });
    assert.ok((await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events')).some((n) => n.includes('_ruling_')), 'the ruling reached the host');
    assert.deepEqual(await remoteFiles(repo.remote.url, 'wheelhouse-lock'), ['lock.json']);
    assert.equal(repo.host.refusedCount(), 0, 'every request the host saw carried the key');
    assert.ok(answers.every((a) => !JSON.stringify(a).includes(TOKEN)));
  } finally { await c.close(); await repo.cleanup(); }
});

test('the same calls made without the helper are refused by the host', async () => {
  const repo = await privateRepo();
  const home = shortHome();
  try {
    await as(home, async () => {
      await assert.rejects(cloneState({ project: PROJECT, remoteUrl: repo.url, env: LOOPBACK_HTTP }), /could not be reached/);
    });
    assert.ok(repo.host.refusedCount() > 0, 'the host refused the keyless request');
  } finally { fs.rmSync(home, { recursive: true, force: true }); await repo.cleanup(); }
});

test('the state clone comes from the project record, never from the request', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      assert.deepEqual(await c.client.state.clone({ project: PROJECT, remoteUrl: 'file:///elsewhere', remote: 'file:///elsewhere' }), { ok: true });
      const origin = await run('git', ['config', '--get', 'remote.origin.url'], { cwd: stateDir(PROJECT) });
      assert.equal(origin.stdout.trim(), readProject(PROJECT).remoteUrl);
      assert.equal(origin.stdout.trim(), repo.url);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('a project with no record is refused, and the answer carries no key', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const answer = await c.client.state.clone({ project: 'someone__else' });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /project/);
      assert.ok(!JSON.stringify(answer).includes(TOKEN));
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('/state/write refuses a protected kind, an unknown kind and a missing kind', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      for (const kind of ['approval', 'review', 'confirmation', 'nonsense', undefined]) {
        const answer = await c.client.state.write({ project: PROJECT, kind, data: { pr: 1 } });
        assert.equal(answer.ok, false, String(kind));
        assert.match(answer.refused, /plain|kind/);
      }
      const bad = await c.client.state.write({ project: PROJECT, kind: 'note', data: 'not an object' });
      assert.equal(bad.ok, false);
      assert.deepEqual(await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events').catch(() => []), []);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('the helper refuses a setting event the catalogue refuses', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      for (const [data, pattern] of [
        [{ key: 'nonsense', value: 1 }, /no setting called nonsense/],
        [{ key: 'autonomy', value: 'reckless' }, /autonomy can't be reckless/],
        [{ key: 'budget', value: 'weekly-share' }, /budget can't be weekly-share/],
        [{ key: 'autonomy', value: 'cautious', until: '2026-10-18T18:00:00.000Z' }, /end time/],
        [undefined, /object|setting/],
      ]) {
        const answer = await c.client.state.write({ project: PROJECT, kind: 'setting', data });
        assert.equal(answer.ok, false, JSON.stringify(data));
        assert.match(answer.refused, pattern);
      }
      assert.deepEqual(await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events').catch(() => []), [], 'nothing reached the host');
      const ok = await c.client.state.write({ project: PROJECT, kind: 'setting', data: { key: 'presence', value: 'away', until: '2026-10-18T18:00:00.000Z' } });
      assert.equal(ok.ok, true);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('/state/write makes the event itself: its time and computer are the helper\'s, and an id not shaped as a random UUID is refused', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      for (const id of ['forged-id', '', 7, 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', '0f1e2d3c-4b5a-1978-8796-a5b4c3d2e1f0', '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0 ']) {
        const refused = await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'hello' }, id });
        assert.equal(refused.ok, false, String(id));
        assert.match(refused.refused, /id/, String(id));
      }
      assert.deepEqual(await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events').catch(() => []), []);
      const answer = await c.client.state.write({
        project: PROJECT, kind: 'note', data: { words: 'hello' }, at: '1999-01-01T00:00:00.000Z', computer: 'deadbeef',
      });
      assert.equal(answer.ok, true);
      assert.match(answer.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const files = await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events');
      assert.equal(files.length, 1);
      assert.match(files[0], /^events\/2026\/10\/2026-10-18T01-00-01\.000Z_/);
      assert.ok(files[0].includes(`_${computerId()}_note_`));
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('/state/write takes a caller-made id, and refuses one the state already holds', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const id = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
      const first = await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'first' }, id });
      assert.deepEqual(first, { ok: true, id, pushed: true });
      const views = await c.client.state.views({ project: PROJECT });
      assert.equal(views.ok, true);
      // The same id again, for the same record or another, is refused and writes nothing.
      for (const data of [{ words: 'first' }, { words: 'second' }]) {
        const again = await c.client.state.write({ project: PROJECT, kind: 'note', data, id });
        assert.equal(again.ok, false);
        assert.match(again.refused, /already holds an event with that id/);
      }
      // An id held by a signed record is refused too.
      const review = makeEvent({ kind: 'review', data: { pr: 7, commit: 'abc1234', verdict: 'CLEAN' }, now: at(500) });
      assert.equal((await c.client.state.record({ project: PROJECT, event: review })).ok, true);
      const taken = await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'third' }, id: review.id });
      assert.equal(taken.ok, false);
      assert.match(taken.refused, /already holds/);
      const files = await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events');
      assert.equal(files.length, 2);
      assert.ok(files.some((f) => f.includes('_note_0f1e')), 'the note is filed under its caller-made id');
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('a caller-made id can\'t take a kept signed click\'s place: the write is refused, and a record under a taken id is never counted as sent', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      // A signed click a hook kept to send later.
      const click = makeEvent({ kind: 'review', data: { pr: 9, commit: 'abc1234', verdict: 'CLEAN' }, now: at(700) });
      keep(PROJECT, 'record', { project: PROJECT, event: click }, at(700));
      const write = await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'first in' }, id: click.id });
      assert.equal(write.ok, false);
      assert.match(write.refused, /waiting to be sent/);
      // Only so much of a kept file is read: an oversized one is passed over, not read whole.
      const bigId = '1f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
      keep(PROJECT, 'record', { project: PROJECT, event: { id: bigId }, pad: 'x'.repeat(300 * 1024) }, at(750));
      assert.equal((await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'big' }, id: bigId })).ok, true);

      // Were another event under its id anyway, the click is refused in words the hook does not take as sent.
      const other = makeEvent({ kind: 'review', data: { pr: 10, commit: 'abc1234', verdict: 'CLEAN' }, now: at(800) });
      assert.equal((await c.client.state.record({ project: PROJECT, event: other })).ok, true);
      const clash = sign({ ...makeEvent({ kind: 'review', data: { pr: 11, commit: 'abc1234', verdict: 'CLEAN' }, now: at(900) }), id: other.id });
      const refused = await c.client.state.record({ project: PROJECT, event: clash });
      assert.equal(refused.ok, false);
      assert.equal(taken(refused), false, refused.refused);
      // The same record sent again is taken.
      const again = await c.client.state.record({ project: PROJECT, event: other });
      assert.equal(again.ok, false);
      assert.equal(taken(again), true, again.refused);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('the helper client passes a write\'s id to the helper', async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      calls.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.end(JSON.stringify({ ok: true, id: 'x' }));
    });
  });
  const home = shortHome();
  const address = testAddress(home);
  await new Promise((resolve) => server.listen(address, resolve));
  try {
    const id = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
    const answer = await helperClient({ address }).state.write({ project: PROJECT, kind: 'feature', data: { work: 'w', step: 'building' }, id });
    assert.equal(answer.ok, true);
    assert.deepEqual(calls, [{ path: '/state/write', body: { project: PROJECT, kind: 'feature', data: { work: 'w', step: 'building' }, id } }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/state/record accepts a record signed by this computer, and refuses one unsigned, altered, or signed by another computer', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const otherHome = shortHome();
  try {
    const other = await as(otherHome, async () => {
      const made = makeSigningKey();
      const event = makeEvent({ kind: 'approval', data: { pr: 7, commit: 'abc1234' }, now: at(0) });
      return { entry: made, event };
    });
    await c.as(async () => {
      enrol({ ...other.entry, enrolledAt: '2026-10-18T00:00:00.000Z' }); // enrolled, so its signature checks
      const review = makeEvent({ kind: 'review', data: { pr: 7, commit: 'abc1234', verdict: 'CLEAN' }, now: at(0) });
      const unsigned = (({ sig, ...rest }) => rest)(review);
      const altered = { ...review, data: { ...review.data, verdict: 'CLEAN with a change' } };
      for (const [label, event] of [['unsigned', unsigned], ['altered', altered], ['another computer', other.event]]) {
        const answer = await c.client.state.record({ project: PROJECT, event });
        assert.equal(answer.ok, false, label);
        assert.match(answer.refused, /sign|computer|record/, label);
      }
      assert.deepEqual(await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events').catch(() => []), [], 'nothing reached the host');

      const accepted = await c.client.state.record({ project: PROJECT, event: review });
      assert.deepEqual(accepted, { ok: true, id: review.id, pushed: true });
      assert.ok((await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events'))[0].includes('_review_'));

      // A plain kind is not recorded this way.
      const note = makeEvent({ kind: 'note', data: { words: 'x' }, now: at(10) });
      const refusedNote = await c.client.state.record({ project: PROJECT, event: note });
      assert.equal(refusedNote.ok, false);
    });
  } finally { fs.rmSync(otherHome, { recursive: true, force: true }); await c.close(); await repo.cleanup(); }
});

test('/state/record refuses an id the state already holds', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const note = await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'first' } });
      assert.equal(note.ok, true);
      // A signed review that carries the id of the note already in the state.
      const forged = sign({ ...makeEvent({ kind: 'review', data: { pr: 7, commit: 'abc1234', verdict: 'CLEAN' }, now: at(500) }), id: note.id });
      const answer = await c.client.state.record({ project: PROJECT, event: forged });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /id/);
      // And the same signed event twice.
      const review = makeEvent({ kind: 'review', data: { pr: 8, commit: 'abc1234', verdict: 'CLEAN' }, now: at(600) });
      assert.equal((await c.client.state.record({ project: PROJECT, event: review })).ok, true);
      const again = await c.client.state.record({ project: PROJECT, event: review });
      assert.equal(again.ok, false);
      assert.match(again.refused, /id/);
      assert.equal((await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events')).length, 2);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('/state/record takes a confirmation with the ruling or setting it confirms, once, and nothing it does not name', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const ruling = makeEvent({ kind: 'ruling', data: { words: 'Never push straight to main.', source: { file: 'CLAUDE.md', line: 3 }, original: false }, now: at(100) });
      const confirmation = makeEvent({ ...confirmationFor(ruling), now: at(100) });
      // Refused: a target it does not name, altered, made elsewhere, of a kind not taken this way,
      // a setting the catalogue refuses, or carried by anything but a confirmation.
      const altered = { ...ruling, data: { ...ruling.data, words: 'Push to main.' } };
      const elsewhere = { ...ruling, computer: '0f0f0f0f' };
      const level = makeEvent({ kind: 'level', data: { key: 'copy', value: 1 }, now: at(100) });
      const badSetting = makeEvent({ kind: 'setting', data: { key: 'phase', value: 'gone' }, now: at(100) });
      const review = makeEvent({ kind: 'review', data: { pr: 7, commit: 'abc1234', verdict: 'CLEAN' }, now: at(100) });
      for (const [label, body] of [
        ['altered', { event: confirmation, target: altered }],
        ['another computer', { event: makeEvent({ ...confirmationFor(elsewhere), now: at(100) }), target: elsewhere }],
        ['a level', { event: makeEvent({ ...confirmationFor(level), now: at(100) }), target: level }],
        ['a refused setting', { event: makeEvent({ ...confirmationFor(badSetting), now: at(100) }), target: badSetting }],
        ['not a confirmation', { event: review, target: ruling }],
        ['signed', { event: confirmation, target: sign(ruling) }],
      ]) {
        const answer = await c.client.state.record({ project: PROJECT, ...body });
        assert.equal(answer.ok, false, label);
        assert.equal(taken(answer), false, `${label}: ${answer.refused}`);
      }
      assert.deepEqual(await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events').catch(() => []), [], 'nothing reached the host');

      // A write can't take the id of a ruling a kept confirmation carries.
      keep(PROJECT, 'record', { project: PROJECT, event: confirmation, target: ruling }, at(100));
      const write = await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'x' }, id: ruling.id });
      assert.match(write.refused, /waiting to be sent/);

      // Taken: the ruling first, then its confirmation; sent again, it is taken as already held.
      const accepted = await c.client.state.record({ project: PROJECT, event: confirmation, target: ruling });
      assert.deepEqual(accepted, { ok: true, id: confirmation.id, pushed: true });
      const files = await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events');
      assert.deepEqual(files.map((f) => f.split('_').at(-2)).sort(), ['confirmation', 'ruling']);
      const again = await c.client.state.record({ project: PROJECT, event: confirmation, target: ruling });
      assert.equal(taken(again), true, again.refused);
      // A setting with its confirmation counts at once, as the views show.
      const phase = makeEvent({ kind: 'setting', data: { key: 'phase', value: 'launched', words: 'Product phase: launched' }, now: at(200) });
      const confirmsPhase = makeEvent({ ...confirmationFor(phase), now: at(200) });
      assert.equal((await c.client.state.record({ project: PROJECT, event: confirmsPhase, target: phase })).ok, true);
      assert.equal((await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events')).length, 4);
      const views = JSON.parse(fs.readFileSync(path.join(c.home, 'projects', PROJECT, 'views', 'settings.json'), 'utf8'));
      assert.equal(views.phase.value, 'launched');
      const rulebook = JSON.parse(fs.readFileSync(path.join(c.home, 'projects', PROJECT, 'views', 'rulebook.json'), 'utf8'));
      assert.deepEqual(rulebook.map((r) => [r.words, r.status]), [['Never push straight to main.', 'accepted']]);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

// Steps 4 and 5 through the real helper: the director's answers on the cards the steps ask, as
// the prompt record keeps and sends them, reach the project's state, each once, with nothing left
// pending; and what a hook kept while the helper was away lands when it is sent later.
test('setup\'s answers record the glossary entry, the phase and the rulings through the real /state routes', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-config-'));
  try {
    await c.as(async () => {
      // The project's folder, connected as step 3 leaves it, and its records' clone in place.
      const folder = readProject(PROJECT).folder;
      fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'CLAUDE.md'), '- Never push straight to main.\n- Keep commits small.\n');
      assert.equal((await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'clone' } })).ok, true);
      const run = startRun({ folder, now: at(0) });
      const ask = async (step, plan, card) => {
        noteAsked({ runId: run.id, folder, step, id: plan.ask.id, card, typed: plan.ask.typed, rules: plan.ask.rules, writes: plan.ask.writes, now: at(0) });
        return card;
      };
      const click = async (card, label, client) => promptRecord({
        cwd: folder, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [card], answers: { [card.question]: label } }, tool_response: { answers: { [card.question]: label } },
      }, { client, now: at(500) });

      const product = await questionsStep().plan({ folder, runId: run.id, answers: { '3.real-users': { label: REAL_USERS.yes, text: null } } });
      const productCard = await ask(4, product, composeCard({ ...product.ask.card, kind: 'question' }).question);
      const rules = await rulesStep({ env: { CLAUDE_CONFIG_DIR: config } }).plan({ folder, runId: run.id, userHome: config, answers: {}, now: at(0) });
      const rulesCard = await ask(5, rules, composeCard({ ...rules.ask.card, target: { count: rules.ask.rules.length, hash: listHash(rules.ask.rules) } }).question);

      await click(productCard, 'A menu for a small café.', c.client);
      await click(rulesCard, 'Confirm all', c.client);
      assert.deepEqual(fs.readdirSync(pendingDir(PROJECT)).filter((n) => n.endsWith('.json')), [], 'nothing left pending');
      const kinds = (await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events')).map((f) => f.split('_').at(-2)).sort();
      assert.deepEqual(kinds, ['action', 'confirmation', 'confirmation', 'confirmation', 'glossary', 'note', 'ruling', 'ruling', 'setting']);
      const views = (name) => JSON.parse(fs.readFileSync(path.join(c.home, 'projects', PROJECT, 'views', `${name}.json`), 'utf8'));
      assert.equal(views('glossary').p.data.plain, 'A menu for a small café.');
      assert.equal(views('settings').phase.value, 'launched');
      assert.deepEqual(views('rulebook').map((r) => r.status), ['accepted', 'accepted']);

      // Kept while the helper was away, the glossary entry and the phase land once sent.
      const away = { state: { write: async () => null, record: async () => null }, profile: { record: async () => null }, prState: async () => null };
      const again = await questionsStep().plan({ folder, runId: run.id, answers: { '3.real-users': { label: REAL_USERS.no, text: null } } });
      const againCard = await ask(4, again, composeCard({ ...again.ask.card, kind: 'question' }).question);
      await click(againCard, 'Describe it later', away);
      assert.equal(fs.readdirSync(pendingDir(PROJECT)).filter((n) => n.endsWith('.json')).length, 1);
      const { sendPending } = await import('../../../scripts/hooks/pending.js');
      assert.deepEqual(await sendPending(PROJECT, c.client), { sent: 1, kept: 0 });
      assert.equal(listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === 'setting').length, 2);
    });
  } finally { fs.rmSync(config, { recursive: true, force: true }); await c.close(); await repo.cleanup(); }
});

test('setup\'s clicks and answers of a run are copied into the state through the real /state/record route, once', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      assert.equal((await c.client.state.clone({ project: PROJECT })).ok, true);
      const run = startRun({ folder: readProject(PROJECT).folder, now: at(0) });
      keepClick(makeEvent({ kind: 'action', data: { action: 'setup', runId: run.id, step: 3, hash: 'c'.repeat(64), question: 'Step 3', label: 'Go ahead' }, now: at(100) }));
      keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: run.id, step: 4, questionId: 'live-data', question: 'Live data?', label: 'No live data', text: null }, now: at(200) }));
      // By default the copy asks this computer's helper, at its own address.
      const first = await copySetupRecords(run.id, PROJECT);
      assert.deepEqual(first, { copied: 2, skipped: 0, failed: 0 });
      assert.deepEqual(await copySetupRecords(run.id, PROJECT), { copied: 0, skipped: 2, failed: 0 });
    });
    const kinds = (await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events')).map((f) => f.split('_').at(-2));
    assert.deepEqual(kinds, ['action', 'action']);
  } finally { await c.close(); await repo.cleanup(); }
});

test('a confirmation that reached the state alone still has its ruling written when the pair is sent', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const ruling = makeEvent({ kind: 'ruling', data: { words: 'Keep commits small.', source: { file: 'CLAUDE.md', line: 2 }, original: false }, now: at(100) });
      const confirmation = makeEvent({ ...confirmationFor(ruling), now: at(100) });
      assert.equal((await c.client.state.record({ project: PROJECT, event: confirmation })).ok, true);
      const pair = await c.client.state.record({ project: PROJECT, event: confirmation, target: ruling });
      assert.equal(taken(pair), true, pair.refused);
      const held = listEvents(stateDir(PROJECT), { report: () => {} });
      assert.equal(held.some((e) => e.id === ruling.id), true, 'the ruling is written');
      const rulebook = JSON.parse(fs.readFileSync(path.join(c.home, 'projects', PROJECT, 'views', 'rulebook.json'), 'utf8'));
      assert.deepEqual(rulebook.map((r) => r.status), ['accepted']);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('each /state/write and /state/record it takes rewrites the project\'s views', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const viewsOf = (name) => JSON.parse(fs.readFileSync(path.join(stateDir(PROJECT), '..', 'views', `${name}.json`), 'utf8'));
      const card = await c.client.state.write({ project: PROJECT, kind: 'card', data: { question: 'Pick a colour?', header: 'Colour', options: ['Blue', 'Green'], kind: 'question', level: 3 } });
      assert.equal(card.ok, true);
      assert.deepEqual(viewsOf('waiting').map((w) => w.id), [card.id]);
      const review = makeEvent({ kind: 'review', data: { pr: 7, commit: 'abc1234', verdict: 'CLEAN' }, now: at(5000) });
      assert.equal((await c.client.state.record({ project: PROJECT, event: review })).ok, true);
      assert.equal(viewsOf('reviews')['7'].abc1234.id, review.id);
      assert.equal(viewsOf('status').lastEventAt, review.at);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('the front desk names its folder, and the helper places the project from it', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const inside = path.join(readProject(PROJECT).folder, 'src');
      fs.mkdirSync(inside, { recursive: true });
      const card = { question: 'Pick a colour?', header: 'Colour', options: ['Blue', 'Green'], kind: 'question', level: 3 };
      const wrote = await c.client.state.write({ cwd: inside, kind: 'card', data: card });
      assert.equal(wrote.ok, true, wrote.refused);
      // The views, and with `cards` the card events the board numbers its list from.
      const views = await c.client.state.views({ cwd: inside, cards: true });
      assert.equal(views.ok, true, views.refused);
      assert.deepEqual(views.views.waiting.map((w) => w.id), [wrote.id]);
      assert.deepEqual(views.cards.map((e) => [e.id, e.kind, e.data.question]), [[wrote.id, 'card', 'Pick a colour?']]);
      assert.equal((await c.client.state.views({ project: PROJECT })).cards, undefined, 'only when asked for');
      // With `answers`, the card-answer events, for the work view to tell a feature Not now holds.
      const answer = await c.client.state.write({ cwd: inside, kind: 'card-answer', data: { question: 'Pick a colour?', label: 'Not now' } });
      assert.equal(answer.ok, true, answer.refused);
      const answered = await c.client.state.views({ cwd: inside, answers: true });
      assert.deepEqual(answered.answers.map((e) => [e.id, e.kind, e.data.label]), [[answer.id, 'card-answer', 'Not now']]);
      assert.equal(answered.cards, undefined);
      assert.equal((await c.client.state.views({ project: PROJECT })).answers, undefined, 'only when asked for');
      assert.equal((await c.client.state.views({ project: PROJECT })).stop, undefined, 'STOP is off');
      assert.deepEqual(await c.client.prState({ cwd: inside, number: 7 }), { ok: true, result: { state: 'closed' } });
      // A folder outside every project, or one that isn't a full path, is refused, and nothing is written.
      for (const cwd of [os.tmpdir(), 'src']) {
        const lost = await c.client.state.write({ cwd, kind: 'idea', data: { key: 'x', title: 'x' } });
        assert.equal(lost.ok, false, cwd);
      }
      assert.match((await c.client.state.views({ cwd: os.tmpdir() })).refused, /not inside a Wheelhouse project/);
      assert.deepEqual((await c.client.state.views({ project: PROJECT })).views.waiting.map((w) => w.id), [wrote.id]);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('with review, the views carry the delegation review worked out from the project\'s events', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      const write = async (kind, data) => {
        const got = await c.client.state.write({ project: PROJECT, kind, data });
        assert.equal(got.ok, true, got.refused);
        return got.id;
      };
      // Five product questions on one topic, each decided by the option its card recommended.
      for (const n of [1, 2, 3, 4, 5]) {
        const card = await write('card', {
          question: `Which name suits page ${n}?`, header: 'Question', options: ['Plain', 'Playful', 'Explain more'], kind: 'question', level: 3, topic: 'copy-changes', recommend: 'Plain',
        });
        await write('card-answer', { card, label: 'Plain' });
      }
      await write('reversal', { topic: 'colours', what: 'The director undid the colour change' });
      const first = await c.client.state.views({ project: PROJECT, review: true });
      assert.equal(first.ok, true, first.refused);
      assert.equal(first.review.due, false, 'the project began a few seconds ago');
      assert.equal(first.review.since, null);
      assert.deepEqual(first.review.proposals.map(({ topic, from, to }) => ({ topic, from, to })), [
        { topic: 'colours', from: 2, to: 3 }, { topic: 'copy-changes', from: 3, to: 2 },
      ]);
      assert.equal((await c.client.state.views({ project: PROJECT })).review, undefined, 'only when asked for');
      // Once the review is recorded, it counts from there.
      await write('note', { review: 'delegation', at: T0.toISOString() });
      const after = await c.client.state.views({ project: PROJECT, review: true });
      assert.match(after.review.since, /^2026-10-18T/);
      assert.deepEqual(after.review.proposals, []);
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('/push refuses wheelhouse-state and wheelhouse-lock from a caller, whatever folder it names', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      assert.equal((await c.client.state.clone({ project: PROJECT })).ok, true);
      assert.equal((await c.client.lock.take({ project: PROJECT })).result.taken, true);
      for (const refspec of ['wheelhouse-state', 'wheelhouse-lock']) {
        for (const dir of [stateDir(PROJECT), path.join(stateDir(PROJECT), '..', 'lock'), c.home]) {
          assert.deepEqual(await c.client.push({ project: PROJECT, dir, refspec }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
        }
      }
      assert.equal(PUSH_REFUSALS.ownRequests, 'state and the lock are written through their own requests');
    });
  } finally { await c.close(); await repo.cleanup(); }
});

test('a write while the host is away is kept, and a later sync pushes it', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  try {
    await c.as(async () => {
      assert.equal((await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'one' } })).pushed, true);
      assert.equal((await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'two' } })).pushed, true);
    });
    await repo.host.close();
    await c.as(async () => {
      const away = await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'three' } });
      assert.equal(away.ok, true);
      assert.equal(away.pushed, false);
      const synced = await c.client.state.sync({ project: PROJECT });
      assert.deepEqual(synced, { ok: true, pulled: false, unpushed: 1 });
      assert.ok(!JSON.stringify([away, synced]).includes(TOKEN));
    });
  } finally { await c.close(); fs.rmSync(repo.remote.root, { recursive: true, force: true }); }
});

test('two computers writing at once through their own helpers both land', async () => {
  const repo = await privateRepo();
  const computers = [];
  const children = [];
  try {
    for (let i = 0; i < 2; i++) {
      const home = shortHome();
      await as(home, async () => {
        const made = makeSigningKey();
        enrol({ ...made, enrolledAt: '2026-10-18T00:00:00.000Z' });
        writeProject(PROJECT, record(repo.url));
      });
      const address = testAddress(home);
      const child = spawn(process.execPath, [path.join(HERE, '..', '..', 'helpers', 'helper-process.js')], {
        env: { ...process.env, WHEELHOUSE_HOME: home, WH_TEST_ADDRESS: address, WH_TEST_HOST_URL: repo.host.url, WH_TEST_TOKEN: TOKEN },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      children.push(child);
      await new Promise((resolve, reject) => {
        child.stdout.once('data', resolve);
        child.once('exit', (code) => reject(new Error(`the helper process exited (${code})`)));
      });
      computers.push({ home, client: helperClient({ address }) });
    }
    // Both clone, then each writes four events, one after another as its hooks would, the two computers at once.
    // A write that loses the race stays committed in its clone (pushed:false); a sync then delivers it.
    await Promise.all(computers.map((c) => c.client.state.clone({ project: PROJECT })));
    const answers = (await Promise.all(computers.map(async (c, i) => {
      const done = [];
      for (let n = 0; n < 4; n++) done.push(await c.client.state.write({ project: PROJECT, kind: 'note', data: { words: `computer ${i} note ${n}` } }));
      return done;
    }))).flat();
    assert.ok(answers.every((a) => a.ok === true), JSON.stringify(answers));
    for (let round = 0; round < 3; round++) {
      const synced = await Promise.all(computers.map((c) => c.client.state.sync({ project: PROJECT })));
      if (synced.every((x) => x.unpushed === 0)) break;
    }
    const synced = await Promise.all(computers.map((c) => c.client.state.sync({ project: PROJECT })));
    assert.deepEqual(synced, [{ ok: true, pulled: true, unpushed: 0 }, { ok: true, pulled: true, unpushed: 0 }]);
    const names = await remoteFiles(repo.remote.url, 'wheelhouse-state', 'events');
    assert.equal(names.length, 8, names.join('\n'));
    for (const c of computers) {
      const here = fs.readdirSync(path.join(c.home, 'projects', PROJECT, 'state', 'events', '2026', '10')).length;
      assert.equal(here, 8, 'every event has landed on both computers');
    }
    const ids = await Promise.all(computers.map((c) => as(c.home, () => computerId())));
    for (const id of ids) assert.equal(names.filter((n) => n.includes(`_${id}_note_`)).length, 4);
    const takes = await Promise.all(computers.map((c) => c.client.lock.take({ project: PROJECT })));
    assert.equal(takes.filter((t) => t.result?.taken).length, 1, 'only one computer holds the lock');
    assert.equal(repo.host.refusedCount(), 0);
  } finally {
    for (const child of children) child.kill('SIGTERM');
    for (const c of computers) fs.rmSync(c.home, { recursive: true, force: true });
    await repo.cleanup();
  }
});

test('no answer from a state or lock route carries the key', async () => {
  const repo = await privateRepo();
  const c = await computer(repo);
  const secrets = [TOKEN, HEADER_VALUE, HEADER_VALUE.split(' ').pop(), `x-access-token:${TOKEN}`];
  try {
    const answers = [];
    await c.as(async () => {
      const calls = [
        () => c.client.state.clone({ project: PROJECT }),
        () => c.client.state.write({ project: PROJECT, kind: 'note', data: { words: 'a' } }),
        () => c.client.state.write({ project: PROJECT, kind: 'approval', data: {} }),
        () => c.client.state.record({ project: PROJECT, event: { kind: 'review' } }),
        () => c.client.state.sync({ project: PROJECT }),
        () => c.client.state.views({ project: PROJECT }),
        () => c.client.lock.take({ project: PROJECT }),
        () => c.client.lock.touch({ project: PROJECT }),
        () => c.client.lock.read({ project: PROJECT }),
        () => c.client.state.clone({ project: 'no__record' }),
      ];
      for (const call of calls) answers.push(await call());
      // Once the host is away every route that reaches for it is refused or reports it, and still says nothing of the key.
      await repo.host.close();
      for (const call of calls) answers.push(await call());
    });
    const text = JSON.stringify(answers);
    for (const secret of secrets) assert.ok(!text.includes(secret), `an answer carried ${secret.slice(0, 6)}...`);
    assert.ok(answers.length >= 20);
  } finally { await c.close(); fs.rmSync(repo.remote.root, { recursive: true, force: true }); }
});

test('the real helper reads each project\'s host, repository and connection from its record', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  let helper;
  try {
    helper = await as(home, async () => {
      makeSigningKey();
      writeProject(PROJECT, record(remote.url, 'quick'));
      return startRealHelper({ address: testAddress(home), now: at(0) });
    });
    const client = helperClient({ address: helper.address });
    await as(home, async () => {
      assert.deepEqual(await client.state.clone({ project: PROJECT }), { ok: true });
      assert.equal((await client.state.write({ project: PROJECT, kind: 'note', data: { words: 'real' } })).pushed, true);
      assert.deepEqual(await client.lock.take({ project: PROJECT }), { ok: true, result: { taken: true, counter: 1 } });
      const unknown = await client.state.clone({ project: 'not__set' });
      assert.equal(unknown.ok, false);
    });
    assert.ok((await remoteFiles(remote.url, 'wheelhouse-state', 'events')).length === 1);
  } finally {
    await helper?.close();
    fs.rmSync(home, { recursive: true, force: true });
    remote.cleanup();
  }
});

test('the helper script starts a helper and stays up', { skip: process.platform === 'win32' ? 'the test address is a pipe there' : false }, async () => {
  const home = shortHome();
  const child = spawn(process.execPath, [path.join(HERE, '..', '..', '..', 'scripts', 'host', 'helper-main.js')], {
    env: { ...process.env, WHEELHOUSE_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', (code) => reject(new Error(`the helper script exited (${code})`)));
    });
    assert.equal((await helperClient({ address: testAddress(home) }).health()).ok, true);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(home, { recursive: true, force: true });
  }
});
