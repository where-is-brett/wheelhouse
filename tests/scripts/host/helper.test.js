// tests/scripts/host/helper.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startHelper, PUSH_REFUSALS, secretsOf } from '../../../scripts/host/helper.js';
import { helperClient, pushFor } from '../../../scripts/host/helper-client.js';
import { helperAddress, stateDir, stopFile } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, eventPath, writeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

const HEAD = `abc1234${'0'.repeat(33)}`;
const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const HOUR = 3600000;
const FAKE_KEY = 'ghs_FAKEKEY0123456789abcdefSECRET';
const LOCK_REASON = 'this computer no longer holds the lock';
const unix = process.platform !== 'win32';
const unixOnly = unix ? false : 'socket files exist only on macOS and Linux';

async function g(dir, ...args) {
  const r = await run('git', ['-c', 'user.name=T', '-c', 'user.email=t@invalid', ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function fakeAdapter(overrides = {}) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'open' }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    openPr: async (args) => ({ number: 7, url: `https://example.invalid/pr/7?h=${args.head}` }),
    updatePr: async () => ({ number: 7 }),
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
    ...overrides,
  };
}

// Runs fn with a helper on the current home's test address.
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

function raw(address, { method = 'POST', path: p, body }) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath: address, agent: false, method, path: p, headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', (error) => resolve({ error: error.code }));
    req.end(body);
  });
}

// A home with an enrolled signing key, a state clone, and (optionally) the lock taken.
async function project({ lock = true } = {}) {
  const remote = await makeBareRemote();
  const home = shortHome();
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await cloneState({ project: 'o__p', remoteUrl: remote.url });
    if (lock) assert.equal((await takeLock({ project: 'o__p', push: plainPush, now: at(0) })).taken, true);
  });
  return { remote, home, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); } };
}

function record(kind, data) {
  const event = makeEvent({ kind, data, now: at(1000) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
function reviewAndApproval() {
  record('review', { pr: 7, commit: HEAD, verdict: 'CLEAN' });
  record('approval', { pr: 7, commit: HEAD });
}

// An agent's folder: a clone of the project's remote, outside ~/.wheelhouse.
async function agentClone(remoteUrl, branch = 'wheelhouse-state') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ag-'));
  await g(os.tmpdir(), 'clone', '-q', '--branch', branch, remoteUrl, dir);
  return dir;
}
const remoteFile = async (remoteUrl, ref, file) => (await run('git', ['--no-replace-objects', 'show', `${ref}:${file}`], { cwd: remoteUrl })).stdout;
const remoteHeads = async (remoteUrl) => (await run('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'], { cwd: remoteUrl })).stdout;

// --- the address ---

test('the helper answers on a socket, and on a named pipe on Windows', async () => {
  const home = shortHome();
  try {
    await as(home, () => withHelper(fakeAdapter(), async (client, helper) => {
      assert.deepEqual(await client.health(), { ok: true });
      const state = await client.prState({ project: 'o__p', number: 7 });
      assert.deepEqual(state, { ok: true, result: { headSha: HEAD, mergeable: 'mergeable', state: 'open' } });
      if (unix) assert.equal(fs.statSync(helper.address).mode & 0o077, 0);
      else assert.match(helper.address, /^\\\\\.\\pipe\\wheelhouse-test-[0-9a-f]{8}-helper$/);
    }));
    if (unix) assert.equal(fs.existsSync(path.join(home, 'helper.sock')), false, 'close removes the socket file');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the Windows address is a named pipe for the user', () => {
  assert.equal(helperAddress({ platform: 'win32', user: 'Zoë Smith' }), '\\\\.\\pipe\\wheelhouse-Zo__Smith-helper');
});

test('a socket path that is too long is refused with a plain error', { skip: unixOnly }, async () => {
  const address = path.join(os.tmpdir(), 'x'.repeat(120), 'helper.sock');
  await assert.rejects(startHelper({ address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}) }), /too long/);
});

test('a second helper refuses to start while the first answers', async () => {
  const home = shortHome();
  try {
    await as(home, () => withHelper(fakeAdapter(), async (client, helper) => {
      await assert.rejects(
        startHelper({ address: helper.address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}) }),
        /already running/,
      );
      assert.deepEqual(await client.health(), { ok: true }, 'the first is untouched');
    }));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a stale socket file is removed and the helper starts', { skip: unixOnly }, async () => {
  const home = shortHome();
  try {
    await as(home, async () => {
      const address = testAddress(home);
      // Leave a socket file with nothing listening behind it.
      const server = net.createServer();
      await new Promise((resolve) => server.listen(address, resolve));
      const linked = `${address}.keep`;
      fs.linkSync(address, linked);
      await new Promise((resolve) => server.close(resolve));
      if (!fs.existsSync(address)) fs.renameSync(linked, address); else fs.rmSync(linked);
      assert.equal(fs.lstatSync(address).isSocket(), true);
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.health(), { ok: true });
      });
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('unknown requests get 404, malformed JSON 400, and an oversized request 413', async () => {
  const home = shortHome();
  try {
    await as(home, () => withHelper(fakeAdapter(), async (client, helper) => {
      const unknown = await raw(helper.address, { path: '/delete-everything', body: '{"project":"o__p"}' });
      assert.equal(unknown.status, 404);
      assert.deepEqual(unknown.body, { ok: false, refused: 'unknown request' });
      const bad = await raw(helper.address, { path: '/push', body: '{not json' });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.ok, false);
      // The helper answers 413 and closes the connection; the sender may see either.
      const big = await raw(helper.address, { path: '/push', body: JSON.stringify({ project: 'o__p', pad: 'x'.repeat(2 * 1024 * 1024) }) });
      assert.ok(big.status === 413 || ['ECONNRESET', 'EPIPE'].includes(big.error), JSON.stringify(big));
      assert.deepEqual(await client.health(), { ok: true }, 'the helper is still answering');
      const badProject = await client.prState({ project: '../x', number: 7 });
      assert.equal(badProject.ok, false);
    }));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('concurrent requests share one call to envFor per project', async () => {
  const home = shortHome();
  try {
    let calls = 0;
    const envFor = async () => { calls += 1; await new Promise((r) => setTimeout(r, 50)); return {}; };
    const adapterFor = async (projectName, { envFor: shared }) => { await shared(projectName); return fakeAdapter(); };
    await as(home, () => withHelper(null, async (client) => {
      const answers = await Promise.all([1, 2, 3, 4].map(() => client.prState({ project: 'o__p', number: 7 })));
      assert.ok(answers.every((a) => a.ok));
      assert.equal(calls, 1);
      await client.prState({ project: 'o__p', number: 7 });
      assert.equal(calls, 2, 'a later request asks again');
    }, { envFor, adapterFor }));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// --- pushing ---

test('push answers ok, rejected when not fast-forward, and carries state events', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const pushed = await writeEvent({ project: 'o__p', event: makeEvent({ kind: 'note', data: { words: 'hello' }, now: at(0) }), push: pushFor(client, 'o__p') });
      assert.equal(pushed.pushed, true);

      // Another clone moves the branch on; this clone's next push is not a fast-forward.
      const other = await agentClone(p.remote.url);
      fs.mkdirSync(path.join(other, 'events', 'x'), { recursive: true });
      fs.writeFileSync(path.join(other, 'events', 'x', 'a.json'), '{}\n');
      await g(other, 'add', '-A');
      await g(other, 'commit', '-q', '-m', 'x');
      await g(other, 'push', '-q', 'origin', 'wheelhouse-state');
      const dir = stateDir('o__p');
      fs.mkdirSync(path.join(dir, 'events', 'y'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'events', 'y', 'b.json'), '{}\n');
      await g(dir, 'add', '-A');
      await g(dir, 'commit', '-q', '-m', 'y');
      assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'wheelhouse-state' }), { ok: false, rejected: 'non-fast-forward' });

      assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: '+wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.force });
      const missing = await client.push({ project: 'o__p', dir: path.join(dir, 'nowhere'), refspec: 'wheelhouse-state' });
      assert.equal(missing.ok, false);
      fs.rmSync(other, { recursive: true, force: true });
    }));
  } finally { p.cleanup(); }
});

test('a code push is refused when this computer does not hold the lock', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      const dir = stateDir('o__p');
      await g(dir, 'branch', 'feature');
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: false, refused: LOCK_REASON });
        assert.equal(await takeLock({ project: 'o__p', push: pushFor(client, 'o__p'), now: at(0) }).then((r) => r.taken), true, 'a lock push needs no lock');
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true });
      });
    });
  } finally { p.cleanup(); }
});

// An event on the remote, written through the helper, and an agent's clone of it.
async function stateWithEvent(p, client) {
  const written = await writeEvent({ project: 'o__p', event: makeEvent({ kind: 'note', data: { words: 'original' }, now: at(0) }), push: pushFor(client, 'o__p') });
  assert.equal(written.pushed, true);
  const rel = path.relative(stateDir('o__p'), written.path).split(path.sep).join('/');
  const original = await remoteFile(p.remote.url, 'wheelhouse-state', rel);
  const agent = await agentClone(p.remote.url);
  return { rel, original, agent };
}
async function tamper(agent, rel) {
  fs.writeFileSync(path.join(agent, rel), '{"tampered":true}\n');
  await g(agent, 'commit', '-q', '-am', 'An innocent-looking change');
  return g(agent, 'rev-parse', 'HEAD');
}

test('a state or lock push from an agent\'s folder is refused, whatever its remotes say', async () => {
  const p = await project({ lock: false });
  const decoy = await makeBareRemote();
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const { rel, original, agent } = await stateWithEvent(p, client);
      const tampered = await tamper(agent, rel);
      await g(agent, 'push', '-q', decoy.url, `${tampered}:refs/heads/wheelhouse-state`);
      await g(agent, 'remote', 'set-url', 'origin', decoy.url);
      await g(agent, 'remote', 'set-url', '--push', 'origin', p.remote.url);
      assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.stateFolder });
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', rel), original);

      // A plain new event from the agent's copy is refused too: only the state clone pushes state.
      await g(agent, 'reset', '-q', '--hard', 'HEAD~1');
      fs.mkdirSync(path.join(agent, 'events', 'n'), { recursive: true });
      fs.writeFileSync(path.join(agent, 'events', 'n', 'forged.json'), '{}\n');
      await g(agent, 'add', '-A');
      await g(agent, 'commit', '-q', '-m', 'A new event');
      assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.stateFolder });
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', 'events/n/forged.json'), '');

      // The state clone reached by another spelling of its path still pushes.
      const roundabout = path.join(stateDir('o__p'), 'events', '..');
      assert.deepEqual(await client.push({ project: 'o__p', dir: roundabout, refspec: 'wheelhouse-state' }), { ok: true });
      fs.rmSync(agent, { recursive: true, force: true });

      // The lock branch: the lock clone may push it, an agent's copy may not, nor may the state clone.
      assert.equal((await takeLock({ project: 'o__p', push: pushFor(client, 'o__p'), now: at(0) })).taken, true);
      const lockCopy = await agentClone(p.remote.url, 'wheelhouse-lock');
      fs.writeFileSync(path.join(lockCopy, 'lock.json'), '{"holder":"someone else"}\n');
      await g(lockCopy, 'commit', '-q', '-am', 'Take the lock');
      assert.deepEqual(await client.push({ project: 'o__p', dir: lockCopy, refspec: 'wheelhouse-lock' }), { ok: false, refused: PUSH_REFUSALS.lockFolder });
      assert.deepEqual(await client.push({ project: 'o__p', dir: stateDir('o__p'), refspec: 'wheelhouse-lock' }), { ok: false, refused: PUSH_REFUSALS.lockFolder });
      assert.doesNotMatch(await remoteFile(p.remote.url, 'wheelhouse-lock', 'lock.json'), /someone else/);
      fs.rmSync(lockCopy, { recursive: true, force: true });
    }));
  } finally { p.cleanup(); decoy.cleanup(); }
});

test('a link to the state clone repointed at an agent\'s copy during the push gets nothing forged pushed', async () => {
  const p = await project({ lock: false });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ln-'));
  try {
    await as(p.home, async () => {
      const agent = path.join(work, 'agent');
      await g(work, 'clone', '-q', '--branch', 'wheelhouse-state', p.remote.url, agent);
      fs.mkdirSync(path.join(agent, 'events', 'x'), { recursive: true });
      fs.writeFileSync(path.join(agent, 'events', 'x', 'forged.json'), '{"kind":"card-answer"}\n');
      await g(agent, 'add', '-A');
      await g(agent, 'commit', '-q', '-m', 'A forged event');
      const link = path.join(work, 'link');
      fs.symlinkSync(stateDir('o__p'), link, 'junction');
      // After the folder check, just before the objects are copied in, the link is repointed.
      let swapped = false;
      const swapping = async (file, args, options) => {
        if (!swapped && args.includes('update-ref') && args.includes('-d')) {
          fs.rmSync(link, { force: true, recursive: false });
          fs.symlinkSync(agent, link, 'junction');
          swapped = true;
        }
        return run(file, args, options);
      };
      await withHelper(fakeAdapter(), async (client) => {
        await client.push({ project: 'o__p', dir: link, refspec: 'wheelhouse-state' });
      }, { run: swapping });
      assert.equal(swapped, true, 'the link was repointed during the push');
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', 'events/x/forged.json'), '');
    });
  } finally {
    p.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('a replace ref in the state clone cannot hide a changed event', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const { rel, original, agent } = await stateWithEvent(p, client);
      fs.rmSync(agent, { recursive: true, force: true });
      const dir = stateDir('o__p');
      const tip = await g(dir, 'rev-parse', 'HEAD');
      const tampered = await tamper(dir, rel);
      await g(dir, 'checkout', '-q', '--detach', tip);
      fs.mkdirSync(path.join(dir, 'events', 'n'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'events', 'n', 'two.json'), '{}\n');
      await g(dir, 'add', '-A');
      await g(dir, 'commit', '-q', '-m', 'Add two');
      const innocent = await g(dir, 'rev-parse', 'HEAD');
      await g(dir, 'checkout', '-q', 'wheelhouse-state');
      await g(dir, 'replace', tampered, innocent);
      assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.state });
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', rel), original);
    }));
  } finally { p.cleanup(); }
});

test('a shallow marker in the state clone cannot hide a changed event', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const { rel, original, agent } = await stateWithEvent(p, client);
      fs.rmSync(agent, { recursive: true, force: true });
      const dir = stateDir('o__p');
      const tip = await g(dir, 'rev-parse', 'HEAD');
      const tampered = await tamper(dir, rel);
      const shallow = path.join(dir, '.git', 'shallow');
      fs.appendFileSync(shallow, `${tampered}\n`);
      const answer = await client.push({ project: 'o__p', dir, refspec: 'wheelhouse-state' });
      assert.equal(answer.ok, false);
      assert.ok([PUSH_REFUSALS.state, PUSH_REFUSALS.shallow, PUSH_REFUSALS.missing].includes(answer.refused), answer.refused);
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', rel), original);
      // The mirror is not left shallow: once the clone is put right, a plain event push still goes through.
      fs.rmSync(shallow, { force: true });
      await g(dir, 'reset', '-q', '--hard', tip);
      const next = await writeEvent({ project: 'o__p', event: makeEvent({ kind: 'note', data: { words: 'after' }, now: at(2000) }), push: pushFor(client, 'o__p') });
      assert.equal(next.pushed, true);
    }));
  } finally { p.cleanup(); }
});

test('a state push carrying a secret is refused, naming the pattern and file but never the value', async () => {
  const p = await project({ lock: false });
  // Built from fragments: no committed literal has a real key's shape.
  const key = ['gh', 'p_', 'aB3'.repeat(12)].join('');
  const aws = ['AK', 'IA', 'Q7'.repeat(8)].join('');
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const dir = stateDir('o__p');
      const cases = [
        ['events/s/plain.json', `{"text":"token ${key}"}\n`, 'github-token'],
        ['events/s/newline.json', `${JSON.stringify({ text: `pasted:\n${key}` })}\n`, 'github-token'],
        ['events/s/tab.json', `${JSON.stringify({ text: `key\t${aws}` })}\n`, 'aws-access-key'],
        ['events/s/glued.txt', `MY_${key}\n`, 'github-token'],
      ];
      for (const [rel, body, pattern] of cases) {
        const tip = await g(dir, 'rev-parse', 'HEAD');
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), body);
        await g(dir, 'add', '-A');
        await g(dir, 'commit', '-q', '-m', 'An event');
        const answer = await client.push({ project: 'o__p', dir, refspec: 'wheelhouse-state' });
        assert.equal(answer.ok, false, rel);
        assert.ok(answer.refused.includes(rel), answer.refused);
        assert.ok(answer.refused.includes(pattern), answer.refused);
        assert.ok(!answer.refused.includes(key) && !answer.refused.includes(aws), 'the value is never repeated');
        assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', rel), '');
        await g(dir, 'reset', '-q', '--hard', tip);
      }
      // A clean event still goes through.
      fs.mkdirSync(path.join(dir, 'events', 's'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'events', 's', 'clean.json'), '{"text":"nothing here"}\n');
      await g(dir, 'add', '-A');
      await g(dir, 'commit', '-q', '-m', 'A clean event');
      assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'wheelhouse-state' }), { ok: true });
    }));
  } finally { p.cleanup(); }
});

test('the folder\'s own git config never runs with the key: sshCommand, credential helper, proxy, askpass', async () => {
  const p = await project();
  const leaks = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-lk-'));
  const leak = (name) => path.join(leaks, name).split(path.sep).join('/');
  const env = { GH_TOKEN: FAKE_KEY, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${FAKE_KEY}`).toString('base64')}` };
  try {
    await as(p.home, async () => {
      const agent = await agentClone(p.remote.url);
      await g(agent, 'checkout', '-q', '-b', 'feature');
      fs.writeFileSync(path.join(agent, 'work.txt'), 'work\n');
      await g(agent, 'add', '-A');
      await g(agent, 'commit', '-q', '-m', 'Work');
      const sha = await g(agent, 'rev-parse', 'HEAD');
      const askpass = path.join(leaks, 'askpass.sh');
      fs.writeFileSync(askpass, `#!/bin/sh\nenv > "${leak('askpass.txt')}"\n`, { mode: 0o755 });
      for (const [key, value] of [
        ['core.sshCommand', `env > "${leak('ssh.txt')}"; false`],
        ['credential.helper', `!env > "${leak('credential.txt')}"; false`],
        ['core.gitProxy', `!env > "${leak('proxy.txt')}"; false`],
        ['core.askPass', askpass],
        ['http.proxy', 'http://127.0.0.1:9'],
        ['http.https://github.com/.proxy', 'http://127.0.0.1:9'],
        ['http.sslVerify', 'false'],
        ['core.hooksPath', leaks],
      ]) await g(agent, 'config', key, value);
      fs.writeFileSync(path.join(leaks, 'pre-push'), `#!/bin/sh\nenv > "${leak('hook.txt')}"\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(leaks, 'reference-transaction'), `#!/bin/sh\nenv > "${leak('ref.txt')}"\n`, { mode: 0o755 });
      await g(agent, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/o/p.git');

      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'feature' }), { ok: true });
      }, { envFor: async () => env });
      assert.match(await remoteHeads(p.remote.url), new RegExp(`refs/heads/feature ${sha}`));
      assert.deepEqual(fs.readdirSync(leaks).filter((f) => f.endsWith('.txt')), [], 'nothing the folder configured ran');
      fs.rmSync(agent, { recursive: true, force: true });
    });
  } finally {
    p.cleanup();
    fs.rmSync(leaks, { recursive: true, force: true });
  }
});

test('the folder\'s origin is irrelevant: the push goes to the project\'s repository from the state clone', async () => {
  const p = await project();
  const elsewhere = await makeBareRemote();
  try {
    await as(p.home, async () => {
      const agent = await agentClone(p.remote.url);
      await g(agent, 'checkout', '-q', '-b', 'feature');
      await g(agent, 'commit', '-q', '--allow-empty', '-m', 'Work');
      await g(agent, 'remote', 'set-url', 'origin', elsewhere.url);
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'feature' }), { ok: true });
      });
      assert.match(await remoteHeads(p.remote.url), /refs\/heads\/feature /);
      assert.equal(await remoteHeads(elsewhere.url), '');
      fs.rmSync(agent, { recursive: true, force: true });
    });
  } finally { p.cleanup(); elsewhere.cleanup(); }
});

test('the lock and the mirror reach a remote only through the connection\'s environment', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      reviewAndApproval();
      // The clones name an address that exists only through the environment's insteadOf.
      const standIn = path.join(os.tmpdir(), `wh-nowhere-${crypto.randomBytes(4).toString('hex')}.git`);
      await g(stateDir('o__p'), 'remote', 'set-url', 'origin', standIn);
      await g(path.join(stateDir('o__p'), '..', 'lock'), 'remote', 'set-url', 'origin', standIn);
      const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${p.remote.url}.insteadOf`, GIT_CONFIG_VALUE_0: standIn };
      await g(stateDir('o__p'), 'branch', 'feature');

      await withHelper(fakeAdapter(), async (client) => {
        const refused = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.deepEqual(refused.reasons, [LOCK_REASON], 'without the environment the lock cannot be read');
      });
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        assert.deepEqual(await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false }), { ok: true, merged: true, sha: HEAD });
        assert.deepEqual(await client.push({ project: 'o__p', dir: stateDir('o__p'), refspec: 'feature' }), { ok: true });
      }, { envFor: async () => env });
      assert.match(await remoteHeads(p.remote.url), /refs\/heads\/feature /);
    });
  } finally { p.cleanup(); }
});

// --- merging ---

test('merge is refused with every gate reason when conditions fail', async () => {
  const p = await project({ lock: false });
  try {
    const adapter = fakeAdapter({ ciState: async (sha) => ({ sha, state: 'failure' }) });
    await as(p.home, () => withHelper(adapter, async (client) => {
      const answer = await client.merge({ project: 'o__p', number: 7, stop: true });
      assert.equal(answer.ok, false);
      assert.deepEqual(answer.reasons, [
        'STOP is on',
        'the session is in bypass mode',
        LOCK_REASON,
        'CI has not passed on abc1234',
        'no CLEAN review of abc1234',
        'no approval of abc1234',
      ]);
      assert.equal(answer.refused, answer.reasons.join('; '));

      // A review is always required; the approval only when the caller says false.
      const lighter = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false, reviewRequired: false, approvalRequired: false, touchesGuardrails: false });
      assert.deepEqual(lighter.reasons, [LOCK_REASON, 'CI has not passed on abc1234', 'no CLEAN review of abc1234']);
      const guardrails = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false, reviewRequired: false, approvalRequired: false, touchesGuardrails: 'no' });
      assert.ok(guardrails.reasons.includes('no CLEAN review of abc1234'));
      assert.ok(guardrails.reasons.includes('no approval of abc1234'));
      assert.deepEqual(adapter.merges, []);
    }));
  } finally { p.cleanup(); }
});

test('merge pins the head commit when the gate allows it', async () => {
  const p = await project();
  try {
    const adapter = fakeAdapter();
    await as(p.home, async () => {
      reviewAndApproval();
      await withHelper(adapter, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.deepEqual(answer, { ok: true, merged: true, sha: HEAD });
        assert.deepEqual(adapter.merges, [{ number: 7, sha: HEAD }]);
      });
    });
  } finally { p.cleanup(); }
});

test('merge is refused while the STOP file exists, whatever the caller says', async () => {
  const p = await project();
  try {
    const adapter = fakeAdapter();
    await as(p.home, async () => {
      reviewAndApproval();
      fs.writeFileSync(stopFile(), '');
      await withHelper(adapter, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.deepEqual(answer.reasons, ['STOP is on']);
        assert.deepEqual(adapter.merges, []);
      });
    });
  } finally { p.cleanup(); }
});

test('merge is refused when the pull request is not open, or the host declines', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      reviewAndApproval();
      const closed = fakeAdapter({ prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'merged' }) });
      await withHelper(closed, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /not open/);
        assert.deepEqual(closed.merges, []);
      });
      const declines = fakeAdapter({ merge: async () => ({ merged: false, reason: 'the head moved' }) });
      await withHelper(declines, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.deepEqual(answer, { ok: false, refused: 'the head moved' });
      });
    });
  } finally { p.cleanup(); }
});

test('merge is refused when this computer has lost the lock', async () => {
  const p = await project();
  const otherHome = shortHome();
  try {
    // Another computer takes the stale lock three hours later.
    await as(otherHome, async () => {
      await cloneState({ project: 'o__p', remoteUrl: p.remote.url });
      assert.equal((await takeLock({ project: 'o__p', push: plainPush, now: at(3 * HOUR) })).taken, true);
    });
    const adapter = fakeAdapter();
    await as(p.home, async () => {
      reviewAndApproval();
      await withHelper(adapter, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.ok, false);
        assert.deepEqual(answer.reasons, [LOCK_REASON]);
        assert.deepEqual(adapter.merges, []);
      });
    });
  } finally {
    p.cleanup();
    fs.rmSync(otherHome, { recursive: true, force: true });
  }
});

// --- secrets ---

test('a push or merge refusal never includes a key', async () => {
  const p = await project();
  const basic = Buffer.from(`x-access-token:${FAKE_KEY}`).toString('base64');
  const env = {
    GH_TOKEN: FAKE_KEY,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://127.0.0.1/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
  const calls = [];
  const recordingRun = async (file, args, options) => {
    calls.push({ file, args, env: options?.env });
    return run(file, args, options);
  };
  const leaky = fakeAdapter({
    prState: async () => { throw new Error(`gh pr view failed: bad credentials ${FAKE_KEY}`); },
    openPr: async () => { throw new Error(`could not open with ${basic}`); },
  });
  const seen = [];
  const hidden = (answer) => {
    const text = JSON.stringify(answer);
    seen.push(text);
    assert.equal(text.includes(FAKE_KEY), false, text);
    assert.equal(text.includes(basic), false, text);
    assert.equal(/:\/\/[^\s/@]+:[^\s/@]+@/.test(text), false, text);
  };
  try {
    await as(p.home, async () => {
      const dir = stateDir('o__p');
      await g(dir, 'branch', 'feature');
      await withHelper(leaky, async (client) => {
        // A repository address with credentials in it is refused before git runs with the key.
        await g(dir, 'remote', 'set-url', 'origin', `https://x-access-token:${FAKE_KEY}@127.0.0.1:9/o/p.git`);
        const withCredentials = await client.push({ project: 'o__p', dir, refspec: 'feature' });
        assert.equal(withCredentials.ok, false);
        hidden(withCredentials);

        // An address git cannot reach: the push runs, fails, and its output is scrubbed.
        await g(dir, 'remote', 'set-url', 'origin', 'https://127.0.0.1:9/o/p.git');
        const pushed = await client.push({ project: 'o__p', dir, refspec: 'feature' });
        assert.equal(pushed.ok, false);
        assert.match(pushed.refused, /git could not push/);
        hidden(pushed);
        const spelled = await client.push({ project: 'o__p', dir, refspec: `${FAKE_KEY}:main` });
        assert.equal(spelled.ok, false);
        hidden(spelled);
        const merged = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(merged.ok, false);
        hidden(merged);
        const opened = await client.openPr({ project: 'o__p', head: 'feature', base: 'main', title: 't', body: '' });
        assert.equal(opened.ok, false);
        hidden(opened);
      }, { envFor: async () => env, run: recordingRun });

      // The key reached git only through its environment.
      assert.ok(calls.length > 0);
      for (const call of calls) {
        assert.equal(call.args.join(' ').includes(FAKE_KEY), false);
        assert.equal(call.args.join(' ').includes(basic), false);
      }
      const pushes = calls.filter((c) => c.args.includes('push'));
      assert.ok(pushes.some((c) => c.env?.GIT_CONFIG_VALUE_0 === env.GIT_CONFIG_VALUE_0));
      assert.ok(pushes.every((c) => !c.args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force') || a.startsWith('+'))));
      // The copy from the folder runs with no key at all.
      const copies = calls.filter((c) => c.args.includes('fetch') && c.args.includes(dir));
      assert.ok(copies.length > 0);
      assert.ok(copies.every((c) => c.env?.GH_TOKEN === undefined && c.env?.GIT_CONFIG_VALUE_0 === undefined));
    });
  } finally { p.cleanup(); }
  assert.equal(seen.length, 5);
});

test('a declined merge reason is scrubbed of the key', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      reviewAndApproval();
      const adapter = fakeAdapter({ merge: async () => ({ merged: false, reason: `refused for ${FAKE_KEY}` }) });
      await withHelper(adapter, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.ok, false);
        assert.equal(JSON.stringify(answer).includes(FAKE_KEY), false);
      }, { envFor: async () => ({ GH_TOKEN: FAKE_KEY }) });
    });
  } finally { p.cleanup(); }
});

test('only keys are hidden: a GitLab address in an answer is kept', async () => {
  const home = shortHome();
  const header = `AUTHORIZATION: basic ${Buffer.from(`oauth2:${FAKE_KEY}`).toString('base64')}`;
  const env = { GITLAB_TOKEN: FAKE_KEY, GITLAB_HOST: 'gitlab.example.com', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://gitlab.example.com/.extraheader', GIT_CONFIG_VALUE_0: header };
  assert.deepEqual(new Set(secretsOf(env)), new Set([FAKE_KEY, header, header.split(' ').pop(), `oauth2:${FAKE_KEY}`]));
  try {
    await as(home, () => withHelper(fakeAdapter({ openPr: async () => ({ number: 3, url: 'https://gitlab.example.com/o/p/-/merge_requests/3' }) }), async (client) => {
      const opened = await client.openPr({ project: 'o__p', head: 'feature', base: 'main', title: 't', body: '' });
      assert.deepEqual(opened, { ok: true, result: { number: 3, url: 'https://gitlab.example.com/o/p/-/merge_requests/3' } });
    }, { envFor: async () => env }));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('pushFor adapts the helper client to the injected push', async () => {
  const asked = [];
  const client = { push: async (args) => { asked.push(args); return { ok: true }; } };
  const push = pushFor(client, 'o__p');
  assert.deepEqual(await push('/some/dir', 'wheelhouse-state'), { ok: true });
  assert.deepEqual(asked, [{ project: 'o__p', dir: '/some/dir', refspec: 'wheelhouse-state' }]);
});

test('the client answers plainly when no helper is running', async () => {
  const home = shortHome();
  try {
    const answer = await helperClient({ address: testAddress(home) }).push({ project: 'o__p', dir: home, refspec: 'x' });
    assert.equal(answer.ok, false);
    assert.match(answer.refused, /helper/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// --- fix round 2 ---

async function withProcessEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('quick keeps the system and user git config for keyed calls; narrow switches both off', async () => {
  const p = await project();
  try {
    await withProcessEnv({ GIT_SSH_COMMAND: 'inherited-should-not-reach-git', GIT_CONFIG_PARAMETERS: "'core.hookspath'='/tmp'" }, () => as(p.home, async () => {
      const dir = stateDir('o__p');
      await g(dir, 'branch', 'feature');
      const cases = [
        ['quick, bare', async () => ({}), 'quick'],
        ['quick, said', async () => ({ mode: 'quick', env: {} }), 'quick'],
        ['narrow, said', async () => ({ mode: 'narrow', env: { GH_TOKEN: FAKE_KEY } }), 'narrow'],
        ['narrow, bare', async () => ({ GH_TOKEN: FAKE_KEY }), 'narrow'],
      ];
      for (const [label, envFor, mode] of cases) {
        const calls = [];
        const recordingRun = async (file, args, options) => { calls.push({ args, options }); return run(file, args, options); };
        await withHelper(fakeAdapter(), async (client) => {
          await g(dir, 'commit', '-q', '--allow-empty', '-m', label);
          await g(dir, 'branch', '-f', 'feature');
          assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true }, label);
        }, { envFor, run: recordingRun });
        const push = calls.find((c) => c.args.includes('push'));
        if (mode === 'quick') {
          assert.equal(push.options.env.GIT_CONFIG_NOSYSTEM, undefined, label);
          assert.equal(push.options.env.GIT_CONFIG_GLOBAL, undefined, label);
        } else {
          assert.equal(push.options.env.GIT_CONFIG_NOSYSTEM, '1', label);
          assert.equal(push.options.env.GIT_CONFIG_GLOBAL, '/dev/null', label);
          assert.equal(push.options.env.GH_TOKEN, FAKE_KEY, label);
        }
        const copy = calls.find((c) => c.args.includes('fetch') && c.args.includes(dir));
        assert.equal(copy.options.env.GIT_NO_LAZY_FETCH, '1', label);
        assert.equal(copy.options.env.GIT_CONFIG_NOSYSTEM, '1', label);
        assert.equal(copy.options.env.GH_TOKEN, undefined, label);
        for (const call of calls) {
          assert.deepEqual(Object.keys(call.options.baseEnv).filter((k) => /^GIT_/i.test(k)), [], `${label}: no inherited GIT_* variable`);
          assert.ok(call.options.timeoutMs > 0, `${label}: every call has a time limit`);
        }
      }
    }));
  } finally { p.cleanup(); }
});

test('a partial clone in the folder cannot fetch through its own remote, even when the helper inherits GIT_NO_LAZY_FETCH=0', async () => {
  const p = await project();
  const leaks = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-lk-'));
  try {
    await withProcessEnv({ GIT_NO_LAZY_FETCH: '0' }, () => as(p.home, async () => {
      const agent = await agentClone(p.remote.url);
      await g(agent, 'checkout', '-q', '-b', 'feature');
      // The commit names a blob the folder does not have.
      const blob = (await run('git', ['hash-object', '-w', '--stdin'], { cwd: agent, input: 'a missing blob\n' })).stdout.trim();
      await g(agent, 'update-index', '--add', '--cacheinfo', `100644,${blob},m.txt`);
      await g(agent, 'commit', '-q', '-m', 'Needs the blob');
      fs.rmSync(path.join(agent, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
      const script = path.join(leaks, 'ssh.sh');
      fs.writeFileSync(script, `#!/bin/sh\nenv > "${path.join(leaks, 'ssh.txt').split(path.sep).join('/')}"\ncat >/dev/null\nexit 1\n`, { mode: 0o755 });
      await g(agent, 'config', 'remote.origin.promisor', 'true');
      await g(agent, 'config', 'extensions.partialClone', 'origin');
      await g(agent, 'config', 'remote.origin.url', 'ssh://git@example.invalid/x');
      await g(agent, 'config', 'core.sshCommand', script.split(path.sep).join('/'));

      await withHelper(fakeAdapter(), async (client) => {
        const started = Date.now();
        const answer = await client.push({ project: 'o__p', dir: agent, refspec: 'feature' });
        assert.deepEqual(answer, { ok: false, refused: PUSH_REFUSALS.missing });
        assert.ok(Date.now() - started < 30000, 'refused promptly');
      }, { envFor: async () => ({ GH_TOKEN: FAKE_KEY }) });
      assert.deepEqual(fs.readdirSync(leaks).filter((f) => f.endsWith('.txt')), []);
      assert.doesNotMatch(await remoteHeads(p.remote.url), /refs\/heads\/feature /);
      fs.rmSync(agent, { recursive: true, force: true });
    }));
  } finally {
    p.cleanup();
    fs.rmSync(leaks, { recursive: true, force: true });
  }
});

test('a folder that takes too long to read is refused', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      const dir = stateDir('o__p');
      await g(dir, 'branch', 'feature');
      const slowFolder = async (file, args, options) => (args.includes('fetch') && args.includes(dir)
        ? { code: 1, stdout: '', stderr: '', timedOut: true }
        : run(file, args, options));
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: false, refused: 'reading the folder took too long' });
      }, { run: slowFolder });
    });
  } finally { p.cleanup(); }
});

test('pushes and merges at once share the lock clone without tripping over each other', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      reviewAndApproval();
      const dir = stateDir('o__p');
      for (const b of ['f1', 'f2', 'f3']) await g(dir, 'branch', b);
      await withHelper(fakeAdapter(), async (client) => {
        const answers = await Promise.all([
          ...['f1', 'f2', 'f3'].map((b) => client.push({ project: 'o__p', dir, refspec: b })),
          ...[1, 2, 3].map(() => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false })),
        ]);
        assert.ok(answers.every((a) => a.ok === true), JSON.stringify(answers));
      });
    });
  } finally { p.cleanup(); }
});
