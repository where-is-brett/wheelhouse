// tests/scripts/host/helper.test.js
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startHelper, PUSH_REFUSALS, secretsOf, GITLAB_MAINTAINERS_ONLY } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { helperAddress, profileDir, stateDir, stopFile } from '../../../scripts/lib/paths.js';
import { openSettings } from '../../../scripts/state/record.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord, registerTestProject } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath, writeEvent, listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { readReadyRecord } from '../../../scripts/survey/ready-record.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';
import { prOnHost } from '../../helpers/pr-on-host.js';
import { matchingBody, writeSessionProvenance } from '../../helpers/provenance.js';
import { until } from '../../helpers/until.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();

const HEAD = `abc1234${'0'.repeat(33)}`;
const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const HOUR = 3600000;
const FAKE_KEY = 'ghs_FAKEKEY0123456789abcdefSECRET';
const LOCK_REASON = 'this computer no longer holds the lock';
// These projects' remotes hold no pull request, so its changed files can't be read, nor
// whether it is up to date; a test that merges puts one there with prOnHost.
const UNREADABLE = 'the changed files couldn\'t be read, so this needs the director\'s approval';
// The mirror can't read the pull request in these tests, so whether it is up to date is not known.
const UNCHECKED = 'whether the branch is up to date could not be checked';
const openAt = (head) => async () => ({ headSha: head, mergeable: 'mergeable', state: 'open', body: BODY });
const NONE_FOUND = { guardrailPaths: [], criticalAreas: [] };
const unix = process.platform !== 'win32';
const unixOnly = unix ? false : 'socket files exist only on macOS and Linux';

function fakeAdapter(overrides = {}) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'open', body: BODY }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    branchHead: async () => HEAD,
    hasCi: async () => true,
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
    run: hostGuard,
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

// A home with an enrolled signing key, the project's private record, and (optionally) the lock taken.
async function project({ lock = true } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    if (lock) assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
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

// An agent's folder: a clone of the project's remote, outside ~/.wheelhouse. The remote is given a
// main branch first when it has none.
async function agentClone(remoteUrl, branch = 'main') {
  if (branch === 'main' && (await g(os.tmpdir(), 'ls-remote', '--heads', remoteUrl, 'refs/heads/main')) === '') {
    const seed = tempFolder('wh-seed-');
    await g(seed, 'init', '-q', '-b', 'main');
    await g(seed, 'commit', '-q', '--allow-empty', '-m', 'Base');
    await g(seed, 'push', '-q', remoteUrl, 'HEAD:refs/heads/main');
    fs.rmSync(seed, { recursive: true, force: true });
  }
  const dir = tempFolder('wh-ag-');
  await g(os.tmpdir(), 'clone', '-q', '--branch', branch, remoteUrl, dir);
  return dir;
}
const remoteFile = async (remoteUrl, ref, file) => (await run('git', ['--no-replace-objects', 'show', `${ref}:${file}`], { cwd: remoteUrl })).stdout;
const remoteHeads = async (remoteUrl) => (await run('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'], { cwd: remoteUrl })).stdout;

// The events `ids` are committed in the project's private record, which has no remote, and nothing
// of the record reached the project's repository: no state branch, and not the record's commits.
async function inRecordOnly(remoteUrl, ids) {
  const dir = stateDir('o__p');
  assert.equal(await g(dir, 'remote'), '', 'the record has no remote');
  const subjects = (await g(dir, 'log', '--format=%s')).split('\n');
  for (const id of ids) assert.ok(subjects.some((line) => line.endsWith(` ${id}`)), `${id} is committed in the record`);
  assert.equal(await g(dir, 'status', '--porcelain', '--', 'events'), '', 'no event is left uncommitted');
  assert.doesNotMatch(await remoteHeads(remoteUrl), /wheelhouse-state|refs\/heads\/record /);
  const tip = await g(dir, 'rev-parse', 'HEAD');
  const there = await run('git', ['cat-file', '-e', `${tip}^{commit}`], { cwd: remoteUrl });
  assert.notEqual(there.code, 0, 'the record\'s commits are not on the remote');
}

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
      assert.deepEqual(state, { ok: true, result: { headSha: HEAD, mergeable: 'mergeable', state: 'open', body: BODY } });
      if (unix) assert.equal(fs.statSync(helper.address).mode & 0o077, 0);
      else assert.match(helper.address, /^\\\\\.\\pipe\\wheelhouse-.+-[0-9a-f]{12}-helper$/);
    }));
    if (unix) assert.equal(fs.existsSync(path.join(home, 'helper.sock')), false, 'close removes the socket file');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the Windows address is a named pipe for the user', () => {
  assert.equal(helperAddress({ platform: 'win32', user: 'Zoë Smith', home: path.join(os.homedir(), '.wheelhouse') }), '\\\\.\\pipe\\wheelhouse-Zo__Smith-helper');
});

test('a socket path that is too long is refused with a plain error', { skip: unixOnly }, async () => {
  const address = path.join(os.tmpdir(), 'x'.repeat(120), 'helper.sock');
  await assert.rejects(startHelper({ run: hostGuard, address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}) }), /too long/);
});

test('a second helper refuses to start while the first answers', async () => {
  const home = shortHome();
  try {
    await as(home, () => withHelper(fakeAdapter(), async (client, helper) => {
      await assert.rejects(
        startHelper({ run: hostGuard, address: helper.address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}) }),
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

test('a state write is committed in the local record and never reaches the remote, and /push refuses a force and a missing folder', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const first = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'hello' } });
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.pushed, false);
      const second = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'and again' } });
      assert.equal(second.pushed, false);
      await inRecordOnly(p.remote.url, [first.id, second.id]);
      assert.deepEqual(await client.state.sync({ project: 'o__p' }), { ok: true, pulled: 0, unpushed: 0 });

      const dir = stateDir('o__p');
      assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: '+wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.force });
      const missing = await client.push({ project: 'o__p', dir: path.join(dir, 'nowhere'), refspec: 'feature' });
      assert.equal(missing.ok, false);
    }));
  } finally { p.cleanup(); }
});

// An agent can write a .git file, a .git symlink or a commondir with Bash: none of them may hand the private record
// or the settings to the host (design section 24.7). The git directory is found by real path, and refused when it
// is outside the project or inside Wheelhouse's own folder, or borrows objects or refs from elsewhere.
test('a folder whose git directory leads to the private record or the settings is refused, however it gets there', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      await openSettings();
      const record = path.join(stateDir('o__p'), '.git');
      const settings = path.join(profileDir(), '.git');
      const tip = await g(stateDir('o__p'), 'rev-parse', 'HEAD');
      const folder = async (make) => { const dir = tempFolder('wh-x-'); await make(dir); return dir; };
      const cases = [
        ['a .git file naming the record', 'record', await folder((d) => fs.writeFileSync(path.join(d, '.git'), `gitdir: ${record}\n`))],
        ['a .git file naming the settings', 'record', await folder((d) => fs.writeFileSync(path.join(d, '.git'), `gitdir: ${settings}\n`))],
        ['a .git symlink to the record', 'record', await folder((d) => fs.symlinkSync(record, path.join(d, '.git'), 'dir'))],
        ['a commondir naming the record', 'record', await folder(async (d) => {
          const gitdir = path.join(d, 'gd');
          fs.mkdirSync(path.join(gitdir, 'refs'), { recursive: true });
          fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/record\n');
          fs.writeFileSync(path.join(gitdir, 'commondir'), `${record}\n`);
          fs.writeFileSync(path.join(d, '.git'), `gitdir: ${gitdir}\n`);
        })],
        ['the record itself', 'record', stateDir('o__p')],
        // A decoy: x/.git is not a repository, so git would pass it over and read x itself, whose
        // commondir names the record.
        ['a decoy .git beside a commondir naming the record', 'record', await folder((d) => {
          fs.mkdirSync(path.join(d, '.git'));
          fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/record\n');
          fs.writeFileSync(path.join(d, 'HEAD'), 'ref: refs/heads/record\n');
          fs.writeFileSync(path.join(d, 'commondir'), `${record}\n`);
        })],
        ['an alternates file borrowing the record\'s objects', 'feature', await folder(async (d) => {
          await g(d, 'init', '-q', '-b', 'feature');
          fs.writeFileSync(path.join(d, '.git', 'objects', 'info', 'alternates'), `${path.join(record, 'objects')}\n`);
          fs.writeFileSync(path.join(d, '.git', 'refs', 'heads', 'feature'), `${tip}\n`);
        })],
        ['a symlinked ref', 'feature', await folder(async (d) => {
          await g(d, 'init', '-q', '-b', 'feature');
          fs.symlinkSync(path.join(record, 'refs', 'heads', 'record'), path.join(d, '.git', 'refs', 'heads', 'feature'));
        })],
        ['a symlinked objects folder', 'feature', await folder(async (d) => {
          await g(d, 'init', '-q', '-b', 'feature');
          fs.rmSync(path.join(d, '.git', 'objects'), { recursive: true });
          fs.symlinkSync(path.join(record, 'objects'), path.join(d, '.git', 'objects'), 'dir');
          fs.writeFileSync(path.join(d, '.git', 'refs', 'heads', 'feature'), `${tip}\n`);
        })],
      ];
      await withHelper(fakeAdapter(), async (client) => {
        for (const [label, refspec, dir] of cases) {
          assert.deepEqual(await client.push({ project: 'o__p', dir, refspec }), { ok: false, refused: PUSH_REFUSALS.gitOutside }, label);
        }
        // A plain folder in the project still pushes.
        assert.deepEqual(await client.push({ project: 'o__p', dir: await folderWith(), refspec: 'feature' }), { ok: true });
      });
      assert.doesNotMatch(await remoteHeads(p.remote.url), /refs\/heads\/record /);
      assert.notEqual((await run('git', ['cat-file', '-e', `${tip}^{commit}`], { cwd: p.remote.url })).code, 0, 'the record\'s commits are not on the remote');
    });
  } finally { p.cleanup(); }
});

// What the folder does between the check and the fetch can't matter: a folder that turns its .git into
// one whose commondir names the record just before git reads it has its branch refused once it arrives,
// as it holds the record's root commit, and nothing reaches the host.
test('a folder that points its git directory at the record after the check is refused once the branch arrives', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      const record = path.join(stateDir('o__p'), '.git');
      const tip = await g(stateDir('o__p'), 'rev-parse', 'HEAD');
      const dir = await folderWith();
      await g(dir, 'branch', 'record');
      const swapped = [];
      const swapping = async (file, args, options) => {
        if (args.includes('fetch') && swapped.length === 0 && args.some((a) => typeof a === 'string' && a.startsWith(fs.realpathSync.native(dir)))) {
          const gitdir = path.join(dir, '.git');
          fs.rmSync(gitdir, { recursive: true, force: true });
          fs.mkdirSync(gitdir);
          fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/record\n');
          fs.writeFileSync(path.join(gitdir, 'commondir'), `${record}\n`);
          swapped.push(args);
        }
        return hostGuard(file, args, options);
      };
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'record' }), { ok: false, refused: PUSH_REFUSALS.ownHistory });
      }, { run: swapping });
      assert.equal(swapped.length, 1, 'the folder was swapped just before the fetch');
      const mirror = path.join(stateDir('o__p'), '..', 'mirror.git');
      assert.equal((await run('git', ['for-each-ref', 'refs/wheelhouse/'], { cwd: mirror })).stdout.trim(), '', 'what arrived is not kept');
      assert.notEqual((await run('git', ['cat-file', '-e', `${tip}^{commit}`], { cwd: p.remote.url })).code, 0, 'the record\'s commits are not on the remote');
    });
  } finally { p.cleanup(); }
});

// The check of what arrived fails closed: a record whose root commits can't be read refuses the push.
test('a push is refused when a Wheelhouse record\'s root commits can\'t be read', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      fs.writeFileSync(path.join(stateDir('o__p'), '.git', 'refs', 'heads', 'record'), 'not a commit\n');
      const dir = await folderWith();
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: false, refused: PUSH_REFUSALS.unchecked });
      });
      assert.doesNotMatch(await remoteHeads(p.remote.url), /refs\/heads\/feature /);
    });
  } finally { p.cleanup(); }
});

test('a code push is refused when this computer does not hold the lock', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      const dir = await folderWith();
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: false, refused: LOCK_REASON });
        assert.equal((await client.lock.take({ project: 'o__p' })).result.taken, true, 'a lock push needs no lock');
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true });
      });
    });
  } finally { p.cleanup(); }
});

test('a state or lock push from an agent\'s folder is refused, whatever its remotes say', async () => {
  const p = await project({ lock: false });
  const decoy = await makeBareRemote();
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      // An agent's copy with a state branch of its own, a forged event on it, and remotes that point two ways.
      const agent = await agentClone(p.remote.url);
      await g(agent, 'checkout', '-q', '-b', 'wheelhouse-state');
      fs.mkdirSync(path.join(agent, 'events', 'n'), { recursive: true });
      fs.writeFileSync(path.join(agent, 'events', 'n', 'forged.json'), '{}\n');
      await g(agent, 'add', '-A');
      await g(agent, 'commit', '-q', '-m', 'A new event');
      await g(agent, 'push', '-q', decoy.url, 'HEAD:refs/heads/wheelhouse-state');
      await g(agent, 'remote', 'set-url', 'origin', decoy.url);
      await g(agent, 'remote', 'set-url', '--push', 'origin', p.remote.url);
      assert.deepEqual(await client.push({ project: 'o__p', dir: agent, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      assert.doesNotMatch(await remoteHeads(p.remote.url), /wheelhouse-state/);
      // Not even the private record's own folder, nor a spelling of its path.
      for (const dir of [stateDir('o__p'), path.join(stateDir('o__p'), 'events', '..')]) {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'wheelhouse-state' }), { ok: false, refused: PUSH_REFUSALS.ownRequests });
      }
      assert.doesNotMatch(await remoteHeads(p.remote.url), /wheelhouse-state/);
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

test('a state write carrying a secret is refused, naming the pattern but never the value, and nothing is committed', async () => {
  const p = await project({ lock: false });
  // Built from fragments: no committed literal has a real key's shape.
  const key = ['gh', 'p_', 'aB3'.repeat(12)].join('');
  const aws = ['AK', 'IA', 'Q7'.repeat(8)].join('');
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      const dir = stateDir('o__p');
      const tip = await g(dir, 'rev-parse', 'HEAD');
      for (const [words, pattern] of [[`token ${key}`, 'github-token'], [`pasted:\n${key}`, 'github-token'], [`key\t${aws}`, 'aws-access-key']]) {
        const answer = await client.state.write({ project: 'o__p', kind: 'note', data: { words } });
        assert.equal(answer.ok, false, JSON.stringify(answer));
        assert.ok(answer.refused.includes(pattern), answer.refused);
        assert.ok(!answer.refused.includes(key) && !answer.refused.includes(aws), 'the value is never repeated');
        assert.equal(await g(dir, 'rev-parse', 'HEAD'), tip, 'nothing was committed');
        assert.equal(await g(dir, 'status', '--porcelain', '--', 'events'), '', 'no file was left behind');
      }
      // A clean event still goes in.
      const clean = await client.state.write({ project: 'o__p', kind: 'note', data: { words: 'nothing here' } });
      assert.equal(clean.ok, true, JSON.stringify(clean));
      await inRecordOnly(p.remote.url, [clean.id]);
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
        // The look at the folder's config refuses the push, naming the settings that send git elsewhere or run a
        // program, before git runs there. The settings the fence overrides (core.sshCommand, core.askPass, the
        // credential helper, http.sslVerify, the hooks folder) are let through: no fenced call reads them.
        const answer = await client.push({ project: 'o__p', dir: agent, refspec: 'feature' });
        assert.equal(answer.ok, false);
        for (const key of ['core.gitproxy', 'http.proxy']) assert.ok(answer.refused.toLowerCase().includes(key), `${key}: ${answer.refused}`);
        for (const key of ['core.sshcommand', 'credential.helper', 'core.askpass', 'http.sslverify', 'core.hookspath']) assert.ok(!answer.refused.toLowerCase().includes(key), `${key}: ${answer.refused}`);
      }, { envFor: async () => env });
      assert.doesNotMatch(await remoteHeads(p.remote.url), new RegExp(`refs/heads/feature ${sha}`));
      assert.deepEqual(fs.readdirSync(leaks).filter((f) => f.endsWith('.txt')), [], 'nothing the folder configured ran');
      fs.rmSync(agent, { recursive: true, force: true });
    });
  } finally {
    p.cleanup();
    fs.rmSync(leaks, { recursive: true, force: true });
  }
});

test('the folder\'s origin is irrelevant: the push goes to the project\'s repository as Wheelhouse records it', async () => {
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
    const head = await prOnHost(p.remote.url);
    await as(p.home, async () => {
      reviewAndApproval(head);
      // Wheelhouse's record of the project names an address that exists only through the environment's insteadOf.
      const standIn = path.join(os.tmpdir(), `wh-nowhere-${crypto.randomBytes(4).toString('hex')}`, 'o', 'p.git');
      writeProject('o__p', { folder: os.tmpdir(), remoteUrl: standIn, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      await g(path.join(stateDir('o__p'), '..', 'lock'), 'remote', 'set-url', 'origin', standIn);
      const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${p.remote.url}.insteadOf`, GIT_CONFIG_VALUE_0: standIn };

      await withHelper(fakeAdapter({ prState: openAt(head) }), async (client) => {
        const refused = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.deepEqual(refused.reasons, [LOCK_REASON, UNCHECKED, UNREADABLE], 'without the environment neither the lock nor the mirror can be read');
      });
      // With it, the lock is read and the mirror reads the pull request, so the merge goes through.
      await withHelper(fakeAdapter({ prState: openAt(head) }), async (client) => {
        assert.deepEqual(await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false }), { ok: true, merged: true, sha: head, ...NONE_FOUND });
      }, { envFor: async () => env });
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
        'All stop is on',
        'the session is in bypass mode',
        LOCK_REASON,
        'CI has not passed on abc1234',
        'no CLEAN review of abc1234',
        'no approval of abc1234',
        UNCHECKED,
        UNREADABLE,
      ]);
      assert.equal(answer.refused, answer.reasons.join('; '));

      // A review is always required; with the changed files unreadable, so is the approval.
      const lighter = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false, reviewRequired: false, approvalRequired: false, touchesGuardrails: false });
      assert.deepEqual(lighter.reasons, [LOCK_REASON, 'CI has not passed on abc1234', 'no CLEAN review of abc1234', 'no approval of abc1234', UNCHECKED, UNREADABLE]);
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
    const head = await prOnHost(p.remote.url);
    const adapter = fakeAdapter({ prState: openAt(head) });
    await as(p.home, async () => {
      reviewAndApproval(head);
      await withHelper(adapter, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.deepEqual(answer, { ok: true, merged: true, sha: head, ...NONE_FOUND });
        assert.deepEqual(adapter.merges, [{ number: 7, sha: head }]);
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
        assert.deepEqual(answer.reasons, ['All stop is on', UNCHECKED, UNREADABLE]);
        assert.deepEqual(adapter.merges, []);
      });
    });
  } finally { p.cleanup(); }
});

test('merge is refused when the pull request is not open, or the host declines', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      const closed = fakeAdapter({ prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'merged' }) });
      await withHelper(closed, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /not open/);
        assert.deepEqual(closed.merges, []);
      });
      const head = await prOnHost(p.remote.url);
      reviewAndApproval(head);
      const declines = fakeAdapter({ prState: openAt(head), merge: async () => ({ merged: false, reason: 'the head moved' }) });
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
      await registerTestProject({ project: 'o__p', remote: p.remote });
      assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(3 * HOUR) })).taken, true);
    });
    const adapter = fakeAdapter();
    await as(p.home, async () => {
      reviewAndApproval();
      await withHelper(adapter, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.ok, false);
        assert.deepEqual(answer.reasons, [LOCK_REASON, UNCHECKED, UNREADABLE]);
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
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.https://127.0.0.1/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    // The project's repository can be read (so the lock holds), but a push to it goes nowhere.
    GIT_CONFIG_KEY_1: 'url.https://127.0.0.1:9/nowhere/.pushInsteadOf',
    GIT_CONFIG_VALUE_1: p.remote.url,
  };
  const calls = [];
  const recordingRun = async (file, args, options) => {
    calls.push({ file, args, env: options?.env });
    return hostGuard(file, args, options);
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
      const dir = await folderWith();
      await withHelper(leaky, async (client) => {
        // A recorded repository address with credentials in it is refused before git runs with the key.
        const recorded = { folder: os.tmpdir(), host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } };
        writeProject('o__p', { ...recorded, remoteUrl: `https://x-access-token:${FAKE_KEY}@127.0.0.1:9/o/p.git` });
        const withCredentials = await client.push({ project: 'o__p', dir, refspec: 'feature' });
        assert.equal(withCredentials.ok, false);
        hidden(withCredentials);

        // An address git cannot push to: the push runs, fails, and its output is scrubbed.
        writeProject('o__p', { ...recorded, remoteUrl: p.remote.url });
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
      assert.ok(calls.some((c) => c.args.includes('fetch') && Object.entries(c.env ?? {}).some(([name, value]) => /^GIT_CONFIG_VALUE_\d+$/.test(name) && value === env.GIT_CONFIG_VALUE_0)), 'the key reached git, through its environment');
      assert.ok(pushes.every((c) => !c.args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force') || a.startsWith('+'))));
      // The copy from the folder runs with no key at all.
      const copies = calls.filter((c) => c.args.includes('fetch') && c.args.some((a) => typeof a === 'string' && a.startsWith(fs.realpathSync.native(dir))));
      assert.ok(copies.length > 0);
      assert.ok(copies.every((c) => c.env?.GH_TOKEN === undefined && !pairsOf(c.env ?? {}).some(([, v]) => v.includes(basic))));
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
  const p = await project({ lock: false });
  const home = p.home;
  const header = `AUTHORIZATION: basic ${Buffer.from(`oauth2:${FAKE_KEY}`).toString('base64')}`;
  const env = { GITLAB_TOKEN: FAKE_KEY, GITLAB_HOST: 'gitlab.example.com', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://gitlab.example.com/.extraheader', GIT_CONFIG_VALUE_0: header };
  assert.deepEqual(new Set(secretsOf(env)), new Set([FAKE_KEY, header, header.split(' ').pop(), `oauth2:${FAKE_KEY}`]));
  try {
    await as(home, () => withHelper(fakeAdapter({ openPr: async () => ({ number: 3, url: 'https://gitlab.example.com/o/p/-/merge_requests/3' }) }), async (client) => {
      writeSessionProvenance('o__p', 'sess-1');
      const opened = await client.openPr({ project: 'o__p', head: 'feature', base: 'main', title: 't', body: '', session: 'sess-1' });
      assert.deepEqual(opened, { ok: true, result: { number: 3, url: 'https://gitlab.example.com/o/p/-/merge_requests/3' } });
    }, { envFor: async () => env }));
  } finally { p.cleanup(); }
});

test('the client has the state and lock requests, and no pushFor', async () => {
  const client = helperClient({ address: '/nowhere' });
  assert.deepEqual(Object.keys(client.state), ['clone', 'write', 'record', 'sync', 'import', 'views', 'answer', 'columnReady']);
  assert.deepEqual(Object.keys(client.profile), ['clone', 'write', 'record', 'sync', 'views', 'import']);
  assert.deepEqual(Object.keys(client.lock), ['take', 'touch', 'takeOver', 'read']);
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

const EXTRA = `AUTHORIZATION: basic ${Buffer.from(`x:${FAKE_KEY}`).toString('base64')}`;
const KEY_PAIR = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: EXTRA };
const pairsOf = (env) => Array.from({ length: Number(env.GIT_CONFIG_COUNT ?? 0) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);

test('quick and narrow both shut out the system and user git config; quick signs in through the host tool', async () => {
  const p = await project();
  try {
    await withProcessEnv({ GIT_SSH_COMMAND: 'inherited-should-not-reach-git', GIT_CONFIG_PARAMETERS: "'core.hookspath'='/tmp'" }, () => as(p.home, async () => {
      const dir = await folderWith();
      const cases = [
        ['quick, bare', async () => ({}), 'quick'],
        ['quick, said', async () => ({ mode: 'quick', env: {} }), 'quick'],
        ['narrow, said', async () => ({ mode: 'narrow', env: { GH_TOKEN: FAKE_KEY, ...KEY_PAIR } }), 'narrow'],
        ['narrow, bare', async () => ({ GH_TOKEN: FAKE_KEY, ...KEY_PAIR }), 'narrow'],
      ];
      for (const [label, envFor, mode] of cases) {
        const calls = [];
        const recordingRun = async (file, args, options) => { calls.push({ args, options }); return hostGuard(file, args, options); };
        await withHelper(fakeAdapter(), async (client) => {
          await g(dir, 'commit', '-q', '--allow-empty', '-m', label);
          assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true }, label);
        }, { envFor, run: recordingRun });
        const push = calls.find((c) => c.args.includes('push'));
        const penv = push.options.env;
        assert.equal(penv.GIT_CONFIG_NOSYSTEM, '1', label);
        assert.equal(penv.GIT_CONFIG_GLOBAL, '/dev/null', label);
        const pairs = pairsOf(penv);
        if (mode === 'quick') {
          assert.ok(pairs.some(([k, v]) => k === 'credential.helper' && / auth git-credential$/.test(v)), `${label}: signs in through the host tool`);
        } else {
          assert.equal(penv.GH_TOKEN, FAKE_KEY, label);
          assert.ok(pairs.some(([k, v]) => k.toLowerCase() === 'http.extraheader' && v === EXTRA), `${label}: the key's pair`);
          assert.ok(!pairs.some(([k, v]) => k === 'credential.helper' && v !== ''), `${label}: no host-tool helper`);
        }
        const copy = calls.find((c) => c.args.includes('fetch') && c.args.some((a) => typeof a === 'string' && a.startsWith(fs.realpathSync.native(dir))));
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
      const dir = await folderWith();
      const slowFolder = async (file, args, options) => (args.includes('fetch') && args.some((a) => typeof a === 'string' && a.startsWith(fs.realpathSync.native(dir)))
        ? { code: 1, stdout: '', stderr: '', timedOut: true }
        : hostGuard(file, args, options));
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: false, refused: 'reading the folder took too long' });
      }, { run: slowFolder });
    });
  } finally { p.cleanup(); }
});

test('pushes and merges at once share the lock clone without tripping over each other', async () => {
  const p = await project();
  try {
    const head = await prOnHost(p.remote.url);
    await as(p.home, async () => {
      reviewAndApproval(head);
      const dir = await folderWith();
      for (const b of ['f1', 'f2', 'f3']) await g(dir, 'branch', b);
      await withHelper(fakeAdapter({ prState: openAt(head) }), async (client) => {
        const answers = await Promise.all([
          ...['f1', 'f2', 'f3'].map((b) => client.push({ project: 'o__p', dir, refspec: b })),
          ...[1, 2, 3].map(() => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false })),
        ]);
        assert.ok(answers.every((a) => a.ok === true), JSON.stringify(answers));
      });
    });
  } finally { p.cleanup(); }
});

test('a record folder holding files but no repository gives its refusal through a state route, and is left alone', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      // the record's repository is gone and its files are still there: they may be the only copy
      fs.rmSync(path.join(stateDir('o__p'), '.git'), { recursive: true, force: true });
      await withHelper(fakeAdapter(), async (client) => {
        const answer = await client.state.sync({ project: 'o__p' });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /holds files but no repository/);
      });
      assert.equal(fs.existsSync(path.join(stateDir('o__p'), 'README.md')), true, 'the files are left as they were');
      assert.equal(fs.existsSync(path.join(stateDir('o__p'), '.git')), false);
    });
  } finally { p.cleanup(); }
});

// ---- Task 16 ----

test('a push that times out is refused, saying so', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      const dir = await folderWith();
      const slowHost = async (file, args, options) => (args.includes('push')
        ? { code: 1, stdout: '', stderr: '', timedOut: true }
        : hostGuard(file, args, options));
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
    let prHead = null;
    await as(p.home, async () => {
      const dir = await folderWith();
      const mirror = path.join(stateDir('o__p'), '..', 'mirror.git');
      await g(dir, 'branch', 'second');
      const calls = [];
      const recording = async (file, args, options) => { calls.push({ args, cwd: options?.cwd }); return hostGuard(file, args, options); };
      const refs = async () => (await run('git', ['for-each-ref', '--format=%(refname)', 'refs/wheelhouse/'], { cwd: mirror })).stdout.trim();
      const collected = (from) => calls.slice(from).some((c) => c.args.includes('gc') && c.args.includes('--auto') && c.cwd === mirror);
      // The tidy runs after the answer, behind it on the same queue: wait until it has run.
      const waitForGc = (from) => until(() => collected(from), { what: 'git gc --auto on the mirror' });
      await withHelper(fakeAdapter({ prState: async () => openAt(prHead)() }), async (client) => {
        let mark = calls.length;
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true });
        assert.equal(await waitForGc(mark), true, 'git gc --auto ran after the push');
        assert.equal(await refs(), '', 'no per-request ref is left after a push');
        // A pull request to merge, now the host has a default branch.
        prHead = await prOnHost(p.remote.url);
        reviewAndApproval(prHead);

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
        const answer = await client.push({ project: 'o__p', dir: agent, refspec: 'feature' });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /uploadpack\.packobjectshook/);
      });
      assert.equal(fs.existsSync(marker), false, 'the look refused the folder, so the hook did not run');
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
        const start = () => startHelper({ run: hostGuard, address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}) });
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
        startHelper({ run: hostGuard, address, adapterFor: async () => fakeAdapter(), envFor: async () => ({}), startWaitMs: 150 }),
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
      const asked = [];
      const none = fakeAdapter({ hasCi: async (sha, branch) => { asked.push([sha, branch]); return false; } });
      await withHelper(none, async (client) => {
        assert.deepEqual(await client.host.facts({ project: 'o__p' }), { ok: true, protection: 'none', ci: 'here' });
        assert.deepEqual(asked, [[HEAD, 'main']], 'the default branch\'s head and name are what is asked about');
      }, { run: freePlanRun });
      await withHelper(fakeAdapter({ hasCi: async () => true }), async (client) => {
        assert.equal((await client.host.facts({ project: 'o__p' })).ci, 'present');
      }, { run: freePlanRun });
    });
  } finally { p.cleanup(); }
});

// This project's record, made a GitLab project on the company's own address.
function asGitlab(remote, home) {
  return as(home, () => writeProject('o__p', {
    folder: os.tmpdir(), remoteUrl: remote.url, host: 'gitlab', repo: 'o/p',
    connection: { host: 'gitlab', mode: 'narrow', project: 'o/p', baseUrl: 'https://git.example.org' },
  }));
}

test('/host/facts on GitLab carries the plan and the gaps the key could read', async () => {
  const p = await project({ lock: false });
  try {
    await asGitlab(p.remote, p.home);
    await as(p.home, async () => {
      const level = (n, d) => [{ access_level: n, access_level_description: d }];
      const seen = [];
      // The company's GitLab as the project key sees it: Free (the approval rules are refused) and
      // no right to list the variables.
      const fetch = async (url) => {
        const path = new URL(url).pathname.replace('/api/v4', '');
        seen.push(path);
        const body = (status, value) => ({ status, text: async () => JSON.stringify(value) });
        const branch = /\/protected_branches\/(.+)$/.exec(path)?.[1];
        if (branch) return body(200, { push_access_levels: branch === 'main' ? level(0, 'No one') : level(30, 'Developers + Maintainers'), merge_access_levels: level(30, 'Developers + Maintainers'), allow_force_push: false });
        if (path === '/projects/o%2Fp') return body(200, { default_branch: 'main', only_allow_merge_if_pipeline_succeeds: true });
        if (path.endsWith('/approval_rules')) return body(403, { message: '403 Forbidden' });
        if (path.includes('/variables')) return body(403, { message: '403 Forbidden' });
        return body(404, {});
      };
      await withHelper(fakeAdapter({ hasCi: async () => true }), async (client) => {
        assert.deepEqual(await client.host.facts({ project: 'o__p' }), { ok: true, protection: 'on', ci: 'present', plan: 'free', gaps: [] });
      }, { fetch, envFor: async () => ({ GITLAB_TOKEN: 'a-stand-in-key' }) });
      assert.ok(seen.some((s) => s.endsWith('/approval_rules')), 'the plan was asked');
    });
  } finally { p.cleanup(); }
});

test('on GitLab a merge the key may not make is refused with the reason and what to do', async () => {
  const p = await project();
  try {
    const head = await prOnHost(p.remote.url);
    // GitLab keeps a merge request's head at its own ref.
    const work = tempFolder('wh-mr-');
    await g(work, 'init', '-q');
    await g(work, 'fetch', '-q', p.remote.url, 'refs/pull/7/head');
    await g(work, 'push', '-q', p.remote.url, 'FETCH_HEAD:refs/merge-requests/7/head');
    await as(p.home, async () => {
      reviewAndApproval(head);
      const refuses = () => fakeAdapter({ prState: openAt(head), merge: async () => ({ merged: false, reason: 'this sign-in is not allowed to merge it' }) });
      // On GitHub the adapter's own words stand.
      await withHelper(refuses(), async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.refused, 'this sign-in is not allowed to merge it');
      });
      await asGitlab(p.remote, p.home);
      await withHelper(refuses(), async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.ok, false);
        assert.equal(answer.refused, GITLAB_MAINTAINERS_ONLY);
        assert.match(answer.refused, /Maintainers only on GitLab, so a person who is a Maintainer presses Merge there/);
      });
    });
  } finally { p.cleanup(); }
});

test('/host/facts says unknown for what the host would not tell, and still answers the rest', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      for (const broken of [
        fakeAdapter({ branchHead: async () => { throw new Error('the host is down'); } }),
        fakeAdapter({ hasCi: async () => { throw new Error('the lookup failed'); } }),
      ]) {
        await withHelper(broken, async (client) => {
          assert.deepEqual(await client.host.facts({ project: 'o__p' }), { ok: true, protection: 'none', ci: 'unknown' });
        }, { run: freePlanRun });
      }
      const refused = async () => ({ code: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' });
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.host.facts({ project: 'o__p' }), { ok: true, protection: 'unknown', ci: 'present' });
      }, { run: refused });
    });
  } finally { p.cleanup(); }
});

test('a hostile global git config reaches none of the helper\'s git, in quick or narrow', async () => {
  for (const [label, envFor] of [['quick', async () => ({})], ['narrow', async () => ({ GH_TOKEN: FAKE_KEY, ...KEY_PAIR })]]) {
    const p = await project();
    const other = await makeBareRemote({ repo: 'x/y' });
    const scratch = tempFolder('wh-hostile-');
    const marker = path.join(scratch, 'marker');
    try {
      const hooks = path.join(scratch, 'hooks');
      fs.mkdirSync(hooks);
      const hook = (name, body) => { fs.writeFileSync(path.join(hooks, name), body, { mode: 0o755 }); };
      hook('pre-push', `#!/bin/sh\necho hook >> "${marker}"\n`);
      hook('reference-transaction', `#!/bin/sh\necho hook >> "${marker}"\n`);
      const helperScript = path.join(scratch, 'cred.sh');
      fs.writeFileSync(helperScript, `#!/bin/sh\necho cred >> "${marker}"\n`, { mode: 0o755 });
      const slash = (f) => f.replaceAll('\\', '/');
      fs.writeFileSync(path.join(scratch, '.gitconfig'), [
        `[core]\n\thooksPath = ${slash(hooks)}`,
        `[url "${slash(other.url)}"]\n\tinsteadOf = ${slash(p.remote.url)}`,
        `[credential]\n\thelper = !${slash(helperScript)}`,
      ].join('\n') + '\n');
      await as(p.home, async () => {
        const dir = await folderWith();
        await g(dir, 'commit', '-q', '--allow-empty', '-m', label);
        // Only the helper and its git see the hostile home; the test's own git calls do not.
        const calls = [];
        const recordingRun = async (file, args, options) => { calls.push({ args, options }); return hostGuard(file, args, options); };
        await withProcessEnv({ HOME: scratch, USERPROFILE: scratch, XDG_CONFIG_HOME: path.join(scratch, 'xdg') }, () => withHelper(fakeAdapter(), async (client) => {
          assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true }, label);
        }, { envFor, run: recordingRun }));
        // The local-path remote never asks for a credential, so the helper's pairs are checked directly.
        const pushEnv = calls.find((c) => c.args.includes('push')).options.env;
        const helpers = pairsOf(pushEnv).filter(([k]) => k === 'credential.helper').map(([, v]) => v);
        if (label === 'quick') {
          assert.equal(helpers.length, 2, 'quick: the cleared list, then the host tool');
          assert.equal(helpers[0], '');
          assert.match(helpers[1], / auth git-credential$/);
        } else assert.deepEqual(helpers, [''], 'narrow: the cleared list and no credential helper');
      });
      const heads = async (url) => (await run('git', ['ls-remote', '--heads', url], { env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })).stdout;
      assert.match(await heads(p.remote.url), /refs\/heads\/feature/, `${label}: lands on the recorded remote`);
      assert.equal(await heads(other.url), '', `${label}: not on the rewritten one`);
      assert.equal(fs.existsSync(marker), false, `${label}: no hook or credential helper ran`);
    } finally { p.cleanup(); other.cleanup(); fs.rmSync(scratch, { recursive: true, force: true }); }
  }
});

test('a local path is reached only for a project whose recorded remote is one', async () => {
  const p = await project({ lock: false });
  try {
    await as(p.home, async () => {
      const calls = [];
      const recordingRun = async (file, args, options) => { calls.push({ args, options }); return hostGuard(file, args, options); };
      const protocolOfFetch = async (keyEnv = null) => {
        calls.length = 0;
        await withHelper(fakeAdapter(), async (client) => {
          await client.testMerge({ project: 'o__p', a: 'main', b: 'feature' });
        }, { run: recordingRun, ...(keyEnv ? { envFor: async () => keyEnv } : {}) });
        return calls.find((c) => c.args.includes('fetch') && c.args.includes('origin'))?.options.env.GIT_ALLOW_PROTOCOL;
      };
      assert.equal(await protocolOfFetch(), 'https:file', 'a local-path remote: a local path is reached');
      const remoteUrl = 'https://example.invalid/o/p.git';
      writeProject('o__p', { folder: os.tmpdir(), remoteUrl, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      assert.equal(await protocolOfFetch(), 'https', 'an https remote: https only');
      // A connection whose own environment asks for a local path does not widen an https remote.
      const asked = await protocolOfFetch({ GH_TOKEN: FAKE_KEY, ...KEY_PAIR, GIT_ALLOW_PROTOCOL: 'https:file' });
      assert.equal(asked, 'https', 'a narrow environment asking for https:file on an https record: https only');
    });
  } finally { p.cleanup(); }
});

// --- the helper looks before it trusts a repository ---

// An agent's project folder holding one commit on `feature`, with `config` lines added to its .git/config.
async function folderWith(lines = []) {
  const dir = tempFolder('wh-proj-');
  await g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', 'One');
  await g(dir, 'checkout', '-q', '-b', 'feature');
  for (const [key, value] of lines) await g(dir, 'config', key, value);
  return dir;
}
const lookCalls = (calls) => calls.filter((c) => c.file === 'git' && c.args.includes('--name-only') && c.args.includes('--list'));
const recorder = (calls) => async (file, args, options) => {
  calls.push({ file, args, cwd: options?.cwd, env: options?.env });
  return hostGuard(file, args, options);
};

test('a push from a project folder whose config sets core.alternateRefsCommand is refused, naming it, and nothing runs', async () => {
  const p = await project();
  const outside = tempFolder('wh-mark-');
  const marks = path.join(outside, 'marks');
  const script = path.join(outside, 'mark.sh');
  fs.writeFileSync(script, `#!/bin/sh\necho ran >> "${marks.split(path.sep).join('/')}"\n`, { mode: 0o755 });
  const dir = await folderWith([['core.alternateRefsCommand', script.split(path.sep).join('/')]]);
  try {
    await as(p.home, async () => {
      writeProject('o__p', { folder: dir, remoteUrl: p.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      await withHelper(fakeAdapter(), async (client) => {
        const answer = await client.push({ project: 'o__p', dir, refspec: 'feature' });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /core\.alternaterefscommand/);
        assert.match(answer.refused, /does not allow/);
        assert.doesNotMatch(answer.refused, /setup|Go ahead/i);
        assert.match(answer.refused, /try the request again/);
        assert.equal(fs.existsSync(marks), false);
        assert.equal(await remoteHeads(p.remote.url).then((t) => t.includes('refs/heads/feature')), false);
      });
    });
  } finally { p.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a push from a project folder whose config sets core.fsmonitor goes through, and the program never runs', async () => {
  const p = await project();
  const outside = tempFolder('wh-mark-');
  const marks = path.join(outside, 'marks');
  const script = path.join(outside, 'mark.sh');
  fs.writeFileSync(script, `#!/bin/sh\necho ran >> "${marks.split(path.sep).join('/')}"\n`, { mode: 0o755 });
  // The project list lets the setting through, because the fence sets core.fsmonitor to false on every call.
  const dir = await folderWith([['core.fsmonitor', script.split(path.sep).join('/')], ['core.longpaths', 'true']]);
  try {
    await as(p.home, async () => {
      writeProject('o__p', { folder: dir, remoteUrl: p.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      await withHelper(fakeAdapter(), async (client) => {
        const answer = await client.push({ project: 'o__p', dir, refspec: 'feature' });
        assert.equal(answer.ok, true, JSON.stringify(answer));
        assert.equal(fs.existsSync(marks), false);
      });
    });
  } finally { p.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a key planted in the lock clone refuses the merge, naming it, before the lock is touched', async () => {
  const p = await project();
  const calls = [];
  try {
    await as(p.home, async () => {
      const lockClone = path.join(stateDir('o__p'), '..', 'lock');
      await run('git', ['config', 'core.fsmonitor', 'true'], { cwd: lockClone });
      reviewAndApproval();
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        const answer = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(answer.ok, false);
        assert.match(answer.refused, /core\.fsmonitor/);
        assert.deepEqual(adapter.merges, []);
        const inLock = calls.filter((c) => c.cwd === lockClone);
        assert.ok(inLock.length > 0 && lookCalls(inLock).length === inLock.length, 'only the look ran in the lock clone');
      }, { run: recorder(calls) });
    });
  } finally { p.cleanup(); }
});

test('a request looks at each repository once, however many git calls it makes', async () => {
  const p = await project();
  const calls = [];
  try {
    await as(p.home, async () => {
      const dir = await folderWith();
      await withHelper(fakeAdapter(), async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true }); // makes the mirror
        calls.length = 0;
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true });
        const looks = lookCalls(calls);
        const byDir = new Map();
        for (const c of looks) byDir.set(fs.realpathSync.native(c.cwd), (byDir.get(fs.realpathSync.native(c.cwd)) ?? 0) + 1);
        assert.ok(byDir.size >= 3, 'the folder, the lock clone and the mirror were looked at');
        for (const [where, count] of byDir) assert.equal(count, 1, `${where} looked at ${count} times`);
        const before = looks.length;
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true });
        assert.equal(lookCalls(calls).length, before * 2, 'the next request looks again, once each');
      }, { run: recorder(calls) });
    });
  } finally { p.cleanup(); }
});

test('only the copy into the mirror may reach a local path', async () => {
  const p = await project({ lock: false });
  const dir = await folderWith();
  const calls = [];
  try {
    await g(dir, 'checkout', '-q', 'main');
    await g(dir, 'branch', '-q', '-D', 'feature');
    await g(dir, 'checkout', '-q', '-b', 'feature/x');
    await as(p.home, async () => {
      // A recorded repository at a host: no stand-in, so nothing but the copy may reach a path.
      writeProject('o__p', { folder: dir, remoteUrl: 'https://example.invalid/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      await withHelper(fakeAdapter(), async (client) => {
        const answer = await client.pull({ project: 'o__p', dir, branch: 'feature/x' });
        assert.equal(answer.ok, false, 'the host cannot be reached');
        const reaching = calls.filter((c) => c.file === 'git' && String(c.env?.GIT_ALLOW_PROTOCOL ?? '').split(':').includes('file'));
        assert.ok(reaching.length >= 1, 'the copy ran');
        const sources = [dir, fs.realpathSync.native(dir), fs.realpathSync.native(path.join(dir, '.git'))];
        for (const c of reaching) assert.ok(c.args.includes('fetch') && sources.some((source) => c.args.includes(source)), `a call other than the copy may reach a path: ${c.args.join(' ')}`);
        const others = calls.filter((c) => c.file === 'git' && !reaching.includes(c));
        assert.ok(others.length >= 1 && others.every((c) => !String(c.env?.GIT_ALLOW_PROTOCOL ?? '').split(':').includes('file')));
      }, { run: recorder(calls) });
    });
  } finally { p.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('after a refused look, no more git runs in that repository: the mirror\'s tidy-up and the private record stay away', async () => {
  const p = await project();
  const dir = await folderWith();
  const calls = [];
  try {
    await as(p.home, async () => {
      writeProject('o__p', { folder: dir, remoteUrl: p.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      const mirror = path.join(stateDir('o__p'), '..', 'mirror.git');
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        assert.deepEqual(await client.push({ project: 'o__p', dir, refspec: 'feature' }), { ok: true }); // makes the mirror
        // The push's tidy-up runs after its answer: wait for it, so it is not what clears the leftover ref below.
        const tidied = () => calls.some((c) => c.args.includes('gc') && c.cwd && fs.realpathSync.native(c.cwd) === fs.realpathSync.native(mirror));
        assert.equal(await until(tidied, { what: 'git gc --auto on the mirror' }), true);
        // A refused push in the mirror: the leftover per-request ref stays, and only the look ran there.
        const head = await g(dir, 'rev-parse', 'feature');
        await run('git', ['update-ref', 'refs/wheelhouse/leftover', head], { cwd: mirror });
        await run('git', ['config', 'core.fsmonitor', 'true'], { cwd: mirror });
        calls.length = 0;
        const refused = await client.push({ project: 'o__p', dir, refspec: 'feature' });
        assert.equal(refused.ok, false);
        assert.match(refused.refused, /core\.fsmonitor/);
        assert.match(await run('git', ['for-each-ref', '--format=%(refname)', 'refs/wheelhouse/'], { cwd: mirror }).then((r) => r.stdout), /refs\/wheelhouse\/leftover/);
        const inMirror = calls.filter((c) => c.cwd && fs.realpathSync.native(c.cwd) === fs.realpathSync.native(mirror));
        assert.ok(inMirror.length > 0 && lookCalls(inMirror).length === inMirror.length, inMirror.map((c) => c.args.join(' ')).join(' | '));
        await run('git', ['config', '--unset-all', 'core.fsmonitor'], { cwd: mirror });

        // A merge with a planted key in the private record: refused with the line, and only the look ran there.
        const record = fs.realpathSync.native(stateDir('o__p'));
        await g(stateDir('o__p'), 'config', 'core.fsmonitor', 'true');
        reviewAndApproval();
        calls.length = 0;
        const merged = await client.merge({ project: 'o__p', number: 7, stop: false, bypass: false });
        assert.equal(merged.ok, false);
        assert.match(merged.refused, /core\.fsmonitor/);
        assert.deepEqual(adapter.merges, []);
        const inRecord = calls.filter((c) => c.cwd && fs.realpathSync.native(c.cwd) === record);
        assert.ok(inRecord.length > 0 && lookCalls(inRecord).length === inRecord.length, inRecord.map((c) => c.args.join(' ')).join(' | '));
      }, { run: recorder(calls) });
    });
  } finally { p.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- the survey taken again (design section 15, ruling A1; plan ruling P3) ---

const SURVEYED = {
  v: 1, hostReached: false, requests: [], pushed: [], local: [], more: { pushed: false, local: false },
  instructions: { files: [], sections: [] }, scheduled: 0, secrets: 0, rules: [{ words: 'Use British English.', source: { file: 'CLAUDE.md', line: 2 } }],
};
// A survey the helper recorded earlier, put into the state's folder as its file.
let seeded = 0;
function seedSurvey(data) {
  seeded += 1;
  const event = makeEvent({ kind: 'survey', data, now: () => new Date(Date.now() + seeded) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
const surveysIn = () => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'survey').sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

// A project whose folder is a repository of its own, on main, with one line of work off it.
async function surveyedProject() {
  const p = await project({ lock: false });
  const dir = tempFolder('wh-survey-again ');
  await g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'Start\n');
  await g(dir, 'add', 'README.md');
  await g(dir, 'commit', '-q', '-m', 'Start');
  await g(dir, 'switch', '-q', '-c', 'prices');
  fs.writeFileSync(path.join(dir, 'prices.txt'), 'Prices\n');
  await g(dir, 'add', 'prices.txt');
  await g(dir, 'commit', '-q', '-m', 'Prices');
  await g(dir, 'switch', '-q', 'main');
  as(p.home, () => writeProject('o__p', { folder: dir, remoteUrl: p.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } }));
  return { ...p, dir, cleanup: () => { p.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('/survey/again takes a survey once when the last one missed the host, and none when it didn\'t', async () => {
  const p = await surveyedProject();
  try {
    let reached = false;
    const secret = ['gh', 'p_', 'a1B2'.repeat(10)].join('');
    const adapter = fakeAdapter({
      openRequests: async () => {
        if (!reached) throw new Error('unreachable');
        return [{ number: 7, title: `Key ${secret}`, body: '', branch: 'x', head: 'c'.repeat(40), draft: false, fork: false }];
      },
    });
    await as(p.home, () => withHelper(adapter, async (client) => {
      // No caller writes a survey: only the helper records one.
      const forged = await client.state.write({ project: 'o__p', kind: 'survey', data: SURVEYED });
      assert.equal(forged.ok, false);
      assert.match(forged.refused, /only the helper/);
      assert.equal(surveysIn().length, 0);
      // Nor a Thoroughness column's readiness.
      const ready = await client.state.write({ project: 'o__p', kind: 'column-ready', data: { column: 'lean', pins: { mostCapable: 'model-top', midSized: 'model-mid' }, records: ['eval-1'] } });
      assert.equal(ready.ok, false);
      assert.match(ready.refused, /only the helper/);
      assert.equal(listEvents(stateDir('o__p'), { report: () => {} }).some((e) => e.kind === 'column-ready'), false);
      // No survey yet: none taken.
      assert.deepEqual(await client.survey.again({ project: 'o__p' }), { ok: true, taken: false });
      // The host reached: none taken.
      seedSurvey({ ...SURVEYED, hostReached: true });
      assert.deepEqual(await client.survey.again({ project: 'o__p' }), { ok: true, taken: false });
      // The host missed: one taken, and only once, however it goes.
      seedSurvey(SURVEYED);
      const missedAgain = await client.survey.again({ project: 'o__p' });
      assert.equal(missedAgain.ok, true);
      assert.equal(missedAgain.taken, true);
      assert.equal(missedAgain.hostReached, false);
      assert.deepEqual(await client.survey.again({ project: 'o__p' }), { ok: true, taken: false }, 'taken again once only');
      const [, , last] = surveysIn();
      assert.equal(last.id, missedAgain.id);
      assert.equal(last.data.again, true);
      assert.deepEqual(last.data.local.map((i) => i.name), ['prices']);
      assert.deepEqual(last.data.rules, SURVEYED.rules, 'the rules found at setup are kept');
      // Missed at setup and reached when taken again: the secret in a title is left out.
      seedSurvey(SURVEYED);
      reached = true;
      const taken = await client.survey.again({ project: 'o__p' });
      assert.deepEqual([taken.ok, taken.taken, taken.hostReached], [true, true, true]);
      const latest = surveysIn().at(-1);
      assert.deepEqual(latest.data.requests, [{ number: 7, title: '', draft: false }]);
      assert.equal(JSON.stringify(latest).includes(secret), false);
      // The views have the latest survey.
      assert.equal((await client.state.views({ project: 'o__p' })).views.survey.id, latest.id);
    }));
  } finally { p.cleanup(); }
});

test('/survey/again is refused under STOP, and takes nothing', async () => {
  const p = await surveyedProject();
  try {
    await as(p.home, () => withHelper(fakeAdapter({ openRequests: async () => [] }), async (client) => {
      seedSurvey(SURVEYED);
      fs.writeFileSync(stopFile(), '');
      assert.deepEqual(await client.survey.again({ project: 'o__p' }), { ok: false, refused: 'All stop is on' });
      assert.equal(surveysIn().length, 1);
    }));
  } finally { p.cleanup(); }
});

test('/survey/again holds the project\'s state only to write: other state requests go on while it looks, and STOP set meanwhile refuses the write', async () => {
  const p = await surveyedProject();
  try {
    let asked;
    const askedNow = new Promise((resolve) => { asked = resolve; });
    let answer;
    const answered = new Promise((resolve) => { answer = resolve; });
    const adapter = fakeAdapter({ openRequests: async () => { asked(); await answered; return []; } });
    await as(p.home, () => withHelper(adapter, async (client) => {
      seedSurvey(SURVEYED);
      const again = client.survey.again({ project: 'o__p' });
      await askedNow;
      // While the survey waits on the host, the state answers.
      assert.equal((await client.state.views({ project: 'o__p' })).ok, true);
      // STOP set while it looks: nothing is written.
      fs.writeFileSync(stopFile(), '');
      answer();
      assert.deepEqual(await again, { ok: false, refused: 'All stop is on' });
      assert.equal(surveysIn().length, 1);
    }));
  } finally { p.cleanup(); }
});

// --- ready-made changes: carrying a request on, archiving and restoring (design section 15, A2 and A4; plan rulings P4, P5, P13) ---

const AUTHOR = { name: 'Dana Director', email: '1+dana@users.noreply.github.com' };
const authorFor = async () => AUTHOR;

// A project whose folder is a clone of its remote, on main with AGENTS.md, and a seed folder that
// makes commits on the remote; the folder holds a change of the director's own, staged.
async function readyProject() {
  const p = await project({ lock: false });
  const seed = tempFolder('wh-ready-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), 'Start\n');
  fs.writeFileSync(path.join(seed, 'AGENTS.md'), 'Agents\n');
  await g(seed, 'add', '-A');
  await g(seed, 'commit', '-q', '-m', 'Start');
  await g(seed, 'push', '-q', p.remote.url, 'main');
  const dir = tempFolder('wh-ready-folder ');
  await g(dir, 'clone', '-q', '--branch', 'main', p.remote.url, '.');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'Staged\n');
  await g(dir, 'add', 'notes.txt');
  as(p.home, () => writeProject('o__p', { folder: dir, remoteUrl: p.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } }));
  // A commit on the remote at `ref` alone, as a request from someone's own copy is.
  const requestAt = async (ref, file) => {
    await g(seed, 'switch', '-q', '--detach', 'main');
    fs.writeFileSync(path.join(seed, file), `${file}\n`);
    await g(seed, 'add', file);
    await g(seed, 'commit', '-q', '-m', `Add ${file}`);
    const sha = await g(seed, 'rev-parse', 'HEAD');
    await g(seed, 'push', '-q', '-f', p.remote.url, `HEAD:${ref}`);
    await g(seed, 'switch', '-q', 'main');
    return sha;
  };
  const folderState = async () => [await g(dir, 'status', '--porcelain'), await g(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags')];
  return {
    ...p, dir, seed, requestAt, folderState,
    cleanup: () => { p.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(seed, { recursive: true, force: true }); },
  };
}

test('/survey/carry-on makes an open request ready at the work\'s ref, on a line that is no request\'s own, and writes its ready record', async () => {
  const p = await readyProject();
  try {
    const head = await p.requestAt('refs/pull/7/head', 'prices.txt');
    const adapter = fakeAdapter({
      openRequests: async () => [
        { number: 7, title: 'Prices', body: 'Adds the prices page.', branch: 'prices', head, draft: false, fork: true },
        { number: 8, title: 'Other', body: '', branch: 'feature/carry-on-7', head: 'd'.repeat(40), draft: false, fork: false },
      ],
      requestDetails: async () => ({ files: [{ path: 'prices.txt', additions: 1, deletions: 0 }], commits: ['Add prices.txt'] }),
      pullRef: (n) => `refs/pull/${n}/head`,
    });
    await as(p.home, () => withHelper(adapter, async (client) => {
      const before = await p.folderState();
      const made = await client.survey.carryOn({ cwd: p.dir, number: 7 });
      assert.deepEqual(made, {
        ok: true, work: 'carry-on-7-2', from: { sha: head, ref: 'refs/wheelhouse/from/carry-on-7-2', request: 7 },
        branch: 'prices', fork: true, title: 'Prices', body: 'Adds the prices page.', bodyWithheld: false,
        files: [{ path: 'prices.txt', additions: 1, deletions: 0 }], commits: ['Add prices.txt'],
      });
      assert.deepEqual(readReadyRecord('o__p', 'carry-on-7-2'), { sha: head, ref: 'refs/wheelhouse/from/carry-on-7-2', request: 7, branch: 'prices' });
      assert.equal(await g(p.dir, 'rev-parse', 'refs/wheelhouse/from/carry-on-7-2'), head);
      assert.deepEqual(await p.folderState(), before, 'nothing else in the folder moved');
      // Carried on again: another id, since that one has its ready record.
      assert.equal((await client.survey.carryOn({ project: 'o__p', number: 7 })).work, 'carry-on-7-3');
      // Only an open request.
      const closed = await client.survey.carryOn({ project: 'o__p', number: 9 });
      assert.deepEqual(closed, { ok: false, refused: '#9 isn\'t open on the host, so there is nothing to carry on' });
      assert.equal(await g(p.dir, 'for-each-ref', '--format=%(refname)', 'refs/wheelhouse/'), 'refs/wheelhouse/from/carry-on-7-2\nrefs/wheelhouse/from/carry-on-7-3');
      // Nothing is pushed: the remote has no new line.
      assert.doesNotMatch(await remoteHeads(p.remote.url), /feature|carry-on/);
      // Refused under STOP, making nothing ready.
      fs.writeFileSync(stopFile(), '');
      assert.deepEqual(await client.survey.carryOn({ project: 'o__p', number: 7 }), { ok: false, refused: 'All stop is on' });
      assert.equal(readReadyRecord('o__p', 'carry-on-7-4'), null);
    }, { authorFor }));
  } finally { p.cleanup(); }
});

test('/survey/carry-on with a line makes a piece the survey lists ready, from where it stands, on a line that is never the piece\'s own', async () => {
  const p = await readyProject();
  try {
    // A piece pushed with no request, and one on this computer only.
    const pushed = await p.requestAt('refs/heads/feature/carry-on-photos', 'photos.txt');
    await g(p.dir, 'fetch', '-q', 'origin');
    await g(p.dir, 'branch', 'hours', 'origin/main');
    await g(p.dir, 'update-ref', 'refs/heads/hours', pushed);
    const item = (name, head) => ({ name, head, commits: 1, subject: 'Add photos.txt', at: '' });
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      seedSurvey({ ...SURVEYED, hostReached: true, pushed: [item('feature/carry-on-photos', pushed)], local: [item('hours', pushed)] });
      const before = await p.folderState();
      const made = await client.survey.carryOn({ cwd: p.dir, line: 'feature/carry-on-photos' });
      assert.deepEqual(made, {
        ok: true, work: 'carry-on-feature-carry-on-photos', from: { sha: pushed, ref: 'refs/wheelhouse/from/carry-on-feature-carry-on-photos' },
        branch: 'feature/carry-on-photos', where: 'pushed', moved: false, commits: ['Add photos.txt'], files: [{ path: 'photos.txt', additions: 1, deletions: 0 }],
      });
      assert.deepEqual(readReadyRecord('o__p', made.work), { ...made.from, request: null, branch: 'feature/carry-on-photos' });
      const local = await client.survey.carryOn({ project: 'o__p', line: 'hours' });
      assert.deepEqual([local.ok, local.work, local.where, local.from.sha], [true, 'carry-on-hours', 'local', pushed]);
      assert.deepEqual(readReadyRecord('o__p', 'carry-on-hours'), { ...local.from, request: null, branch: 'hours' });
      assert.deepEqual(await p.folderState(), before, 'nothing else in the folder moved');
      // Only a piece the latest survey lists.
      assert.deepEqual(await client.survey.carryOn({ project: 'o__p', line: 'main' }), { ok: false, refused: 'the latest survey lists no unfinished work named main' });
      assert.doesNotMatch(await remoteHeads(p.remote.url), /carry-on-feature|carry-on-hours/);
      fs.writeFileSync(stopFile(), '');
      assert.deepEqual(await client.survey.carryOn({ project: 'o__p', line: 'hours' }), { ok: false, refused: 'All stop is on' });
    }, { authorFor }));
  } finally { p.cleanup(); }
});

test('/survey/archive archives the survey\'s instruction files as they are on the default branch now, and /survey/restore puts them back', async () => {
  const p = await readyProject();
  try {
    await as(p.home, () => withHelper(fakeAdapter(), async (client) => {
      // No survey has found any: nothing to archive.
      const none = await client.survey.archive({ project: 'o__p' });
      assert.equal(none.ok, false);
      assert.match(none.refused, /no instructions/);
      seedSurvey({ ...SURVEYED, hostReached: true, instructions: { files: ['AGENTS.md', '.cursorrules'], sections: [] } });
      const before = await p.folderState();
      const archived = await client.survey.archive({ cwd: p.dir });
      assert.equal(archived.ok, true, archived.refused);
      assert.equal(archived.work, 'archive-instructions');
      assert.deepEqual(archived.moved, ['AGENTS.md'], 'a file not on the default branch is left out');
      assert.deepEqual(archived.from, { sha: archived.from.sha, ref: 'refs/wheelhouse/from/archive-instructions' });
      assert.deepEqual(readReadyRecord('o__p', 'archive-instructions'), { ...archived.from, request: null, branch: null });
      assert.equal(await g(p.dir, 'log', '-1', '--format=%an', archived.from.sha), AUTHOR.name);
      assert.equal(await g(p.dir, 'show', `${archived.from.sha}:.wheelhouse-archive/AGENTS.md`), 'Agents');
      assert.deepEqual(await p.folderState(), before, 'the director\'s index, working copy and lines are as they were');
      assert.doesNotMatch(await remoteHeads(p.remote.url), /feature|archive/);
      // Once it is merged, putting it back.
      await g(p.dir, 'push', '-q', p.remote.url, `${archived.from.sha}:refs/heads/main`);
      const restored = await client.survey.restore({ project: 'o__p' });
      assert.equal(restored.ok, true, restored.refused);
      assert.deepEqual([restored.work, restored.moved], ['restore-instructions', ['AGENTS.md']]);
      assert.equal(await g(p.dir, 'show', `${restored.from.sha}:AGENTS.md`), 'Agents');
      assert.deepEqual(readReadyRecord('o__p', 'restore-instructions'), { ...restored.from, request: null, branch: null });
      fs.writeFileSync(stopFile(), '');
      assert.deepEqual(await client.survey.archive({ project: 'o__p' }), { ok: false, refused: 'All stop is on' });
      assert.deepEqual(await client.survey.restore({ project: 'o__p' }), { ok: false, refused: 'All stop is on' });
    }, { authorFor }));
  } finally { p.cleanup(); }
});
