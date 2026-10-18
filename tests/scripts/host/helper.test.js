// tests/scripts/host/helper.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startHelper, PUSH_REFUSALS, secretsOf } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { helperAddress, stateDir, stopFile } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, eventPath, writeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';

const HEAD = `abc1234${'0'.repeat(33)}`;
const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const HOUR = 3600000;
const FAKE_KEY = 'ghs_FAKEKEY0123456789abcdefSECRET';
const LOCK_REASON = 'this computer no longer holds the lock';
// These projects' remotes hold no pull request, so its changed files can't be read.
const UNREADABLE = 'the changed files couldn\'t be read, so this needs the director\'s approval';
const NONE_FOUND = { guardrailPaths: [], criticalAreas: [] };
const unix = process.platform !== 'win32';
const unixOnly = unix ? false : 'socket files exist only on macOS and Linux';

function fakeAdapter(overrides = {}) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'open' }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    branchHead: async () => HEAD,
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
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
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
  const dir = tempFolder('wh-ag-');
  await g(os.tmpdir(), 'clone', '-q', '--branch', branch, remoteUrl, dir);
  return dir;
}
const remoteFile = async (remoteUrl, ref, file) => (await run('git', ['--no-replace-objects', 'show', `${ref}:${file}`], { cwd: remoteUrl })).stdout;
const remoteHeads = async (remoteUrl) => (await run('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'], { cwd: remoteUrl })).stdout;

// --- the address ---

const PLUGIN_VERSION = JSON.parse(fs.readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;

test('/health answers with the plugin version, read from the plugin\'s own plugin.json', async () => {
  const home = shortHome();
  try {
    await as(home, () => withHelper(fakeAdapter(), async (client) => {
      assert.deepEqual(await client.health(), { ok: true, version: PLUGIN_VERSION });
    }));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the helper answers on a socket, and on a named pipe on Windows', async () => {
  const home = shortHome();
  try {
    await as(home, () => withHelper(fakeAdapter(), async (client, helper) => {
      assert.equal((await client.health()).ok, true);
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
      assert.equal((await client.health()).ok, true, 'the first is untouched');
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
        assert.equal((await client.health()).ok, true);
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
      assert.equal((await client.health()).ok, true, 'the helper is still answering');
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

test('a state write goes through even when the remote moved on, and /push refuses a force and a missing folder', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const first = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'hello' } });
      assert.equal(first.pushed, true);

      // Another clone moves the branch on; this clone's next push is not a fast-forward, so the helper pulls and tries again.
      const other = await agentClone(p.remote.url);
      fs.mkdirSync(path.join(other, 'events', 'x'), { recursive: true });
      fs.writeFileSync(path.join(other, 'events', 'x', 'a.json'), '{}\n');
      await g(other, 'add', '-A');
      await g(other, 'commit', '-q', '-m', 'x');
      await g(other, 'push', '-q', 'origin', 'wheelhouse-state');
      const second = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'after the move' } });
      assert.equal(second.pushed, true);
      assert.ok((await remoteFile(p.remote.url, 'wheelhouse-state', 'events/x/a.json')).includes('{}'), 'the other clone\'s file is still there');

      const dir = stateDir('o__p');
      assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: '+wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.force });
      const missing = await client.push({ project: 'o__p', dir: path.join(dir, 'nowhere'), refspec: 'feature' });
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
        assert.equal((await client.lock.take({ project: 'o__p' })).result.taken, true, 'a lock push needs no lock');
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true });
      });
    });
  } finally { p.cleanup(); }
});

// An event on the remote, written through the helper, and an agent's clone of it.
async function stateWithEvent(p, client) {
  const written = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'original' } });
  assert.equal(written.pushed, true);
  const rel = (await run('git', ['ls-tree', '-r', '--name-only', 'wheelhouse-state', 'events'], { cwd: p.remote.url })).stdout.trim();
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
      assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', rel), original);

      // A plain new event from the agent's copy is refused too: only the state route pushes state.
      await g(agent, 'reset', '-q', '--hard', 'HEAD~1');
      fs.mkdirSync(path.join(agent, 'events', 'n'), { recursive: true });
      fs.writeFileSync(path.join(agent, 'events', 'n', 'forged.json'), '{}\n');
      await g(agent, 'add', '-A');
      await g(agent, 'commit', '-q', '-m', 'A new event');
      assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', 'events/n/forged.json'), '');
      // Not even the clone's own folder, nor a spelling of its path.
      for (const dir of [stateDir('o__p'), path.join(stateDir('o__p'), 'events', '..')]) {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      }
      fs.rmSync(agent, { recursive: true, force: true });

      // The lock branch: an agent's copy is refused, and so is the lock clone itself.
      assert.equal((await client.lock.take({ project: 'o__p' })).result.taken, true);
      const lockCopy = await agentClone(p.remote.url, 'wheelhouse-lock');
      fs.writeFileSync(path.join(lockCopy, 'lock.json'), '{"holder":"someone else"}\n');
      await g(lockCopy, 'commit', '-q', '-am', 'Take the lock');
      assert.deepEqual(await client.push({ project: 'o__p', dir: lockCopy, refspec: 'wheelhouse-lock' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      assert.deepEqual(await client.push({ project: 'o__p', dir: path.join(stateDir('o__p'), '..', 'lock'), refspec: 'wheelhouse-lock' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      assert.doesNotMatch(await remoteFile(p.remote.url, 'wheelhouse-lock', 'lock.json'), /someone else/);
      fs.rmSync(lockCopy, { recursive: true, force: true });
    }));
  } finally { p.cleanup(); decoy.cleanup(); }
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
      const synced = await client.state.sync({ project: 'o__p' });
      assert.equal(synced.ok, true);
      assert.ok(synced.unpushed > 0, 'the changed event was not pushed');
      const retry = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'again' } });
      assert.equal(retry.pushed, false);
      assert.equal(retry.refused, PUSH_REFUSALS.state);
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
      const answer = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'while shallow' } });
      assert.equal(answer.pushed, false);
      assert.ok([PUSH_REFUSALS.state, PUSH_REFUSALS.shallow, PUSH_REFUSALS.missing].includes(answer.refused), answer.refused);
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', rel), original);
      // The mirror is not left shallow: once the clone is put right, a plain event push still goes through.
      fs.rmSync(shallow, { force: true });
      await g(dir, 'reset', '-q', '--hard', tip);
      const next = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'after' } });
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
        const answer = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'after the file' } });
        assert.equal(answer.pushed, false, rel);
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
      assert.deepEqual(await client.state.sync({ project: 'o__p' }), { ok: true, pulled: true, unpushed: 0 });
      assert.equal(await remoteFile(p.remote.url, 'wheelhouse-state', 'events/s/clean.json'), '{"text":"nothing here"}\n');
    }));
  } finally { p.cleanup(); }
});

test('the folder\'s own git config never runs with the key: sshCommand, credential helper, proxy, askpass', async () => {
  const p = await project();
  const leaks = tempFolder('wh-lk-');
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
        assert.deepEqual(refused.reasons, [LOCK_REASON, UNREADABLE], 'without the environment the lock cannot be read');
      });
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        assert.deepEqual(await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false }), { ok: true, merged: true, sha: HEAD, ...NONE_FOUND });
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
      const answer = await client.merge({ project: 'o__p', number: 7, stop: true, bypass: true });
      assert.equal(answer.ok, false);
      assert.deepEqual(answer.reasons, [
        'STOP is on',
        'the session is in bypass mode',
        LOCK_REASON,
        'CI has not passed on abc1234',
        'no CLEAN review of abc1234',
        'no approval of abc1234',
        UNREADABLE,
      ]);
      assert.equal(answer.refused, answer.reasons.join('; '));

      // A review is always required; with the changed files unreadable, so is the approval.
      const lighter = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false, reviewRequired: false, approvalRequired: false, touchesGuardrails: false });
      assert.deepEqual(lighter.reasons, [LOCK_REASON, 'CI has not passed on abc1234', 'no CLEAN review of abc1234', 'no approval of abc1234', UNREADABLE]);
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
        assert.deepEqual(answer, { ok: true, merged: true, sha: HEAD, ...NONE_FOUND });
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
        assert.deepEqual(answer.reasons, ['STOP is on', UNREADABLE]);
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
        assert.deepEqual(answer, { ok: false, refused: 'the head moved', ...NONE_FOUND });
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
        assert.deepEqual(answer.reasons, [LOCK_REASON, UNREADABLE]);
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
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'http.https://127.0.0.1/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    // The address below can be read (so the lock, whose remote must be the state clone's, holds)
    // but a push to it goes nowhere.
    GIT_CONFIG_KEY_1: `url.${p.remote.url}.insteadOf`,
    GIT_CONFIG_VALUE_1: 'https://127.0.0.1:9/o/p.git',
    GIT_CONFIG_KEY_2: 'url.https://127.0.0.1:9/nowhere/.pushInsteadOf',
    GIT_CONFIG_VALUE_2: 'https://127.0.0.1:9/o/',
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
        assert.match(pushed.refused, /git could not push|could not be checked/);
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
      assert.ok(calls.some((c) => c.args.includes('fetch') && c.env?.GIT_CONFIG_VALUE_0 === env.GIT_CONFIG_VALUE_0), 'the key reached git, through its environment');
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

test('the client has the state and lock requests, and no pushFor', async () => {
  const client = helperClient({ address: '/nowhere' });
  assert.deepEqual(Object.keys(client.state), ['clone', 'write', 'record', 'sync', 'views', 'backup']);
  assert.deepEqual(Object.keys(client.profile), ['clone', 'write', 'record', 'sync', 'views']);
  assert.deepEqual(Object.keys(client.lock), ['take', 'touch', 'read']);
  assert.equal((await import('../../../scripts/host/helper-client.js')).pushFor, undefined);
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

test('a partial clone in the folder is refused before git runs in it, so nothing it names runs, even when the helper inherits GIT_NO_LAZY_FETCH=0', async () => {
  const p = await project();
  const leaks = tempFolder('wh-lk-');
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
        assert.deepEqual(answer, { ok: false, refused: PUSH_REFUSALS.partialClone });
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

test('a half-made state clone gives its hint through a state route', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      // the remote's branch was never copied in, as after a start cut short before its push
      await g(stateDir('o__p'), 'update-ref', '-d', 'refs/remotes/origin/wheelhouse-state');
      await withHelper(fakeAdapter(), async (client) => {
        const answer = await client.state.sync({ project: 'o__p' });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /Delete the folder and run again/);
      });
    });
  } finally { p.cleanup(); }
});

// ---- Task 16 ----

test('a push that times out is refused, saying so', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      const dir = stateDir('o__p');
      await g(dir, 'branch', 'feature');
      const slowHost = async (file, args, options) => (args.includes('push')
        ? { code: 1, stdout: '', stderr: '', timedOut: true }
        : run(file, args, options));
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: false, refused: 'the host did not answer the push in time' });
      }, { run: slowHost });
      assert.doesNotMatch(await remoteHeads(p.remote.url), /refs\/heads\/feature /);
    });
  } finally { p.cleanup(); }
});

test('the mirror drops its per-request refs, keeps the base, and tidies after the answer, behind it in the queue', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      reviewAndApproval();
      const dir = stateDir('o__p');
      const mirror = path.join(dir, '..', 'mirror.git');
      await g(dir, 'branch', 'feature');
      await g(dir, 'branch', 'second');
      const calls = [];
      const recording = async (file, args, options) => { calls.push({ args, cwd: options?.cwd }); return run(file, args, options); };
      const refs = async () => (await run('git', ['for-each-ref', '--format=%(refname)', 'refs/wheelhouse/'], { cwd: mirror })).stdout.trim();
      const collected = (from) => calls.slice(from).some((c) => c.args.includes('gc') && c.args.includes('--auto') && c.cwd === mirror);
      // The tidy runs after the answer, behind it on the same queue: wait until it has run.
      const waitForGc = async (from) => {
        for (let i = 0; i < 100 && !collected(from); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        return collected(from);
      };
      await withHelper(fakeAdapter(), async (client) => {
        let mark = calls.length;
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true });
        assert.equal(await waitForGc(mark), true, 'git gc --auto ran after the push');
        assert.equal(await refs(), '', 'no per-request ref is left after a push');

        // The base is the ref the next fetch negotiates from; the rest are made per request.
        const head = await g(dir, 'rev-parse', 'feature');
        for (const name of ['base', 'pr/7', 'incoming', 'pr/9']) await run('git', ['update-ref', `refs/wheelhouse/${name}`, head], { cwd: mirror });
        mark = calls.length;
        const merged = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(merged.ok, true, JSON.stringify(merged));
        assert.equal(await waitForGc(mark), true, 'git gc --auto ran after the merge');
        assert.equal(await refs(), 'refs/wheelhouse/base');

        mark = calls.length;
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'second' }), { ok: true });
        assert.equal(await waitForGc(mark), true);
        assert.equal(await refs(), 'refs/wheelhouse/base', 'the base survives the tidy after a push');
        assert.match(await remoteHeads(p.remote.url), /refs\/heads\/second /);
      }, { run: recording });
    });
  } finally { p.cleanup(); }
});

test('a folder\'s own uploadpack.packObjectsHook is not run', async () => {
  const p = await project();
  const scratch = tempFolder('wh-hook-');
  try {
    await as(p.home, async () => {
      const agent = await agentClone(p.remote.url);
      await g(agent, 'checkout', '-q', '-b', 'feature');
      await g(agent, 'commit', '-q', '--allow-empty', '-m', 'Work');
      const slash = (file) => file.split(path.sep).join('/');
      const script = path.join(scratch, 'hook.js');
      const marker = path.join(scratch, 'ran-in-folder');
      const control = path.join(scratch, 'ran-from-command-line');
      fs.writeFileSync(script, 'require("node:fs").writeFileSync(process.argv[2], "ran"); process.exit(1);\n');
      const hook = (file) => `node ${slash(script)} ${slash(file)}`;
      await g(agent, 'config', 'uploadpack.packObjectsHook', hook(marker));

      // The control: the same hook in global configuration is run by upload-pack, so the marker can appear.
      const globalConfig = path.join(scratch, 'global-config');
      fs.writeFileSync(globalConfig, `[uploadpack]\n\tpackObjectsHook = ${hook(control)}\n`);
      const probe = tempFolder('wh-probe-');
      await run('git', ['init', '-q', '--bare', probe]);
      await run('git', ['fetch', '-q', agent, 'feature:refs/heads/x'], { cwd: probe, env: { GIT_CONFIG_GLOBAL: globalConfig, GIT_TERMINAL_PROMPT: '0' } });
      fs.rmSync(probe, { recursive: true, force: true });
      assert.equal(fs.existsSync(control), true, 'the hook is one git runs when it is in global configuration');

      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'feature' }), { ok: true });
      });
      assert.equal(fs.existsSync(marker), false, 'a repository\'s own setting is not honoured by git, so the hook did not run');
      fs.rmSync(agent, { recursive: true, force: true });
    });
  } finally { p.cleanup(); fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('two helpers starting at once leave one running and none orphaned', { skip: unixOnly }, async () => {
  const home = shortHome();
  try {
    await as(home, async () => {
      for (let round = 0; round < 8; round += 1) {
        const address = testAddress(home);
        const start = () => startHelper({ address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}) });
        const settled = await Promise.allSettled([start(), start(), start()]);
        const running = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
        try {
          assert.equal(running.length, 1, `round ${round}: ${settled.map((s) => s.status).join(', ')}`);
          for (const s of settled.filter((x) => x.status === 'rejected')) assert.match(s.reason.message, /already/i);
          // The one that is left answers on the path the others would have used.
          assert.equal((await helperClient({ address }).health()).ok, true);
          assert.equal(fs.lstatSync(address).isSocket(), true);
          assert.equal(fs.existsSync(`${address}.start`), false, 'the start lock is released');
        } finally {
          await Promise.all(running.map((h) => h.close()));
        }
      }
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a start lock left by a process that has gone is taken over', { skip: unixOnly }, async () => {
  const home = shortHome();
  try {
    await as(home, async () => {
      const address = testAddress(home);
      const gone = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['-e', '0']);
        child.on('exit', () => resolve(child.pid));
      });
      fs.writeFileSync(`${address}.start`, `${gone}\n`);
      await withHelper(fakeAdapter(), async (client) => {
        assert.equal((await client.health()).ok, true);
      });
      assert.equal(fs.existsSync(`${address}.start`), false);
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a helper that finds another starting says so in its own words', { skip: unixOnly }, async () => {
  const home = shortHome();
  try {
    await as(home, async () => {
      const address = testAddress(home);
      fs.writeFileSync(`${address}.start`, `${process.pid}\n`);
      await assert.rejects(
        startHelper({ address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}), startWaitMs: 150 }),
        /Another helper is starting/,
      );
      assert.equal(fs.existsSync(`${address}.start`), true, 'a lock that is not ours is left alone');
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// --- host facts ---

const ghFixture = (name) => fs.readFileSync(new URL(`../../fixtures/host/github/${name}`, import.meta.url), 'utf8');
// A fake `gh` that answers the free-plan private repository, as the protection read asks.
const freePlanRun = async (file, args) => {
  const answers = { 'repos/o/p': ghFixture('repo-private-free.json'), user: ghFixture('user-free.json') };
  return args[1] in answers ? { code: 0, stdout: answers[args[1]], stderr: '' } : { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
};

test('/host/facts says whether protection is on and whether the default branch has any CI', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      const heads = [];
      const none = fakeAdapter({ branchHead: async (branch) => { heads.push(branch); return HEAD; }, ciState: async (sha) => ({ sha, state: 'none' }) });
      await withHelper(none, async (client) => {
        assert.deepEqual(await client.host.facts({ project: 'o__p' }), { ok: true, protection: 'none', ci: 'none' });
        assert.deepEqual(heads, ['main'], 'the head asked for is the default branch\'s');
      }, { run: freePlanRun });
      for (const state of ['success', 'pending', 'failure']) {
        await withHelper(fakeAdapter({ ciState: async (sha) => ({ sha, state }) }), async (client) => {
          assert.equal((await client.host.facts({ project: 'o__p' })).ci, 'present', state);
        }, { run: freePlanRun });
      }
    });
  } finally { p.cleanup(); }
});

test('/host/facts says unknown for what the host would not tell, and still answers the rest', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      const broken = fakeAdapter({ branchHead: async () => { throw new Error('the host is down'); } });
      await withHelper(broken, async (client) => {
        assert.deepEqual(await client.host.facts({ project: 'o__p' }), { ok: true, protection: 'none', ci: 'unknown' });
      }, { run: freePlanRun });
      const refused = async () => ({ code: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' });
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.host.facts({ project: 'o__p' }), { ok: true, protection: 'unknown', ci: 'present' });
      }, { run: refused });
    });
  } finally { p.cleanup(); }
});
