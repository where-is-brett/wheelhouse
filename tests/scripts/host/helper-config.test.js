// tests/scripts/host/helper-config.test.js
// /config: the project's configuration as the default branch has it, read in
// the helper's mirror, so the watcher never reads a working copy an agent can edit.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeBareRemote, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const fakeAdapter = () => ({ defaultBranch: async () => 'main' });
const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A remote whose main holds `files`, and a branch that changes the configuration.
async function remoteWith(files) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = tempFolder('wh-work-');
  await g(work, 'init', '-q', '-b', 'main');
  write(work, { 'README.md': 'r\n', ...files });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  await g(work, 'checkout', '-q', '-b', 'feature/x');
  write(work, { '.claude/wheelhouse.json': JSON.stringify({ ...base, watcherShape: 1, sessionMode: 'plan' }) });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Change the configuration');
  await g(work, 'push', '-q', 'origin', 'feature/x');
  return remote;
}

async function withHelper(remote, fn) {
  const home = shortHome();
  return as(home, async () => {
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => fakeAdapter(), envFor: async () => ({}) });
    try {
      return await fn(helperClient({ address: helper.address }), home);
    } finally {
      await helper.close();
    }
  });
}

test('/config answers the default branch\'s configuration, also under STOP', async () => {
  const given = { ...base, watcherShape: 2, routing: { foreman: 'model-a' } };
  const remote = await remoteWith({ '.claude/wheelhouse.json': JSON.stringify(given) });
  try {
    await withHelper(remote, async (client) => {
      const answer = await client.config({ project: 'o__p' });
      assert.equal(answer.ok, true);
      assert.deepEqual(answer.config, readConfig(JSON.stringify(given)));
      setStop({ by: 'prompt' });
      assert.deepEqual((await client.config({ project: 'o__p' })).config, answer.config, 'read-only, so STOP lets it through');
    });
  } finally { remote.cleanup(); }
});

test('/config with no configuration file is the empty configuration; an unreadable one is refused', async () => {
  const none = await remoteWith({});
  try {
    await withHelper(none, async (client) => {
      assert.deepEqual((await client.config({ project: 'o__p' })).config, readConfig(null));
    });
  } finally { none.cleanup(); }
  const bad = await remoteWith({ '.claude/wheelhouse.json': JSON.stringify({ ...base, sessionMode: 'bypassPermissions' }) });
  try {
    await withHelper(bad, async (client) => {
      const answer = await client.config({ project: 'o__p' });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /configuration/);
    });
  } finally { bad.cleanup(); }
});

test('/config with `cwd` is placed from the folder, as a feature session asks it; the watcher\'s `project` still works', async () => {
  const given = { ...base, buildCommands: ['npm test'] };
  const remote = await remoteWith({ '.claude/wheelhouse.json': JSON.stringify(given) });
  try {
    await withHelper(remote, async (client, home) => {
      const worktree = path.join(home, 'work', '.claude', 'worktrees', 'login-page');
      fs.mkdirSync(worktree, { recursive: true });
      const placed = await client.config({ cwd: worktree });
      assert.equal(placed.ok, true, placed.refused);
      assert.deepEqual(placed.config, readConfig(JSON.stringify(given)));
      assert.deepEqual((await client.config({ project: 'o__p' })).config, placed.config);
      assert.equal((await client.config({ cwd: worktree, project: 'o__p' })).ok, true);
      // A name beside the folder must be the folder's project; a folder outside every project, or
      // not a full path, is refused.
      assert.deepEqual(await client.config({ cwd: worktree, project: 'o__other' }), { ok: false, refused: 'the folder given is not inside the project named' });
      assert.match((await client.config({ cwd: fs.realpathSync.native(tempFolder('wh-elsewhere-')) })).refused, /not inside a Wheelhouse project/);
      assert.match((await client.config({ cwd: 'work/.claude/worktrees/login-page' })).refused, /full path/);
    });
  } finally { remote.cleanup(); }
});
