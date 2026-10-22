// tests/scripts/host/helper-stop.test.js
// The helper reads STOP and bypass for itself when a request's turn comes,
// whatever the caller says (design section 12.7).
import { test } from 'node:test';
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
import { stopState, setStop } from '../../../scripts/lib/stop.js';
import { markBypass } from '../../../scripts/lib/bypass.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { prOnHost } from '../../helpers/pr-on-host.js';
import { matchingBody, writeSessionProvenance } from '../../helpers/provenance.js';

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
    await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
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
          assert.deepEqual(await pending, { ok: false, refused: 'STOP is on' }, name);
        }
        const merge = await client.merge({ ...base, number: 7, stop: false, bypass: false });
        assert.equal(merge.ok, false);
        assert.ok(merge.reasons.includes('STOP is on'), JSON.stringify(merge));

        assert.equal((await client.prState({ ...base, number: 7 })).ok, true);
        assert.equal((await client.carried({ ...base, number: 7 })).ok, true);
        assert.deepEqual(await client.lineage.provenance({ ...base, session: 'sess-1' }), { ok: true, block: null, stop: true });
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
        assert.notEqual(rec.refused, 'STOP is on');
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
        assert.ok(b.reasons.includes('STOP is on'), JSON.stringify(b));
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
        assert.deepEqual(b, { ok: false, refused: 'STOP is on' });
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
        assert.ok(answer.reasons.includes('STOP is on'), JSON.stringify(answer));
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
        assert.deepEqual(await updating, { ok: false, refused: 'STOP is on' });
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
        assert.ok(stop.reasons.includes('STOP is on'));
        const bypass = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: true });
        assert.ok(bypass.reasons.includes('the session is in bypass mode'));
        for (const junk of ['false', 0, null, 'no']) {
          const answer = await client.merge({ project: 'o__p', number: 7, stop: junk, bypass: junk });
          assert.equal(answer.ok, true, JSON.stringify(answer));
        }
        setStop({ by: 'helper' });
        const under = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.ok(under.reasons.includes('STOP is on'));
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
        return realRun(file, args, options);
      };
      const helper = await startHelper({ address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => fakeAdapter(), envFor: async () => ({}), run });
      await helperClient({ address: helper.address }).merge({ project: 'o__p', number: 7, stop: false, bypass: false });
      await helper.close();
      assert.equal(tidied, true);
    });
  } finally { p.cleanup(); }
});
