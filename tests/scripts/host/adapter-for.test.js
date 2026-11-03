// tests/scripts/host/adapter-for.test.js
// The adapter for a project's record: the host's tool by default, the host's web API when the record says
// 'rest', and a move to the web API by itself when the tool will not start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapterOf } from '../../../scripts/host/adapter-for.js';
import { makeFakeCurl } from '../../helpers/fake-curl.js';
import { tempFolder } from '../../helpers/homes.js';

// glab and gh are run by their bare names: setup's tools folder is empty here.
process.env.WHEELHOUSE_HOME = tempFolder('wh-host-tools-');

const project = readFileSync(new URL('../../fixtures/host/gitlab/project.json', import.meta.url), 'utf8');
const KEY = 'stand-in-BORROWED0123456789ab';
const REPO = 'team/product';
const BASE = 'https://gitlab.example.org';
const gitlab = (connection = {}) => ({ host: 'gitlab', repo: REPO, connection: { mode: 'as-is', project: REPO, baseUrl: BASE, ...connection } });

// A fake glab: answers from a queue; a Error in the queue is thrown, as a program that cannot start is.
function fakeGlab(...queue) {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ file, args, env: options.env });
    const next = queue.shift() ?? { code: 0, stdout: project, stderr: '' };
    if (next instanceof Error) throw next;
    return { code: 0, stdout: '', stderr: '', ...next };
  };
  return { run, calls };
}

// The pieces a REST adapter needs, with a fake curl and a key lender that counts its lendings.
function rest(answers = [{ status: 200, body: project }]) {
  const curl = makeFakeCurl(answers);
  let lent = 0;
  const borrow = async () => { lent += 1; return { username: 'oauth2', key: KEY }; };
  return { curl, borrow, lent: () => lent, via: { run: curl.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'linux', baseEnv: {} } };
}

const spawnError = (code) => Object.assign(new Error(`spawn glab ${code}`), { code });

test('a record with no backend gets the tool\'s adapter', async () => {
  const glab = fakeGlab();
  const adapter = adapterOf(gitlab(), { run: glab.run });
  assert.equal(adapter.backend, 'cli');
  assert.equal(await adapter.defaultBranch(), 'main');
  assert.equal(glab.calls[0].file, 'glab');
});

test('a record with backend rest gets the web API: curl runs, glab does not, and the key is borrowed for each request', async () => {
  const glab = fakeGlab();
  const r = rest([{ status: 200, body: project }, { status: 200, body: project }]);
  const adapter = adapterOf(gitlab({ backend: 'rest' }), { run: glab.run, via: r.via, borrow: r.borrow });
  assert.equal(adapter.backend, 'rest');
  assert.equal(await adapter.defaultBranch(), 'main');
  assert.equal(r.lent(), 1);
  await adapter.defaultBranch();
  assert.equal(r.lent(), 2, 'the key is lent again for the next request, not kept');
  assert.equal(glab.calls.length, 0);
  assert.match(r.curl.calls[0].config, /PRIVATE-TOKEN: stand-in-BORROWED/);
  assert.ok(!r.curl.calls[0].args.join(' ').includes(KEY), 'the key is never an argument');
  assert.ok(!JSON.stringify(adapter).includes(KEY));
});

test('a narrow connection on the web API uses the project key from the computer\'s store', async () => {
  const r = rest();
  const keys = { store: { readKey: async (name) => (name === 'gitlab-project-4242' ? { token: 'stand-in-PROJECTKEY0123456' } : null) } };
  const adapter = adapterOf(gitlab({ mode: 'narrow', projectId: 4242, backend: 'rest' }), { run: fakeGlab().run, via: r.via, borrow: r.borrow, keys });
  await adapter.defaultBranch();
  assert.equal(r.lent(), 0, 'the director\'s own key is not borrowed');
  assert.match(r.curl.calls[0].config, /PRIVATE-TOKEN: stand-in-PROJECTKEY/);
});

test('with no key to borrow, the web API says so plainly and sends nothing', async () => {
  const r = rest();
  const adapter = adapterOf(gitlab({ backend: 'rest' }), { run: fakeGlab().run, via: r.via, borrow: async () => null });
  await assert.rejects(adapter.defaultBranch(), /no key for GitLab on this computer/);
  assert.equal(r.curl.calls.length, 0);
});

test('a tool that will not start moves the project to the web API, once, and the call is answered', async () => {
  for (const first of [spawnError('ENOENT'), spawnError('EACCES'), { code: 1, stderr: 'This program is blocked by group policy.' }]) {
    const glab = fakeGlab(first);
    const r = rest([{ status: 200, body: project }, { status: 200, body: project }]);
    const switches = [];
    const adapter = adapterOf(gitlab({ backend: 'cli' }), { run: glab.run, via: r.via, borrow: r.borrow, onSwitch: async (s) => { switches.push(s); } });
    assert.equal(adapter.backend, 'cli');
    assert.equal(await adapter.defaultBranch(), 'main', 'the call that met the failure is answered');
    assert.deepEqual(switches, [{ from: 'cli', to: 'rest' }]);
    assert.equal(adapter.backend, 'rest');
    assert.equal(await adapter.defaultBranch(), 'main');
    assert.equal(glab.calls.length, 1, 'glab is not tried again');
    assert.equal(switches.length, 1);
  }
});

test('a nested call (issue.list) moves over too, and calls that need no tool stay as they are', async () => {
  const glab = fakeGlab(spawnError('ENOENT'));
  const r = rest([{ status: 200, body: '[]' }]);
  const adapter = adapterOf(gitlab(), { run: glab.run, via: r.via, borrow: r.borrow });
  assert.equal(adapter.pullRef(4), 'refs/merge-requests/4/head');
  assert.deepEqual(await adapter.issue.list({ label: 'wheelhouse' }), []);
  assert.equal(adapter.backend, 'rest');
});

test('a signed-out tool and a refusal are not a switch', async () => {
  const glab = fakeGlab({ code: 1, stderr: 'glab: You are not logged in. Run glab auth login.' });
  const r = rest();
  const switches = [];
  const adapter = adapterOf(gitlab(), { run: glab.run, via: r.via, borrow: r.borrow, onSwitch: async (s) => { switches.push(s); } });
  await assert.rejects(adapter.defaultBranch(), /not logged in/);
  assert.deepEqual(switches, []);
  assert.equal(adapter.backend, 'cli');
  assert.equal(r.curl.calls.length, 0);
});

test('a failure to record the switch does not undo it', async () => {
  const glab = fakeGlab(spawnError('ENOENT'));
  const r = rest();
  const adapter = adapterOf(gitlab(), { run: glab.run, via: r.via, borrow: r.borrow, onSwitch: async () => { throw new Error('disk full'); } });
  assert.equal(await adapter.defaultBranch(), 'main');
  assert.equal(adapter.backend, 'rest');
});

test('GitHub keeps its tool, and says plainly when gh is missing or will not start', async () => {
  const glab = fakeGlab(spawnError('ENOENT'));
  const switches = [];
  const adapter = adapterOf({ host: 'github', repo: 'a-director/product', connection: { mode: 'quick', project: 'a-director/product', backend: 'rest' } }, { run: glab.run, onSwitch: async (s) => { switches.push(s); } });
  assert.equal(adapter.backend, 'cli');
  await assert.rejects(adapter.defaultBranch(), (error) => {
    assert.match(error.message, /GitHub's tool \(gh\) is not installed or will not start on this computer/);
    assert.match(error.message, /web API is not available for GitHub yet/);
    assert.equal(error.code, 'TOOL_WONT_START');
    return true;
  });
  assert.deepEqual(switches, []);
});

test('a local project\'s adapter is unchanged', () => {
  const adapter = adapterOf({ host: 'local', repo: 'local/proj', folder: tempFolder('wh-local-') }, { run: fakeGlab().run });
  assert.equal(typeof adapter.defaultBranch, 'function');
});
