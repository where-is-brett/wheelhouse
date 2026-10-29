// tests/scripts/host/helper-stop.test.js
// The helper reads STOP and bypass for itself when a request's turn comes,
// whatever the caller says (design section 12.7).
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stopState, setStop, liftStop } from '../../../scripts/lib/stop.js';
import { markBypass } from '../../../scripts/lib/bypass.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath, listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { prOnHost } from '../../helpers/pr-on-host.js';
import { matchingBody, writeSessionProvenance } from '../../helpers/provenance.js';
import { EventEmitter } from 'node:events';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { until } from '../../helpers/until.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();

const HEAD = `abc1234${'0'.repeat(33)}`;
const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const BYPASS_PUSH = 'a session on this computer is in bypass mode';

function fakeAdapter(overrides = {}) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'open', body: BODY }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    openPr: async () => ({ number: 7 }),
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

async function project() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
  });
  return { remote, home, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); } };
}

function record(kind, data) {
  const event = makeEvent({ kind, data, now: at(1000) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
function reviewAndApproval(commit = HEAD) {
  record('review', { pr: 7, commit, verdict: 'CLEAN' });
  record('approval', { pr: 7, commit });
}

// Pull request 7 on the project's host, up to date, signed for, and the adapter that reports it: for a merge the gate allows.
async function mergeablePr(p, overrides = {}) {
  const head = await prOnHost(p.remote.url);
  reviewAndApproval(head);
  return fakeAdapter({ prState: async () => ({ headSha: head, mergeable: 'mergeable', state: 'open', body: BODY }), ...overrides });
}

function post(address, p, body) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath: address, agent: false, method: 'POST', path: p, headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.end(JSON.stringify(body));
  });
}

// Waits for `reached`, failing by name if the request is answered first, so an early refusal can't hang the test.
function reach(reached, pending) {
  return Promise.race([reached, pending.then((answer) => { throw new Error(`answered before reaching the host: ${JSON.stringify(answer)}`); })]);
}

test('under STOP the helper refuses every write route and answers reads, sync, clone and signed records', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      setStop({ by: 'prompt', now: at(0) });
      await withHelper(fakeAdapter(), async (client) => {
        const base = { project: 'o__p' };
        const writes = {
          push: client.push({ ...base, dir: os.tmpdir(), refspec: 'feature' }),
          openPr: client.openPr({ ...base, head: 'feature', base: 'main', title: 't', body: 'b' }),
          updatePr: client.updatePr({ ...base, number: 7, title: 't' }),
          issueCreate: client.issue.create({ ...base, title: 't', body: 'b' }),
          issueUpdate: client.issue.update({ ...base, number: 1, body: 'b' }),
          stateWrite: client.state.write({ ...base, kind: 'note', data: {} }),
          lockTake: client.lock.take(base),
          lockTouch: client.lock.touch(base),
          ciPushLine: client.ciPushLine({ ...base, branch: 'feature', sha: HEAD }),
          updateBranch: client.updateBranch({ ...base, number: 7 }),
        };
        for (const [name, pending] of Object.entries(writes)) {
          assert.deepEqual(await pending, { ok: false, refused: 'All stop is on' }, name);
        }
        const merge = await client.merge({ ...base, number: 7, stop: false, bypass: false });
        assert.equal(merge.ok, false);
        assert.ok(merge.reasons.includes('All stop is on'), JSON.stringify(merge));

        assert.equal((await client.prState({ ...base, number: 7 })).ok, true);
        assert.equal((await client.carried({ ...base, number: 7 })).ok, true);
        assert.equal((await client.ci({ ...base, sha: HEAD })).ok, true);
        assert.equal((await client.issue.list({ ...base, label: 'x' })).ok, true);
        // The views say STOP is on, so the front desk can offer the Lift STOP card.
        const views = await client.state.views(base);
        assert.equal(views.ok, true);
        assert.equal(views.stop, true);
        // The delegation review is read-only, so it is worked out under STOP too.
        const reviewed = await client.state.views({ ...base, review: true });
        assert.equal(reviewed.ok, true);
        assert.deepEqual(reviewed.review.proposals, []);
        assert.equal((await client.lock.read(base)).ok, true);
        assert.equal((await client.state.sync(base)).ok, true);
        assert.equal((await client.state.clone(base)).ok, true);
        // A signed record is taken under STOP (it carries the click that lifts it): this one is
        // refused for being no event, not for STOP.
        const rec = await client.state.record({ ...base, event: 'nothing' });
        assert.notEqual(rec.refused, 'All stop is on');
        assert.equal(rec.refused, 'the record must be an event');
      });
    });
  } finally { p.cleanup(); }
});

// A helper that tells the test when each request is about to enter its queue.
function arrivals() {
  const waiting = [];
  const seen = [];
  return {
    onArrive: (route) => { seen.push(route); for (const w of waiting.splice(0)) w(); },
    // Resolves once `count` requests for `route` have arrived.
    until: (route, count) => new Promise((resolve) => {
      const check = () => {
        if (seen.filter((r) => r === route).length >= count) resolve();
        else waiting.push(check);
      };
      check();
    }),
  };
}

test('a merge queued behind another reads STOP when its turn comes', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      let reached; const atMerge = new Promise((r) => { reached = r; });
      let release; const held = new Promise((r) => { release = r; });
      const adapter = await mergeablePr(p);
      adapter.merge = async (args) => { adapter.merges.push(args); reached(); await held; return { merged: true }; };
      const queue = arrivals();
      await withHelper(adapter, async (client) => {
        const first = client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        await reach(atMerge, first); // the first has passed the gate and is held at the host
        const second = client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        await queue.until('/merge', 2); // the second is now waiting in the queue
        setStop({ by: 'mod', now: at(5) });
        release();
        const [a, b] = await Promise.all([first, second]);
        assert.equal(a.ok, true, JSON.stringify(a));
        assert.equal(b.ok, false);
        assert.ok(b.reasons.includes('All stop is on'), JSON.stringify(b));
        assert.equal(adapter.merges.length, 1);
      }, { onArrive: queue.onArrive });
    });
  } finally { p.cleanup(); }
});

test('a push queued behind another reads STOP when its turn comes', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      let reached; const atHost = new Promise((r) => { reached = r; });
      let release; const held = new Promise((r) => { release = r; });
      const adapter = fakeAdapter({ defaultBranch: async () => { reached(); await held; return 'main'; } });
      const queue = arrivals();
      await withHelper(adapter, async (client) => {
        const first = client.push({ project: 'o__p', dir: os.tmpdir(), refspec: 'feature' });
        await reach(atHost, first);
        const second = client.push({ project: 'o__p', dir: os.tmpdir(), refspec: 'feature' });
        await queue.until('/push', 2);
        setStop({ by: 'mod', now: at(5) });
        release();
        const [, b] = await Promise.all([first, second]);
        assert.deepEqual(b, { ok: false, refused: 'All stop is on' });
      }, { onArrive: queue.onArrive });
    });
  } finally { p.cleanup(); }
});

test('STOP set while a merge waits on the host is seen before the merge', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      reviewAndApproval();
      let reached; const atCi = new Promise((r) => { reached = r; });
      let release; const held = new Promise((r) => { release = r; });
      const adapter = fakeAdapter({ ciState: async (sha) => { reached(); await held; return { sha, state: 'success' }; } });
      await withHelper(adapter, async (client) => {
        const merging = client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        await reach(atCi, merging);
        setStop({ by: 'mod', now: at(5) });
        release();
        const answer = await merging;
        assert.equal(answer.ok, false);
        assert.ok(answer.reasons.includes('All stop is on'), JSON.stringify(answer));
        assert.deepEqual(adapter.merges, []);
      });
    });
  } finally { p.cleanup(); }
});

test('STOP set while a pull request update waits for the adapter is seen before the write', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      let updates = 0;
      const adapter = fakeAdapter({ updatePr: async () => { updates += 1; return { number: 7 }; } });
      let reached; const atAdapter = new Promise((r) => { reached = r; });
      let release; const held = new Promise((r) => { release = r; });
      writeSessionProvenance('o__p', 'sess-1');
      await withHelper(adapter, async (client) => {
        const updating = client.updatePr({ project: 'o__p', number: 7, title: 't', session: 'sess-1' });
        await reach(atAdapter, updating);
        setStop({ by: 'mod', now: at(5) });
        release();
        assert.deepEqual(await updating, { ok: false, refused: 'All stop is on' });
        assert.equal(updates, 0);
      }, { adapterFor: async () => { reached(); await held; return adapter; } });
    });
  } finally { p.cleanup(); }
});

test('/stop/set turns STOP on; there is no route that lifts it', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      await withHelper(fakeAdapter(), async (client, helper) => {
        assert.deepEqual(stopState(), { on: false });
        assert.deepEqual(await client.stop(), { ok: true });
        const state = stopState();
        assert.equal(state.on, true);
        assert.equal(state.by, 'helper');
        for (const route of ['/stop/lift', '/stop/clear', '/stop/off', '/stop/unset', '/stop']) {
          const answer = await post(helper.address, route, { project: 'o__p', lift: true });
          assert.equal(answer.status, 404, route);
        }
        const again = await post(helper.address, '/stop/set', { on: false, lift: true });
        assert.equal(again.body.ok, true);
        assert.equal(stopState().on, true);
      });
    });
  } finally { p.cleanup(); }
});

test('while a session is in bypass mode, merges and code pushes are refused whatever the caller says', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      reviewAndApproval();
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        markBypass('session-1', { now: () => new Date() });
        const merge = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(merge.ok, false);
        assert.ok(merge.reasons.includes('the session is in bypass mode'), JSON.stringify(merge));
        assert.deepEqual(adapter.merges, []);
        assert.deepEqual(
          await client.push({ project: 'o__p', dir: os.tmpdir(), refspec: 'feature' }),
          { ok: false, refused: BYPASS_PUSH },
        );
        // State writes are not code pushes.
        assert.equal((await client.state.write({ project: 'o__p', kind: 'note', data: {} })).ok, true);
      });
    });
  } finally { p.cleanup(); }
});

test('an expired bypass marker no longer blocks a merge', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      await withHelper(await mergeablePr(p), async (client) => {
        markBypass('session-1', { now: () => new Date(Date.now() - 3 * 3600000) });
        const merge = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(merge.ok, true, JSON.stringify(merge));
      });
    });
  } finally { p.cleanup(); }
});

test('a caller\'s stop: false or bypass: false changes nothing; its true adds', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      await withHelper(await mergeablePr(p), async (client) => {
        const clear = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(clear.ok, true, JSON.stringify(clear));
        const stop = await client.merge({ project: 'o__p', number: 7, stop: true, bypass: false });
        assert.ok(stop.reasons.includes('All stop is on'));
        const bypass = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: true });
        assert.ok(bypass.reasons.includes('the session is in bypass mode'));
        for (const junk of ['false', 0, null, 'no']) {
          const answer = await client.merge({ project: 'o__p', number: 7, stop: junk, bypass: junk });
          assert.equal(answer.ok, true, JSON.stringify(answer));
        }
        setStop({ by: 'helper' });
        const under = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.ok(under.reasons.includes('All stop is on'));
      });
    });
  } finally { p.cleanup(); }
});

// On Windows a folder can't be removed while a process works in it, so close must not
// leave the mirror's tidy running.
test('close waits for the mirror tidy queued after an answer', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      const mirror = path.join(stateDir('o__p'), '..', 'mirror.git');
      fs.mkdirSync(mirror, { recursive: true });
      execFileSync('git', ['init', '-q', '--bare'], { cwd: mirror });
      let tidied = false;
      const run = async (file, args, options) => {
        if (args.includes('gc')) {
          await new Promise((r) => setTimeout(r, 300));
          tidied = true;
          return { code: 0, stdout: '', stderr: '' };
        }
        return hostGuard(file, args, options);
      };
      const helper = await startHelper({ address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => fakeAdapter(), envFor: async () => ({}), run });
      await helperClient({ address: helper.address }).merge({ project: 'o__p', number: 7, stop: false, bypass: false });
      await helper.close();
      assert.equal(tidied, true);
    });
  } finally { p.cleanup(); }
});

// --- All stop reaches the build engine (design on Archon, section 12.3) ---

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));

// A spawn whose children are stand-ins that run nothing and end when killed; `onKill(child)` is told first.
function stubSpawn({ onKill = () => {} } = {}) {
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.pid = 8000 + children.length;
    child.killed = false;
    child.kill = (signal = 'SIGTERM') => { onKill(child); child.killed = signal; setImmediate(() => child.emit('exit', null, signal)); return true; };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

// The computer's processes for stopEngine: a run's owner with a step that moved itself into its own session (the
// survivor check 78 found), the wake process (8000) with a step of a run it carried on (8001, in its own session),
// the helper's own process, and whatever `kill` hasn't taken away. `wakeEnds` takes the wake away and hands its step
// to the system, as ending it does.
function computer() {
  let table = [
    { pid: process.pid, ppid: 1, pgid: process.pid, command: 'node helper' }, { pid: 700, ppid: 1, pgid: 700, command: 'fake-engine run owner' },
    { pid: 701, ppid: 700, pgid: 701, command: 'sleep 747' },
    { pid: 8000, ppid: process.pid, pgid: 8000, command: 'fake-engine-wake --watch' }, { pid: 8001, ppid: 8000, pgid: 8001, command: 'bun resumed step' },
  ];
  const kills = [];
  return {
    kills,
    cancelEnds: () => { table = table.filter((p) => p.pid !== 700); },
    wakeEnds: (child) => {
      if (child.pid !== 8000) return;
      table = table.filter((p) => p.pid !== 8000).map((p) => (p.ppid === 8000 ? { ...p, ppid: 1 } : p));
    },
    with: {
      list: async () => table.map((p) => ({ ...p })),
      cwds: async () => new Map(),
      kill: (pid, signal) => { kills.push([pid, signal]); table = table.filter((p) => (pid < 0 ? p.pgid !== -pid : p.pid !== pid)); },
      sleep: async () => {},
    },
  };
}

const notes = () => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'note' && e.data?.about === 'all-stop');
const runs = () => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'run');

test("the desk's All stop cancels every run, ends what the cancel left and names it, leaves a paused run paused, and lifting it starts nothing", async () => {
  const p = await project();
  const engine = fakeEngine({ recordings });
  const running = engine.start({ recording: 'quick-approved', running: true, ownerPid: 700 }).runId;
  const paused = engine.start({ recording: 'quick-blocked' }).runId;
  const pc = computer();
  const stopAll = engine.stopAll.bind(engine);
  engine.stopAll = async (reason, options) => { const got = await stopAll(reason, options); pc.cancelEnds(); return got; };
  const { spawn, children } = stubSpawn({ onKill: pc.wakeEnds });
  try {
    await as(p.home, async () => {
      // Each run's start is in the record, as what started it wrote it, so the note can name their work.
      record('run', { work: 'card-12', lane: 'quick', engine: 'fake', runId: running, state: 'started', branch: 'wh/card-12' });
      record('run', { work: 'card-13', lane: 'quick', engine: 'fake', runId: paused, state: 'started', branch: 'wh/card-13' });
      await withHelper(fakeAdapter(), async (client) => {
        await until(() => runs().filter((e) => e.data.state === 'started').length >= 2 && children.length === 1, { what: 'both runs recorded and the wake process' });
        const asked = await client.desk.act({ v: 'desk/1', project: 'o__p', command: 'all-stop', args: { by: 'mod' } });
        assert.equal(asked.ok, true);
        assert.equal(stopState().on, true);
        await until(() => notes().length === 1, { what: "All stop's note" });
        const note = notes()[0].data;
        assert.deepEqual(note.cancelled, [{ runId: running, work: 'card-12', lane: 'quick', branch: 'wh/card-12' }]);
        assert.deepEqual(note.paused, [{ runId: paused, work: 'card-13', lane: 'quick', branch: 'wh/card-13' }]);
        // The wake's step is in the snapshot, taken before the wake was ended.
        assert.deepEqual(note.ended, ['"bun resumed step" (process 8001)', '"sleep 747" (process 701)']);
        assert.deepEqual(note.survivors, []);
        assert.match(note.words, /cancelled 1 run.*1 run waiting on an answer stays paused.*ended 2 processes the engine left running/);
        assert.deepEqual(pc.kills.sort(), [[-701, 'SIGTERM'], [-8001, 'SIGTERM']]);
        assert.ok(pc.kills.every(([pid]) => Math.abs(pid) !== process.pid), "the helper's own process is never ended");
        assert.equal(engine.inspect(running).status, 'ended');
        assert.equal(engine.inspect(paused).status, 'paused', 'a paused run stays paused');
        // The wake process ends, so nothing carries an answered paused run on, and none is started while STOP is on.
        assert.equal(children[0].killed, 'SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(children.length, 1);

        // Lifting All stop starts no run; only the wake process starts again, so the engine works once more.
        const starts = engine.calls.filter((c) => c.call === 'start').length;
        liftStop();
        await until(() => children.length === 2, { what: 'the wake process again' });
        assert.equal(engine.calls.filter((c) => c.call === 'start').length, starts);
        assert.equal(engine.inspect(running).status, 'ended');
      }, { spawn, engineFor: () => engine, engineStopWith: pc.with, stopPollMs: 10 });
    });
  } finally { p.cleanup(); }
});

test('STOP set by the route, or without the helper at all, reaches the engine', async () => {
  const p = await project();
  const engine = fakeEngine({ recordings });
  engine.start({ recording: 'quick-approved', running: true });
  engine.start({ recording: 'quick-blocked', running: true });
  const quiet = { list: async () => [], cwds: async () => new Map(), kill: () => assert.fail('nothing to end'), sleep: async () => {} };
  try {
    await as(p.home, async () => {
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.stop({}), { ok: true });
        await until(() => engine.calls.some((c) => c.call === 'stopAll'), { what: 'the route to reach the engine' });
        const waited = await client.stop({ wait: true });
        assert.equal(waited.ok, true);
        assert.match(waited.engine.said, /All stop/);
        liftStop();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const before = engine.calls.filter((c) => c.call === 'stopAll').length;
        // The STOP word's own hook sets STOP in the file, not through the helper.
        setStop({ by: 'prompt' });
        await until(() => engine.calls.filter((c) => c.call === 'stopAll').length > before, { what: 'STOP in the file to reach the engine' });
      }, { spawn: stubSpawn().spawn, engineFor: () => engine, engineStopWith: quiet, stopPollMs: 10 });
    });
  } finally { p.cleanup(); }
});
