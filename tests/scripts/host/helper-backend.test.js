// tests/scripts/host/helper-backend.test.js
// The helper's choice of backend per project (design section 8.2): the record's `connection.backend`, the key
// lent for each web API request and dropped after it, the move to the web API when the host's tool will not
// start, the record of that move, and the board's line for it. Against the real helper's wiring
// (startRealHelper) with a stand-in tool and a stand-in curl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { startRealHelper } from '../../../scripts/host/helper-main.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject, readProject } from '../../../scripts/lib/projects.js';
import { healthLines } from '../../../scripts/board/health.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { makeFakeCurl } from '../../helpers/fake-curl.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';

waitLongerOnTheHelper();

const PROJECT = 'team__product';
const KEY = 'stand-in-LENT0123456789abcdefg';
const BASE = 'https://gitlab.example.org';
const mr = readFileSync(new URL('../../fixtures/host/gitlab/mr-view-open.json', import.meta.url), 'utf8');

const record = (connection = {}) => ({
  folder: os.tmpdir(), remoteUrl: `${BASE}/team/product.git`, host: 'gitlab', repo: 'team/product',
  connection: { host: 'gitlab', mode: 'as-is', project: 'team/product', baseUrl: BASE, ...connection },
});

// A stand-in tool and a stand-in curl, each noting what it was asked; the key lender counts its lendings.
function stands({ tool = async () => ({ code: 0, stdout: mr, stderr: '' }), curlAnswers } = {}) {
  const toolCalls = [];
  const run = async (file, args, options) => {
    toolCalls.push(file);
    return tool(file, args, options);
  };
  const curl = makeFakeCurl(curlAnswers ?? Array.from({ length: 6 }, () => ({ status: 200, body: mr })));
  let lent = 0;
  const borrow = async () => { lent += 1; return { username: 'oauth2', key: KEY }; };
  return { run, toolCalls, curl, borrow, lent: () => lent, via: { run: curl.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'linux', baseEnv: {} } };
}

async function withRealHelper(connection, extra, fn) {
  const home = shortHome();
  await as(home, async () => {
    writeProject(PROJECT, record(connection));
    const helper = await startRealHelper({ address: testAddress(home), onStop: () => {}, keyDeps: { store: { readKey: async () => null } }, ...extra });
    try { await fn(helperClient({ address: helper.address }), home); } finally { await helper.close(); }
  });
}

test('a record with no backend reads through the tool, and the web API is never used', async () => {
  const s = stands();
  await withRealHelper({}, { run: s.run, via: s.via, borrow: s.borrow }, async (client) => {
    const got = await client.prState({ project: PROJECT, number: 4 });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual(s.toolCalls, ['glab']);
    assert.equal(s.curl.calls.length, 0);
    assert.equal(s.lent(), 0);
    assert.equal(readProject(PROJECT).connection.backend, undefined, 'a read leaves the record as it was');
  });
});

test('backend rest reads through curl, and lends the key for each request without keeping it', async () => {
  const s = stands();
  await withRealHelper({ backend: 'rest' }, { run: s.run, via: s.via, borrow: s.borrow }, async (client) => {
    const first = await client.prState({ project: PROJECT, number: 4 });
    assert.equal(first.ok, true, JSON.stringify(first));
    // One lending for the request's reads by the version-control tool (the as-is connection has no host tool to
    // read with), and one for each web API call.
    assert.equal(s.lent(), 1 + s.curl.calls.length);
    const before = s.lent();
    await client.prState({ project: PROJECT, number: 4 });
    assert.ok(s.lent() > before, 'the key is asked for again, not kept');
    assert.deepEqual(s.toolCalls, [], 'the tool never runs');
    for (const call of s.curl.calls) {
      assert.match(call.config, /PRIVATE-TOKEN: stand-in-LENT/);
      assert.ok(!call.args.join(' ').includes(KEY), 'the key is never an argument');
    }
    assert.ok(!JSON.stringify(first).includes(KEY));
  });
});

test('a tool that will not start moves the project to the web API, records it, and the board says so once', async () => {
  const s = stands({ tool: async () => { throw Object.assign(new Error('spawn glab ENOENT'), { code: 'ENOENT' }); } });
  await withRealHelper({}, { run: s.run, via: s.via, borrow: s.borrow }, async (client) => {
    const got = await client.prState({ project: PROJECT, number: 4 });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(s.curl.calls.length, 1, 'the call that met the failure was answered on the web API');
    const kept = readProject(PROJECT);
    assert.equal(kept.connection.backend, 'rest');
    assert.equal(kept.connection.switched, 'cli');
    assert.ok(!JSON.stringify(kept).includes(KEY), 'the record holds no secret');
    const lines = healthLines({ record: kept, locked: false, stop: { on: false }, lock: null, helperUp: true, facts: null, renewal: null, platform: 'darwin', realUsers: false });
    assert.deepEqual(lines.map((l) => l.text).filter((t) => /web API/.test(t)), ["GitLab's tool stopped working on this computer, so Wheelhouse is using GitLab's web API instead."]);
    await client.prState({ project: PROJECT, number: 4 });
    assert.deepEqual(s.toolCalls, ['glab'], 'the tool is not tried again');
  });
});

test('a signed-out tool is a sign-in failure said as before, not a switch', async () => {
  const s = stands({ tool: async () => ({ code: 1, stdout: '', stderr: 'glab: You are not logged in. Run glab auth login.' }) });
  await withRealHelper({}, { run: s.run, via: s.via, borrow: s.borrow }, async (client) => {
    const got = await client.prState({ project: PROJECT, number: 4 });
    assert.equal(got.ok, false);
    assert.equal(s.curl.calls.length, 0);
    assert.equal(readProject(PROJECT).connection.backend, undefined);
  });
});

test('GitHub with no gh says so plainly and moves nowhere', async () => {
  const s = stands({ tool: async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); } });
  const home = shortHome();
  await as(home, async () => {
    writeProject('a__b', {
      folder: os.tmpdir(), remoteUrl: 'https://github.com/a/b.git', host: 'github', repo: 'a/b',
      connection: { host: 'github', mode: 'as-is', project: 'a/b' },
    });
    const helper = await startRealHelper({ address: testAddress(home), onStop: () => {}, run: s.run, via: s.via, borrow: s.borrow });
    try {
      const got = await helperClient({ address: helper.address }).prState({ project: 'a__b', number: 4 });
      assert.equal(got.ok, false);
      assert.match(JSON.stringify(got), /GitHub's tool \(gh\) is not installed or will not start/);
      assert.equal(readProject('a__b').connection.backend, undefined);
    } finally { await helper.close(); }
  });
});


test('the old key files move into the computer\'s store before the first request, only when asked to', async () => {
  for (const moveKeys of [false, true]) {
    const kept = new Map();
    const keyDeps = { store: { readKey: async (name) => kept.get(name) ?? null, storeKey: async (name, value) => { kept.set(name, value); }, deleteKey: async () => {} } };
    const s = stands();
    const home = shortHome();
    await as(home, async () => {
      fs.mkdirSync(`${home}/keys`, { recursive: true });
      fs.writeFileSync(`${home}/keys/gitlab-project-5.json`, JSON.stringify({ token: 'stand-in-X', expiresAt: '2027-01-01' }));
      writeProject(PROJECT, record());
      const helper = await startRealHelper({ address: testAddress(home), onStop: () => {}, run: s.run, via: s.via, keyDeps, moveKeys });
      try {
        await helperClient({ address: helper.address }).prState({ project: PROJECT, number: 4 });
        assert.equal(kept.has('gitlab-project-5'), moveKeys);
        assert.equal(fs.existsSync(`${home}/keys/gitlab-project-5.json`), !moveKeys);
      } finally { await helper.close(); }
    });
  }
});
